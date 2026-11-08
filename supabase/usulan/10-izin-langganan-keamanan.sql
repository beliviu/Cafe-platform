-- =====================================================================
-- 10 · IZIN STAFF, LANGGANAN (SaaS) & PENGETATAN KEAMANAN (Fase 7 roadmap V2)
--   A. Izin per staff: owner memilih apa saja yang boleh dilakukan tiap staff
--      (kasir, diskon, konfirmasi non-tunai, batal, refund, kas laci, menu habis, jeda, balas pelanggan).
--      Ditegakkan di DATABASE (trigger), jadi berlaku untuk web, app, maupun panggilan API langsung.
--   B. Langganan: paket (fitur & batas), status langganan per kafe, hak fitur (entitlements),
--      batas staff/meja/produk, dan gerbang fitur (inventori, keuangan, loyalti, QR meja, QRIS online).
--   C. Pengetatan: RLS wajib di semua tabel publik, hak tulis anon dicabut, TRUNCATE/REFERENCES/TRIGGER
--      dicabut dari pengguna, index untuk query yang sering dipakai.
--   D. Kunci Midtrans per kafe (multi-merchant): fungsi server untuk mencari kafe dari tagihan.
--
-- Jalankan manual di Supabase SQL Editor SETELAH file 06 (07/08/09 tidak wajib; bagian yang
-- bergantung pada tabelnya dilewati otomatis bila belum ada).
-- Semua dalam satu transaksi: kalau ada error, tidak ada yang berubah.
--
-- Dampak ke data yang sudah ada:
--   - Staff yang ada: izin = SEMUA (perilaku lama). Owner mengubahnya per staff di menu Tim.
--   - Semua kafe yang ada mendapat paket "Enterprise" (semua fitur, tanpa batas) berstatus aktif →
--     tidak ada fitur yang tiba-tiba terkunci. Kafe BARU otomatis "Pro" masa coba 30 hari.
--   - Hak INSERT/UPDATE/DELETE pengguna anonim (belum login) dicabut di schema public — aplikasi tidak
--     pernah menulis tanpa login; semua penulisan lewat login/fungsi tetap jalan.
--   - RLS dinyalakan di tabel publik yang belum memakainya (mis. categories) dengan policy setara
--     perilaku sekarang (semua boleh membaca, owner kafe boleh mengubah).
-- =====================================================================

begin;

do $$
begin
  if to_regclass('public.refunds') is null then
    raise exception 'File 06-pesanan-v2-pos.sql belum dijalankan. Jalankan file 06 dulu.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- A. Izin per staff
-- ---------------------------------------------------------------------
alter table public.profiles add column if not exists staff_permissions text[]; -- null = semua izin

create or replace function public.staff_permission_catalog()
returns table (key text, label text, description text)
language sql
immutable
set search_path = ''
as $$
  values
    ('pos.sell', 'Kasir (POS)', 'Membuat pesanan di kasir'),
    ('pos.discount', 'Beri diskon', 'Diskon di kasir (tetap dibatasi persen maksimal staff)'),
    ('payment.manual', 'Konfirmasi non-tunai', 'Menandai lunas QRIS manual / transfer / e-wallet'),
    ('order.cancel', 'Batalkan pesanan', 'Membatalkan pesanan aktif'),
    ('refund.request', 'Ajukan refund', 'Mengajukan refund (tetap disetujui owner)'),
    ('cash.move', 'Kas masuk/keluar', 'Mengambil atau menambah uang laci di luar penjualan'),
    ('menu.availability', 'Atur menu habis', 'Menandai menu habis / tersedia'),
    ('ordering.pause', 'Jeda pesanan app', 'Menghentikan sementara pesanan dari aplikasi'),
    ('support.reply', 'Balas pelanggan', 'Membalas tiket bantuan pelanggan')
$$;
grant execute on function public.staff_permission_catalog() to authenticated;

-- Owner kafe: semua izin. Staff aktif: sesuai daftar (null = semua). Lainnya: tidak.
create or replace function public.has_staff_permission(p_cafe_id uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.cafe_id = p_cafe_id and coalesce(p.is_active, true)
      and (p.role = 'owner' or (p.role = 'staff' and (p.staff_permissions is null or p_permission = any (p.staff_permissions))))
  )
$$;
revoke all on function public.has_staff_permission(uuid, text) from public, anon;
grant execute on function public.has_staff_permission(uuid, text) to authenticated;

