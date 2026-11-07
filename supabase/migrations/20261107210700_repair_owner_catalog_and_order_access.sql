alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payments enable row level security;

grant select on public.categories, public.products to anon, authenticated;
grant insert, update, delete on public.categories, public.products to authenticated;
grant select on public.orders, public.order_items, public.payments to authenticated;

-- Kategori
drop policy if exists "Owners can manage categories in their cafe"
on public.categories;

create policy "Owners can manage categories in their cafe"
on public.categories
for all
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'owner'
      and p.cafe_id = categories.cafe_id
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'owner'
      and p.cafe_id = categories.cafe_id
  )
);

-- Produk
drop policy if exists "Owners can manage products in their cafe"
on public.products;

create policy "Owners can manage products in their cafe"
on public.products
for all
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'owner'
      and p.cafe_id = products.cafe_id
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'owner'
      and p.cafe_id = products.cafe_id
  )
);

drop policy if exists "Owners can update their cafe products"
on public.products;

-- Orders
drop policy if exists "Owners can view their cafe orders"
on public.orders;

create policy "Owners can view their cafe orders"
on public.orders
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'owner'
      and p.cafe_id = orders.cafe_id
  )
);

-- Order items
drop policy if exists "Owners can view their cafe order items"
on public.order_items;

create policy "Owners can view their cafe order items"
on public.order_items
for select
to authenticated
using (
  exists (
    select 1
    from public.orders o
    join public.profiles p
      on p.id = auth.uid()
    where o.id = order_items.order_id
      and p.role = 'owner'
      and p.cafe_id = o.cafe_id
  )
);

-- Payments
drop policy if exists "Owners can view their cafe payments"
on public.payments;

create policy "Owners can view their cafe payments"
on public.payments
for select
to authenticated
using (
  exists (
    select 1
    from public.orders o
    join public.profiles p
      on p.id = auth.uid()
    where o.id = payments.order_id
      and p.role = 'owner'
      and p.cafe_id = o.cafe_id
  )
);