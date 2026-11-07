alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payments enable row level security;
alter table public.profiles enable row level security;

grant select on public.orders, public.order_items, public.payments, public.profiles
  to authenticated;
revoke insert, update, delete on public.orders, public.order_items, public.payments
  from anon, authenticated;
revoke update on public.orders from authenticated;
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
      from public.orders o
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
      from public.orders o
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
  from public.orders o
  join public.profiles p on p.id = o.customer_id
  where o.id = any(coalesce(p_order_ids, array[]::uuid[]))
    and public.has_cafe_role(o.cafe_id, array['staff']::public.app_role[]);
$$;

revoke all on function public.staff_order_customer_names(uuid[]) from public, anon;
grant execute on function public.staff_order_customer_names(uuid[]) to authenticated;

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

revoke all on function public.enforce_order_status_workflow() from public, anon, authenticated;
drop trigger if exists enforce_order_status_workflow on public.orders;
create trigger enforce_order_status_workflow
  before update of order_status on public.orders
  for each row execute function public.enforce_order_status_workflow();

do $$
begin
  if not exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) then
    raise exception 'Publication supabase_realtime tidak ditemukan';
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'orders'
  ) then
    execute 'alter publication supabase_realtime add table public.orders';
  end if;
end;
$$;
