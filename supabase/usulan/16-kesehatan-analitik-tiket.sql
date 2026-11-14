-- =====================================================================
-- 16 · SKOR KESEHATAN KAFE, PROGRES SETUP, SINYAL UPGRADE, ANALITIK PENDAPATAN, LINIMASA, TIKET BANTUAN
-- ---------------------------------------------------------------------
-- Bergantung pada file 04–15 (terutama 14: pa_require/pa_log, 15: notifikasi & pa_daily_check).
--
-- Isi:
--   A. Skor kesehatan 0–100 per kafe, dihitung harian (cafe_health_daily, riwayat untuk grafik tren).
--        pesanan 14 hari vs 14 hari sebelumnya (35) · login owner terakhir (25) · modul dipakai (20) · riwayat bayar (20)
--        Sehat ≥ 75 · Pantau 50–74 · Berisiko < 50. Admin dapat notifikasi saat kafe baru masuk "Berisiko".
--   B. Progres setup 8 langkah, dibaca dari data yang sudah ada (+ penanda "pernah disimpan" untuk pajak & struk).
--   C. Sinyal upgrade di "Perlu tindakan": pemakaian ≥ 80% batas paket, atau sering terbentur fitur terkunci.
--   D. Analitik pendapatan: MRR per kafe per bulan (cafe_mrr_monthly) → pergerakan MRR, cohort retensi, ARPA, LTV, churn.
--   E. Linimasa per kafe + catatan internal admin (cafe_notes, tidak terlihat owner).
--   F. Tiket bantuan owner → admin (platform_tickets + platform_ticket_messages, lampiran gambar di bucket privat).
--   G. pa_daily_check() diperluas (tetap SATU jadwal pg_cron dari file 15).
--
-- Dampak ke data lama: TIDAK ada data yang diubah atau dihapus.
--   - Tabel baru: cafe_health_daily, cafe_setup_state, cafe_mrr_monthly, plan_block_events, cafe_notes,
--     platform_tickets, platform_ticket_messages. Bucket storage baru: support-attachments (privat).
--   - Kolom baru (kosong): cafe_settings.charges_reviewed_at, cafe_settings.receipt_reviewed_at.
--   - cafe_mrr_monthly diisi awal dari tagihan LUNAS yang sudah ada (bulan-bulan sebelum bulan ini).
--   - Fungsi lama yang diganti isinya: pa_action_rows (tambah sinyal upgrade), pa_daily_check (tambah hitung harian).
-- Satu transaksi. Aman dijalankan ulang.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- A. Tabel
-- ---------------------------------------------------------------------
create table if not exists public.cafe_health_daily (
  cafe_id uuid not null references public.cafes (id) on delete cascade,
  day date not null,
  score smallint not null check (score between 0 and 100),
  label text not null check (label in ('healthy', 'watch', 'risk')),
  components jsonb not null default '{}'::jsonb,
  reasons text[] not null default '{}',
  computed_at timestamptz not null default now(),
  primary key (cafe_id, day)
);
create index if not exists cafe_health_daily_day_idx on public.cafe_health_daily (day desc);

create table if not exists public.cafe_setup_state (
  cafe_id uuid primary key references public.cafes (id) on delete cascade,
  done_steps text[] not null default '{}',
  done_count smallint not null default 0,
  changed_at timestamptz not null default now(),
  checked_at timestamptz not null default now()
);

create table if not exists public.cafe_mrr_monthly (
  cafe_id uuid not null references public.cafes (id) on delete cascade,
  month date not null,
  mrr numeric(14, 2) not null default 0 check (mrr >= 0),
  plan_code text,
  source text not null default 'snapshot' check (source in ('snapshot', 'invoice')),
  updated_at timestamptz not null default now(),
  primary key (cafe_id, month)
);
create index if not exists cafe_mrr_monthly_month_idx on public.cafe_mrr_monthly (month);

