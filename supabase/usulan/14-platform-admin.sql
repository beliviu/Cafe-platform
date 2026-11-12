-- =====================================================================
-- 14 · DASHBOARD PLATFORM (admin SaaS Dailybrew) + LANGGANAN OTOMATIS
-- ---------------------------------------------------------------------
-- Bergantung pada file 04 (audit_logs, profiles.is_active) dan file 10 (plans, cafe_subscriptions).
--
-- Isi:
--   A. Admin platform (tabel platform_admins, terpisah dari app_role) + log audit platform.
--   B. Kafe nonaktif (suspend): pesanan baru ditolak, fitur turun ke paket dasar, data TIDAK dihapus.
--   C. Masa tenggang langganan: current_period_end kini dicek (+7 hari tenggang), lalu turun ke Basic.
--   D. Tagihan langganan (subscription_invoices) — lunas manual (transfer) ATAU otomatis lewat Midtrans.
--   E. Fungsi dashboard platform pa_* (wajib admin aktif + sesi 2FA aal2). Setiap perubahan
--      menulis platform_audit_logs di transaksi yang sama.
--   F. Penagihan otomatis: pa_billing_run() (dijadwalkan pg_cron, lihat bawah), bayar sendiri oleh owner.
--
-- Data yang sudah ada TIDAK diubah, kecuali: aturan cafe_plan() kini memperhatikan current_period_end.
-- Kafe lama dengan current_period_end kosong (mis. Enterprise dari file 10) tetap berlaku tanpa batas.
-- Aman dijalankan ulang.
--
-- SETELAH MENJALANKAN FILE INI:
--   1. Buat admin pertama (lihat potongan di paling bawah file).
--   2. Jadwalkan penagihan otomatis (lihat bagian "Jadwal pg_cron" di paling bawah file).
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- A. Admin platform & log audit
-- ---------------------------------------------------------------------
create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.platform_audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users (id) on delete set null,
  actor_label text,
  action text not null,
  cafe_id uuid references public.cafes (id) on delete set null,
  entity text not null,
  entity_id text,
  before jsonb,
  after jsonb,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists platform_audit_logs_created_idx on public.platform_audit_logs (created_at desc);
create index if not exists platform_audit_logs_cafe_idx on public.platform_audit_logs (cafe_id, created_at desc);

-- ---------------------------------------------------------------------
-- B/C/D. Kolom & tabel baru
-- ---------------------------------------------------------------------
alter table public.cafes add column if not exists suspended_at timestamptz;
alter table public.cafes add column if not exists suspended_reason text;
alter table public.cafe_subscriptions add column if not exists price_override numeric(12, 2);
alter table public.plans add column if not exists is_archived boolean not null default false;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cafe_subscriptions_price_override_check') then
    alter table public.cafe_subscriptions add constraint cafe_subscriptions_price_override_check check (price_override is null or price_override >= 0);
  end if;
end;
$$;

create sequence if not exists public.subscription_invoice_seq;

create table if not exists public.subscription_invoices (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  cafe_id uuid not null references public.cafes (id) on delete cascade,
  plan_code text not null references public.plans (code),
  months integer not null default 1 check (months between 1 and 24),
  period_start timestamptz not null,
  period_end timestamptz not null,
  amount numeric(12, 2) not null check (amount > 0),
  status text not null default 'pending' check (status in ('pending', 'paid', 'void')),
  due_at timestamptz not null,
  paid_at timestamptz,
  method text check (method in ('manual_transfer', 'gateway')),
  payment_ref text,
  -- Gateway (Midtrans Snap). provider_payload = isi status terakhir dari API Midtrans.
  provider text,
  provider_order_id text unique,
  provider_status text,
  provider_payload jsonb,
  checkout_url text,
  checkout_created_at timestamptz,
  source text not null default 'admin' check (source in ('admin', 'system', 'owner')),
  note text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscription_invoices_period_check check (period_end > period_start)
);
create index if not exists subscription_invoices_cafe_idx on public.subscription_invoices (cafe_id, created_at desc);
create index if not exists subscription_invoices_status_idx on public.subscription_invoices (status, due_at);

-- Riwayat MRR per bulan (diisi pa_overview & pa_billing_run) untuk perbandingan bulan lalu
create table if not exists public.platform_mrr_snapshots (
  month date primary key,
  mrr numeric(14, 2) not null default 0,
  paying_cafes integer not null default 0,
  trial_cafes integer not null default 0,
  updated_at timestamptz not null default now()
);

-- Semua tabel platform: RLS menyala, TANPA akses langsung dari browser (hanya lewat fungsi)
alter table public.platform_admins enable row level security;
alter table public.platform_audit_logs enable row level security;
alter table public.subscription_invoices enable row level security;
alter table public.platform_mrr_snapshots enable row level security;
revoke all on public.platform_admins, public.platform_audit_logs, public.subscription_invoices, public.platform_mrr_snapshots from public, anon, authenticated;
revoke all on sequence public.subscription_invoice_seq from public, anon, authenticated;
-- Kolom baru cafes TIDAK diberi grant update ke authenticated (owner tidak bisa membuka suspend sendiri)

-- ---------------------------------------------------------------------
-- Helper keamanan
-- ---------------------------------------------------------------------
-- Admin platform aktif DAN sesi sudah lolos 2FA (aal2)
create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.platform_admins a where a.user_id = (select auth.uid()) and a.is_active)
     and coalesce((select auth.jwt()) ->> 'aal', '') = 'aal2'
$$;
revoke all on function public.is_platform_admin() from public, anon;
grant execute on function public.is_platform_admin() to authenticated;

create or replace function public.pa_require()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.platform_admins a where a.user_id = (select auth.uid()) and a.is_active) then
    raise exception 'Khusus admin platform Dailybrew' using errcode = '42501', hint = 'platform_admin_only';
  end if;
  if coalesce((select auth.jwt()) ->> 'aal', '') <> 'aal2' then
    raise exception 'Verifikasi 2FA diperlukan' using errcode = '42501', hint = 'mfa_required';
  end if;
  return (select auth.uid());
end;
$$;
revoke all on function public.pa_require() from public, anon, authenticated;

-- Status diri sendiri (dipakai layar login sebelum 2FA). Hanya membuka data milik pemanggil.
create or replace function public.pa_whoami()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'is_admin', exists (select 1 from public.platform_admins a where a.user_id = (select auth.uid()) and a.is_active),
    'aal', coalesce((select auth.jwt()) ->> 'aal', 'aal1'),
    'full_name', (select a.full_name from public.platform_admins a where a.user_id = (select auth.uid()))
  )
$$;
revoke all on function public.pa_whoami() from public, anon;
grant execute on function public.pa_whoami() to authenticated;

