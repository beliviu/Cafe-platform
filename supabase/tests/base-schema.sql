-- Skema tiruan = DB live sebelum file 04 (hanya untuk uji lokal, bukan migrasi).
-- Tabel pesanan, trigger, dan fungsi disalin dari hasil diagnostik-fase2.sql (8 Nov 2026).
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
  accepted_payment_methods text[] not null default array['cash', 'qris']::text[],
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

-- ---------- Pesanan (persis seperti live) ----------
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  cafe_id uuid not null references public.cafes (id) on delete cascade,
  customer_id uuid references auth.users (id) on delete set null,
  order_number text not null default (gen_random_uuid())::text unique,
  status text not null default 'pending'
    check (status = any (array['pending', 'confirmed', 'preparing', 'ready', 'completed', 'cancelled'])),
  order_status text not null default 'pending'
    constraint orders_order_status_valid check (order_status = any (array['pending', 'confirmed', 'preparing', 'ready', 'completed', 'cancelled'])),
  payment_status text not null default 'unpaid'
    constraint orders_payment_status_valid check (payment_status = any (array['unpaid', 'pending', 'paid', 'failed', 'refunded'])),
  payment_method text,
  total_amount numeric not null default 0,
  notes text,
  queue_number integer,
  paid_at timestamptz,
  cancel_reason text,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  cafe_id uuid not null,
  order_id uuid not null references public.orders (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete restrict,
  product_name text not null,
  price numeric not null,
  unit_price numeric not null check (unit_price >= 0),
  quantity integer not null check (quantity > 0),
  subtotal numeric not null check (subtotal >= 0),
  notes text,
  created_at timestamptz not null default now()
);
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  amount numeric not null check (amount >= 0),
  method text not null default 'cash' check (method = any (array['cash', 'qris', 'bank_transfer', 'ewallet'])),
  payment_method text not null,
  payment_status text not null default 'pending'
    constraint payments_payment_status_valid check (payment_status = any (array['unpaid', 'pending', 'paid', 'failed', 'refunded'])),
  status text not null default 'pending' check (status = any (array['pending', 'paid', 'failed', 'refunded'])),
  paid_at timestamptz,
  created_at timestamptz not null default now()
);
create table public.order_status_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders (id) on delete cascade,
  cafe_id uuid not null,
  event_type text not null default 'status',
  from_status text,
  to_status text not null,
  note text,
  changed_by uuid,
  created_at timestamptz not null default now()
);

create function public.assign_order_queue_number() returns trigger language plpgsql security definer set search_path to '' as $function$
declare
  v_day date := (coalesce(new.created_at, now()) at time zone 'Asia/Jakarta')::date;
begin
  if new.queue_number is null then
    perform pg_advisory_xact_lock(hashtextextended(new.cafe_id::text || ':' || v_day::text, 0));
    select coalesce(max(o.queue_number), 0) + 1 into new.queue_number
    from public.orders as o
    where o.cafe_id = new.cafe_id
      and o.created_at >= (v_day::timestamp at time zone 'Asia/Jakarta')
      and o.created_at < ((v_day + 1)::timestamp at time zone 'Asia/Jakarta');
  end if;
  return new;
end;
$function$;
create trigger assign_order_queue_number before insert on public.orders for each row execute function public.assign_order_queue_number();

create function public.enforce_order_status_workflow() returns trigger language plpgsql set search_path to 'public' as $function$
begin
  if new.order_status is not distinct from old.order_status then
    return new;
  end if;
  if not (
    (old.order_status = 'pending' and new.order_status = 'confirmed')
    or (old.order_status = 'confirmed' and new.order_status = 'preparing')
    or (old.order_status = 'preparing' and new.order_status = 'ready')
    or (old.order_status = 'ready' and new.order_status = 'completed')
    or (old.order_status in ('pending', 'confirmed', 'preparing', 'ready') and new.order_status = 'cancelled')
  ) then
    raise exception 'Perpindahan status pesanan tidak valid: % -> %', old.order_status, new.order_status using errcode = '23514';
  end if;
  if new.order_status = 'cancelled' and new.cancelled_at is null then
    raise exception 'Gunakan fungsi staff_cancel_order untuk membatalkan pesanan' using errcode = '23514';
  end if;
  return new;
end;
$function$;
create trigger enforce_order_status_workflow before update of order_status on public.orders for each row execute function public.enforce_order_status_workflow();

