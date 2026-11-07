grant update (full_name) on public.profiles to authenticated;

drop policy if exists "Customers can update their own profile name"
  on public.profiles;
create policy "Customers can update their own profile name"
  on public.profiles for update
  to authenticated
  using (
    id = (select auth.uid())
    and role = 'customer'
    and cafe_id is null
  )
  with check (
    id = (select auth.uid())
    and role = 'customer'
    and cafe_id is null
  );

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
  from public.orders o
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
  from public.payments p
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
