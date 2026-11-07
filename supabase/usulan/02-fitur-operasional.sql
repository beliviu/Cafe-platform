-- =====================================================================
-- 02 · FITUR OPERASIONAL: lunas, batal, nomor antrean, timeline status,
--      toggle produk habis untuk staff, info kafe, daftar tim
-- Jalankan manual di Supabase SQL Editor SETELAH 01-tutup-celah-profil.sql.
-- Semua dalam satu transaksi: kalau ada error, tidak ada yang berubah.
--
-- Data yang tersentuh:
--   - Menambah kolom baru (nilai lama tidak diubah).
--   - Bagian F mengisi kolom BARU orders.queue_number untuk pesanan lama
--     (nomor urut per hari WIB). Kolom lain tidak diubah. Boleh dihapus
--     bagian F kalau tidak mau; pesanan lama akan tampil dengan nomor #xxxx.
--   - Tidak ada DELETE / DROP TABLE / TRUNCATE.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- A. Kolom baru
-- ---------------------------------------------------------------------
alter table public.orders
  add column if not exists queue_number integer,
  add column if not exists paid_at timestamptz,
  add column if not exists cancel_reason text,
  add column if not exists cancelled_at timestamptz;

alter table public.cafes
  add column if not exists description text,
  add column if not exists opening_hours jsonb,
  add column if not exists accepted_payment_methods text[] not null
    default array['cash', 'qris']::text[];

create index if not exists orders_cafe_created_at_idx
  on public.orders (cafe_id, created_at desc);

-- ---------------------------------------------------------------------
-- B. Helper peran (mandiri, tidak bergantung enum app_role)
-- ---------------------------------------------------------------------
create or replace function public.is_cafe_member(
  p_cafe_id uuid,
  p_roles text[] default array['owner', 'staff']
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
      and p.cafe_id = p_cafe_id
      and p.role = any (p_roles)
  );
$$;

revoke all on function public.is_cafe_member(uuid, text[]) from public, anon;
grant execute on function public.is_cafe_member(uuid, text[]) to authenticated;

-- ---------------------------------------------------------------------
-- C. Nomor antrean harian (A-001, A-002, … reset tiap hari WIB)
-- ---------------------------------------------------------------------
create or replace function public.assign_order_queue_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day date := (coalesce(new.created_at, now()) at time zone 'Asia/Jakarta')::date;
begin
  if new.queue_number is null then
    perform pg_advisory_xact_lock(hashtextextended(new.cafe_id::text || ':' || v_day::text, 0));

    select coalesce(max(o.queue_number), 0) + 1
    into new.queue_number
    from public.orders as o
    where o.cafe_id = new.cafe_id
      and o.created_at >= (v_day::timestamp at time zone 'Asia/Jakarta')
      and o.created_at < ((v_day + 1)::timestamp at time zone 'Asia/Jakarta');
  end if;
  return new;
end;
$$;

revoke all on function public.assign_order_queue_number() from public, anon, authenticated;

drop trigger if exists assign_order_queue_number on public.orders;
create trigger assign_order_queue_number
  before insert on public.orders
  for each row
  execute function public.assign_order_queue_number();

-- ---------------------------------------------------------------------
-- D. Alur status: izinkan pembatalan (wajib lewat staff_cancel_order)
--    Urutan normal tetap: pending → confirmed → preparing → ready → completed
-- ---------------------------------------------------------------------
create or replace function public.enforce_order_status_workflow()
returns trigger
language plpgsql
set search_path = 'public'
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
    or (old.order_status in ('pending', 'confirmed', 'preparing', 'ready')
        and new.order_status = 'cancelled')
  ) then
    raise exception 'Perpindahan status pesanan tidak valid: % -> %',
      old.order_status, new.order_status
      using errcode = '23514';
  end if;

  -- Klien hanya bisa mengubah kolom order_status, jadi cancelled_at kosong
  -- berarti pembatalan tidak lewat RPC (alasan tidak tercatat) → tolak.
  if new.order_status = 'cancelled' and new.cancelled_at is null then
    raise exception 'Gunakan fungsi staff_cancel_order untuk membatalkan pesanan'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- E. Riwayat status (timeline + siapa yang memproses)
