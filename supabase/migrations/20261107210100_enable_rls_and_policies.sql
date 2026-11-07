create or replace function public.has_cafe_role(
  target_cafe_id uuid,
  allowed_roles public.app_role[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles as p
    where p.id = (select auth.uid())
      and p.cafe_id = target_cafe_id
      and p.role = any (allowed_roles)
  );
$$;

revoke all on function public.has_cafe_role(uuid, public.app_role[]) from public, anon;
grant execute on function public.has_cafe_role(uuid, public.app_role[]) to authenticated;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, email, role)
  values (
    new.id,
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    new.email,
    'customer'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function public.handle_new_auth_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

insert into public.profiles (id, full_name, email, role)
select
  u.id,
  nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''),
  u.email,
  'customer'
from auth.users as u
on conflict (id) do nothing;

alter table public.cafes enable row level security;
alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payments enable row level security;

create policy "Public can view cafes"
  on public.cafes for select
  to anon, authenticated
  using (true);

create policy "Owners can update their cafe"
  on public.cafes for update
  to authenticated
  using (public.has_cafe_role(id, array['owner']::public.app_role[]))
  with check (public.has_cafe_role(id, array['owner']::public.app_role[]));

create policy "Users can view their own profile and owners can view cafe profiles"
  on public.profiles for select
  to authenticated
  using (
    id = (select auth.uid())
    or public.has_cafe_role(cafe_id, array['owner']::public.app_role[])
  );

create policy "Public can view categories"
  on public.categories for select
  to anon, authenticated
  using (true);

create policy "Owners can manage categories in their cafe"
  on public.categories for all
  to authenticated
  using (public.has_cafe_role(cafe_id, array['owner']::public.app_role[]))
  with check (public.has_cafe_role(cafe_id, array['owner']::public.app_role[]));

create policy "Public can view available products"
  on public.products for select
  to anon, authenticated
  using (is_available);

create policy "Cafe staff can view all products"
  on public.products for select
  to authenticated
  using (
    public.has_cafe_role(
      cafe_id,
      array['owner', 'staff']::public.app_role[]
    )
  );

create policy "Owners can manage products in their cafe"
  on public.products for all
  to authenticated
  using (public.has_cafe_role(cafe_id, array['owner']::public.app_role[]))
  with check (public.has_cafe_role(cafe_id, array['owner']::public.app_role[]));

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
      where o.id = order_id
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
      where o.id = order_id
        and (
          o.customer_id = (select auth.uid())
          or public.has_cafe_role(
            o.cafe_id,
            array['owner', 'staff']::public.app_role[]
          )
        )
    )
  );

grant usage on type public.app_role, public.order_status, public.payment_status
  to authenticated;

grant select on public.cafes, public.categories, public.products
  to anon, authenticated;
grant update on public.cafes to authenticated;
grant insert, update, delete on public.categories, public.products to authenticated;
grant select on public.profiles, public.orders, public.order_items, public.payments
  to authenticated;
grant update (order_status) on public.orders to authenticated;

revoke insert, update, delete on public.profiles, public.orders,
  public.order_items, public.payments from anon, authenticated;