-- Dipanggil trigger: hanya membatasi STAFF kafe itu (owner, customer, server tidak terpengaruh)
create or replace function public.perm_guard(p_cafe_id uuid, p_permission text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_label text;
begin
  if v_uid is null or p_cafe_id is null then
    return;
  end if;
  if exists (select 1 from public.profiles p where p.id = v_uid and p.role = 'staff' and p.cafe_id = p_cafe_id)
     and not public.has_staff_permission(p_cafe_id, p_permission) then
    select c.label into v_label from public.staff_permission_catalog() c where c.key = p_permission;
    raise exception 'Kamu belum diberi izin "%". Minta owner mengaktifkannya di menu Tim.', coalesce(v_label, p_permission)
      using errcode = '42501', hint = 'permission_denied';
  end if;
end;
$$;
revoke all on function public.perm_guard(uuid, text) from public, anon, authenticated;

create or replace function public.staff_permissions_list(p_cafe_id uuid)
returns table (user_id uuid, permissions text[], all_permissions boolean)
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
  select p.id, coalesce(p.staff_permissions, (select array_agg(c.key) from public.staff_permission_catalog() c)), p.staff_permissions is null
  from public.profiles p where p.cafe_id = p_cafe_id and p.role = 'staff';
end;
$$;
revoke all on function public.staff_permissions_list(uuid) from public, anon;
grant execute on function public.staff_permissions_list(uuid) to authenticated;

create or replace function public.staff_set_permissions(p_user_id uuid, p_permissions text[])
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target public.profiles%rowtype;
  v_all text[];
  v_clean text[];
  v_bad text;
begin
  select * into v_target from public.profiles p where p.id = p_user_id;
  if not found or v_target.role <> 'staff' or not public.is_cafe_member(v_target.cafe_id, array['owner']) then
    raise exception 'Staff tidak ditemukan' using errcode = 'P0002';
  end if;
  select array_agg(c.key order by c.key) into v_all from public.staff_permission_catalog() c;
  select x into v_bad from unnest(coalesce(p_permissions, '{}')) x where not x = any (v_all) limit 1;
  if v_bad is not null then
    raise exception 'Izin tidak dikenal: %', v_bad using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct x order by x), '{}') into v_clean from unnest(coalesce(p_permissions, '{}')) x;
  update public.profiles set staff_permissions = case when v_clean @> v_all then null else v_clean end where id = p_user_id;
  insert into public.audit_logs (cafe_id, actor_id, action, entity, entity_id, label, changes)
  values (v_target.cafe_id, (select auth.uid()), 'update', 'staff_permissions', p_user_id::text, v_target.full_name,
          jsonb_build_object('izin', jsonb_build_array(to_jsonb(coalesce(v_target.staff_permissions, v_all)), to_jsonb(v_clean))));
  return v_clean;
end;
$$;
revoke all on function public.staff_set_permissions(uuid, text[]) from public, anon;
grant execute on function public.staff_set_permissions(uuid, text[]) to authenticated;

-- ---- Penegakan (trigger) ----
create or replace function public.perm_orders()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.source = 'pos' then
      perform public.perm_guard(new.cafe_id, 'pos.sell');
    end if;
    return new;
  end if;
  if new.order_status = 'cancelled' and old.order_status is distinct from 'cancelled' then
    perform public.perm_guard(new.cafe_id, 'order.cancel');
  end if;
  if coalesce(new.discount_amount, 0) > 0 and new.discount_by is not null
     and (new.discount_amount is distinct from old.discount_amount or new.discount_by is distinct from old.discount_by) then
    perform public.perm_guard(new.cafe_id, 'pos.discount');
  end if;
  return new;
end;
$$;
revoke all on function public.perm_orders() from public, anon, authenticated;
drop trigger if exists perm_orders on public.orders;
create trigger perm_orders before insert or update on public.orders for each row execute function public.perm_orders();

create or replace function public.perm_payments()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cafe uuid;
begin
  if new.status = 'paid' and coalesce(new.verification, 'manual') = 'manual' and new.method <> 'cash' then
    select o.cafe_id into v_cafe from public.orders o where o.id = new.order_id;
    perform public.perm_guard(v_cafe, 'payment.manual');
  end if;
  return new;
end;
$$;
revoke all on function public.perm_payments() from public, anon, authenticated;
drop trigger if exists perm_payments on public.payments;
create trigger perm_payments before insert on public.payments for each row execute function public.perm_payments();

