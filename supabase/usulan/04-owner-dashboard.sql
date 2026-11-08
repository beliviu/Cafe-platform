-- =====================================================================
-- 04 · FASE 3 OWNER DASHBOARD
--   A. Gradasi warna brand (cafes.brand_color_2)
--   B. Pengaturan bisnis: pajak, service charge, pembulatan, struk (cafe_settings)
--   C. Meja (cafe_tables)
--   D. Varian & add-on produk (product_option_groups, product_options)
--   E. Tim: status aktif & jabatan staff, daftar tim lengkap
--   F. Jadwal shift (staff_shifts)
--   G. Log aktivitas (audit_logs) + trigger
-- Jalankan manual di Supabase SQL Editor SETELAH 01, 02, 03.
-- Semua dalam satu transaksi: kalau ada error, tidak ada yang berubah.
--
-- Data yang tersentuh:
--   - Kolom BARU di cafes & profiles (nilai lama tidak diubah; is_active default true).
--   - Tabel BARU. cafe_settings diisi 1 baris default per kafe (nilai bawaan,
--     pajak & service charge NONAKTIF sampai owner menyalakannya).
--   - Fungsi is_cafe_member diperbarui: staff yang dinonaktifkan tidak lagi dianggap anggota.
--   - Fungsi cafe_team_members dibuat ulang (kolom hasil bertambah).
--   - Tidak ada DELETE / TRUNCATE / UPDATE baris lama.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- A. Gradasi brand: warna kedua (kosong = warna solid)
-- ---------------------------------------------------------------------
alter table public.cafes add column if not exists brand_color_2 text;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.cafes'::regclass and conname = 'cafes_brand_color_2_hex') then
    alter table public.cafes add constraint cafes_brand_color_2_hex
      check (brand_color_2 is null or brand_color_2 ~ '^#[0-9A-Fa-f]{6}$');
  end if;
end;
$$;

grant update (brand_color_2) on public.cafes to authenticated;

-- ---------------------------------------------------------------------
-- E1. Status aktif & jabatan staff (dipakai helper peran di bawah)
-- ---------------------------------------------------------------------
alter table public.profiles
  add column if not exists is_active boolean not null default true,
  add column if not exists job_title text;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.profiles'::regclass and conname = 'profiles_job_title_length') then
    alter table public.profiles add constraint profiles_job_title_length
      check (job_title is null or char_length(job_title) <= 40);
  end if;
end;
$$;

-- Staff nonaktif langsung kehilangan akses (semua policy & RPC memakai helper ini)
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
      and p.is_active
  );
$$;

-- ---------------------------------------------------------------------
-- Helper umum: updated_at otomatis
-- ---------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- B. Pengaturan bisnis per kafe (1 baris per kafe)
--    Dipakai checkout/POS mulai fase 5. Sekarang hanya disimpan.
-- ---------------------------------------------------------------------
create table if not exists public.cafe_settings (
  cafe_id uuid primary key references public.cafes (id) on delete cascade,
  timezone text not null default 'Asia/Jakarta',
  currency text not null default 'IDR' check (currency = 'IDR'),
  tax_enabled boolean not null default false,
  tax_name text not null default 'PB1' check (char_length(trim(tax_name)) between 1 and 20),
  tax_rate numeric(5, 2) not null default 10 check (tax_rate >= 0 and tax_rate <= 100),
  tax_inclusive boolean not null default false,
  service_charge_enabled boolean not null default false,
  service_charge_rate numeric(5, 2) not null default 5 check (service_charge_rate >= 0 and service_charge_rate <= 100),
  service_charge_taxable boolean not null default true,
  rounding_unit integer not null default 0 check (rounding_unit in (0, 100, 500, 1000)),
  order_types text[] not null default array['dine_in', 'takeaway']
    check (cardinality(order_types) >= 1 and order_types <@ array['dine_in', 'takeaway']),
  receipt_header text check (receipt_header is null or char_length(receipt_header) <= 200),
  receipt_footer text check (receipt_footer is null or char_length(receipt_footer) <= 300),
  receipt_show_logo boolean not null default true,
  receipt_show_address boolean not null default true,
  receipt_paper_mm smallint not null default 58 check (receipt_paper_mm in (58, 80)),
  updated_at timestamptz not null default now()
);

alter table public.cafe_settings enable row level security;
revoke all on public.cafe_settings from anon, authenticated;
grant select on public.cafe_settings to anon, authenticated;
grant update (
  timezone, tax_enabled, tax_name, tax_rate, tax_inclusive,
  service_charge_enabled, service_charge_rate, service_charge_taxable, rounding_unit, order_types,
  receipt_header, receipt_footer, receipt_show_logo, receipt_show_address, receipt_paper_mm
) on public.cafe_settings to authenticated;

