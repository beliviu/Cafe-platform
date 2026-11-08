-- =====================================================================
-- 09 · PAYMENT GATEWAY (Fase 5 roadmap V2) — QRIS dinamis via Midtrans
--   A. Pengaturan per kafe: gateway aktif, provider, masa berlaku QR
--   B. payment_intents: satu tagihan QRIS per percobaan bayar (dibuat, menunggu, lunas,
--      kedaluwarsa, gagal). Status bayar terpisah dari status pesanan.
--   C. payment_events: log setiap notifikasi/cek status (anti-dobel per kejadian)
--   D. payment_refunds: refund yang dikirim lewat gateway (refund_key = id refund)
--   E. Fungsi KHUSUS server (service_role, dipanggil Edge Function "payments"):
--      pay_prepare_intent, pay_attach_charge, pay_apply_status, pay_refund_prepare,
--      pay_refund_complete, pay_reconcile_targets
--   F. Ringkasan untuk owner + akses baca (RLS)
--
-- Prinsip:
--   - Pesanan HANYA ditandai lunas oleh notifikasi gateway yang tanda tangannya valid
--     DAN dicek ulang ke API status Midtrans (dilakukan Edge Function). QR demo tidak pernah lunas.
--   - Nominal tagihan dihitung server dari pesanan (total − sudah dibayar), bukan dari aplikasi.
--   - Notifikasi ganda / cek status berulang tidak membuat pembayaran dobel (event unik + kunci baris).
--   - Kunci API Midtrans hanya ada di Edge Function (secret), tidak pernah di database / aplikasi.
--
-- Jalankan manual di Supabase SQL Editor SETELAH 06-pesanan-v2-pos.sql (07/08 tidak wajib).
-- Semua dalam satu transaksi: kalau ada error, tidak ada yang berubah.
--
-- Dampak ke data yang sudah ada:
--   - 3 kolom baru di cafe_settings (gateway NONAKTIF sampai owner menyalakan).
--   - 3 tabel baru (kosong). Tidak ada perubahan pada pesanan / pembayaran lama.
--   - Pembayaran tunai, QRIS manual kasir, dan transfer tetap berjalan seperti sekarang.
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
-- A. Pengaturan
-- ---------------------------------------------------------------------
alter table public.cafe_settings
  add column if not exists payment_gateway_enabled boolean not null default false,
  add column if not exists payment_gateway_provider text not null default 'midtrans',
  add column if not exists payment_qris_expiry_minutes smallint not null default 15;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cafe_settings_payment_valid') then
    alter table public.cafe_settings add constraint cafe_settings_payment_valid
      check (payment_gateway_provider in ('midtrans') and payment_qris_expiry_minutes between 5 and 60);
  end if;
end;
$$;
grant update (payment_gateway_enabled, payment_qris_expiry_minutes) on public.cafe_settings to authenticated;

-- ---------------------------------------------------------------------
-- B–D. Tabel
-- ---------------------------------------------------------------------
create table if not exists public.payment_intents (
  id uuid primary key default gen_random_uuid(),
  cafe_id uuid not null references public.cafes (id) on delete cascade,
  order_id uuid not null references public.orders (id) on delete cascade,
  provider text not null default 'midtrans',
  method text not null default 'qris' check (method in ('qris')),
  provider_order_id text not null unique,
  provider_transaction_id text,
  amount numeric(12, 2) not null check (amount > 0),
  paid_amount numeric(12, 2),
  status text not null default 'creating' check (status in ('creating', 'pending', 'paid', 'expired', 'failed', 'cancelled')),
  qr_string text,
  qr_url text,
  expires_at timestamptz not null,
  paid_at timestamptz,
  payment_id uuid references public.payments (id) on delete set null,
  review_reason text,
  failure_message text,
  source text not null default 'app' check (source in ('app', 'pos')),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_checked_at timestamptz
);
create index if not exists payment_intents_cafe_idx on public.payment_intents (cafe_id, created_at desc);
create index if not exists payment_intents_order_idx on public.payment_intents (order_id, created_at desc);
-- Satu tagihan aktif per pesanan
create unique index if not exists payment_intents_one_active on public.payment_intents (order_id) where status in ('creating', 'pending');

