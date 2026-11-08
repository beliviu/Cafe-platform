-- =====================================================================
-- 06 · PESANAN v2 & POS (Fase 2 roadmap V2)
--   A. Pengaturan: batas diskon staff, cetak tiket dapur/struk
--   B. Pesanan: sumber (app/kasir), tipe & meja, rincian subtotal/diskon/service/pajak/
--      pembulatan, tamu walk-in, anti-dobel (idempotency key), jumlah dibayar & direfund
--   C. Varian per item pesanan (snapshot nama & harga)
--   D. Pembayaran: split, referensi, pencatat, sesi kasir, uang diterima & kembalian
--   E. Stok: dicadangkan saat pesanan dibuat, dipotong saat selesai, dilepas saat batal;
--      ketersediaan produk (HABIS) untuk app & kasir
--   F. Sesi kasir: buka, kas masuk/keluar, tutup dengan selisih, serah terima shift
--   G. place_order — satu jalur pesanan untuk app & kasir; create_order jadi pembungkusnya
--   H. Pembayaran kasir (split, kembalian); staff_mark_order_paid diperbarui
--   I. Pesanan ditahan (hold)
--   J. Refund: diajukan staff, disetujui owner, uang & stok kembali
--
-- Jalankan manual di Supabase SQL Editor SETELAH 05-inventori-supplier.sql.
-- Semua dalam satu transaksi: kalau ada error, tidak ada yang berubah.
--
-- Dampak ke data yang sudah ada:
--   - orders: kolom BARU dengan nilai bawaan (source = 'app', diskon/pajak/service = 0,
--     pricing_version = 1 untuk pesanan lama). Satu-satunya pengisian data lama:
--     paid_amount = total_amount untuk pesanan yang sudah lunas (kolom baru).
--     Total, status, dan nomor pesanan lama TIDAK diubah.
--   - payments: kolom BARU; pembayaran simulasi lama ditandai verification = 'demo'.
--   - Trigger update_order_total: pesanan lama tetap dihitung seperti sekarang;
--     pesanan baru (pricing_version 2) tidak ditimpa sehingga pajak/diskon aman.
--   - create_order (dipakai app): kini memanggil place_order. App lama tetap jalan tanpa
--     build ulang; nomor pesanan memakai UUID bawaan (memperbaiki bentrok antar kafe).
--   - staff_mark_order_paid: tetap sama untuk papan staff, kini mencatat sisa tagihan,
--     pencatat, dan sesi kasir yang terbuka.
--   - Stok hanya dicadangkan bila pelacakan stok aktif (file 05).
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0. Pemeriksaan awal
-- ---------------------------------------------------------------------
do $$
begin
  if to_regclass('public.ingredients') is null or to_regclass('public.recipe_items') is null then
    raise exception 'File 05-inventori-supplier.sql belum dijalankan. Jalankan file 05 dulu.';
  end if;
  if to_regclass('public.cafe_tables') is null or to_regclass('public.product_options') is null then
    raise exception 'File 04-owner-dashboard.sql belum dijalankan.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- A. Pengaturan
-- ---------------------------------------------------------------------
alter table public.cafe_settings
  add column if not exists staff_max_discount_pct numeric(5, 2) not null default 0,
  add column if not exists print_kitchen_ticket boolean not null default true,
  add column if not exists auto_print_receipt boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.cafe_settings'::regclass and conname = 'cafe_settings_staff_discount_range') then
    alter table public.cafe_settings add constraint cafe_settings_staff_discount_range check (staff_max_discount_pct between 0 and 100);
  end if;
end;
$$;
grant update (staff_max_discount_pct, print_kitchen_ticket, auto_print_receipt) on public.cafe_settings to authenticated;

-- ---------------------------------------------------------------------
-- F (tabel dulu, dirujuk pesanan & pembayaran). Sesi kasir
-- ---------------------------------------------------------------------
create table if not exists public.cashier_sessions (
  id uuid primary key default gen_random_uuid(),
  cafe_id uuid not null references public.cafes (id) on delete cascade,
  opened_by uuid not null references auth.users (id),
  opened_at timestamptz not null default now(),
  opening_cash numeric(12, 2) not null check (opening_cash >= 0),
  opening_note text check (opening_note is null or char_length(opening_note) <= 300),
  status text not null default 'open' check (status in ('open', 'closed')),
  closed_at timestamptz,
  closed_by uuid references auth.users (id),
  counted_cash numeric(12, 2) check (counted_cash is null or counted_cash >= 0),
  expected_cash numeric(12, 2),
  difference numeric(12, 2),
  closing_note text check (closing_note is null or char_length(closing_note) <= 300),
  handover_to uuid references auth.users (id),
  handover_note text check (handover_note is null or char_length(handover_note) <= 500),
  active_orders_at_close integer
);
create unique index if not exists cashier_sessions_one_open on public.cashier_sessions (cafe_id, opened_by) where status = 'open';
create index if not exists cashier_sessions_cafe_idx on public.cashier_sessions (cafe_id, opened_at desc);

create table if not exists public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  cafe_id uuid not null references public.cafes (id) on delete cascade,
  session_id uuid not null references public.cashier_sessions (id) on delete cascade,
  direction text not null check (direction in ('in', 'out')),
  amount numeric(12, 2) not null check (amount > 0),
  reason text not null check (char_length(reason) between 3 and 200),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists cash_movements_session_idx on public.cash_movements (session_id, created_at);

