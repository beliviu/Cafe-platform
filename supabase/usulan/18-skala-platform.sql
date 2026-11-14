-- =====================================================================
-- 18 · PLATFORM SIAP BANYAK KAFE: DAFTAR SENDIRI, PERAN TIM ADMIN, FEATURE FLAG, LIHAT-SEBAGAI (BACA-SAJA),
--      HALAMAN STATUS, ADVISOR AI PLATFORM, PENGATURAN PLATFORM & TEMPLATE EMAIL
-- ---------------------------------------------------------------------
-- Bergantung pada file 14–17. Satu transaksi, aditif. Aman dijalankan ulang.
--
-- Isi:
--   A. Pengaturan platform baru: daftar sendiri (nyala/mati, mode persetujuan), lama & paket trial bawaan,
--      masa tenggang fitur (bawaan 7 hari, sebelumnya tetap), kuota Tanya AI admin.
--   B. Peran tim admin: super (semua), finance (tagihan & keuangan), support (kafe baca-saja, tiket, catatan).
--      Ditegakkan di pa_require(): fungsi pemanggil dicocokkan dengan tabel platform_role_permissions;
--      fungsi yang tidak terdaftar = khusus super. Edge Function memakai pa_admin_can().
--   C. Feature flag per kafe (di luar batas paket): nyala/mati per kafe, massal, riwayat di log audit.
--      cafe_has_feature() & cafe_entitlements() ikut membaca flag; web owner membaca cafe_flags().
--   D. Lihat-sebagai (impersonation) baca-saja: admin super/support membuka web owner sebuah kafe 30 menit,
--      dengan alasan & log audit. Akses baca lewat helper RLS (is_cafe_member/has_cafe_role/pa_is_cafe_owner);
--      SEMUA tulis ke tabel public diblok trigger tingkat statement (kecuali fungsi admin pa_* sendiri).
--   E. Halaman status publik: layanan + insiden + pembaruan. public_status() boleh dibaca tanpa login,
--      tidak memuat data kafe/admin.
--   F. Daftar sendiri: Edge Function self-signup (Turnstile + batas per IP) → pa_signup_create (kafe + owner +
--      trial). Mode persetujuan: kafe menunggu (nonaktif jenis "approval") sampai admin menyetujui.
--   G. Wizard setup 8 langkah untuk owner (owner_setup_progress).
--   H. Template email (selamat datang, tagihan, pengingat, reset password) — dipakai Edge Function notify.
--   I. Advisor AI platform: angka dihitung SQL (pa_ai_facts), kuota per admin per hari, log pemakaian.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- A. Pengaturan platform
-- ---------------------------------------------------------------------
alter table public.platform_settings add column if not exists signup_enabled boolean not null default true;
alter table public.platform_settings add column if not exists signup_approval_mode boolean not null default false;
alter table public.platform_settings add column if not exists default_trial_days integer not null default 14;
alter table public.platform_settings add column if not exists default_trial_plan text not null default 'pro';
alter table public.platform_settings add column if not exists billing_grace_days integer not null default 7;
alter table public.platform_settings add column if not exists ai_daily_limit integer not null default 30;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'platform_settings_scale_check') then
    alter table public.platform_settings add constraint platform_settings_scale_check check (
      default_trial_days between 0 and 90 and billing_grace_days between 0 and 30 and ai_daily_limit between 0 and 500);
  end if;
end;
$$;

-- Masa tenggang fitur paket setelah masa berlaku habis (dulu tetap 7 hari)
create or replace function public.pa_grace_days()
returns integer
language sql
stable
security definer
set search_path = ''
as $$ select coalesce((select s.billing_grace_days from public.platform_settings s where s.id), 7) $$;

create or replace function public.pa_grace()
returns interval
language sql
stable
security definer
set search_path = ''
as $$ select make_interval(days => public.pa_grace_days()) $$;

-- ---------------------------------------------------------------------
-- B. Peran tim admin
-- ---------------------------------------------------------------------
alter table public.platform_admins add column if not exists role text not null default 'super';
alter table public.platform_admins add column if not exists email text;
alter table public.platform_admins add column if not exists invited_by uuid references auth.users (id) on delete set null;
alter table public.platform_admins add column if not exists updated_at timestamptz not null default now();
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'platform_admins_role_check') then
    alter table public.platform_admins add constraint platform_admins_role_check check (role in ('super', 'finance', 'support'));
  end if;
end;
$$;
update public.platform_admins a set email = u.email from auth.users u where u.id = a.user_id and a.email is null;

-- Peta izin: nama fungsi admin → peran yang boleh. Fungsi yang tidak ada di sini = khusus super.
create table if not exists public.platform_role_permissions (
  fn text primary key,
  roles text[] not null check (roles <@ array['super', 'finance', 'support']),
  note text
);
alter table public.platform_role_permissions enable row level security;
revoke all on public.platform_role_permissions from public, anon, authenticated;

insert into public.platform_role_permissions (fn, roles, note) values
  -- Baca umum (semua peran)
  ('pa_overview', '{super,finance,support}', 'ringkasan'),
  ('pa_cafes_list', '{super,finance,support}', 'daftar kafe'),
  ('pa_cafe_detail', '{super,finance,support}', 'detail kafe'),
  ('pa_plans_list', '{super,finance,support}', 'daftar paket'),
  ('pa_invoices_list', '{super,finance,support}', 'tagihan (baca)'),
  ('pa_audit_list', '{super,finance,support}', 'log audit (baca)'),
  ('pa_action_items', '{super,finance,support}', 'perlu tindakan'),
  ('pa_notifications_list', '{super,finance,support}', 'lonceng'),
  ('pa_notifications_mark_read', '{super,finance,support}', 'lonceng'),
  ('pa_announcements_list', '{super,finance,support}', 'pengumuman (baca)'),
  ('pa_settings_get', '{super,finance,support}', 'pengaturan (baca)'),
  ('pa_log_whatsapp', '{super,finance,support}', 'catat klik WA'),
  ('pa_cafe_outbox', '{super,finance,support}', 'status email kafe'),
  ('pa_health_overview', '{super,finance,support}', 'kesehatan'),
  ('pa_health_map', '{super,finance,support}', 'kesehatan'),
  ('pa_cafe_health', '{super,finance,support}', 'kesehatan'),
  ('pa_setup_progress', '{super,finance,support}', 'progres setup'),
  ('pa_cafe_timeline', '{super,finance,support}', 'linimasa'),
  ('pa_status_admin', '{super,finance,support}', 'status sistem (baca)'),
  ('pa_ai_quota', '{super,finance,support}', 'Tanya AI'),
  ('pa_ai_facts', '{super,finance,support}', 'Tanya AI'),
  ('pa_ai_log', '{super,finance,support}', 'Tanya AI'),
  ('pa_ai_history', '{super,finance,support}', 'Tanya AI'),
  ('pa_cafe_flags', '{super,finance,support}', 'feature flag (baca)'),
  ('pa_flags_overview', '{super,finance,support}', 'feature flag (baca)'),
  ('pa_signups_list', '{super,support}', 'pendaftaran (baca)'),
  ('pa_impersonations_list', '{super,support}', 'riwayat lihat-sebagai'),
  -- Finance
  ('pa_invoice_create', '{super,finance}', 'tagihan'),
  ('pa_invoice_mark_paid', '{super,finance}', 'tagihan'),
  ('pa_invoice_void', '{super,finance}', 'tagihan'),
  ('pa_subscription_set_plan', '{super,finance}', 'langganan'),
  ('pa_subscription_extend', '{super,finance}', 'langganan'),
  ('pa_subscription_trial', '{super,finance}', 'langganan'),
  ('pa_analytics_mrr', '{super,finance}', 'analitik'),
  ('pa_analytics_cohort', '{super,finance}', 'analitik'),
  ('pa_analytics_summary', '{super,finance}', 'analitik'),
  ('pa_promos_list', '{super,finance}', 'promo'),
  ('pa_promo_upsert', '{super,finance}', 'promo'),
  ('pa_referrals_list', '{super,finance}', 'referral'),
  ('pa_cafe_billing', '{super,finance}', 'penagihan kafe'),
  ('pa_credit_adjust', '{super,finance}', 'kredit'),
  ('pa_billing_groups_list', '{super,finance}', 'multi-cabang'),
  ('pa_billing_group_upsert', '{super,finance}', 'multi-cabang'),
  ('pa_billing_group_delete', '{super,finance}', 'multi-cabang'),
  ('pa_cafe_set_billing_group', '{super,finance}', 'multi-cabang'),
  ('pa_billing_settings_update', '{super,finance}', 'pengaturan penagihan'),
  ('pa_finance_overview', '{super,finance}', 'keuangan platform'),
  -- Support
  ('pa_cafe_note_add', '{super,support}', 'catatan internal'),
  ('pa_tickets_list', '{super,support}', 'tiket'),
  ('pa_ticket_detail', '{super,support}', 'tiket'),
  ('pa_ticket_reply', '{super,support}', 'tiket'),
  ('pa_ticket_update', '{super,support}', 'tiket'),
  ('pa_impersonate_start', '{super,support}', 'lihat-sebagai'),
  ('pa_impersonate_end', '{super,support}', 'lihat-sebagai'),
  ('pa_incident_create', '{super,support}', 'status sistem'),
  ('pa_incident_update', '{super,support}', 'status sistem'),
  ('pa_service_set_status', '{super,support}', 'status sistem')
  -- Khusus super (tidak terdaftar): pa_cafe_set_suspended, pa_plan_upsert, pa_settings_update, pa_announce,
  -- pa_cafe_set_owner_whatsapp, pa_admins_list, pa_admin_update, pa_flag_set, pa_flag_bulk, pa_feature_upsert,
  -- pa_signup_decide, pa_platform_settings_update, pa_email_templates_list, pa_email_template_update, buat kafe, reset password.
on conflict (fn) do update set roles = excluded.roles, note = excluded.note;

-- Sesi lihat-sebagai (bagian D) — dibuat di sini karena dipakai pa_whoami
create table if not exists public.platform_impersonations (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references auth.users (id) on delete cascade,
  cafe_id uuid not null references public.cafes (id) on delete cascade,
  reason text not null check (char_length(reason) between 10 and 300),
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ended_at timestamptz,
  end_reason text,
  constraint platform_impersonations_window_check check (expires_at > started_at and expires_at <= started_at + interval '30 minutes')
);
create index if not exists platform_impersonations_active_idx on public.platform_impersonations (admin_id) where ended_at is null;
create index if not exists platform_impersonations_cafe_idx on public.platform_impersonations (cafe_id, started_at desc);
alter table public.platform_impersonations enable row level security;
revoke all on public.platform_impersonations from public, anon, authenticated;

