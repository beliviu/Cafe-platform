-- Skema tiruan yang menyerupai DB live sebelum file 04 (hanya untuk uji lokal, bukan migrasi).
create role anon nologin;
create role authenticated nologin;
create schema auth;
grant usage on schema auth to anon, authenticated;
grant usage on schema public to anon, authenticated;

create table auth.users (
  id uuid primary key,
  email text,
  last_sign_in_at timestamptz,
  banned_until timestamptz
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant execute on function auth.uid() to anon, authenticated;

create table public.cafes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  address text,
  phone text,
  opening_hours jsonb,
  app_name text, logo_url text, tagline text, brand_color text,
  created_at timestamptz not null default now()
);
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  cafe_id uuid references public.cafes (id),
  full_name text,
  phone text,
  role text not null default 'customer',
  created_at timestamptz not null default now()
);
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  cafe_id uuid not null references public.cafes (id) on delete cascade,
  name text not null,
  sort_order integer not null default 0
);
create table public.products (
  id uuid primary key default gen_random_uuid(),
  cafe_id uuid not null references public.cafes (id) on delete cascade,
  category_id uuid,
  name text not null,
  description text,
  price numeric(12, 2) not null,
  image_url text,
  is_available boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  cafe_id uuid not null references public.cafes (id) on delete restrict,
  customer_id uuid references public.profiles (id),
  order_status text not null default 'pending',
  status text,
  payment_status text not null default 'unpaid',
  payment_method text,
  total_amount numeric(12, 2) not null default 0,
  notes text,
  created_at timestamptz not null default now()
);
create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  cafe_id uuid,
  order_id uuid not null references public.orders (id) on delete cascade,
  product_id uuid,
  product_name text not null,
  price numeric(12, 2) not null,
  unit_price numeric(12, 2),
  quantity integer not null,
  subtotal numeric(12, 2),
  notes text,
  created_at timestamptz not null default now()
);

alter table public.cafes enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.profiles enable row level security;
grant select on all tables in schema public to anon, authenticated;
create policy "read cafes" on public.cafes for select using (true);
create policy "read products" on public.products for select using (true);
create policy "read own profile" on public.profiles for select using (id = auth.uid());
grant update (order_status) on public.orders to authenticated;
create policy "members read orders" on public.orders for select to authenticated using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.cafe_id = orders.cafe_id)
);
create policy "members update orders" on public.orders for update to authenticated using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.cafe_id = orders.cafe_id)
);