create or replace function public.perm_simple()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- tg_argv[0] = izin; tg_argv[1] (opsional) = kolom yang harus berubah (UPDATE)
  if tg_op = 'UPDATE' and tg_nargs > 1 then
    if (to_jsonb(new) -> tg_argv[1]) is not distinct from (to_jsonb(old) -> tg_argv[1]) then
      return new;
    end if;
  end if;
  if tg_table_name = 'support_messages' and (to_jsonb(new) ->> 'sender') <> 'cafe' then
    return new;
  end if;
  perform public.perm_guard(nullif(to_jsonb(new) ->> 'cafe_id', '')::uuid, tg_argv[0]);
  return new;
end;
$$;
revoke all on function public.perm_simple() from public, anon, authenticated;

drop trigger if exists perm_refunds on public.refunds;
create trigger perm_refunds before insert on public.refunds for each row execute function public.perm_simple('refund.request');
drop trigger if exists perm_cash_movements on public.cash_movements;
create trigger perm_cash_movements before insert on public.cash_movements for each row execute function public.perm_simple('cash.move');
drop trigger if exists perm_products on public.products;
create trigger perm_products before update of is_available on public.products for each row execute function public.perm_simple('menu.availability', 'is_available');

do $$
begin
  if to_regclass('public.support_messages') is not null then
    execute 'drop trigger if exists perm_support_messages on public.support_messages';
    execute 'create trigger perm_support_messages before insert on public.support_messages for each row execute function public.perm_simple(''support.reply'')';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'cafe_settings' and column_name = 'ordering_paused') then
    execute 'drop trigger if exists perm_cafe_settings on public.cafe_settings';
    execute 'create trigger perm_cafe_settings before update of ordering_paused on public.cafe_settings for each row execute function public.perm_simple(''ordering.pause'', ''ordering_paused'')';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- B. Langganan
-- ---------------------------------------------------------------------
create table if not exists public.plans (
  code text primary key check (code ~ '^[a-z0-9_-]{2,30}$'),
  name text not null,
  description text,
  price_monthly numeric(12, 2),
  limits jsonb not null default '{}'::jsonb,   -- {"staff": 3, "tables": 10, "products": 80}; tidak ada = tanpa batas
  features text[] not null default '{}',        -- inventory, finance, loyalty, qr_ordering, payment_gateway
  is_public boolean not null default true,
  sort_order integer not null default 0
);

insert into public.plans (code, name, description, price_monthly, limits, features, is_public, sort_order) values
  ('basic', 'Basic', 'Kasir, pesanan app, menu & tim kecil', 149000, '{"staff": 3, "tables": 10, "products": 80}', '{}', true, 1),
  ('pro', 'Pro', 'Semua modul operasional & keuangan', 349000, '{"staff": 15, "tables": 50, "products": 500}',
   '{inventory,finance,loyalty,qr_ordering,payment_gateway}', true, 2),
  ('enterprise', 'Enterprise', 'Tanpa batas, untuk grup kafe', null, '{}', '{inventory,finance,loyalty,qr_ordering,payment_gateway}', false, 3)
on conflict (code) do nothing;

create table if not exists public.cafe_subscriptions (
  cafe_id uuid primary key references public.cafes (id) on delete cascade,
  plan_code text not null references public.plans (code),
  status text not null default 'trialing' check (status in ('trialing', 'active', 'past_due', 'cancelled')),
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  notes text,
  updated_at timestamptz not null default now()
);

-- Kafe lama: Enterprise aktif (tidak ada yang terkunci). Kafe baru: Pro coba 30 hari.
insert into public.cafe_subscriptions (cafe_id, plan_code, status, notes)
select c.id, 'enterprise', 'active', 'Kafe yang sudah ada sebelum langganan diterapkan'
from public.cafes c
on conflict (cafe_id) do nothing;

create or replace function public.sub_on_cafe_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.cafe_subscriptions (cafe_id, plan_code, status, trial_ends_at)
  values (new.id, 'pro', 'trialing', now() + interval '30 days')
  on conflict (cafe_id) do nothing;
  return null;
end;
$$;
revoke all on function public.sub_on_cafe_created() from public, anon, authenticated;
drop trigger if exists sub_on_cafe_created on public.cafes;
create trigger sub_on_cafe_created after insert on public.cafes for each row execute function public.sub_on_cafe_created();

