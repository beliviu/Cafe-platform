alter table public.orders
  add column if not exists order_status text not null default 'pending',
  add column if not exists payment_status text not null default 'unpaid',
  add column if not exists payment_method text,
  add column if not exists notes text;

alter table public.order_items
  add column if not exists cafe_id uuid,
  add column if not exists price numeric(12, 2);

alter table public.payments
  add column if not exists payment_method text,
  add column if not exists payment_status text not null default 'pending';

update public.order_items as oi
set cafe_id = o.cafe_id
from public.orders as o
where oi.order_id = o.id
  and oi.cafe_id is null;

do $$
begin
  if exists (
    select 1
    from public.order_items as oi
    where oi.cafe_id is null
  ) then
    raise exception
      'Cannot repair order_items.cafe_id: one or more items have no matching order';
  end if;
end;
$$;

update public.order_items as oi
set price = coalesce(
  oi.subtotal / nullif(oi.quantity, 0),
  (
    select p.price
    from public.products as p
    where p.id = oi.product_id
  )
)
where oi.price is null;

do $$
begin
  if exists (
    select 1
    from public.order_items as oi
    where oi.price is null
  ) then
    raise exception
      'Cannot repair order_items.price: an item has neither a usable subtotal nor a matching product';
  end if;
end;
$$;

update public.payments as p
set payment_method = coalesce(o.payment_method, 'legacy')
from public.orders as o
where p.order_id = o.id
  and p.payment_method is null;

update public.payments
set payment_method = 'legacy'
where payment_method is null;

alter table public.order_items
  alter column cafe_id set not null,
  alter column price set not null;

alter table public.payments
  alter column payment_method set not null;

create index if not exists order_items_cafe_order_created_idx
  on public.order_items (cafe_id, order_id, created_at);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.orders'::regclass
      and conname = 'orders_order_status_valid'
  ) then
    alter table public.orders
      add constraint orders_order_status_valid
      check (order_status in (
        'pending', 'confirmed', 'preparing', 'ready', 'completed', 'cancelled'
      ));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.orders'::regclass
      and conname = 'orders_payment_status_valid'
  ) then
    alter table public.orders
      add constraint orders_payment_status_valid
      check (payment_status in (
        'unpaid', 'pending', 'paid', 'failed', 'refunded'
      ));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.payments'::regclass
      and conname = 'payments_payment_status_valid'
  ) then
    alter table public.payments
      add constraint payments_payment_status_valid
      check (payment_status in (
        'unpaid', 'pending', 'paid', 'failed', 'refunded'
      ));
  end if;
end;
$$;

create or replace function public.set_order_item_snapshot_fields()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  select o.cafe_id
  into new.cafe_id
  from public.orders as o
  where o.id = new.order_id;

  if not found then
    raise exception 'Order not found for order item'
      using errcode = '23503';
  end if;

  if not exists (
    select 1
    from pg_attribute as a
    where a.attrelid = 'public.order_items'::regclass
      and a.attname = 'subtotal'
      and a.attgenerated = 's'
  ) then
    new.subtotal := new.price * new.quantity;
  end if;

  return new;
end;
$$;

revoke all on function public.set_order_item_snapshot_fields()
  from public, anon, authenticated;

drop trigger if exists set_order_item_snapshot_fields
  on public.order_items;