create table if not exists public.plan_block_events (
  id bigint generated always as identity primary key,
  cafe_id uuid not null references public.cafes (id) on delete cascade,
  kind text not null check (kind in ('feature', 'limit')),
  detail text check (detail is null or char_length(detail) <= 80),
  user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists plan_block_events_cafe_idx on public.plan_block_events (cafe_id, created_at desc);

create table if not exists public.cafe_notes (
  id bigint generated always as identity primary key,
  cafe_id uuid not null references public.cafes (id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 2000),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists cafe_notes_cafe_idx on public.cafe_notes (cafe_id, created_at desc);

create sequence if not exists public.platform_ticket_seq;
create table if not exists public.platform_tickets (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  cafe_id uuid not null references public.cafes (id) on delete cascade,
  created_by uuid references auth.users (id) on delete set null,
  category text not null check (category in ('akun', 'tagihan', 'pesanan', 'menu', 'pembayaran', 'aplikasi', 'lainnya')),
  title text not null check (char_length(trim(title)) between 3 and 120),
  status text not null default 'new' check (status in ('new', 'in_progress', 'resolved')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  assigned_to uuid references auth.users (id) on delete set null,
  first_response_at timestamptz,
  resolved_at timestamptz,
  last_message_at timestamptz not null default now(),
  owner_unread boolean not null default false,
  admin_unread boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists platform_tickets_cafe_idx on public.platform_tickets (cafe_id, created_at desc);
create index if not exists platform_tickets_status_idx on public.platform_tickets (status, last_message_at desc);

create table if not exists public.platform_ticket_messages (
  id bigint generated always as identity primary key,
  ticket_id uuid not null references public.platform_tickets (id) on delete cascade,
  author_id uuid references auth.users (id) on delete set null,
  author_role text not null check (author_role in ('owner', 'admin')),
  body text not null check (char_length(trim(body)) between 1 and 4000),
  attachments text[] not null default '{}' check (cardinality(attachments) <= 3),
  created_at timestamptz not null default now()
);
create index if not exists platform_ticket_messages_ticket_idx on public.platform_ticket_messages (ticket_id, created_at);

-- Penanda "pernah disimpan" untuk langkah setup pajak & struk (owner boleh memilih tanpa pajak)
alter table public.cafe_settings add column if not exists charges_reviewed_at timestamptz;
alter table public.cafe_settings add column if not exists receipt_reviewed_at timestamptz;

create or replace function public.setup_mark_charges()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.charges_reviewed_at := now();
  return new;
end;
$$;
create or replace function public.setup_mark_receipt()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.receipt_reviewed_at := now();
  return new;
end;
$$;
revoke all on function public.setup_mark_charges() from public, anon, authenticated;
revoke all on function public.setup_mark_receipt() from public, anon, authenticated;
drop trigger if exists setup_mark_charges on public.cafe_settings;
create trigger setup_mark_charges before update of tax_enabled, tax_name, tax_rate, tax_inclusive, service_charge_enabled, service_charge_rate, service_charge_taxable
  on public.cafe_settings for each row execute function public.setup_mark_charges();
drop trigger if exists setup_mark_receipt on public.cafe_settings;
create trigger setup_mark_receipt before update of receipt_header, receipt_footer, receipt_show_logo, receipt_show_address, receipt_paper_mm
  on public.cafe_settings for each row execute function public.setup_mark_receipt();

-- RLS: semua tabel baru tertutup; baca hanya lewat policy di bawah atau fungsi
alter table public.cafe_health_daily enable row level security;
alter table public.cafe_setup_state enable row level security;
alter table public.cafe_mrr_monthly enable row level security;
alter table public.plan_block_events enable row level security;
alter table public.cafe_notes enable row level security;
alter table public.platform_tickets enable row level security;
alter table public.platform_ticket_messages enable row level security;
revoke all on public.cafe_health_daily, public.cafe_setup_state, public.cafe_mrr_monthly, public.plan_block_events, public.cafe_notes,
  public.platform_tickets, public.platform_ticket_messages from public, anon, authenticated;
revoke all on sequence public.platform_ticket_seq from public, anon, authenticated;

-- Tiket: owner hanya melihat tiket kafenya sendiri; admin platform (aal2) melihat semua. Tulis hanya lewat fungsi.
grant select on public.platform_tickets, public.platform_ticket_messages to authenticated;
drop policy if exists "Owners read own cafe tickets" on public.platform_tickets;
create policy "Owners read own cafe tickets" on public.platform_tickets for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.cafe_id = platform_tickets.cafe_id
                 and p.role::text = 'owner' and coalesce(p.is_active, true)));
drop policy if exists "Platform admins read tickets" on public.platform_tickets;
create policy "Platform admins read tickets" on public.platform_tickets for select to authenticated using (public.is_platform_admin());
drop policy if exists "Read messages of visible tickets" on public.platform_ticket_messages;
create policy "Read messages of visible tickets" on public.platform_ticket_messages for select to authenticated
  using (exists (select 1 from public.platform_tickets t where t.id = platform_ticket_messages.ticket_id));

-- ---------------------------------------------------------------------
-- B. Skor kesehatan
-- ---------------------------------------------------------------------
create or replace function public.pa_health_label(p_score integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_score >= 75 then 'healthy' when p_score >= 50 then 'watch' else 'risk' end
$$;

-- Hitung skor satu kafe (tanpa menyimpan). Komponen + alasan untuk ditampilkan.
create or replace function public.pa_health_score(p_cafe uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_last integer;
  v_prev integer;
  v_ratio numeric;
  v_orders integer;
  v_login_at timestamptz;
  v_login_days integer;
  v_login integer;
  v_modules text[] := '{}';
  v_module_score integer;
  v_invoices integer;
  v_overdue_days integer;
  v_late integer;
  v_pay integer;
  v_score integer;
  v_reasons text[] := '{}';
begin
  -- 1. Pesanan 14 hari terakhir vs 14 hari sebelumnya (maks 35)
  select count(*) filter (where o.created_at >= now() - interval '14 days'),
         count(*) filter (where o.created_at < now() - interval '14 days')
    into v_last, v_prev
  from public.orders o
  where o.cafe_id = p_cafe and o.created_at >= now() - interval '28 days' and o.order_status::text <> 'cancelled';
  if v_last = 0 and v_prev = 0 then
    v_orders := 0;
    v_reasons := array_append(v_reasons, ('Belum ada pesanan 28 hari terakhir')::text);
  elsif v_prev = 0 then
    v_orders := 35;
  else
    v_ratio := v_last::numeric / v_prev;
    v_orders := case when v_ratio >= 1 then 35 when v_ratio >= 0.8 then 28 when v_ratio >= 0.5 then 18 when v_ratio > 0 then 8 else 0 end;
    if v_last = 0 then
      v_reasons := array_append(v_reasons, ('Tidak ada pesanan 14 hari terakhir')::text);
    elsif v_ratio < 0.8 then
      v_reasons := array_append(v_reasons, (('Pesanan turun ' || round((1 - v_ratio) * 100) || '%'))::text);
    end if;
  end if;

  -- 2. Login owner terakhir (maks 25)
  select max(u.last_sign_in_at) into v_login_at
  from public.profiles pr join auth.users u on u.id = pr.id
  where pr.cafe_id = p_cafe and pr.role::text = 'owner' and coalesce(pr.is_active, true);
  v_login_days := case when v_login_at is null then null else floor(extract(epoch from now() - v_login_at) / 86400)::integer end;
  v_login := case when v_login_days is null then 0 when v_login_days <= 3 then 25 when v_login_days <= 7 then 20
                  when v_login_days <= 14 then 12 when v_login_days <= 30 then 5 else 0 end;
  if v_login_days is null then
    v_reasons := array_append(v_reasons, ('Owner belum pernah login')::text);
  elsif v_login_days > 7 then
    v_reasons := array_append(v_reasons, (('Owner terakhir login ' || v_login_days || ' hari lalu'))::text);
  end if;

  -- 3. Modul yang dipakai: POS, inventori, keuangan, app customer (5 per modul, maks 20)
  if exists (select 1 from public.orders o where o.cafe_id = p_cafe and o.source = 'pos' and o.created_at >= now() - interval '30 days') then
    v_modules := array_append(v_modules, ('pos')::text);
  end if;
  if exists (select 1 from public.ingredients i where i.cafe_id = p_cafe) then
    v_modules := array_append(v_modules, ('inventory')::text);
  end if;
  if exists (select 1 from public.cafe_settings s where s.cafe_id = p_cafe and s.accounting_go_live is not null) then
    v_modules := array_append(v_modules, ('finance')::text);
  end if;
  if exists (select 1 from public.orders o where o.cafe_id = p_cafe and o.source = 'app' and o.created_at >= now() - interval '30 days') then
    v_modules := array_append(v_modules, ('app')::text);
  end if;
  v_module_score := cardinality(v_modules) * 5;
  if cardinality(v_modules) <= 1 then
    v_reasons := array_append(v_reasons, (('Baru memakai ' || cardinality(v_modules) || ' dari 4 modul'))::text);
  end if;

  -- 4. Riwayat bayar langganan (maks 20). Belum pernah ditagih = netral (20).
  select count(*),
         max(case when i.status = 'pending' and i.due_at < now() then greatest(1, floor(extract(epoch from now() - i.due_at) / 86400))::integer end),
         count(*) filter (where i.status = 'paid' and i.paid_at > i.due_at + interval '1 day' and i.created_at > now() - interval '180 days')
    into v_invoices, v_overdue_days, v_late
  from public.subscription_invoices i
  where i.cafe_id = p_cafe and i.status <> 'void';
  v_pay := case when v_overdue_days is not null then 0 else greatest(0, 20 - 7 * v_late) end;
  if v_overdue_days is not null then
    v_reasons := array_append(v_reasons, (('Tagihan telat ' || v_overdue_days || ' hari'))::text);
  elsif v_late > 0 then
    v_reasons := array_append(v_reasons, ((v_late || ' kali bayar telat dalam 6 bulan'))::text);
  end if;

  v_score := v_orders + v_login + v_module_score + v_pay;
  return jsonb_build_object(
    'score', v_score,
    'label', public.pa_health_label(v_score),
    'reasons', to_jsonb(v_reasons),
    'components', jsonb_build_object(
      'orders', jsonb_build_object('score', v_orders, 'max', 35, 'last_14', v_last, 'prev_14', v_prev),
      'login', jsonb_build_object('score', v_login, 'max', 25, 'last_login_at', v_login_at, 'days', v_login_days),
      'modules', jsonb_build_object('score', v_module_score, 'max', 20, 'used', to_jsonb(v_modules)),
      'payment', jsonb_build_object('score', v_pay, 'max', 20, 'invoices', v_invoices, 'overdue_days', v_overdue_days, 'late_paid', v_late)
    )
  );
end;
$$;

-- ---------------------------------------------------------------------
-- C. Progres setup (8 langkah)
-- ---------------------------------------------------------------------
create or replace function public.pa_setup_steps(p_cafe uuid)
returns table (step_no integer, key text, label text, done boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with c as (select * from public.cafes where id = p_cafe),
  s as (select * from public.cafe_settings where cafe_id = p_cafe)
  select * from (values
    (1, 'identity', 'Identitas dan logo',
      exists (select 1 from c where c.logo_url is not null and nullif(trim(coalesce(c.address, '')), '') is not null)),
    (2, 'hours', 'Jam buka',
      exists (select 1 from c where c.opening_hours is not null and jsonb_typeof(c.opening_hours) = 'object' and c.opening_hours <> '{}'::jsonb)),
    (3, 'charges', 'Pajak',
      exists (select 1 from s where s.tax_enabled or s.service_charge_enabled or s.charges_reviewed_at is not null)),
    (4, 'menu', 'Kategori dan produk',
      exists (select 1 from public.categories k where k.cafe_id = p_cafe)
        and (select count(*) from public.products p where p.cafe_id = p_cafe) >= 3),
    (5, 'tables', 'Meja dan QR',
      exists (select 1 from public.cafe_tables t where t.cafe_id = p_cafe and t.is_active)),
    (6, 'staff', 'Staff',
      exists (select 1 from public.profiles p where p.cafe_id = p_cafe and p.role::text = 'staff' and coalesce(p.is_active, true))),
    (7, 'payment', 'Pembayaran (QRIS)',
      exists (select 1 from s where s.qris_image_url is not null or s.payment_gateway_enabled)),
    (8, 'receipt', 'Struk',
      exists (select 1 from s where s.receipt_header is not null or s.receipt_footer is not null or s.receipt_reviewed_at is not null))
  ) as v (step_no, key, label, done)
$$;

-- Simpan langkah yang sudah selesai per kafe; changed_at = kapan terakhir ada kemajuan (untuk "macet N hari")
create or replace function public.pa_setup_refresh()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_done text[];
  v_count integer := 0;
begin
  for r in select c.id, c.created_at from public.cafes c loop
    select coalesce(array_agg(s.key order by s.step_no) filter (where s.done), '{}') into v_done from public.pa_setup_steps(r.id) s;
    insert into public.cafe_setup_state as st (cafe_id, done_steps, done_count, changed_at, checked_at)
    values (r.id, v_done, cardinality(v_done), case when cardinality(v_done) = 0 then r.created_at else now() end, now())
    on conflict (cafe_id) do update
    set done_steps = excluded.done_steps,
        done_count = excluded.done_count,
        changed_at = case when st.done_steps is distinct from excluded.done_steps then now() else st.changed_at end,
        checked_at = now();
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- Ringkasan setup satu kafe: langkah, langkah macet, sudah berapa hari
create or replace function public.pa_setup_json(p_cafe uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_steps jsonb;
  v_done text[];
  v_stuck record;
  v_since timestamptz;
begin
  select jsonb_agg(jsonb_build_object('no', s.step_no, 'key', s.key, 'label', s.label, 'done', s.done) order by s.step_no),
         coalesce(array_agg(s.key order by s.step_no) filter (where s.done), '{}')
    into v_steps, v_done
  from public.pa_setup_steps(p_cafe) s;
  select s.key, s.label into v_stuck from public.pa_setup_steps(p_cafe) s where not s.done order by s.step_no limit 1;
  -- Kemajuan terakhir yang tercatat; bila data berubah sejak pengecekan terakhir, hitung dari sekarang
  select case when st.done_steps = v_done then st.changed_at else now() end into v_since
  from public.cafe_setup_state st where st.cafe_id = p_cafe;
  v_since := coalesce(v_since, (select c.created_at from public.cafes c where c.id = p_cafe));
  return jsonb_build_object(
    'done', cardinality(v_done),
    'total', 8,
    'steps', v_steps,
    'stuck_key', v_stuck.key,
    'stuck_step', v_stuck.label,
    'stuck_days', case when v_stuck.key is null then null else greatest(0, floor(extract(epoch from now() - v_since) / 86400))::integer end
  );
end;
$$;

-- ---------------------------------------------------------------------
-- D. MRR per kafe per bulan
-- ---------------------------------------------------------------------
create or replace function public.pa_snapshot_cafe_mrr()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_month date := (public.pa_month_start() at time zone 'Asia/Jakarta')::date;
  v_count integer;
begin
  with ins as (
    insert into public.cafe_mrr_monthly (cafe_id, month, mrr, plan_code, source, updated_at)
    select r.cafe_id, v_month, case when r.state in ('active', 'past_due') then r.monthly_price else 0 end, r.plan_code, 'snapshot', now()
    from public.pa_cafe_rows() r
    on conflict (cafe_id, month) do update
    set mrr = excluded.mrr, plan_code = excluded.plan_code, source = 'snapshot', updated_at = now()
    returning 1
  )
  select count(*) into v_count from ins;
  return v_count;
end;
$$;

-- Isi bulan-bulan lampau dari tagihan lunas (nominal dibagi rata per bulan). Tidak menimpa data yang sudah ada.
create or replace function public.pa_mrr_backfill()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current date := (public.pa_month_start() at time zone 'Asia/Jakarta')::date;
  v_count integer;
begin
  with months as (
    select i.cafe_id, i.plan_code,
           (date_trunc('month', i.period_start at time zone 'Asia/Jakarta') + make_interval(months => g))::date as month,
           i.amount / i.months as mrr
    from public.subscription_invoices i
    cross join lateral generate_series(0, i.months - 1) g
    where i.status = 'paid'
  ), summed as (
    select m.cafe_id, m.month, sum(m.mrr) as mrr, max(m.plan_code) as plan_code
    from months m where m.month < v_current
    group by m.cafe_id, m.month
  ), ins as (
    insert into public.cafe_mrr_monthly (cafe_id, month, mrr, plan_code, source)
    select s.cafe_id, s.month, round(s.mrr, 2), s.plan_code, 'invoice' from summed s
    on conflict (cafe_id, month) do nothing
    returning 1
  )
  select count(*) into v_count from ins;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------
-- E. Hitung harian (dipanggil pa_daily_check)
-- ---------------------------------------------------------------------
create or replace function public.pa_health_run()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v jsonb;
  v_day date := (now() at time zone 'Asia/Jakarta')::date;
  v_prev text;
  v_count integer := 0;
  v_new_risk integer := 0;
begin
  for r in
    select x.cafe_id, x.name from public.pa_cafe_rows() x where x.state in ('active', 'past_due', 'trial')
  loop
    v := public.pa_health_score(r.cafe_id);
    select h.label into v_prev from public.cafe_health_daily h where h.cafe_id = r.cafe_id and h.day < v_day order by h.day desc limit 1;
    insert into public.cafe_health_daily (cafe_id, day, score, label, components, reasons, computed_at)
    values (r.cafe_id, v_day, (v ->> 'score')::integer, v ->> 'label', v -> 'components',
            array(select jsonb_array_elements_text(v -> 'reasons')), now())
    on conflict (cafe_id, day) do update
    set score = excluded.score, label = excluded.label, components = excluded.components, reasons = excluded.reasons, computed_at = now();
    v_count := v_count + 1;
    if v ->> 'label' = 'risk' and v_prev is distinct from 'risk' then
      if public.pa_notify_admin('health_risk', 'warning', 'Kafe berisiko: ' || r.name,
           'Skor ' || (v ->> 'score') || '/100 · ' || coalesce(array_to_string(array(select jsonb_array_elements_text(v -> 'reasons') limit 2), ' · '), ''),
           r.cafe_id, '/kafe/' || r.cafe_id, 'health_risk:' || r.cafe_id || ':' || v_day) then
        v_new_risk := v_new_risk + 1;
      end if;
    end if;
  end loop;
  return jsonb_build_object('scored', v_count, 'new_risk', v_new_risk, 'setup_checked', public.pa_setup_refresh(),
                            'mrr_rows', public.pa_snapshot_cafe_mrr());
end;
$$;

-- ---------------------------------------------------------------------
-- F. Sinyal upgrade: owner terbentur batas / fitur paket (dicatat web owner, bukan oleh trigger yang gagal)
-- ---------------------------------------------------------------------
create or replace function public.owner_log_plan_block(p_cafe uuid, p_kind text, p_detail text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_detail text := nullif(left(trim(coalesce(p_detail, '')), 80), '');
begin
  if (select auth.uid()) is null or not public.is_cafe_member(p_cafe) then
    raise exception 'Hanya anggota kafe ini' using errcode = '42501';
  end if;
  if p_kind not in ('feature', 'limit') then
    raise exception 'Jenis tidak dikenal' using errcode = '22023';
  end if;
  -- Anti-spam: kejadian sama dalam 10 menit dihitung sekali
  if exists (select 1 from public.plan_block_events e where e.cafe_id = p_cafe and e.kind = p_kind
             and e.detail is not distinct from v_detail and e.created_at > now() - interval '10 minutes') then
    return;
  end if;
  insert into public.plan_block_events (cafe_id, kind, detail, user_id) values (p_cafe, p_kind, v_detail, (select auth.uid()));
end;
$$;

-- "Perlu tindakan" (menggantikan versi file 15; isi lama tetap, + jenis 5 upgrade_signal)
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

  -- 5. Sinyal upgrade: pemakaian ≥ 80% batas paket, atau ≥ 3 kali terbentur fitur/batas terkunci dalam 14 hari
  return query
  with candidates as (
    select r.cafe_id, r.name, r.owner_name, c.owner_whatsapp, r.plan_name, public.pa_cafe_usage(r.cafe_id) as usage
    from public.pa_cafe_rows() r join public.cafes c on c.id = r.cafe_id
    where r.state in ('active', 'past_due', 'trial')
  ), limits as (
    select k.cafe_id, k.key, k.label, (k.usage ->> k.key)::integer as used, public.cafe_limit(k.cafe_id, k.key) as cap
    from (select c.*, x.key, x.label from candidates c
          cross join (values ('staff', 'staff'), ('tables', 'meja'), ('products', 'produk')) as x (key, label)) k
  ), top_limit as (
    select distinct on (l.cafe_id) l.cafe_id, l.label, l.used, l.cap, round(l.used * 100.0 / l.cap) as pct
    from limits l
    where l.cap is not null and l.cap > 0 and l.used is not null and l.used * 100 >= l.cap * 80
    order by l.cafe_id, l.used::numeric / l.cap desc
  ), blocks as (
    select e.cafe_id, count(*) as hits, (array_agg(e.detail order by e.created_at desc) filter (where e.detail is not null))[1] as last_detail
    from public.plan_block_events e
    where e.created_at > now() - interval '14 days'
    group by e.cafe_id
    having count(*) >= 3
  )
  select 5, 'upgrade_signal', c.cafe_id, c.name, c.owner_name, c.owner_whatsapp,
         concat_ws(' · ',
           case when t.cafe_id is not null then 'Memakai ' || t.used || ' dari ' || t.cap || ' ' || t.label || ' (' || t.pct || '%)' end,
           case when b.cafe_id is not null then 'Terbentur fitur paket ' || b.hits || '× dalam 14 hari' || coalesce(' (' || b.last_detail || ')', '') end
         ),
         c.cafe_id::text || ':' || to_char(now() at time zone 'Asia/Jakarta', 'IYYY-IW'), null::numeric, null::timestamptz, now()
  from candidates c
  left join top_limit t on t.cafe_id = c.cafe_id
  left join blocks b on b.cafe_id = c.cafe_id
  where t.cafe_id is not null or b.cafe_id is not null;
end;
$$;
revoke all on function public.pa_action_rows() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- G. Baca: kesehatan & setup (admin)
-- ---------------------------------------------------------------------
create or replace function public.pa_health_latest()
returns table (cafe_id uuid, day date, score smallint, label text, reasons text[], components jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct on (h.cafe_id) h.cafe_id, h.day, h.score, h.label, h.reasons, h.components
  from public.cafe_health_daily h
  where h.day >= (now() at time zone 'Asia/Jakarta')::date - 7
  order by h.cafe_id, h.day desc
$$;

create or replace function public.pa_health_overview(p_limit integer default 5)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.pa_require();
  return jsonb_build_object(
    'counts', (select jsonb_build_object(
                 'healthy', count(*) filter (where l.label = 'healthy'),
                 'watch', count(*) filter (where l.label = 'watch'),
                 'risk', count(*) filter (where l.label = 'risk'))
               from public.pa_health_latest() l join public.pa_cafe_rows() r on r.cafe_id = l.cafe_id
               where r.state in ('active', 'past_due', 'trial')),
    'computed_at', (select max(h.computed_at) from public.cafe_health_daily h),
    'rows', (select coalesce(jsonb_agg(x order by x.score, x.cafe_name), '[]'::jsonb) from (
               select l.cafe_id, r.name as cafe_name, l.score, l.label, l.day,
                      array_to_string(l.reasons[1:2], ' · ') as reason, r.owner_name, c.owner_whatsapp
               from public.pa_health_latest() l
               join public.pa_cafe_rows() r on r.cafe_id = l.cafe_id
               join public.cafes c on c.id = l.cafe_id
               where r.state in ('active', 'past_due', 'trial') and l.label <> 'healthy'
               order by l.score, r.name
               limit least(greatest(coalesce(p_limit, 5), 1), 100)) x)
  );
end;
$$;

-- Skor terakhir semua kafe (untuk kolom di daftar kafe): { "<cafe_id>": { score, label, day } }
create or replace function public.pa_health_map()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.pa_require();
  return (select coalesce(jsonb_object_agg(l.cafe_id, jsonb_build_object('score', l.score, 'label', l.label, 'day', l.day)), '{}'::jsonb)
          from public.pa_health_latest() l);
end;
$$;

create or replace function public.pa_cafe_health(p_cafe uuid, p_days integer default 90)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_latest record;
begin
  perform public.pa_require();
  select * into v_latest from public.cafe_health_daily h where h.cafe_id = p_cafe order by h.day desc limit 1;
  return jsonb_build_object(
    'latest', case when v_latest.cafe_id is null then null else jsonb_build_object(
                'day', v_latest.day, 'score', v_latest.score, 'label', v_latest.label,
                'reasons', to_jsonb(v_latest.reasons), 'components', v_latest.components, 'computed_at', v_latest.computed_at) end,
    'history', (select coalesce(jsonb_agg(jsonb_build_object('day', h.day, 'score', h.score, 'label', h.label) order by h.day), '[]'::jsonb)
                from public.cafe_health_daily h
                where h.cafe_id = p_cafe and h.day > (now() at time zone 'Asia/Jakarta')::date - least(greatest(coalesce(p_days, 90), 7), 365)),
    'setup', public.pa_setup_json(p_cafe)
  );
end;
$$;

-- Kafe masa coba yang belum selesai setup, paling lama macet di atas
create or replace function public.pa_setup_progress(p_limit integer default 5)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.pa_require();
  return (select coalesce(jsonb_agg(top.x order by top.ord), '[]'::jsonb) from (
    select s.x, row_number() over (order by (s.x ->> 'stuck_days')::integer desc nulls last, s.x ->> 'cafe_name') as ord
    from (
      select jsonb_build_object('cafe_id', r.cafe_id, 'cafe_name', r.name, 'owner_name', r.owner_name, 'owner_whatsapp', c.owner_whatsapp,
                                'trial_ends_at', r.trial_ends_at) || public.pa_setup_json(r.cafe_id) as x
      from public.pa_cafe_rows() r join public.cafes c on c.id = r.cafe_id
      where r.state = 'trial'
    ) s
    where (s.x ->> 'done')::integer < 8
    order by ord
    limit least(greatest(coalesce(p_limit, 5), 1), 100)
  ) top);
end;
$$;

-- ---------------------------------------------------------------------
-- H. Analitik pendapatan (admin). Semua angka dihitung di sini; UI hanya menampilkan.
-- ---------------------------------------------------------------------
create or replace function public.pa_analytics_mrr(p_months integer default 12)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_n integer := least(greatest(coalesce(p_months, 12), 2), 36);
  v_current date := (public.pa_month_start() at time zone 'Asia/Jakarta')::date;
begin
  perform public.pa_require();
  return (
    with months as (
      select (v_current - make_interval(months => g))::date as m from generate_series(0, v_n - 1) g
    ), pairs as (
      select mo.m, k.cafe_id,
             coalesce((select x.mrr from public.cafe_mrr_monthly x where x.cafe_id = k.cafe_id and x.month = mo.m), 0) as cur,
             coalesce((select x.mrr from public.cafe_mrr_monthly x where x.cafe_id = k.cafe_id and x.month = (mo.m - interval '1 month')::date), 0) as prev
      from months mo
      join lateral (select distinct x.cafe_id from public.cafe_mrr_monthly x
                    where x.month in (mo.m, (mo.m - interval '1 month')::date)) k on true
    ), moves as (
      select mo.m,
             coalesce(sum(p.prev), 0) as start_mrr,
             coalesce(sum(p.cur) filter (where p.prev = 0 and p.cur > 0), 0) as new_mrr,
             coalesce(sum(p.cur - p.prev) filter (where p.prev > 0 and p.cur > p.prev), 0) as expansion,
             coalesce(sum(p.cur - p.prev) filter (where p.prev > 0 and p.cur > 0 and p.cur < p.prev), 0) as contraction,
             coalesce(sum(-p.prev) filter (where p.prev > 0 and p.cur = 0), 0) as churn,
             coalesce(sum(p.cur), 0) as end_mrr,
             count(*) filter (where p.prev = 0 and p.cur > 0) as new_cafes,
             count(*) filter (where p.prev > 0 and p.cur = 0) as churned_cafes,
             exists (select 1 from public.cafe_mrr_monthly x where x.month = mo.m) as has_data
      from months mo left join pairs p on p.m = mo.m
      group by mo.m
    )
    select jsonb_build_object(
      'months', coalesce(jsonb_agg(jsonb_build_object(
                  'month', mv.m, 'start_mrr', mv.start_mrr, 'new', mv.new_mrr, 'expansion', mv.expansion,
                  'contraction', mv.contraction, 'churn', mv.churn, 'end_mrr', mv.end_mrr,
                  'new_cafes', mv.new_cafes, 'churned_cafes', mv.churned_cafes, 'has_data', mv.has_data) order by mv.m), '[]'::jsonb),
      'months_with_data', count(*) filter (where mv.has_data),
      'enough', count(*) filter (where mv.has_data) >= 2
    )
    from moves mv
  );
end;
$$;

create or replace function public.pa_analytics_cohort(p_months integer default 12)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_n integer := least(greatest(coalesce(p_months, 12), 2), 36);
  v_current date := (public.pa_month_start() at time zone 'Asia/Jakarta')::date;
begin
  perform public.pa_require();
  return (
    with firsts as (
      select x.cafe_id, min(x.month) as cohort from public.cafe_mrr_monthly x where x.mrr > 0 group by x.cafe_id
    ), cohorts as (
      select f.cohort, count(*) as size from firsts f
      where f.cohort > (v_current - make_interval(months => v_n))::date
      group by f.cohort
    ), cells as (
      select co.cohort, g as offset_months,
             (select count(*) from firsts f join public.cafe_mrr_monthly x on x.cafe_id = f.cafe_id
              where f.cohort = co.cohort and x.month = (co.cohort + make_interval(months => g))::date and x.mrr > 0) as retained
      from cohorts co
      cross join lateral generate_series(0, ((extract(year from age(v_current, co.cohort)) * 12 + extract(month from age(v_current, co.cohort)))::integer)) g
    )
    select jsonb_build_object(
      'cohorts', coalesce((select jsonb_agg(jsonb_build_object(
                    'month', co.cohort, 'size', co.size,
                    'cells', (select jsonb_agg(jsonb_build_object('offset', c.offset_months, 'retained', c.retained,
                                                                  'pct', round(c.retained * 100.0 / co.size)) order by c.offset_months)
                              from cells c where c.cohort = co.cohort)) order by co.cohort)
                  from cohorts co), '[]'::jsonb),
      'enough', (select count(*) from cohorts co where co.cohort < v_current) >= 1
    )
  );
end;
$$;

create or replace function public.pa_analytics_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_current date := (public.pa_month_start() at time zone 'Asia/Jakarta')::date;
  v_mrr numeric;
  v_paying integer;
  v_arpa numeric;
  v_churn numeric;
  v_churn_months integer;
  v_months integer;
begin
  perform public.pa_require();
  select coalesce(sum(x.mrr), 0), count(*) filter (where x.mrr > 0) into v_mrr, v_paying
  from public.cafe_mrr_monthly x where x.month = v_current;
  v_arpa := case when v_paying > 0 then round(v_mrr / v_paying, 2) end;
  select count(distinct x.month) into v_months from public.cafe_mrr_monthly x where x.month < v_current;

  -- Tingkat berhenti bulanan = rata-rata (kafe berhenti / kafe berbayar di awal bulan), 3 bulan penuh terakhir
  with m as (
    select (v_current - make_interval(months => g))::date as month from generate_series(1, 3) g
  ), r as (
    select m.month,
           (select count(*) from public.cafe_mrr_monthly p where p.month = (m.month - interval '1 month')::date and p.mrr > 0) as start_paying,
           (select count(*) from public.cafe_mrr_monthly p
             where p.month = (m.month - interval '1 month')::date and p.mrr > 0
               and coalesce((select q.mrr from public.cafe_mrr_monthly q where q.cafe_id = p.cafe_id and q.month = m.month), 0) = 0) as churned
    from m
  )
  select round(avg(r.churned::numeric / r.start_paying), 4), count(*) into v_churn, v_churn_months
  from r where r.start_paying > 0;

  return jsonb_build_object(
    'mrr', v_mrr,
    'paying', v_paying,
    'arpa', v_arpa,
    'churn_rate', v_churn,
    'churn_months', v_churn_months,
    'ltv', case when v_churn > 0 and v_arpa is not null then round(v_arpa / v_churn, 0) end,
    'ltv_note', case when v_churn_months = 0 or v_churn is null then 'Butuh minimal 1 bulan penuh dengan kafe berbayar'
                     when v_churn = 0 then 'Belum ada kafe yang berhenti, jadi nilai seumur hidup belum bisa diperkirakan' end,
    'months_with_data', v_months,
    'enough', v_months >= 3
  );
end;
$$;

-- ---------------------------------------------------------------------
-- I. Linimasa & catatan internal (admin)
-- ---------------------------------------------------------------------
create or replace function public.pa_cafe_note_add(p_cafe uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_body text := trim(coalesce(p_body, ''));
  v public.cafe_notes;
begin
  perform public.pa_require();
  if not exists (select 1 from public.cafes c where c.id = p_cafe) then
    raise exception 'Kafe tidak ditemukan' using errcode = 'P0002';
  end if;
  if char_length(v_body) not between 1 and 2000 then
    raise exception 'Catatan 1–2000 karakter' using errcode = '22023';
  end if;
  insert into public.cafe_notes (cafe_id, body, created_by) values (p_cafe, v_body, (select auth.uid())) returning * into v;
  perform public.pa_log('cafe.note', p_cafe, 'cafe_note', v.id::text, null, jsonb_build_object('body', left(v_body, 300)));
  return to_jsonb(v);
end;
$$;

create or replace function public.pa_cafe_timeline(p_cafe uuid, p_limit integer default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.pa_require();
  return (select coalesce(jsonb_agg(t order by t.at desc), '[]'::jsonb) from (
    select x.* from (
      select c.created_at as at, 'signup' as kind, null::text as action, 'Kafe terdaftar' as title,
             null::jsonb as detail, null::text as actor
      from public.cafes c where c.id = p_cafe
      union all
      select l.created_at,
             case when l.action like 'subscription.%' then 'plan'
                  when l.action = 'invoice.paid' then 'payment'
                  when l.action like 'invoice.%' then 'invoice'
                  when l.action like 'whatsapp.%' then 'whatsapp'
                  when l.action = 'cafe.note' then 'note'
                  when l.action like 'ticket.%' then 'ticket'
                  else 'admin' end,
             l.action, null, jsonb_build_object('before', l.before, 'after', l.after, 'note', l.note), l.actor_label
      from public.platform_audit_logs l
      where l.cafe_id = p_cafe and l.action <> 'cafe.note'
      union all
      select n.created_at, 'note', 'cafe.note', null, jsonb_build_object('id', n.id, 'body', n.body),
             coalesce(a.full_name, u.email)
      from public.cafe_notes n
      left join public.platform_admins a on a.user_id = n.created_by
      left join auth.users u on u.id = n.created_by
      where n.cafe_id = p_cafe
      union all
      select h.computed_at, 'health', null, null,
             jsonb_build_object('score', h.score, 'label', h.label, 'prev_label', h.prev_label, 'reasons', to_jsonb(h.reasons)), null
      from (select d.*, lag(d.label) over (order by d.day) as prev_label from public.cafe_health_daily d where d.cafe_id = p_cafe) h
      where h.prev_label is not null and h.prev_label <> h.label
      union all
      select k.created_at, 'ticket', null, k.title, jsonb_build_object('id', k.id, 'number', k.number, 'status', k.status, 'category', k.category), null
      from public.platform_tickets k where k.cafe_id = p_cafe
    ) x
    order by x.at desc
    limit least(greatest(coalesce(p_limit, 100), 1), 500)
  ) t);
end;
$$;

-- ---------------------------------------------------------------------
-- J. Tiket bantuan
-- ---------------------------------------------------------------------
-- Lampiran: path di bucket support-attachments, wajib di folder <cafe_id>/, maks 3
create or replace function public.ticket_check_attachments(p_cafe uuid, p_paths text[])
returns text[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_path text;
begin
  if p_paths is null then
    return '{}';
  end if;
  if cardinality(p_paths) > 3 then
    raise exception 'Maksimal 3 lampiran' using errcode = '22023';
  end if;
  foreach v_path in array p_paths loop
    if v_path is null or char_length(v_path) > 300 or v_path not like p_cafe::text || '/%' or position('..' in v_path) > 0 then
      raise exception 'Lampiran tidak valid' using errcode = '22023';
    end if;
  end loop;
  return p_paths;
end;
$$;

create or replace function public.ticket_json(p public.platform_tickets)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select to_jsonb(p) || jsonb_build_object(
    'cafe_name', (select c.name from public.cafes c where c.id = p.cafe_id),
    'assigned_name', (select a.full_name from public.platform_admins a where a.user_id = p.assigned_to),
    'message_count', (select count(*) from public.platform_ticket_messages m where m.ticket_id = p.id),
    'last_message', (select left(m.body, 160) from public.platform_ticket_messages m where m.ticket_id = p.id order by m.created_at desc limit 1)
  )
$$;

create or replace function public.ticket_messages_json(p_ticket uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id, 'author_role', m.author_role, 'body', m.body, 'attachments', to_jsonb(m.attachments), 'created_at', m.created_at,
    'author_name', case when m.author_role = 'admin' then coalesce(a.full_name, 'Tim Dailybrew') else coalesce(pr.full_name, 'Owner') end
  ) order by m.created_at), '[]'::jsonb)
  from public.platform_ticket_messages m
  left join public.platform_admins a on a.user_id = m.author_id
  left join public.profiles pr on pr.id = m.author_id
  where m.ticket_id = p_ticket
$$;

-- Owner: buat tiket
create or replace function public.owner_ticket_create(
  p_cafe uuid, p_category text, p_title text, p_body text, p_attachments text[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v public.platform_tickets;
  v_cafe_name text;
begin
  if v_uid is null or not public.pa_is_cafe_owner(p_cafe, v_uid) then
    raise exception 'Hanya owner kafe ini yang bisa membuat tiket' using errcode = '42501';
  end if;
  if (select count(*) from public.platform_tickets t where t.cafe_id = p_cafe and t.created_at > now() - interval '1 day') >= 10 then
    raise exception 'Batas 10 tiket per hari tercapai. Balas tiket yang sudah ada.' using errcode = 'P0001';
  end if;
  if p_category is null or p_category not in ('akun', 'tagihan', 'pesanan', 'menu', 'pembayaran', 'aplikasi', 'lainnya') then
    raise exception 'Pilih kategori tiket' using errcode = '22023';
  end if;
  if char_length(trim(coalesce(p_title, ''))) not between 3 and 120 then
    raise exception 'Judul tiket 3–120 karakter' using errcode = '22023';
  end if;
  if char_length(trim(coalesce(p_body, ''))) not between 1 and 4000 then
    raise exception 'Isi tiket 1–4000 karakter' using errcode = '22023';
  end if;
  select c.name into v_cafe_name from public.cafes c where c.id = p_cafe;
  insert into public.platform_tickets (number, cafe_id, created_by, category, title)
  values ('TKT-' || lpad(nextval('public.platform_ticket_seq')::text, 5, '0'), p_cafe, v_uid, p_category, trim(coalesce(p_title, '')))
  returning * into v;
  insert into public.platform_ticket_messages (ticket_id, author_id, author_role, body, attachments)
  values (v.id, v_uid, 'owner', trim(p_body), public.ticket_check_attachments(p_cafe, p_attachments));
  perform public.pa_notify_admin('ticket_new', 'info', 'Tiket baru: ' || v_cafe_name, v.number || ' · ' || v.title,
                                 p_cafe, '/tiket/' || v.id, 'ticket_new:' || v.id);
  return public.ticket_json(v) - 'assigned_to' - 'admin_unread';
end;
$$;

-- Owner: balas tiket (tiket selesai terbuka lagi)
create or replace function public.owner_ticket_reply(p_ticket uuid, p_body text, p_attachments text[] default '{}')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v public.platform_tickets;
  v_msg bigint;
begin
  select * into v from public.platform_tickets t where t.id = p_ticket for update;
  if not found or v_uid is null or not public.pa_is_cafe_owner(v.cafe_id, v_uid) then
    raise exception 'Tiket tidak ditemukan' using errcode = 'P0002';
  end if;
  if char_length(trim(coalesce(p_body, ''))) not between 1 and 4000 then
    raise exception 'Balasan 1–4000 karakter' using errcode = '22023';
  end if;
  insert into public.platform_ticket_messages (ticket_id, author_id, author_role, body, attachments)
  values (v.id, v_uid, 'owner', trim(p_body), public.ticket_check_attachments(v.cafe_id, p_attachments))
  returning id into v_msg;
  update public.platform_tickets
  set last_message_at = now(), admin_unread = true, owner_unread = false, updated_at = now(),
      status = case when status = 'resolved' then 'in_progress' else status end,
      resolved_at = case when status = 'resolved' then null else resolved_at end
  where id = v.id
  returning * into v;
  perform public.pa_notify_admin('ticket_reply', 'info', 'Balasan owner: ' || v.number, left(trim(p_body), 140),
                                 v.cafe_id, '/tiket/' || v.id, 'ticket_reply:' || v_msg);
  return public.ticket_json(v) - 'assigned_to' - 'admin_unread';
end;
$$;

create or replace function public.owner_tickets(p_cafe uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not public.pa_is_cafe_owner(p_cafe, (select auth.uid())) then
    raise exception 'Hanya owner kafe ini' using errcode = '42501';
  end if;
  return (select coalesce(jsonb_agg(public.ticket_json(t) - 'assigned_to' - 'admin_unread' order by t.last_message_at desc), '[]'::jsonb)
          from public.platform_tickets t where t.cafe_id = p_cafe);
end;
$$;

-- Owner: buka tiket (sekaligus tandai sudah dibaca)
create or replace function public.owner_ticket_detail(p_ticket uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.platform_tickets;
begin
  select * into v from public.platform_tickets t where t.id = p_ticket;
  if not found or (select auth.uid()) is null or not public.pa_is_cafe_owner(v.cafe_id, (select auth.uid())) then
    raise exception 'Tiket tidak ditemukan' using errcode = 'P0002';
  end if;
  if v.owner_unread then
    update public.platform_tickets set owner_unread = false where id = v.id returning * into v;
  end if;
  return jsonb_build_object('ticket', public.ticket_json(v) - 'assigned_to' - 'admin_unread', 'messages', public.ticket_messages_json(v.id));
end;
$$;

-- Admin: kotak masuk
create or replace function public.pa_tickets_list(p_status text default null, p_search text default null, p_limit integer default 50, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_search text := nullif(trim(coalesce(p_search, '')), '');
begin
  perform public.pa_require();
  return jsonb_build_object(
    'counts', (select jsonb_build_object(
                 'new', count(*) filter (where t.status = 'new'),
                 'in_progress', count(*) filter (where t.status = 'in_progress'),
                 'resolved', count(*) filter (where t.status = 'resolved'),
                 'unread', count(*) filter (where t.admin_unread and t.status <> 'resolved'))
               from public.platform_tickets t),
    -- Rata-rata waktu respons pertama 30 hari terakhir (menit)
    'avg_first_response_minutes', (select round(avg(extract(epoch from t.first_response_at - t.created_at) / 60))
                                   from public.platform_tickets t
                                   where t.first_response_at is not null and t.created_at > now() - interval '30 days'),
    'total', (select count(*) from public.platform_tickets t join public.cafes c on c.id = t.cafe_id
              where (p_status is null or t.status = p_status)
                and (v_search is null or t.title ilike '%' || public.pa_like(v_search) || '%' or t.number ilike '%' || public.pa_like(v_search) || '%'
                     or c.name ilike '%' || public.pa_like(v_search) || '%')),
    'rows', (select coalesce(jsonb_agg(public.ticket_json(x.t) order by x.ord), '[]'::jsonb) from (
               select t, row_number() over (
                 order by case t.status when 'new' then 0 when 'in_progress' then 1 else 2 end,
                          case t.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end,
                          t.last_message_at desc) as ord
               from public.platform_tickets t join public.cafes c on c.id = t.cafe_id
               where (p_status is null or t.status = p_status)
                 and (v_search is null or t.title ilike '%' || public.pa_like(v_search) || '%' or t.number ilike '%' || public.pa_like(v_search) || '%'
                      or c.name ilike '%' || public.pa_like(v_search) || '%')
               order by ord
               limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0)) x)
  );
end;
$$;

create or replace function public.pa_ticket_detail(p_ticket uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.platform_tickets;
begin
  perform public.pa_require();
  select * into v from public.platform_tickets t where t.id = p_ticket;
  if not found then
    raise exception 'Tiket tidak ditemukan' using errcode = 'P0002';
  end if;
  if v.admin_unread then
    update public.platform_tickets set admin_unread = false where id = v.id returning * into v;
  end if;
  return jsonb_build_object(
    'ticket', public.ticket_json(v),
    'messages', public.ticket_messages_json(v.id),
    'cafe', (select jsonb_build_object('id', r.cafe_id, 'name', r.name, 'owner_name', r.owner_name, 'owner_email', r.owner_email,
                                       'owner_whatsapp', c.owner_whatsapp, 'plan_name', r.plan_name, 'state', r.state)
             from public.pa_cafe_rows() r join public.cafes c on c.id = r.cafe_id where r.cafe_id = v.cafe_id),
    'admins', (select coalesce(jsonb_agg(jsonb_build_object('user_id', a.user_id, 'full_name', a.full_name) order by a.full_name), '[]'::jsonb)
               from public.platform_admins a where a.is_active)
  );
end;
$$;

create or replace function public.pa_ticket_reply(p_ticket uuid, p_body text, p_attachments text[] default '{}', p_resolve boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.pa_require();
  v public.platform_tickets;
  v_before public.platform_tickets;
  v_msg bigint;
begin
  select * into v_before from public.platform_tickets t where t.id = p_ticket for update;
  if not found then
    raise exception 'Tiket tidak ditemukan' using errcode = 'P0002';
  end if;
  if char_length(trim(coalesce(p_body, ''))) not between 1 and 4000 then
    raise exception 'Balasan 1–4000 karakter' using errcode = '22023';
  end if;
  insert into public.platform_ticket_messages (ticket_id, author_id, author_role, body, attachments)
  values (p_ticket, v_actor, 'admin', trim(p_body), public.ticket_check_attachments(v_before.cafe_id, p_attachments))
  returning id into v_msg;
  update public.platform_tickets
  set first_response_at = coalesce(first_response_at, now()),
      status = case when coalesce(p_resolve, false) then 'resolved' when status = 'new' then 'in_progress' else status end,
      resolved_at = case when coalesce(p_resolve, false) then now() else resolved_at end,
      assigned_to = coalesce(assigned_to, v_actor),
      last_message_at = now(), owner_unread = true, admin_unread = false, updated_at = now()
  where id = p_ticket
  returning * into v;
  perform public.pa_notify_owner(v.cafe_id, 'ticket_reply', 'info', 'Balasan untuk tiket ' || v.number, left(trim(p_body), 140),
                                 '/bantuan/' || v.id, 'ticket_reply:' || v_msg);
  perform public.pa_log('ticket.reply', v.cafe_id, 'ticket', v.id::text,
    jsonb_build_object('status', v_before.status), jsonb_build_object('status', v.status, 'message_id', v_msg));
  return public.ticket_json(v);
end;
$$;

create or replace function public.pa_ticket_update(
  p_ticket uuid, p_status text default null, p_priority text default null, p_assigned_to uuid default null, p_unassign boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.platform_tickets;
  v_before public.platform_tickets;
begin
  perform public.pa_require();
  select * into v_before from public.platform_tickets t where t.id = p_ticket for update;
  if not found then
    raise exception 'Tiket tidak ditemukan' using errcode = 'P0002';
  end if;
  if p_assigned_to is not null and not exists (select 1 from public.platform_admins a where a.user_id = p_assigned_to and a.is_active) then
    raise exception 'Hanya bisa ditugaskan ke admin aktif' using errcode = '22023';
  end if;
  update public.platform_tickets
  set status = coalesce(p_status, status),
      priority = coalesce(p_priority, priority),
      assigned_to = case when coalesce(p_unassign, false) then null else coalesce(p_assigned_to, assigned_to) end,
      resolved_at = case when coalesce(p_status, status) = 'resolved' then coalesce(resolved_at, now()) else null end,
      updated_at = now()
  where id = p_ticket
  returning * into v;
  if v.status = 'resolved' and v_before.status <> 'resolved' then
    perform public.pa_notify_owner(v.cafe_id, 'ticket_resolved', 'success', 'Tiket ' || v.number || ' selesai', v.title,
                                   '/bantuan/' || v.id, 'ticket_resolved:' || v.id || ':' || to_char(now(), 'YYYYMMDDHH24MISS'));
  end if;
  perform public.pa_log('ticket.update', v.cafe_id, 'ticket', v.id::text,
    jsonb_build_object('status', v_before.status, 'priority', v_before.priority, 'assigned_to', v_before.assigned_to),
    jsonb_build_object('status', v.status, 'priority', v.priority, 'assigned_to', v.assigned_to));
  return public.ticket_json(v);
end;
$$;

-- ---------------------------------------------------------------------
-- K. Pengecekan harian (menggantikan versi file 15; isi lama tetap + skor kesehatan, setup, MRR per kafe, sinyal upgrade)
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
  v_health jsonb;
  v_admin integer := 0;
  v_owner integer := 0;
  v_amount text;
begin
  v_billing := public.pa_billing_run();
  v_health := public.pa_health_run();

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
      -- Paling banyak sekali seminggu per kafe (ref_id memuat minggu ISO)
      if public.pa_notify_admin('upgrade_signal', 'info', 'Peluang upgrade: ' || r.cafe_name, r.reason, r.cafe_id,
           '/kafe/' || r.cafe_id, 'upgrade_signal:' || r.ref_id) then
        v_admin := v_admin + 1;
      end if;
    end if;
  end loop;

  return jsonb_build_object('billing', v_billing, 'health', v_health, 'admin_notifications', v_admin, 'owner_notifications', v_owner, 'ran_at', now());
end;
$$;
revoke all on function public.pa_daily_check() from public, anon, authenticated;
grant execute on function public.pa_daily_check() to service_role;

-- ---------------------------------------------------------------------
-- L. Hak panggil
-- ---------------------------------------------------------------------
-- Internal (tanpa cek admin): tertutup untuk semua peran aplikasi
do $$
declare
  v_sig text;
begin
  foreach v_sig in array array[
    'pa_health_score(uuid)', 'pa_setup_steps(uuid)', 'pa_setup_refresh()', 'pa_setup_json(uuid)', 'pa_snapshot_cafe_mrr()',
    'pa_mrr_backfill()', 'pa_health_run()', 'pa_health_latest()', 'ticket_check_attachments(uuid, text[])',
    'ticket_json(public.platform_tickets)', 'ticket_messages_json(uuid)', 'pa_health_label(integer)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', v_sig);
  end loop;
  -- Dashboard admin: hanya authenticated (pa_require menolak non-admin / non-2FA)
  foreach v_sig in array array[
    'pa_health_overview(integer)', 'pa_health_map()', 'pa_cafe_health(uuid, integer)', 'pa_setup_progress(integer)',
    'pa_analytics_mrr(integer)', 'pa_analytics_cohort(integer)', 'pa_analytics_summary()',
    'pa_cafe_note_add(uuid, text)', 'pa_cafe_timeline(uuid, integer)',
    'pa_tickets_list(text, text, integer, integer)', 'pa_ticket_detail(uuid)', 'pa_ticket_reply(uuid, text, text[], boolean)',
    'pa_ticket_update(uuid, text, text, uuid, boolean)',
    -- Owner: fungsi memeriksa sendiri bahwa pemanggil owner/anggota kafe itu
    'owner_ticket_create(uuid, text, text, text, text[])', 'owner_ticket_reply(uuid, text, text[])', 'owner_tickets(uuid)',
    'owner_ticket_detail(uuid)', 'owner_log_plan_block(uuid, text, text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', v_sig);
    execute format('grant execute on function public.%s to authenticated', v_sig);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- M. Storage lampiran tiket (privat, folder = cafe_id). Dilewati bila schema storage tidak ada.
-- ---------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.buckets') is null then
    return;
  end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('support-attachments', 'support-attachments', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
  on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
  execute 'drop policy if exists "Owners read support attachments" on storage.objects';
  execute $p$create policy "Owners read support attachments" on storage.objects for select to authenticated
    using (bucket_id = 'support-attachments' and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner' and p.is_active and p.cafe_id::text = (storage.foldername(name))[1]))$p$;
  execute 'drop policy if exists "Owners upload support attachments" on storage.objects';
  execute $p$create policy "Owners upload support attachments" on storage.objects for insert to authenticated
    with check (bucket_id = 'support-attachments' and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner' and p.is_active and p.cafe_id::text = (storage.foldername(name))[1]))$p$;
  execute 'drop policy if exists "Platform admins read support attachments" on storage.objects';
  execute $p$create policy "Platform admins read support attachments" on storage.objects for select to authenticated
    using (bucket_id = 'support-attachments' and public.is_platform_admin())$p$;
  execute 'drop policy if exists "Platform admins upload support attachments" on storage.objects';
  execute $p$create policy "Platform admins upload support attachments" on storage.objects for insert to authenticated
    with check (bucket_id = 'support-attachments' and public.is_platform_admin())$p$;
end;
$$;

-- ---------------------------------------------------------------------
-- N. Isi awal: MRR bulan lampau dari tagihan lunas + bulan ini, skor & setup hari ini
-- ---------------------------------------------------------------------
select public.pa_mrr_backfill();
select public.pa_health_run();

-- Realtime: tiket baru/balasan langsung muncul di kotak masuk admin (RLS tetap berlaku)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'platform_tickets') then
    execute 'alter publication supabase_realtime add table public.platform_tickets';
  end if;
end;
$$;

notify pgrst, 'reload schema';

commit;

-- Verifikasi: 7 tabel + 2 trigger = 9 baris, dan baris "tanpa_rls" TIDAK boleh muncul
select 'table' as kind, table_name as name
from information_schema.tables
where table_schema = 'public' and table_name in ('cafe_health_daily', 'cafe_setup_state', 'cafe_mrr_monthly', 'plan_block_events',
  'cafe_notes', 'platform_tickets', 'platform_ticket_messages')
union all
select 'trigger', tgname::text from pg_trigger where tgname in ('setup_mark_charges', 'setup_mark_receipt') and not tgisinternal
union all
select 'tanpa_rls', c.relname
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
order by 1, 2;

-- =====================================================================
-- JADWAL: tidak ada jadwal baru. pa_daily_check (file 15, 08.00 WIB) kini juga menghitung skor kesehatan,
-- progres setup, MRR per kafe, dan sinyal upgrade.
-- =====================================================================