-- ---------------------------------------------------------------------
-- B. Pesanan
-- ---------------------------------------------------------------------
alter table public.orders
  add column if not exists source text not null default 'app',
  add column if not exists order_type text,
  add column if not exists table_id uuid references public.cafe_tables (id) on delete set null,
  add column if not exists table_label text,
  add column if not exists guest_name text,
  add column if not exists subtotal_amount numeric(12, 2),
  add column if not exists discount_amount numeric(12, 2) not null default 0,
  add column if not exists discount_reason text,
  add column if not exists discount_by uuid,
  add column if not exists service_charge_amount numeric(12, 2) not null default 0,
  add column if not exists tax_amount numeric(12, 2) not null default 0,
  add column if not exists tax_inclusive boolean not null default false,
  add column if not exists rounding_amount numeric(12, 2) not null default 0,
  add column if not exists paid_amount numeric(12, 2) not null default 0,
  add column if not exists refunded_amount numeric(12, 2) not null default 0,
  add column if not exists pricing_version smallint not null default 1,
  add column if not exists idempotency_key text,
  add column if not exists created_by uuid,
  add column if not exists cashier_session_id uuid references public.cashier_sessions (id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.orders'::regclass and conname = 'orders_source_valid') then
    alter table public.orders add constraint orders_source_valid check (source in ('app', 'pos'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.orders'::regclass and conname = 'orders_order_type_valid') then
    alter table public.orders add constraint orders_order_type_valid check (order_type is null or order_type in ('dine_in', 'takeaway'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.orders'::regclass and conname = 'orders_amounts_valid') then
    alter table public.orders add constraint orders_amounts_valid check (
      discount_amount >= 0 and service_charge_amount >= 0 and tax_amount >= 0 and paid_amount >= 0 and refunded_amount >= 0
    );
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.orders'::regclass and conname = 'orders_guest_name_length') then
    alter table public.orders add constraint orders_guest_name_length check (guest_name is null or char_length(guest_name) <= 60);
  end if;
end;
$$;

create unique index if not exists orders_idempotency_key on public.orders (cafe_id, idempotency_key) where idempotency_key is not null;
create index if not exists orders_cafe_status_idx on public.orders (cafe_id, order_status, created_at desc);
create index if not exists orders_cashier_session_idx on public.orders (cashier_session_id) where cashier_session_id is not null;

-- Satu-satunya pengisian data lama: jumlah dibayar untuk pesanan yang sudah lunas
update public.orders set paid_amount = total_amount where payment_status = 'paid' and paid_amount = 0;

-- Pesanan v2 menghitung total sendiri (termasuk pajak/diskon) — trigger lama tidak boleh menimpa
create or replace function public.update_order_total()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_order_id uuid := coalesce(new.order_id, old.order_id);
begin
  if exists (select 1 from public.orders o where o.id = v_order_id and o.pricing_version >= 2) then
    return null;
  end if;
  update public.orders
  set total_amount = (select coalesce(sum(i.subtotal), 0) from public.order_items i where i.order_id = v_order_id),
      updated_at = now()
  where id = v_order_id;
  return null;
end;
$$;

-- ---------------------------------------------------------------------
-- C. Varian per item pesanan
-- ---------------------------------------------------------------------
create table if not exists public.order_item_options (
  id uuid primary key default gen_random_uuid(),
  cafe_id uuid not null references public.cafes (id) on delete cascade,
  order_id uuid not null references public.orders (id) on delete cascade,
  order_item_id uuid not null references public.order_items (id) on delete cascade,
  option_id uuid references public.product_options (id) on delete set null,
  group_name text not null,
  option_name text not null,
  price_delta numeric(12, 2) not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists order_item_options_item_idx on public.order_item_options (order_item_id);
create index if not exists order_item_options_order_idx on public.order_item_options (order_id);

-- ---------------------------------------------------------------------
-- D. Pembayaran
-- ---------------------------------------------------------------------
alter table public.payments
  add column if not exists reference text,
  add column if not exists recorded_by uuid,
  add column if not exists cashier_session_id uuid references public.cashier_sessions (id) on delete set null,
  add column if not exists verification text not null default 'manual',
  add column if not exists tendered_amount numeric(12, 2),
  add column if not exists change_amount numeric(12, 2) not null default 0,
  add column if not exists refund_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.payments'::regclass and conname = 'payments_verification_valid') then
    alter table public.payments add constraint payments_verification_valid check (verification in ('manual', 'gateway', 'demo'));
  end if;
end;
$$;
create index if not exists payments_order_idx on public.payments (order_id);
create index if not exists payments_session_idx on public.payments (cashier_session_id) where cashier_session_id is not null;

update public.payments set verification = 'demo' where payment_method = 'simulated_demo' and verification = 'manual';

-- ---------------------------------------------------------------------
-- E. Stok: cadangan per pesanan
-- ---------------------------------------------------------------------
alter table public.ingredients add column if not exists reserved numeric(14, 3) not null default 0;

create table if not exists public.stock_reservations (
  id bigint generated always as identity primary key,
  cafe_id uuid not null references public.cafes (id) on delete cascade,
  order_id uuid not null references public.orders (id) on delete cascade,
  order_item_id uuid references public.order_items (id) on delete cascade,
  product_id uuid,
  ingredient_id uuid not null references public.ingredients (id),
  quantity numeric(14, 3) not null check (quantity > 0),
  created_at timestamptz not null default now(),
  released_at timestamptz,
  consumed_at timestamptz
);
create index if not exists stock_reservations_order_idx on public.stock_reservations (order_id);
create index if not exists stock_reservations_open_idx on public.stock_reservations (ingredient_id) where released_at is null and consumed_at is null;

-- Jenis mutasi baru: 'refund' (bahan kembali karena refund)
do $$
declare
  v_name text;
begin
  for v_name in
    select conname from pg_constraint
    where conrelid = 'public.stock_movements'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%movement_type%'
  loop
    execute format('alter table public.stock_movements drop constraint %I', v_name);
  end loop;
  alter table public.stock_movements add constraint stock_movements_type_valid check (movement_type in (
    'opening', 'purchase', 'sale', 'adjustment', 'opname', 'waste', 'damaged', 'expired', 'usage', 'return', 'refund'
  ));
end;
$$;

-- Kebutuhan bahan per item pesanan: resep dasar + tambahan varian yang dipilih
create or replace function public.inv_order_item_needs(p_order_id uuid)
returns table (order_item_id uuid, product_id uuid, ingredient_id uuid, quantity numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select oi.id, oi.product_id, r.ingredient_id, round(sum(r.quantity) * oi.quantity, 3)
  from public.order_items oi
  join public.recipe_items r
    on r.product_id = oi.product_id
   and (r.option_id is null or r.option_id in (
     select oo.option_id from public.order_item_options oo where oo.order_item_id = oi.id and oo.option_id is not null
   ))
  where oi.order_id = p_order_id and oi.quantity > 0
  group by oi.id, oi.product_id, r.ingredient_id, oi.quantity;
$$;
revoke all on function public.inv_order_item_needs(uuid) from public, anon, authenticated;

-- Cadangkan stok untuk pesanan (dipanggil place_order). Gagal = seluruh pesanan batal.
create or replace function public.inv_reserve_order(p_order_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cafe uuid;
  v_need record;
  v_ing public.ingredients%rowtype;
  v_products text;
  v_count integer := 0;
begin
  select o.cafe_id into v_cafe from public.orders o where o.id = p_order_id;
  if not exists (select 1 from public.cafe_settings s where s.cafe_id = v_cafe and s.inventory_tracking) then
    return 0;
  end if;

  for v_need in
    select n.ingredient_id, sum(n.quantity) as quantity
    from public.inv_order_item_needs(p_order_id) n
    group by n.ingredient_id
    order by n.ingredient_id
  loop
    select * into v_ing from public.ingredients where id = v_need.ingredient_id for update;
    if v_ing.on_hand - v_ing.reserved < v_need.quantity then
      select string_agg(distinct oi.product_name, ', ') into v_products
      from public.inv_order_item_needs(p_order_id) n
      join public.order_items oi on oi.id = n.order_item_id
      where n.ingredient_id = v_ing.id;
      raise exception 'Stok tidak cukup untuk %. Kurangi jumlah atau pilih menu lain.', coalesce(v_products, v_ing.name)
        using errcode = 'P0001', hint = 'stock_insufficient';
    end if;
    update public.ingredients set reserved = reserved + v_need.quantity where id = v_ing.id;
    v_count := v_count + 1;
  end loop;

  insert into public.stock_reservations (cafe_id, order_id, order_item_id, product_id, ingredient_id, quantity)
  select v_cafe, p_order_id, n.order_item_id, n.product_id, n.ingredient_id, n.quantity
  from public.inv_order_item_needs(p_order_id) n
  where v_count > 0;
  return v_count;
end;
$$;
revoke all on function public.inv_reserve_order(uuid) from public, anon, authenticated;

-- Lepas cadangan (pesanan batal atau pelacakan dimatikan)
create or replace function public.inv_release_order(p_order_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_res record;
  v_count integer := 0;
begin
  for v_res in
    select r.id, r.ingredient_id, r.quantity
    from public.stock_reservations r
    where r.order_id = p_order_id and r.released_at is null and r.consumed_at is null
    order by r.ingredient_id
    for update
  loop
    update public.ingredients set reserved = greatest(reserved - v_res.quantity, 0) where id = v_res.ingredient_id;
    update public.stock_reservations set released_at = now() where id = v_res.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.inv_release_order(uuid) from public, anon, authenticated;

-- Pemakaian saat pesanan selesai: pakai cadangan bila ada; pesanan lama tanpa cadangan → resep (dasar + varian)
create or replace function public.inv_consume_order(p_order_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cafe uuid;
  v_line record;
  v_count integer := 0;
begin
  select o.cafe_id into v_cafe from public.orders o where o.id = p_order_id;
  if v_cafe is null then
    return 0;
  end if;
  if exists (select 1 from public.stock_movements m where m.order_id = p_order_id and m.movement_type = 'sale') then
    return 0;
  end if;

  if exists (select 1 from public.stock_reservations r where r.order_id = p_order_id and r.released_at is null and r.consumed_at is null) then
    for v_line in
      select r.id, r.order_item_id, r.product_id, r.ingredient_id, r.quantity
      from public.stock_reservations r
      where r.order_id = p_order_id and r.released_at is null and r.consumed_at is null
      order by r.ingredient_id, r.id
      for update
    loop
      perform public.inv_apply_movement(
        v_line.ingredient_id, 'sale', -v_line.quantity, null, null, null,
        jsonb_build_object('order_id', p_order_id, 'order_item_id', v_line.order_item_id, 'product_id', v_line.product_id),
        true
      );
      update public.ingredients set reserved = greatest(reserved - v_line.quantity, 0) where id = v_line.ingredient_id;
      update public.stock_reservations set consumed_at = now() where id = v_line.id;
      v_count := v_count + 1;
    end loop;
    return v_count;
  end if;

  if not exists (select 1 from public.cafe_settings s where s.cafe_id = v_cafe and s.inventory_tracking) then
    return 0;
  end if;
  perform 1 from public.ingredients i
  where i.id in (select n.ingredient_id from public.inv_order_item_needs(p_order_id) n)
  order by i.id
  for update;
  for v_line in
    select n.order_item_id, n.product_id, n.ingredient_id, n.quantity
    from public.inv_order_item_needs(p_order_id) n
    order by n.ingredient_id, n.order_item_id
  loop
    perform public.inv_apply_movement(
      v_line.ingredient_id, 'sale', -v_line.quantity, null, null, null,
      jsonb_build_object('order_id', p_order_id, 'order_item_id', v_line.order_item_id, 'product_id', v_line.product_id),
      true
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.inv_consume_order(uuid) from public, anon, authenticated;

create or replace function public.inv_on_order_cancelled()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform public.inv_release_order(new.id);
  exception when others then
    insert into public.inventory_sync_issues (cafe_id, order_id, message)
    values (new.cafe_id, new.id, left('Gagal melepas cadangan stok: ' || sqlerrm, 500));
  end;
  return null;
end;
$$;
revoke all on function public.inv_on_order_cancelled() from public, anon, authenticated;

drop trigger if exists inv_on_order_cancelled on public.orders;
create trigger inv_on_order_cancelled
  after update of order_status on public.orders
  for each row
  when (new.order_status = 'cancelled' and old.order_status is distinct from 'cancelled')
  execute function public.inv_on_order_cancelled();

-- Mematikan pelacakan melepas semua cadangan yang masih terbuka
create or replace function public.inventory_set_tracking(p_cafe_id uuid, p_enabled boolean)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_started timestamptz;
  v_order uuid;
begin
  perform public.inv_require_owner(p_cafe_id);
  update public.cafe_settings
  set inventory_tracking = coalesce(p_enabled, false),
      inventory_started_at = case
        when coalesce(p_enabled, false) then coalesce(case when inventory_tracking then inventory_started_at end, now())
        else null
      end
  where cafe_id = p_cafe_id
  returning inventory_started_at into v_started;
  if not found then
    raise exception 'Pengaturan kafe tidak ditemukan' using errcode = 'P0002';
  end if;
  if not coalesce(p_enabled, false) then
    for v_order in
      select distinct r.order_id from public.stock_reservations r
      where r.cafe_id = p_cafe_id and r.released_at is null and r.consumed_at is null
    loop
      perform public.inv_release_order(v_order);
    end loop;
  end if;
  return v_started;
end;
$$;
revoke all on function public.inventory_set_tracking(uuid, boolean) from public, anon;
grant execute on function public.inventory_set_tracking(uuid, boolean) to authenticated;

-- Ketersediaan produk untuk app & kasir. Jumlah porsi hanya terlihat oleh staff/owner.
create or replace function public.product_availability(p_cafe_id uuid)
returns table (product_id uuid, available boolean, reason text, portions numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_tracking boolean;
  v_member boolean := (select auth.uid()) is not null and public.is_cafe_member(p_cafe_id);
begin
  select coalesce(s.inventory_tracking, false) into v_tracking from public.cafe_settings s where s.cafe_id = p_cafe_id;
  return query
  with stock as (
    select r.product_id, min(floor(greatest(i.on_hand - i.reserved, 0) / r.quantity)) as portions
    from public.recipe_items r
    join public.ingredients i on i.id = r.ingredient_id
    where r.cafe_id = p_cafe_id and r.option_id is null and coalesce(v_tracking, false)
    group by r.product_id
  )
  select p.id,
         p.is_available and coalesce(s.portions, 1) >= 1,
         case when not p.is_available then 'manual' when coalesce(s.portions, 1) < 1 then 'stock' end,
         case when v_member then s.portions end
  from public.products p
  left join stock s on s.product_id = p.id
  where p.cafe_id = p_cafe_id;
end;
$$;
revoke all on function public.product_availability(uuid) from public;
grant execute on function public.product_availability(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- F. Sesi kasir (fungsi)
-- ---------------------------------------------------------------------
create or replace function public.cashier_open_session_of(p_cafe_id uuid, p_user uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.id from public.cashier_sessions s
  where s.cafe_id = p_cafe_id and s.opened_by = p_user and s.status = 'open'
  limit 1;
$$;
revoke all on function public.cashier_open_session_of(uuid, uuid) from public, anon, authenticated;

create or replace function public.cashier_open(p_cafe_id uuid, p_opening_cash numeric, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Login diperlukan' using errcode = '28000';
  end if;
  if not public.is_cafe_member(p_cafe_id) then
    raise exception 'Hanya staff atau owner kafe ini yang bisa membuka kasir' using errcode = '42501';
  end if;
  if p_opening_cash is null or p_opening_cash < 0 or p_opening_cash > 100000000 then
    raise exception 'Isi modal awal (boleh 0)' using errcode = '22023';
  end if;
  if public.cashier_open_session_of(p_cafe_id, (select auth.uid())) is not null then
    raise exception 'Anda masih punya sesi kasir yang terbuka. Tutup dulu sebelum membuka yang baru.' using errcode = '22023';
  end if;
  insert into public.cashier_sessions (cafe_id, opened_by, opening_cash, opening_note)
  values (p_cafe_id, (select auth.uid()), round(p_opening_cash, 2), public.inv_clean_text(p_note, 300))
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.cashier_open(uuid, numeric, text) from public, anon;
grant execute on function public.cashier_open(uuid, numeric, text) to authenticated;

create or replace function public.cashier_require_access(p_session_id uuid, p_require_open boolean)
returns public.cashier_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.cashier_sessions%rowtype;
begin
  select * into v_session from public.cashier_sessions where id = p_session_id;
  if not found then
    raise exception 'Sesi kasir tidak ditemukan' using errcode = 'P0002';
  end if;
  if not (
    (v_session.opened_by = (select auth.uid()) and public.is_cafe_member(v_session.cafe_id))
    or public.is_cafe_member(v_session.cafe_id, array['owner'])
  ) then
    raise exception 'Sesi kasir ini milik orang lain' using errcode = '42501';
  end if;
  if p_require_open and v_session.status <> 'open' then
    raise exception 'Sesi kasir sudah ditutup' using errcode = '22023';
  end if;
  return v_session;
end;
$$;
revoke all on function public.cashier_require_access(uuid, boolean) from public, anon, authenticated;

create or replace function public.cashier_cash_move(p_session_id uuid, p_direction text, p_amount numeric, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.cashier_sessions%rowtype;
  v_id uuid;
begin
  v_session := public.cashier_require_access(p_session_id, true);
  if p_direction not in ('in', 'out') then
    raise exception 'Arah kas tidak dikenal' using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > 100000000 then
    raise exception 'Nominal harus lebih dari 0' using errcode = '22023';
  end if;
  if char_length(coalesce(public.inv_clean_text(p_reason, 200), '')) < 3 then
    raise exception 'Tulis keterangan kas masuk/keluar' using errcode = '22023';
  end if;
  insert into public.cash_movements (cafe_id, session_id, direction, amount, reason)
  values (v_session.cafe_id, v_session.id, p_direction, round(p_amount, 2), public.inv_clean_text(p_reason, 200))
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.cashier_cash_move(uuid, text, numeric, text) from public, anon;
grant execute on function public.cashier_cash_move(uuid, text, numeric, text) to authenticated;

-- Ringkasan sesi: kas seharusnya = modal + tunai diterima + kas masuk − kas keluar − refund tunai
create or replace function public.cashier_summary(p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_session public.cashier_sessions%rowtype;
  v_cash_sales numeric := 0;
  v_cash_refunds numeric := 0;
  v_cash_in numeric := 0;
  v_cash_out numeric := 0;
  v_methods jsonb;
  v_orders integer;
  v_discounts numeric;
  v_active integer;
begin
  v_session := public.cashier_require_access(p_session_id, false);
  select coalesce(sum(p.amount) filter (where p.method = 'cash' and p.status = 'paid'), 0),
         coalesce(sum(p.amount) filter (where p.method = 'cash' and p.status = 'refunded'), 0)
  into v_cash_sales, v_cash_refunds
  from public.payments p where p.cashier_session_id = v_session.id;
  select coalesce(sum(m.amount) filter (where m.direction = 'in'), 0), coalesce(sum(m.amount) filter (where m.direction = 'out'), 0)
  into v_cash_in, v_cash_out
  from public.cash_movements m where m.session_id = v_session.id;
  select coalesce(jsonb_object_agg(x.method, x.total), '{}'::jsonb) into v_methods
  from (
    select p.method, sum(p.amount) as total from public.payments p
    where p.cashier_session_id = v_session.id and p.status = 'paid' group by p.method
  ) x;
  select count(*), coalesce(sum(o.discount_amount), 0) into v_orders, v_discounts
  from public.orders o where o.cashier_session_id = v_session.id and o.order_status <> 'cancelled';
  select count(*) into v_active from public.orders o
  where o.cafe_id = v_session.cafe_id and o.order_status in ('pending', 'confirmed', 'preparing', 'ready');

  return jsonb_build_object(
    'session_id', v_session.id,
    'status', v_session.status,
    'opening_cash', v_session.opening_cash,
    'cash_sales', v_cash_sales,
    'cash_refunds', v_cash_refunds,
    'cash_in', v_cash_in,
    'cash_out', v_cash_out,
    'expected_cash', v_session.opening_cash + v_cash_sales + v_cash_in - v_cash_out - v_cash_refunds,
    'by_method', v_methods,
    'orders', v_orders,
    'discounts', v_discounts,
    'active_orders', v_active,
    'counted_cash', v_session.counted_cash,
    'difference', v_session.difference
  );
end;
$$;
revoke all on function public.cashier_summary(uuid) from public, anon;
grant execute on function public.cashier_summary(uuid) to authenticated;

create or replace function public.cashier_close(
  p_session_id uuid,
  p_counted_cash numeric,
  p_note text default null,
  p_handover_to uuid default null,
  p_handover_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.cashier_sessions%rowtype;
  v_summary jsonb;
  v_expected numeric(12, 2);
begin
  v_session := public.cashier_require_access(p_session_id, true);
  perform 1 from public.cashier_sessions where id = p_session_id for update;
  if p_counted_cash is null or p_counted_cash < 0 or p_counted_cash > 100000000 then
    raise exception 'Isi jumlah uang tunai di laci' using errcode = '22023';
  end if;
  if p_handover_to is not null and not exists (
    select 1 from public.profiles p where p.id = p_handover_to and p.cafe_id = v_session.cafe_id and p.role in ('owner', 'staff')
  ) then
    raise exception 'Penerima serah terima bukan anggota tim kafe ini' using errcode = '22023';
  end if;
  v_summary := public.cashier_summary(p_session_id);
  v_expected := (v_summary ->> 'expected_cash')::numeric;
  if abs(round(p_counted_cash, 2) - v_expected) >= 0.01 and char_length(coalesce(public.inv_clean_text(p_note, 300), '')) < 3 then
    raise exception 'Ada selisih kas %. Tulis penjelasannya sebelum menutup.', to_char(round(p_counted_cash, 2) - v_expected, 'FM999G999G990') using errcode = '22023';
  end if;
  update public.cashier_sessions
  set status = 'closed', closed_at = now(), closed_by = (select auth.uid()),
      counted_cash = round(p_counted_cash, 2), expected_cash = v_expected,
      difference = round(p_counted_cash, 2) - v_expected,
      closing_note = public.inv_clean_text(p_note, 300),
      handover_to = p_handover_to, handover_note = public.inv_clean_text(p_handover_note, 500),
      active_orders_at_close = (v_summary ->> 'active_orders')::integer
  where id = p_session_id;
  return public.cashier_summary(p_session_id);
end;
$$;
revoke all on function public.cashier_close(uuid, numeric, text, uuid, text) from public, anon;
grant execute on function public.cashier_close(uuid, numeric, text, uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- G. place_order — satu jalur pesanan app & kasir
--   p_items = [{ product_id, quantity, notes?, option_ids?: [uuid] }]
--   p_discount (kasir) = { type: 'percent' | 'amount', value, reason }
-- ---------------------------------------------------------------------
create or replace function public.place_order(
  p_cafe_id uuid,
  p_items jsonb,
  p_source text default 'app',
  p_order_type text default null,
  p_table_id uuid default null,
  p_guest_name text default null,
  p_notes text default null,
  p_discount jsonb default null,
  p_payment_method text default null,
  p_idempotency_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_owner boolean;
  v_settings public.cafe_settings%rowtype;
  v_existing uuid;
  v_order_id uuid;
  v_item jsonb;
  v_product public.products%rowtype;
  v_qty integer;
  v_option_ids uuid[];
  v_final uuid[];
  v_group record;
  v_pick uuid;
  v_delta numeric(12, 2);
  v_label text;
  v_item_id uuid;
  v_subtotal numeric(12, 2) := 0;
  v_discount numeric(12, 2) := 0;
  v_discount_reason text;
  v_base numeric(12, 2);
  v_service numeric(12, 2) := 0;
  v_tax_base numeric(12, 2);
  v_tax numeric(12, 2) := 0;
  v_before numeric(12, 2);
  v_total numeric(12, 2);
  v_table public.cafe_tables%rowtype;
  v_order_type text := p_order_type;
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
begin
  if v_uid is null then
    raise exception 'Login diperlukan untuk membuat pesanan' using errcode = '28000';
  end if;
  if p_source not in ('app', 'pos') then
    raise exception 'Sumber pesanan tidak dikenal' using errcode = '22023';
  end if;
  if p_source = 'app' and not exists (
    select 1 from public.profiles p where p.id = v_uid and p.role = 'customer' and p.cafe_id is null
  ) then
    raise exception 'Hanya akun customer yang bisa memesan lewat aplikasi' using errcode = '42501';
  end if;
  if p_source = 'pos' and not public.is_cafe_member(p_cafe_id) then
    raise exception 'Hanya staff atau owner kafe ini yang bisa membuat pesanan kasir' using errcode = '42501';
  end if;
  v_is_owner := public.is_cafe_member(p_cafe_id, array['owner']);

  -- Anti-dobel: kunci sama → kembalikan pesanan yang sudah ada
  if v_key is not null then
    if char_length(v_key) not between 8 and 80 then
      raise exception 'Kunci pesanan tidak valid' using errcode = '22023';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(p_cafe_id::text || ':order:' || v_key, 0));
    select o.id into v_existing from public.orders o where o.cafe_id = p_cafe_id and o.idempotency_key = v_key;
    if v_existing is not null then
      return v_existing;
    end if;
  end if;

  if not exists (select 1 from public.cafes c where c.id = p_cafe_id) then
    raise exception 'Kafe tidak ditemukan' using errcode = '22023';
  end if;
  select * into v_settings from public.cafe_settings s where s.cafe_id = p_cafe_id;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 50 then
    raise exception 'Pesanan harus berisi 1–50 item' using errcode = '22023';
  end if;
  if p_notes is not null and char_length(p_notes) > 1000 then
    raise exception 'Catatan maksimal 1000 karakter' using errcode = '22023';
  end if;
  if p_source = 'app' and p_payment_method is not null and p_payment_method not in ('cash', 'simulated') then
    raise exception 'Metode pembayaran tidak didukung' using errcode = '22023';
  end if;
  if p_source = 'app' and p_discount is not null then
    raise exception 'Diskon hanya bisa diberikan kasir' using errcode = '42501';
  end if;

  if p_table_id is not null then
    select * into v_table from public.cafe_tables t where t.id = p_table_id and t.cafe_id = p_cafe_id and t.is_active;
    if not found then
      raise exception 'Meja tidak ditemukan atau nonaktif' using errcode = '22023';
    end if;
    v_order_type := coalesce(v_order_type, 'dine_in');
  end if;
  if v_order_type is not null then
    if v_order_type not in ('dine_in', 'takeaway') or (v_settings.order_types is not null and not v_order_type = any (v_settings.order_types)) then
      raise exception 'Jenis pesanan tidak tersedia di kafe ini' using errcode = '22023';
    end if;
  end if;

  insert into public.orders (
    cafe_id, customer_id, total_amount, order_status, payment_status, payment_method, notes,
    source, order_type, table_id, table_label, guest_name, pricing_version, idempotency_key, created_by,
    cashier_session_id
  )
  values (
    p_cafe_id,
    case when p_source = 'app' then v_uid end,
    0,
    case when p_source = 'pos' then 'preparing' else 'pending' end,
    'unpaid',
    case when p_source = 'app' then p_payment_method end,
    public.inv_clean_text(p_notes, 1000),
    p_source, v_order_type, v_table.id, v_table.label,
    case when p_source = 'pos' then public.inv_clean_text(p_guest_name, 60) end,
    2, v_key, v_uid,
    case when p_source = 'pos' then public.cashier_open_session_of(p_cafe_id, v_uid) end
  )
  returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'Format item tidak valid' using errcode = '22023';
    end if;
    v_product := null;
    v_pick := null;
    begin
      v_qty := (v_item ->> 'quantity')::integer;
      select * into v_product from public.products p
      where p.id = (v_item ->> 'product_id')::uuid and p.cafe_id = p_cafe_id
      for share;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'Item pesanan tidak valid' using errcode = '22023';
    end;
    if v_product.id is null then
      raise exception 'Menu tidak ditemukan' using errcode = '22023';
    end if;
    if not v_product.is_available then
      raise exception '% sedang habis', v_product.name using errcode = 'P0001', hint = 'product_unavailable';
    end if;
    if v_qty is null or v_qty not between 1 and 99 then
      raise exception 'Jumlah % harus 1–99', v_product.name using errcode = '22023';
    end if;
    if v_item ? 'notes' and char_length(coalesce(v_item ->> 'notes', '')) > 200 then
      raise exception 'Catatan item maksimal 200 karakter' using errcode = '22023';
    end if;

    -- Varian: validasi milik produk, tersedia, aturan grup; grup wajib kosong → pilihan bawaan
    begin
      v_option_ids := coalesce(
        (select array_agg(distinct x::uuid) from jsonb_array_elements_text(coalesce(v_item -> 'option_ids', '[]'::jsonb)) as x),
        '{}'::uuid[]
      );
    exception when invalid_text_representation then
      raise exception 'Pilihan varian tidak valid' using errcode = '22023';
    end;
    if cardinality(v_option_ids) > 20 then
      raise exception 'Terlalu banyak pilihan varian' using errcode = '22023';
    end if;
    if exists (
      select 1 from unnest(v_option_ids) x
      where not exists (
        select 1 from public.product_options o join public.product_option_groups g on g.id = o.group_id
        where o.id = x and g.product_id = v_product.id
      )
    ) then
      raise exception 'Pilihan varian tidak cocok dengan %', v_product.name using errcode = '22023';
    end if;
    select string_agg(o.name, ', ') into v_label from public.product_options o where o.id = any (v_option_ids) and not o.is_available;
    if v_label is not null then
      raise exception 'Pilihan % sedang habis', v_label using errcode = 'P0001', hint = 'option_unavailable';
    end if;
    select string_agg(g.name, ', ') into v_label
    from (
      select g.id, g.name, g.selection_type, g.max_select, count(*) as picked
      from public.product_options o join public.product_option_groups g on g.id = o.group_id
      where o.id = any (v_option_ids)
      group by g.id, g.name, g.selection_type, g.max_select
    ) g
    where g.picked > case when g.selection_type = 'single' then 1 else coalesce(g.max_select, 99) end;
    if v_label is not null then
      raise exception 'Terlalu banyak pilihan untuk %', v_label using errcode = '22023';
    end if;
    v_final := v_option_ids;
    for v_group in
      select g.id, g.name from public.product_option_groups g
      where g.product_id = v_product.id and g.is_required
        and not exists (select 1 from public.product_options o where o.group_id = g.id and o.id = any (v_final))
      order by g.sort_order
    loop
      select o.id into v_pick from public.product_options o
      where o.group_id = v_group.id and o.is_available
      order by o.is_default desc, o.sort_order, o.name
      limit 1;
      if v_pick is null then
        raise exception 'Pilihan % untuk % sedang habis', v_group.name, v_product.name using errcode = 'P0001', hint = 'option_unavailable';
      end if;
      v_final := v_final || v_pick;
    end loop;

    select coalesce(sum(o.price_delta), 0), string_agg(o.name, ', ' order by g.sort_order, o.sort_order)
    into v_delta, v_label
    from public.product_options o join public.product_option_groups g on g.id = o.group_id
    where o.id = any (v_final);

    insert into public.order_items (cafe_id, order_id, product_id, product_name, price, unit_price, quantity, notes)
    values (
      p_cafe_id, v_order_id, v_product.id,
      v_product.name || case when v_label is not null then ' (' || v_label || ')' else '' end,
      v_product.price + v_delta, v_product.price + v_delta, v_qty,
      public.inv_clean_text(v_item ->> 'notes', 200)
    )
    returning id into v_item_id;

    insert into public.order_item_options (cafe_id, order_id, order_item_id, option_id, group_name, option_name, price_delta)
    select p_cafe_id, v_order_id, v_item_id, o.id, g.name, o.name, o.price_delta
    from public.product_options o join public.product_option_groups g on g.id = o.group_id
    where o.id = any (v_final);

    v_subtotal := v_subtotal + (v_product.price + v_delta) * v_qty;
  end loop;

  -- Diskon (kasir): owner bebas, staff sampai batas di pengaturan
  if p_discount is not null and jsonb_typeof(p_discount) = 'object' and coalesce((p_discount ->> 'value')::numeric, 0) > 0 then
    v_discount_reason := public.inv_clean_text(p_discount ->> 'reason', 200);
    if char_length(coalesce(v_discount_reason, '')) < 3 then
      raise exception 'Tulis alasan diskon' using errcode = '22023';
    end if;
    if p_discount ->> 'type' = 'percent' then
      if (p_discount ->> 'value')::numeric > 100 then
        raise exception 'Diskon maksimal 100%%' using errcode = '22023';
      end if;
      v_discount := round(v_subtotal * (p_discount ->> 'value')::numeric / 100, 0);
    elsif p_discount ->> 'type' = 'amount' then
      v_discount := round((p_discount ->> 'value')::numeric, 0);
    else
      raise exception 'Jenis diskon tidak dikenal' using errcode = '22023';
    end if;
    v_discount := least(v_discount, v_subtotal);
    if not v_is_owner and v_subtotal > 0
       and v_discount / v_subtotal * 100 > coalesce(v_settings.staff_max_discount_pct, 0) + 0.001 then
      raise exception 'Diskon melebihi batas staff (% persen). Minta owner.', trim_scale(coalesce(v_settings.staff_max_discount_pct, 0))
        using errcode = '42501';
    end if;
  end if;

  -- Service → pajak → pembulatan (sama dengan lib/pricing.js)
  v_base := v_subtotal - v_discount;
  if coalesce(v_settings.service_charge_enabled, false) then
    v_service := round(v_base * v_settings.service_charge_rate / 100, 2);
  end if;
  v_tax_base := v_base + case when coalesce(v_settings.service_charge_taxable, true) then v_service else 0 end;
  if coalesce(v_settings.tax_enabled, false) then
    v_tax := round(case when v_settings.tax_inclusive
      then v_tax_base - v_tax_base / (1 + v_settings.tax_rate / 100)
      else v_tax_base * v_settings.tax_rate / 100 end, 2);
  end if;
  v_before := v_base + v_service + case when coalesce(v_settings.tax_inclusive, false) then 0 else v_tax end;
  v_total := case when coalesce(v_settings.rounding_unit, 0) > 0
    then round(v_before / v_settings.rounding_unit) * v_settings.rounding_unit
    else round(v_before, 2) end;

  update public.orders
  set subtotal_amount = v_subtotal,
      discount_amount = v_discount,
      discount_reason = v_discount_reason,
      discount_by = case when v_discount > 0 then v_uid end,
      service_charge_amount = v_service,
      tax_amount = v_tax,
      tax_inclusive = coalesce(v_settings.tax_inclusive, false),
      rounding_amount = v_total - v_before,
      total_amount = v_total
  where id = v_order_id;

  perform public.inv_reserve_order(v_order_id);
  return v_order_id;
end;
$$;
revoke all on function public.place_order(uuid, jsonb, text, text, uuid, text, text, jsonb, text, text) from public, anon;
grant execute on function public.place_order(uuid, jsonb, text, text, uuid, text, text, jsonb, text, text) to authenticated;

-- create_order (dipakai app saat ini) → place_order. App lama tetap jalan tanpa build ulang.
create or replace function public.create_order(p_cafe_id uuid, p_items jsonb, p_payment_method text default null, p_notes text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  return public.place_order(p_cafe_id, p_items, 'app', null, null, null, p_notes, null, p_payment_method, null);
end;
$$;
revoke all on function public.create_order(uuid, jsonb, text, text) from public, anon;
grant execute on function public.create_order(uuid, jsonb, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- H. Pembayaran kasir. p_payments = [{ method, amount, tendered?, reference? }]
-- ---------------------------------------------------------------------
create or replace function public.pos_apply_payments(p_order_id uuid, p_payments jsonb, p_require_session boolean)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_order public.orders%rowtype;
  v_accepted text[];
  v_session uuid;
  v_pay jsonb;
  v_method text;
  v_amount numeric(12, 2);
  v_tendered numeric(12, 2);
  v_sum numeric(12, 2) := 0;
  v_methods text[] := '{}';
  v_cash_count integer := 0;
  v_now timestamptz := now();
begin
  if v_uid is null then
    raise exception 'Login diperlukan' using errcode = '28000';
  end if;
  select * into v_order from public.orders o where o.id = p_order_id for update;
  if not found then
    raise exception 'Pesanan tidak ditemukan' using errcode = 'P0002';
  end if;
  if not public.is_cafe_member(v_order.cafe_id) then
    raise exception 'Hanya staff atau owner kafe ini yang bisa mencatat pembayaran' using errcode = '42501';
  end if;
  if v_order.order_status = 'cancelled' then
    raise exception 'Pesanan yang dibatalkan tidak bisa dibayar' using errcode = '22023';
  end if;
  if v_order.payment_status = 'paid' then
    return v_order; -- idempoten: klik ganda tidak membuat pembayaran dobel
  end if;
  if p_payments is null or jsonb_typeof(p_payments) <> 'array' or jsonb_array_length(p_payments) not between 1 and 4 then
    raise exception 'Isi 1–4 pembayaran' using errcode = '22023';
  end if;
  select c.accepted_payment_methods into v_accepted from public.cafes c where c.id = v_order.cafe_id;
  v_session := public.cashier_open_session_of(v_order.cafe_id, v_uid);

  for v_pay in select * from jsonb_array_elements(p_payments) loop
    v_method := v_pay ->> 'method';
    v_amount := round((v_pay ->> 'amount')::numeric, 2);
    v_tendered := round(nullif(v_pay ->> 'tendered', '')::numeric, 2);
    if v_method is null or v_method not in ('cash', 'qris', 'bank_transfer', 'ewallet') then
      raise exception 'Metode pembayaran tidak dikenal' using errcode = '22023';
    end if;
    if v_accepted is not null and cardinality(v_accepted) > 0 and not v_method = any (v_accepted) then
      raise exception 'Metode % tidak diterima di kafe ini (lihat Pengaturan)', v_method using errcode = '22023';
    end if;
    if v_amount is null or v_amount <= 0 then
      raise exception 'Nominal pembayaran harus lebih dari 0' using errcode = '22023';
    end if;
    if v_method = 'cash' then
      v_cash_count := v_cash_count + 1;
      if v_tendered is not null and v_tendered < v_amount then
        raise exception 'Uang diterima kurang dari nominal tunai' using errcode = '22023';
      end if;
      if p_require_session and v_session is null then
        raise exception 'Buka sesi kasir dulu untuk menerima tunai' using errcode = '22023', hint = 'session_required';
      end if;
    elsif v_tendered is not null then
      raise exception 'Uang diterima hanya untuk tunai' using errcode = '22023';
    end if;
    v_sum := v_sum + v_amount;
    v_methods := v_methods || v_method;

    insert into public.payments (
      order_id, method, payment_method, status, payment_status, amount, paid_at,
      reference, recorded_by, cashier_session_id, verification, tendered_amount, change_amount
    )
    values (
      v_order.id, v_method, v_method, 'paid', 'paid', v_amount, v_now,
      public.inv_clean_text(v_pay ->> 'reference', 60), v_uid, v_session, 'manual',
      v_tendered, case when v_method = 'cash' and v_tendered is not null then v_tendered - v_amount else 0 end
    );
  end loop;

  if v_cash_count > 1 then
    raise exception 'Gabungkan pembayaran tunai menjadi satu baris' using errcode = '22023';
  end if;
  if v_order.paid_amount + v_sum > v_order.total_amount + 0.005 then
    raise exception 'Total pembayaran melebihi sisa tagihan (%)', to_char(v_order.total_amount - v_order.paid_amount, 'FM999G999G990') using errcode = '22023';
  end if;

  update public.orders
  set paid_amount = paid_amount + v_sum,
      payment_status = case when paid_amount + v_sum >= total_amount - 0.005 then 'paid' else payment_status end,
      paid_at = case when paid_amount + v_sum >= total_amount - 0.005 then v_now else paid_at end,
      payment_method = case
        when (select count(distinct m) from unnest(v_methods || coalesce(
               (select array_agg(distinct p.method) from public.payments p where p.order_id = v_order.id and p.status = 'paid'), '{}')) m) > 1
          then 'split'
        else v_methods[1] end,
      cashier_session_id = coalesce(cashier_session_id, v_session),
      updated_at = v_now
  where id = v_order.id
  returning * into v_order;

  insert into public.order_status_events (order_id, cafe_id, event_type, to_status, note, changed_by, created_at)
  values (v_order.id, v_order.cafe_id, 'payment', case when v_order.payment_status = 'paid' then 'paid' else 'partial' end,
          array_to_string(v_methods, '+'), v_uid, v_now);
  return v_order;
end;
$$;
revoke all on function public.pos_apply_payments(uuid, jsonb, boolean) from public, anon, authenticated;

create or replace function public.pos_record_payments(p_order_id uuid, p_payments jsonb)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
begin
  return public.pos_apply_payments(p_order_id, p_payments, true);
end;
$$;
revoke all on function public.pos_record_payments(uuid, jsonb) from public, anon;
grant execute on function public.pos_record_payments(uuid, jsonb) to authenticated;

-- Papan staff: tandai lunas sisa tagihan (tunai tanpa sesi tetap diizinkan agar alur lama tidak putus)
create or replace function public.staff_mark_order_paid(p_order_id uuid, p_method text)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'Login diperlukan' using errcode = '28000';
  end if;
  select * into v_order from public.orders o where o.id = p_order_id;
  if not found then
    raise exception 'Pesanan tidak ditemukan' using errcode = 'P0002';
  end if;
  if v_order.payment_status = 'paid' then
    return v_order;
  end if;
  if v_order.total_amount - v_order.paid_amount <= 0 then
    -- pesanan gratis (Rp 0): tandai lunas tanpa baris pembayaran
    if not public.is_cafe_member(v_order.cafe_id) then
      raise exception 'Hanya staff atau owner kafe ini yang bisa menandai lunas' using errcode = '42501';
    end if;
    update public.orders set payment_status = 'paid', payment_method = p_method, paid_at = now(), updated_at = now()
    where id = v_order.id returning * into v_order;
    return v_order;
  end if;
  return public.pos_apply_payments(
    p_order_id,
    jsonb_build_array(jsonb_build_object('method', p_method, 'amount', v_order.total_amount - v_order.paid_amount)),
    false
  );
end;
$$;
revoke all on function public.staff_mark_order_paid(uuid, text) from public, anon;
grant execute on function public.staff_mark_order_paid(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- I. Pesanan ditahan (hold) — draf keranjang kasir, divalidasi ulang saat dikirim
-- ---------------------------------------------------------------------
create table if not exists public.pos_held_orders (
  id uuid primary key default gen_random_uuid(),
  cafe_id uuid not null references public.cafes (id) on delete cascade,
  label text not null check (char_length(btrim(label)) between 1 and 40),
  cart jsonb not null check (jsonb_typeof(cart) = 'object' and pg_column_size(cart) < 60000),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists pos_held_orders_cafe_idx on public.pos_held_orders (cafe_id, updated_at desc);
drop trigger if exists touch_updated_at on public.pos_held_orders;
create trigger touch_updated_at before update on public.pos_held_orders
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- J. Refund
-- ---------------------------------------------------------------------
create table if not exists public.refunds (
  id uuid primary key default gen_random_uuid(),
  cafe_id uuid not null references public.cafes (id) on delete cascade,
  order_id uuid not null references public.orders (id) on delete cascade,
  amount numeric(12, 2) not null check (amount > 0),
  method text not null check (method in ('cash', 'qris', 'bank_transfer', 'ewallet')),
  reason text not null check (char_length(reason) between 3 and 300),
  restock boolean not null default false,
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  status text not null default 'requested' check (status in ('requested', 'approved', 'rejected')),
  requested_by uuid default auth.uid(),
  requested_at timestamptz not null default now(),
  decided_by uuid,
  decided_at timestamptz,
  decision_note text check (decision_note is null or char_length(decision_note) <= 300),
  cashier_session_id uuid references public.cashier_sessions (id) on delete set null
);
create index if not exists refunds_cafe_idx on public.refunds (cafe_id, requested_at desc);
create index if not exists refunds_order_idx on public.refunds (order_id);

create or replace function public.refund_approve_internal(p_refund_id uuid, p_note text)
returns public.refunds
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_refund public.refunds%rowtype;
  v_order public.orders%rowtype;
  v_session uuid;
  v_line record;
begin
  select * into v_refund from public.refunds where id = p_refund_id for update;
  select * into v_order from public.orders where id = v_refund.order_id for update;
  if v_refund.amount > v_order.paid_amount - v_order.refunded_amount + 0.005 then
    raise exception 'Nominal refund melebihi uang yang sudah dibayar' using errcode = '22023';
  end if;
  v_session := coalesce(public.cashier_open_session_of(v_order.cafe_id, v_uid),
                        public.cashier_open_session_of(v_order.cafe_id, v_refund.requested_by));

  update public.refunds
  set status = 'approved', decided_by = v_uid, decided_at = now(),
      decision_note = public.inv_clean_text(p_note, 300), cashier_session_id = v_session
  where id = v_refund.id
  returning * into v_refund;

  insert into public.payments (order_id, method, payment_method, status, payment_status, amount, paid_at, recorded_by, cashier_session_id, verification, refund_id, reference)
  values (v_order.id, v_refund.method, v_refund.method, 'refunded', 'refunded', v_refund.amount, now(), v_uid, v_session, 'manual', v_refund.id, 'refund');

  update public.orders
  set refunded_amount = refunded_amount + v_refund.amount,
      payment_status = case when refunded_amount + v_refund.amount >= paid_amount - 0.005 then 'refunded' else payment_status end,
      updated_at = now()
  where id = v_order.id;

  insert into public.order_status_events (order_id, cafe_id, event_type, to_status, note, changed_by)
  values (v_order.id, v_order.cafe_id, 'refund', 'refunded', v_refund.reason, v_uid);

  -- Kembalikan bahan bila pesanan sudah selesai (bahan sudah terpotong) dan diminta
  if v_refund.restock and v_order.order_status = 'completed' then
    for v_line in
      select n.ingredient_id, n.order_item_id, n.product_id,
             round(n.quantity / oi.quantity * (x ->> 'quantity')::numeric, 3) as quantity
      from jsonb_array_elements(v_refund.items) x
      join public.order_items oi on oi.id = (x ->> 'order_item_id')::uuid and oi.order_id = v_order.id
      join public.inv_order_item_needs(v_order.id) n on n.order_item_id = oi.id
      where exists (select 1 from public.stock_movements m where m.order_item_id = oi.id and m.movement_type = 'sale')
      order by n.ingredient_id
    loop
      if v_line.quantity > 0 then
        perform public.inv_apply_movement(
          v_line.ingredient_id, 'refund', v_line.quantity, null, null, 'Refund pesanan',
          jsonb_build_object('order_id', v_order.id, 'order_item_id', v_line.order_item_id, 'product_id', v_line.product_id)
        );
      end if;
    end loop;
  end if;
  return v_refund;
end;
$$;
revoke all on function public.refund_approve_internal(uuid, text) from public, anon, authenticated;

-- p_items = [{ order_item_id, quantity }] — item yang dikembalikan (untuk stok)
create or replace function public.refund_request(
  p_order_id uuid,
  p_amount numeric,
  p_method text,
  p_reason text,
  p_restock boolean default false,
  p_items jsonb default '[]'::jsonb
)
returns public.refunds
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_refund public.refunds%rowtype;
  v_pending numeric(12, 2);
  v_amount numeric(12, 2) := round(p_amount, 2);
  v_bad integer;
begin
  if (select auth.uid()) is null then
    raise exception 'Login diperlukan' using errcode = '28000';
  end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Pesanan tidak ditemukan' using errcode = 'P0002';
  end if;
  if not public.is_cafe_member(v_order.cafe_id) then
    raise exception 'Hanya staff atau owner kafe ini yang bisa mengajukan refund' using errcode = '42501';
  end if;
  if v_order.paid_amount <= 0 then
    raise exception 'Pesanan ini belum dibayar, tidak ada yang bisa direfund' using errcode = '22023';
  end if;
  if p_method is null or p_method not in ('cash', 'qris', 'bank_transfer', 'ewallet') then
    raise exception 'Metode refund tidak dikenal' using errcode = '22023';
  end if;
  if char_length(coalesce(public.inv_clean_text(p_reason, 300), '')) < 3 then
    raise exception 'Tulis alasan refund' using errcode = '22023';
  end if;
  select coalesce(sum(r.amount), 0) into v_pending from public.refunds r where r.order_id = p_order_id and r.status = 'requested';
  if v_amount is null or v_amount <= 0 or v_amount > v_order.paid_amount - v_order.refunded_amount - v_pending + 0.005 then
    raise exception 'Nominal refund maksimal %', to_char(greatest(v_order.paid_amount - v_order.refunded_amount - v_pending, 0), 'FM999G999G990') using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Format item refund tidak valid' using errcode = '22023';
  end if;
  select count(*) into v_bad
  from jsonb_array_elements(p_items) x
  left join public.order_items oi on oi.id = nullif(x ->> 'order_item_id', '')::uuid and oi.order_id = p_order_id
  where oi.id is null or (x ->> 'quantity')::numeric <= 0 or (x ->> 'quantity')::numeric > oi.quantity;
  if v_bad > 0 then
    raise exception 'Item refund tidak cocok dengan pesanan' using errcode = '22023';
  end if;

  insert into public.refunds (cafe_id, order_id, amount, method, reason, restock, items)
  values (v_order.cafe_id, v_order.id, v_amount, p_method, public.inv_clean_text(p_reason, 300),
          coalesce(p_restock, false) and jsonb_array_length(p_items) > 0, p_items)
  returning * into v_refund;

  -- Owner mengajukan = langsung disetujui
  if public.is_cafe_member(v_order.cafe_id, array['owner']) then
    v_refund := public.refund_approve_internal(v_refund.id, null);
  end if;
  return v_refund;
end;
$$;
revoke all on function public.refund_request(uuid, numeric, text, text, boolean, jsonb) from public, anon;
grant execute on function public.refund_request(uuid, numeric, text, text, boolean, jsonb) to authenticated;

create or replace function public.refund_decide(p_refund_id uuid, p_approve boolean, p_note text default null)
returns public.refunds
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_refund public.refunds%rowtype;
begin
  select * into v_refund from public.refunds where id = p_refund_id;
  if not found then
    raise exception 'Refund tidak ditemukan' using errcode = 'P0002';
  end if;
  if not public.is_cafe_member(v_refund.cafe_id, array['owner']) then
    raise exception 'Hanya owner yang bisa menyetujui refund' using errcode = '42501';
  end if;
  perform 1 from public.refunds where id = p_refund_id for update;
  select * into v_refund from public.refunds where id = p_refund_id;
  if v_refund.status <> 'requested' then
    raise exception 'Refund ini sudah diputuskan' using errcode = '22023';
  end if;
  if coalesce(p_approve, false) then
    return public.refund_approve_internal(p_refund_id, p_note);
  end if;
  if char_length(coalesce(public.inv_clean_text(p_note, 300), '')) < 3 then
    raise exception 'Tulis alasan penolakan' using errcode = '22023';
  end if;
  update public.refunds
  set status = 'rejected', decided_by = (select auth.uid()), decided_at = now(), decision_note = public.inv_clean_text(p_note, 300)
  where id = p_refund_id
  returning * into v_refund;
  return v_refund;
end;
$$;
revoke all on function public.refund_decide(uuid, boolean, text) from public, anon;
grant execute on function public.refund_decide(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------
-- K. RLS & izin
-- ---------------------------------------------------------------------
alter table public.order_item_options enable row level security;
revoke all on public.order_item_options from anon, authenticated;
grant select on public.order_item_options to authenticated;
drop policy if exists "Customers and cafe staff can view order item options" on public.order_item_options;
create policy "Customers and cafe staff can view order item options" on public.order_item_options
  for select to authenticated
  using (exists (
    select 1 from public.orders o
    where o.id = order_item_options.order_id and (o.customer_id = (select auth.uid()) or public.is_cafe_member(o.cafe_id))
  ));

alter table public.stock_reservations enable row level security;
revoke all on public.stock_reservations from anon, authenticated;
grant select on public.stock_reservations to authenticated;
drop policy if exists "Owners view stock reservations" on public.stock_reservations;
create policy "Owners view stock reservations" on public.stock_reservations
  for select to authenticated using (public.is_cafe_member(cafe_id, array['owner']));

alter table public.cashier_sessions enable row level security;
alter table public.cash_movements enable row level security;
revoke all on public.cashier_sessions, public.cash_movements from anon, authenticated;
grant select on public.cashier_sessions, public.cash_movements to authenticated;
drop policy if exists "Own or owner view cashier sessions" on public.cashier_sessions;
create policy "Own or owner view cashier sessions" on public.cashier_sessions
  for select to authenticated
  using ((opened_by = (select auth.uid()) and public.is_cafe_member(cafe_id)) or public.is_cafe_member(cafe_id, array['owner']));
drop policy if exists "Own or owner view cash movements" on public.cash_movements;
create policy "Own or owner view cash movements" on public.cash_movements
  for select to authenticated
  using (exists (
    select 1 from public.cashier_sessions s
    where s.id = cash_movements.session_id
      and ((s.opened_by = (select auth.uid()) and public.is_cafe_member(s.cafe_id)) or public.is_cafe_member(s.cafe_id, array['owner']))
  ));

alter table public.pos_held_orders enable row level security;
revoke all on public.pos_held_orders from anon, authenticated;
grant select, insert, delete on public.pos_held_orders to authenticated;
grant update (label, cart) on public.pos_held_orders to authenticated;
drop policy if exists "Members manage held orders" on public.pos_held_orders;
create policy "Members manage held orders" on public.pos_held_orders
  for all to authenticated
  using (public.is_cafe_member(cafe_id))
  with check (public.is_cafe_member(cafe_id));

alter table public.refunds enable row level security;
revoke all on public.refunds from anon, authenticated;
grant select on public.refunds to authenticated;
drop policy if exists "Members view refunds" on public.refunds;
create policy "Members view refunds" on public.refunds
  for select to authenticated using (public.is_cafe_member(cafe_id));

-- Log aktivitas
drop trigger if exists log_audit_event on public.cashier_sessions;
create trigger log_audit_event after insert or update of status on public.cashier_sessions
  for each row execute function public.log_audit_event();
drop trigger if exists log_audit_event on public.cash_movements;
create trigger log_audit_event after insert on public.cash_movements
  for each row execute function public.log_audit_event();
drop trigger if exists log_audit_event on public.refunds;
create trigger log_audit_event after insert or update of status on public.refunds
  for each row execute function public.log_audit_event();

notify pgrst, 'reload schema';

commit;

-- Verifikasi: 7 tabel + 13 fungsi + 1 trigger = 21 baris
select 'table' as kind, table_name as name
from information_schema.tables
where table_schema = 'public'
  and table_name in ('cashier_sessions', 'cash_movements', 'order_item_options', 'stock_reservations', 'pos_held_orders', 'refunds', 'orders')
union all
select 'function', p.proname
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in (
  'place_order', 'create_order', 'product_availability', 'pos_record_payments', 'staff_mark_order_paid',
  'cashier_open', 'cashier_cash_move', 'cashier_summary', 'cashier_close', 'refund_request', 'refund_decide',
  'inv_reserve_order', 'inv_release_order'
)
union all
select 'trigger', t.tgname
from pg_trigger t
where t.tgrelid = 'public.orders'::regclass and t.tgname = 'inv_on_order_cancelled'
order by 1, 2;