-- Langganan berlaku? (masa coba habis / dibatalkan = hanya fitur dasar)
create or replace function public.cafe_plan(p_cafe_id uuid)
returns public.plans
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p from public.cafe_subscriptions s join public.plans p on p.code = s.plan_code
     where s.cafe_id = p_cafe_id
       and (s.status = 'active' or s.status = 'past_due'
            or (s.status = 'trialing' and (s.trial_ends_at is null or s.trial_ends_at > now())))),
    (select p from public.plans p where p.code = 'basic')
  )
$$;
revoke all on function public.cafe_plan(uuid) from public, anon, authenticated;

create or replace function public.cafe_has_feature(p_cafe_id uuid, p_feature text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (select 1 from public.cafe_subscriptions s where s.cafe_id = p_cafe_id) -- tanpa data langganan = tidak dibatasi
      or p_feature = any ((public.cafe_plan(p_cafe_id)).features)
$$;
revoke all on function public.cafe_has_feature(uuid, text) from public, anon;
grant execute on function public.cafe_has_feature(uuid, text) to authenticated;

create or replace function public.cafe_limit(p_cafe_id uuid, p_key text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case when exists (select 1 from public.cafe_subscriptions s where s.cafe_id = p_cafe_id)
    then nullif((public.cafe_plan(p_cafe_id)).limits ->> p_key, '')::integer end
$$;
revoke all on function public.cafe_limit(uuid, text) from public, anon, authenticated;

-- Ringkasan untuk owner (Pengaturan → Langganan)
create or replace function public.cafe_entitlements(p_cafe_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_sub public.cafe_subscriptions%rowtype;
  v_plan public.plans%rowtype;
begin
  if not public.is_cafe_member(p_cafe_id) then
    raise exception 'Hanya anggota kafe ini' using errcode = '42501';
  end if;
  select * into v_sub from public.cafe_subscriptions s where s.cafe_id = p_cafe_id;
  v_plan := public.cafe_plan(p_cafe_id);
  return jsonb_build_object(
    'plan', jsonb_build_object('code', v_plan.code, 'name', v_plan.name, 'description', v_plan.description, 'price_monthly', v_plan.price_monthly),
    'subscribed_plan', v_sub.plan_code,
    'status', coalesce(v_sub.status, 'active'),
    'trial_ends_at', v_sub.trial_ends_at,
    'current_period_end', v_sub.current_period_end,
    'features', to_jsonb(v_plan.features),
    'limits', v_plan.limits,
    'usage', jsonb_build_object(
      'staff', (select count(*) from public.profiles p where p.cafe_id = p_cafe_id and p.role = 'staff' and coalesce(p.is_active, true)),
      'tables', case when to_regclass('public.cafe_tables') is not null then (select count(*) from public.cafe_tables t where t.cafe_id = p_cafe_id) end,
      'products', (select count(*) from public.products p where p.cafe_id = p_cafe_id)
    ),
    'plans', (select jsonb_agg(jsonb_build_object('code', p.code, 'name', p.name, 'description', p.description, 'price_monthly', p.price_monthly,
                                                  'limits', p.limits, 'features', p.features) order by p.sort_order)
              from public.plans p where p.is_public)
  );
end;
$$;
revoke all on function public.cafe_entitlements(uuid) from public, anon;
grant execute on function public.cafe_entitlements(uuid) to authenticated;

-- Pengelola platform (service_role / SQL Editor): ubah paket & status
create or replace function public.subscription_set(p_cafe_id uuid, p_plan text, p_status text, p_period_end timestamptz default null, p_notes text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.cafe_subscriptions (cafe_id, plan_code, status, current_period_end, notes, updated_at)
  values (p_cafe_id, p_plan, p_status, p_period_end, p_notes, now())
  on conflict (cafe_id) do update
  set plan_code = excluded.plan_code, status = excluded.status, current_period_end = excluded.current_period_end,
      notes = coalesce(excluded.notes, public.cafe_subscriptions.notes), updated_at = now();
end;
$$;
revoke all on function public.subscription_set(uuid, text, text, timestamptz, text) from public, anon, authenticated;
grant execute on function public.subscription_set(uuid, text, text, timestamptz, text) to service_role;

-- ---- Batas & gerbang fitur (trigger) ----
create or replace function public.sub_guard_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer;
  v_count integer;
  v_cafe uuid := nullif(to_jsonb(new) ->> 'cafe_id', '')::uuid;
begin
  if v_cafe is null then
    return new;
  end if;
  if tg_table_name = 'profiles' then
    if new.role <> 'staff' or not coalesce(new.is_active, true)
       or (tg_op = 'UPDATE' and old.role = 'staff' and coalesce(old.is_active, true) and old.cafe_id is not distinct from new.cafe_id) then
      return new;
    end if;
    v_limit := public.cafe_limit(v_cafe, 'staff');
    select count(*) into v_count from public.profiles p where p.cafe_id = v_cafe and p.role = 'staff' and coalesce(p.is_active, true) and p.id <> new.id;
  else
    v_limit := public.cafe_limit(v_cafe, tg_argv[0]);
    execute format('select count(*) from public.%I where cafe_id = $1', tg_table_name) into v_count using v_cafe;
  end if;
  if v_limit is not null and v_count >= v_limit then
    raise exception 'Batas paket tercapai (% %). Upgrade paket untuk menambah.', v_limit,
      case tg_table_name when 'profiles' then 'staff aktif' when 'cafe_tables' then 'meja' else 'menu' end
      using errcode = 'P0001', hint = 'plan_limit';
  end if;
  return new;
end;
$$;
revoke all on function public.sub_guard_limit() from public, anon, authenticated;
drop trigger if exists sub_limit_staff on public.profiles;
create trigger sub_limit_staff before insert or update of role, is_active, cafe_id on public.profiles for each row execute function public.sub_guard_limit();
drop trigger if exists sub_limit_products on public.products;
create trigger sub_limit_products before insert on public.products for each row execute function public.sub_guard_limit('products');
do $$
begin
  if to_regclass('public.cafe_tables') is not null then
    execute 'drop trigger if exists sub_limit_tables on public.cafe_tables';
    execute 'create trigger sub_limit_tables before insert on public.cafe_tables for each row execute function public.sub_guard_limit(''tables'')';
  end if;
end;
$$;

create or replace function public.sub_guard_feature()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cafe uuid := nullif(to_jsonb(new) ->> 'cafe_id', '')::uuid;
  v_feature text := tg_argv[0];
begin
  -- Untuk cafe_settings: hanya saat fitur DINYALAKAN (kolom tg_argv[1] berubah jadi true / terisi)
  if tg_table_name = 'cafe_settings' then
    if (to_jsonb(new) -> tg_argv[1]) is not distinct from (to_jsonb(old) -> tg_argv[1])
       or coalesce(to_jsonb(new) ->> tg_argv[1], 'false') in ('false', '') then
      return new;
    end if;
  end if;
  if tg_table_name = 'orders' and (to_jsonb(new) ->> 'table_id' is null or coalesce(to_jsonb(new) ->> 'source', 'app') <> 'app') then
    return new;
  end if;
  if v_cafe is not null and not public.cafe_has_feature(v_cafe, v_feature) then
    raise exception 'Fitur ini tidak termasuk paket langganan kafe. Upgrade paket untuk memakainya.'
      using errcode = 'P0001', hint = 'plan_feature';
  end if;
  return new;
end;
$$;
revoke all on function public.sub_guard_feature() from public, anon, authenticated;

do $$
begin
  if to_regclass('public.ingredients') is not null then
    execute 'drop trigger if exists sub_feature_inventory on public.ingredients';
    execute 'create trigger sub_feature_inventory before insert on public.ingredients for each row execute function public.sub_guard_feature(''inventory'')';
  end if;
  if to_regclass('public.payment_intents') is not null then
    execute 'drop trigger if exists sub_feature_gateway on public.payment_intents';
    execute 'create trigger sub_feature_gateway before insert on public.payment_intents for each row execute function public.sub_guard_feature(''payment_gateway'')';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'cafe_settings' and column_name = 'loyalty_enabled') then
    execute 'drop trigger if exists sub_feature_loyalty on public.cafe_settings';
    execute 'create trigger sub_feature_loyalty before update of loyalty_enabled on public.cafe_settings for each row execute function public.sub_guard_feature(''loyalty'', ''loyalty_enabled'')';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'cafe_settings' and column_name = 'accounting_go_live') then
    execute 'drop trigger if exists sub_feature_finance on public.cafe_settings';
    execute 'create trigger sub_feature_finance before update of accounting_go_live on public.cafe_settings for each row execute function public.sub_guard_feature(''finance'', ''accounting_go_live'')';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'cafe_settings' and column_name = 'payment_gateway_enabled') then
    execute 'drop trigger if exists sub_feature_gateway_setting on public.cafe_settings';
    execute 'create trigger sub_feature_gateway_setting before update of payment_gateway_enabled on public.cafe_settings for each row execute function public.sub_guard_feature(''payment_gateway'', ''payment_gateway_enabled'')';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'orders' and column_name = 'table_id') then
    execute 'drop trigger if exists sub_feature_qr on public.orders';
    execute 'create trigger sub_feature_qr before insert on public.orders for each row execute function public.sub_guard_feature(''qr_ordering'')';
  end if;