-- Apakah anggota tim sudah memasang 2FA (aman bila skema MFA tidak ada)
create or replace function public.pa_admin_has_mfa(p_user uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $f$
declare
  v boolean;
begin
  if to_regclass('auth.mfa_factors') is null then
    return null;
  end if;
  execute 'select exists (select 1 from auth.mfa_factors f where f.user_id = $1 and f.status::text = ''verified'')' into v using p_user;
  return v;
end;
$f$;

-- Peran pemanggil (admin aktif), tanpa syarat 2FA — untuk tampilan menu
create or replace function public.pa_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$ select a.role from public.platform_admins a where a.user_id = (select auth.uid()) and a.is_active $$;

-- Apakah peran boleh memanggil fungsi admin tertentu
create or replace function public.pa_role_allows(p_role text, p_fn text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_role = 'super'
      or coalesce((select p_role = any (r.roles) from public.platform_role_permissions r where r.fn = p_fn), false)
$$;

-- Nama fungsi pemanggil terdekat dari tumpukan panggilan (PG_CONTEXT). p_skip = jumlah bingkai yang dilewati.
create or replace function public.pa_caller_fn(p_context text, p_skip integer)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_names text[] := '{}';
  m text[];
begin
  for m in select regexp_matches(coalesce(p_context, ''), '(?:PL/pgSQL function (?:public\.)?([a-z_0-9]+)\(|SQL function "([a-z_0-9]+)")', 'g') loop
    v_names := array_append(v_names, coalesce(m[1], m[2]));
  end loop;
  return v_names[p_skip + 1];
end;
$$;

-- Penjaga admin (file 14) + PERAN: fungsi pemanggil harus diizinkan untuk peran admin ini
create or replace function public.pa_require()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_ctx text;
  v_fn text;
begin
  select a.role into v_role from public.platform_admins a where a.user_id = (select auth.uid()) and a.is_active;
  if v_role is null then
    raise exception 'Khusus admin platform Dailybrew' using errcode = '42501', hint = 'platform_admin_only';
  end if;
  if coalesce((select auth.jwt()) ->> 'aal', '') <> 'aal2' then
    raise exception 'Verifikasi 2FA diperlukan' using errcode = '42501', hint = 'mfa_required';
  end if;
  if v_role <> 'super' then
    get diagnostics v_ctx = pg_context;
    v_fn := public.pa_caller_fn(v_ctx, 1); -- bingkai 0 = pa_require sendiri
    if v_fn is null or not public.pa_role_allows(v_role, v_fn) then
      raise exception 'Peran % tidak boleh melakukan aksi ini', case v_role when 'finance' then 'Finance' else 'Support' end
        using errcode = '42501', hint = 'role_forbidden';
    end if;
  end if;
  return (select auth.uid());
end;
$$;
revoke all on function public.pa_require() from public, anon, authenticated;

-- Untuk Edge Function (service_role): apakah admin aktif ini boleh melakukan aksi?
create or replace function public.pa_admin_can(p_actor uuid, p_fn text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select public.pa_role_allows(a.role, p_fn) from public.platform_admins a where a.user_id = p_actor and a.is_active), false)
$$;

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
    'full_name', (select a.full_name from public.platform_admins a where a.user_id = (select auth.uid())),
    'role', public.pa_role(),
    'allowed', case when public.pa_role() = 'super' then to_jsonb(array['*'])
                    else coalesce((select jsonb_agg(r.fn order by r.fn) from public.platform_role_permissions r where public.pa_role() = any (r.roles)), '[]'::jsonb) end,
    'impersonation', (select jsonb_build_object('id', i.id, 'cafe_id', i.cafe_id, 'expires_at', i.expires_at)
                      from public.platform_impersonations i
                      where i.admin_id = (select auth.uid()) and i.ended_at is null and i.expires_at > now()
                      order by i.started_at desc limit 1)
  )
$$;

-- Tim admin
create or replace function public.pa_admins_list()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.pa_require();
  return coalesce((select jsonb_agg(jsonb_build_object(
      'user_id', a.user_id, 'full_name', a.full_name, 'email', coalesce(a.email, u.email), 'role', a.role, 'is_active', a.is_active,
      'created_at', a.created_at, 'last_sign_in_at', u.last_sign_in_at,
      'mfa', public.pa_admin_has_mfa(a.user_id),
      'is_me', a.user_id = (select auth.uid()))
    order by a.is_active desc, a.created_at)
    from public.platform_admins a left join auth.users u on u.id = a.user_id), '[]'::jsonb);
end;
$$;

-- Ubah peran / nama / aktif. Tidak bisa mengubah diri sendiri; minimal satu super aktif tersisa.
create or replace function public.pa_admin_update(p_user uuid, p_role text default null, p_active boolean default null, p_full_name text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.pa_require();
  v_before public.platform_admins;
  v_after public.platform_admins;
begin
  if p_user = v_actor and (p_role is not null or p_active is not null) then
    raise exception 'Tidak bisa mengubah peran atau menonaktifkan akun sendiri' using errcode = 'P0001';
  end if;
  if p_role is not null and p_role not in ('super', 'finance', 'support') then
    raise exception 'Peran tidak dikenal' using errcode = 'P0001';
  end if;
  select * into v_before from public.platform_admins a where a.user_id = p_user for update;
  if not found then
    raise exception 'Anggota tim tidak ditemukan' using errcode = 'P0002';
  end if;
  update public.platform_admins
  set role = coalesce(p_role, role), is_active = coalesce(p_active, is_active),
      full_name = coalesce(nullif(left(trim(coalesce(p_full_name, '')), 80), ''), full_name), updated_at = now()
  where user_id = p_user
  returning * into v_after;
  if not exists (select 1 from public.platform_admins a where a.role = 'super' and a.is_active) then
    raise exception 'Minimal harus ada satu Super admin aktif' using errcode = 'P0001';
  end if;
  -- Admin yang dinonaktifkan / turun peran: sesi lihat-sebagai miliknya diakhiri
  if not v_after.is_active or v_after.role = 'finance' then
    update public.platform_impersonations set ended_at = now(), end_reason = 'role_changed' where admin_id = p_user and ended_at is null;
  end if;
  perform public.pa_log('admin.update', null, 'platform_admin', p_user::text,
    jsonb_build_object('role', v_before.role, 'is_active', v_before.is_active, 'full_name', v_before.full_name),
    jsonb_build_object('role', v_after.role, 'is_active', v_after.is_active, 'full_name', v_after.full_name));
  return to_jsonb(v_after);
end;
$$;

-- Tambah anggota (dipanggil Edge Function platform-admin setelah akun dibuat). Pemanggil harus super.
create or replace function public.pa_admin_add(p_actor uuid, p_user uuid, p_full_name text, p_role text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.platform_admins;
  v_name text := nullif(left(trim(coalesce(p_full_name, '')), 80), '');
begin
  if not public.pa_admin_can(p_actor, 'pa_admin_add') then
    raise exception 'Hanya Super admin yang bisa mengundang anggota tim' using errcode = '42501', hint = 'role_forbidden';
  end if;
  if p_role not in ('super', 'finance', 'support') then
    raise exception 'Peran tidak dikenal' using errcode = 'P0001';
  end if;
  if v_name is null or length(v_name) < 2 then
    raise exception 'Nama minimal 2 karakter' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.profiles p where p.id = p_user and p.cafe_id is not null) then
    raise exception 'Akun ini terhubung ke kafe. Pakai email lain untuk tim admin.' using errcode = 'P0001';
  end if;
  insert into public.platform_admins (user_id, full_name, role, is_active, email, invited_by)
  values (p_user, v_name, p_role, true, (select u.email from auth.users u where u.id = p_user), p_actor)
  on conflict (user_id) do update set role = excluded.role, is_active = true, full_name = excluded.full_name, updated_at = now()
  returning * into v;
  perform public.pa_log('admin.add', null, 'platform_admin', p_user::text, null,
    jsonb_build_object('role', v.role, 'full_name', v.full_name, 'email', v.email), null, p_actor, null);
  return to_jsonb(v);
end;
$$;

-- Buat kafe dari dashboard (file 15) — kini khusus super
create or replace function public.pa_cafe_create_for_owner(
  p_actor uuid, p_owner_id uuid, p_cafe_name text, p_owner_name text, p_plan text, p_trial_days integer, p_owner_whatsapp text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wa text := public.normalize_wa(p_owner_whatsapp);
  v_result jsonb;
begin
  if not public.pa_admin_can(p_actor, 'pa_cafe_create_for_owner') then
    raise exception 'Hanya Super admin yang bisa membuat kafe' using errcode = '42501', hint = 'role_forbidden';
  end if;
  v_result := public.pa_cafe_create_for_owner(p_actor, p_owner_id, p_cafe_name, p_owner_name, p_plan, p_trial_days);
  if v_wa is not null then
    update public.cafes set owner_whatsapp = v_wa where id = (v_result ->> 'cafe_id')::uuid;
  end if;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------
-- A (lanjutan). Masa tenggang yang bisa diatur: fungsi file 14/17 yang memakai "7 hari" ditulis ulang
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
       and ((s.status in ('active', 'past_due') and (s.current_period_end is null or s.current_period_end + public.pa_grace() > now()))
            or (s.status = 'trialing' and (s.trial_ends_at is null or s.trial_ends_at > now())))),
    (select p from public.plans p where p.code = 'basic')
  )
$$;

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
    s.price_override, case when s.cafe_id is null then 0 else public.pa_plan_price(c.id, s.plan_code) end,
    case
      when c.suspended_at is not null then 'suspended'
      when s.cafe_id is null then 'active'
      when s.status = 'cancelled' then 'expired'
      when s.status = 'trialing' then case when s.trial_ends_at is null or s.trial_ends_at > now() then 'trial' else 'expired' end
      when s.current_period_end is null or s.current_period_end > now() then case when s.status = 'past_due' then 'past_due' else 'active' end
      when s.current_period_end + public.pa_grace() > now() then 'past_due'
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
    'suspended_kind', case when v_cafe.suspended_at is not null then coalesce(v_cafe.suspended_kind, 'manual') end,
    'status', v_sub.status,
    'current_period_end', v_sub.current_period_end,
    'grace_until', case when v_sub.current_period_end is not null then v_sub.current_period_end + public.pa_grace() end,
    'in_grace', v_sub.status in ('active', 'past_due') and v_sub.current_period_end is not null
                and v_sub.current_period_end < now() and v_sub.current_period_end + public.pa_grace() > now(),
    'suspend_at', case when v_cafe.suspended_at is null and v_sub.current_period_end < now()
                            and exists (select 1 from public.subscription_invoices i where i.cafe_id = p_cafe_id and i.status = 'pending')
                       then public.pa_suspend_due_at(p_cafe_id) end,
    'pending_invoices', (select count(*) from public.subscription_invoices i where i.cafe_id = p_cafe_id and i.status = 'pending')
  );