create or replace function public.pa_log(
  p_action text, p_cafe uuid, p_entity text, p_entity_id text, p_before jsonb, p_after jsonb,
  p_note text default null, p_actor uuid default null, p_actor_label text default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.platform_audit_logs (actor_id, actor_label, action, cafe_id, entity, entity_id, before, after, note)
  values (
    coalesce(p_actor, (select auth.uid())),
    coalesce(p_actor_label, (select u.email from auth.users u where u.id = coalesce(p_actor, (select auth.uid())))),
    p_action, p_cafe, p_entity, p_entity_id, p_before, p_after, nullif(trim(coalesce(p_note, '')), '')
  )
$$;
revoke all on function public.pa_log(text, uuid, text, text, jsonb, jsonb, text, uuid, text) from public, anon, authenticated;
grant execute on function public.pa_log(text, uuid, text, text, jsonb, jsonb, text, uuid, text) to service_role;

create or replace function public.pa_is_cafe_owner(p_cafe uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = p_user and p.cafe_id = p_cafe and p.role::text = 'owner' and coalesce(p.is_active, true)
  )
$$;
revoke all on function public.pa_is_cafe_owner(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- B/C. Paket efektif: kafe nonaktif & lewat masa tenggang → paket dasar
-- ---------------------------------------------------------------------
create or replace function public.cafe_plan(p_cafe_id uuid)
returns public.plans
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p from public.cafe_subscriptions s
       join public.plans p on p.code = s.plan_code
       join public.cafes c on c.id = s.cafe_id
     where s.cafe_id = p_cafe_id
       and c.suspended_at is null
       and ((s.status in ('active', 'past_due') and (s.current_period_end is null or s.current_period_end + interval '7 days' > now()))
            or (s.status = 'trialing' and (s.trial_ends_at is null or s.trial_ends_at > now())))),
    (select p from public.plans p where p.code = 'basic')
  )
$$;
revoke all on function public.cafe_plan(uuid) from public, anon, authenticated;

-- Pesanan baru ditolak untuk kafe nonaktif (semua jalur: app, POS, QR meja, tamu)
create or replace function public.orders_block_suspended()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.cafes c where c.id = new.cafe_id and c.suspended_at is not null) then
    raise exception 'Kafe ini sedang dinonaktifkan dan belum bisa menerima pesanan.'
      using errcode = 'P0001', hint = 'cafe_suspended';
  end if;
  return new;
end;
$$;
revoke all on function public.orders_block_suspended() from public, anon, authenticated;
drop trigger if exists orders_block_suspended on public.orders;
create trigger orders_block_suspended before insert on public.orders for each row execute function public.orders_block_suspended();