end;
$$;

alter table public.plans enable row level security;
alter table public.cafe_subscriptions enable row level security;
revoke all on public.plans, public.cafe_subscriptions from anon, authenticated;
grant select on public.plans to anon, authenticated;
drop policy if exists "Public plans" on public.plans;
create policy "Public plans" on public.plans for select to anon, authenticated using (is_public);
grant select on public.cafe_subscriptions to authenticated;
drop policy if exists "Members see own subscription" on public.cafe_subscriptions;
create policy "Members see own subscription" on public.cafe_subscriptions for select to authenticated using (public.is_cafe_member(cafe_id));

-- ---------------------------------------------------------------------
-- C. Pengetatan hak akses
-- ---------------------------------------------------------------------
-- RLS wajib di semua tabel publik. Tabel tanpa RLS diberi policy setara perilaku sekarang.
alter table public.order_status_events enable row level security;
alter table public.categories enable row level security;
drop policy if exists "Public can view categories" on public.categories;
create policy "Public can view categories" on public.categories for select to anon, authenticated using (true);
drop policy if exists "Owners manage categories" on public.categories;
create policy "Owners manage categories" on public.categories for all to authenticated
  using (public.is_cafe_member(cafe_id, array['owner'])) with check (public.is_cafe_member(cafe_id, array['owner']));

