create type public.app_role as enum ('owner', 'staff', 'customer');
create type public.order_status as enum (
  'pending',
  'confirmed',
  'preparing',
  'ready',
  'completed',
  'cancelled'
);
create type public.payment_status as enum (
  'unpaid',
  'pending',
  'paid',
  'failed',
  'refunded'
);

create table public.cafes (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  slug text not null unique check (length(trim(slug)) > 0),
  description text,
  logo_url text,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  cafe_id uuid references public.cafes(id) on delete restrict,
  full_name text,
  email text,
  role public.app_role not null default 'customer',
  created_at timestamptz not null default now(),
  constraint profiles_role_cafe_check check (
    (role = 'customer' and cafe_id is null)
    or (role in ('owner', 'staff') and cafe_id is not null)
  )
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  cafe_id uuid not null references public.cafes(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  created_at timestamptz not null default now(),
  constraint categories_cafe_name_unique unique (cafe_id, name),
  constraint categories_id_cafe_unique unique (id, cafe_id)
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  cafe_id uuid not null references public.cafes(id) on delete cascade,
  category_id uuid not null,
  name text not null check (length(trim(name)) > 0),
  description text,
  price numeric(12, 2) not null check (price >= 0),
  image_url text,
  is_available boolean not null default true,
  created_at timestamptz not null default now(),
  constraint products_cafe_name_unique unique (cafe_id, name),
  constraint products_id_cafe_unique unique (id, cafe_id),
  constraint products_category_same_cafe_fk
    foreign key (category_id, cafe_id)
    references public.categories (id, cafe_id)
    on delete restrict
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  cafe_id uuid not null references public.cafes(id) on delete restrict,
  customer_id uuid not null references public.profiles(id) on delete restrict,
  order_number bigint not null check (order_number > 0),
  total_amount numeric(12, 2) not null default 0 check (total_amount >= 0),
  order_status public.order_status not null default 'pending',
  payment_status public.payment_status not null default 'unpaid',
  payment_method text,
  notes text,
  created_at timestamptz not null default now(),
  constraint orders_cafe_number_unique unique (cafe_id, order_number),
  constraint orders_id_cafe_unique unique (id, cafe_id)
);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  cafe_id uuid not null,
  order_id uuid not null,
  product_id uuid not null,
  product_name text not null,
  price numeric(12, 2) not null check (price >= 0),
  quantity integer not null check (quantity between 1 and 99),
  subtotal numeric(12, 2) generated always as (price * quantity) stored,
  created_at timestamptz not null default now(),
  constraint order_items_order_same_cafe_fk
    foreign key (order_id, cafe_id)
    references public.orders (id, cafe_id)
    on delete cascade,
  constraint order_items_product_same_cafe_fk
    foreign key (product_id, cafe_id)
    references public.products (id, cafe_id)
    on delete restrict
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  payment_method text not null,
  amount numeric(12, 2) not null check (amount > 0),
  payment_status public.payment_status not null default 'pending',
  created_at timestamptz not null default now()
);

create index profiles_cafe_role_idx
  on public.profiles (cafe_id, role)
  where cafe_id is not null;
create index categories_cafe_created_idx
  on public.categories (cafe_id, created_at);
create index products_cafe_availability_category_idx
  on public.products (cafe_id, is_available, category_id);
create index products_category_cafe_idx
  on public.products (category_id, cafe_id);
create index orders_cafe_status_created_idx
  on public.orders (cafe_id, order_status, created_at desc);
create index orders_customer_created_idx
  on public.orders (customer_id, created_at desc);
create index order_items_order_idx on public.order_items (order_id);
create index order_items_product_idx on public.order_items (product_id);
create index payments_order_created_idx
  on public.payments (order_id, created_at desc);