create trigger set_order_item_snapshot_fields
  before insert or update of order_id, price, quantity
  on public.order_items
  for each row
  execute function public.set_order_item_snapshot_fields();

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
  v_order_number public.orders.order_number%type;
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
     and p_payment_method not in ('cash', 'simulated') then
    raise exception 'Unsupported payment method'
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

  select coalesce(
    max(
      nullif(
        regexp_replace(o.order_number::text, '[^0-9]', '', 'g'),
        ''
      )::bigint
    ),
    0
  ) + 1
  into v_order_number
  from public.orders as o
  where o.cafe_id = p_cafe_id;

  insert into public.orders (
    cafe_id,
    customer_id,
    order_number,
    total_amount,
    order_status,
    payment_status,
    payment_method,
    notes
  )
  values (
    p_cafe_id,
    v_customer_id,
    v_order_number,
    0,
    'pending',
    'unpaid',
    p_payment_method,
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

alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payments enable row level security;

grant select on public.orders, public.order_items, public.payments
  to authenticated;
revoke insert, update, delete on public.orders, public.order_items, public.payments
  from anon, authenticated;
grant update (order_status) on public.orders to authenticated;

do $$
declare
  existing_policy record;
begin
  for existing_policy in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('orders', 'order_items', 'payments')
  loop
    execute format(
      'drop policy if exists %I on %I.%I',
      existing_policy.policyname,
      existing_policy.schemaname,
      existing_policy.tablename
    );
  end loop;
end;
$$;

create policy "Customers and cafe staff can view orders"
  on public.orders for select
  to authenticated
  using (
    customer_id = (select auth.uid())
    or public.has_cafe_role(
      cafe_id,
      array['owner', 'staff']::public.app_role[]
    )
  );

create policy "Cafe staff can update order status"
  on public.orders for update
  to authenticated
  using (
    public.has_cafe_role(
      cafe_id,
      array['owner', 'staff']::public.app_role[]
    )
  )
  with check (
    public.has_cafe_role(
      cafe_id,
      array['owner', 'staff']::public.app_role[]
    )
  );

create policy "Customers and cafe staff can view order items"
  on public.order_items for select
  to authenticated
  using (
    exists (
      select 1
      from public.orders as o
      where o.id = order_items.order_id
        and (
          o.customer_id = (select auth.uid())
          or public.has_cafe_role(
            o.cafe_id,
            array['owner', 'staff']::public.app_role[]
          )
        )
    )
  );

create policy "Customers and cafe staff can view payments"
  on public.payments for select
  to authenticated
  using (
    exists (
      select 1
      from public.orders as o
      where o.id = payments.order_id
        and (
          o.customer_id = (select auth.uid())
          or public.has_cafe_role(
            o.cafe_id,
            array['owner', 'staff']::public.app_role[]
          )
        )
    )
  );

create or replace function public.staff_order_customer_names(p_order_ids uuid[])
returns table (order_id uuid, customer_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id, p.full_name
  from public.orders as o
  join public.profiles as p on p.id = o.customer_id
  where o.id = any(coalesce(p_order_ids, array[]::uuid[]))
    and public.has_cafe_role(o.cafe_id, array['staff']::public.app_role[]);
$$;

revoke all on function public.staff_order_customer_names(uuid[])
  from public, anon;
grant execute on function public.staff_order_customer_names(uuid[])
  to authenticated;

create or replace function public.enforce_order_status_workflow()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.order_status is not distinct from old.order_status then
    return new;
  end if;

  if not (
    (old.order_status = 'pending' and new.order_status = 'confirmed')
    or (old.order_status = 'confirmed' and new.order_status = 'preparing')
    or (old.order_status = 'preparing' and new.order_status = 'ready')
    or (old.order_status = 'ready' and new.order_status = 'completed')
  ) then
    raise exception 'Perpindahan status pesanan tidak valid: % -> %',
      old.order_status, new.order_status
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_order_status_workflow()
  from public, anon, authenticated;
drop trigger if exists enforce_order_status_workflow on public.orders;
create trigger enforce_order_status_workflow
  before update of order_status on public.orders
  for each row
  execute function public.enforce_order_status_workflow();

create or replace function public.record_customer_payment_simulation(p_order_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer_id uuid := auth.uid();
  v_order public.orders%rowtype;
  v_payment_id uuid;
begin
  if v_customer_id is null then
    raise exception 'Authentication is required to simulate payment'
      using errcode = '28000';
  end if;

  select *
  into v_order
  from public.orders as o
  where o.id = p_order_id
    and o.customer_id = v_customer_id
  for update;

  if not found then
    raise exception 'Order not found for this customer'
      using errcode = '42501';
  end if;

  if v_order.payment_method is distinct from 'simulated' then
    raise exception 'This order is not using simulated payment'
      using errcode = '22023';
  end if;

  if v_order.order_status = 'cancelled' then
    raise exception 'Payment cannot be simulated for a cancelled order'
      using errcode = '22023';
  end if;

  if v_order.payment_status = 'paid' then
    raise exception 'A paid order cannot be simulated again'
      using errcode = '22023';
  end if;

  if v_order.total_amount <= 0 then
    raise exception 'Simulated payment requires a positive total; choose pay at cafe for a free order'
      using errcode = '22023';
  end if;

  select p.id
  into v_payment_id
  from public.payments as p
  where p.order_id = v_order.id
    and p.payment_method = 'simulated_demo'
  order by p.created_at desc
  limit 1;

  if v_payment_id is not null then
    return v_payment_id;
  end if;

  insert into public.payments (
    order_id,
    payment_method,
    amount,
    payment_status
  )
  values (
    v_order.id,
    'simulated_demo',
    v_order.total_amount,
    'pending'
  )
  returning id into v_payment_id;

  update public.orders
  set payment_status = 'pending'
  where id = v_order.id;

  return v_payment_id;
end;
$$;

revoke all on function public.record_customer_payment_simulation(uuid)
  from public, anon;
grant execute on function public.record_customer_payment_simulation(uuid)
  to authenticated;

do $$
begin
  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'orders'
  ) then
    alter publication supabase_realtime add table public.orders;
  end if;
end;
$$;

notify pgrst, 'reload schema';