-- Pengguna belum login tidak pernah menulis langsung ke tabel
revoke insert, update, delete, truncate, references, trigger on all tables in schema public from anon;
-- TRUNCATE melewati RLS; REFERENCES/TRIGGER tidak dipakai aplikasi
revoke truncate, references, trigger on all tables in schema public from authenticated;
-- Tabel yang dibuat nanti mengikuti aturan yang sama
alter default privileges in schema public revoke insert, update, delete, truncate, references, trigger on tables from anon;
alter default privileges in schema public revoke truncate, references, trigger on tables from authenticated;

-- Index untuk query yang sering dipakai (riwayat customer, item pesanan, menu)
create index if not exists orders_customer_created_idx on public.orders (customer_id, created_at desc) where customer_id is not null;
create index if not exists order_items_order_idx on public.order_items (order_id);
create index if not exists products_cafe_idx on public.products (cafe_id, name);
create index if not exists categories_cafe_idx on public.categories (cafe_id);
create index if not exists profiles_cafe_role_idx on public.profiles (cafe_id, role) where cafe_id is not null;

-- ---------------------------------------------------------------------
-- D. Kunci Midtrans per kafe (Edge Function memilih secret MIDTRANS_SERVER_KEY_<cafe tanpa tanda ->)
-- ---------------------------------------------------------------------
do $$
begin
  if to_regclass('public.payment_intents') is not null then
    execute $f$
      create or replace function public.pay_intent_cafe(p_provider_order_id text)
      returns uuid
      language sql
      stable
      security definer
      set search_path = ''
      as $body$ select i.cafe_id from public.payment_intents i where i.provider_order_id = p_provider_order_id $body$
    $f$;
    execute 'revoke all on function public.pay_intent_cafe(text) from public, anon, authenticated';
    execute 'grant execute on function public.pay_intent_cafe(text) to service_role';
  end if;
end;
$$;

-- Log aktivitas: perubahan paket terlihat owner
drop trigger if exists log_audit_event on public.cafe_subscriptions;
create trigger log_audit_event after insert or update on public.cafe_subscriptions for each row execute function public.log_audit_event();

notify pgrst, 'reload schema';

commit;

-- Verifikasi: 2 tabel + 6 fungsi + 0 tabel publik tanpa RLS ⇒ 8 baris, dan baris "tanpa_rls" TIDAK boleh muncul
select 'table' as kind, table_name as name
from information_schema.tables
where table_schema = 'public' and table_name in ('plans', 'cafe_subscriptions')
union all
select 'function', p.proname
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('has_staff_permission', 'staff_set_permissions', 'staff_permissions_list', 'cafe_entitlements', 'cafe_has_feature', 'subscription_set')
union all
select 'tanpa_rls', c.relname
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
order by 1, 2;