create function public.log_order_status_event() returns trigger language plpgsql security definer set search_path to '' as $function$
begin
  if tg_op = 'INSERT' then
    insert into public.order_status_events (order_id, cafe_id, from_status, to_status, changed_by, created_at)
    values (new.id, new.cafe_id, null, new.order_status, (select auth.uid()), new.created_at);
  elsif new.order_status is distinct from old.order_status then
    insert into public.order_status_events (order_id, cafe_id, from_status, to_status, note, changed_by)
    values (new.id, new.cafe_id, old.order_status, new.order_status,
      case when new.order_status = 'cancelled' then new.cancel_reason end, (select auth.uid()));
  end if;
  return null;
end;
$function$;
create trigger log_order_status_event after insert or update of order_status on public.orders for each row execute function public.log_order_status_event();

create function public.set_order_item_snapshot_fields() returns trigger language plpgsql set search_path to '' as $function$
begin
  new.price := coalesce(new.price, new.unit_price);
  new.unit_price := coalesce(new.unit_price, new.price);
  if new.price is null then
    raise exception 'An order item must have a server-verified unit price' using errcode = '23502';
  end if;
  select o.cafe_id into new.cafe_id from public.orders as o where o.id = new.order_id;
  if not found then
    raise exception 'Order not found for order item' using errcode = '23503';
  end if;
  new.subtotal := new.price * new.quantity;
  return new;
end;
$function$;
create trigger set_order_item_snapshot_fields before insert or update of order_id, price, quantity on public.order_items for each row execute function public.set_order_item_snapshot_fields();

create function public.update_order_total() returns trigger language plpgsql as $function$
begin
  update public.orders
  set total_amount = (select coalesce(sum(subtotal), 0) from public.order_items where order_id = new.order_id),
      updated_at = now()
  where id = new.order_id;
  return new;
end;
$function$;
create trigger trg_update_order_total after insert or delete or update on public.order_items for each row execute function public.update_order_total();

-- Helper peran (versi file 02; file 04 menambah is_active)
create function public.is_cafe_member(p_cafe_id uuid, p_roles text[] default array['owner', 'staff'])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles as p where p.id = (select auth.uid()) and p.cafe_id = p_cafe_id and p.role = any (p_roles));
$$;

create function public.staff_mark_order_paid(p_order_id uuid, p_method text) returns public.orders
language plpgsql security definer set search_path to '' as $function$
declare
  v_order public.orders%rowtype;
  v_now timestamptz := now();
begin
  if (select auth.uid()) is null then raise exception 'Login diperlukan' using errcode = '28000'; end if;
  if p_method is null or p_method not in ('cash', 'qris', 'bank_transfer', 'ewallet') then
    raise exception 'Metode pembayaran tidak dikenal' using errcode = '22023';
  end if;
  select * into v_order from public.orders as o where o.id = p_order_id for update;
  if not found then raise exception 'Pesanan tidak ditemukan' using errcode = 'P0002'; end if;
  if not public.is_cafe_member(v_order.cafe_id) then
    raise exception 'Hanya staff atau owner kafe ini yang bisa menandai lunas' using errcode = '42501';
  end if;
  if v_order.order_status = 'cancelled' then
    raise exception 'Pesanan yang dibatalkan tidak bisa ditandai lunas' using errcode = '22023';
  end if;
  if v_order.payment_status = 'paid' then return v_order; end if;
  insert into public.payments (order_id, method, payment_method, status, payment_status, amount, paid_at)
  values (v_order.id, p_method, p_method, 'paid', 'paid', v_order.total_amount, v_now);
  update public.orders set payment_status = 'paid', payment_method = p_method, paid_at = v_now, updated_at = v_now
  where id = v_order.id returning * into v_order;
  insert into public.order_status_events (order_id, cafe_id, event_type, to_status, note, changed_by, created_at)
  values (v_order.id, v_order.cafe_id, 'payment', 'paid', p_method, (select auth.uid()), v_now);
  return v_order;
end;
$function$;

create function public.staff_cancel_order(p_order_id uuid, p_reason text) returns public.orders
language plpgsql security definer set search_path to '' as $function$
declare
  v_order public.orders%rowtype;
  v_reason text := nullif(trim(p_reason), '');