end;
$$;

create or replace function public.pa_daily_check()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_billing jsonb;
  v_health jsonb;
  v_admin integer := 0;
  v_owner integer := 0;
  v_amount text;
begin
  v_billing := public.pa_billing_run();
  v_health := public.pa_health_run();

  -- Tagihan: H-7, H-1, telat, telat 3 hari (owner) + telat (admin)
  for r in
    select i.*, c.name as cafe_name from public.subscription_invoices i join public.cafes c on c.id = i.cafe_id
    where i.status = 'pending' and c.suspended_at is null
  loop
    v_amount := public.pa_rupiah(r.amount);
    if r.due_at < now() then
      if public.pa_notify_owner(r.cafe_id, 'invoice_overdue', 'danger', 'Tagihan langganan lewat jatuh tempo',
           'Tagihan ' || r.number || ' sebesar ' || v_amount || ' jatuh tempo ' || to_char(r.due_at at time zone 'Asia/Jakarta', 'DD/MM/YYYY')
           || '. Fitur paket tetap jalan ' || public.pa_grace_days() || ' hari setelah masa berlaku habis.', '/settings/subscription', 'invoice_overdue:' || r.id) then
        v_owner := v_owner + 1;
      end if;
      if r.due_at < now() - interval '3 days'
         and public.pa_notify_owner(r.cafe_id, 'invoice_overdue_3', 'danger', 'Pengingat: tagihan belum dibayar',
           'Tagihan ' || r.number || ' sebesar ' || v_amount || ' sudah telat ' || extract(day from now() - r.due_at)::integer
           || ' hari. Bayar online dari Pengaturan → Langganan.', '/settings/subscription', 'invoice_overdue_3:' || r.id) then
        v_owner := v_owner + 1;
      end if;
      if public.pa_notify_admin('invoice_overdue', 'warning', 'Tagihan telat: ' || r.cafe_name, r.number || ' · ' || v_amount,
           r.cafe_id, '/kafe/' || r.cafe_id, 'invoice_overdue:' || r.id) then
        v_admin := v_admin + 1;
      end if;
    elsif r.due_at <= now() + interval '1 day' then
      if public.pa_notify_owner(r.cafe_id, 'invoice_due_1', 'warning', 'Tagihan jatuh tempo besok',
           'Tagihan ' || r.number || ' sebesar ' || v_amount || '. Bayar dari Pengaturan → Langganan.', '/settings/subscription', 'invoice_due_1:' || r.id) then
        v_owner := v_owner + 1;
      end if;
    elsif r.due_at <= now() + interval '7 days' then
      if public.pa_notify_owner(r.cafe_id, 'invoice_due_7', 'info', 'Tagihan langganan baru',
           'Tagihan ' || r.number || ' sebesar ' || v_amount || ' jatuh tempo ' || to_char(r.due_at at time zone 'Asia/Jakarta', 'DD/MM/YYYY') || '.',
           '/settings/subscription', 'invoice_due_7:' || r.id) then
        v_owner := v_owner + 1;
      end if;
    end if;
  end loop;

  -- Peringatan terakhir: 2 hari sebelum nonaktif otomatis (email dipaksa)
  for r in
    select c.id, public.pa_suspend_due_at(c.id) as suspend_at
    from public.cafes c join public.cafe_subscriptions s on s.cafe_id = c.id
    where c.suspended_at is null and s.status = 'past_due'
      and exists (select 1 from public.subscription_invoices i where i.cafe_id = c.id and i.status = 'pending')
  loop
    continue when r.suspend_at is null or r.suspend_at <= now() or r.suspend_at > now() + interval '2 days';
    if public.pa_notify_owner(r.id, 'suspend_warning', 'danger', 'Kafe akan dinonaktifkan',
         'Langganan belum dibayar. Kafe dinonaktifkan otomatis pada ' || to_char(r.suspend_at at time zone 'Asia/Jakarta', 'DD/MM/YYYY')
         || ' bila tagihan belum lunas. Bayar sekarang agar pesanan tetap berjalan.',
         '/settings/subscription', 'suspend_warning:' || r.id || ':' || to_char(r.suspend_at, 'YYYYMMDD'), r.suspend_at, true) then
      v_owner := v_owner + 1;
    end if;
  end loop;

  -- Masa coba, kafe sepi, pembayaran gagal, sinyal upgrade (sumber yang sama dengan "Perlu tindakan")
  for r in select * from public.pa_action_rows() a where a.kind <> 'invoice_overdue' loop
    if r.kind = 'trial_ending' then
      if public.pa_notify_owner(r.cafe_id, 'trial_ending', 'warning', 'Masa coba segera berakhir',
           r.reason || '. Pilih paket di Pengaturan → Langganan agar fitur tetap aktif.', '/settings/subscription',
           'trial_ending:' || r.ref_id, r.due_at) then
        v_owner := v_owner + 1;
      end if;
      if public.pa_notify_admin('trial_ending', 'info', 'Masa coba hampir habis: ' || r.cafe_name, r.reason, r.cafe_id,
           '/kafe/' || r.cafe_id, 'trial_ending:' || r.ref_id) then
        v_admin := v_admin + 1;
      end if;
    elsif r.kind = 'idle_cafe' then
      if public.pa_notify_admin('idle_cafe', 'info', 'Kafe sepi: ' || r.cafe_name, r.reason, r.cafe_id,
           '/kafe/' || r.cafe_id, 'idle_cafe:' || r.ref_id) then
        v_admin := v_admin + 1;
      end if;
    elsif r.kind = 'payment_failed' and r.ref_id like 'pe:%' then
      if public.pa_notify_admin('payment_failed', 'danger', 'Pembayaran gagal: ' || r.cafe_name, r.reason, r.cafe_id,
           '/kafe/' || r.cafe_id, 'payment_failed:' || r.ref_id) then
        v_admin := v_admin + 1;
      end if;
    elsif r.kind = 'upgrade_signal' then
      if public.pa_notify_admin('upgrade_signal', 'info', 'Peluang upgrade: ' || r.cafe_name, r.reason, r.cafe_id,
           '/kafe/' || r.cafe_id, 'upgrade_signal:' || r.ref_id) then
        v_admin := v_admin + 1;
      end if;
    end if;
  end loop;

  return jsonb_build_object('billing', v_billing, 'health', v_health, 'admin_notifications', v_admin, 'owner_notifications', v_owner, 'ran_at', now());
end;
$$;