create table if not exists public.payment_events (
  id bigint generated always as identity primary key,
  cafe_id uuid references public.cafes (id) on delete cascade,
  intent_id uuid references public.payment_intents (id) on delete set null,
  provider text not null default 'midtrans',
  provider_order_id text,
  event_key text not null unique,
  transaction_status text,
  source text not null check (source in ('webhook', 'poll', 'charge', 'refund')),
  signature_valid boolean,
  result text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists payment_events_cafe_idx on public.payment_events (cafe_id, created_at desc);

create table if not exists public.payment_refunds (
  id uuid primary key default gen_random_uuid(),
  cafe_id uuid not null references public.cafes (id) on delete cascade,
  refund_id uuid not null unique references public.refunds (id) on delete cascade,
  intent_id uuid not null references public.payment_intents (id) on delete cascade,
  amount numeric(12, 2) not null check (amount > 0),
  status text not null default 'processing' check (status in ('processing', 'succeeded', 'failed')),
  provider_refund_id text,
  message text,
  payload jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- E. Fungsi server (service_role). Pemanggil ditentukan p_actor (dari token yang diverifikasi
--    Edge Function), lalu dijadikan auth.uid() lokal agar aturan izin yang ada tetap berlaku.
-- ---------------------------------------------------------------------
create or replace function public.pay_act_as(p_actor uuid)
returns void
language sql
set search_path = ''
as $$
  select set_config('request.jwt.claim.sub', coalesce(p_actor::text, ''), true)
$$;
revoke all on function public.pay_act_as(uuid) from public, anon, authenticated;

-- Siapkan tagihan QRIS untuk sisa tagihan pesanan. Mengembalikan tagihan aktif yang masih
-- berlaku (dipakai ulang) atau tagihan baru berstatus 'creating' untuk di-charge ke Midtrans.
create or replace function public.pay_prepare_intent(p_actor uuid, p_order_id uuid, p_source text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_settings public.cafe_settings%rowtype;
  v_active public.payment_intents%rowtype;
  v_intent public.payment_intents%rowtype;
  v_amount numeric(12, 2);
  v_stale text[];
begin
  perform public.pay_act_as(p_actor);
  if p_actor is null then
    raise exception 'Login diperlukan' using errcode = '28000';
  end if;
  select * into v_order from public.orders o where o.id = p_order_id for update;
  if not found then
    raise exception 'Pesanan tidak ditemukan' using errcode = 'P0002';
  end if;
  if p_source = 'app' then
    if v_order.customer_id is distinct from p_actor then
      raise exception 'Pesanan tidak ditemukan' using errcode = 'P0002';
    end if;
  elsif p_source = 'pos' then
    if not public.is_cafe_member(v_order.cafe_id) then
      raise exception 'Hanya staff atau owner kafe ini' using errcode = '42501';
    end if;
  else
    raise exception 'Sumber tidak dikenal' using errcode = '22023';
  end if;
  select * into v_settings from public.cafe_settings s where s.cafe_id = v_order.cafe_id;
  if not coalesce(v_settings.payment_gateway_enabled, false) then
    raise exception 'Pembayaran QRIS online belum diaktifkan kafe ini' using errcode = 'P0001', hint = 'gateway_disabled';
  end if;
  if v_order.order_status = 'cancelled' then
    raise exception 'Pesanan sudah dibatalkan' using errcode = '22023';
  end if;
  if v_order.payment_status = 'paid' then
    raise exception 'Pesanan sudah lunas' using errcode = '22023', hint = 'already_paid';
  end if;
  -- Midtrans menerima nominal bulat (Rupiah)
  v_amount := ceil(v_order.total_amount - coalesce(v_order.paid_amount, 0));
  if v_amount <= 0 then
    raise exception 'Tidak ada sisa tagihan' using errcode = '22023';
  end if;

  select * into v_active from public.payment_intents i
  where i.order_id = p_order_id and i.status in ('creating', 'pending') for update;
  if v_active.id is not null and v_active.status = 'pending' and v_active.amount = v_amount and v_active.expires_at > now() + interval '30 seconds' then
    return jsonb_build_object('reuse', true, 'intent', to_jsonb(v_active), 'stale', '[]'::jsonb);
  end if;
  -- Tagihan lama (nominal berubah / hampir habis / gagal dibuat) ditutup; Edge Function membatalkannya di Midtrans
  select array_agg(i.provider_order_id) into v_stale from public.payment_intents i
  where i.order_id = p_order_id and i.status in ('creating', 'pending');
  update public.payment_intents set status = 'expired', updated_at = now(), failure_message = 'Diganti tagihan baru'
  where order_id = p_order_id and status in ('creating', 'pending');

  insert into public.payment_intents (cafe_id, order_id, provider, provider_order_id, amount, expires_at, source, created_by)
  values (
    v_order.cafe_id, v_order.id, v_settings.payment_gateway_provider,
    'DB' || to_char(now() at time zone 'Asia/Jakarta', 'YYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)),
    v_amount, now() + make_interval(mins => v_settings.payment_qris_expiry_minutes), p_source, p_actor
  )
  returning * into v_intent;

  -- Pilihan bayar di pesanan app ikut berubah ke QRIS (tanpa menandai lunas)
  if v_order.paid_amount = 0 then
    update public.orders set payment_method = 'qris', updated_at = now() where id = v_order.id;
  end if;
  return jsonb_build_object('reuse', false, 'intent', to_jsonb(v_intent), 'stale', to_jsonb(coalesce(v_stale, '{}'::text[])),
    'expiry_minutes', v_settings.payment_qris_expiry_minutes);
end;
$$;

-- Simpan hasil charge Midtrans (QR) atau kegagalannya
create or replace function public.pay_attach_charge(
  p_intent_id uuid, p_ok boolean, p_transaction_id text, p_qr_string text, p_qr_url text, p_expires_at timestamptz, p_message text, p_raw jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_intent public.payment_intents%rowtype;
begin
  select * into v_intent from public.payment_intents i where i.id = p_intent_id for update;
  if not found or v_intent.status <> 'creating' then
    return to_jsonb(v_intent);
  end if;
  update public.payment_intents
  set status = case when p_ok then 'pending' else 'failed' end,
      provider_transaction_id = p_transaction_id,
      qr_string = p_qr_string,
      qr_url = p_qr_url,
      expires_at = coalesce(least(p_expires_at, expires_at), expires_at),
      failure_message = case when p_ok then null else left(p_message, 300) end,
      updated_at = now()
  where id = p_intent_id
  returning * into v_intent;
  insert into public.payment_events (cafe_id, intent_id, provider, provider_order_id, event_key, transaction_status, source, result, payload)
  values (v_intent.cafe_id, v_intent.id, v_intent.provider, v_intent.provider_order_id, 'charge:' || v_intent.id,
          case when p_ok then 'pending' else 'failed' end, 'charge', case when p_ok then 'created' else left(p_message, 300) end, coalesce(p_raw, '{}'::jsonb))
  on conflict (event_key) do nothing;
  return to_jsonb(v_intent);
end;
$$;

-- Terapkan status dari gateway (notifikasi webhook yang sudah diverifikasi, atau hasil cek status).
-- Idempoten: kejadian yang sama (order, transaksi, status) hanya diproses sekali.
create or replace function public.pay_apply_status(
  p_provider_order_id text, p_transaction_id text, p_status text, p_fraud_status text, p_gross numeric,
  p_raw jsonb, p_source text, p_signature_valid boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_intent public.payment_intents%rowtype;
  v_order public.orders%rowtype;
  v_event bigint;
  v_target text;
  v_payment uuid;
  v_review text;
  v_key text := coalesce(p_provider_order_id, '?') || ':' || coalesce(p_transaction_id, '') || ':' || coalesce(p_status, '') || ':' || coalesce(p_fraud_status, '');
begin
  select * into v_intent from public.payment_intents i where i.provider_order_id = p_provider_order_id for update;

  insert into public.payment_events (cafe_id, intent_id, provider_order_id, event_key, transaction_status, source, signature_valid, payload)
  values (v_intent.cafe_id, v_intent.id, p_provider_order_id, v_key, p_status, p_source, p_signature_valid, coalesce(p_raw, '{}'::jsonb))
  on conflict (event_key) do nothing
  returning id into v_event;

  if v_intent.id is not null then
    update public.payment_intents set last_checked_at = now() where id = v_intent.id;
  end if;
  if v_event is null then
    return jsonb_build_object('duplicate', true, 'status', v_intent.status);
  end if;
  if not coalesce(p_signature_valid, false) then
    update public.payment_events set result = 'bad_signature' where id = v_event;
    return jsonb_build_object('ignored', 'bad_signature');
  end if;
  if v_intent.id is null then
    update public.payment_events set result = 'unknown_order' where id = v_event;
    return jsonb_build_object('ignored', 'unknown_order');
  end if;

  v_target := case
    when p_status = 'settlement' then 'paid'
    when p_status = 'capture' and coalesce(p_fraud_status, 'accept') = 'accept' then 'paid'
    when p_status = 'pending' then 'pending'
    when p_status = 'expire' then 'expired'
    when p_status in ('cancel') then 'cancelled'
    when p_status in ('deny', 'failure') then 'failed'
    else null end; -- refund/partial_refund/chargeback: dicatat saja

  if v_target is null or v_intent.status = 'paid' or v_target = v_intent.status then
    update public.payment_events set result = case when v_intent.status = 'paid' and v_target is not null and v_target <> 'paid' then 'ignored_after_paid' else 'logged' end
    where id = v_event;
    if v_intent.status = 'pending' and p_transaction_id is not null and v_intent.provider_transaction_id is null then
      update public.payment_intents set provider_transaction_id = p_transaction_id where id = v_intent.id;
    end if;
    return jsonb_build_object('status', v_intent.status, 'changed', false);
  end if;

  if v_target <> 'paid' then
    update public.payment_intents
    set status = v_target, provider_transaction_id = coalesce(p_transaction_id, provider_transaction_id), updated_at = now()
    where id = v_intent.id;
    update public.payment_events set result = v_target where id = v_event;
    return jsonb_build_object('status', v_target, 'changed', true);
  end if;

  -- LUNAS (uang sungguhan sudah diterima gateway)
  select * into v_order from public.orders o where o.id = v_intent.order_id for update;
  if abs(coalesce(p_gross, 0) - v_intent.amount) > 0.5 then
    v_review := 'Nominal dari gateway (' || coalesce(p_gross, 0) || ') berbeda dengan tagihan (' || v_intent.amount || ')';
  end if;
  if v_order.order_status = 'cancelled' then
    v_review := concat_ws('; ', v_review, 'Pesanan sudah dibatalkan — kembalikan dana pelanggan');
  elsif coalesce(v_order.paid_amount, 0) + coalesce(p_gross, 0) > v_order.total_amount + 0.5 then
    v_review := concat_ws('; ', v_review, 'Pesanan sudah dibayar dengan cara lain — kembalikan dana kelebihan');
  end if;

  if v_review is null then
    insert into public.payments (order_id, method, payment_method, status, payment_status, amount, paid_at, reference, verification, cashier_session_id)
    values (v_order.id, 'qris', 'qris', 'paid', 'paid', p_gross, now(), left(p_transaction_id, 60), 'gateway', v_order.cashier_session_id)
    returning id into v_payment;
    update public.orders
    set paid_amount = paid_amount + p_gross,
        payment_status = case when paid_amount + p_gross >= total_amount - 0.005 then 'paid' else payment_status end,
        paid_at = case when paid_amount + p_gross >= total_amount - 0.005 then now() else paid_at end,
        payment_method = case when paid_amount > 0 then 'split' else 'qris' end,
        updated_at = now()
    where id = v_order.id;
    insert into public.order_status_events (order_id, cafe_id, event_type, to_status, note, changed_by, created_at)
    values (v_order.id, v_order.cafe_id, 'payment', 'paid', 'QRIS (gateway)', null, now());
    if to_regclass('public.notifications') is not null and v_order.customer_id is not null then
      execute 'insert into public.notifications (user_id, cafe_id, kind, title, body, data) values ($1, $2, ''order'', $3, $4, $5)'
      using v_order.customer_id, v_order.cafe_id, 'Pembayaran diterima',
            'Pembayaran QRIS ' || to_char(p_gross, 'FM999G999G990') || ' untuk pesananmu sudah kami terima.',
            jsonb_build_object('order_id', v_order.id, 'payment', 'paid');
    end if;
  end if;

  update public.payment_intents
  set status = 'paid', paid_amount = p_gross, paid_at = now(), payment_id = v_payment, review_reason = v_review,
      provider_transaction_id = coalesce(p_transaction_id, provider_transaction_id), updated_at = now()
  where id = v_intent.id;
  update public.payment_events set result = case when v_review is null then 'paid' else 'paid_review' end where id = v_event;
  return jsonb_build_object('status', 'paid', 'changed', true, 'review', v_review);
end;
$$;

-- Refund lewat gateway (owner). Dari pengajuan refund yang ada (p_refund_id) atau langsung (p_order_id + nominal).
create or replace function public.pay_refund_prepare(
  p_actor uuid, p_refund_id uuid, p_order_id uuid, p_amount numeric, p_reason text, p_restock boolean default false, p_items jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_refund public.refunds%rowtype;
  v_order public.orders%rowtype;
  v_intent public.payment_intents%rowtype;
  v_existing public.payment_refunds%rowtype;
  v_pending numeric(12, 2);
  v_used numeric(12, 2);
  v_amount numeric(12, 2);
begin
  perform public.pay_act_as(p_actor);
  if p_refund_id is not null then
    select * into v_refund from public.refunds r where r.id = p_refund_id for update;
    if not found then
      raise exception 'Refund tidak ditemukan' using errcode = 'P0002';
    end if;
    select * into v_order from public.orders o where o.id = v_refund.order_id for update;
  else
    select * into v_order from public.orders o where o.id = p_order_id for update;
    if not found then
      raise exception 'Pesanan tidak ditemukan' using errcode = 'P0002';
    end if;
  end if;
  if not public.is_cafe_member(v_order.cafe_id, array['owner']) then
    raise exception 'Hanya owner yang bisa mengembalikan dana lewat gateway' using errcode = '42501';
  end if;

  select * into v_intent from public.payment_intents i
  where i.order_id = v_order.id and i.status = 'paid' and i.payment_id is not null
  order by i.paid_at desc limit 1;
  if v_intent.id is null then
    raise exception 'Pesanan ini tidak dibayar lewat QRIS online' using errcode = '22023', hint = 'not_gateway';
  end if;

  if p_refund_id is not null then
    select * into v_existing from public.payment_refunds pr where pr.refund_id = v_refund.id for update;
    if v_existing.status = 'succeeded' then
      return jsonb_build_object('already', true, 'refund_id', v_refund.id);
    end if;
    if v_refund.status <> 'requested' then
      raise exception 'Refund ini sudah diputuskan' using errcode = '22023';
    end if;
    v_amount := v_refund.amount;
  else
    v_amount := round(p_amount, 2);
    if char_length(coalesce(public.inv_clean_text(p_reason, 300), '')) < 3 then
      raise exception 'Tulis alasan refund' using errcode = '22023';
    end if;
    select coalesce(sum(r.amount), 0) into v_pending from public.refunds r where r.order_id = v_order.id and r.status = 'requested';
    if v_amount is null or v_amount <= 0 or v_amount > v_order.paid_amount - v_order.refunded_amount - v_pending + 0.005 then
      raise exception 'Nominal refund maksimal %', to_char(greatest(v_order.paid_amount - v_order.refunded_amount - v_pending, 0), 'FM999G999G990') using errcode = '22023';
    end if;
    insert into public.refunds (cafe_id, order_id, amount, method, reason, restock, items)
    values (v_order.cafe_id, v_order.id, v_amount, 'qris', public.inv_clean_text(p_reason, 300),
            coalesce(p_restock, false) and jsonb_array_length(coalesce(p_items, '[]'::jsonb)) > 0, coalesce(p_items, '[]'::jsonb))
    returning * into v_refund;
  end if;

  select coalesce(sum(pr.amount), 0) into v_used from public.payment_refunds pr
  where pr.intent_id = v_intent.id and pr.status in ('processing', 'succeeded') and pr.refund_id <> v_refund.id;
  if v_amount > v_intent.paid_amount - v_used + 0.005 then
    raise exception 'Refund gateway maksimal % (sisa pembayaran QRIS)', to_char(v_intent.paid_amount - v_used, 'FM999G999G990') using errcode = '22023';
  end if;

  update public.refunds set method = 'qris' where id = v_refund.id;
  insert into public.payment_refunds (cafe_id, refund_id, intent_id, amount, status, created_by)
  values (v_order.cafe_id, v_refund.id, v_intent.id, v_amount, 'processing', p_actor)
  on conflict (refund_id) do update set status = 'processing', amount = excluded.amount, updated_at = now();

  return jsonb_build_object(
    'refund_id', v_refund.id, 'provider_order_id', v_intent.provider_order_id, 'transaction_id', v_intent.provider_transaction_id,
    'amount', v_amount, 'reason', v_refund.reason, 'provider', v_intent.provider
  );
end;
$$;

create or replace function public.pay_refund_complete(p_actor uuid, p_refund_id uuid, p_ok boolean, p_provider_refund_id text, p_message text, p_raw jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.payment_refunds%rowtype;
  v_refund public.refunds%rowtype;
begin
  perform public.pay_act_as(p_actor);
  select * into v_row from public.payment_refunds pr where pr.refund_id = p_refund_id for update;
  if not found then
    raise exception 'Refund gateway tidak ditemukan' using errcode = 'P0002';
  end if;
  if v_row.status = 'succeeded' then
    return jsonb_build_object('status', 'succeeded', 'already', true);
  end if;
  update public.payment_refunds
  set status = case when p_ok then 'succeeded' else 'failed' end, provider_refund_id = p_provider_refund_id,
      message = left(p_message, 300), payload = coalesce(p_raw, '{}'::jsonb), updated_at = now()
  where id = v_row.id;
  insert into public.payment_events (cafe_id, intent_id, provider_order_id, event_key, transaction_status, source, signature_valid, result, payload)
  select v_row.cafe_id, v_row.intent_id, i.provider_order_id, 'refund:' || p_refund_id || ':' || case when p_ok then 'ok' else 'fail:' || gen_random_uuid() end,
         case when p_ok then 'refund' else 'refund_failed' end, 'refund', true, left(p_message, 300), coalesce(p_raw, '{}'::jsonb)
  from public.payment_intents i where i.id = v_row.intent_id
  on conflict (event_key) do nothing;

  if p_ok then
    select * into v_refund from public.refunds r where r.id = p_refund_id;
    if v_refund.status = 'requested' then
      perform public.refund_approve_internal(p_refund_id, 'Dikembalikan lewat gateway QRIS');
    end if;
    update public.payments set verification = 'gateway', reference = left(coalesce(p_provider_refund_id, 'refund'), 60)
    where refund_id = p_refund_id;
  end if;
  return jsonb_build_object('status', case when p_ok then 'succeeded' else 'failed' end);
end;
$$;

-- Tagihan yang perlu dicek ulang ke gateway (webhook terlambat / hilang)
create or replace function public.pay_reconcile_targets(p_actor uuid, p_cafe_id uuid, p_order_id uuid default null)
returns table (intent_id uuid, provider_order_id text, provider text, status text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform public.pay_act_as(p_actor);
  if p_order_id is not null then
    if not exists (select 1 from public.orders o where o.id = p_order_id and (o.customer_id = p_actor or public.is_cafe_member(o.cafe_id))) then
      raise exception 'Pesanan tidak ditemukan' using errcode = 'P0002';
    end if;
  elsif not public.is_cafe_member(p_cafe_id) then
    raise exception 'Hanya staff atau owner kafe ini' using errcode = '42501';
  end if;
  return query
  select i.id, i.provider_order_id, i.provider, i.status
  from public.payment_intents i
  where (p_order_id is null or i.order_id = p_order_id)
    and (p_order_id is not null or i.cafe_id = p_cafe_id)
    and i.status in ('creating', 'pending')
    and i.created_at > now() - interval '3 days'
  order by i.created_at
  limit 50;
end;
$$;

do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.pay_prepare_intent(uuid, uuid, text)',
    'public.pay_attach_charge(uuid, boolean, text, text, text, timestamptz, text, jsonb)',
    'public.pay_apply_status(text, text, text, text, numeric, jsonb, text, boolean)',
    'public.pay_refund_prepare(uuid, uuid, uuid, numeric, text, boolean, jsonb)',
    'public.pay_refund_complete(uuid, uuid, boolean, text, text, jsonb)',
    'public.pay_reconcile_targets(uuid, uuid, uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', v_fn);
    execute format('grant execute on function %s to service_role', v_fn);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- F. Ringkasan owner & akses baca
-- ---------------------------------------------------------------------
create or replace function public.payment_gateway_summary(p_cafe_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from timestamptz := (p_from::timestamp at time zone 'Asia/Jakarta');
  v_to timestamptz := ((p_to + 1)::timestamp at time zone 'Asia/Jakarta');
begin
  if not public.is_cafe_member(p_cafe_id, array['owner']) then
    raise exception 'Hanya owner' using errcode = '42501';
  end if;
  return (
    select jsonb_build_object(
      'paid_count', count(*) filter (where i.status = 'paid'),
      'paid_amount', coalesce(sum(i.paid_amount) filter (where i.status = 'paid'), 0),
      'pending_count', count(*) filter (where i.status in ('creating', 'pending')),
      'expired_count', count(*) filter (where i.status in ('expired', 'cancelled')),
      'failed_count', count(*) filter (where i.status = 'failed'),
      'review_count', count(*) filter (where i.review_reason is not null),
      'refunded_amount', (select coalesce(sum(pr.amount), 0) from public.payment_refunds pr
                          where pr.cafe_id = p_cafe_id and pr.status = 'succeeded' and pr.created_at >= v_from and pr.created_at < v_to),
      'last_webhook_at', (select max(e.created_at) from public.payment_events e where e.cafe_id = p_cafe_id and e.source = 'webhook')
    )
    from public.payment_intents i
    where i.cafe_id = p_cafe_id and i.created_at >= v_from and i.created_at < v_to
  );
end;
$$;
revoke all on function public.payment_gateway_summary(uuid, date, date) from public, anon;
grant execute on function public.payment_gateway_summary(uuid, date, date) to authenticated;

alter table public.payment_intents enable row level security;
alter table public.payment_events enable row level security;
alter table public.payment_refunds enable row level security;
revoke all on public.payment_intents, public.payment_events, public.payment_refunds from anon, authenticated;

grant select on public.payment_intents to authenticated;
drop policy if exists "Payment intents visible to payer and cafe" on public.payment_intents;
create policy "Payment intents visible to payer and cafe" on public.payment_intents for select to authenticated
  using (public.is_cafe_member(cafe_id) or exists (select 1 from public.orders o where o.id = order_id and o.customer_id = (select auth.uid())));

grant select on public.payment_events to authenticated;
drop policy if exists "Payment events visible to owner" on public.payment_events;
create policy "Payment events visible to owner" on public.payment_events for select to authenticated
  using (public.is_cafe_member(cafe_id, array['owner']));

grant select on public.payment_refunds to authenticated;
drop policy if exists "Gateway refunds visible to cafe" on public.payment_refunds;
create policy "Gateway refunds visible to cafe" on public.payment_refunds for select to authenticated
  using (public.is_cafe_member(cafe_id));

-- Realtime: layar bayar di app & kasir langsung berubah saat lunas
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'payment_intents') then
    execute 'alter publication supabase_realtime add table public.payment_intents';
  end if;
end;
$$;

notify pgrst, 'reload schema';

commit;

-- Verifikasi: 3 tabel + 7 fungsi = 10 baris
select 'table' as kind, table_name as name
from information_schema.tables
where table_schema = 'public' and table_name in ('payment_intents', 'payment_events', 'payment_refunds')
union all
select 'function', p.proname
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in (
  'pay_prepare_intent', 'pay_attach_charge', 'pay_apply_status', 'pay_refund_prepare', 'pay_refund_complete', 'pay_reconcile_targets',
  'payment_gateway_summary'
)
order by 1, 2;