-- ---------------------------------------------------------------------
create table if not exists public.order_status_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders (id) on delete cascade,
  cafe_id uuid not null references public.cafes (id) on delete cascade,
  event_type text not null default 'status'
    check (event_type in ('status', 'payment')),
  from_status text,
  to_status text not null,
  note text,
  changed_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists order_status_events_order_idx
  on public.order_status_events (order_id, created_at);
create index if not exists order_status_events_cafe_idx
  on public.order_status_events (cafe_id, created_at desc);

alter table public.order_status_events enable row level security;
revoke all on public.order_status_events from anon, authenticated;
grant select on public.order_status_events to authenticated;

drop policy if exists "Order participants can view status events" on public.order_status_events;
create policy "Order participants can view status events"
  on public.order_status_events for select
  to authenticated
  using (
    exists (
      select 1
      from public.orders as o
      where o.id = order_status_events.order_id
        and (o.customer_id = (select auth.uid()) or public.is_cafe_member(o.cafe_id))
    )
  );

create or replace function public.log_order_status_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.order_status_events (order_id, cafe_id, from_status, to_status, changed_by, created_at)
    values (new.id, new.cafe_id, null, new.order_status, (select auth.uid()), new.created_at);
  elsif new.order_status is distinct from old.order_status then
    insert into public.order_status_events (order_id, cafe_id, from_status, to_status, note, changed_by)
    values (
      new.id,
      new.cafe_id,
      old.order_status,
      new.order_status,
      case when new.order_status = 'cancelled' then new.cancel_reason end,
      (select auth.uid())
    );
  end if;
  return null;
end;
$$;

revoke all on function public.log_order_status_event() from public, anon, authenticated;

drop trigger if exists log_order_status_event on public.orders;
create trigger log_order_status_event
  after insert or update of order_status on public.orders
  for each row
  execute function public.log_order_status_event();

-- ---------------------------------------------------------------------
-- G. Tandai lunas (staff & owner)
-- ---------------------------------------------------------------------
create or replace function public.staff_mark_order_paid(p_order_id uuid, p_method text)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_now timestamptz := now();
begin
  if (select auth.uid()) is null then
    raise exception 'Login diperlukan' using errcode = '28000';
  end if;

  if p_method is null or p_method not in ('cash', 'qris', 'bank_transfer', 'ewallet') then
    raise exception 'Metode pembayaran tidak dikenal' using errcode = '22023';
  end if;

  select * into v_order from public.orders as o where o.id = p_order_id for update;
  if not found then
    raise exception 'Pesanan tidak ditemukan' using errcode = 'P0002';
  end if;

  if not public.is_cafe_member(v_order.cafe_id) then
    raise exception 'Hanya staff atau owner kafe ini yang bisa menandai lunas' using errcode = '42501';
  end if;

  if v_order.order_status = 'cancelled' then
    raise exception 'Pesanan yang dibatalkan tidak bisa ditandai lunas' using errcode = '22023';
  end if;

  if v_order.payment_status = 'paid' then
    return v_order; -- idempoten: klik ganda tidak membuat pembayaran dobel
  end if;

  insert into public.payments (order_id, method, payment_method, status, payment_status, amount, paid_at)
  values (v_order.id, p_method, p_method, 'paid', 'paid', v_order.total_amount, v_now);

  update public.orders
  set payment_status = 'paid',
      payment_method = p_method,
      paid_at = v_now,
      updated_at = v_now
  where id = v_order.id
  returning * into v_order;

  insert into public.order_status_events (order_id, cafe_id, event_type, to_status, note, changed_by, created_at)
  values (v_order.id, v_order.cafe_id, 'payment', 'paid', p_method, (select auth.uid()), v_now);

  return v_order;
end;
$$;

