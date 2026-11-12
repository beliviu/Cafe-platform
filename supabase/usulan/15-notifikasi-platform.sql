-- =====================================================================
-- 15 · NOTIFIKASI PLATFORM, "PERLU TINDAKAN", WHATSAPP MANUAL, PENGATURAN & TEMA PLATFORM
-- ---------------------------------------------------------------------
-- Bergantung pada file 14 (platform_admins, pa_require, subscription_invoices, pa_billing_run).
--
-- Isi:
--   A. platform_settings (1 baris): nomor WA Dailybrew, warna tema dashboard platform, pengaturan email.
--   B. Nomor WA owner (cafes.owner_whatsapp, format 62…), diisi admin atau owner sendiri.
--      WhatsApp TETAP MANUAL: tombol membuka wa.me; setiap klik admin dicatat di log audit.
--   C. "Perlu tindakan" (pa_action_items) + ringkasan diperluas (kafe tanpa harga, riwayat 12 bulan).
--   D. Notifikasi admin (platform_notifications, Realtime) & owner (cafe_notifications), anti-duplikat.
--   E. Antrean kirim (notification_outbox, kolom channel: email sekarang, whatsapp disiapkan)
--      → Edge Function "notify" lewat Database Webhook.
--   F. Pengecekan harian pa_daily_check() (pg_cron 08.00 WIB) — sekaligus menjalankan pa_billing_run().
--   G. Pengumuman admin ke semua kafe / kafe tertentu.
--
-- Data lama tidak diubah. Aman dijalankan ulang.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- A. Pengaturan platform (satu baris)
-- ---------------------------------------------------------------------
create table if not exists public.platform_settings (
  id boolean primary key default true check (id),
  support_whatsapp text check (support_whatsapp is null or support_whatsapp ~ '^62[0-9]{8,13}$'),
  theme_color text not null default '#B0805A' check (theme_color ~ '^#[0-9A-Fa-f]{6}$'),
  theme_color2 text check (theme_color2 is null or theme_color2 ~ '^#[0-9A-Fa-f]{6}$'),
  email_from_name text not null default 'Dailybrew',
  email_admin_kinds text[] not null default '{invoice_overdue,payment_failed,invoice_paid,cafe_created}',
  email_owner_kinds text[] not null default '{invoice_due_7,invoice_due_1,invoice_overdue,trial_ending}',
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);
insert into public.platform_settings (id) values (true) on conflict (id) do nothing;
alter table public.platform_settings enable row level security;
revoke all on public.platform_settings from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- B. Nomor WhatsApp
-- ---------------------------------------------------------------------
-- "0812-3456 789" / "+62 812…" / "812…" → "62812…"; kosong → null; tidak valid → error
create or replace function public.normalize_wa(p_value text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := regexp_replace(coalesce(p_value, ''), '[^0-9]', '', 'g');
begin
  if v = '' then
    return null;
  end if;
  if v like '0%' then
    v := '62' || substr(v, 2);
  elsif v like '8%' then
    v := '62' || v;
  end if;
  if v !~ '^62[0-9]{8,13}$' then
    raise exception 'Nomor WhatsApp tidak valid. Contoh: 0812 3456 7890' using errcode = 'P0001', hint = 'invalid_whatsapp';
  end if;
  return v;
end;
$$;
grant execute on function public.normalize_wa(text) to authenticated;

alter table public.cafes add column if not exists owner_whatsapp text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cafes_owner_whatsapp_check') then
    alter table public.cafes add constraint cafes_owner_whatsapp_check check (owner_whatsapp is null or owner_whatsapp ~ '^62[0-9]{8,13}$');
  end if;
end;
$$;

-- Owner mengisi nomor WA-nya sendiri (hanya kafenya)
create or replace function public.owner_set_whatsapp(p_cafe_id uuid, p_whatsapp text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v text := public.normalize_wa(p_whatsapp);
begin
  if not public.pa_is_cafe_owner(p_cafe_id, (select auth.uid())) then
    raise exception 'Hanya owner kafe ini' using errcode = '42501';
  end if;
  update public.cafes set owner_whatsapp = v where id = p_cafe_id;
  return v;
end;
$$;
revoke all on function public.owner_set_whatsapp(uuid, text) from public, anon;
grant execute on function public.owner_set_whatsapp(uuid, text) to authenticated;

-- Nomor WA owner kafe sendiri + nomor WA Dailybrew (untuk tombol "Hubungi Dailybrew")
create or replace function public.platform_contact(p_cafe_id uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'support_whatsapp', (select s.support_whatsapp from public.platform_settings s where s.id),
    'owner_whatsapp', case when p_cafe_id is not null and public.pa_is_cafe_owner(p_cafe_id, (select auth.uid()))
                           then (select c.owner_whatsapp from public.cafes c where c.id = p_cafe_id) end
  )
$$;
revoke all on function public.platform_contact(uuid) from public, anon;
grant execute on function public.platform_contact(uuid) to authenticated;

create or replace function public.pa_cafe_set_owner_whatsapp(p_cafe uuid, p_whatsapp text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v text := public.normalize_wa(p_whatsapp);
  v_old text;
begin
  perform public.pa_require();
  select c.owner_whatsapp into v_old from public.cafes c where c.id = p_cafe for update;
  if not found then
    raise exception 'Kafe tidak ditemukan' using errcode = 'P0002';
  end if;
  update public.cafes set owner_whatsapp = v where id = p_cafe;
  perform public.pa_log('cafe.owner_whatsapp', p_cafe, 'cafe', p_cafe::text,
    jsonb_build_object('owner_whatsapp', v_old), jsonb_build_object('owner_whatsapp', v));
  return v;
end;
$$;

-- Klik "Chat WA" di dashboard platform → log audit (pesan dikirim manual oleh admin lewat wa.me)
create or replace function public.pa_log_whatsapp(p_cafe uuid, p_template text, p_phone text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.pa_require();
  if not exists (select 1 from public.cafes c where c.id = p_cafe) then
    raise exception 'Kafe tidak ditemukan' using errcode = 'P0002';
  end if;
  perform public.pa_log('whatsapp.open', p_cafe, 'cafe', p_cafe::text, null,
    jsonb_build_object('template', left(coalesce(p_template, 'bebas'), 40), 'phone', p_phone));
end;
$$;

-- Buat kafe + owner dengan nomor WA (dipanggil Edge Function platform-admin)
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
  v_result := public.pa_cafe_create_for_owner(p_actor, p_owner_id, p_cafe_name, p_owner_name, p_plan, p_trial_days);
  if v_wa is not null then
    update public.cafes set owner_whatsapp = v_wa where id = (v_result ->> 'cafe_id')::uuid;
  end if;
  return v_result;
end;
$$;
revoke all on function public.pa_cafe_create_for_owner(uuid, uuid, text, text, text, integer, text) from public, anon, authenticated;
grant execute on function public.pa_cafe_create_for_owner(uuid, uuid, text, text, text, integer, text) to service_role;

create or replace function public.pa_settings_get()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.pa_require();
  return (select to_jsonb(s) - 'id' from public.platform_settings s where s.id);
end;
$$;

-- Tema dashboard platform: dibaca semua admin (sudah login) — tanpa aal2 agar layar 2FA ikut berwarna
create or replace function public.pa_theme()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when exists (select 1 from public.platform_admins a where a.user_id = (select auth.uid()) and a.is_active)
    then (select jsonb_build_object('color', s.theme_color, 'color2', s.theme_color2) from public.platform_settings s where s.id) end
$$;
revoke all on function public.pa_theme() from public, anon;
grant execute on function public.pa_theme() to authenticated;

create or replace function public.pa_settings_update(p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_allowed text[] := array['support_whatsapp', 'theme_color', 'theme_color2', 'email_from_name', 'email_admin_kinds', 'email_owner_kinds'];
  v_kinds text[] := array['cafe_created', 'invoice_paid', 'invoice_overdue', 'invoice_due_7', 'invoice_due_1', 'trial_ending', 'idle_cafe', 'payment_failed', 'announcement'];
begin
  perform public.pa_require();
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'Data pengaturan tidak valid' using errcode = 'P0001';
  end if;
  if exists (select 1 from jsonb_object_keys(p_patch) k where k <> all (v_allowed)) then
    raise exception 'Pengaturan tidak dikenal' using errcode = 'P0001';
  end if;
  select to_jsonb(s) - 'id' into v_before from public.platform_settings s where s.id for update;
  update public.platform_settings s set
    support_whatsapp = case when p_patch ? 'support_whatsapp' then public.normalize_wa(p_patch ->> 'support_whatsapp') else s.support_whatsapp end,
    theme_color = case when p_patch ? 'theme_color' then upper(p_patch ->> 'theme_color') else s.theme_color end,
    theme_color2 = case when p_patch ? 'theme_color2' then upper(nullif(p_patch ->> 'theme_color2', '')) else s.theme_color2 end,
    email_from_name = case when p_patch ? 'email_from_name' then coalesce(nullif(left(trim(p_patch ->> 'email_from_name'), 60), ''), 'Dailybrew') else s.email_from_name end,
    email_admin_kinds = case when p_patch ? 'email_admin_kinds' then array(select t.x from jsonb_array_elements_text(p_patch -> 'email_admin_kinds') as t(x) where t.x = any (v_kinds)) else s.email_admin_kinds end,
    email_owner_kinds = case when p_patch ? 'email_owner_kinds' then array(select t.x from jsonb_array_elements_text(p_patch -> 'email_owner_kinds') as t(x) where t.x = any (v_kinds)) else s.email_owner_kinds end,
    updated_at = now(),
    updated_by = (select auth.uid())
  where s.id
  returning to_jsonb(s) - 'id' into v_after;
  perform public.pa_log('settings.update', null, 'platform_settings', 'platform', v_before - 'updated_at' - 'updated_by', v_after - 'updated_at' - 'updated_by');
  return v_after;
end;
$$;

-- ---------------------------------------------------------------------
-- D. Notifikasi
-- ---------------------------------------------------------------------
create table if not exists public.platform_notifications (
  id bigint generated always as identity primary key,
  kind text not null,
  severity text not null default 'info' check (severity in ('info', 'success', 'warning', 'danger')),
  title text not null,
  body text,
  cafe_id uuid references public.cafes (id) on delete set null,
  link text,
  dedupe_key text unique,
  read_at timestamptz,
  read_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists platform_notifications_created_idx on public.platform_notifications (created_at desc);
create index if not exists platform_notifications_unread_idx on public.platform_notifications (created_at desc) where read_at is null;

create table if not exists public.cafe_notifications (
  id bigint generated always as identity primary key,
  cafe_id uuid not null references public.cafes (id) on delete cascade,
  kind text not null,
  severity text not null default 'info' check (severity in ('info', 'success', 'warning', 'danger')),
  title text not null,
  body text,
  link text,
  dedupe_key text unique,
  expires_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists cafe_notifications_cafe_idx on public.cafe_notifications (cafe_id, created_at desc);

create table if not exists public.notification_outbox (
  id bigint generated always as identity primary key,
  channel text not null default 'email' check (channel in ('email', 'whatsapp')),
  audience text not null check (audience in ('admin', 'owner')),
  cafe_id uuid references public.cafes (id) on delete set null,
  recipient text not null,
  kind text not null,
  subject text not null,
  title text not null,
  body text,
  cta_label text,
  cta_url text,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  error text,
  attempts integer not null default 0,
  provider text,
  provider_id text,
  dedupe_key text unique,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists notification_outbox_pending_idx on public.notification_outbox (created_at) where status in ('pending', 'failed');
create index if not exists notification_outbox_cafe_idx on public.notification_outbox (cafe_id, created_at desc);

create table if not exists public.platform_announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  target_cafe_ids uuid[],
  send_email boolean not null default false,
  recipients integer not null default 0,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.platform_notifications enable row level security;
alter table public.cafe_notifications enable row level security;
alter table public.notification_outbox enable row level security;
alter table public.platform_announcements enable row level security;
revoke all on public.platform_notifications, public.cafe_notifications, public.notification_outbox, public.platform_announcements from public, anon, authenticated;
-- SELECT hanya untuk Realtime & baca langsung; ubah selalu lewat fungsi
grant select on public.platform_notifications, public.cafe_notifications to authenticated;
drop policy if exists "Platform admins read notifications" on public.platform_notifications;
create policy "Platform admins read notifications" on public.platform_notifications for select to authenticated using (public.is_platform_admin());
drop policy if exists "Owners read own cafe notifications" on public.cafe_notifications;
create policy "Owners read own cafe notifications" on public.cafe_notifications for select to authenticated
  using (public.pa_is_cafe_owner(cafe_id, (select auth.uid())));
-- pa_is_cafe_owner dipakai policy → boleh dieksekusi authenticated (hanya menjawab benar/salah)
grant execute on function public.pa_is_cafe_owner(uuid, uuid) to authenticated;

-- Notifikasi admin (+ email bila jenisnya dipilih di pengaturan). true = baru dibuat
create or replace function public.pa_notify_admin(
  p_kind text, p_severity text, p_title text, p_body text, p_cafe uuid, p_link text, p_dedupe text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  insert into public.platform_notifications (kind, severity, title, body, cafe_id, link, dedupe_key)
  values (p_kind, p_severity, p_title, p_body, p_cafe, p_link, p_dedupe)
  on conflict (dedupe_key) do nothing
  returning id into v_id;
  if v_id is null then
    return false;
  end if;
  if p_kind = any (coalesce((select s.email_admin_kinds from public.platform_settings s where s.id), '{}'::text[])) then
    insert into public.notification_outbox (channel, audience, cafe_id, recipient, kind, subject, title, body, cta_label, cta_url, dedupe_key)
    select 'email', 'admin', p_cafe, u.email, p_kind, '[Dailybrew] ' || p_title, p_title, p_body, 'Buka dashboard', p_link,
           coalesce(p_dedupe, 'pn:' || v_id) || ':' || a.user_id
    from public.platform_admins a join auth.users u on u.id = a.user_id
    where a.is_active and u.email is not null
    on conflict (dedupe_key) do nothing;
  end if;
  return true;
end;
$$;
revoke all on function public.pa_notify_admin(text, text, text, text, uuid, text, text) from public, anon, authenticated;

-- Notifikasi owner kafe (+ email ke semua owner kafe itu bila jenisnya dipilih / p_force_email)
create or replace function public.pa_notify_owner(
  p_cafe uuid, p_kind text, p_severity text, p_title text, p_body text, p_link text, p_dedupe text,
  p_expires timestamptz default null, p_force_email boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  insert into public.cafe_notifications (cafe_id, kind, severity, title, body, link, dedupe_key, expires_at)
  values (p_cafe, p_kind, p_severity, p_title, p_body, p_link, p_dedupe, p_expires)
  on conflict (dedupe_key) do nothing
  returning id into v_id;
  if v_id is null then
    return false;
  end if;
  if p_force_email or p_kind = any (coalesce((select s.email_owner_kinds from public.platform_settings s where s.id), '{}'::text[])) then
    insert into public.notification_outbox (channel, audience, cafe_id, recipient, kind, subject, title, body, cta_label, cta_url, dedupe_key)
    select 'email', 'owner', p_cafe, u.email, p_kind, p_title, p_title, p_body,
           case when p_link is not null then 'Buka dashboard' end, p_link,
           coalesce(p_dedupe, 'cn:' || v_id) || ':' || pr.id
    from public.profiles pr join auth.users u on u.id = pr.id
    where pr.cafe_id = p_cafe and pr.role::text = 'owner' and coalesce(pr.is_active, true) and u.email is not null
    on conflict (dedupe_key) do nothing;
  end if;
  return true;
end;
$$;
revoke all on function public.pa_notify_owner(uuid, text, text, text, text, text, text, timestamptz, boolean) from public, anon, authenticated;

-- Notifikasi otomatis dari log audit: kafe baru & tagihan lunas (semua jalur: admin, Midtrans)
create or replace function public.pa_audit_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cafe text := (select c.name from public.cafes c where c.id = new.cafe_id);
begin
  if new.action = 'cafe.create' then
    perform public.pa_notify_admin('cafe_created', 'success', 'Kafe baru: ' || coalesce(v_cafe, '-'),
      'Owner ' || coalesce(new.after ->> 'owner_name', '-') || ' · paket ' || coalesce(new.after ->> 'plan', '-'),
      new.cafe_id, '/kafe/' || new.cafe_id, 'cafe_created:' || new.cafe_id);
  elsif new.action = 'invoice.paid' then
    perform public.pa_notify_admin('invoice_paid', 'success', 'Tagihan lunas: ' || coalesce(v_cafe, '-'),
      'Rp ' || replace(to_char(coalesce((new.after ->> 'amount')::numeric, 0), 'FM999,999,999,999'), ',', '.') || ' via '
        || case new.after ->> 'method' when 'gateway' then 'Midtrans' else 'transfer' end,
      new.cafe_id, '/tagihan?status=paid', 'invoice_paid:' || new.entity_id);
    -- Banner tagihan di sisi owner selesai
    update public.cafe_notifications set expires_at = now()
    where dedupe_key in ('invoice_due_7:' || new.entity_id, 'invoice_due_1:' || new.entity_id, 'invoice_overdue:' || new.entity_id)
      and (expires_at is null or expires_at > now());
  elsif new.action = 'invoice.void' then
    update public.cafe_notifications set expires_at = now()
    where dedupe_key in ('invoice_due_7:' || new.entity_id, 'invoice_due_1:' || new.entity_id, 'invoice_overdue:' || new.entity_id)
      and (expires_at is null or expires_at > now());
  elsif new.action in ('invoice.underpaid', 'invoice.paid_after_void') then
    perform public.pa_notify_admin('payment_failed', 'danger', 'Pembayaran bermasalah: ' || coalesce(v_cafe, '-'),
      coalesce(new.note, 'Periksa tagihan ini'), new.cafe_id, '/tagihan', 'payment_failed:audit:' || new.id);
  end if;
  return null;
end;
$$;
revoke all on function public.pa_audit_notify() from public, anon, authenticated;
drop trigger if exists pa_audit_notify on public.platform_audit_logs;
create trigger pa_audit_notify after insert on public.platform_audit_logs for each row execute function public.pa_audit_notify();

-- ---------------------------------------------------------------------
-- C. "Perlu tindakan" (dipakai dashboard & pengecekan harian)
-- ---------------------------------------------------------------------
-- Internal: semua item, tanpa cek admin. rank kecil = paling mendesak.
create or replace function public.pa_action_rows()
returns table (
  rank integer, kind text, cafe_id uuid, cafe_name text, owner_name text, owner_whatsapp text,
  reason text, ref_id text, amount numeric, due_at timestamptz, happened_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  -- 1. Tagihan telat bayar
  return query
  select 1, 'invoice_overdue', i.cafe_id, c.name, o.full_name, c.owner_whatsapp,
         'Tagihan ' || i.number || ' telat ' || greatest(1, extract(day from now() - i.due_at)::integer) || ' hari',
         i.id::text, i.amount, i.due_at, i.due_at
  from public.subscription_invoices i
  join public.cafes c on c.id = i.cafe_id
  left join lateral (select pr.full_name from public.profiles pr where pr.cafe_id = c.id and pr.role::text = 'owner' order by pr.created_at limit 1) o on true
  where i.status = 'pending' and i.due_at < now();

  -- 2. Webhook / pembayaran gagal (7 hari terakhir)
  if to_regclass('public.payment_events') is not null then
    return query execute $q$
      select 2, 'payment_failed', e.cafe_id, c.name, o.full_name, c.owner_whatsapp,
             'Pembayaran QRIS: ' || case e.result when 'bad_signature' then 'tanda tangan webhook tidak valid'
                                                  when 'unknown_order' then 'order tidak dikenal'
                                                  else 'status ' || coalesce(e.transaction_status, '-') end,
             'pe:' || e.id, null::numeric, null::timestamptz, e.created_at
      from public.payment_events e
      join public.cafes c on c.id = e.cafe_id
      left join lateral (select pr.full_name from public.profiles pr where pr.cafe_id = c.id and pr.role::text = 'owner' order by pr.created_at limit 1) o on true
      where e.created_at > now() - interval '7 days'
        and (e.result in ('bad_signature', 'unknown_order') or e.signature_valid is false or e.transaction_status in ('deny', 'failure'))
    $q$;
  end if;
  return query
  select 2, 'payment_failed', l.cafe_id, c.name, o.full_name, c.owner_whatsapp,
         'Langganan: ' || case l.action when 'invoice.underpaid' then 'nominal pembayaran kurang' else 'dibayar setelah tagihan dibatalkan' end,
         'audit:' || l.id, null::numeric, null::timestamptz, l.created_at
  from public.platform_audit_logs l
  join public.cafes c on c.id = l.cafe_id
  left join lateral (select pr.full_name from public.profiles pr where pr.cafe_id = c.id and pr.role::text = 'owner' order by pr.created_at limit 1) o on true
  where l.action in ('invoice.underpaid', 'invoice.paid_after_void') and l.created_at > now() - interval '7 days';

  -- 3. Masa coba habis ≤ 3 hari
  return query
  select 3, 'trial_ending', c.id, c.name, o.full_name, c.owner_whatsapp,
         'Masa coba habis ' || case when s.trial_ends_at < now() + interval '1 day' then 'hari ini' else 'dalam ' || ceil(extract(epoch from s.trial_ends_at - now()) / 86400)::integer || ' hari' end,
         c.id::text || ':' || to_char(s.trial_ends_at, 'YYYYMMDD'), null::numeric, s.trial_ends_at, s.trial_ends_at
  from public.cafe_subscriptions s
  join public.cafes c on c.id = s.cafe_id
  left join lateral (select pr.full_name from public.profiles pr where pr.cafe_id = c.id and pr.role::text = 'owner' order by pr.created_at limit 1) o on true
  where s.status = 'trialing' and c.suspended_at is null
    and s.trial_ends_at > now() and s.trial_ends_at <= now() + interval '3 days';

  -- 4. Kafe aktif tanpa pesanan 7 hari (kafe terdaftar > 7 hari)
  return query
  select 4, 'idle_cafe', r.cafe_id, r.name, r.owner_name, c.owner_whatsapp,
         case when lo.last_at is null then 'Belum pernah menerima pesanan' else 'Tanpa pesanan sejak ' || to_char(lo.last_at at time zone 'Asia/Jakarta', 'DD/MM') end,
         r.cafe_id::text || ':' || to_char(coalesce(lo.last_at, r.created_at), 'YYYYMMDD'), null::numeric, null::timestamptz, coalesce(lo.last_at, r.created_at)
  from public.pa_cafe_rows() r
  join public.cafes c on c.id = r.cafe_id
  left join lateral (select max(o.created_at) last_at from public.orders o where o.cafe_id = r.cafe_id) lo on true
  where r.state in ('active', 'past_due', 'trial') and r.created_at < now() - interval '7 days'
    and (lo.last_at is null or lo.last_at < now() - interval '7 days');
end;
$$;
revoke all on function public.pa_action_rows() from public, anon, authenticated;

create or replace function public.pa_action_items(p_limit integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.pa_require();
  return (select coalesce(jsonb_agg(to_jsonb(x) order by x.rank, x.happened_at nulls last), '[]'::jsonb)
          from (select * from public.pa_action_rows() a order by a.rank, a.happened_at nulls last limit least(greatest(coalesce(p_limit, 50), 1), 200)) x);
end;
$$;

-- ---------------------------------------------------------------------
-- C. Ringkasan diperluas (menggantikan versi file 14; isi lama tetap ada)
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
      where r2.state in ('active', 'past_due', 'trial') group by 1) x),
    -- Kafe berjalan dengan paket tanpa harga (mis. Enterprise "Custom") & belum diberi harga kustom
    'unpriced', (select coalesce(jsonb_agg(jsonb_build_object('cafe_id', r3.cafe_id, 'name', r3.name, 'plan_name', r3.plan_name) order by r3.name), '[]'::jsonb)
                 from public.pa_cafe_rows() r3 join public.plans p on p.code = r3.plan_code
                 where r3.state in ('active', 'past_due') and p.price_monthly is null and r3.price_override is null)
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
    'invoice_count', (select count(*) from public.subscription_invoices),
    'history', (select coalesce(jsonb_agg(jsonb_build_object('month', s.month, 'mrr', s.mrr, 'paying', s.paying_cafes, 'trial', s.trial_cafes) order by s.month), '[]'::jsonb)
                from (select * from public.platform_mrr_snapshots order by month desc limit 12) s),
    -- Pendapatan diterima 12 bulan terakhir (dari tagihan lunas; langsung terisi tanpa menunggu snapshot)
    'revenue_history', (select jsonb_agg(jsonb_build_object('month', m.month, 'amount', coalesce(x.amount, 0)) order by m.month)
                        from (select ((public.pa_month_start(-g) at time zone 'Asia/Jakarta')::date) as month from generate_series(0, 11) g) m
                        left join (select (date_trunc('month', i.paid_at at time zone 'Asia/Jakarta'))::date as month, sum(i.amount) as amount
                                   from public.subscription_invoices i where i.status = 'paid' group by 1) x on x.month = m.month),
    'action_count', (select count(*) from public.pa_action_rows())
  );
end;
$$;

-- ---------------------------------------------------------------------
-- D. Notifikasi: baca & tandai
-- ---------------------------------------------------------------------
create or replace function public.pa_notifications_list(p_limit integer default 30, p_unread_only boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.pa_require();
  return jsonb_build_object(
    'unread', (select count(*) from public.platform_notifications n where n.read_at is null),
    'rows', (select coalesce(jsonb_agg(to_jsonb(x) order by x.id desc), '[]'::jsonb) from (
      select n.*, c.name as cafe_name from public.platform_notifications n left join public.cafes c on c.id = n.cafe_id
      where not coalesce(p_unread_only, false) or n.read_at is null
      order by n.id desc limit least(greatest(coalesce(p_limit, 30), 1), 100)) x)
  );
end;
$$;

-- p_ids null = tandai semua
create or replace function public.pa_notifications_mark_read(p_ids bigint[] default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  perform public.pa_require();
  update public.platform_notifications set read_at = now(), read_by = (select auth.uid())
  where read_at is null and (p_ids is null or id = any (p_ids));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.owner_notifications(p_cafe_id uuid)
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
  return (select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'kind', n.kind, 'severity', n.severity, 'title', n.title,
            'body', n.body, 'link', n.link, 'created_at', n.created_at) order by
            case n.severity when 'danger' then 0 when 'warning' then 1 else 2 end, n.id desc), '[]'::jsonb)
    from public.cafe_notifications n
    where n.cafe_id = p_cafe_id and n.read_at is null and (n.expires_at is null or n.expires_at > now()));
end;
$$;
revoke all on function public.owner_notifications(uuid) from public, anon;
grant execute on function public.owner_notifications(uuid) to authenticated;

create or replace function public.owner_notification_dismiss(p_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.cafe_notifications n set read_at = now()
  where n.id = p_id and n.read_at is null and public.pa_is_cafe_owner(n.cafe_id, (select auth.uid()));
  if not found then
    raise exception 'Notifikasi tidak ditemukan' using errcode = 'P0002';
  end if;
end;
$$;
revoke all on function public.owner_notification_dismiss(bigint) from public, anon;
grant execute on function public.owner_notification_dismiss(bigint) to authenticated;

-- Status email per kafe (detail kafe di dashboard platform)
create or replace function public.pa_cafe_outbox(p_cafe uuid, p_limit integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.pa_require();
  return (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'channel', o.channel, 'audience', o.audience, 'recipient', o.recipient,
            'kind', o.kind, 'subject', o.subject, 'status', o.status, 'error', o.error, 'attempts', o.attempts,
            'created_at', o.created_at, 'sent_at', o.sent_at) order by o.id desc), '[]'::jsonb)
    from (select * from public.notification_outbox x where x.cafe_id = p_cafe order by x.id desc limit least(greatest(coalesce(p_limit, 30), 1), 100)) o);
end;
$$;

-- ---------------------------------------------------------------------
-- G. Pengumuman
-- ---------------------------------------------------------------------
create or replace function public.pa_announce(p_title text, p_body text, p_cafe_ids uuid[] default null, p_send_email boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text := nullif(left(trim(coalesce(p_title, '')), 120), '');
  v_body text := nullif(left(trim(coalesce(p_body, '')), 2000), '');
  v_id uuid := gen_random_uuid();
  v_count integer := 0;
  r record;
begin
  perform public.pa_require();
  if v_title is null or v_body is null then
    raise exception 'Judul dan isi pengumuman wajib diisi' using errcode = 'P0001';
  end if;
  if p_cafe_ids is not null and cardinality(p_cafe_ids) = 0 then
    raise exception 'Pilih minimal satu kafe' using errcode = 'P0001';
  end if;
  for r in select c.id from public.cafes c where p_cafe_ids is null or c.id = any (p_cafe_ids) loop
    if public.pa_notify_owner(r.id, 'announcement', 'info', v_title, v_body, null, 'announcement:' || v_id || ':' || r.id,
                              now() + interval '30 days', coalesce(p_send_email, false)) then
      v_count := v_count + 1;
    end if;
  end loop;
  insert into public.platform_announcements (id, title, body, target_cafe_ids, send_email, recipients, created_by)
  values (v_id, v_title, v_body, p_cafe_ids, coalesce(p_send_email, false), v_count, (select auth.uid()));
  perform public.pa_log('announcement.create', case when cardinality(p_cafe_ids) = 1 then p_cafe_ids[1] end, 'announcement', v_id::text, null,
    jsonb_build_object('title', v_title, 'recipients', v_count, 'all_cafes', p_cafe_ids is null, 'send_email', coalesce(p_send_email, false)));
  return jsonb_build_object('id', v_id, 'recipients', v_count);
end;
$$;

create or replace function public.pa_announcements_list(p_limit integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.pa_require();
  return (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb) from (
    select a.*, u.email as created_by_email,
           (select count(*) from public.cafe_notifications n where n.dedupe_key like 'announcement:' || a.id || ':%' and n.read_at is not null) as read_count
    from public.platform_announcements a left join auth.users u on u.id = a.created_by
    order by a.created_at desc limit least(greatest(coalesce(p_limit, 30), 1), 100)) x);
end;
$$;

-- ---------------------------------------------------------------------
-- F. Pengecekan harian (pg_cron 08.00 WIB) — juga menjalankan penagihan otomatis file 14
-- ---------------------------------------------------------------------
create or replace function public.pa_daily_check()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_billing jsonb;
  v_admin integer := 0;
  v_owner integer := 0;
  v_amount text;
begin
  v_billing := public.pa_billing_run();

  -- Tagihan: H-7, H-1, telat (owner) + telat (admin)
  for r in
    select i.*, c.name as cafe_name from public.subscription_invoices i join public.cafes c on c.id = i.cafe_id
    where i.status = 'pending' and c.suspended_at is null
  loop
    v_amount := 'Rp ' || replace(to_char(r.amount, 'FM999,999,999,999'), ',', '.');
    if r.due_at < now() then
      if public.pa_notify_owner(r.cafe_id, 'invoice_overdue', 'danger', 'Tagihan langganan lewat jatuh tempo',
           'Tagihan ' || r.number || ' sebesar ' || v_amount || ' jatuh tempo ' || to_char(r.due_at at time zone 'Asia/Jakarta', 'DD/MM/YYYY')
           || '. Fitur paket tetap jalan 7 hari setelah masa berlaku habis.', '/settings/subscription', 'invoice_overdue:' || r.id) then
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

  -- Masa coba, kafe sepi, pembayaran gagal (sumber yang sama dengan "Perlu tindakan")
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
    end if;
  end loop;

  return jsonb_build_object('billing', v_billing, 'admin_notifications', v_admin, 'owner_notifications', v_owner, 'ran_at', now());
end;
$$;
revoke all on function public.pa_daily_check() from public, anon, authenticated;
grant execute on function public.pa_daily_check() to service_role;

-- ---------------------------------------------------------------------
-- Hak panggil fungsi dashboard (pa_require menolak non-admin / non-2FA)
-- ---------------------------------------------------------------------
do $$
declare
  v_sig text;
begin
  foreach v_sig in array array[
    'pa_overview()', 'pa_action_items(integer)', 'pa_settings_get()', 'pa_settings_update(jsonb)',
    'pa_cafe_set_owner_whatsapp(uuid, text)', 'pa_log_whatsapp(uuid, text, text)',
    'pa_notifications_list(integer, boolean)', 'pa_notifications_mark_read(bigint[])', 'pa_cafe_outbox(uuid, integer)',
    'pa_announce(text, text, uuid[], boolean)', 'pa_announcements_list(integer)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', v_sig);
    execute format('grant execute on function public.%s to authenticated', v_sig);
  end loop;
end;
$$;

-- Realtime untuk lonceng notifikasi admin (RLS tetap berlaku)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'platform_notifications') then
    execute 'alter publication supabase_realtime add table public.platform_notifications';
  end if;
end;
$$;

notify pgrst, 'reload schema';

commit;

-- Verifikasi: 6 baris (5 tabel + 1 trigger), dan baris "tanpa_rls" TIDAK boleh muncul
select 'table' as kind, table_name as name
from information_schema.tables
where table_schema = 'public' and table_name in ('platform_settings', 'platform_notifications', 'cafe_notifications', 'notification_outbox', 'platform_announcements')
union all
select 'trigger', tgname::text from pg_trigger where tgname = 'pa_audit_notify' and not tgisinternal
union all
select 'tanpa_rls', c.relname
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
order by 1, 2;

-- =====================================================================
-- JADWAL HARIAN (menggantikan jadwal file 14 — cukup SATU jadwal):
--   Dashboard → Database → Extensions → aktifkan "pg_cron", lalu:
--
-- select cron.unschedule('dailybrew-tagihan-harian') where exists (select 1 from cron.job where jobname = 'dailybrew-tagihan-harian');
-- select cron.schedule('dailybrew-harian', '0 1 * * *', $$select public.pa_daily_check()$$);   -- 01.00 UTC = 08.00 WIB
--
-- Nomor WA Dailybrew: isi dari dashboard platform → Pengaturan, atau:
-- update public.platform_settings set support_whatsapp = public.normalize_wa('0812xxxxxxx');
-- =====================================================================