-- Pengaturan platform baru (super)
create or replace function public.pa_platform_settings_update(p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allowed text[] := array['signup_enabled', 'signup_approval_mode', 'default_trial_days', 'default_trial_plan', 'billing_grace_days', 'ai_daily_limit'];
  v_before jsonb;
  v_after jsonb;
begin
  perform public.pa_require();
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'Data pengaturan tidak valid' using errcode = 'P0001';
  end if;
  if exists (select 1 from jsonb_object_keys(p_patch) k where k <> all (v_allowed)) then
    raise exception 'Pengaturan tidak dikenal' using errcode = 'P0001';
  end if;
  if p_patch ? 'default_trial_plan' and not exists (select 1 from public.plans p where p.code = p_patch ->> 'default_trial_plan' and not p.is_archived) then
    raise exception 'Paket trial tidak ditemukan atau sudah diarsipkan' using errcode = 'P0001';
  end if;
  select jsonb_build_object('signup_enabled', s.signup_enabled, 'signup_approval_mode', s.signup_approval_mode, 'default_trial_days', s.default_trial_days,
    'default_trial_plan', s.default_trial_plan, 'billing_grace_days', s.billing_grace_days, 'ai_daily_limit', s.ai_daily_limit)
  into v_before from public.platform_settings s where s.id for update;
  update public.platform_settings s set
    signup_enabled = case when p_patch ? 'signup_enabled' then (p_patch ->> 'signup_enabled')::boolean else s.signup_enabled end,
    signup_approval_mode = case when p_patch ? 'signup_approval_mode' then (p_patch ->> 'signup_approval_mode')::boolean else s.signup_approval_mode end,
    default_trial_days = case when p_patch ? 'default_trial_days' then (p_patch ->> 'default_trial_days')::integer else s.default_trial_days end,
    default_trial_plan = case when p_patch ? 'default_trial_plan' then p_patch ->> 'default_trial_plan' else s.default_trial_plan end,
    billing_grace_days = case when p_patch ? 'billing_grace_days' then (p_patch ->> 'billing_grace_days')::integer else s.billing_grace_days end,
    ai_daily_limit = case when p_patch ? 'ai_daily_limit' then (p_patch ->> 'ai_daily_limit')::integer else s.ai_daily_limit end,
    updated_at = now(), updated_by = (select auth.uid())
  where s.id;
  if (select s.billing_grace_days > s.billing_suspend_after_days from public.platform_settings s where s.id) then
    raise exception 'Masa tenggang tidak boleh lebih lama dari batas nonaktif otomatis (Keuangan → Pengaturan)' using errcode = 'P0001';
  end if;
  select jsonb_build_object('signup_enabled', s.signup_enabled, 'signup_approval_mode', s.signup_approval_mode, 'default_trial_days', s.default_trial_days,
    'default_trial_plan', s.default_trial_plan, 'billing_grace_days', s.billing_grace_days, 'ai_daily_limit', s.ai_daily_limit)
  into v_after from public.platform_settings s where s.id;
  perform public.pa_log('settings.platform', null, 'platform_settings', 'platform', v_before, v_after);
  return v_after;
exception
  when invalid_text_representation or numeric_value_out_of_range or check_violation then
    raise exception 'Nilai pengaturan tidak valid (trial 0–90 hari, tenggang 0–30 hari, kuota AI 0–500)' using errcode = 'P0001';
end;
$$;

-- ---------------------------------------------------------------------
-- C. Feature flag per kafe
-- ---------------------------------------------------------------------
create table if not exists public.platform_features (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{1,39}$'),
  label text not null,
  description text,
  kind text not null default 'module' check (kind in ('module', 'beta')),
  created_at timestamptz not null default now()
);
insert into public.platform_features (key, label, description, kind) values
  ('inventory', 'Inventori & resep', 'Stok bahan, resep, HPP, pembelian', 'module'),
  ('finance', 'Keuangan & akuntansi', 'Jurnal, laba rugi, neraca', 'module'),
  ('loyalty', 'Poin & member', 'Poin pelanggan dan tingkat member', 'module'),
  ('qr_ordering', 'Pesan dari QR meja', 'Pelanggan memesan dari meja', 'module'),
  ('payment_gateway', 'QRIS online', 'Pembayaran online lewat gateway', 'module'),
  ('ai_advisor', 'Tanya AI owner', 'Advisor bisnis AI untuk owner', 'module')
on conflict (key) do nothing;

create table if not exists public.cafe_feature_flags (
  cafe_id uuid not null references public.cafes (id) on delete cascade,
  feature text not null references public.platform_features (key) on delete cascade,
  enabled boolean not null,
  note text,
  expires_at timestamptz,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (cafe_id, feature)
);
create index if not exists cafe_feature_flags_feature_idx on public.cafe_feature_flags (feature);
alter table public.platform_features enable row level security;
alter table public.cafe_feature_flags enable row level security;
revoke all on public.platform_features, public.cafe_feature_flags from public, anon, authenticated;

-- Flag yang masih berlaku untuk satu kafe & fitur (null = tidak ada flag)
create or replace function public.cafe_flag(p_cafe uuid, p_feature text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select f.enabled from public.cafe_feature_flags f
  where f.cafe_id = p_cafe and f.feature = p_feature and (f.expires_at is null or f.expires_at > now())
$$;

-- Fitur efektif (file 10): flag menang atas paket
create or replace function public.cafe_has_feature(p_cafe_id uuid, p_feature text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.cafe_flag(p_cafe_id, p_feature),
    not exists (select 1 from public.cafe_subscriptions s where s.cafe_id = p_cafe_id)
    or p_feature = any ((public.cafe_plan(p_cafe_id)).features))
$$;

-- Daftar fitur efektif (paket ± flag) sebagai array
create or replace function public.cafe_effective_features(p_cafe uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(x order by x), '{}') from (
    select unnest((public.cafe_plan(p_cafe)).features) as x
    except select f.feature from public.cafe_feature_flags f where f.cafe_id = p_cafe and not f.enabled and (f.expires_at is null or f.expires_at > now())
    union select f.feature from public.cafe_feature_flags f where f.cafe_id = p_cafe and f.enabled and (f.expires_at is null or f.expires_at > now())
  ) t
$$;

-- Ringkasan owner (file 10) + fitur dari flag
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
    'features', to_jsonb(public.cafe_effective_features(p_cafe_id)),
    'plan_features', to_jsonb(v_plan.features),
    'flags', public.cafe_flags(p_cafe_id),
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

-- Flag kafe untuk web owner/staff: { key: true/false } (hanya flag yang berlaku; termasuk fitur beta)
create or replace function public.cafe_flags(p_cafe_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_cafe_member(p_cafe_id) then
    raise exception 'Hanya anggota kafe ini' using errcode = '42501';
  end if;
  return coalesce((select jsonb_object_agg(f.feature, f.enabled) from public.cafe_feature_flags f
                   where f.cafe_id = p_cafe_id and (f.expires_at is null or f.expires_at > now())), '{}'::jsonb);
end;
$$;

-- Admin: semua fitur katalog untuk satu kafe (paket vs flag vs efektif)
create or replace function public.pa_cafe_flags(p_cafe uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_plan text[];
begin
  perform public.pa_require();
  v_plan := (public.cafe_plan(p_cafe)).features;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'key', pf.key, 'label', pf.label, 'description', pf.description, 'kind', pf.kind,
      'in_plan', pf.key = any (v_plan),
      'flag', f.enabled, 'flag_expired', f.expires_at is not null and f.expires_at <= now(),
      'note', f.note, 'expires_at', f.expires_at, 'updated_at', f.updated_at,
      'effective', public.cafe_has_feature(p_cafe, pf.key))
    order by pf.kind, pf.label)
    from public.platform_features pf
    left join public.cafe_feature_flags f on f.cafe_id = p_cafe and f.feature = pf.key), '[]'::jsonb);
end;
$$;

create or replace function public.pa_flags_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.pa_require();
  return coalesce((select jsonb_agg(jsonb_build_object(
      'key', pf.key, 'label', pf.label, 'description', pf.description, 'kind', pf.kind,
      'on_count', (select count(*) from public.cafe_feature_flags f where f.feature = pf.key and f.enabled and (f.expires_at is null or f.expires_at > now())),
      'off_count', (select count(*) from public.cafe_feature_flags f where f.feature = pf.key and not f.enabled and (f.expires_at is null or f.expires_at > now())),
      'cafes', coalesce((select jsonb_agg(jsonb_build_object('cafe_id', c.id, 'name', c.name, 'enabled', f.enabled, 'expires_at', f.expires_at, 'note', f.note)
                                          order by c.name)
                         from public.cafe_feature_flags f join public.cafes c on c.id = f.cafe_id
                         where f.feature = pf.key and (f.expires_at is null or f.expires_at > now())), '[]'::jsonb))
    order by pf.kind, pf.label) from public.platform_features pf), '[]'::jsonb);
end;
$$;

-- Nyalakan / matikan / hapus (p_enabled = null) flag satu kafe. Tercatat di log audit.
create or replace function public.pa_flag_set(p_cafe uuid, p_feature text, p_enabled boolean, p_note text default null, p_expires_at timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.pa_require();
  v_before public.cafe_feature_flags;
  v_after public.cafe_feature_flags;
begin
  if not exists (select 1 from public.cafes c where c.id = p_cafe) then
    raise exception 'Kafe tidak ditemukan' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.platform_features pf where pf.key = p_feature) then
    raise exception 'Fitur tidak dikenal' using errcode = 'P0001';
  end if;
  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'Tanggal berakhir harus di masa depan' using errcode = 'P0001';
  end if;
  select * into v_before from public.cafe_feature_flags f where f.cafe_id = p_cafe and f.feature = p_feature for update;
  if p_enabled is null then
    delete from public.cafe_feature_flags where cafe_id = p_cafe and feature = p_feature;
  else
    insert into public.cafe_feature_flags (cafe_id, feature, enabled, note, expires_at, updated_by)
    values (p_cafe, p_feature, p_enabled, nullif(left(trim(coalesce(p_note, '')), 200), ''), p_expires_at, v_actor)
    on conflict (cafe_id, feature) do update set enabled = excluded.enabled, note = excluded.note, expires_at = excluded.expires_at,
      updated_by = excluded.updated_by, updated_at = now()
    returning * into v_after;
  end if;
  perform public.pa_log('flag.set', p_cafe, 'feature_flag', p_feature,
    case when v_before.cafe_id is null then null else jsonb_build_object('enabled', v_before.enabled, 'expires_at', v_before.expires_at) end,
    case when p_enabled is null then null else jsonb_build_object('enabled', p_enabled, 'expires_at', p_expires_at) end, p_note);
  return jsonb_build_object('feature', p_feature, 'flag', p_enabled, 'effective', public.cafe_has_feature(p_cafe, p_feature));
end;
$$;