-- Tarif pajak & service tidak rahasia: app customer butuh untuk estimasi total
drop policy if exists "Public can view cafe settings" on public.cafe_settings;
create policy "Public can view cafe settings"
  on public.cafe_settings for select
  to anon, authenticated
  using (true);

drop policy if exists "Owners can update cafe settings" on public.cafe_settings;
create policy "Owners can update cafe settings"
  on public.cafe_settings for update
  to authenticated
  using (public.is_cafe_member(cafe_id, array['owner']))
  with check (public.is_cafe_member(cafe_id, array['owner']));

drop trigger if exists touch_cafe_settings on public.cafe_settings;
create trigger touch_cafe_settings
  before update on public.cafe_settings
  for each row execute function public.touch_updated_at();

-- Satu baris default untuk tiap kafe (baris BARU di tabel baru)
insert into public.cafe_settings (cafe_id)
select c.id from public.cafes as c
on conflict (cafe_id) do nothing;

-- Kafe baru otomatis dapat baris pengaturan
create or replace function public.create_default_cafe_settings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.cafe_settings (cafe_id) values (new.id) on conflict (cafe_id) do nothing;
  return new;
end;
$$;
revoke all on function public.create_default_cafe_settings() from public, anon, authenticated;

drop trigger if exists create_default_cafe_settings on public.cafes;
create trigger create_default_cafe_settings
  after insert on public.cafes
  for each row execute function public.create_default_cafe_settings();

-- ---------------------------------------------------------------------
-- C. Meja
-- ---------------------------------------------------------------------
create table if not exists public.cafe_tables (
  id uuid primary key default gen_random_uuid(),
  cafe_id uuid not null references public.cafes (id) on delete cascade,
  label text not null check (char_length(trim(label)) between 1 and 20),
  area text check (area is null or char_length(area) <= 40),
  capacity smallint check (capacity is null or capacity between 1 and 50),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint cafe_tables_label_unique unique (cafe_id, label)
);

create index if not exists cafe_tables_cafe_idx on public.cafe_tables (cafe_id, sort_order);

alter table public.cafe_tables enable row level security;
revoke all on public.cafe_tables from anon, authenticated;
grant select on public.cafe_tables to anon, authenticated;
grant insert, update, delete on public.cafe_tables to authenticated;

drop policy if exists "Public can view cafe tables" on public.cafe_tables;
create policy "Public can view cafe tables"
  on public.cafe_tables for select
  to anon, authenticated
  using (true);

drop policy if exists "Owners manage cafe tables" on public.cafe_tables;
create policy "Owners manage cafe tables"
  on public.cafe_tables for all
  to authenticated
  using (public.is_cafe_member(cafe_id, array['owner']))
  with check (public.is_cafe_member(cafe_id, array['owner']));

