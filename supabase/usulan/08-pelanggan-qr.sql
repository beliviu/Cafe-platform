-- =====================================================================
-- 08 · APLIKASI CUSTOMER & QR MEJA (Fase 4 roadmap V2)
--   A. Status kafe: jam buka (WIB), jeda pesanan, pesanan terjadwal, estimasi waktu siap
--   B. QR meja: token unik per meja (rahasia), resolve, ganti token, keterisian meja
--   C. Checkout customer: customer_place_order (cek status kafe, QR, jadwal, voucher, poin)
--      → memakai place_order (file 06). create_order (app lama) ikut lewat jalur ini.
--   D. Pembatalan oleh customer (selama belum diterima kafe) + detail pembatalan
--   E. Voucher (kode, persen/nominal, batas, periode, kuota)
--   F. Loyalti: poin, riwayat poin, tingkat member, tukar poin jadi potongan
--   G. Pesan ulang (cek harga & ketersediaan terkini)
--   H. Ulasan & rating produk, wishlist
--   I. Bantuan (tiket + percakapan customer ↔ kafe)
--   J. Notifikasi (kotak masuk di app + antrean push) & token push perangkat
--
-- Jalankan manual di Supabase SQL Editor SETELAH 06-pesanan-v2-pos.sql (07 tidak wajib).
-- Semua dalam satu transaksi: kalau ada error, tidak ada yang berubah.
--
-- Dampak ke data yang sudah ada:
--   - Meja lama otomatis mendapat token QR. Kolom qr_token TIDAK bisa dibaca lewat API
--     publik (hanya owner lewat fungsi), sehingga QR tidak bisa ditebak dari luar.
--   - Kolom baru di cafe_settings & orders (nilai bawaan; data lama tidak diubah).
--     Loyalti & pesanan terjadwal NONAKTIF sampai owner menyalakannya.
--   - create_order (app versi lama) kini menolak pesanan saat kafe tutup / dijeda.
--     Bila jam buka belum diatur, kafe dianggap selalu buka (perilaku lama).
--   - Trigger baru (AFTER) di orders & refunds: poin, voucher, notifikasi. Tidak mengubah
--     total pesanan lama.
-- =====================================================================

begin;

do $$
begin
  if to_regprocedure('public.place_order(uuid, jsonb, text, text, uuid, text, text, jsonb, text, text)') is null then
    raise exception 'File 06-pesanan-v2-pos.sql belum dijalankan. Jalankan file 06 dulu.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- E. Voucher (dibuat sebelum kolom orders.voucher_id)
-- ---------------------------------------------------------------------
create table if not exists public.vouchers (
  id uuid primary key default gen_random_uuid(),
  cafe_id uuid not null references public.cafes (id) on delete cascade,
  code text not null check (code ~ '^[A-Z0-9_-]{3,20}$'),
  name text not null check (char_length(btrim(name)) between 3 and 80),
  discount_type text not null check (discount_type in ('percent', 'amount')),
  discount_value numeric(12, 2) not null check (discount_value > 0),
  max_discount numeric(12, 2) check (max_discount is null or max_discount > 0),
  min_subtotal numeric(12, 2) not null default 0 check (min_subtotal >= 0),
  starts_at timestamptz,
  ends_at timestamptz,
  usage_limit integer check (usage_limit is null or usage_limit > 0),
  per_customer_limit integer not null default 1 check (per_customer_limit between 1 and 100),
  is_public boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vouchers_code_unique unique (cafe_id, code),
  constraint vouchers_percent_max check (discount_type <> 'percent' or discount_value <= 100),
  constraint vouchers_period check (ends_at is null or starts_at is null or ends_at > starts_at)
);

create table if not exists public.voucher_redemptions (
  id uuid primary key default gen_random_uuid(),
  cafe_id uuid not null references public.cafes (id) on delete cascade,
  voucher_id uuid not null references public.vouchers (id) on delete cascade,
  order_id uuid not null unique references public.orders (id) on delete cascade,
  customer_id uuid not null,
  amount numeric(12, 2) not null check (amount >= 0),
  status text not null default 'applied' check (status in ('applied', 'released')),
  created_at timestamptz not null default now(),
  released_at timestamptz
);
create index if not exists voucher_redemptions_voucher_idx on public.voucher_redemptions (voucher_id, status);

-- ---------------------------------------------------------------------
-- D. Kolom pesanan baru
-- ---------------------------------------------------------------------
alter table public.orders
  add column if not exists scheduled_for timestamptz,
  add column if not exists estimated_ready_at timestamptz,
  add column if not exists cancelled_by text,
  add column if not exists voucher_id uuid references public.vouchers (id) on delete set null,
  add column if not exists voucher_code text,
  add column if not exists voucher_discount numeric(12, 2) not null default 0,
  add column if not exists points_redeemed integer not null default 0,
  add column if not exists points_discount numeric(12, 2) not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'orders_cancelled_by_valid') then
    alter table public.orders add constraint orders_cancelled_by_valid check (cancelled_by is null or cancelled_by in ('customer', 'cafe'));
  end if;
end;
$$;
create index if not exists orders_scheduled_idx on public.orders (cafe_id, scheduled_for) where scheduled_for is not null;
create index if not exists orders_table_active_idx on public.orders (table_id, created_at) where table_id is not null;

-- ---------------------------------------------------------------------
-- A. Pengaturan & status kafe
-- ---------------------------------------------------------------------
alter table public.cafe_settings
  add column if not exists ordering_paused boolean not null default false,
  add column if not exists ordering_message text,
  add column if not exists scheduled_orders_enabled boolean not null default false,
  add column if not exists prep_minutes_base smallint not null default 10,
  add column if not exists prep_minutes_per_order smallint not null default 2,
  add column if not exists qr_ordering_enabled boolean not null default true,
  add column if not exists loyalty_enabled boolean not null default false,
  add column if not exists loyalty_spend_per_point numeric(12, 2) not null default 10000,
  add column if not exists loyalty_point_value numeric(12, 2) not null default 100,
  add column if not exists loyalty_min_redeem integer not null default 50,
  add column if not exists loyalty_max_redeem_pct smallint not null default 50,
  add column if not exists loyalty_tiers jsonb not null default
    '[{"name":"Bronze","min_spend":0,"multiplier":1},{"name":"Silver","min_spend":1000000,"multiplier":1.25},{"name":"Gold","min_spend":3000000,"multiplier":1.5}]'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cafe_settings_phase4_valid') then
    alter table public.cafe_settings add constraint cafe_settings_phase4_valid check (
      (ordering_message is null or char_length(ordering_message) <= 160)
      and prep_minutes_base between 0 and 180
      and prep_minutes_per_order between 0 and 60
      and loyalty_spend_per_point >= 1000
      and loyalty_point_value between 1 and 100000
      and loyalty_min_redeem between 1 and 100000
      and loyalty_max_redeem_pct between 1 and 100
      and jsonb_typeof(loyalty_tiers) = 'array' and jsonb_array_length(loyalty_tiers) between 1 and 6
    );
  end if;
end;
$$;

grant update (
  ordering_paused, ordering_message, scheduled_orders_enabled, prep_minutes_base, prep_minutes_per_order, qr_ordering_enabled,
  loyalty_enabled, loyalty_spend_per_point, loyalty_point_value, loyalty_min_redeem, loyalty_max_redeem_pct, loyalty_tiers
) on public.cafe_settings to authenticated;