-- Massal (mis. uji coba fitur baru ke 5 kafe). Maks. 200 kafe per panggilan.
create or replace function public.pa_flag_bulk(p_feature text, p_cafe_ids uuid[], p_enabled boolean, p_note text default null, p_expires_at timestamptz default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_count integer := 0;
begin
  perform public.pa_require();
  if p_cafe_ids is null or cardinality(p_cafe_ids) = 0 or cardinality(p_cafe_ids) > 200 then
    raise exception 'Pilih 1–200 kafe' using errcode = 'P0001';
  end if;
  foreach v_id in array p_cafe_ids loop
    perform public.pa_flag_set(v_id, p_feature, p_enabled, p_note, p_expires_at);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- Tambah fitur beta ke katalog (super)
create or replace function public.pa_feature_upsert(p_key text, p_label text, p_description text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.platform_features;
  v_key text := lower(trim(coalesce(p_key, '')));
begin
  perform public.pa_require();
  if v_key !~ '^[a-z][a-z0-9_]{1,39}$' then
    raise exception 'Kunci fitur 2–40 karakter: huruf kecil, angka, garis bawah' using errcode = 'P0001';
  end if;
  if length(trim(coalesce(p_label, ''))) < 2 then
    raise exception 'Nama fitur minimal 2 karakter' using errcode = 'P0001';
  end if;
  insert into public.platform_features (key, label, description, kind)
  values (v_key, left(trim(p_label), 60), nullif(left(trim(coalesce(p_description, '')), 200), ''), 'beta')
  on conflict (key) do update set label = excluded.label, description = excluded.description
  returning * into v;
  perform public.pa_log('feature.upsert', null, 'feature', v.key, null, to_jsonb(v));
  return to_jsonb(v);
end;
$$;

-- ---------------------------------------------------------------------
-- D. Lihat-sebagai (impersonation) baca-saja
-- ---------------------------------------------------------------------
-- (tabel platform_impersonations dibuat di bagian B karena dipakai pa_whoami)

-- Kafe yang sedang dilihat pemanggil (admin aktif super/support, 2FA, sesi belum habis); null = tidak sedang lihat-sebagai
create or replace function public.pa_impersonated_cafe()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select i.cafe_id
  from public.platform_impersonations i join public.platform_admins a on a.user_id = i.admin_id
  where i.admin_id = (select auth.uid()) and i.ended_at is null and i.expires_at > now()
    and a.is_active and a.role in ('super', 'support')
    and coalesce((select auth.jwt()) ->> 'aal', '') = 'aal2'
  order by i.started_at desc
  limit 1
$$;

-- Helper RLS (file 04 / migrasi awal / file 14): admin yang sedang lihat-sebagai dianggap owner kafe itu — HANYA untuk membaca;
-- semua tulis diblok trigger pa_block_impersonated_writes di bawah.
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
  ) or coalesce('owner' = any (p_roles) and p_cafe_id is not null and public.pa_impersonated_cafe() = p_cafe_id, false)
$$;

-- has_cafe_role (migrasi awal) memakai tipe public.app_role — dilewati bila tipe itu tidak ada
do $outer$
begin
  if to_regtype('public.app_role') is null then
    return;
  end if;
  execute $sql$
create or replace function public.has_cafe_role(
  target_cafe_id uuid,
  allowed_roles public.app_role[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
    from public.profiles as p
    where p.id = (select auth.uid())
      and p.cafe_id = target_cafe_id
      and p.role = any (allowed_roles)
  ) or coalesce('owner'::public.app_role = any (allowed_roles) and target_cafe_id is not null and public.pa_impersonated_cafe() = target_cafe_id, false)
$fn$;
$sql$;
  execute 'revoke all on function public.has_cafe_role(uuid, public.app_role[]) from public, anon';
  execute 'grant execute on function public.has_cafe_role(uuid, public.app_role[]) to authenticated';
end;
$outer$;

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
  ) or coalesce(p_user is not null and p_user = (select auth.uid()) and public.pa_impersonated_cafe() = p_cafe, false)
$$;

-- Penjaga tulis: selama lihat-sebagai aktif, INSERT/UPDATE/DELETE apa pun ditolak, kecuali panggilan admin pa_* yang sah
-- (mis. mengakhiri sesi, mencatat log). Dipasang di semua tabel public (tingkat statement → murah).
create or replace function public.pa_block_impersonated_writes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ctx text;
  v_names text[] := '{}';
  m text[];
begin
  if (select auth.uid()) is null then
    return null;
  end if;
  if not exists (select 1 from public.platform_impersonations i
                 where i.admin_id = (select auth.uid()) and i.ended_at is null and i.expires_at > now()) then
    return null;
  end if;
  get diagnostics v_ctx = pg_context;
  for m in select regexp_matches(v_ctx, '(?:PL/pgSQL function (?:public\.)?([a-z_0-9]+)\(|SQL function "([a-z_0-9]+)")', 'g') loop
    v_names := array_append(v_names, coalesce(m[1], m[2]));
  end loop;
  -- Bingkai terluar (panggilan dari aplikasi) harus fungsi admin pa_*; tulis langsung / fungsi owner ditolak
  if cardinality(v_names) > 1 and v_names[cardinality(v_names)] like 'pa\_%' then
    return null;
  end if;
  raise exception 'Mode lihat-sebagai hanya bisa melihat. Akhiri sesi lihat-sebagai untuk kembali.'
    using errcode = '42501', hint = 'impersonation_read_only';
end;
$$;

-- Pasang penjaga ke semua tabel public (jalankan ulang fungsi ini setelah menambah tabel baru)
create or replace function public.pa_install_read_only_guards()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_count integer := 0;
begin
  for r in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relispartition
  loop
    execute format('drop trigger if exists zz_impersonation_read_only on public.%I', r.relname);
    execute format('create trigger zz_impersonation_read_only before insert or update or delete on public.%I for each statement execute function public.pa_block_impersonated_writes()', r.relname);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.pa_impersonate_start(p_cafe uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.pa_require();
  v_reason text := nullif(left(trim(coalesce(p_reason, '')), 300), '');
  v public.platform_impersonations;
  v_cafe text;
begin
  select c.name into v_cafe from public.cafes c where c.id = p_cafe;
  if v_cafe is null then
    raise exception 'Kafe tidak ditemukan' using errcode = 'P0002';
  end if;
  if v_reason is null or char_length(v_reason) < 10 then
    raise exception 'Tulis alasan minimal 10 karakter (tercatat di log audit)' using errcode = 'P0001';
  end if;
  update public.platform_impersonations set ended_at = now(), end_reason = 'replaced' where admin_id = v_actor and ended_at is null;
  insert into public.platform_impersonations (admin_id, cafe_id, reason, expires_at)
  values (v_actor, p_cafe, v_reason, now() + interval '30 minutes')
  returning * into v;
  perform public.pa_log('impersonation.start', p_cafe, 'impersonation', v.id::text, null,
    jsonb_build_object('expires_at', v.expires_at, 'cafe', v_cafe), v_reason);
  return jsonb_build_object('id', v.id, 'cafe_id', v.cafe_id, 'cafe_name', v_cafe, 'expires_at', v.expires_at);
end;
$$;

create or replace function public.pa_impersonate_end(p_session uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.pa_require();
  r record;
  v_count integer := 0;
begin
  for r in
    update public.platform_impersonations set ended_at = now(), end_reason = 'ended'
    where admin_id = v_actor and ended_at is null and (p_session is null or id = p_session)
    returning id, cafe_id, started_at
  loop
    perform public.pa_log('impersonation.end', r.cafe_id, 'impersonation', r.id::text, null,
      jsonb_build_object('minutes', round(extract(epoch from now() - r.started_at) / 60.0, 1)), null);
    v_count := v_count + 1;
  end loop;
  return jsonb_build_object('ended', v_count);
end;
$$;

-- Konteks untuk web owner mode lihat-sebagai (dipanggil dengan token admin)
create or replace function public.impersonation_context(p_session uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.platform_impersonations;
  v_owner jsonb;
begin
  select * into v from public.platform_impersonations i
  where i.id = p_session and i.admin_id = (select auth.uid()) and i.ended_at is null and i.expires_at > now();
  if not found or public.pa_impersonated_cafe() is distinct from v.cafe_id then
    raise exception 'Sesi lihat-sebagai tidak ada atau sudah berakhir' using errcode = '42501', hint = 'impersonation_expired';
  end if;
  select jsonb_build_object('id', p.id, 'full_name', p.full_name, 'phone', p.phone, 'role', 'owner', 'cafe_id', p.cafe_id) into v_owner
  from public.profiles p where p.cafe_id = v.cafe_id and p.role::text = 'owner' order by p.created_at limit 1;
  return jsonb_build_object(
    'session_id', v.id, 'cafe_id', v.cafe_id, 'expires_at', v.expires_at, 'started_at', v.started_at,
    'cafe_name', (select c.name from public.cafes c where c.id = v.cafe_id),
    'admin_name', (select a.full_name from public.platform_admins a where a.user_id = v.admin_id),
    'owner', coalesce(v_owner, jsonb_build_object('id', null, 'full_name', 'Owner', 'role', 'owner', 'cafe_id', v.cafe_id))
  );
end;
$$;

create or replace function public.pa_impersonations_list(p_cafe uuid default null, p_limit integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.pa_require();
  return coalesce((select jsonb_agg(x order by (x ->> 'started_at') desc) from (
    select jsonb_build_object('id', i.id, 'cafe_id', i.cafe_id, 'cafe_name', c.name, 'admin_name', a.full_name, 'reason', i.reason,
      'started_at', i.started_at, 'expires_at', i.expires_at, 'ended_at', i.ended_at, 'end_reason', i.end_reason,
      'active', i.ended_at is null and i.expires_at > now()) as x
    from public.platform_impersonations i join public.cafes c on c.id = i.cafe_id left join public.platform_admins a on a.user_id = i.admin_id
    where p_cafe is null or i.cafe_id = p_cafe
    order by i.started_at desc limit least(greatest(coalesce(p_limit, 30), 1), 100)) t), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------
-- E. Halaman status sistem
-- ---------------------------------------------------------------------
create table if not exists public.platform_services (
  key text primary key,
  name text not null,
  description text,
  status text not null default 'operational' check (status in ('operational', 'degraded', 'partial_outage', 'major_outage', 'maintenance')),
  sort_order integer not null default 0,
  updated_at timestamptz not null default now()
);
insert into public.platform_services (key, name, description, sort_order) values
  ('web', 'Dashboard web', 'Dashboard owner & staff', 1),
  ('app', 'Aplikasi pelanggan', 'Menu, QR meja, dan pesanan pelanggan', 2),
  ('payments', 'Pembayaran', 'QRIS & pembayaran online', 3),
  ('notifications', 'Notifikasi', 'Email & pemberitahuan', 4)
on conflict (key) do nothing;

create table if not exists public.platform_incidents (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 4 and 120),
  impact text not null default 'minor' check (impact in ('minor', 'major', 'maintenance')),
  status text not null default 'investigating' check (status in ('investigating', 'identified', 'monitoring', 'resolved')),
  services text[] not null default '{}',
  started_at timestamptz not null default now(),
  resolved_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
create index if not exists platform_incidents_started_idx on public.platform_incidents (started_at desc);
create table if not exists public.platform_incident_updates (
  id bigint generated always as identity primary key,
  incident_id uuid not null references public.platform_incidents (id) on delete cascade,
  status text not null check (status in ('investigating', 'identified', 'monitoring', 'resolved')),
  body text not null check (char_length(body) between 4 and 1000),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists platform_incident_updates_idx on public.platform_incident_updates (incident_id, created_at desc);
alter table public.platform_services enable row level security;
alter table public.platform_incidents enable row level security;
alter table public.platform_incident_updates enable row level security;
revoke all on public.platform_services, public.platform_incidents, public.platform_incident_updates from public, anon, authenticated;

-- Publik (tanpa login): layanan, insiden aktif, riwayat 90 hari. Tidak memuat nama admin atau data kafe.
create or replace function public.public_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'updated_at', now(),
    'overall', coalesce((select case
        when bool_or(s.status = 'major_outage') then 'major_outage'
        when bool_or(s.status = 'partial_outage') then 'partial_outage'
        when bool_or(s.status = 'degraded') then 'degraded'
        when bool_or(s.status = 'maintenance') then 'maintenance'
        else 'operational' end from public.platform_services s), 'operational'),
    'services', coalesce((select jsonb_agg(jsonb_build_object('key', s.key, 'name', s.name, 'description', s.description, 'status', s.status) order by s.sort_order)
                          from public.platform_services s), '[]'::jsonb),
    'incidents', coalesce((select jsonb_agg(jsonb_build_object(
        'id', i.id, 'title', i.title, 'impact', i.impact, 'status', i.status, 'services', i.services,
        'started_at', i.started_at, 'resolved_at', i.resolved_at,
        'updates', coalesce((select jsonb_agg(jsonb_build_object('status', u.status, 'body', u.body, 'created_at', u.created_at) order by u.created_at desc)
                             from public.platform_incident_updates u where u.incident_id = i.id), '[]'::jsonb))
      order by (i.status <> 'resolved') desc, i.started_at desc)
      from (select * from public.platform_incidents x where x.status <> 'resolved' or x.started_at > now() - interval '90 days'
            order by x.started_at desc limit 50) i), '[]'::jsonb)
  )
$$;

create or replace function public.pa_status_admin()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.pa_require();
  return public.public_status();
end;
$$;

create or replace function public.pa_incident_create(p_title text, p_impact text, p_services text[], p_body text, p_service_status text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.pa_require();
  v public.platform_incidents;
  v_services text[] := coalesce(p_services, '{}');
begin
  if exists (select 1 from unnest(v_services) x where not exists (select 1 from public.platform_services s where s.key = x)) then
    raise exception 'Layanan tidak dikenal' using errcode = 'P0001';
  end if;
  if p_service_status is not null and p_service_status not in ('operational', 'degraded', 'partial_outage', 'major_outage', 'maintenance') then
    raise exception 'Status layanan tidak dikenal' using errcode = 'P0001';
  end if;
  insert into public.platform_incidents (title, impact, services, created_by)
  values (left(trim(coalesce(p_title, '')), 120), coalesce(p_impact, 'minor'), v_services, v_actor)
  returning * into v;
  insert into public.platform_incident_updates (incident_id, status, body, created_by)
  values (v.id, 'investigating', left(trim(coalesce(p_body, '')), 1000), v_actor);
  if p_service_status is not null and cardinality(v_services) > 0 then
    update public.platform_services set status = p_service_status, updated_at = now() where key = any (v_services);
  end if;
  perform public.pa_log('incident.create', null, 'incident', v.id::text, null,
    jsonb_build_object('title', v.title, 'impact', v.impact, 'services', v.services, 'service_status', p_service_status));
  return to_jsonb(v);
exception
  when check_violation then
    raise exception 'Judul 4–120 karakter dan keterangan 4–1000 karakter' using errcode = 'P0001';
end;
$$;

-- Pembaruan insiden. Status "resolved" → semua layanan insiden ini kembali normal.
create or replace function public.pa_incident_update(p_incident uuid, p_status text, p_body text, p_service_status text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.pa_require();
  v public.platform_incidents;
begin
  select * into v from public.platform_incidents i where i.id = p_incident for update;
  if not found then
    raise exception 'Insiden tidak ditemukan' using errcode = 'P0002';
  end if;
  if v.status = 'resolved' then
    raise exception 'Insiden sudah selesai' using errcode = 'P0001';
  end if;
  insert into public.platform_incident_updates (incident_id, status, body, created_by)
  values (p_incident, p_status, left(trim(coalesce(p_body, '')), 1000), v_actor);
  update public.platform_incidents set status = p_status, updated_at = now(),
    resolved_at = case when p_status = 'resolved' then now() end
  where id = p_incident returning * into v;
  if p_status = 'resolved' then
    update public.platform_services s set status = 'operational', updated_at = now()
    where s.key = any (v.services)
      and not exists (select 1 from public.platform_incidents o where o.id <> v.id and o.status <> 'resolved' and s.key = any (o.services));
  elsif p_service_status is not null then
    update public.platform_services set status = p_service_status, updated_at = now() where key = any (v.services);
  end if;
  perform public.pa_log('incident.update', null, 'incident', v.id::text, null, jsonb_build_object('status', p_status, 'service_status', p_service_status), left(p_body, 200));
  return to_jsonb(v);
exception
  when check_violation then
    raise exception 'Status tidak dikenal atau keterangan 4–1000 karakter' using errcode = 'P0001';
end;
$$;

create or replace function public.pa_service_set_status(p_service text, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before text;
  v public.platform_services;
begin
  perform public.pa_require();
  select s.status into v_before from public.platform_services s where s.key = p_service for update;
  if v_before is null then
    raise exception 'Layanan tidak dikenal' using errcode = 'P0002';
  end if;
  update public.platform_services set status = p_status, updated_at = now() where key = p_service returning * into v;
  perform public.pa_log('service.status', null, 'service', p_service, jsonb_build_object('status', v_before), jsonb_build_object('status', p_status));
  return to_jsonb(v);
exception
  when check_violation then
    raise exception 'Status layanan tidak dikenal' using errcode = 'P0001';
end;
$$;

-- ---------------------------------------------------------------------
-- F. Daftar sendiri (Edge Function self-signup, service_role)
-- ---------------------------------------------------------------------
alter table public.cafes add column if not exists city text;
alter table public.cafes add column if not exists signup_status text;
alter table public.cafes add column if not exists signup_at timestamptz;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cafes_signup_status_check') then
    alter table public.cafes add constraint cafes_signup_status_check check (signup_status is null or signup_status in ('pending', 'approved', 'rejected'));
  end if;
  -- Jenis nonaktif baru: approval (menunggu persetujuan pendaftaran)
  alter table public.cafes drop constraint if exists cafes_suspended_kind_check;
  alter table public.cafes add constraint cafes_suspended_kind_check check (suspended_kind is null or suspended_kind in ('manual', 'billing', 'approval'));
end;
$$;

-- Percobaan daftar per IP (IP disimpan sebagai hash, bukan alamat asli)
create table if not exists public.signup_attempts (
  id bigint generated always as identity primary key,
  ip_hash text not null,
  outcome text not null default 'attempt' check (outcome in ('attempt', 'created', 'duplicate', 'rejected')),
  created_at timestamptz not null default now()
);
create index if not exists signup_attempts_ip_idx on public.signup_attempts (ip_hash, created_at desc);
alter table public.signup_attempts enable row level security;
revoke all on public.signup_attempts from public, anon, authenticated;

-- Catat percobaan & cek batas: maks. 5 per jam dan 20 per hari per IP. true = boleh lanjut.
create or replace function public.pa_signup_rate(p_ip_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hour integer;
  v_day integer;
  v_settings public.platform_settings;
begin
  select * into v_settings from public.platform_settings s where s.id;
  if not v_settings.signup_enabled then
    return jsonb_build_object('ok', false, 'reason', 'disabled');
  end if;
  if p_ip_hash is null or length(p_ip_hash) < 16 then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  select count(*) filter (where a.created_at > now() - interval '1 hour'), count(*) into v_hour, v_day
  from public.signup_attempts a where a.ip_hash = p_ip_hash and a.created_at > now() - interval '1 day';
  insert into public.signup_attempts (ip_hash) values (p_ip_hash);
  delete from public.signup_attempts where created_at < now() - interval '30 days';
  if v_hour >= 5 or v_day >= 20 then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;
  return jsonb_build_object('ok', true, 'approval_mode', v_settings.signup_approval_mode,
    'trial_days', v_settings.default_trial_days, 'trial_plan', v_settings.default_trial_plan);
end;
$$;

-- Kafe + profil owner + trial dari pengaturan. p_user = akun yang baru dibuat Auth (belum verifikasi email).
create or replace function public.pa_signup_create(
  p_user uuid, p_cafe_name text, p_owner_name text, p_whatsapp text, p_city text, p_ip_hash text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := nullif(left(regexp_replace(trim(coalesce(p_cafe_name, '')), '\s+', ' ', 'g'), 80), '');
  v_owner text := nullif(left(regexp_replace(trim(coalesce(p_owner_name, '')), '\s+', ' ', 'g'), 80), '');
  v_city text := nullif(left(regexp_replace(trim(coalesce(p_city, '')), '\s+', ' ', 'g'), 60), '');
  v_wa text := public.normalize_wa(p_whatsapp);
  v_settings public.platform_settings;
  v_cafe uuid;
  v_slug text;
  v_email text;
  v_sub public.cafe_subscriptions;
begin
  select * into v_settings from public.platform_settings s where s.id;
  if not v_settings.signup_enabled then
    raise exception 'Pendaftaran sedang ditutup' using errcode = 'P0001', hint = 'signup_disabled';
  end if;
  if v_name is null or length(v_name) < 2 then
    raise exception 'Nama kafe minimal 2 karakter' using errcode = 'P0001';
  end if;
  if v_owner is null or length(v_owner) < 2 then
    raise exception 'Nama owner minimal 2 karakter' using errcode = 'P0001';
  end if;
  if v_city is null or length(v_city) < 2 then
    raise exception 'Isi kota kafe' using errcode = 'P0001';
  end if;
  if v_wa is null then
    raise exception 'Isi nomor WhatsApp' using errcode = 'P0001';
  end if;
  select u.email into v_email from auth.users u where u.id = p_user;
  if not found then
    raise exception 'Akun tidak ditemukan' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.profiles p where p.id = p_user and (p.cafe_id is not null or p.role::text <> 'customer'))
     or exists (select 1 from public.platform_admins a where a.user_id = p_user) then
    raise exception 'Akun ini sudah terhubung ke kafe' using errcode = 'P0001', hint = 'already_linked';
  end if;

  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'cafes' and column_name = 'slug') then
    v_slug := trim(both '-' from regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g'));
    if v_slug = '' then v_slug := 'kafe'; end if;
    v_slug := left(v_slug, 40) || '-' || substr(md5(gen_random_uuid()::text), 1, 5);
    execute 'insert into public.cafes (name, slug) values ($1, $2) returning id' into v_cafe using v_name, v_slug;
  else
    insert into public.cafes (name) values (v_name) returning id into v_cafe;
  end if;
  update public.cafes set city = v_city, owner_whatsapp = v_wa, signup_at = now(),
    signup_status = case when v_settings.signup_approval_mode then 'pending' else 'approved' end,
    suspended_at = case when v_settings.signup_approval_mode then now() end,
    suspended_kind = case when v_settings.signup_approval_mode then 'approval' end,
    suspended_reason = case when v_settings.signup_approval_mode then 'Menunggu persetujuan pendaftaran oleh Dailybrew' end
  where id = v_cafe;

  insert into public.profiles (id, cafe_id, full_name, role)
  values (p_user, v_cafe, v_owner, 'owner')
  on conflict (id) do update set cafe_id = excluded.cafe_id, full_name = excluded.full_name, role = excluded.role;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'email') then
    execute 'update public.profiles set email = $1 where id = $2' using v_email, p_user;
  end if;

  perform public.pa_sub_lock(v_cafe);
  update public.cafe_subscriptions
  set plan_code = v_settings.default_trial_plan, status = 'trialing',
      trial_ends_at = now() + make_interval(days => v_settings.default_trial_days), current_period_end = null, updated_at = now()
  where cafe_id = v_cafe
  returning * into v_sub;

  update public.signup_attempts set outcome = 'created'
  where id = (select a.id from public.signup_attempts a where a.ip_hash = p_ip_hash order by a.created_at desc limit 1);

  perform public.pa_log('cafe.signup', v_cafe, 'cafe', v_cafe::text, null,
    jsonb_build_object('name', v_name, 'owner_id', p_user, 'owner_name', v_owner, 'owner_email', v_email, 'city', v_city,
                       'plan', v_settings.default_trial_plan, 'trial_days', v_settings.default_trial_days,
                       'approval', v_settings.signup_approval_mode, 'subscription', public.pa_sub_json(v_sub)),
    'Daftar sendiri', p_user, 'pendaftaran');
  perform public.pa_notify_admin('cafe_signup', case when v_settings.signup_approval_mode then 'warning' else 'success' end,
    'Kafe baru mendaftar: ' || v_name,
    v_owner || ' · ' || v_city || case when v_settings.signup_approval_mode then ' · menunggu persetujuan' else '' end,
    v_cafe, case when v_settings.signup_approval_mode then '/pendaftaran' else '/kafe/' || v_cafe end, 'cafe_signup:' || v_cafe);
  -- Email selamat datang (template "welcome", dikirim Edge Function notify)
  insert into public.notification_outbox (channel, audience, cafe_id, recipient, kind, subject, title, body, cta_label, cta_url, dedupe_key)
  values ('email', 'owner', v_cafe, v_email, 'cafe_welcome', 'Selamat datang di Dailybrew', 'Selamat datang, ' || v_owner,
    case when v_settings.signup_approval_mode
      then 'Pendaftaran ' || v_name || ' sudah kami terima dan sedang ditinjau. Kami kabari begitu disetujui.'
      else 'Kafe ' || v_name || ' sudah siap dengan masa coba ' || v_settings.default_trial_days || ' hari. Verifikasi email, lalu ikuti 8 langkah setup.' end,
    'Buka dashboard', '/mulai', 'cafe_welcome:' || v_cafe)
  on conflict (dedupe_key) do nothing;
  return jsonb_build_object('cafe_id', v_cafe, 'pending', v_settings.signup_approval_mode);
end;
$$;

create or replace function public.pa_signups_list(p_status text default null, p_limit integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.pa_require();
  return jsonb_build_object(
    'counts', (select jsonb_build_object('pending', count(*) filter (where c.signup_status = 'pending'),
                                         'approved', count(*) filter (where c.signup_status = 'approved'),
                                         'rejected', count(*) filter (where c.signup_status = 'rejected'))
               from public.cafes c where c.signup_status is not null),
    'rows', coalesce((select jsonb_agg(x order by (x ->> 'signup_at') desc) from (
        select jsonb_build_object('cafe_id', c.id, 'name', c.name, 'city', c.city, 'owner_whatsapp', c.owner_whatsapp,
          'signup_status', c.signup_status, 'signup_at', c.signup_at, 'owner_name', r.owner_name, 'owner_email', r.owner_email,
          'email_confirmed', (select u.email_confirmed_at is not null from auth.users u where u.id = r.owner_id),
          'state', r.state, 'plan_name', r.plan_name, 'trial_ends_at', r.trial_ends_at) as x
        from public.cafes c join public.pa_cafe_rows() r on r.cafe_id = c.id
        where c.signup_status is not null and (nullif(p_status, '') is null or c.signup_status = p_status)
        order by c.signup_at desc limit least(greatest(coalesce(p_limit, 50), 1), 200)) t), '[]'::jsonb)
  );
end;
$$;

-- Setujui / tolak pendaftaran (mode persetujuan). Disetujui → aktif, masa coba dihitung ulang dari sekarang.
create or replace function public.pa_signup_decide(p_cafe uuid, p_approve boolean, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.pa_require();
  v_cafe public.cafes;
  v_days integer := (select s.default_trial_days from public.platform_settings s where s.id);
begin
  select * into v_cafe from public.cafes c where c.id = p_cafe for update;
  if not found or v_cafe.signup_status is null then
    raise exception 'Pendaftaran tidak ditemukan' using errcode = 'P0002';
  end if;
  if v_cafe.signup_status <> 'pending' then
    raise exception 'Pendaftaran ini sudah diputuskan' using errcode = 'P0001';
  end if;
  if p_approve then
    update public.cafes set signup_status = 'approved', suspended_at = null, suspended_reason = null, suspended_kind = null where id = p_cafe;
    update public.cafe_subscriptions set trial_ends_at = now() + make_interval(days => v_days), updated_at = now()
    where cafe_id = p_cafe and status = 'trialing';
    perform public.pa_notify_owner(p_cafe, 'signup_approved', 'success', 'Pendaftaran disetujui',
      'Selamat! Kafe ' || v_cafe.name || ' sudah aktif dengan masa coba ' || v_days || ' hari. Ikuti 8 langkah setup untuk mulai berjualan.',
      '/mulai', 'signup_approved:' || p_cafe, now() + interval '14 days', true);
  else
    if nullif(trim(coalesce(p_note, '')), '') is null then
      raise exception 'Isi alasan penolakan' using errcode = 'P0001';
    end if;
    update public.cafes set signup_status = 'rejected', suspended_reason = 'Pendaftaran ditolak: ' || left(trim(p_note), 200) where id = p_cafe;
  end if;
  perform public.pa_log(case when p_approve then 'signup.approve' else 'signup.reject' end, p_cafe, 'cafe', p_cafe::text,
    jsonb_build_object('signup_status', 'pending'), jsonb_build_object('signup_status', case when p_approve then 'approved' else 'rejected' end), p_note);
  return jsonb_build_object('cafe_id', p_cafe, 'signup_status', case when p_approve then 'approved' else 'rejected' end);
end;
$$;

-- Status pendaftaran untuk owner (banner "menunggu persetujuan")
create or replace function public.owner_signup_status(p_cafe_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_cafe_member(p_cafe_id, array['owner']) then
    raise exception 'Hanya owner kafe ini' using errcode = '42501';
  end if;
  return (select jsonb_build_object('signup_status', c.signup_status, 'signup_at', c.signup_at, 'city', c.city) from public.cafes c where c.id = p_cafe_id);
end;
$$;

-- ---------------------------------------------------------------------
-- G. Wizard setup owner (8 langkah, data yang sama dengan file 16)
-- ---------------------------------------------------------------------
create or replace function public.owner_setup_progress(p_cafe_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_cafe_member(p_cafe_id, array['owner']) then
    raise exception 'Hanya owner kafe ini' using errcode = '42501';
  end if;
  return public.pa_setup_json(p_cafe_id) - 'stuck_days';
end;
$$;

-- ---------------------------------------------------------------------
-- H. Template email
-- ---------------------------------------------------------------------
create table if not exists public.platform_email_templates (
  key text primary key check (key in ('welcome', 'invoice', 'reminder', 'reset_password')),
  subject text not null check (char_length(subject) between 3 and 160),
  heading text not null check (char_length(heading) between 2 and 160),
  body text not null check (char_length(body) between 2 and 4000),
  cta_label text check (cta_label is null or char_length(cta_label) <= 40),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);
insert into public.platform_email_templates (key, subject, heading, body, cta_label) values
  ('welcome', 'Selamat datang di {{platform}}', 'Halo {{nama_owner}}, selamat datang!',
   E'{{isi}}\n\nLangkah pertama: lengkapi identitas kafe, jam buka, menu, meja, dan pembayaran. Semuanya ada di menu Mulai.\n\nButuh bantuan? Balas lewat menu Bantuan di dashboard.', 'Buka dashboard'),
  ('invoice', 'Tagihan langganan {{nama_kafe}}', 'Tagihan baru untuk {{nama_kafe}}',
   E'{{isi}}\n\nBayar online dengan QRIS, virtual account, e-wallet, atau kartu dari Pengaturan → Langganan.', 'Bayar sekarang'),
  ('reminder', '{{judul}} · {{nama_kafe}}', '{{judul}}',
   E'{{isi}}\n\nAbaikan pesan ini bila sudah membayar.', 'Bayar sekarang'),
  ('reset_password', 'Atur ulang password {{platform}}', 'Atur ulang password',
   E'Kami menerima permintaan atur ulang password untuk akun ini. Tekan tombol di bawah untuk membuat password baru.\n\nAbaikan email ini bila kamu tidak memintanya.', 'Buat password baru')
on conflict (key) do nothing;
alter table public.platform_email_templates enable row level security;
revoke all on public.platform_email_templates from public, anon, authenticated;
grant select on public.platform_email_templates to service_role;

create or replace function public.pa_email_templates_list()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.pa_require();
  return coalesce((select jsonb_agg(to_jsonb(t) - 'updated_by' order by array_position(array['welcome', 'invoice', 'reminder', 'reset_password'], t.key))
                   from public.platform_email_templates t), '[]'::jsonb);
end;
$$;

create or replace function public.pa_email_template_update(p_key text, p_subject text, p_heading text, p_body text, p_cta_label text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.platform_email_templates;
  v public.platform_email_templates;
begin
  perform public.pa_require();
  select * into v_before from public.platform_email_templates t where t.key = p_key for update;
  if not found then
    raise exception 'Template tidak dikenal' using errcode = 'P0002';
  end if;
  update public.platform_email_templates set subject = trim(p_subject), heading = trim(p_heading), body = trim(p_body),
    cta_label = nullif(trim(coalesce(p_cta_label, '')), ''), updated_at = now(), updated_by = (select auth.uid())
  where key = p_key returning * into v;
  perform public.pa_log('email_template.update', null, 'email_template', p_key,
    to_jsonb(v_before) - 'updated_at' - 'updated_by', to_jsonb(v) - 'updated_at' - 'updated_by');
  return to_jsonb(v) - 'updated_by';
exception
  when check_violation or not_null_violation then
    raise exception 'Subjek 3–160, judul 2–160, isi 2–4000 karakter, tombol maks. 40' using errcode = 'P0001';
end;
$$;

-- ---------------------------------------------------------------------
-- I. Advisor AI platform
-- ---------------------------------------------------------------------
create table if not exists public.platform_ai_logs (
  id bigint generated always as identity primary key,
  admin_id uuid references auth.users (id) on delete set null,
  question text not null,
  answer text,
  status text not null check (status in ('answered', 'refused', 'error')),
  model text,
  input_tokens integer,
  output_tokens integer,
  created_at timestamptz not null default now()
);
create index if not exists platform_ai_logs_admin_idx on public.platform_ai_logs (admin_id, created_at desc);
alter table public.platform_ai_logs enable row level security;
revoke all on public.platform_ai_logs from public, anon, authenticated;

create or replace function public.pa_ai_quota()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.pa_require();
  v_limit integer := (select s.ai_daily_limit from public.platform_settings s where s.id);
  v_used integer;
begin
  select count(*) into v_used from public.platform_ai_logs l
  where l.admin_id = v_actor and l.status <> 'error'
    and l.created_at >= (date_trunc('day', now() at time zone 'Asia/Jakarta') at time zone 'Asia/Jakarta');
  return jsonb_build_object('limit', v_limit, 'used', v_used, 'remaining', greatest(v_limit - v_used, 0));
end;
$$;

-- Paket fakta untuk AI. Semua angka dari database; risk_points dihitung dengan rumus tertulis (risk_formula).
create or replace function public.pa_ai_facts()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  perform public.pa_require();
  with base as (
    select r.cafe_id, r.name, r.plan_name, r.state, r.monthly_price, r.created_at, r.sub_status,
      case when r.sub_status = 'trialing' then r.trial_ends_at else r.current_period_end end as period_end,
      h.score, h.label, h.reasons, h.components,
      (select h2.score from public.cafe_health_daily h2 where h2.cafe_id = r.cafe_id and h2.day <= (now() at time zone 'Asia/Jakarta')::date - 14
       order by h2.day desc limit 1) as score_14d_ago,
      (select floor(extract(epoch from now() - u.last_sign_in_at) / 86400)::integer from auth.users u where u.id = r.owner_id) as owner_login_days,
      (select max(floor(extract(epoch from now() - i.due_at) / 86400))::integer from public.subscription_invoices i
       where i.cafe_id = r.cafe_id and i.status = 'pending' and i.due_at < now()) as overdue_days,
      (select count(*) from public.platform_tickets t where t.cafe_id = r.cafe_id and t.status <> 'resolved') as open_tickets,
      (public.pa_setup_json(r.cafe_id) ->> 'done')::integer as setup_done
    from public.pa_cafe_rows() r
    left join public.pa_health_latest() h on h.cafe_id = r.cafe_id
    where r.state in ('active', 'past_due', 'trial')
  ),
  scored as (
    select b.*,
      (100 - coalesce(b.score, 50))
      + case when b.overdue_days > 0 then 15 else 0 end
      + case when b.score_14d_ago is not null and b.score_14d_ago - coalesce(b.score, 50) >= 15 then 10 else 0 end
      + case when b.owner_login_days >= 14 then 10 else 0 end
      + case when b.state = 'trial' and b.period_end < now() + interval '7 days' and b.setup_done < 6 then 10 else 0 end as risk_points
    from base b
  )
  select jsonb_build_object(
    'generated_at', now(),
    'risk_formula', '100 − skor kesehatan (tanpa skor = 50) + 15 bila ada tagihan telat + 10 bila skor turun ≥15 dalam 14 hari + 10 bila owner tidak login ≥14 hari + 10 bila masa coba habis ≤7 hari dan setup <6 dari 8. Makin besar = makin berisiko berhenti.',
    'summary', (select jsonb_build_object(
        'paying_cafes', count(*) filter (where s.state in ('active', 'past_due')),
        'trial_cafes', count(*) filter (where s.state = 'trial'),
        'mrr', coalesce(sum(s.monthly_price) filter (where s.state in ('active', 'past_due')), 0),
        'health', jsonb_build_object('healthy', count(*) filter (where s.label = 'healthy'), 'watch', count(*) filter (where s.label = 'watch'),
                                     'risk', count(*) filter (where s.label = 'risk'), 'no_score', count(*) filter (where s.label is null)),
        'overdue_cafes', count(*) filter (where s.overdue_days > 0),
        'trials_ending_7d', count(*) filter (where s.state = 'trial' and s.period_end < now() + interval '7 days'))
      from scored s),
    'cafes_by_risk', coalesce((select jsonb_agg(jsonb_build_object(
        'cafe', s.name, 'plan', s.plan_name, 'state', s.state, 'monthly_price', s.monthly_price, 'risk_points', s.risk_points,
        'health_score', s.score, 'health_label', s.label, 'health_score_14d_ago', s.score_14d_ago, 'health_reasons', s.reasons,
        'orders_last_14d', (s.components -> 'orders' ->> 'last_14')::integer, 'orders_prev_14d', (s.components -> 'orders' ->> 'prev_14')::integer,
        'owner_last_login_days', s.owner_login_days, 'overdue_invoice_days', s.overdue_days,
        'days_until_period_end', case when s.period_end is not null then floor(extract(epoch from s.period_end - now()) / 86400)::integer end,
        'setup_steps_done', s.setup_done, 'open_tickets', s.open_tickets,
        'customer_since_days', floor(extract(epoch from now() - s.created_at) / 86400)::integer)
      order by s.risk_points desc, s.monthly_price desc) from (select * from scored order by risk_points desc, monthly_price desc limit 15) s), '[]'::jsonb),
    'churn_last_3_months', (select coalesce(jsonb_agg(jsonb_build_object('month', m.month, 'churn', m.churn, 'start_mrr', m.start_mrr) order by m.month), '[]'::jsonb)
      from (select to_char(x.month, 'YYYY-MM') as month,
                   coalesce(sum(case when x.mrr = 0 and prev.mrr > 0 then prev.mrr else 0 end), 0) as churn,
                   coalesce(sum(prev.mrr), 0) as start_mrr
            from public.cafe_mrr_monthly x
            left join public.cafe_mrr_monthly prev on prev.cafe_id = x.cafe_id and prev.month = (x.month - interval '1 month')::date
            where x.month >= (date_trunc('month', now() at time zone 'Asia/Jakarta') - interval '3 months')::date
            group by x.month) m)
  ) into v
  from (select 1) one;
  return v;
end;
$$;

create or replace function public.pa_ai_log(p_question text, p_answer text, p_status text, p_model text, p_input_tokens integer, p_output_tokens integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.pa_require();
begin
  insert into public.platform_ai_logs (admin_id, question, answer, status, model, input_tokens, output_tokens)
  values (v_actor, left(coalesce(p_question, ''), 500), left(p_answer, 8000), p_status, left(p_model, 60), p_input_tokens, p_output_tokens);
end;
$$;

create or replace function public.pa_ai_history(p_limit integer default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.pa_require();
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'question', l.question, 'answer', l.answer, 'status', l.status, 'created_at', l.created_at) order by l.created_at desc)
    from (select * from public.platform_ai_logs x where x.admin_id = v_actor order by x.created_at desc limit least(greatest(coalesce(p_limit, 20), 1), 50)) l), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------
-- Hak panggil
-- ---------------------------------------------------------------------
do $$
declare
  v_sig text;
begin
  -- Internal: tertutup untuk semua peran aplikasi
  foreach v_sig in array array[
    'pa_grace_days()', 'pa_grace()', 'pa_role_allows(text, text)', 'pa_caller_fn(text, integer)', 'pa_admin_can(uuid, text)',
    'cafe_flag(uuid, text)', 'cafe_effective_features(uuid)', 'pa_impersonated_cafe()', 'pa_block_impersonated_writes()',
    'pa_install_read_only_guards()', 'pa_admin_has_mfa(uuid)', 'pa_cafe_rows()', 'cafe_plan(uuid)', 'pa_is_cafe_owner(uuid, uuid)',
    'pa_cafe_create_for_owner(uuid, uuid, text, text, text, integer)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', v_sig);
  end loop;
  -- pa_is_cafe_owner dipakai policy (file 15) → tetap boleh dieksekusi authenticated (hanya menjawab benar/salah)
  grant execute on function public.pa_is_cafe_owner(uuid, uuid) to authenticated;
  revoke execute on function public.pa_cafe_create_for_owner(uuid, uuid, text, text, text, integer) from service_role;
  -- Khusus service_role (Edge Function / pg_cron)
  foreach v_sig in array array[
    'pa_admin_can(uuid, text)', 'pa_admin_add(uuid, uuid, text, text)', 'pa_cafe_create_for_owner(uuid, uuid, text, text, text, integer, text)',
    'pa_signup_rate(text)', 'pa_signup_create(uuid, text, text, text, text, text)', 'pa_daily_check()'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', v_sig);
    execute format('grant execute on function public.%s to service_role', v_sig);
  end loop;
  -- Publik tanpa login
  revoke all on function public.public_status() from public;
  grant execute on function public.public_status() to anon, authenticated;
  -- Dashboard admin (pa_require: admin aktif + 2FA + peran) & fungsi owner/anggota (memeriksa sendiri)
  foreach v_sig in array array[
    'pa_role()', 'pa_whoami()', 'pa_admins_list()', 'pa_admin_update(uuid, text, boolean, text)', 'pa_platform_settings_update(jsonb)',
    'pa_cafe_flags(uuid)', 'pa_flags_overview()', 'pa_flag_set(uuid, text, boolean, text, timestamptz)',
    'pa_flag_bulk(text, uuid[], boolean, text, timestamptz)', 'pa_feature_upsert(text, text, text)',
    'pa_impersonate_start(uuid, text)', 'pa_impersonate_end(uuid)', 'impersonation_context(uuid)', 'pa_impersonations_list(uuid, integer)',
    'pa_status_admin()', 'pa_incident_create(text, text, text[], text, text)', 'pa_incident_update(uuid, text, text, text)',
    'pa_service_set_status(text, text)', 'pa_signups_list(text, integer)', 'pa_signup_decide(uuid, boolean, text)',
    'pa_email_templates_list()', 'pa_email_template_update(text, text, text, text, text)',
    'pa_ai_quota()', 'pa_ai_facts()', 'pa_ai_log(text, text, text, text, integer, integer)', 'pa_ai_history(integer)',
    'is_cafe_member(uuid, text[])', 'cafe_has_feature(uuid, text)',
    'cafe_entitlements(uuid)', 'cafe_flags(uuid)', 'cafe_platform_status(uuid)', 'owner_signup_status(uuid)', 'owner_setup_progress(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', v_sig);
    execute format('grant execute on function public.%s to authenticated', v_sig);
  end loop;
end;
$$;

-- Penjaga baca-saja dipasang ke semua tabel public (termasuk tabel baru file ini)
select public.pa_install_read_only_guards();

-- Realtime: insiden baru langsung tampil di banner web owner tidak memakai Realtime (dibaca berkala) — tidak ada publikasi baru.

notify pgrst, 'reload schema';

commit;

-- Verifikasi: 11 tabel + 1 baris penjaga, dan baris "tanpa_rls" TIDAK boleh muncul
select 'table' as kind, table_name as name
from information_schema.tables
where table_schema = 'public' and table_name in ('platform_role_permissions', 'platform_features', 'cafe_feature_flags', 'platform_impersonations',
  'platform_services', 'platform_incidents', 'platform_incident_updates', 'signup_attempts', 'platform_email_templates', 'platform_ai_logs', 'platform_admins')
union all
select 'penjaga_baca_saja', count(*)::text from pg_trigger where tgname = 'zz_impersonation_read_only' and not tgisinternal
union all
select 'tanpa_rls', c.relname
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
order by 1, 2;

-- =====================================================================
-- SETELAH MENJALANKAN FILE INI (lihat platform-admin/README.md langkah 11):
--   1. Semua admin lama otomatis berperan "super". Atur peran tim di menu Tim admin.
--   2. Deploy Edge Function baru: self-signup (Turnstile), platform-advisor (Tanya AI); deploy ulang platform-admin & notify.
--   3. Supabase Auth → nyalakan "Confirm email" agar pendaftar wajib verifikasi email.
--   4. Menambah tabel baru di kemudian hari? Jalankan:  select public.pa_install_read_only_guards();
-- =====================================================================
