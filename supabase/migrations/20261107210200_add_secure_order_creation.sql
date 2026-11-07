create or replace function public.create_order(
  p_cafe_id uuid,
  p_items jsonb,
  p_payment_method text default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer_id uuid := auth.uid();
  v_order_id uuid;
  v_order_number bigint;
  v_item jsonb;
  v_product_id uuid;
  v_product_name text;
  v_price numeric(12, 2);
  v_quantity integer;
  v_total numeric(12, 2) := 0;
  v_item_count integer;
begin
  if v_customer_id is null then
    raise exception 'Authentication is required to place an order'
      using errcode = '28000';
  end if;

  if not exists (
    select 1
    from public.profiles as p
    where p.id = v_customer_id
      and p.role = 'customer'
      and p.cafe_id is null
  ) then
    raise exception 'Only customer accounts can place orders'
      using errcode = '42501';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Items must be a JSON array'
      using errcode = '22023';
  end if;

  v_item_count := jsonb_array_length(p_items);
  if v_item_count < 1 or v_item_count > 50 then
    raise exception 'An order must contain between 1 and 50 items'
      using errcode = '22023';
  end if;

  if p_payment_method is not null
     and length(trim(p_payment_method)) not between 1 and 40 then
    raise exception 'Payment method must be between 1 and 40 characters'
      using errcode = '22023';
  end if;

  if p_notes is not null and length(p_notes) > 1000 then
    raise exception 'Order notes cannot exceed 1000 characters'
      using errcode = '22023';
  end if;

  perform 1
  from public.cafes as c
  where c.id = p_cafe_id
  for update;

  if not found then
    raise exception 'Cafe not found'
      using errcode = '22023';
  end if;

  select coalesce(max(o.order_number), 0) + 1
  into v_order_number
  from public.orders as o
  where o.cafe_id = p_cafe_id;

  insert into public.orders (
    cafe_id,
    customer_id,
    order_number,
    total_amount,
    payment_method,
    notes
  )
  values (
    p_cafe_id,
    v_customer_id,
    v_order_number,
    0,
    nullif(trim(p_payment_method), ''),
    nullif(trim(p_notes), '')
  )
  returning id into v_order_id;

  for v_item in
    select value
    from jsonb_array_elements(p_items) as items(value)
  loop
    if jsonb_typeof(v_item) <> 'object'
       or jsonb_typeof(v_item -> 'product_id') is distinct from 'string'
       or jsonb_typeof(v_item -> 'quantity') is distinct from 'number' then
      raise exception 'Each item must contain a product_id and integer quantity'
        using errcode = '22023';
    end if;

    begin
      v_product_id := (v_item ->> 'product_id')::uuid;
      v_quantity := (v_item ->> 'quantity')::integer;
    exception
      when invalid_text_representation or numeric_value_out_of_range then
        raise exception 'Each item must contain a valid product UUID and integer quantity'
          using errcode = '22023';
    end;

    if v_quantity not between 1 and 99 then
      raise exception 'Item quantity must be between 1 and 99'
        using errcode = '22023';
    end if;

    select p.name, p.price
    into v_product_name, v_price
    from public.products as p
    where p.id = v_product_id
      and p.cafe_id = p_cafe_id
      and p.is_available
    for share;

    if not found then
      raise exception 'Product % is unavailable for this cafe', v_product_id
        using errcode = '22023';
    end if;

    insert into public.order_items (
      cafe_id,
      order_id,
      product_id,
      product_name,
      price,
      quantity
    )
    values (
      p_cafe_id,
      v_order_id,
      v_product_id,
      v_product_name,
      v_price,
      v_quantity
    );

    v_total := v_total + (v_price * v_quantity);
  end loop;

  update public.orders
  set total_amount = v_total
  where id = v_order_id;

  return v_order_id;
end;
$$;

revoke all on function public.create_order(uuid, jsonb, text, text)
  from public, anon;
grant execute on function public.create_order(uuid, jsonb, text, text)
  to authenticated;

notify pgrst, 'reload schema';