-- Status platform untuk owner/staff (banner di web-dashboard)
create or replace function public.cafe_platform_status(p_cafe_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cafe public.cafes%rowtype;
  v_sub public.cafe_subscriptions%rowtype;
begin
  if not public.is_cafe_member(p_cafe_id) then
    raise exception 'Hanya anggota kafe ini' using errcode = '42501';
  end if;
  select * into v_cafe from public.cafes c where c.id = p_cafe_id;
  select * into v_sub from public.cafe_subscriptions s where s.cafe_id = p_cafe_id;
  return jsonb_build_object(
    'suspended', v_cafe.suspended_at is not null,
    'suspended_at', v_cafe.suspended_at,
    'suspended_reason', v_cafe.suspended_reason,
    'status', v_sub.status,
    'current_period_end', v_sub.current_period_end,
    'grace_until', case when v_sub.current_period_end is not null then v_sub.current_period_end + interval '7 days' end,
    'in_grace', v_sub.status in ('active', 'past_due') and v_sub.current_period_end is not null
                and v_sub.current_period_end < now() and v_sub.current_period_end + interval '7 days' > now(),
    'pending_invoices', (select count(*) from public.subscription_invoices i where i.cafe_id = p_cafe_id and i.status = 'pending')
  );
end;
$$;
revoke all on function public.cafe_platform_status(uuid) from public, anon;
grant execute on function public.cafe_platform_status(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Ringkasan per kafe (internal)
-- state: suspended | trial | active | past_due (lewat jatuh tempo, masih tenggang) | expired
-- ---------------------------------------------------------------------
create or replace function public.pa_cafe_rows()
returns table (
  cafe_id uuid, name text, created_at timestamptz, suspended_at timestamptz, suspended_reason text,
  plan_code text, plan_name text, sub_status text, trial_ends_at timestamptz, current_period_end timestamptz,
  price_override numeric, monthly_price numeric, state text, owner_id uuid, owner_name text, owner_email text
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.name, c.created_at, c.suspended_at, c.suspended_reason,
    s.plan_code, p.name, s.status, s.trial_ends_at, s.current_period_end,
    s.price_override, coalesce(s.price_override, p.price_monthly, 0),
    case
      when c.suspended_at is not null then 'suspended'
      when s.cafe_id is null then 'active'
      when s.status = 'cancelled' then 'expired'
      when s.status = 'trialing' then case when s.trial_ends_at is null or s.trial_ends_at > now() then 'trial' else 'expired' end
      when s.current_period_end is null or s.current_period_end > now() then case when s.status = 'past_due' then 'past_due' else 'active' end
      when s.current_period_end + interval '7 days' > now() then 'past_due'
      else 'expired'
    end,
    o.id, o.full_name, o.email
  from public.cafes c
  left join public.cafe_subscriptions s on s.cafe_id = c.id
  left join public.plans p on p.code = s.plan_code
  left join lateral (
    select pr.id, pr.full_name, u.email
    from public.profiles pr left join auth.users u on u.id = pr.id
    where pr.cafe_id = c.id and pr.role::text = 'owner'
    order by pr.created_at
    limit 1
  ) o on true
$$;
revoke all on function public.pa_cafe_rows() from public, anon, authenticated;

create or replace function public.pa_month_start(p_offset integer default 0)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select (date_trunc('month', now() at time zone 'Asia/Jakarta') + make_interval(months => p_offset)) at time zone 'Asia/Jakarta'
$$;
revoke all on function public.pa_month_start(integer) from public, anon, authenticated;

create or replace function public.pa_snapshot_mrr()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  select jsonb_build_object(
    'mrr', coalesce(sum(r.monthly_price) filter (where r.state in ('active', 'past_due')), 0),
    'paying', count(*) filter (where r.state in ('active', 'past_due')),
    'trial', count(*) filter (where r.state = 'trial')
  ) into v from public.pa_cafe_rows() r;
  insert into public.platform_mrr_snapshots (month, mrr, paying_cafes, trial_cafes, updated_at)
  values ((public.pa_month_start() at time zone 'Asia/Jakarta')::date, (v ->> 'mrr')::numeric, (v ->> 'paying')::integer, (v ->> 'trial')::integer, now())
  on conflict (month) do update
  set mrr = excluded.mrr, paying_cafes = excluded.paying_cafes, trial_cafes = excluded.trial_cafes, updated_at = now();
  return v;
end;
$$;
revoke all on function public.pa_snapshot_mrr() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- E. Dashboard: baca
-- ---------------------------------------------------------------------
create or replace function public.pa_overview()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
  v_this timestamptz := public.pa_month_start();
  v_prev timestamptz := public.pa_month_start(-1);
begin
  perform public.pa_require();
  perform public.pa_snapshot_mrr();
  select jsonb_build_object(
    'total', count(*),
    'active', count(*) filter (where r.state in ('active', 'past_due')),
    'past_due', count(*) filter (where r.state = 'past_due'),
    'trial', count(*) filter (where r.state = 'trial'),
    'inactive', count(*) filter (where r.state in ('suspended', 'expired')),
    'suspended', count(*) filter (where r.state = 'suspended'),
    'expired', count(*) filter (where r.state = 'expired'),
    'mrr', coalesce(sum(r.monthly_price) filter (where r.state in ('active', 'past_due')), 0),
    'trial_potential', coalesce(sum(r.monthly_price) filter (where r.state = 'trial'), 0),
    'new_cafes_30d', count(*) filter (where r.created_at > now() - interval '30 days'),
    'by_plan', (select coalesce(jsonb_object_agg(x.plan, x.n), '{}'::jsonb) from (
      select coalesce(r2.plan_code, '-') plan, count(*) n from public.pa_cafe_rows() r2
      where r2.state in ('active', 'past_due', 'trial') group by 1) x)
  ) into v
  from public.pa_cafe_rows() r;

  return v || jsonb_build_object(
    'month', (v_this at time zone 'Asia/Jakarta')::date,
    'mrr_prev', (select s.mrr from public.platform_mrr_snapshots s where s.month = (v_prev at time zone 'Asia/Jakarta')::date),
    'revenue_month', (select coalesce(sum(i.amount), 0) from public.subscription_invoices i where i.status = 'paid' and i.paid_at >= v_this),
    'revenue_prev', (select coalesce(sum(i.amount), 0) from public.subscription_invoices i where i.status = 'paid' and i.paid_at >= v_prev and i.paid_at < v_this),
    'pending_count', (select count(*) from public.subscription_invoices i where i.status = 'pending' and i.due_at >= now()),
    'overdue_count', (select count(*) from public.subscription_invoices i where i.status = 'pending' and i.due_at < now()),
    'overdue_amount', (select coalesce(sum(i.amount), 0) from public.subscription_invoices i where i.status = 'pending' and i.due_at < now()),
    'history', (select coalesce(jsonb_agg(jsonb_build_object('month', s.month, 'mrr', s.mrr, 'paying', s.paying_cafes, 'trial', s.trial_cafes) order by s.month), '[]'::jsonb)
                from (select * from public.platform_mrr_snapshots order by month desc limit 12) s)
  );
end;
$$;

create or replace function public.pa_like(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select '%' || replace(replace(replace(p_text, '\', '\\'), '%', '\%'), '_', '\_') || '%'
$$;
revoke all on function public.pa_like(text) from public, anon, authenticated;

create or replace function public.pa_cafes_list(
  p_search text default null, p_state text default null, p_plan text default null,
  p_limit integer default 25, p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_search text := nullif(trim(coalesce(p_search, '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v jsonb;
begin
  perform public.pa_require();
  with r as (
    select * from public.pa_cafe_rows() r
    where (v_search is null or r.name ilike public.pa_like(v_search) or r.owner_email ilike public.pa_like(v_search) or r.owner_name ilike public.pa_like(v_search))
      and (nullif(p_state, '') is null or r.state = p_state)
      and (nullif(p_plan, '') is null or r.plan_code = p_plan)
  )
  select jsonb_build_object(
    'total', (select count(*) from r),
    'rows', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (select * from r order by r.created_at desc limit v_limit offset v_offset) x), '[]'::jsonb)
  ) into v;
  return v;
end;
$$;

create or replace function public.pa_cafe_usage(p_cafe uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tables integer;
begin
  if to_regclass('public.cafe_tables') is not null then
    execute 'select count(*) from public.cafe_tables where cafe_id = $1' into v_tables using p_cafe;
  end if;
  return jsonb_build_object(
    'staff', (select count(*) from public.profiles p where p.cafe_id = p_cafe and p.role::text = 'staff' and coalesce(p.is_active, true)),
    'tables', v_tables,
    'products', (select count(*) from public.products p where p.cafe_id = p_cafe)
  );
end;
$$;
revoke all on function public.pa_cafe_usage(uuid) from public, anon, authenticated;

create or replace function public.pa_cafe_detail(p_cafe uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_effective public.plans;
begin
  perform public.pa_require();
  select to_jsonb(r) into v_row from public.pa_cafe_rows() r where r.cafe_id = p_cafe;
  if v_row is null then
    raise exception 'Kafe tidak ditemukan' using errcode = 'P0002';
  end if;
  v_effective := public.cafe_plan(p_cafe);
  return jsonb_build_object(
    'summary', v_row,
    'cafe', (select to_jsonb(c) from public.cafes c where c.id = p_cafe),
    'subscription', (select to_jsonb(s) from public.cafe_subscriptions s where s.cafe_id = p_cafe),
    'plan', (select to_jsonb(p) from public.plans p where p.code = v_row ->> 'plan_code'),
    'effective_plan', jsonb_build_object('code', v_effective.code, 'name', v_effective.name, 'limits', v_effective.limits, 'features', to_jsonb(v_effective.features)),
    'usage', public.pa_cafe_usage(p_cafe),
    'members', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id', pr.id, 'full_name', pr.full_name, 'role', pr.role::text, 'is_active', coalesce(pr.is_active, true),
                  'email', u.email, 'last_sign_in_at', u.last_sign_in_at) order by pr.role::text, pr.full_name), '[]'::jsonb)
                from public.profiles pr left join auth.users u on u.id = pr.id where pr.cafe_id = p_cafe),
    'orders_30d', (select count(*) from public.orders o where o.cafe_id = p_cafe and o.created_at > now() - interval '30 days'),
    'last_order_at', (select max(o.created_at) from public.orders o where o.cafe_id = p_cafe)
  );
end;
$$;

create or replace function public.pa_invoice_json(p public.subscription_invoices)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select (to_jsonb(p) - 'provider_payload') || jsonb_build_object(
    'state', case when p.status = 'pending' and p.due_at < now() then 'overdue' else p.status end,
    'cafe_name', (select c.name from public.cafes c where c.id = p.cafe_id),
    'plan_name', (select pl.name from public.plans pl where pl.code = p.plan_code)
  )
$$;
revoke all on function public.pa_invoice_json(public.subscription_invoices) from public, anon, authenticated;

create or replace function public.pa_invoices_list(
  p_cafe uuid default null, p_state text default null, p_search text default null,
  p_limit integer default 25, p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_search text := nullif(trim(coalesce(p_search, '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v jsonb;
begin
  perform public.pa_require();
  with r as (
    select i.*, case when i.status = 'pending' and i.due_at < now() then 'overdue' else i.status end as state
    from public.subscription_invoices i join public.cafes c on c.id = i.cafe_id
    where (p_cafe is null or i.cafe_id = p_cafe)
      and (v_search is null or i.number ilike public.pa_like(v_search) or c.name ilike public.pa_like(v_search))
  )
  select jsonb_build_object(
    'total', (select count(*) from r where nullif(p_state, '') is null or r.state = p_state),
    'summary', (select jsonb_build_object(
        'paid', count(*) filter (where r.state = 'paid'), 'paid_amount', coalesce(sum(r.amount) filter (where r.state = 'paid'), 0),
        'pending', count(*) filter (where r.state = 'pending'), 'pending_amount', coalesce(sum(r.amount) filter (where r.state = 'pending'), 0),
        'overdue', count(*) filter (where r.state = 'overdue'), 'overdue_amount', coalesce(sum(r.amount) filter (where r.state = 'overdue'), 0),
        'void', count(*) filter (where r.state = 'void')) from r),
    'rows', coalesce((select jsonb_agg(public.pa_invoice_json(i) order by i.created_at desc)
                      from public.subscription_invoices i
                      where i.id in (select r.id from r where nullif(p_state, '') is null or r.state = p_state
                                     order by r.created_at desc limit v_limit offset greatest(coalesce(p_offset, 0), 0))), '[]'::jsonb)
  ) into v;
  return v;
end;
$$;

create or replace function public.pa_audit_list(
  p_cafe uuid default null, p_action text default null, p_limit integer default 50, p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v jsonb;
begin
  perform public.pa_require();
  with r as (
    select l.*, c.name as cafe_name
    from public.platform_audit_logs l left join public.cafes c on c.id = l.cafe_id
    where (p_cafe is null or l.cafe_id = p_cafe)
      and (nullif(p_action, '') is null or l.action like p_action || '%')
  )
  select jsonb_build_object(
    'total', (select count(*) from r),
    'actions', (select coalesce(jsonb_agg(distinct split_part(l.action, '.', 1)), '[]'::jsonb) from public.platform_audit_logs l),
    'rows', coalesce((select jsonb_agg(to_jsonb(x) order by x.id desc) from (select * from r order by r.id desc limit v_limit offset greatest(coalesce(p_offset, 0), 0)) x), '[]'::jsonb)
  ) into v;
  return v;
end;
$$;

create or replace function public.pa_plans_list()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.pa_require();
  return (select coalesce(jsonb_agg(to_jsonb(p) || jsonb_build_object(
      'cafes', (select count(*) from public.cafe_subscriptions s where s.plan_code = p.code)) order by p.sort_order, p.code), '[]'::jsonb)
    from public.plans p);
end;
$$;

-- ---------------------------------------------------------------------
-- E. Dashboard: ubah (semua menulis platform_audit_logs)
-- ---------------------------------------------------------------------
create or replace function public.pa_cafe_set_suspended(p_cafe uuid, p_suspend boolean, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := nullif(left(trim(coalesce(p_reason, '')), 300), '');
  v_before jsonb;
  v_after jsonb;
begin
  perform public.pa_require();
  select jsonb_build_object('suspended_at', c.suspended_at, 'suspended_reason', c.suspended_reason) into v_before
  from public.cafes c where c.id = p_cafe for update;
  if v_before is null then
    raise exception 'Kafe tidak ditemukan' using errcode = 'P0002';
  end if;
  if coalesce(p_suspend, false) = ((v_before ->> 'suspended_at') is not null) then
    raise exception '%', case when p_suspend then 'Kafe ini sudah nonaktif' else 'Kafe ini sudah aktif' end using errcode = 'P0001';
  end if;
  if p_suspend and v_reason is null then
    raise exception 'Isi alasan menonaktifkan kafe' using errcode = 'P0001';
  end if;
  update public.cafes
  set suspended_at = case when p_suspend then now() end,
      suspended_reason = case when p_suspend then v_reason end
  where id = p_cafe
  returning jsonb_build_object('suspended_at', suspended_at, 'suspended_reason', suspended_reason) into v_after;
  perform public.pa_log(case when p_suspend then 'cafe.suspend' else 'cafe.unsuspend' end, p_cafe, 'cafe', p_cafe::text, v_before, v_after, v_reason);
  return v_after;
end;
$$;

create or replace function public.pa_plan_upsert(
  p_code text, p_name text, p_description text, p_price_monthly numeric, p_limits jsonb, p_features text[],
  p_is_public boolean default true, p_is_archived boolean default false, p_sort_order integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text := lower(trim(coalesce(p_code, '')));
  v_name text := nullif(left(trim(coalesce(p_name, '')), 60), '');
  v_features text[];
  v_before jsonb;
  v_after jsonb;
begin
  perform public.pa_require();
  if v_code !~ '^[a-z0-9_-]{2,30}$' then
    raise exception 'Kode paket 2–30 karakter: huruf kecil, angka, - atau _' using errcode = 'P0001';
  end if;
  if v_name is null then
    raise exception 'Nama paket wajib diisi' using errcode = 'P0001';
  end if;
  if p_price_monthly is not null and p_price_monthly < 0 then
    raise exception 'Harga tidak boleh negatif' using errcode = 'P0001';
  end if;
  if p_limits is null or jsonb_typeof(p_limits) <> 'object' then
    raise exception 'Batas paket tidak valid' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from jsonb_each(p_limits) e
    where e.key not in ('staff', 'tables', 'products') or jsonb_typeof(e.value) <> 'number'
       or (e.value #>> '{}')::numeric < 1 or (e.value #>> '{}')::numeric <> trunc((e.value #>> '{}')::numeric)
  ) then
    raise exception 'Batas hanya staff/tables/products berupa bilangan bulat ≥ 1 (kosong = tanpa batas)' using errcode = 'P0001';
  end if;
  v_features := array(select distinct f from unnest(coalesce(p_features, '{}')) f order by f);
  if exists (select 1 from unnest(v_features) f where f not in ('inventory', 'finance', 'loyalty', 'qr_ordering', 'payment_gateway', 'ai_advisor')) then
    raise exception 'Modul tidak dikenal' using errcode = 'P0001';
  end if;
  if v_code = 'basic' and coalesce(p_is_archived, false) then
    raise exception 'Paket basic dipakai sebagai paket cadangan dan tidak bisa diarsipkan' using errcode = 'P0001';
  end if;

  select to_jsonb(p) into v_before from public.plans p where p.code = v_code for update;
  insert into public.plans (code, name, description, price_monthly, limits, features, is_public, is_archived, sort_order)
  values (v_code, v_name, nullif(left(trim(coalesce(p_description, '')), 200), ''), p_price_monthly, p_limits, v_features,
          coalesce(p_is_public, true), coalesce(p_is_archived, false),
          coalesce(p_sort_order, (select coalesce(max(sort_order), 0) + 1 from public.plans)))
  on conflict (code) do update
  set name = excluded.name, description = excluded.description, price_monthly = excluded.price_monthly,
      limits = excluded.limits, features = excluded.features, is_public = excluded.is_public,
      is_archived = excluded.is_archived, sort_order = coalesce(p_sort_order, public.plans.sort_order)
  returning to_jsonb(plans.*) into v_after;
  perform public.pa_log(case when v_before is null then 'plan.create' else 'plan.update' end, null, 'plan', v_code, v_before, v_after);
  return v_after;
end;
$$;

-- Kunci baris langganan (dibuat bila belum ada)
create or replace function public.pa_sub_lock(p_cafe uuid)
returns public.cafe_subscriptions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.cafe_subscriptions;
begin
  if not exists (select 1 from public.cafes c where c.id = p_cafe) then
    raise exception 'Kafe tidak ditemukan' using errcode = 'P0002';
  end if;
  insert into public.cafe_subscriptions (cafe_id, plan_code, status) values (p_cafe, 'basic', 'active') on conflict (cafe_id) do nothing;
  select * into v from public.cafe_subscriptions s where s.cafe_id = p_cafe for update;
  return v;
end;
$$;
revoke all on function public.pa_sub_lock(uuid) from public, anon, authenticated;

create or replace function public.pa_sub_json(p public.cafe_subscriptions)
returns jsonb
language sql
immutable
set search_path = ''
as $$ select to_jsonb(p) - 'updated_at' $$;
revoke all on function public.pa_sub_json(public.cafe_subscriptions) from public, anon, authenticated;

create or replace function public.pa_subscription_set_plan(
  p_cafe uuid, p_plan text, p_price_override numeric default null, p_clear_override boolean default false, p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.cafe_subscriptions;
  v_new public.cafe_subscriptions;
begin
  perform public.pa_require();
  v_old := public.pa_sub_lock(p_cafe);
  if not exists (select 1 from public.plans p where p.code = p_plan and (not p.is_archived or p.code = v_old.plan_code)) then
    raise exception 'Paket tidak ditemukan atau sudah diarsipkan' using errcode = 'P0001';
  end if;
  if p_price_override is not null and p_price_override < 0 then
    raise exception 'Harga khusus tidak boleh negatif' using errcode = 'P0001';
  end if;
  update public.cafe_subscriptions
  set plan_code = p_plan,
      price_override = case when p_clear_override then null else coalesce(p_price_override, price_override) end,
      notes = coalesce(nullif(trim(coalesce(p_note, '')), ''), notes),
      updated_at = now()
  where cafe_id = p_cafe
  returning * into v_new;
  perform public.pa_log('subscription.plan', p_cafe, 'subscription', p_cafe::text, public.pa_sub_json(v_old), public.pa_sub_json(v_new), p_note);
  return public.pa_sub_json(v_new);
end;
$$;

create or replace function public.pa_subscription_extend(p_cafe uuid, p_months integer, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.cafe_subscriptions;
  v_new public.cafe_subscriptions;
begin
  perform public.pa_require();
  if p_months is null or p_months not between 1 and 24 then
    raise exception 'Perpanjang 1–24 bulan' using errcode = 'P0001';
  end if;
  v_old := public.pa_sub_lock(p_cafe);
  update public.cafe_subscriptions
  set status = 'active',
      current_period_end = greatest(now(), coalesce(current_period_end, now()),
                                    case when status = 'trialing' then coalesce(trial_ends_at, now()) else now() end)
                           + make_interval(months => p_months),
      notes = coalesce(nullif(trim(coalesce(p_note, '')), ''), notes),
      updated_at = now()
  where cafe_id = p_cafe
  returning * into v_new;
  perform public.pa_log('subscription.extend', p_cafe, 'subscription', p_cafe::text, public.pa_sub_json(v_old), public.pa_sub_json(v_new), p_note);
  return public.pa_sub_json(v_new);
end;
$$;

create or replace function public.pa_subscription_trial(p_cafe uuid, p_days integer, p_plan text default null, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.cafe_subscriptions;
  v_new public.cafe_subscriptions;
begin
  perform public.pa_require();
  if p_days is null or p_days not between 1 and 90 then
    raise exception 'Masa coba 1–90 hari' using errcode = 'P0001';
  end if;
  v_old := public.pa_sub_lock(p_cafe);
  if p_plan is not null and not exists (select 1 from public.plans p where p.code = p_plan and not p.is_archived) then
    raise exception 'Paket tidak ditemukan atau sudah diarsipkan' using errcode = 'P0001';
  end if;
  update public.cafe_subscriptions
  set status = 'trialing', trial_ends_at = now() + make_interval(days => p_days),
      plan_code = coalesce(p_plan, plan_code),
      notes = coalesce(nullif(trim(coalesce(p_note, '')), ''), notes),
      updated_at = now()
  where cafe_id = p_cafe
  returning * into v_new;
  perform public.pa_log('subscription.trial', p_cafe, 'subscription', p_cafe::text, public.pa_sub_json(v_old), public.pa_sub_json(v_new), p_note);
  return public.pa_sub_json(v_new);
end;
$$;

-- ---------------------------------------------------------------------
-- D. Tagihan
-- ---------------------------------------------------------------------
-- Awal periode tagihan berikutnya untuk paket tertentu
create or replace function public.pa_next_period_start(p_cafe uuid, p_plan text)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(now(), coalesce((
    select case when s.status = 'trialing' then s.trial_ends_at
                when s.status in ('active', 'past_due') then s.current_period_end end
    from public.cafe_subscriptions s where s.cafe_id = p_cafe and s.plan_code = p_plan
  ), now()))
$$;
revoke all on function public.pa_next_period_start(uuid, text) from public, anon, authenticated;

create or replace function public.pa_plan_price(p_cafe uuid, p_plan text)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select s.price_override from public.cafe_subscriptions s where s.cafe_id = p_cafe and s.plan_code = p_plan),
    (select p.price_monthly from public.plans p where p.code = p_plan),
    0)
$$;
revoke all on function public.pa_plan_price(uuid, text) from public, anon, authenticated;

create or replace function public.pa_invoice_insert(
  p_cafe uuid, p_plan text, p_months integer, p_amount numeric, p_start timestamptz, p_due timestamptz,
  p_source text, p_actor uuid, p_note text
)
returns public.subscription_invoices
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.subscription_invoices;
begin
  if p_months is null or p_months not between 1 and 24 then
    raise exception 'Lama tagihan 1–24 bulan' using errcode = 'P0001';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Nominal tagihan harus lebih dari 0 (paket gratis tidak perlu ditagih)' using errcode = 'P0001';
  end if;
  insert into public.subscription_invoices (number, cafe_id, plan_code, months, period_start, period_end, amount, due_at, source, created_by, note)
  values (
    'INV-' || to_char(now() at time zone 'Asia/Jakarta', 'YYMM') || '-' || lpad(nextval('public.subscription_invoice_seq')::text, 5, '0'),
    p_cafe, p_plan, p_months, p_start, p_start + make_interval(months => p_months), round(p_amount, 2), p_due, p_source, p_actor,
    nullif(left(trim(coalesce(p_note, '')), 300), '')
  )
  returning * into v;
  return v;
end;
$$;
revoke all on function public.pa_invoice_insert(uuid, text, integer, numeric, timestamptz, timestamptz, text, uuid, text) from public, anon, authenticated;

create or replace function public.pa_invoice_create(
  p_cafe uuid, p_plan text default null, p_months integer default 1, p_amount numeric default null,
  p_due_days integer default 7, p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.pa_require();
  v_sub public.cafe_subscriptions;
  v_plan text;
  v public.subscription_invoices;
begin
  v_sub := public.pa_sub_lock(p_cafe);
  v_plan := coalesce(nullif(p_plan, ''), v_sub.plan_code);
  if not exists (select 1 from public.plans p where p.code = v_plan) then
    raise exception 'Paket tidak ditemukan' using errcode = 'P0001';
  end if;
  if p_due_days is null or p_due_days not between 0 and 60 then
    raise exception 'Jatuh tempo 0–60 hari' using errcode = 'P0001';
  end if;
  v := public.pa_invoice_insert(p_cafe, v_plan, p_months,
         coalesce(p_amount, public.pa_plan_price(p_cafe, v_plan) * coalesce(p_months, 1)),
         public.pa_next_period_start(p_cafe, v_plan), now() + make_interval(days => p_due_days), 'admin', v_actor, p_note);
  perform public.pa_log('invoice.create', p_cafe, 'invoice', v.id::text, null, public.pa_invoice_json(v), p_note);
  return public.pa_invoice_json(v);
end;
$$;

-- Tandai lunas + perpanjang langganan (dipakai manual & gateway)
create or replace function public.pa_apply_invoice_paid(
  p_invoice uuid, p_method text, p_ref text, p_paid_at timestamptz, p_actor uuid, p_actor_label text, p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.subscription_invoices;
  v_old public.cafe_subscriptions;
  v_new public.cafe_subscriptions;
begin
  select * into v_inv from public.subscription_invoices i where i.id = p_invoice for update;
  if not found then
    raise exception 'Tagihan tidak ditemukan' using errcode = 'P0002';
  end if;
  if v_inv.status <> 'pending' then
    raise exception '%', case when v_inv.status = 'paid' then 'Tagihan sudah lunas' else 'Tagihan sudah dibatalkan' end using errcode = 'P0001';
  end if;
  v_old := public.pa_sub_lock(v_inv.cafe_id);

  update public.subscription_invoices
  set status = 'paid', paid_at = coalesce(p_paid_at, now()), method = p_method,
      payment_ref = coalesce(nullif(left(trim(coalesce(p_ref, '')), 120), ''), payment_ref), updated_at = now()
  where id = p_invoice
  returning * into v_inv;

  update public.cafe_subscriptions
  set plan_code = v_inv.plan_code,
      status = 'active',
      current_period_end = case
        when plan_code = v_inv.plan_code and current_period_end is not null then greatest(current_period_end, v_inv.period_end)
        else v_inv.period_end end,
      updated_at = now()
  where cafe_id = v_inv.cafe_id
  returning * into v_new;

  perform public.pa_log('invoice.paid', v_inv.cafe_id, 'invoice', v_inv.id::text,
    jsonb_build_object('status', 'pending', 'subscription', public.pa_sub_json(v_old)),
    jsonb_build_object('status', 'paid', 'method', p_method, 'payment_ref', v_inv.payment_ref, 'paid_at', v_inv.paid_at, 'amount', v_inv.amount,
                       'subscription', public.pa_sub_json(v_new)),
    p_note, p_actor, p_actor_label);
  return public.pa_invoice_json(v_inv);
end;
$$;
revoke all on function public.pa_apply_invoice_paid(uuid, text, text, timestamptz, uuid, text, text) from public, anon, authenticated;

create or replace function public.pa_invoice_mark_paid(p_invoice uuid, p_paid_at timestamptz default null, p_ref text default null, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.pa_require();
  if p_paid_at is not null and p_paid_at > now() + interval '1 day' then
    raise exception 'Tanggal bayar tidak boleh di masa depan' using errcode = 'P0001';
  end if;
  return public.pa_apply_invoice_paid(p_invoice, 'manual_transfer', p_ref, p_paid_at, null, null, p_note);
end;
$$;

create or replace function public.pa_invoice_void(p_invoice uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.subscription_invoices;
begin
  perform public.pa_require();
  select * into v_inv from public.subscription_invoices i where i.id = p_invoice for update;
  if not found then
    raise exception 'Tagihan tidak ditemukan' using errcode = 'P0002';
  end if;
  if v_inv.status <> 'pending' then
    raise exception 'Hanya tagihan yang belum dibayar yang bisa dibatalkan' using errcode = 'P0001';
  end if;
  update public.subscription_invoices set status = 'void', updated_at = now(),
    note = coalesce(nullif(trim(coalesce(p_note, '')), ''), note)
  where id = p_invoice returning * into v_inv;
  perform public.pa_log('invoice.void', v_inv.cafe_id, 'invoice', v_inv.id::text, jsonb_build_object('status', 'pending'), jsonb_build_object('status', 'void'), p_note);
  return public.pa_invoice_json(v_inv);
end;
$$;

-- ---------------------------------------------------------------------
-- Khusus Edge Function platform-admin (service_role)
-- ---------------------------------------------------------------------
create or replace function public.pa_cafe_create_for_owner(
  p_actor uuid, p_owner_id uuid, p_cafe_name text, p_owner_name text, p_plan text, p_trial_days integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := nullif(left(trim(coalesce(p_cafe_name, '')), 80), '');
  v_owner_name text := nullif(left(trim(coalesce(p_owner_name, '')), 80), '');
  v_cafe uuid;
  v_slug text;
  v_email text;
  v_sub public.cafe_subscriptions;
begin
  if not exists (select 1 from public.platform_admins a where a.user_id = p_actor and a.is_active) then
    raise exception 'Khusus admin platform Dailybrew' using errcode = '42501', hint = 'platform_admin_only';
  end if;
  if v_name is null or length(v_name) < 2 then
    raise exception 'Nama kafe minimal 2 karakter' using errcode = 'P0001';
  end if;
  if v_owner_name is null or length(v_owner_name) < 2 then
    raise exception 'Nama owner minimal 2 karakter' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.plans p where p.code = p_plan and not p.is_archived) then
    raise exception 'Paket tidak ditemukan atau sudah diarsipkan' using errcode = 'P0001';
  end if;
  if p_trial_days is null or p_trial_days not between 0 and 90 then
    raise exception 'Masa coba 0–90 hari' using errcode = 'P0001';
  end if;
  select u.email into v_email from auth.users u where u.id = p_owner_id;
  if not found then
    raise exception 'Akun owner tidak ditemukan' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.profiles p where p.id = p_owner_id and p.cafe_id is not null) then
    raise exception 'Akun ini sudah terhubung ke kafe lain' using errcode = 'P0001';
  end if;

  -- Kolom slug ada di sebagian instalasi (wajib & unik) — isi bila ada
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'cafes' and column_name = 'slug') then
    v_slug := trim(both '-' from regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g'));
    if v_slug = '' then v_slug := 'kafe'; end if;
    v_slug := left(v_slug, 40) || '-' || substr(md5(gen_random_uuid()::text), 1, 5);
    execute 'insert into public.cafes (name, slug) values ($1, $2) returning id' into v_cafe using v_name, v_slug;
  else
    insert into public.cafes (name) values (v_name) returning id into v_cafe;
  end if;

  insert into public.profiles (id, cafe_id, full_name, role)
  values (p_owner_id, v_cafe, v_owner_name, 'owner')
  on conflict (id) do update set cafe_id = excluded.cafe_id, full_name = excluded.full_name, role = excluded.role;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'email') then
    execute 'update public.profiles set email = $1 where id = $2' using v_email, p_owner_id;
  end if;

  -- Trigger file 10 sudah membuat baris langganan (Pro, coba 30 hari) → sesuaikan
  perform public.pa_sub_lock(v_cafe);
  update public.cafe_subscriptions
  set plan_code = p_plan, status = 'trialing', trial_ends_at = now() + make_interval(days => p_trial_days),
      current_period_end = null, updated_at = now()
  where cafe_id = v_cafe
  returning * into v_sub;

  perform public.pa_log('cafe.create', v_cafe, 'cafe', v_cafe::text, null,
    jsonb_build_object('name', v_name, 'owner_id', p_owner_id, 'owner_name', v_owner_name, 'owner_email', v_email,
                       'plan', p_plan, 'trial_days', p_trial_days, 'subscription', public.pa_sub_json(v_sub)),
    null, p_actor, null);
  return jsonb_build_object('cafe_id', v_cafe, 'owner_id', p_owner_id);
end;
$$;
revoke all on function public.pa_cafe_create_for_owner(uuid, uuid, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.pa_cafe_create_for_owner(uuid, uuid, text, text, text, integer) to service_role;

-- ---------------------------------------------------------------------
-- F. Penagihan otomatis (pg_cron / service_role)
-- ---------------------------------------------------------------------
-- H-7 sebelum masa coba / periode berakhir: buat tagihan 1 bulan (sekali per periode).
-- Langganan aktif yang lewat jatuh tempo ditandai past_due (fitur tetap jalan selama tenggang 7 hari).
create or replace function public.pa_billing_run()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_raw timestamptz;
  v_start timestamptz;
  v_inv public.subscription_invoices;
  v_created integer := 0;
  v_past_due integer := 0;
begin
  for r in
    select s.*, coalesce(s.price_override, p.price_monthly, 0) as price
    from public.cafe_subscriptions s
    join public.plans p on p.code = s.plan_code
    join public.cafes c on c.id = s.cafe_id
    where c.suspended_at is null
      and s.status in ('active', 'past_due', 'trialing')
      and coalesce(s.price_override, p.price_monthly, 0) > 0
    for update of s
  loop
    v_raw := case when r.status = 'trialing' then r.trial_ends_at else r.current_period_end end;
    continue when v_raw is null or v_raw > now() + interval '7 days';
    v_start := greatest(v_raw, now());
    continue when exists (
      select 1 from public.subscription_invoices i
      where i.cafe_id = r.cafe_id and (i.status = 'pending' or (i.status = 'paid' and i.period_end > v_start + interval '1 day'))
    );
    v_inv := public.pa_invoice_insert(r.cafe_id, r.plan_code, 1, r.price, v_start, greatest(v_raw, now() + interval '3 days'), 'system', null, null);
    perform public.pa_log('invoice.create', r.cafe_id, 'invoice', v_inv.id::text, null, public.pa_invoice_json(v_inv), 'Tagihan otomatis', null, 'sistem');
    v_created := v_created + 1;
  end loop;

  with changed as (
    update public.cafe_subscriptions s set status = 'past_due', updated_at = now()
    where s.status = 'active' and s.current_period_end is not null and s.current_period_end < now()
    returning s.cafe_id
  )
  select count(*) into v_past_due from changed;

  perform public.pa_snapshot_mrr();
  return jsonb_build_object('invoices_created', v_created, 'marked_past_due', v_past_due, 'ran_at', now());
end;
$$;
revoke all on function public.pa_billing_run() from public, anon, authenticated;
grant execute on function public.pa_billing_run() to service_role;

-- ---------------------------------------------------------------------
-- F. Owner: lihat tagihan, minta tagihan (upgrade/perpanjang sendiri)
-- ---------------------------------------------------------------------
create or replace function public.owner_invoices(p_cafe_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.pa_is_cafe_owner(p_cafe_id, (select auth.uid())) then
    raise exception 'Hanya owner kafe ini' using errcode = '42501';
  end if;
  return (select coalesce(jsonb_agg(
      public.pa_invoice_json(i) - 'created_by' - 'provider_order_id' - 'note' order by i.created_at desc), '[]'::jsonb)
    from (select * from public.subscription_invoices x where x.cafe_id = p_cafe_id and x.status <> 'void' order by x.created_at desc limit 24) i);
end;
$$;
revoke all on function public.owner_invoices(uuid) from public, anon;
grant execute on function public.owner_invoices(uuid) to authenticated;

create or replace function public.owner_invoice_request(p_cafe_id uuid, p_plan text, p_months integer default 1)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_existing public.subscription_invoices;
  v public.subscription_invoices;
begin
  if not public.pa_is_cafe_owner(p_cafe_id, v_user) then
    raise exception 'Hanya owner kafe ini' using errcode = '42501';
  end if;
  if exists (select 1 from public.cafes c where c.id = p_cafe_id and c.suspended_at is not null) then
    raise exception 'Kafe sedang dinonaktifkan. Hubungi Dailybrew.' using errcode = 'P0001', hint = 'cafe_suspended';
  end if;
  if not exists (select 1 from public.plans p where p.code = p_plan and p.is_public and not p.is_archived and coalesce(p.price_monthly, 0) > 0) then
    raise exception 'Paket ini tidak bisa dipilih sendiri. Hubungi Dailybrew.' using errcode = 'P0001';
  end if;
  if p_months is null or p_months not in (1, 3, 6, 12) then
    raise exception 'Pilih 1, 3, 6, atau 12 bulan' using errcode = 'P0001';
  end if;
  perform public.pa_sub_lock(p_cafe_id);

  select * into v_existing from public.subscription_invoices i
  where i.cafe_id = p_cafe_id and i.status = 'pending' and i.plan_code = p_plan and i.months = p_months
  order by i.created_at desc limit 1;
  if found then
    return public.pa_invoice_json(v_existing) - 'created_by' - 'provider_order_id' - 'note';
  end if;
  -- Tagihan menunggu lain buatan owner sendiri diganti; tagihan dari admin/sistem tidak disentuh
  if exists (select 1 from public.subscription_invoices i where i.cafe_id = p_cafe_id and i.status = 'pending' and i.source <> 'owner') then
    raise exception 'Masih ada tagihan yang belum dibayar. Selesaikan tagihan itu dulu.' using errcode = 'P0001', hint = 'invoice_pending';
  end if;
  update public.subscription_invoices set status = 'void', note = 'Diganti owner', updated_at = now()
  where cafe_id = p_cafe_id and status = 'pending' and source = 'owner';

  v := public.pa_invoice_insert(p_cafe_id, p_plan, p_months, public.pa_plan_price(p_cafe_id, p_plan) * p_months,
         public.pa_next_period_start(p_cafe_id, p_plan), now() + interval '3 days', 'owner', v_user, null);
  perform public.pa_log('invoice.create', p_cafe_id, 'invoice', v.id::text, null, public.pa_invoice_json(v), 'Diminta owner', v_user, null);
  return public.pa_invoice_json(v) - 'created_by' - 'provider_order_id' - 'note';
end;
$$;
revoke all on function public.owner_invoice_request(uuid, text, integer) from public, anon;
grant execute on function public.owner_invoice_request(uuid, text, integer) to authenticated;

-- ---------------------------------------------------------------------
-- F. Gateway Midtrans (Edge Function subscription-billing, service_role)
-- ---------------------------------------------------------------------
create or replace function public.pa_gateway_prepare(p_invoice uuid, p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.subscription_invoices;
begin
  select * into v from public.subscription_invoices i where i.id = p_invoice for update;
  if not found or not public.pa_is_cafe_owner(v.cafe_id, p_user) then
    raise exception 'Tagihan tidak ditemukan' using errcode = 'P0002';
  end if;
  if v.status <> 'pending' then
    raise exception '%', case when v.status = 'paid' then 'Tagihan sudah lunas' else 'Tagihan sudah dibatalkan' end using errcode = 'P0001';
  end if;
  -- Link Snap berlaku 24 jam: pakai ulang bila masih baru
  if v.checkout_url is not null and v.checkout_created_at > now() - interval '23 hours' then
    return jsonb_build_object('reuse', true, 'checkout_url', v.checkout_url, 'provider_order_id', v.provider_order_id);
  end if;
  update public.subscription_invoices
  set provider = 'midtrans',
      provider_order_id = v.number || '-' || to_char(clock_timestamp() at time zone 'UTC', 'YYMMDDHH24MISS'),
      checkout_url = null, checkout_created_at = null, updated_at = now()
  where id = p_invoice
  returning * into v;
  return jsonb_build_object(
    'reuse', false, 'provider_order_id', v.provider_order_id, 'amount', v.amount, 'number', v.number, 'months', v.months,
    'plan_name', (select p.name from public.plans p where p.code = v.plan_code),
    'cafe_name', (select c.name from public.cafes c where c.id = v.cafe_id),
    'owner_name', (select p.full_name from public.profiles p where p.id = p_user),
    'owner_email', (select u.email from auth.users u where u.id = p_user)
  );
end;
$$;
revoke all on function public.pa_gateway_prepare(uuid, uuid) from public, anon, authenticated;
grant execute on function public.pa_gateway_prepare(uuid, uuid) to service_role;

create or replace function public.pa_gateway_save_checkout(p_provider_order_id text, p_url text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.subscription_invoices set checkout_url = p_url, checkout_created_at = now(), updated_at = now()
  where provider_order_id = p_provider_order_id and status = 'pending'
$$;
revoke all on function public.pa_gateway_save_checkout(text, text) from public, anon, authenticated;
grant execute on function public.pa_gateway_save_checkout(text, text) to service_role;

-- Pemilik tagihan (untuk aksi "cek status" dari owner)
create or replace function public.pa_gateway_lookup(p_invoice uuid, p_user uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select i.provider_order_id from public.subscription_invoices i
  where i.id = p_invoice and public.pa_is_cafe_owner(i.cafe_id, p_user)
$$;
revoke all on function public.pa_gateway_lookup(uuid, uuid) from public, anon, authenticated;
grant execute on function public.pa_gateway_lookup(uuid, uuid) to service_role;

-- Terapkan status dari API Midtrans (idempoten). Lunas hanya bila settlement/capture(accept) & nominal cukup.
create or replace function public.pa_gateway_apply(p_provider_order_id text, p_status text, p_fraud text, p_gross numeric, p_raw jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.subscription_invoices;
  v_paid boolean := p_status in ('settlement', 'capture') and coalesce(p_fraud, 'accept') = 'accept';
begin
  select * into v from public.subscription_invoices i where i.provider_order_id = p_provider_order_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'unknown_order');
  end if;
  update public.subscription_invoices set provider_status = p_status, provider_payload = p_raw, updated_at = now() where id = v.id;
  if not v_paid then
    return jsonb_build_object('ok', true, 'paid', false, 'status', v.status);
  end if;
  if v.status = 'paid' then
    return jsonb_build_object('ok', true, 'paid', true, 'already', true);
  end if;
  if coalesce(p_gross, 0) < v.amount then
    perform public.pa_log('invoice.underpaid', v.cafe_id, 'invoice', v.id::text, null, jsonb_build_object('gross', p_gross, 'amount', v.amount), 'Nominal dari gateway kurang', null, 'midtrans');
    return jsonb_build_object('ok', false, 'reason', 'amount_mismatch');
  end if;
  if v.status = 'void' then
    perform public.pa_log('invoice.paid_after_void', v.cafe_id, 'invoice', v.id::text, null, jsonb_build_object('gross', p_gross), 'Dibayar setelah dibatalkan — cek & refund/aktifkan manual', null, 'midtrans');
    return jsonb_build_object('ok', false, 'reason', 'void');
  end if;
  perform public.pa_apply_invoice_paid(v.id, 'gateway', p_provider_order_id, now(), null, 'midtrans', null);
  return jsonb_build_object('ok', true, 'paid', true, 'already', false);
end;
$$;
revoke all on function public.pa_gateway_apply(text, text, text, numeric, jsonb) from public, anon, authenticated;
grant execute on function public.pa_gateway_apply(text, text, text, numeric, jsonb) to service_role;

-- ---------------------------------------------------------------------
-- Hak panggil fungsi dashboard: hanya authenticated (pa_require menolak non-admin / non-2FA)
-- ---------------------------------------------------------------------
do $$
declare
  v_sig text;
begin
  foreach v_sig in array array[
    'pa_overview()', 'pa_cafes_list(text, text, text, integer, integer)', 'pa_cafe_detail(uuid)',
    'pa_invoices_list(uuid, text, text, integer, integer)', 'pa_audit_list(uuid, text, integer, integer)', 'pa_plans_list()',
    'pa_cafe_set_suspended(uuid, boolean, text)',
    'pa_plan_upsert(text, text, text, numeric, jsonb, text[], boolean, boolean, integer)',
    'pa_subscription_set_plan(uuid, text, numeric, boolean, text)', 'pa_subscription_extend(uuid, integer, text)',
    'pa_subscription_trial(uuid, integer, text, text)',
    'pa_invoice_create(uuid, text, integer, numeric, integer, text)', 'pa_invoice_mark_paid(uuid, timestamptz, text, text)',
    'pa_invoice_void(uuid, text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', v_sig);
    execute format('grant execute on function public.%s to authenticated', v_sig);
  end loop;
end;
$$;

notify pgrst, 'reload schema';

commit;

-- Verifikasi: 5 tabel + 1 trigger, dan baris "tanpa_rls" TIDAK boleh muncul
select 'table' as kind, table_name as name
from information_schema.tables
where table_schema = 'public' and table_name in ('platform_admins', 'platform_audit_logs', 'subscription_invoices', 'platform_mrr_snapshots', 'cafe_subscriptions')
union all
select 'trigger', tgname::text from pg_trigger where tgname = 'orders_block_suspended' and not tgisinternal
union all
select 'tanpa_rls', c.relname
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
order by 1, 2;

-- =====================================================================
-- ADMIN PERTAMA (jalankan terpisah, SEKALI, setelah file di atas):
--   1. Supabase Dashboard → Authentication → Users → Add user → Create new user
--      (email + password kuat, centang Auto Confirm User).
--   2. Ganti email di bawah lalu jalankan:
--
-- insert into public.platform_admins (user_id, full_name)
-- select id, 'Nama Kamu' from auth.users where email = 'admin@domainkamu.id'
-- on conflict (user_id) do update set is_active = true, full_name = excluded.full_name
-- returning user_id;
--
--   3. Login di dashboard platform → aplikasi meminta daftar 2FA (scan QR dengan
--      Google Authenticator / Authy) sebelum bisa membuka apa pun.
--
-- JADWAL pg_cron (penagihan otomatis harian 08.00 WIB = 01.00 UTC):
--   Dashboard → Database → Extensions → aktifkan "pg_cron", lalu jalankan:
--
-- select cron.schedule('dailybrew-tagihan-harian', '0 1 * * *', $$select public.pa_billing_run()$$);
--
--   Cek jadwal:   select * from cron.job;
--   Hapus jadwal: select cron.unschedule('dailybrew-tagihan-harian');
-- =====================================================================