-- ---------------------------------------------------------------------
-- D. Varian & add-on produk
--    Grup (mis. "Ukuran", wajib pilih 1) berisi opsi (mis. "Large", +Rp 5.000).
--    cafe_id diisi otomatis dari produk/grup induk (tidak dipercaya dari klien).
--    Dipakai checkout/POS mulai fase 5.
-- ---------------------------------------------------------------------
create table if not exists public.product_option_groups (
  id uuid primary key default gen_random_uuid(),
  cafe_id uuid not null references public.cafes (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 40),
  selection_type text not null default 'single' check (selection_type in ('single', 'multiple')),
  is_required boolean not null default false,
  max_select smallint check (max_select is null or max_select between 1 and 20),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.product_options (
  id uuid primary key default gen_random_uuid(),
  cafe_id uuid not null references public.cafes (id) on delete cascade,
  group_id uuid not null references public.product_option_groups (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 40),
  price_delta numeric(12, 2) not null default 0 check (price_delta >= 0 and price_delta <= 10000000),
  is_available boolean not null default true,
  is_default boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists product_option_groups_product_idx on public.product_option_groups (product_id, sort_order);
create index if not exists product_options_group_idx on public.product_options (group_id, sort_order);

create or replace function public.set_option_group_cafe()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select p.cafe_id into new.cafe_id from public.products as p where p.id = new.product_id;
  if new.cafe_id is null then
    raise exception 'Produk tidak ditemukan' using errcode = '23503';
  end if;
  return new;
end;
$$;
revoke all on function public.set_option_group_cafe() from public, anon, authenticated;

create or replace function public.set_option_cafe()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select g.cafe_id into new.cafe_id from public.product_option_groups as g where g.id = new.group_id;
  if new.cafe_id is null then
    raise exception 'Grup varian tidak ditemukan' using errcode = '23503';
  end if;
  return new;
end;
$$;
revoke all on function public.set_option_cafe() from public, anon, authenticated;

drop trigger if exists set_option_group_cafe on public.product_option_groups;
create trigger set_option_group_cafe
  before insert or update of product_id, cafe_id on public.product_option_groups
  for each row execute function public.set_option_group_cafe();

drop trigger if exists set_option_cafe on public.product_options;
create trigger set_option_cafe
  before insert or update of group_id, cafe_id on public.product_options
  for each row execute function public.set_option_cafe();

alter table public.product_option_groups enable row level security;
alter table public.product_options enable row level security;
revoke all on public.product_option_groups, public.product_options from anon, authenticated;
grant select on public.product_option_groups, public.product_options to anon, authenticated;
grant insert, update, delete on public.product_option_groups, public.product_options to authenticated;

drop policy if exists "Public can view option groups" on public.product_option_groups;
create policy "Public can view option groups"
  on public.product_option_groups for select to anon, authenticated using (true);

drop policy if exists "Owners manage option groups" on public.product_option_groups;
create policy "Owners manage option groups"
  on public.product_option_groups for all to authenticated
  using (public.is_cafe_member(cafe_id, array['owner']))
  with check (public.is_cafe_member(cafe_id, array['owner']));

drop policy if exists "Public can view options" on public.product_options;
create policy "Public can view options"
  on public.product_options for select to anon, authenticated using (true);

drop policy if exists "Owners manage options" on public.product_options;
create policy "Owners manage options"
  on public.product_options for all to authenticated
  using (public.is_cafe_member(cafe_id, array['owner']))
  with check (public.is_cafe_member(cafe_id, array['owner']));

-- ---------------------------------------------------------------------
-- E2. Daftar tim lengkap (owner melihat email; staff hanya nama & jabatan)
--     Dibuat ulang karena kolom hasilnya bertambah.
-- ---------------------------------------------------------------------
drop function if exists public.cafe_team_members(uuid);
create function public.cafe_team_members(p_cafe_id uuid)
returns table (
  id uuid,
  full_name text,
  role text,
  job_title text,
  is_active boolean,
  phone text,
  email text,
  last_sign_in_at timestamptz,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id,
    p.full_name,
    p.role::text,
    p.job_title,
    p.is_active,
    case when public.is_cafe_member(p_cafe_id, array['owner']) then p.phone end,
    case when public.is_cafe_member(p_cafe_id, array['owner']) then u.email::text end,
    case when public.is_cafe_member(p_cafe_id, array['owner']) then u.last_sign_in_at end,
    p.created_at
  from public.profiles as p
  left join auth.users as u on u.id = p.id
  where p.cafe_id = p_cafe_id
    and p.role in ('owner', 'staff')
    and public.is_cafe_member(p_cafe_id)
  order by (p.role = 'owner') desc, p.is_active desc, p.full_name;
$$;

revoke all on function public.cafe_team_members(uuid) from public, anon;
grant execute on function public.cafe_team_members(uuid) to authenticated;

-- Owner mengubah jabatan staff (bukan peran/kafe — itu lewat Edge Function staff-admin)
create or replace function public.owner_set_member_title(p_user_id uuid, p_job_title text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_cafe uuid;
  v_title text := nullif(trim(p_job_title), '');
begin
  select p.cafe_id into v_owner_cafe
  from public.profiles as p
  where p.id = (select auth.uid()) and p.role = 'owner' and p.is_active;

  if v_owner_cafe is null then
    raise exception 'Hanya owner yang bisa mengubah jabatan' using errcode = '42501';
  end if;
  if v_title is not null and char_length(v_title) > 40 then
    raise exception 'Jabatan maksimal 40 karakter' using errcode = '22023';
  end if;

  update public.profiles
  set job_title = v_title
  where id = p_user_id and cafe_id = v_owner_cafe and role in ('owner', 'staff');

  if not found then
    raise exception 'Anggota tim tidak ditemukan' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.owner_set_member_title(uuid, text) from public, anon;
grant execute on function public.owner_set_member_title(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- F. Jadwal shift
-- ---------------------------------------------------------------------
create table if not exists public.staff_shifts (
  id uuid primary key default gen_random_uuid(),
  cafe_id uuid not null references public.cafes (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  note text check (note is null or char_length(note) <= 80),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint staff_shifts_time_valid check (ends_at > starts_at and ends_at - starts_at <= interval '16 hours')
);

create index if not exists staff_shifts_cafe_time_idx on public.staff_shifts (cafe_id, starts_at);
create index if not exists staff_shifts_user_time_idx on public.staff_shifts (user_id, starts_at);

create or replace function public.check_shift_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.profiles as p
    where p.id = new.user_id and p.cafe_id = new.cafe_id and p.role in ('owner', 'staff')
  ) then
    raise exception 'Karyawan bukan anggota kafe ini' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.check_shift_member() from public, anon, authenticated;

drop trigger if exists check_shift_member on public.staff_shifts;
create trigger check_shift_member
  before insert or update of user_id, cafe_id on public.staff_shifts
  for each row execute function public.check_shift_member();

alter table public.staff_shifts enable row level security;
revoke all on public.staff_shifts from anon, authenticated;
grant select, insert, update, delete on public.staff_shifts to authenticated;

drop policy if exists "Cafe members view shifts" on public.staff_shifts;
create policy "Cafe members view shifts"
  on public.staff_shifts for select to authenticated
  using (public.is_cafe_member(cafe_id));

drop policy if exists "Owners manage shifts" on public.staff_shifts;
create policy "Owners manage shifts"
  on public.staff_shifts for all to authenticated
  using (public.is_cafe_member(cafe_id, array['owner']))
  with check (public.is_cafe_member(cafe_id, array['owner']));

-- ---------------------------------------------------------------------
-- G. Log aktivitas (hanya bisa dibaca owner; ditulis oleh trigger)
-- ---------------------------------------------------------------------
create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  cafe_id uuid not null references public.cafes (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  action text not null check (action in ('insert', 'update', 'delete')),
  entity text not null,
  entity_id text,
  label text,
  changes jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_cafe_created_idx on public.audit_logs (cafe_id, created_at desc);

alter table public.audit_logs enable row level security;
revoke all on public.audit_logs from anon, authenticated;
grant select on public.audit_logs to authenticated;

drop policy if exists "Owners view audit logs" on public.audit_logs;
create policy "Owners view audit logs"
  on public.audit_logs for select to authenticated
  using (public.is_cafe_member(cafe_id, array['owner']));

create or replace function public.log_audit_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_cafe uuid;
  v_changes jsonb;
  v_key text;
begin
  v_cafe := case
    when tg_table_name = 'cafes' then (v_row ->> 'id')::uuid
    else nullif(v_row ->> 'cafe_id', '')::uuid
  end;
  -- profil customer (tanpa kafe) tidak dicatat
  if v_cafe is null then
    return null;
  end if;

  if tg_op = 'UPDATE' then
    v_changes := '{}'::jsonb;
    for v_key in select jsonb_object_keys(v_new) loop
      if v_key not in ('updated_at', 'created_at')
         and (v_new -> v_key) is distinct from (v_old -> v_key) then
        v_changes := v_changes || jsonb_build_object(v_key, jsonb_build_array(v_old -> v_key, v_new -> v_key));
      end if;
    end loop;
    if v_changes = '{}'::jsonb then
      return null;
    end if;
  end if;

  insert into public.audit_logs (cafe_id, actor_id, action, entity, entity_id, label, changes)
  values (
    v_cafe,
    (select auth.uid()),
    lower(tg_op),
    tg_table_name,
    v_row ->> 'id',
    left(coalesce(v_row ->> 'name', v_row ->> 'label', v_row ->> 'full_name', v_row ->> 'app_name'), 120),
    v_changes
  );
  return null;
end;
$$;
revoke all on function public.log_audit_event() from public, anon, authenticated;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'cafes', 'cafe_settings', 'categories', 'products', 'product_option_groups',
    'product_options', 'cafe_tables', 'staff_shifts'
  ] loop
    execute format('drop trigger if exists log_audit_event on public.%I', v_table);
    execute format(
      'create trigger log_audit_event after insert or update or delete on public.%I
         for each row execute function public.log_audit_event()',
      v_table
    );
  end loop;
end;
$$;

-- Profil: hanya perubahan peran/kafe/status/jabatan (bukan nama/HP customer)
drop trigger if exists log_audit_event on public.profiles;
create trigger log_audit_event
  after update of role, cafe_id, is_active, job_title on public.profiles
  for each row execute function public.log_audit_event();

notify pgrst, 'reload schema';

commit;

-- Verifikasi: harus muncul 6 tabel + 3 kolom + 2 fungsi
select 'table' as kind, table_name as name
from information_schema.tables
where table_schema = 'public'
  and table_name in ('cafe_settings', 'cafe_tables', 'product_option_groups', 'product_options', 'staff_shifts', 'audit_logs')
union all
select 'column', table_name || '.' || column_name
from information_schema.columns
where table_schema = 'public'
  and ((table_name = 'cafes' and column_name = 'brand_color_2')
    or (table_name = 'profiles' and column_name in ('is_active', 'job_title')))
union all
select 'function', p.proname
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('owner_set_member_title', 'log_audit_event')
order by 1, 2;