revoke all on function public.staff_mark_order_paid(uuid, text) from public, anon;
grant execute on function public.staff_mark_order_paid(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- H. Batalkan pesanan dengan alasan (staff & owner)
-- ---------------------------------------------------------------------
create or replace function public.staff_cancel_order(p_order_id uuid, p_reason text)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_reason text := nullif(trim(p_reason), '');
begin
  if (select auth.uid()) is null then
    raise exception 'Login diperlukan' using errcode = '28000';
  end if;

  if v_reason is null then
    raise exception 'Alasan pembatalan wajib diisi' using errcode = '22023';
  end if;
  if length(v_reason) > 300 then
    raise exception 'Alasan pembatalan maksimal 300 karakter' using errcode = '22023';
  end if;

  select * into v_order from public.orders as o where o.id = p_order_id for update;
  if not found then
    raise exception 'Pesanan tidak ditemukan' using errcode = 'P0002';
  end if;

  if not public.is_cafe_member(v_order.cafe_id) then
    raise exception 'Hanya staff atau owner kafe ini yang bisa membatalkan pesanan' using errcode = '42501';
  end if;

  if v_order.order_status not in ('pending', 'confirmed', 'preparing', 'ready') then
    raise exception 'Pesanan berstatus % tidak bisa dibatalkan', v_order.order_status using errcode = '22023';
  end if;

  update public.orders
  set order_status = 'cancelled',
      cancel_reason = v_reason,
      cancelled_at = now(),
      updated_at = now()
  where id = v_order.id
  returning * into v_order;

  return v_order;
end;
$$;

revoke all on function public.staff_cancel_order(uuid, text) from public, anon;
grant execute on function public.staff_cancel_order(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- I. Toggle "produk habis" untuk staff (hanya kolom is_available)
-- ---------------------------------------------------------------------
create or replace function public.staff_set_product_availability(p_product_id uuid, p_is_available boolean)
returns public.products
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product public.products%rowtype;
begin
  if p_is_available is null then
    raise exception 'Status ketersediaan wajib diisi' using errcode = '22023';
  end if;

  select * into v_product from public.products as p where p.id = p_product_id for update;
  if not found then
    raise exception 'Produk tidak ditemukan' using errcode = 'P0002';
  end if;

  if not public.is_cafe_member(v_product.cafe_id) then
    raise exception 'Hanya staff atau owner kafe ini yang bisa mengubah ketersediaan' using errcode = '42501';
  end if;

  update public.products
  set is_available = p_is_available
  where id = v_product.id
  returning * into v_product;

  return v_product;
end;
$$;

revoke all on function public.staff_set_product_availability(uuid, boolean) from public, anon;
grant execute on function public.staff_set_product_availability(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- J. Daftar tim kafe (owner & staff) — untuk Pengaturan & "diproses oleh"
-- ---------------------------------------------------------------------
create or replace function public.cafe_team_members(p_cafe_id uuid)
returns table (id uuid, full_name text, role text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.full_name, p.role, p.created_at
  from public.profiles as p
  where p.cafe_id = p_cafe_id
    and p.role in ('owner', 'staff')
    and public.is_cafe_member(p_cafe_id)
  order by p.role, p.full_name;
$$;

revoke all on function public.cafe_team_members(uuid) from public, anon;
grant execute on function public.cafe_team_members(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- K. Owner boleh mengubah info kafe (bukan id / is_active)
-- ---------------------------------------------------------------------
revoke insert, update, delete, truncate on public.cafes from anon, authenticated;
grant update (name, description, address, phone, opening_hours, accepted_payment_methods)
  on public.cafes to authenticated;

drop policy if exists "Owners can update their cafe" on public.cafes;
create policy "Owners can update their cafe"
  on public.cafes for update
  to authenticated
  using (public.is_cafe_member(id, array['owner']))
  with check (public.is_cafe_member(id, array['owner']));

-- ---------------------------------------------------------------------
-- F. Isi nomor antrean untuk pesanan lama (hanya kolom baru queue_number)
--    Hapus bagian ini kalau tidak ingin menyentuh baris lama sama sekali.
-- ---------------------------------------------------------------------
with numbered as (
  select
    o.id,
    row_number() over (
      partition by o.cafe_id, (o.created_at at time zone 'Asia/Jakarta')::date
      order by o.created_at, o.id
    ) as rn
  from public.orders as o
  where o.queue_number is null
)
update public.orders as o
set queue_number = numbered.rn
from numbered
where o.id = numbered.id;

notify pgrst, 'reload schema';

commit;

-- Verifikasi: harus muncul 7 fungsi + 7 kolom
select 'function' as kind, p.proname as name
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'is_cafe_member', 'assign_order_queue_number', 'log_order_status_event',
    'staff_mark_order_paid', 'staff_cancel_order', 'staff_set_product_availability',
    'cafe_team_members'
  )
union all
select 'column', table_name || '.' || column_name
from information_schema.columns
where table_schema = 'public'
  and (
    (table_name = 'orders' and column_name in ('queue_number', 'paid_at', 'cancel_reason', 'cancelled_at'))
    or (table_name = 'cafes' and column_name in ('description', 'opening_hours', 'accepted_payment_methods'))
  )
order by 1, 2;