-- 'HH:MM' → menit; nilai rusak memakai bawaan (sama dengan lib/cafeHours.js)
create or replace function public.cafe_hours_minutes(p_time text, p_default text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select split_part(t, ':', 1)::integer * 60 + split_part(t, ':', 2)::integer
  from (select case when p_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then p_time else p_default end as t) x
$$;

-- Buka pada waktu tertentu? jam buka kosong = selalu buka. close < open = lewat tengah malam.
create or replace function public.cafe_open_at(p_hours jsonb, p_at timestamptz)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  v_keys text[] := array['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  v_local timestamp := p_at at time zone 'Asia/Jakarta';
  v_idx integer := extract(isodow from v_local)::integer;
  v_min integer := extract(hour from v_local)::integer * 60 + extract(minute from v_local)::integer;
  v_today jsonb;
  v_yest jsonb;
  v_open integer;
  v_close integer;
begin
  if p_hours is null or jsonb_typeof(p_hours) <> 'object' then
    return true;
  end if;
  v_today := coalesce(p_hours -> v_keys[v_idx], '{}'::jsonb);
  v_yest := coalesce(p_hours -> v_keys[case when v_idx = 1 then 7 else v_idx - 1 end], '{}'::jsonb);
  if coalesce(v_yest ->> 'closed', 'false') <> 'true' then
    v_open := public.cafe_hours_minutes(v_yest ->> 'open', '08:00');
    v_close := public.cafe_hours_minutes(v_yest ->> 'close', '22:00');
    if v_close < v_open and v_min < v_close then
      return true;
    end if;
  end if;
  if coalesce(v_today ->> 'closed', 'false') = 'true' then
    return false;
  end if;
  v_open := public.cafe_hours_minutes(v_today ->> 'open', '08:00');
  v_close := public.cafe_hours_minutes(v_today ->> 'close', '22:00');
  if v_close < v_open then
    return v_min >= v_open;
  end if;
  return v_min >= v_open and v_min < v_close;
end;
$$;

create or replace function public.cafe_next_open(p_hours jsonb, p_from timestamptz)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  v_keys text[] := array['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  v_day date;
  v_spec jsonb;
  v_at timestamptz;
begin
  if p_hours is null or jsonb_typeof(p_hours) <> 'object' then
    return null;
  end if;
  for i in 0..7 loop
    v_day := (p_from at time zone 'Asia/Jakarta')::date + i;
    v_spec := coalesce(p_hours -> v_keys[extract(isodow from v_day)::integer], '{}'::jsonb);
    continue when coalesce(v_spec ->> 'closed', 'false') = 'true';
    v_at := (v_day + make_interval(mins => public.cafe_hours_minutes(v_spec ->> 'open', '08:00'))) at time zone 'Asia/Jakarta';
    if v_at > p_from then
      return v_at;
    end if;
  end loop;
  return null;
end;
$$;

create or replace function public.cafe_prep_minutes(p_cafe_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(max(s.prep_minutes_base), 10) + coalesce(max(s.prep_minutes_per_order), 2) * (
    select count(*)::integer from public.orders o
    where o.cafe_id = p_cafe_id and o.order_status in ('pending', 'confirmed', 'preparing')
      and o.created_at > now() - interval '12 hours' and o.scheduled_for is null
  )
  from public.cafe_settings s where s.cafe_id = p_cafe_id
$$;
revoke all on function public.cafe_prep_minutes(uuid) from public, anon, authenticated;

-- Status publik untuk app: buka/tutup, jeda, terjadwal, estimasi menit
create or replace function public.cafe_status(p_cafe_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_hours jsonb;
  v_settings public.cafe_settings%rowtype;
  v_open boolean;
begin
  select c.opening_hours into v_hours from public.cafes c where c.id = p_cafe_id;
  if not found then
    return null;
  end if;
  select * into v_settings from public.cafe_settings s where s.cafe_id = p_cafe_id;
  v_open := public.cafe_open_at(v_hours, now());
  return jsonb_build_object(
    'open', v_open,
    'hours_set', v_hours is not null,
    'paused', coalesce(v_settings.ordering_paused, false),
    'message', v_settings.ordering_message,
    'accepting', v_open and not coalesce(v_settings.ordering_paused, false),
    'scheduled_enabled', coalesce(v_settings.scheduled_orders_enabled, false),
    'next_open', case when not v_open then public.cafe_next_open(v_hours, now()) end,
    'prep_minutes', public.cafe_prep_minutes(p_cafe_id),
    'qr_enabled', coalesce(v_settings.qr_ordering_enabled, true),
    'loyalty_enabled', coalesce(v_settings.loyalty_enabled, false)
  );
end;
$$;
revoke all on function public.cafe_status(uuid) from public;
grant execute on function public.cafe_status(uuid) to anon, authenticated;

-- Jeda / lanjutkan pesanan app (owner & staff, mis. saat antrean penuh)
create or replace function public.cafe_set_ordering_paused(p_cafe_id uuid, p_paused boolean, p_message text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_cafe_member(p_cafe_id) then
    raise exception 'Hanya staff atau owner kafe ini' using errcode = '42501';
  end if;
  update public.cafe_settings
  set ordering_paused = coalesce(p_paused, false),
      ordering_message = case when coalesce(p_paused, false) then public.inv_clean_text(p_message, 160) end
  where cafe_id = p_cafe_id;
  insert into public.audit_logs (cafe_id, actor_id, action, entity, entity_id, label, changes)
  values (p_cafe_id, (select auth.uid()), 'update', 'cafe_settings', p_cafe_id::text,
          case when coalesce(p_paused, false) then 'Pesanan app dijeda' else 'Pesanan app dibuka lagi' end,
          jsonb_build_object('ordering_paused', jsonb_build_array(not coalesce(p_paused, false), coalesce(p_paused, false))));
end;
$$;
revoke all on function public.cafe_set_ordering_paused(uuid, boolean, text) from public, anon;
grant execute on function public.cafe_set_ordering_paused(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------
-- B. QR meja
-- ---------------------------------------------------------------------
alter table public.cafe_tables add column if not exists qr_token text;
update public.cafe_tables set qr_token = replace(gen_random_uuid()::text, '-', '') where qr_token is null;
alter table public.cafe_tables alter column qr_token set default replace(gen_random_uuid()::text, '-', '');
alter table public.cafe_tables alter column qr_token set not null;
create unique index if not exists cafe_tables_qr_token_key on public.cafe_tables (qr_token);

-- Token tidak boleh terbaca lewat API (meja bisa dibaca publik) → hibah per kolom
revoke select on public.cafe_tables from anon, authenticated;
grant select (id, cafe_id, label, area, capacity, is_active, sort_order, created_at) on public.cafe_tables to anon, authenticated;

create or replace function public.table_qr_resolve(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'table_id', t.id, 'label', t.label, 'area', t.area, 'active', t.is_active,
    'cafe_id', t.cafe_id, 'cafe_name', coalesce(nullif(btrim(c.app_name), ''), c.name),
    'qr_enabled', coalesce(s.qr_ordering_enabled, true)
  )
  from public.cafe_tables t
  join public.cafes c on c.id = t.cafe_id
  left join public.cafe_settings s on s.cafe_id = t.cafe_id
  where t.qr_token = p_token and char_length(coalesce(p_token, '')) between 16 and 64
$$;
revoke all on function public.table_qr_resolve(text) from public;
grant execute on function public.table_qr_resolve(text) to anon, authenticated;

-- Owner: daftar meja + token + keterisian (pesanan makan di tempat yang masih aktif)
create or replace function public.cafe_tables_qr(p_cafe_id uuid)
returns table (table_id uuid, label text, area text, capacity smallint, is_active boolean, sort_order integer, qr_token text, active_orders integer, occupied_since timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not public.is_cafe_member(p_cafe_id) then
    raise exception 'Hanya staff atau owner kafe ini' using errcode = '42501';
  end if;
  return query
  select t.id, t.label, t.area, t.capacity, t.is_active, t.sort_order,
         case when public.is_cafe_member(p_cafe_id, array['owner']) then t.qr_token end,
         count(o.id)::integer, min(o.created_at)
  from public.cafe_tables t
  left join public.orders o on o.table_id = t.id and o.order_status in ('pending', 'confirmed', 'preparing', 'ready')
    and o.created_at > now() - interval '12 hours'
  where t.cafe_id = p_cafe_id
  group by t.id
  order by t.sort_order, t.label;
end;
$$;
revoke all on function public.cafe_tables_qr(uuid) from public, anon;
grant execute on function public.cafe_tables_qr(uuid) to authenticated;

create or replace function public.table_qr_rotate(p_table_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_table public.cafe_tables%rowtype;
  v_token text := replace(gen_random_uuid()::text, '-', '');
begin
  select * into v_table from public.cafe_tables t where t.id = p_table_id for update;
  if not found or not public.is_cafe_member(v_table.cafe_id, array['owner']) then
    raise exception 'Meja tidak ditemukan' using errcode = 'P0002';
  end if;
  update public.cafe_tables set qr_token = v_token where id = p_table_id;
  insert into public.audit_logs (cafe_id, actor_id, action, entity, entity_id, label, changes)
  values (v_table.cafe_id, (select auth.uid()), 'update', 'cafe_tables', p_table_id::text, v_table.label, jsonb_build_object('qr', 'QR diganti'));
  return v_token;
end;
$$;
revoke all on function public.table_qr_rotate(uuid) from public, anon;
grant execute on function public.table_qr_rotate(uuid) to authenticated;

-- Siapa yang membatalkan (customer sendiri atau kafe)
create or replace function public.ord_set_cancelled_by()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.order_status = 'cancelled' and old.order_status is distinct from 'cancelled' and new.cancelled_by is null then
    new.cancelled_by := case when (select auth.uid()) is not null and (select auth.uid()) = new.customer_id then 'customer' else 'cafe' end;
  end if;
  return new;
end;
$$;
drop trigger if exists ord_set_cancelled_by on public.orders;
create trigger ord_set_cancelled_by before update of order_status on public.orders
  for each row execute function public.ord_set_cancelled_by();

-- Customer membatalkan sendiri: hanya selama kafe belum menerima & belum dibayar
create or replace function public.customer_cancel_order(p_order_id uuid, p_reason text default null)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders o where o.id = p_order_id for update;
  if not found or v_order.customer_id is distinct from (select auth.uid()) then
    raise exception 'Pesanan tidak ditemukan' using errcode = 'P0002';
  end if;
  if v_order.order_status <> 'pending' then
    raise exception 'Pesanan sudah diproses kafe. Hubungi kafe untuk membatalkan.' using errcode = '22023';
  end if;
  if v_order.payment_status = 'paid' or coalesce(v_order.paid_amount, 0) > 0 then
    raise exception 'Pesanan sudah dibayar. Hubungi kafe untuk pembatalan & refund.' using errcode = '22023';
  end if;
  update public.orders
  set order_status = 'cancelled',
      cancel_reason = coalesce(public.inv_clean_text(p_reason, 300), 'Dibatalkan pelanggan'),
      cancelled_at = now(),
      cancelled_by = 'customer',
      updated_at = now()
  where id = p_order_id
  returning * into v_order;
  return v_order;
end;
$$;
revoke all on function public.customer_cancel_order(uuid, text) from public, anon;
grant execute on function public.customer_cancel_order(uuid, text) to authenticated;

-- Hitung ulang service → pajak → pembulatan dengan diskon baru (rumus sama dengan place_order)
create or replace function public.ord_reprice(p_order_id uuid, p_discount numeric, p_reason text)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_settings public.cafe_settings%rowtype;
  v_discount numeric(12, 2);
  v_base numeric(12, 2);
  v_service numeric(12, 2) := 0;
  v_tax_base numeric(12, 2);
  v_tax numeric(12, 2) := 0;
  v_before numeric(12, 2);
  v_total numeric(12, 2);
begin
  select * into v_order from public.orders o where o.id = p_order_id for update;
  select * into v_settings from public.cafe_settings s where s.cafe_id = v_order.cafe_id;
  v_discount := least(greatest(round(coalesce(p_discount, 0), 0), 0), v_order.subtotal_amount);
  v_base := v_order.subtotal_amount - v_discount;
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
  set discount_amount = v_discount,
      discount_reason = case when v_discount > 0 then p_reason end,
      service_charge_amount = v_service,
      tax_amount = v_tax,
      rounding_amount = v_total - v_before,
      total_amount = v_total
  where id = p_order_id;
  return v_discount;
end;
$$;
revoke all on function public.ord_reprice(uuid, numeric, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- E2. Evaluasi voucher (dipakai pratinjau & checkout)
-- ---------------------------------------------------------------------
create or replace function public.voucher_evaluate(p_cafe_id uuid, p_code text, p_customer uuid, p_subtotal numeric, p_lock boolean default false)
returns table (voucher_id uuid, voucher_name text, discount numeric, problem text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
  v public.vouchers%rowtype;
  v_used integer;
  v_mine integer;
  v_discount numeric(12, 2);
begin
  if v_code = '' then
    return query select null::uuid, null::text, 0::numeric, 'Masukkan kode voucher';
    return;
  end if;
  if p_lock then
    select * into v from public.vouchers x where x.cafe_id = p_cafe_id and x.code = v_code for update;
  else
    select * into v from public.vouchers x where x.cafe_id = p_cafe_id and x.code = v_code;
  end if;
  if v.id is null or not v.is_active then
    return query select null::uuid, null::text, 0::numeric, 'Kode voucher tidak ditemukan';
    return;
  end if;
  if v.starts_at is not null and now() < v.starts_at then
    return query select v.id, v.name, 0::numeric, 'Voucher belum berlaku';
    return;
  end if;
  if v.ends_at is not null and now() >= v.ends_at then
    return query select v.id, v.name, 0::numeric, 'Voucher sudah berakhir';
    return;
  end if;
  if coalesce(p_subtotal, 0) < v.min_subtotal then
    return query select v.id, v.name, 0::numeric, 'Minimal belanja Rp ' || replace(to_char(v.min_subtotal, 'FM999,999,999,990'), ',', '.') || ' untuk voucher ini';
    return;
  end if;
  select count(*) into v_used from public.voucher_redemptions r where r.voucher_id = v.id and r.status = 'applied';
  if v.usage_limit is not null and v_used >= v.usage_limit then
    return query select v.id, v.name, 0::numeric, 'Kuota voucher sudah habis';
    return;
  end if;
  if p_customer is not null then
    select count(*) into v_mine from public.voucher_redemptions r where r.voucher_id = v.id and r.status = 'applied' and r.customer_id = p_customer;
    if v_mine >= v.per_customer_limit then
      return query select v.id, v.name, 0::numeric, 'Kamu sudah memakai voucher ini';
      return;
    end if;
  end if;
  v_discount := case when v.discount_type = 'percent' then round(coalesce(p_subtotal, 0) * v.discount_value / 100, 0) else v.discount_value end;
  if v.max_discount is not null then
    v_discount := least(v_discount, v.max_discount);
  end if;
  v_discount := least(v_discount, coalesce(p_subtotal, 0));
  return query select v.id, v.name, v_discount, null::text;
end;
$$;
revoke all on function public.voucher_evaluate(uuid, text, uuid, numeric, boolean) from public, anon, authenticated;

create or replace function public.voucher_check(p_cafe_id uuid, p_code text, p_subtotal numeric)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    return jsonb_build_object('ok', false, 'name', null, 'discount', 0, 'message', 'Masuk ke akun customer untuk memakai voucher.');
  end if;

  return (
    select jsonb_build_object('ok', e.problem is null, 'name', e.voucher_name, 'discount', e.discount, 'message', e.problem)
    from public.voucher_evaluate(p_cafe_id, p_code, (select auth.uid()), p_subtotal, false) e
  );
end;
$$;
revoke all on function public.voucher_check(uuid, text, numeric) from public, anon;
grant execute on function public.voucher_check(uuid, text, numeric) to authenticated;

-- ---------------------------------------------------------------------
-- F. Loyalti
-- ---------------------------------------------------------------------
create table if not exists public.loyalty_accounts (
  cafe_id uuid not null references public.cafes (id) on delete cascade,
  customer_id uuid not null references auth.users (id) on delete cascade,
  points_balance integer not null default 0,
  lifetime_points integer not null default 0,
  lifetime_spend numeric(14, 2) not null default 0,
  tier text,
  updated_at timestamptz not null default now(),
  primary key (cafe_id, customer_id)
);

create table if not exists public.loyalty_ledger (
  id uuid primary key default gen_random_uuid(),
  cafe_id uuid not null references public.cafes (id) on delete cascade,
  customer_id uuid not null references auth.users (id) on delete cascade,
  order_id uuid references public.orders (id) on delete set null,
  refund_id uuid references public.refunds (id) on delete set null,
  kind text not null check (kind in ('earn', 'redeem', 'redeem_return', 'refund', 'adjust')),
  points integer not null check (points <> 0),
  balance_after integer not null,
  note text check (note is null or char_length(note) <= 200),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists loyalty_ledger_customer_idx on public.loyalty_ledger (cafe_id, customer_id, created_at desc);
create unique index if not exists loyalty_ledger_order_once on public.loyalty_ledger (order_id, kind)
  where order_id is not null and kind in ('earn', 'redeem', 'redeem_return');
create unique index if not exists loyalty_ledger_refund_once on public.loyalty_ledger (refund_id) where refund_id is not null;

-- Tingkat member: tier tertinggi yang min_spend-nya terpenuhi
create or replace function public.loyalty_tier_for(p_tiers jsonb, p_spend numeric)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    (select t from jsonb_array_elements(coalesce(p_tiers, '[]'::jsonb)) t
     where coalesce((t ->> 'min_spend')::numeric, 0) <= coalesce(p_spend, 0)
     order by coalesce((t ->> 'min_spend')::numeric, 0) desc limit 1),
    jsonb_build_object('name', 'Member', 'min_spend', 0, 'multiplier', 1)
  )
$$;

-- Satu-satunya jalur mengubah saldo poin
create or replace function public.loyalty_post(
  p_cafe_id uuid, p_customer uuid, p_kind text, p_points integer, p_order uuid, p_refund uuid, p_note text, p_spend_delta numeric default 0
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account public.loyalty_accounts%rowtype;
  v_tiers jsonb;
begin
  insert into public.loyalty_accounts (cafe_id, customer_id) values (p_cafe_id, p_customer) on conflict do nothing;
  select * into v_account from public.loyalty_accounts a where a.cafe_id = p_cafe_id and a.customer_id = p_customer for update;
  select s.loyalty_tiers into v_tiers from public.cafe_settings s where s.cafe_id = p_cafe_id;
  update public.loyalty_accounts
  set points_balance = points_balance + coalesce(p_points, 0),
      lifetime_points = lifetime_points + case
        when p_kind in ('earn', 'adjust') then greatest(coalesce(p_points, 0), 0)
        when p_kind = 'refund' then coalesce(p_points, 0)
        else 0 end,
      lifetime_spend = greatest(lifetime_spend + coalesce(p_spend_delta, 0), 0),
      tier = public.loyalty_tier_for(v_tiers, greatest(lifetime_spend + coalesce(p_spend_delta, 0), 0)) ->> 'name',
      updated_at = now()
  where cafe_id = p_cafe_id and customer_id = p_customer
  returning * into v_account;
  if coalesce(p_points, 0) <> 0 then
    insert into public.loyalty_ledger (cafe_id, customer_id, order_id, refund_id, kind, points, balance_after, note)
    values (p_cafe_id, p_customer, p_order, p_refund, p_kind, p_points, v_account.points_balance, left(p_note, 200));
  end if;
  return v_account.points_balance;
end;
$$;
revoke all on function public.loyalty_post(uuid, uuid, text, integer, uuid, uuid, text, numeric) from public, anon, authenticated;

-- Pesanan selesai → poin; pesanan batal → voucher & poin yang ditukar dikembalikan
create or replace function public.loy_on_order_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings public.cafe_settings%rowtype;
  v_spend numeric;
  v_tier jsonb;
  v_points integer;
begin
  if new.order_status is not distinct from old.order_status then
    return null;
  end if;
  if new.order_status = 'cancelled' then
    update public.voucher_redemptions set status = 'released', released_at = now() where order_id = new.id and status = 'applied';
    if new.customer_id is not null and new.points_redeemed > 0
       and exists (select 1 from public.loyalty_ledger l where l.order_id = new.id and l.kind = 'redeem')
       and not exists (select 1 from public.loyalty_ledger l where l.order_id = new.id and l.kind = 'redeem_return') then
      perform public.loyalty_post(new.cafe_id, new.customer_id, 'redeem_return', new.points_redeemed, new.id, null, 'Pesanan dibatalkan', 0);
    end if;
    return null;
  end if;
  if new.order_status <> 'completed' or new.customer_id is null then
    return null;
  end if;
  select * into v_settings from public.cafe_settings s where s.cafe_id = new.cafe_id;
  if not coalesce(v_settings.loyalty_enabled, false) or exists (select 1 from public.loyalty_ledger l where l.order_id = new.id and l.kind = 'earn') then
    return null;
  end if;
  select coalesce(a.lifetime_spend, 0) into v_spend from public.loyalty_accounts a where a.cafe_id = new.cafe_id and a.customer_id = new.customer_id;
  v_tier := public.loyalty_tier_for(v_settings.loyalty_tiers, coalesce(v_spend, 0));
  v_points := floor(greatest(new.total_amount - coalesce(new.refunded_amount, 0), 0) / v_settings.loyalty_spend_per_point
                    * coalesce((v_tier ->> 'multiplier')::numeric, 1));
  perform public.loyalty_post(new.cafe_id, new.customer_id, 'earn', v_points, new.id, null,
    'Pesanan ' || coalesce('#' || new.queue_number::text, left(new.id::text, 8)), greatest(new.total_amount - coalesce(new.refunded_amount, 0), 0));
  return null;
end;
$$;
revoke all on function public.loy_on_order_status() from public, anon, authenticated;
drop trigger if exists loy_order_status on public.orders;
create trigger loy_order_status after update of order_status on public.orders
  for each row execute function public.loy_on_order_status();

-- Refund disetujui → poin dari pesanan itu dikurangi sebanding
create or replace function public.loy_on_refund()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_earned integer;
  v_taken integer;
  v_points integer;
begin
  if new.status <> 'approved' or (tg_op = 'UPDATE' and old.status = 'approved') then
    return null;
  end if;
  select * into v_order from public.orders o where o.id = new.order_id;
  if v_order.customer_id is null then
    return null;
  end if;
  select coalesce(sum(l.points), 0) into v_earned from public.loyalty_ledger l where l.order_id = v_order.id and l.kind = 'earn';
  if v_earned <= 0 then
    return null;
  end if;
  select coalesce(-sum(l.points), 0) into v_taken from public.loyalty_ledger l where l.order_id = v_order.id and l.kind = 'refund';
  v_points := least(ceil(v_earned * new.amount / nullif(v_order.total_amount, 0))::integer, v_earned - v_taken);
  if v_points > 0 then
    perform public.loyalty_post(v_order.cafe_id, v_order.customer_id, 'refund', -v_points, v_order.id, new.id, 'Refund pesanan', -new.amount);
  end if;
  return null;
end;
$$;
revoke all on function public.loy_on_refund() from public, anon, authenticated;
drop trigger if exists loy_refund on public.refunds;
create trigger loy_refund after insert or update of status on public.refunds
  for each row execute function public.loy_on_refund();

-- Ringkasan loyalti untuk customer
create or replace function public.loyalty_me(p_cafe_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_settings public.cafe_settings%rowtype;
  v_account public.loyalty_accounts%rowtype;
  v_tier jsonb;
  v_next jsonb;
begin
  select * into v_settings from public.cafe_settings s where s.cafe_id = p_cafe_id;
  if not coalesce(v_settings.loyalty_enabled, false) then
    return jsonb_build_object('enabled', false);
  end if;
  select * into v_account from public.loyalty_accounts a where a.cafe_id = p_cafe_id and a.customer_id = v_uid;
  v_tier := public.loyalty_tier_for(v_settings.loyalty_tiers, coalesce(v_account.lifetime_spend, 0));
  select t into v_next from jsonb_array_elements(v_settings.loyalty_tiers) t
  where coalesce((t ->> 'min_spend')::numeric, 0) > coalesce(v_account.lifetime_spend, 0)
  order by (t ->> 'min_spend')::numeric limit 1;
  return jsonb_build_object(
    'enabled', true,
    'balance', coalesce(v_account.points_balance, 0),
    'lifetime_points', coalesce(v_account.lifetime_points, 0),
    'lifetime_spend', coalesce(v_account.lifetime_spend, 0),
    'tier', v_tier, 'next_tier', v_next, 'tiers', v_settings.loyalty_tiers,
    'spend_per_point', v_settings.loyalty_spend_per_point, 'point_value', v_settings.loyalty_point_value,
    'min_redeem', v_settings.loyalty_min_redeem, 'max_redeem_pct', v_settings.loyalty_max_redeem_pct
  );
end;
$$;
revoke all on function public.loyalty_me(uuid) from public, anon;
grant execute on function public.loyalty_me(uuid) to authenticated;

-- Owner: daftar member & penyesuaian poin manual
create or replace function public.loyalty_customers(p_cafe_id uuid)
returns table (customer_id uuid, full_name text, points_balance integer, lifetime_points integer, lifetime_spend numeric, tier text, orders integer, last_order_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not public.is_cafe_member(p_cafe_id, array['owner']) then
    raise exception 'Hanya owner' using errcode = '42501';
  end if;
  return query
  select a.customer_id, p.full_name, a.points_balance, a.lifetime_points, a.lifetime_spend, a.tier,
         (select count(*)::integer from public.orders o where o.cafe_id = p_cafe_id and o.customer_id = a.customer_id and o.order_status = 'completed'),
         (select max(o.created_at) from public.orders o where o.cafe_id = p_cafe_id and o.customer_id = a.customer_id)
  from public.loyalty_accounts a
  left join public.profiles p on p.id = a.customer_id
  where a.cafe_id = p_cafe_id
  order by a.lifetime_spend desc;
end;
$$;
revoke all on function public.loyalty_customers(uuid) from public, anon;
grant execute on function public.loyalty_customers(uuid) to authenticated;

create or replace function public.loyalty_adjust(p_cafe_id uuid, p_customer_id uuid, p_points integer, p_note text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_balance integer;
begin
  if not public.is_cafe_member(p_cafe_id, array['owner']) then
    raise exception 'Hanya owner' using errcode = '42501';
  end if;
  if coalesce(p_points, 0) = 0 or abs(p_points) > 100000 then
    raise exception 'Isi jumlah poin (bukan 0)' using errcode = '22023';
  end if;
  if char_length(coalesce(public.inv_clean_text(p_note, 200), '')) < 3 then
    raise exception 'Tulis alasan penyesuaian' using errcode = '22023';
  end if;
  if not exists (select 1 from public.loyalty_accounts a where a.cafe_id = p_cafe_id and a.customer_id = p_customer_id) then
    raise exception 'Member tidak ditemukan' using errcode = 'P0002';
  end if;
  select a.points_balance into v_balance from public.loyalty_accounts a where a.cafe_id = p_cafe_id and a.customer_id = p_customer_id;
  if v_balance + p_points < 0 then
    raise exception 'Saldo poin tidak cukup' using errcode = '22023';
  end if;
  return public.loyalty_post(p_cafe_id, p_customer_id, 'adjust', p_points, null, null, public.inv_clean_text(p_note, 200), 0);
end;
$$;
revoke all on function public.loyalty_adjust(uuid, uuid, integer, text) from public, anon;
grant execute on function public.loyalty_adjust(uuid, uuid, integer, text) to authenticated;

-- ---------------------------------------------------------------------
-- C. Checkout customer
-- ---------------------------------------------------------------------
create or replace function public.customer_place_order(
  p_cafe_id uuid,
  p_items jsonb,
  p_order_type text default null,
  p_table_token text default null,
  p_notes text default null,
  p_payment_method text default null,
  p_idempotency_key text default null,
  p_scheduled_for timestamptz default null,
  p_voucher_code text default null,
  p_redeem_points integer default 0
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_existing uuid;
  v_hours jsonb;
  v_settings public.cafe_settings%rowtype;
  v_table public.cafe_tables%rowtype;
  v_order_id uuid;
  v_order public.orders%rowtype;
  v_voucher_id uuid;
  v_voucher_problem text;
  v_voucher_discount numeric(12, 2) := 0;
  v_points integer := greatest(coalesce(p_redeem_points, 0), 0);
  v_points_discount numeric(12, 2) := 0;
  v_balance integer;
  v_cap numeric(12, 2);
  v_reason text;
  v_next timestamptz;
begin
  if v_uid is null then
    raise exception 'Login diperlukan untuk membuat pesanan' using errcode = '28000';
  end if;
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
     and (nullif(btrim(coalesce(p_voucher_code, '')), '') is not null or coalesce(p_redeem_points, 0) > 0) then
    raise exception 'Masuk ke akun customer untuk memakai voucher atau poin.'
      using errcode = '42501', hint = 'member_benefits_required';
  end if;
  -- Kunci anti-dobel dipegang sejak awal (place_order memakai kunci yang sama)
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

  select c.opening_hours into v_hours from public.cafes c where c.id = p_cafe_id;
  if not found then
    raise exception 'Kafe tidak ditemukan' using errcode = '22023';
  end if;
  select * into v_settings from public.cafe_settings s where s.cafe_id = p_cafe_id;

  if coalesce(v_settings.ordering_paused, false) then
    raise exception '%', coalesce('Kafe sedang tidak menerima pesanan: ' || v_settings.ordering_message, 'Kafe sedang tidak menerima pesanan dari aplikasi. Coba lagi nanti.')
      using errcode = 'P0001', hint = 'ordering_paused';
  end if;

  if p_table_token is not null then
    select * into v_table from public.cafe_tables t where t.qr_token = p_table_token;
    if not found then
      raise exception 'QR meja tidak valid. Scan ulang QR di meja.' using errcode = '22023', hint = 'table_invalid';
    end if;
    if v_table.cafe_id <> p_cafe_id then
      raise exception 'QR meja ini milik kafe lain.' using errcode = '42501', hint = 'table_other_cafe';
    end if;
    if not v_table.is_active then
      raise exception 'Meja % sedang tidak dipakai. Hubungi kasir.', v_table.label using errcode = '22023', hint = 'table_inactive';
    end if;
    if not coalesce(v_settings.qr_ordering_enabled, true) then
      raise exception 'Pesan lewat QR meja sedang dinonaktifkan kafe.' using errcode = 'P0001', hint = 'qr_disabled';
    end if;
    if p_scheduled_for is not null then
      raise exception 'Pesanan dari meja tidak bisa dijadwalkan' using errcode = '22023';
    end if;
  end if;

  if p_scheduled_for is not null then
    if not coalesce(v_settings.scheduled_orders_enabled, false) then
      raise exception 'Kafe ini belum menerima pesanan terjadwal' using errcode = 'P0001', hint = 'scheduled_disabled';
    end if;
    if p_scheduled_for < now() + interval '15 minutes' or p_scheduled_for > now() + interval '7 days' then
      raise exception 'Jadwal ambil minimal 15 menit dari sekarang, maksimal 7 hari' using errcode = '22023';
    end if;
    if not public.cafe_open_at(v_hours, p_scheduled_for) then
      raise exception 'Kafe tutup pada jam yang dipilih' using errcode = '22023', hint = 'scheduled_closed';
    end if;
  elsif not public.cafe_open_at(v_hours, now()) then
    v_next := public.cafe_next_open(v_hours, now());
    raise exception '%', 'Kafe sedang tutup' || coalesce('. Buka lagi ' || to_char(v_next at time zone 'Asia/Jakarta', 'DD/MM HH24:MI') || ' WIB', '')
      || case when coalesce(v_settings.scheduled_orders_enabled, false) then '. Kamu bisa menjadwalkan pesanan.' else '.' end
      using errcode = 'P0001', hint = 'cafe_closed';
  end if;

  v_order_id := public.place_order(
    p_cafe_id, p_items, 'app',
    case when v_table.id is not null then coalesce(p_order_type, 'dine_in') else p_order_type end,
    v_table.id, null, p_notes, null, p_payment_method, v_key
  );
  select * into v_order from public.orders o where o.id = v_order_id for update;

  -- Voucher
  if nullif(btrim(coalesce(p_voucher_code, '')), '') is not null then
    select e.voucher_id, e.discount, e.problem into v_voucher_id, v_voucher_discount, v_voucher_problem
    from public.voucher_evaluate(p_cafe_id, p_voucher_code, v_uid, v_order.subtotal_amount, true) e;
    if v_voucher_problem is not null then
      raise exception '%', v_voucher_problem using errcode = '22023', hint = 'voucher_invalid';
    end if;
    insert into public.voucher_redemptions (cafe_id, voucher_id, order_id, customer_id, amount)
    values (p_cafe_id, v_voucher_id, v_order_id, v_uid, v_voucher_discount);
  end if;

  -- Tukar poin (dibatasi persen maksimal dari sisa subtotal)
  if v_points > 0 then
    if not coalesce(v_settings.loyalty_enabled, false) then
      raise exception 'Program poin tidak aktif di kafe ini' using errcode = '22023';
    end if;
    if v_points < v_settings.loyalty_min_redeem then
      raise exception 'Minimal tukar % poin', v_settings.loyalty_min_redeem using errcode = '22023';
    end if;
    select a.points_balance into v_balance from public.loyalty_accounts a where a.cafe_id = p_cafe_id and a.customer_id = v_uid for update;
    if coalesce(v_balance, 0) < v_points then
      raise exception 'Poin tidak cukup (saldo %)', coalesce(v_balance, 0) using errcode = '22023';
    end if;
    v_cap := floor((v_order.subtotal_amount - v_voucher_discount) * v_settings.loyalty_max_redeem_pct / 100);
    v_points := least(v_points, floor(v_cap / v_settings.loyalty_point_value)::integer);
    if v_points < v_settings.loyalty_min_redeem then
      raise exception 'Belanja terlalu kecil untuk menukar poin' using errcode = '22023';
    end if;
    v_points_discount := v_points * v_settings.loyalty_point_value;
    perform public.loyalty_post(p_cafe_id, v_uid, 'redeem', -v_points, v_order_id, null, 'Tukar poin', 0);
  end if;

  if v_voucher_discount + v_points_discount > 0 then
    v_reason := concat_ws(' + ',
      case when v_voucher_discount > 0 then 'Voucher ' || upper(btrim(p_voucher_code)) end,
      case when v_points > 0 then v_points || ' poin' end);
    perform public.ord_reprice(v_order_id, v_voucher_discount + v_points_discount, v_reason);
  end if;

  update public.orders
  set scheduled_for = p_scheduled_for,
      estimated_ready_at = coalesce(p_scheduled_for, now() + make_interval(mins => public.cafe_prep_minutes(p_cafe_id))),
      voucher_id = v_voucher_id,
      voucher_code = case when v_voucher_id is not null then upper(btrim(p_voucher_code)) end,
      voucher_discount = v_voucher_discount,
      points_redeemed = v_points,
      points_discount = v_points_discount
  where id = v_order_id;
  return v_order_id;
end;
$$;
revoke all on function public.customer_place_order(uuid, jsonb, text, text, text, text, text, timestamptz, text, integer) from public, anon;
grant execute on function public.customer_place_order(uuid, jsonb, text, text, text, text, text, timestamptz, text, integer) to authenticated;

-- App versi lama ikut aturan jam buka / jeda
create or replace function public.create_order(p_cafe_id uuid, p_items jsonb, p_payment_method text default null, p_notes text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  return public.customer_place_order(p_cafe_id, p_items, null, null, p_notes, p_payment_method);
end;
$$;
revoke all on function public.create_order(uuid, jsonb, text, text) from public, anon;
grant execute on function public.create_order(uuid, jsonb, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- G. Pesan ulang: item lama dengan harga & ketersediaan terkini
-- ---------------------------------------------------------------------
create or replace function public.customer_reorder_items(p_order_id uuid)
returns table (product_id uuid, name text, quantity integer, option_ids uuid[], options_label text, old_unit_price numeric, unit_price numeric, available boolean, note text)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders o where o.id = p_order_id;
  if not found or v_order.customer_id is distinct from (select auth.uid()) then
    raise exception 'Pesanan tidak ditemukan' using errcode = 'P0002';
  end if;
  return query
  with avail as (select a.product_id, a.available from public.product_availability(v_order.cafe_id) a),
  lines as (
    select i.id, i.product_id, i.product_name, i.quantity, i.price, i.notes,
           coalesce(array_agg(io.option_id) filter (where io.option_id is not null), '{}'::uuid[]) as old_options
    from public.order_items i
    left join public.order_item_options io on io.order_item_id = i.id
    where i.order_id = p_order_id
    group by i.id
  ),
  priced as (
    select l.*, p.id as live_id, p.name as live_name, p.price as live_price, coalesce(av.available, p.is_available) as live_available,
           coalesce(array_agg(o.id order by g.sort_order, o.sort_order) filter (where o.id is not null and o.is_available), '{}'::uuid[]) as keep_options,
           coalesce(sum(o.price_delta) filter (where o.is_available), 0) as delta,
           string_agg(o.name, ', ' order by g.sort_order, o.sort_order) filter (where o.is_available) as label,
           count(o.id) filter (where not o.is_available) as dropped,
           cardinality(l.old_options) - count(o.id) as missing
    from lines l
    left join public.products p on p.id = l.product_id and p.cafe_id = v_order.cafe_id
    left join avail av on av.product_id = p.id
    left join public.product_options o on o.id = any (l.old_options)
    left join public.product_option_groups g on g.id = o.group_id and g.product_id = p.id
    group by l.id, l.product_id, l.product_name, l.quantity, l.price, l.notes, l.old_options, p.id, p.name, p.price, av.available, p.is_available
  )
  select coalesce(x.live_id, x.product_id), coalesce(x.live_name, x.product_name), x.quantity, x.keep_options, x.label,
         x.price, case when x.live_id is not null then x.live_price + x.delta end,
         x.live_id is not null and x.live_available,
         case when x.live_id is null then 'Menu sudah tidak dijual'
              when not x.live_available then 'Sedang habis'
              when x.dropped + x.missing > 0 then 'Sebagian pilihan tidak tersedia'
              when x.live_price + x.delta <> x.price then 'Harga berubah' end
  from priced x
  order by x.id;
end;
$$;
revoke all on function public.customer_reorder_items(uuid) from public, anon;
grant execute on function public.customer_reorder_items(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- H. Ulasan & wishlist
-- ---------------------------------------------------------------------
create table if not exists public.product_reviews (
  id uuid primary key default gen_random_uuid(),
  cafe_id uuid not null references public.cafes (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  order_id uuid not null references public.orders (id) on delete cascade,
  customer_id uuid not null references auth.users (id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  comment text check (comment is null or char_length(comment) <= 500),
  is_hidden boolean not null default false,
  reply text check (reply is null or char_length(reply) <= 500),
  replied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_reviews_once unique (order_id, product_id)
);
create index if not exists product_reviews_product_idx on public.product_reviews (product_id, created_at desc);
create index if not exists product_reviews_cafe_idx on public.product_reviews (cafe_id, created_at desc);

create or replace function public.review_submit(p_order_id uuid, p_product_id uuid, p_rating integer, p_comment text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_id uuid;
begin
  select * into v_order from public.orders o where o.id = p_order_id;
  if not found or v_order.customer_id is distinct from (select auth.uid()) then
    raise exception 'Pesanan tidak ditemukan' using errcode = 'P0002';
  end if;
  if v_order.order_status <> 'completed' then
    raise exception 'Ulasan bisa diberikan setelah pesanan selesai' using errcode = '22023';
  end if;
  if v_order.created_at < now() - interval '60 days' then
    raise exception 'Batas memberi ulasan 60 hari setelah pesanan' using errcode = '22023';
  end if;
  if not exists (select 1 from public.order_items i where i.order_id = p_order_id and i.product_id = p_product_id) then
    raise exception 'Menu ini tidak ada di pesanan' using errcode = '22023';
  end if;
  if p_rating is null or p_rating not between 1 and 5 then
    raise exception 'Pilih 1–5 bintang' using errcode = '22023';
  end if;
  insert into public.product_reviews (cafe_id, product_id, order_id, customer_id, rating, comment)
  values (v_order.cafe_id, p_product_id, p_order_id, v_order.customer_id, p_rating, public.inv_clean_text(p_comment, 500))
  on conflict (order_id, product_id) do update
  set rating = excluded.rating, comment = excluded.comment, updated_at = now()
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.review_submit(uuid, uuid, integer, text) from public, anon;
grant execute on function public.review_submit(uuid, uuid, integer, text) to authenticated;

create or replace function public.product_rating_summary(p_cafe_id uuid)
returns table (product_id uuid, rating numeric, reviews integer)
language sql
stable
security definer
set search_path = ''
as $$
  select r.product_id, round(avg(r.rating)::numeric, 1), count(*)::integer
  from public.product_reviews r
  where r.cafe_id = p_cafe_id and not r.is_hidden
  group by r.product_id
$$;
revoke all on function public.product_rating_summary(uuid) from public;
grant execute on function public.product_rating_summary(uuid) to anon, authenticated;

-- Ulasan publik: nama disingkat (privasi), tanpa id customer
create or replace function public.product_reviews_public(p_product_id uuid, p_limit integer default 20)
returns table (id uuid, rating smallint, comment text, reply text, created_at timestamptz, reviewer text, is_mine boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.rating, r.comment, r.reply, r.created_at,
         coalesce(nullif(split_part(btrim(p.full_name), ' ', 1), '') || case when position(' ' in btrim(p.full_name)) > 0
           then ' ' || left(split_part(btrim(p.full_name), ' ', 2), 1) || '.' else '' end, 'Pelanggan'),
         r.customer_id = (select auth.uid())
  from public.product_reviews r
  left join public.profiles p on p.id = r.customer_id
  where r.product_id = p_product_id and not r.is_hidden
  order by r.created_at desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50)
$$;
revoke all on function public.product_reviews_public(uuid, integer) from public;
grant execute on function public.product_reviews_public(uuid, integer) to anon, authenticated;

create or replace function public.review_moderate(p_review_id uuid, p_hidden boolean, p_reply text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_review public.product_reviews%rowtype;
  v_reply text := public.inv_clean_text(p_reply, 500);
begin
  select * into v_review from public.product_reviews r where r.id = p_review_id for update;
  if not found or not public.is_cafe_member(v_review.cafe_id, array['owner']) then
    raise exception 'Ulasan tidak ditemukan' using errcode = 'P0002';
  end if;
  update public.product_reviews
  set is_hidden = coalesce(p_hidden, is_hidden),
      reply = v_reply,
      replied_at = case when v_reply is distinct from v_review.reply then case when v_reply is null then null else now() end else replied_at end
  where id = p_review_id;
end;
$$;
revoke all on function public.review_moderate(uuid, boolean, text) from public, anon;
grant execute on function public.review_moderate(uuid, boolean, text) to authenticated;

create table if not exists public.wishlist_items (
  customer_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  cafe_id uuid,
  created_at timestamptz not null default now(),
  primary key (customer_id, product_id)
);

-- cafe_id diambil dari produk, tidak dipercaya dari klien
create or replace function public.wishlist_fill_cafe()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select p.cafe_id into new.cafe_id from public.products p where p.id = new.product_id;
  new.customer_id := (select auth.uid());
  return new;
end;
$$;
revoke all on function public.wishlist_fill_cafe() from public, anon, authenticated;
drop trigger if exists wishlist_fill_cafe on public.wishlist_items;
create trigger wishlist_fill_cafe before insert on public.wishlist_items for each row execute function public.wishlist_fill_cafe();

-- ---------------------------------------------------------------------
-- I. Bantuan (tiket)
-- ---------------------------------------------------------------------
create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  cafe_id uuid not null references public.cafes (id) on delete cascade,
  customer_id uuid not null references auth.users (id) on delete cascade,
  order_id uuid references public.orders (id) on delete set null,
  subject text not null check (char_length(subject) between 3 and 120),
  status text not null default 'open' check (status in ('open', 'answered', 'closed')),
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
create index if not exists support_tickets_cafe_idx on public.support_tickets (cafe_id, status, last_message_at desc);
create index if not exists support_tickets_customer_idx on public.support_tickets (customer_id, last_message_at desc);

create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets (id) on delete cascade,
  cafe_id uuid not null references public.cafes (id) on delete cascade,
  sender text not null check (sender in ('customer', 'cafe')),
  author_id uuid default auth.uid(),
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists support_messages_ticket_idx on public.support_messages (ticket_id, created_at);

create or replace function public.support_open(p_cafe_id uuid, p_subject text, p_body text, p_order_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_id uuid;
begin
  if v_uid is null or not exists (select 1 from public.profiles p where p.id = v_uid and p.role = 'customer') then
    raise exception 'Masuk sebagai customer untuk menghubungi kafe' using errcode = '42501';
  end if;
  if not exists (select 1 from public.cafes c where c.id = p_cafe_id) then
    raise exception 'Kafe tidak ditemukan' using errcode = '22023';
  end if;
  if p_order_id is not null and not exists (select 1 from public.orders o where o.id = p_order_id and o.customer_id = v_uid and o.cafe_id = p_cafe_id) then
    raise exception 'Pesanan tidak ditemukan' using errcode = 'P0002';
  end if;
  if char_length(coalesce(public.inv_clean_text(p_subject, 120), '')) < 3 or char_length(coalesce(btrim(p_body), '')) < 3 then
    raise exception 'Tulis judul dan pesan (min. 3 huruf)' using errcode = '22023';
  end if;
  if (select count(*) from public.support_tickets t where t.customer_id = v_uid and t.created_at > now() - interval '1 hour') >= 5 then
    raise exception 'Terlalu banyak tiket. Coba lagi nanti.' using errcode = '22023';
  end if;
  insert into public.support_tickets (cafe_id, customer_id, order_id, subject)
  values (p_cafe_id, v_uid, p_order_id, public.inv_clean_text(p_subject, 120))
  returning id into v_id;
  insert into public.support_messages (ticket_id, cafe_id, sender, body) values (v_id, p_cafe_id, 'customer', left(btrim(p_body), 2000));
  return v_id;
end;
$$;
revoke all on function public.support_open(uuid, text, text, uuid) from public, anon;
grant execute on function public.support_open(uuid, text, text, uuid) to authenticated;

create or replace function public.support_reply(p_ticket_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_ticket public.support_tickets%rowtype;
  v_sender text;
  v_id uuid;
begin
  select * into v_ticket from public.support_tickets t where t.id = p_ticket_id for update;
  if not found then
    raise exception 'Tiket tidak ditemukan' using errcode = 'P0002';
  end if;
  if v_ticket.customer_id = v_uid then
    v_sender := 'customer';
  elsif public.is_cafe_member(v_ticket.cafe_id) then
    v_sender := 'cafe';
  else
    raise exception 'Tiket tidak ditemukan' using errcode = 'P0002';
  end if;
  if char_length(coalesce(btrim(p_body), '')) < 1 then
    raise exception 'Tulis pesan' using errcode = '22023';
  end if;
  insert into public.support_messages (ticket_id, cafe_id, sender, body) values (v_ticket.id, v_ticket.cafe_id, v_sender, left(btrim(p_body), 2000))
  returning id into v_id;
  update public.support_tickets
  set status = case when v_sender = 'cafe' then 'answered' else 'open' end, last_message_at = now(), closed_at = null
  where id = v_ticket.id;
  return v_id;
end;
$$;
revoke all on function public.support_reply(uuid, text) from public, anon;
grant execute on function public.support_reply(uuid, text) to authenticated;

create or replace function public.support_close(p_ticket_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ticket public.support_tickets%rowtype;
begin
  select * into v_ticket from public.support_tickets t where t.id = p_ticket_id for update;
  if not found or not (v_ticket.customer_id = (select auth.uid()) or public.is_cafe_member(v_ticket.cafe_id)) then
    raise exception 'Tiket tidak ditemukan' using errcode = 'P0002';
  end if;
  update public.support_tickets set status = 'closed', closed_at = now() where id = p_ticket_id;
end;
$$;
revoke all on function public.support_close(uuid) from public, anon;
grant execute on function public.support_close(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- J. Notifikasi & token push
--    Baris notifications = kotak masuk di app. Pengiriman push dilakukan Edge Function
--    push-send (dipanggil Database Webhook saat baris baru dibuat).
-- ---------------------------------------------------------------------
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  cafe_id uuid references public.cafes (id) on delete cascade,
  kind text not null check (kind in ('order', 'support', 'loyalty', 'info')),
  title text not null check (char_length(title) between 1 and 120),
  body text check (body is null or char_length(body) <= 300),
  data jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  push_status text not null default 'pending' check (push_status in ('pending', 'sent', 'skipped', 'failed')),
  push_attempted_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);

create table if not exists public.push_tokens (
  token text primary key check (char_length(token) between 10 and 300),
  user_id uuid not null references auth.users (id) on delete cascade,
  platform text check (platform is null or platform in ('ios', 'android', 'web')),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists push_tokens_user_idx on public.push_tokens (user_id);

create or replace function public.push_register(p_token text, p_platform text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Login diperlukan' using errcode = '28000';
  end if;
  if p_token is null or p_token !~ '^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$' then
    raise exception 'Token push tidak valid' using errcode = '22023';
  end if;
  -- Satu perangkat = satu pemilik: token pindah ke akun yang sedang masuk
  insert into public.push_tokens (token, user_id, platform) values (p_token, (select auth.uid()), p_platform)
  on conflict (token) do update set user_id = excluded.user_id, platform = excluded.platform, last_seen_at = now();
end;
$$;
revoke all on function public.push_register(text, text) from public, anon;
grant execute on function public.push_register(text, text) to authenticated;

create or replace function public.push_unregister(p_token text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.push_tokens where token = p_token and user_id = (select auth.uid())
$$;
revoke all on function public.push_unregister(text) from public, anon;
grant execute on function public.push_unregister(text) to authenticated;

create or replace function public.notifications_mark_read(p_ids uuid[] default null)
returns integer
language sql
security definer
set search_path = ''
as $$
  with updated as (
    update public.notifications set read_at = now()
    where user_id = (select auth.uid()) and read_at is null and (p_ids is null or id = any (p_ids))
    returning 1
  )
  select count(*)::integer from updated
$$;
revoke all on function public.notifications_mark_read(uuid[]) from public, anon;
grant execute on function public.notifications_mark_read(uuid[]) to authenticated;

create or replace function public.ntf_on_order_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ref text := coalesce('#' || new.queue_number::text, '#' || upper(left(new.id::text, 4)));
  v_title text;
  v_body text;
  v_points integer;
begin
  if new.customer_id is null or new.order_status is not distinct from old.order_status then
    return null;
  end if;
  if new.order_status = 'confirmed' then
    v_title := 'Pesanan ' || v_ref || ' diterima';
    v_body := 'Kafe sudah menerima pesananmu.';
  elsif new.order_status = 'preparing' then
    v_title := 'Pesanan ' || v_ref || ' sedang dibuat';
    v_body := case when new.estimated_ready_at is not null
      then 'Perkiraan siap ' || to_char(new.estimated_ready_at at time zone 'Asia/Jakarta', 'HH24:MI') || ' WIB.' end;
  elsif new.order_status = 'ready' then
    v_title := 'Pesanan ' || v_ref || ' siap';
    v_body := case when new.table_label is not null then 'Segera diantar ke meja ' || new.table_label || '.' else 'Silakan ambil di kasir.' end;
  elsif new.order_status = 'completed' then
    select coalesce(sum(l.points), 0) into v_points from public.loyalty_ledger l where l.order_id = new.id and l.kind = 'earn';
    v_title := 'Terima kasih!';
    v_body := 'Pesanan ' || v_ref || ' selesai.' || case when v_points > 0 then ' Kamu dapat ' || v_points || ' poin.' else '' end;
  elsif new.order_status = 'cancelled' and new.cancelled_by is distinct from 'customer' then
    v_title := 'Pesanan ' || v_ref || ' dibatalkan';
    v_body := coalesce('Alasan: ' || new.cancel_reason, 'Dibatalkan oleh kafe.');
  else
    return null;
  end if;
  insert into public.notifications (user_id, cafe_id, kind, title, body, data)
  values (new.customer_id, new.cafe_id, 'order', v_title, left(v_body, 300), jsonb_build_object('order_id', new.id, 'status', new.order_status));
  return null;
end;
$$;
revoke all on function public.ntf_on_order_status() from public, anon, authenticated;
drop trigger if exists ntf_order_status on public.orders;
create trigger ntf_order_status after update of order_status on public.orders
  for each row execute function public.ntf_on_order_status();

create or replace function public.ntf_on_support_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ticket public.support_tickets%rowtype;
begin
  if new.sender <> 'cafe' then
    return null;
  end if;
  select * into v_ticket from public.support_tickets t where t.id = new.ticket_id;
  insert into public.notifications (user_id, cafe_id, kind, title, body, data)
  values (v_ticket.customer_id, v_ticket.cafe_id, 'support', 'Balasan: ' || left(v_ticket.subject, 100), left(new.body, 300),
          jsonb_build_object('ticket_id', v_ticket.id));
  return null;
end;
$$;
revoke all on function public.ntf_on_support_message() from public, anon, authenticated;
drop trigger if exists ntf_support_message on public.support_messages;
create trigger ntf_support_message after insert on public.support_messages
  for each row execute function public.ntf_on_support_message();

-- ---------------------------------------------------------------------
-- RLS & hak akses
-- ---------------------------------------------------------------------
alter table public.vouchers enable row level security;
alter table public.voucher_redemptions enable row level security;
alter table public.loyalty_accounts enable row level security;
alter table public.loyalty_ledger enable row level security;
alter table public.product_reviews enable row level security;
alter table public.wishlist_items enable row level security;
alter table public.support_tickets enable row level security;
alter table public.support_messages enable row level security;
alter table public.notifications enable row level security;
alter table public.push_tokens enable row level security;

revoke all on public.vouchers, public.voucher_redemptions, public.loyalty_accounts, public.loyalty_ledger, public.product_reviews,
  public.wishlist_items, public.support_tickets, public.support_messages, public.notifications, public.push_tokens from anon, authenticated;

grant select on public.vouchers to anon, authenticated;
grant insert, update, delete on public.vouchers to authenticated;
drop policy if exists "Public vouchers are visible" on public.vouchers;
create policy "Public vouchers are visible" on public.vouchers for select to anon, authenticated
  using (is_public and is_active and (ends_at is null or ends_at > now()));
drop policy if exists "Owners manage vouchers" on public.vouchers;
create policy "Owners manage vouchers" on public.vouchers for all to authenticated
  using (public.is_cafe_member(cafe_id, array['owner'])) with check (public.is_cafe_member(cafe_id, array['owner']));

grant select on public.voucher_redemptions to authenticated;
drop policy if exists "Voucher redemptions visible to owner and customer" on public.voucher_redemptions;
create policy "Voucher redemptions visible to owner and customer" on public.voucher_redemptions for select to authenticated
  using (customer_id = (select auth.uid()) or public.is_cafe_member(cafe_id, array['owner']));

grant select on public.loyalty_accounts, public.loyalty_ledger to authenticated;
drop policy if exists "Loyalty visible to member and owner" on public.loyalty_accounts;
create policy "Loyalty visible to member and owner" on public.loyalty_accounts for select to authenticated
  using (customer_id = (select auth.uid()) or public.is_cafe_member(cafe_id, array['owner']));
drop policy if exists "Loyalty ledger visible to member and owner" on public.loyalty_ledger;
create policy "Loyalty ledger visible to member and owner" on public.loyalty_ledger for select to authenticated
  using (customer_id = (select auth.uid()) or public.is_cafe_member(cafe_id, array['owner']));

grant select on public.product_reviews to authenticated;
drop policy if exists "Reviews visible to author and owner" on public.product_reviews;
create policy "Reviews visible to author and owner" on public.product_reviews for select to authenticated
  using (customer_id = (select auth.uid()) or public.is_cafe_member(cafe_id, array['owner']));

grant select, insert, delete on public.wishlist_items to authenticated;
drop policy if exists "Own wishlist" on public.wishlist_items;
create policy "Own wishlist" on public.wishlist_items for all to authenticated
  using (customer_id = (select auth.uid())) with check (customer_id = (select auth.uid()));

grant select on public.support_tickets, public.support_messages to authenticated;
drop policy if exists "Tickets visible to customer and cafe" on public.support_tickets;
create policy "Tickets visible to customer and cafe" on public.support_tickets for select to authenticated
  using (customer_id = (select auth.uid()) or public.is_cafe_member(cafe_id));
drop policy if exists "Ticket messages visible to customer and cafe" on public.support_messages;
create policy "Ticket messages visible to customer and cafe" on public.support_messages for select to authenticated
  using (public.is_cafe_member(cafe_id) or exists (select 1 from public.support_tickets t where t.id = ticket_id and t.customer_id = (select auth.uid())));

grant select on public.notifications to authenticated;
drop policy if exists "Own notifications" on public.notifications;
create policy "Own notifications" on public.notifications for select to authenticated using (user_id = (select auth.uid()));

grant select on public.push_tokens to authenticated;
drop policy if exists "Own push tokens" on public.push_tokens;
create policy "Own push tokens" on public.push_tokens for select to authenticated using (user_id = (select auth.uid()));

-- Log aktivitas: voucher & moderasi ulasan
drop trigger if exists log_audit_event on public.vouchers;
create trigger log_audit_event after insert or update or delete on public.vouchers for each row execute function public.log_audit_event();

-- Realtime: kotak masuk & bantuan (bila publikasi supabase_realtime ada)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'notifications') then
      execute 'alter publication supabase_realtime add table public.notifications';
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'support_messages') then
      execute 'alter publication supabase_realtime add table public.support_messages';
    end if;
  end if;
end;
$$;

notify pgrst, 'reload schema';

commit;

-- Verifikasi: 10 tabel + 16 fungsi + 6 trigger = 32 baris
select 'table' as kind, table_name as name
from information_schema.tables
where table_schema = 'public'
  and table_name in ('vouchers', 'voucher_redemptions', 'loyalty_accounts', 'loyalty_ledger', 'product_reviews', 'wishlist_items',
                     'support_tickets', 'support_messages', 'notifications', 'push_tokens')
union all
select 'function', p.proname
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in (
  'cafe_status', 'cafe_set_ordering_paused', 'table_qr_resolve', 'cafe_tables_qr', 'table_qr_rotate', 'customer_place_order',
  'customer_cancel_order', 'customer_reorder_items', 'voucher_check', 'loyalty_me', 'loyalty_customers', 'loyalty_adjust',
  'review_submit', 'review_moderate', 'support_open', 'push_register'
)
union all
select 'trigger', t.tgname
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
where c.relnamespace = 'public'::regnamespace
  and t.tgname in ('ord_set_cancelled_by', 'loy_order_status', 'loy_refund', 'ntf_order_status', 'ntf_support_message', 'wishlist_fill_cafe')
order by 1, 2;