begin
  if (select auth.uid()) is null then raise exception 'Login diperlukan' using errcode = '28000'; end if;
  if v_reason is null then raise exception 'Alasan pembatalan wajib diisi' using errcode = '22023'; end if;
  select * into v_order from public.orders as o where o.id = p_order_id for update;
  if not found then raise exception 'Pesanan tidak ditemukan' using errcode = 'P0002'; end if;
  if not public.is_cafe_member(v_order.cafe_id) then
    raise exception 'Hanya staff atau owner kafe ini yang bisa membatalkan pesanan' using errcode = '42501';
  end if;
  if v_order.order_status not in ('pending', 'confirmed', 'preparing', 'ready') then
    raise exception 'Pesanan berstatus % tidak bisa dibatalkan', v_order.order_status using errcode = '22023';
  end if;
  update public.orders set order_status = 'cancelled', cancel_reason = v_reason, cancelled_at = now(), updated_at = now()
  where id = v_order.id returning * into v_order;
  return v_order;
end;
$function$;

-- create_order versi live (dipakai app customer)
create function public.create_order(p_cafe_id uuid, p_items jsonb, p_payment_method text default null, p_notes text default null)
returns uuid language plpgsql security definer set search_path to '' as $function$
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
begin
  if v_customer_id is null then raise exception 'Authentication is required to place an order' using errcode = '28000'; end if;
  if not exists (select 1 from public.profiles as p where p.id = v_customer_id and p.role = 'customer' and p.cafe_id is null) then
    raise exception 'Only customer accounts can place orders' using errcode = '42501';
  end if;
  perform 1 from public.cafes as c where c.id = p_cafe_id for update;
  select coalesce(max(nullif(regexp_replace(o.order_number::text, '[^0-9]', '', 'g'), '')::bigint), 0) + 1
  into v_order_number from public.orders as o where o.cafe_id = p_cafe_id;
  insert into public.orders (cafe_id, customer_id, order_number, total_amount, order_status, payment_status, payment_method, notes)
  values (p_cafe_id, v_customer_id, v_order_number, 0, 'pending', 'unpaid', p_payment_method, nullif(trim(p_notes), ''))
  returning id into v_order_id;
  for v_item in select value from jsonb_array_elements(p_items) as items(value) loop
    v_product_id := (v_item ->> 'product_id')::uuid;
    v_quantity := (v_item ->> 'quantity')::integer;
    select p.name, p.price into v_product_name, v_price from public.products as p
    where p.id = v_product_id and p.cafe_id = p_cafe_id and p.is_available for share;
    if not found then raise exception 'Product % is unavailable for this cafe', v_product_id using errcode = '22023'; end if;
    insert into public.order_items (cafe_id, order_id, product_id, product_name, price, unit_price, quantity)
    values (p_cafe_id, v_order_id, v_product_id, v_product_name, v_price, v_price, v_quantity);
    v_total := v_total + (v_price * v_quantity);
  end loop;
  update public.orders set total_amount = v_total where id = v_order_id;
  return v_order_id;
end;
$function$;

-- Hak akses & RLS (ringkas, setara live)
alter table public.cafes enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payments enable row level security;
alter table public.profiles enable row level security;
grant select on all tables in schema public to anon, authenticated;
create policy "read cafes" on public.cafes for select using (true);
create policy "read products" on public.products for select using (true);
create policy "read own profile" on public.profiles for select using (id = auth.uid());
grant update (order_status) on public.orders to authenticated;
create policy "Customers and cafe staff can view orders" on public.orders for select to authenticated using (
  customer_id = auth.uid() or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = any (array['owner', 'staff']) and p.cafe_id = orders.cafe_id)
);
create policy "Cafe staff can update order status" on public.orders for update to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = any (array['owner', 'staff']) and p.cafe_id = orders.cafe_id))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = any (array['owner', 'staff']) and p.cafe_id = orders.cafe_id));
create policy "Customers and cafe staff can view order items" on public.order_items for select to authenticated using (
  exists (select 1 from public.orders o where o.id = order_items.order_id and (o.customer_id = auth.uid()
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = any (array['owner', 'staff']) and p.cafe_id = o.cafe_id)))
);
create policy "Customers and cafe staff can view payments" on public.payments for select to authenticated using (
  exists (select 1 from public.orders o where o.id = payments.order_id and (o.customer_id = auth.uid()
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = any (array['owner', 'staff']) and p.cafe_id = o.cafe_id)))
);
