-- =====================================================================
-- 17 · PENAGIHAN OTOMATIS: NOMOR TAGIHAN TANPA LONCAT, PENGINGAT BERTAHAP, NONAKTIF & AKTIF OTOMATIS,
--      KUITANSI, KODE PROMO, REFERRAL + KREDIT, HARGA MULTI-CABANG, KEUANGAN PLATFORM
-- ---------------------------------------------------------------------
-- Bergantung pada file 14 (tagihan, Midtrans), 15 (notifikasi, pengaturan, pa_daily_check), 16 (kesehatan).
-- MELANJUTKAN alur yang sudah ada — tidak membuat ulang:
--   * Tagihan H-7 tetap dibuat pa_billing_run (dipanggil pa_daily_check, jadwal pg_cron yang sama).
--   * Bayar tetap lewat Edge Function "subscription-billing" (Midtrans Snap + webhook bertanda tangan).
--
-- Isi:
--   A. Pengaturan penagihan (platform_settings): nonaktif otomatis, referral, diskon cabang, data penerbit kuitansi.
--   B. Nomor tagihan berurutan per bulan TANPA loncat & tanpa duplikat (penghitung dikunci per baris).
--   C. Rincian harga tagihan: harga normal, diskon promo, diskon referral, kredit dipakai → total.
--      Total 0 (lunas dengan kredit/diskon) langsung ditandai lunas (metode "credit").
--   D. Kode promo (persen / nominal, batas pakai, paket, minimal bulan, khusus pembayaran pertama).
--   E. Referral: setiap kafe punya kode; kafe baru memasukkan kode → diskon tagihan pertama,
--      pengundang dapat kredit setelah kafe baru membayar. Kredit otomatis memotong tagihan berikutnya.
--   F. Grup multi-cabang: kafe kedua dst. dalam satu grup mendapat diskon (per grup / bawaan).
--   G. Pengingat bertahap: H-7, H-1, telat, telat 3 hari, peringatan 2 hari sebelum nonaktif.
--      Lewat N hari (bawaan 14) dari akhir periode → kafe dinonaktifkan otomatis; begitu tagihan lunas
--      (Midtrans/manual/kredit) kafe aktif lagi otomatis. Nonaktif manual oleh admin TIDAK dibuka otomatis.
--      Pengaman: hanya periode yang berakhir SETELAH fitur ini dinyalakan (billing_enforce_from).
--   H. Kuitansi: data kuitansi untuk owner/admin (PDF dibuat Edge Function subscription-billing, aksi "receipt").
--   I. Keuangan platform (admin): kas masuk per bulan, piutang & umur piutang, perkiraan 30 hari, metode,
--      ketepatan bayar, kafe nonaktif karena tagihan, pemakaian promo & kredit.
--
-- Semua fungsi admin dijaga pa_require() (admin aktif + 2FA) dan setiap perubahan data tercatat di log audit.
-- Data lama tidak diubah (kecuali list_amount diisi = amount untuk tagihan lama). Aman dijalankan ulang.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- A. Pengaturan penagihan
-- ---------------------------------------------------------------------
alter table public.platform_settings add column if not exists billing_suspend_enabled boolean not null default true;
alter table public.platform_settings add column if not exists billing_suspend_after_days integer not null default 14;
-- Pengaman: hanya langganan yang periodenya berakhir setelah waktu ini yang bisa dinonaktifkan otomatis
alter table public.platform_settings add column if not exists billing_enforce_from timestamptz not null default now();
alter table public.platform_settings add column if not exists referral_credit numeric(12, 2) not null default 50000;
alter table public.platform_settings add column if not exists referral_discount_pct integer not null default 20;
alter table public.platform_settings add column if not exists branch_discount_pct integer not null default 15;
alter table public.platform_settings add column if not exists billing_company_name text not null default 'Dailybrew';
alter table public.platform_settings add column if not exists billing_company_address text;
alter table public.platform_settings add column if not exists billing_company_email text;
alter table public.platform_settings add column if not exists billing_tax_id text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'platform_settings_billing_check') then
    alter table public.platform_settings add constraint platform_settings_billing_check check (
      billing_suspend_after_days between 7 and 60
      and referral_credit between 0 and 10000000
      and referral_discount_pct between 0 and 90
      and branch_discount_pct between 0 and 90);
  end if;
end;
$$;

-- Jenis nonaktif: manual (admin) | billing (otomatis karena tagihan). Kosong = manual (data lama).
alter table public.cafes add column if not exists suspended_kind text;
alter table public.cafes add column if not exists referral_code text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cafes_suspended_kind_check') then
    alter table public.cafes add constraint cafes_suspended_kind_check check (suspended_kind is null or suspended_kind in ('manual', 'billing'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'cafes_referral_code_key') then
    alter table public.cafes add constraint cafes_referral_code_key unique (referral_code);
  end if;
end;
$$;
-- Admin membuka nonaktif karena tagihan secara manual → penonaktifan otomatis ditunda 7 hari
alter table public.cafe_subscriptions add column if not exists billing_pause_until timestamptz;

-- ---------------------------------------------------------------------
-- F (tabel). Grup multi-cabang
-- ---------------------------------------------------------------------
create table if not exists public.billing_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 80),
  branch_discount_pct integer check (branch_discount_pct is null or branch_discount_pct between 0 and 90),
  note text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.cafes add column if not exists billing_group_id uuid references public.billing_groups (id) on delete set null;
create index if not exists cafes_billing_group_idx on public.cafes (billing_group_id) where billing_group_id is not null;

-- ---------------------------------------------------------------------
-- D (tabel). Kode promo
-- ---------------------------------------------------------------------
create table if not exists public.platform_promo_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9_-]{3,24}$'),
  description text,
  kind text not null check (kind in ('percent', 'amount')),
  value numeric(12, 2) not null check (value > 0),
  plan_codes text[],                                  -- null = semua paket
  min_months integer not null default 1 check (min_months between 1 and 24),
  first_payment_only boolean not null default false,
  max_redemptions integer check (max_redemptions is null or max_redemptions > 0),
  per_cafe_limit integer not null default 1 check (per_cafe_limit between 1 and 24),
  valid_from timestamptz,
  valid_until timestamptz,
  is_active boolean not null default true,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint platform_promo_codes_percent_check check (kind <> 'percent' or value <= 100),
  constraint platform_promo_codes_dates_check check (valid_until is null or valid_from is null or valid_until > valid_from)
);

-- ---------------------------------------------------------------------
-- E (tabel). Referral & kredit
-- ---------------------------------------------------------------------
create table if not exists public.cafe_referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_cafe_id uuid not null references public.cafes (id) on delete cascade,
  referred_cafe_id uuid not null unique references public.cafes (id) on delete cascade,
  code text not null,
  status text not null default 'pending' check (status in ('pending', 'rewarded', 'cancelled')),
  discount_pct integer not null check (discount_pct between 0 and 90),
  reward_amount numeric(12, 2) not null check (reward_amount >= 0),
  invoice_id uuid references public.subscription_invoices (id) on delete set null,
  claimed_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  rewarded_at timestamptz,
  constraint cafe_referrals_self_check check (referrer_cafe_id <> referred_cafe_id)
);
create index if not exists cafe_referrals_referrer_idx on public.cafe_referrals (referrer_cafe_id, created_at desc);

-- Buku kredit: + didapat (referral/admin), − dipakai (tagihan lunas). Saldo = jumlah semua baris.
create table if not exists public.cafe_credit_ledger (
  id bigint generated always as identity primary key,
  cafe_id uuid not null references public.cafes (id) on delete cascade,
  amount numeric(12, 2) not null check (amount <> 0),
  kind text not null check (kind in ('referral', 'admin', 'invoice')),
  invoice_id uuid references public.subscription_invoices (id) on delete set null,
  referral_id uuid references public.cafe_referrals (id) on delete set null,
  note text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists cafe_credit_ledger_cafe_idx on public.cafe_credit_ledger (cafe_id, created_at desc);
create unique index if not exists cafe_credit_ledger_invoice_uniq on public.cafe_credit_ledger (invoice_id) where kind = 'invoice';
create unique index if not exists cafe_credit_ledger_referral_uniq on public.cafe_credit_ledger (referral_id) where kind = 'referral';

-- Percobaan kode (promo/referral) yang gagal — membatasi tebak-tebakan kode
create table if not exists public.billing_code_attempts (
  id bigint generated always as identity primary key,
  cafe_id uuid not null references public.cafes (id) on delete cascade,
  kind text not null check (kind in ('promo', 'referral')),
  code text,
  created_at timestamptz not null default now()
);
create index if not exists billing_code_attempts_idx on public.billing_code_attempts (cafe_id, created_at desc);

-- ---------------------------------------------------------------------
-- B/C (tabel). Penghitung nomor tagihan + rincian harga tagihan
-- ---------------------------------------------------------------------
create table if not exists public.invoice_number_counters (
  period text primary key check (period ~ '^[0-9]{4}$'),   -- YYMM (WIB)
  last_value integer not null default 0 check (last_value >= 0)
);

alter table public.subscription_invoices add column if not exists list_amount numeric(12, 2);
alter table public.subscription_invoices add column if not exists promo_id uuid references public.platform_promo_codes (id) on delete set null;
alter table public.subscription_invoices add column if not exists promo_code text;
alter table public.subscription_invoices add column if not exists promo_discount numeric(12, 2) not null default 0;
alter table public.subscription_invoices add column if not exists referral_discount numeric(12, 2) not null default 0;
alter table public.subscription_invoices add column if not exists credit_amount numeric(12, 2) not null default 0;
-- Order Midtrans lama (sebelum nominal berubah karena promo/kredit) tetap dikenali webhook
alter table public.subscription_invoices add column if not exists previous_order_ids text[] not null default '{}';
update public.subscription_invoices set list_amount = amount where list_amount is null;
create index if not exists subscription_invoices_promo_idx on public.subscription_invoices (promo_id) where promo_id is not null;
create index if not exists subscription_invoices_paid_idx on public.subscription_invoices (paid_at) where status = 'paid';
do $$
begin
  -- Total boleh 0 (lunas dengan kredit/diskon); metode baru "credit"
  alter table public.subscription_invoices drop constraint if exists subscription_invoices_amount_check;
  alter table public.subscription_invoices add constraint subscription_invoices_amount_check check (amount >= 0);
  alter table public.subscription_invoices drop constraint if exists subscription_invoices_method_check;
  alter table public.subscription_invoices add constraint subscription_invoices_method_check check (method in ('manual_transfer', 'gateway', 'credit'));
  if not exists (select 1 from pg_constraint where conname = 'subscription_invoices_adjust_check') then
    alter table public.subscription_invoices add constraint subscription_invoices_adjust_check
      check (promo_discount >= 0 and referral_discount >= 0 and credit_amount >= 0);
  end if;
end;
$$;

-- Semua tabel baru: RLS menyala, tanpa akses langsung dari browser (hanya lewat fungsi)
alter table public.billing_groups enable row level security;
alter table public.platform_promo_codes enable row level security;
alter table public.cafe_referrals enable row level security;
alter table public.cafe_credit_ledger enable row level security;
alter table public.billing_code_attempts enable row level security;
alter table public.invoice_number_counters enable row level security;
revoke all on public.billing_groups, public.platform_promo_codes, public.cafe_referrals, public.cafe_credit_ledger,
  public.billing_code_attempts, public.invoice_number_counters from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Helper internal
-- ---------------------------------------------------------------------
create or replace function public.pa_rupiah(p numeric)
returns text
language sql
immutable
set search_path = ''
as $$ select 'Rp ' || replace(to_char(coalesce(p, 0), 'FM999,999,999,990'), ',', '.') $$;

-- B. Nomor berikutnya: INV-YYMM-NNNNN, berurutan per bulan. Baris penghitung dikunci sampai transaksi selesai,
-- jadi transaksi yang batal tidak meninggalkan nomor loncat. Bulan berjalan melanjutkan nomor lama (urutan file 14).
create or replace function public.pa_next_invoice_number()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period text := to_char(now() at time zone 'Asia/Jakarta', 'YYMM');
  v_n integer;
  v_number text;
begin
  insert into public.invoice_number_counters (period, last_value)
  values (v_period, coalesce((
    select max((substring(i.number from '^INV-[0-9]{4}-([0-9]+)$'))::integer)
    from public.subscription_invoices i where i.number like 'INV-' || v_period || '-%'), 0))
  on conflict (period) do nothing;
  loop
    update public.invoice_number_counters set last_value = last_value + 1 where period = v_period returning last_value into v_n;
    v_number := 'INV-' || v_period || '-' || lpad(v_n::text, 5, '0');
    exit when not exists (select 1 from public.subscription_invoices i where i.number = v_number);
  end loop;
  return v_number;
end;
$$;

-- F. Diskon cabang: kafe pertama (paling lama) dalam grup harga normal; cabang berikutnya didiskon
create or replace function public.pa_branch_discount_pct(p_cafe uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case when x.rank > 1 then coalesce(g.branch_discount_pct, (select s.branch_discount_pct from public.platform_settings s where s.id), 0) else 0 end
    from (
      select c.id, c.billing_group_id, row_number() over (partition by c.billing_group_id order by c.created_at, c.id) as rank
      from public.cafes c
      where c.billing_group_id = (select c2.billing_group_id from public.cafes c2 where c2.id = p_cafe)
    ) x join public.billing_groups g on g.id = x.billing_group_id
    where x.id = p_cafe), 0)
$$;

-- Harga per bulan untuk kafe & paket: harga khusus (admin) menang; selain itu harga paket − diskon cabang
create or replace function public.pa_plan_price(p_cafe uuid, p_plan text)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select s.price_override from public.cafe_subscriptions s where s.cafe_id = p_cafe and s.plan_code = p_plan),
    (select round(p.price_monthly * (100 - public.pa_branch_discount_pct(p_cafe)) / 100.0, 0) from public.plans p where p.code = p_plan),
    0)
$$;

-- Ringkasan per kafe (file 14) — monthly_price kini memakai pa_plan_price (diskon cabang ikut MRR)
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

-- E. Kode referral: 4 huruf dari nama + 4 acak (tanpa huruf/angka yang mirip)
create or replace function public.pa_referral_code_new(p_name text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_prefix text := left(regexp_replace(upper(coalesce(p_name, '')), '[^A-Z]', '', 'g'), 4);
  v_code text;
begin
  if length(v_prefix) < 2 then v_prefix := 'KAFE'; end if;
  loop
    v_code := v_prefix;
    for i in 1..4 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::integer, 1);
    end loop;
    exit when not exists (select 1 from public.cafes c where c.referral_code = v_code);
  end loop;
  return v_code;
end;
$$;

create or replace function public.cafes_fill_referral_code()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.referral_code is null then
    new.referral_code := public.pa_referral_code_new(new.name);
  end if;
  return new;
end;
$$;
drop trigger if exists cafes_fill_referral_code on public.cafes;
create trigger cafes_fill_referral_code before insert on public.cafes for each row execute function public.cafes_fill_referral_code();

do $$
declare
  r record;
begin
  for r in select c.id, c.name from public.cafes c where c.referral_code is null loop
    update public.cafes set referral_code = public.pa_referral_code_new(r.name) where id = r.id;
  end loop;
end;
$$;

-- Buka nonaktif → jenis nonaktif dikosongkan. Bila sebelumnya nonaktif karena tagihan dan dibuka admin
-- (langganan belum lunas), penonaktifan otomatis ditunda 7 hari agar tidak langsung nonaktif lagi besok pagi.
create or replace function public.cafes_suspend_kind()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.suspended_at is null then
    if old.suspended_kind = 'billing' and old.suspended_at is not null then
      update public.cafe_subscriptions s set billing_pause_until = now() + interval '7 days'
      where s.cafe_id = new.id and (s.current_period_end is null or s.current_period_end < now());
    end if;
    new.suspended_kind := null;
  elsif old.suspended_at is null and new.suspended_kind is null then
    new.suspended_kind := 'manual';
  end if;
  return new;
end;
$$;
drop trigger if exists cafes_suspend_kind on public.cafes;
create trigger cafes_suspend_kind before update of suspended_at on public.cafes for each row execute function public.cafes_suspend_kind();

-- Saldo kredit tersedia: semua buku kredit − kredit yang sedang "dipesan" tagihan menunggu lain
create or replace function public.pa_credit_available(p_cafe uuid, p_except uuid default null)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(0,
    coalesce((select sum(l.amount) from public.cafe_credit_ledger l where l.cafe_id = p_cafe), 0)
    - coalesce((select sum(i.credit_amount) from public.subscription_invoices i
                where i.cafe_id = p_cafe and i.status = 'pending' and i.id is distinct from p_except), 0))
$$;

-- Kafe sudah pernah membayar (tagihan lunas dengan harga normal > 0)?
create or replace function public.pa_cafe_has_paid(p_cafe uuid, p_except uuid default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.subscription_invoices i
                 where i.cafe_id = p_cafe and i.status = 'paid' and coalesce(i.list_amount, i.amount) > 0 and i.id is distinct from p_except)
$$;

-- Diskon promo untuk harga normal tertentu
create or replace function public.pa_promo_discount(p_promo public.platform_promo_codes, p_list numeric)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case when p_promo.id is null then 0
              when p_promo.kind = 'percent' then least(p_list, round(p_list * p_promo.value / 100.0, 0))
              else least(p_list, p_promo.value) end
$$;

-- C. Hitung ulang rincian tagihan menunggu: promo, referral (tagihan pertama), kredit → total.
-- Bila total berubah dan halaman bayar Midtrans sudah dibuat, order lama disimpan (webhook tetap mengenalinya)
-- dan halaman bayar dibuat ulang saat owner menekan Bayar.
create or replace function public.pa_invoice_recalc(p_invoice uuid)
returns public.subscription_invoices
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.subscription_invoices;
  v_promo public.platform_promo_codes;
  v_list numeric;
  v_promo_disc numeric := 0;
  v_ref_disc numeric := 0;
  v_pct integer;
  v_credit numeric;
  v_amount numeric;
begin
  select * into v from public.subscription_invoices i where i.id = p_invoice for update;
  if not found or v.status <> 'pending' then
    return v;
  end if;
  v_list := coalesce(v.list_amount, v.amount);
  if v.promo_id is not null then
    select * into v_promo from public.platform_promo_codes p where p.id = v.promo_id;
    v_promo_disc := public.pa_promo_discount(v_promo, v_list);
  else
    -- Referral: hanya tagihan pertama, tidak digabung promo, satu tagihan menunggu saja
    select r.discount_pct into v_pct from public.cafe_referrals r where r.referred_cafe_id = v.cafe_id and r.status = 'pending';
    if v_pct is not null and v_pct > 0 and not public.pa_cafe_has_paid(v.cafe_id)
       and not exists (select 1 from public.subscription_invoices i where i.cafe_id = v.cafe_id and i.status = 'pending'
                       and i.id <> v.id and i.referral_discount > 0) then
      v_ref_disc := round(v_list * v_pct / 100.0, 0);
    end if;
  end if;
  v_credit := least(public.pa_credit_available(v.cafe_id, v.id), greatest(v_list - v_promo_disc - v_ref_disc, 0));
  v_amount := greatest(v_list - v_promo_disc - v_ref_disc - v_credit, 0);

  update public.subscription_invoices i
  set list_amount = v_list, promo_discount = v_promo_disc, referral_discount = v_ref_disc, credit_amount = v_credit, amount = v_amount,
      previous_order_ids = case when v_amount <> v.amount and v.provider_order_id is not null
                                then array_append(v.previous_order_ids, v.provider_order_id) else v.previous_order_ids end,
      provider_order_id = case when v_amount <> v.amount then null else v.provider_order_id end,
      checkout_url = case when v_amount <> v.amount then null else v.checkout_url end,
      checkout_created_at = case when v_amount <> v.amount then null else v.checkout_created_at end,
      updated_at = case when v_amount <> v.amount or v_credit <> v.credit_amount or v_ref_disc <> v.referral_discount then now() else v.updated_at end
  where i.id = v.id
  returning * into v;
  return v;
end;
$$;

-- Total 0 → lunas dengan kredit/diskon (memperpanjang langganan seperti pembayaran biasa)
create or replace function public.pa_invoice_settle_zero(p_invoice uuid)
returns public.subscription_invoices
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.subscription_invoices;
begin
  select * into v from public.subscription_invoices i where i.id = p_invoice;
  if found and v.status = 'pending' and v.amount = 0 then
    perform public.pa_apply_invoice_paid(v.id, 'credit', null, now(), null, 'sistem', 'Lunas dengan kredit/diskon');
    select * into v from public.subscription_invoices i where i.id = p_invoice;
  end if;
  return v;
end;
$$;

-- Hitung ulang semua tagihan menunggu kafe (setelah kredit/referral berubah). Tagihan yang sedang diproses Midtrans dilewati.
create or replace function public.pa_invoice_recalc_cafe(p_cafe uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  for r in select i.id from public.subscription_invoices i
           where i.cafe_id = p_cafe and i.status = 'pending' and coalesce(i.provider_status, '') <> 'pending'
           order by i.created_at
  loop
    perform public.pa_invoice_recalc(r.id);
    perform public.pa_invoice_settle_zero(r.id);
  end loop;
end;
$$;

create or replace function public.pa_invoice_json(p public.subscription_invoices)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select (to_jsonb(p) - 'provider_payload' - 'previous_order_ids') || jsonb_build_object(
    'state', case when p.status = 'pending' and p.due_at < now() then 'overdue' else p.status end,
    'cafe_name', (select c.name from public.cafes c where c.id = p.cafe_id),
    'plan_name', (select pl.name from public.plans pl where pl.code = p.plan_code),
    'list_amount', coalesce(p.list_amount, p.amount)
  )
$$;

-- B. Sisip tagihan (file 14) — nomor dari penghitung tanpa loncat; harga normal disimpan
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
  insert into public.subscription_invoices (number, cafe_id, plan_code, months, period_start, period_end, amount, list_amount, due_at, source, created_by, note)
  values (
    public.pa_next_invoice_number(),
    p_cafe, p_plan, p_months, p_start, p_start + make_interval(months => p_months), round(p_amount, 2), round(p_amount, 2), p_due, p_source, p_actor,
    nullif(left(trim(coalesce(p_note, '')), 300), '')
  )
  returning * into v;
  return v;
end;
$$;

-- Admin membuat tagihan (file 14) + rincian kredit/referral otomatis
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
  v := public.pa_invoice_recalc(v.id);
  perform public.pa_log('invoice.create', p_cafe, 'invoice', v.id::text, null, public.pa_invoice_json(v), p_note);
  v := public.pa_invoice_settle_zero(v.id);
  return public.pa_invoice_json(v);
end;
$$;

-- ---------------------------------------------------------------------
-- Setelah tagihan lunas: catat pemakaian kredit, hadiah referral, buka nonaktif karena tagihan
-- (berlaku untuk semua jalur lunas: Midtrans, transfer manual, kredit)
-- ---------------------------------------------------------------------
create or replace function public.subscription_invoice_on_paid()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ref public.cafe_referrals;
  v_cafe public.cafes;
  v_referred_name text;
begin
  if new.status <> 'paid' or old.status = 'paid' then
    return null;
  end if;

  if new.credit_amount > 0 then
    insert into public.cafe_credit_ledger (cafe_id, amount, kind, invoice_id, note)
    values (new.cafe_id, -new.credit_amount, 'invoice', new.id, 'Dipakai untuk ' || new.number)
    on conflict do nothing;
  end if;

  -- Referral: pembayaran pertama kafe yang diundang → pengundang dapat kredit
  select * into v_ref from public.cafe_referrals r where r.referred_cafe_id = new.cafe_id and r.status = 'pending' for update;
  if found and coalesce(new.list_amount, new.amount) > 0 then
    update public.cafe_referrals set status = 'rewarded', rewarded_at = now(), invoice_id = new.id where id = v_ref.id;
    v_referred_name := (select c.name from public.cafes c where c.id = new.cafe_id);
    if v_ref.reward_amount > 0 then
      insert into public.cafe_credit_ledger (cafe_id, amount, kind, referral_id, note)
      values (v_ref.referrer_cafe_id, v_ref.reward_amount, 'referral', v_ref.id, 'Referral: ' || coalesce(v_referred_name, '-'))
      on conflict do nothing;
      perform public.pa_notify_owner(v_ref.referrer_cafe_id, 'referral_reward', 'success', 'Kredit referral masuk',
        coalesce(v_referred_name, 'Kafe yang Anda undang') || ' sudah berlangganan. Kredit ' || public.pa_rupiah(v_ref.reward_amount)
          || ' otomatis memotong tagihan berikutnya.',
        '/settings/subscription', 'referral_reward:' || v_ref.id);
      -- Kredit baru langsung memotong tagihan pengundang yang masih menunggu
      perform public.pa_invoice_recalc_cafe(v_ref.referrer_cafe_id);
    end if;
    perform public.pa_log('referral.rewarded', v_ref.referrer_cafe_id, 'referral', v_ref.id::text, null,
      jsonb_build_object('referred_cafe_id', new.cafe_id, 'invoice', new.number, 'reward', v_ref.reward_amount), null, null, 'sistem');
  end if;

  -- Pengingat tagihan & penonaktifan di sisi owner selesai
  update public.cafe_notifications set expires_at = now()
  where cafe_id = new.cafe_id and kind in ('invoice_overdue_3', 'suspend_warning', 'cafe_suspended')
    and (expires_at is null or expires_at > now());

  -- Nonaktif karena tagihan → aktif lagi otomatis (periode yang dibayar masih berjalan)
  select * into v_cafe from public.cafes c where c.id = new.cafe_id for update;
  if v_cafe.suspended_at is not null and v_cafe.suspended_kind = 'billing' and new.period_end > now() then
    update public.cafes set suspended_at = null, suspended_reason = null, suspended_kind = null where id = new.cafe_id;
    update public.cafe_subscriptions set billing_pause_until = null where cafe_id = new.cafe_id;
    perform public.pa_log('cafe.unsuspend', new.cafe_id, 'cafe', new.cafe_id::text,
      jsonb_build_object('suspended_at', v_cafe.suspended_at, 'suspended_reason', v_cafe.suspended_reason, 'suspended_kind', 'billing'),
      jsonb_build_object('suspended_at', null, 'suspended_reason', null),
      'Otomatis: tagihan ' || new.number || ' lunas', null, 'sistem');
    perform public.pa_notify_owner(new.cafe_id, 'cafe_reactivated', 'success', 'Kafe aktif kembali',
      'Pembayaran ' || new.number || ' diterima. Pesanan baru sudah bisa diterima lagi.', null, 'cafe_reactivated:' || new.id,
      now() + interval '3 days');
    perform public.pa_notify_admin('cafe_reactivated', 'success', 'Aktif lagi setelah bayar: ' || v_cafe.name,
      new.number || ' · ' || public.pa_rupiah(new.amount), new.cafe_id, '/kafe/' || new.cafe_id, 'cafe_reactivated:' || new.id);
  end if;
  return null;
end;
$$;
drop trigger if exists subscription_invoice_on_paid on public.subscription_invoices;
create trigger subscription_invoice_on_paid after update of status on public.subscription_invoices
  for each row execute function public.subscription_invoice_on_paid();

-- Gateway (file 14): order lama (sebelum nominal berubah) tetap dikenali
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
  select * into v from public.subscription_invoices i
  where i.provider_order_id = p_provider_order_id or p_provider_order_id = any (i.previous_order_ids)
  order by (i.provider_order_id = p_provider_order_id) desc nulls last
  limit 1
  for update;
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

-- ---------------------------------------------------------------------
-- G. Penagihan harian (file 14, diperluas): tagihan H-7 dengan harga cabang + kredit/referral,
--    tandai past_due, lalu nonaktif otomatis setelah N hari.
-- ---------------------------------------------------------------------
-- Tanggal nonaktif otomatis untuk satu langganan (null = tidak berlaku)
create or replace function public.pa_suspend_due_at(p_cafe uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select case when st.billing_suspend_enabled
              and s.status in ('active', 'past_due')
              and s.current_period_end is not null
              and s.current_period_end >= st.billing_enforce_from
              and public.pa_plan_price(s.cafe_id, s.plan_code) > 0
         then greatest(s.current_period_end + make_interval(days => st.billing_suspend_after_days), coalesce(s.billing_pause_until, '-infinity'::timestamptz))
         end
  from public.cafe_subscriptions s cross join public.platform_settings st
  where s.cafe_id = p_cafe and st.id
$$;

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
  v_suspended integer := 0;
  v_days integer := (select s.billing_suspend_after_days from public.platform_settings s where s.id);
begin
  for r in
    select s.*, public.pa_plan_price(s.cafe_id, s.plan_code) as price
    from public.cafe_subscriptions s
    join public.cafes c on c.id = s.cafe_id
    where c.suspended_at is null
      and s.status in ('active', 'past_due', 'trialing')
    for update of s
  loop
    continue when coalesce(r.price, 0) <= 0;
    v_raw := case when r.status = 'trialing' then r.trial_ends_at else r.current_period_end end;
    continue when v_raw is null or v_raw > now() + interval '7 days';
    v_start := greatest(v_raw, now());
    continue when exists (
      select 1 from public.subscription_invoices i
      where i.cafe_id = r.cafe_id and (i.status = 'pending' or (i.status = 'paid' and i.period_end > v_start + interval '1 day'))
    );
    v_inv := public.pa_invoice_insert(r.cafe_id, r.plan_code, 1, r.price, v_start, greatest(v_raw, now() + interval '3 days'), 'system', null, null);
    v_inv := public.pa_invoice_recalc(v_inv.id);
    perform public.pa_log('invoice.create', r.cafe_id, 'invoice', v_inv.id::text, null, public.pa_invoice_json(v_inv), 'Tagihan otomatis', null, 'sistem');
    perform public.pa_invoice_settle_zero(v_inv.id);
    v_created := v_created + 1;
  end loop;

  with changed as (
    update public.cafe_subscriptions s set status = 'past_due', updated_at = now()
    where s.status = 'active' and s.current_period_end is not null and s.current_period_end < now()
    returning s.cafe_id
  )
  select count(*) into v_past_due from changed;

  -- Nonaktif otomatis: lewat N hari dari akhir periode, masih ada tagihan menunggu
  for r in
    select c.id, c.name, s.current_period_end, public.pa_suspend_due_at(c.id) as suspend_at
    from public.cafes c join public.cafe_subscriptions s on s.cafe_id = c.id
    where c.suspended_at is null and s.status = 'past_due'
      and exists (select 1 from public.subscription_invoices i where i.cafe_id = c.id and i.status = 'pending')
    for update of c
  loop
    continue when r.suspend_at is null or r.suspend_at > now();
    update public.cafes set suspended_at = now(), suspended_kind = 'billing',
      suspended_reason = 'Langganan belum dibayar ' || v_days || ' hari setelah masa berlaku habis'
    where id = r.id;
    perform public.pa_log('cafe.suspend', r.id, 'cafe', r.id::text, jsonb_build_object('suspended_at', null),
      jsonb_build_object('suspended_at', now(), 'suspended_kind', 'billing', 'period_end', r.current_period_end),
      'Otomatis: tagihan belum dibayar', null, 'sistem');
    perform public.pa_notify_owner(r.id, 'cafe_suspended', 'danger', 'Kafe dinonaktifkan sementara',
      'Langganan belum dibayar sejak ' || to_char(r.current_period_end at time zone 'Asia/Jakarta', 'DD/MM/YYYY')
        || '. Bayar tagihan di Pengaturan → Langganan; kafe aktif lagi otomatis begitu pembayaran terkonfirmasi.',
      '/settings/subscription', 'cafe_suspended:' || r.id || ':' || to_char(r.current_period_end, 'YYYYMMDD'), null, true);
    perform public.pa_notify_admin('cafe_suspended', 'warning', 'Dinonaktifkan otomatis: ' || r.name,
      'Tagihan belum dibayar ' || v_days || ' hari setelah masa berlaku habis', r.id, '/kafe/' || r.id,
      'cafe_suspended:' || r.id || ':' || to_char(r.current_period_end, 'YYYYMMDD'));
    v_suspended := v_suspended + 1;
  end loop;

  perform public.pa_snapshot_mrr();
  return jsonb_build_object('invoices_created', v_created, 'marked_past_due', v_past_due, 'suspended', v_suspended, 'ran_at', now());
end;
$$;

-- Pengecekan harian (file 16) + pengingat telat 3 hari & peringatan 2 hari sebelum nonaktif
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
           || '. Fitur paket tetap jalan 7 hari setelah masa berlaku habis.', '/settings/subscription', 'invoice_overdue:' || r.id) then
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

-- Status platform untuk owner/staff (file 14) + jenis nonaktif & tanggal nonaktif otomatis
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
    'grace_until', case when v_sub.current_period_end is not null then v_sub.current_period_end + interval '7 days' end,
    'in_grace', v_sub.status in ('active', 'past_due') and v_sub.current_period_end is not null
                and v_sub.current_period_end < now() and v_sub.current_period_end + interval '7 days' > now(),
    'suspend_at', case when v_cafe.suspended_at is null and v_sub.current_period_end < now()
                            and exists (select 1 from public.subscription_invoices i where i.cafe_id = p_cafe_id and i.status = 'pending')
                       then public.pa_suspend_due_at(p_cafe_id) end,
    'pending_invoices', (select count(*) from public.subscription_invoices i where i.cafe_id = p_cafe_id and i.status = 'pending')
  );
end;
$$;

-- ---------------------------------------------------------------------
-- Owner: tagihan, minta tagihan, promo, referral, kuitansi
-- ---------------------------------------------------------------------
create or replace function public.pa_owner_invoice_json(p public.subscription_invoices)
returns jsonb
language sql
stable
set search_path = ''
as $$ select public.pa_invoice_json(p) - 'created_by' - 'provider_order_id' - 'note' - 'provider' - 'provider_status' - 'checkout_url' - 'promo_id' $$;

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
  return (select coalesce(jsonb_agg(public.pa_owner_invoice_json(i) order by i.created_at desc), '[]'::jsonb)
    from (select * from public.subscription_invoices x where x.cafe_id = p_cafe_id and x.status <> 'void' order by x.created_at desc limit 24) i);
end;
$$;

-- Owner memilih paket/perpanjang sendiri (file 14). Kafe nonaktif KARENA TAGIHAN tetap boleh membayar.
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
  if exists (select 1 from public.cafes c where c.id = p_cafe_id and c.suspended_at is not null and coalesce(c.suspended_kind, 'manual') <> 'billing') then
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
    return public.pa_owner_invoice_json(v_existing);
  end if;
  if exists (select 1 from public.subscription_invoices i where i.cafe_id = p_cafe_id and i.status = 'pending' and i.source <> 'owner') then
    raise exception 'Masih ada tagihan yang belum dibayar. Selesaikan tagihan itu dulu.' using errcode = 'P0001', hint = 'invoice_pending';
  end if;
  update public.subscription_invoices set status = 'void', note = 'Diganti owner', updated_at = now()
  where cafe_id = p_cafe_id and status = 'pending' and source = 'owner';

  v := public.pa_invoice_insert(p_cafe_id, p_plan, p_months, public.pa_plan_price(p_cafe_id, p_plan) * p_months,
         public.pa_next_period_start(p_cafe_id, p_plan), now() + interval '3 days', 'owner', v_user, null);
  v := public.pa_invoice_recalc(v.id);
  perform public.pa_log('invoice.create', p_cafe_id, 'invoice', v.id::text, null, public.pa_invoice_json(v), 'Diminta owner', v_user, null);
  v := public.pa_invoice_settle_zero(v.id);
  return public.pa_owner_invoice_json(v);
end;
$$;

-- Batas percobaan kode yang salah: 10 per jam per kafe
create or replace function public.pa_code_attempts_ok(p_cafe uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select count(*) from public.billing_code_attempts a where a.cafe_id = p_cafe and a.created_at > now() - interval '1 hour') < 10
$$;

-- D. Owner memasang / melepas kode promo di tagihan menunggu. Kode salah → {ok:false, error} (tercatat untuk batas percobaan).
create or replace function public.owner_invoice_apply_promo(p_cafe_id uuid, p_invoice uuid, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v public.subscription_invoices;
  v_code text := upper(trim(coalesce(p_code, '')));
  v_promo public.platform_promo_codes;
  v_error text;
begin
  if not public.pa_is_cafe_owner(p_cafe_id, v_user) then
    raise exception 'Hanya owner kafe ini' using errcode = '42501';
  end if;
  select * into v from public.subscription_invoices i where i.id = p_invoice and i.cafe_id = p_cafe_id for update;
  if not found or v.status <> 'pending' then
    raise exception 'Tagihan tidak ditemukan atau sudah dibayar' using errcode = 'P0001';
  end if;
  if v.provider_status = 'pending' then
    raise exception 'Pembayaran tagihan ini sedang diproses Midtrans. Selesaikan atau tunggu sampai kedaluwarsa.' using errcode = 'P0001';
  end if;

  if v_code = '' then
    update public.subscription_invoices set promo_id = null, promo_code = null where id = v.id;
    v := public.pa_invoice_recalc(v.id);
    perform public.pa_log('invoice.promo', p_cafe_id, 'invoice', v.id::text, jsonb_build_object('promo_code', v.promo_code), jsonb_build_object('promo_code', null), 'Promo dilepas', v_user, null);
    return jsonb_build_object('ok', true, 'invoice', public.pa_owner_invoice_json(v));
  end if;

  if not public.pa_code_attempts_ok(p_cafe_id) then
    return jsonb_build_object('ok', false, 'error', 'Terlalu banyak percobaan kode. Coba lagi 1 jam lagi.');
  end if;

  select * into v_promo from public.platform_promo_codes p where p.code = v_code;
  if not found or not v_promo.is_active or (v_promo.valid_from is not null and v_promo.valid_from > now()) then
    v_error := 'Kode promo tidak dikenal';
  elsif v_promo.valid_until is not null and v_promo.valid_until < now() then
    v_error := 'Kode promo sudah berakhir';
  elsif v_promo.plan_codes is not null and not (v.plan_code = any (v_promo.plan_codes)) then
    v_error := 'Kode promo tidak berlaku untuk paket ini';
  elsif v.months < v_promo.min_months then
    v_error := 'Kode promo berlaku untuk langganan minimal ' || v_promo.min_months || ' bulan';
  elsif v_promo.first_payment_only and public.pa_cafe_has_paid(p_cafe_id, v.id) then
    v_error := 'Kode promo khusus pembayaran pertama';
  elsif v.referral_discount > 0 then
    v_error := 'Tagihan ini sudah mendapat diskon referral; kode promo tidak bisa digabung';
  elsif v_promo.max_redemptions is not null and (select count(*) from public.subscription_invoices i
          where i.promo_id = v_promo.id and i.status in ('pending', 'paid') and i.id <> v.id) >= v_promo.max_redemptions then
    v_error := 'Kuota kode promo sudah habis';
  elsif (select count(*) from public.subscription_invoices i
          where i.promo_id = v_promo.id and i.cafe_id = p_cafe_id and i.status in ('pending', 'paid') and i.id <> v.id) >= v_promo.per_cafe_limit then
    v_error := 'Kode promo sudah pernah dipakai kafe ini';
  end if;

  if v_error is not null then
    insert into public.billing_code_attempts (cafe_id, kind, code) values (p_cafe_id, 'promo', left(v_code, 40));
    return jsonb_build_object('ok', false, 'error', v_error);
  end if;

  update public.subscription_invoices set promo_id = v_promo.id, promo_code = v_promo.code where id = v.id;
  v := public.pa_invoice_recalc(v.id);
  perform public.pa_log('invoice.promo', p_cafe_id, 'invoice', v.id::text, null,
    jsonb_build_object('promo_code', v_promo.code, 'promo_discount', v.promo_discount, 'amount', v.amount), null, v_user, null);
  v := public.pa_invoice_settle_zero(v.id);
  return jsonb_build_object('ok', true, 'invoice', public.pa_owner_invoice_json(v));
end;
$$;

-- E. Info referral untuk owner
create or replace function public.owner_referral_info(p_cafe_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cafe public.cafes;
  v_settings public.platform_settings;
  v_claim public.cafe_referrals;
begin
  if not public.pa_is_cafe_owner(p_cafe_id, (select auth.uid())) then
    raise exception 'Hanya owner kafe ini' using errcode = '42501';
  end if;
  select * into v_cafe from public.cafes c where c.id = p_cafe_id;
  select * into v_settings from public.platform_settings s where s.id;
  select * into v_claim from public.cafe_referrals r where r.referred_cafe_id = p_cafe_id;
  return jsonb_build_object(
    'code', v_cafe.referral_code,
    'reward_amount', v_settings.referral_credit,
    'discount_pct', v_settings.referral_discount_pct,
    'credit_balance', coalesce((select sum(l.amount) from public.cafe_credit_ledger l where l.cafe_id = p_cafe_id), 0),
    'credit_available', public.pa_credit_available(p_cafe_id),
    'earned_total', coalesce((select sum(l.amount) from public.cafe_credit_ledger l where l.cafe_id = p_cafe_id and l.kind = 'referral'), 0),
    'referrals', coalesce((select jsonb_agg(jsonb_build_object('cafe_name', c.name, 'status', r.status, 'created_at', r.created_at,
                                 'rewarded_at', r.rewarded_at, 'reward_amount', r.reward_amount) order by r.created_at desc)
                           from public.cafe_referrals r join public.cafes c on c.id = r.referred_cafe_id
                           where r.referrer_cafe_id = p_cafe_id), '[]'::jsonb),
    'ledger', coalesce((select jsonb_agg(jsonb_build_object('amount', l.amount, 'kind', l.kind, 'note', l.note, 'created_at', l.created_at) order by l.created_at desc)
                        from (select * from public.cafe_credit_ledger x where x.cafe_id = p_cafe_id order by x.created_at desc limit 20) l), '[]'::jsonb),
    'claimed', case when v_claim.id is not null then jsonb_build_object(
                 'code', v_claim.code, 'status', v_claim.status, 'discount_pct', v_claim.discount_pct,
                 'referrer_name', (select c.name from public.cafes c where c.id = v_claim.referrer_cafe_id)) end,
    'can_claim', v_claim.id is null and v_cafe.created_at > now() - interval '30 days' and not public.pa_cafe_has_paid(p_cafe_id),
    'claim_until', v_cafe.created_at + interval '30 days'
  );
end;
$$;

-- E. Kafe baru memasukkan kode referral (maks. 30 hari sejak daftar, sebelum pembayaran pertama)
create or replace function public.owner_referral_claim(p_cafe_id uuid, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g'));
  v_cafe public.cafes;
  v_referrer public.cafes;
  v_settings public.platform_settings;
  v_ref public.cafe_referrals;
  v_error text;
begin
  if not public.pa_is_cafe_owner(p_cafe_id, v_user) then
    raise exception 'Hanya owner kafe ini' using errcode = '42501';
  end if;
  select * into v_cafe from public.cafes c where c.id = p_cafe_id for update;
  if exists (select 1 from public.cafe_referrals r where r.referred_cafe_id = p_cafe_id) then
    return jsonb_build_object('ok', false, 'error', 'Kafe ini sudah memakai kode referral');
  end if;
  if v_cafe.created_at <= now() - interval '30 days' or public.pa_cafe_has_paid(p_cafe_id) then
    return jsonb_build_object('ok', false, 'error', 'Kode referral hanya bisa dipakai di 30 hari pertama, sebelum pembayaran pertama');
  end if;
  if not public.pa_code_attempts_ok(p_cafe_id) then
    return jsonb_build_object('ok', false, 'error', 'Terlalu banyak percobaan kode. Coba lagi 1 jam lagi.');
  end if;
  select * into v_referrer from public.cafes c where c.referral_code = v_code;
  if not found then
    v_error := 'Kode referral tidak dikenal';
  elsif v_referrer.id = p_cafe_id then
    v_error := 'Tidak bisa memakai kode milik kafe sendiri';
  end if;
  if v_error is not null then
    insert into public.billing_code_attempts (cafe_id, kind, code) values (p_cafe_id, 'referral', left(v_code, 40));
    return jsonb_build_object('ok', false, 'error', v_error);
  end if;

  select * into v_settings from public.platform_settings s where s.id;
  insert into public.cafe_referrals (referrer_cafe_id, referred_cafe_id, code, discount_pct, reward_amount, claimed_by)
  values (v_referrer.id, p_cafe_id, v_code, v_settings.referral_discount_pct, v_settings.referral_credit, v_user)
  returning * into v_ref;
  perform public.pa_log('referral.claim', p_cafe_id, 'referral', v_ref.id::text, null,
    jsonb_build_object('referrer_cafe_id', v_referrer.id, 'code', v_code, 'discount_pct', v_ref.discount_pct, 'reward', v_ref.reward_amount), null, v_user, null);
  -- Diskon langsung berlaku di tagihan menunggu (bila ada)
  perform public.pa_invoice_recalc_cafe(p_cafe_id);
  return jsonb_build_object('ok', true, 'referrer_name', v_referrer.name, 'discount_pct', v_ref.discount_pct);
end;
$$;

-- H. Data kuitansi (owner kafe itu atau admin platform dengan 2FA). PDF dibuat Edge Function subscription-billing.
create or replace function public.invoice_receipt(p_invoice uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.subscription_invoices;
  v_settings public.platform_settings;
begin
  select * into v from public.subscription_invoices i where i.id = p_invoice;
  if not found or not (public.pa_is_cafe_owner(v.cafe_id, (select auth.uid())) or public.is_platform_admin()) then
    raise exception 'Tagihan tidak ditemukan' using errcode = 'P0002';
  end if;
  if v.status <> 'paid' then
    raise exception 'Kuitansi tersedia setelah tagihan lunas' using errcode = 'P0001';
  end if;
  select * into v_settings from public.platform_settings s where s.id;
  return jsonb_build_object(
    'receipt_number', 'KW-' || substr(v.number, 5),
    'invoice_number', v.number,
    'issuer', jsonb_build_object('name', v_settings.billing_company_name, 'address', v_settings.billing_company_address,
                                 'email', v_settings.billing_company_email, 'tax_id', v_settings.billing_tax_id),
    'cafe', (select jsonb_build_object('name', c.name, 'address', c.address, 'phone', c.phone) from public.cafes c where c.id = v.cafe_id),
    'owner', (select jsonb_build_object('name', pr.full_name, 'email', u.email)
              from public.profiles pr left join auth.users u on u.id = pr.id
              where pr.cafe_id = v.cafe_id and pr.role::text = 'owner' order by pr.created_at limit 1),
    'plan_name', (select p.name from public.plans p where p.code = v.plan_code),
    'months', v.months, 'period_start', v.period_start, 'period_end', v.period_end,
    'list_amount', coalesce(v.list_amount, v.amount), 'promo_code', v.promo_code, 'promo_discount', v.promo_discount,
    'referral_discount', v.referral_discount, 'credit_amount', v.credit_amount, 'amount', v.amount,
    'paid_at', v.paid_at, 'method', v.method, 'payment_ref', v.payment_ref
  );
end;
$$;

-- ---------------------------------------------------------------------
-- Admin: promo
-- ---------------------------------------------------------------------
create or replace function public.pa_promo_json(p public.platform_promo_codes)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select to_jsonb(p) || jsonb_build_object(
    'used', (select count(*) from public.subscription_invoices i where i.promo_id = p.id and i.status = 'paid'),
    'reserved', (select count(*) from public.subscription_invoices i where i.promo_id = p.id and i.status = 'pending'),
    'discount_total', coalesce((select sum(i.promo_discount) from public.subscription_invoices i where i.promo_id = p.id and i.status = 'paid'), 0),
    'state', case when not p.is_active then 'inactive'
                  when p.valid_until is not null and p.valid_until < now() then 'expired'
                  when p.valid_from is not null and p.valid_from > now() then 'scheduled'
                  when p.max_redemptions is not null and (select count(*) from public.subscription_invoices i where i.promo_id = p.id and i.status in ('pending', 'paid')) >= p.max_redemptions then 'exhausted'
                  else 'active' end
  )
$$;

create or replace function public.pa_promos_list()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.pa_require();
  return coalesce((select jsonb_agg(public.pa_promo_json(p) order by p.is_active desc, p.created_at desc) from public.platform_promo_codes p), '[]'::jsonb);
end;
$$;

create or replace function public.pa_promo_upsert(
  p_id uuid, p_code text, p_description text, p_kind text, p_value numeric, p_plan_codes text[], p_min_months integer,
  p_first_payment_only boolean, p_max_redemptions integer, p_per_cafe_limit integer, p_valid_from timestamptz, p_valid_until timestamptz,
  p_is_active boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.pa_require();
  v_code text := upper(trim(coalesce(p_code, '')));
  v_before public.platform_promo_codes;
  v public.platform_promo_codes;
  v_plans text[] := nullif(p_plan_codes, '{}');
begin
  if v_code !~ '^[A-Z0-9_-]{3,24}$' then
    raise exception 'Kode 3–24 karakter: huruf, angka, - atau _' using errcode = 'P0001';
  end if;
  if p_kind not in ('percent', 'amount') then
    raise exception 'Jenis diskon tidak dikenal' using errcode = 'P0001';
  end if;
  if p_value is null or p_value <= 0 or (p_kind = 'percent' and p_value > 100) then
    raise exception '%', case when p_kind = 'percent' then 'Persen diskon 1–100' else 'Nominal diskon harus lebih dari 0' end using errcode = 'P0001';
  end if;
  if v_plans is not null and exists (select 1 from unnest(v_plans) x where not exists (select 1 from public.plans p where p.code = x)) then
    raise exception 'Paket tidak dikenal' using errcode = 'P0001';
  end if;
  if p_valid_from is not null and p_valid_until is not null and p_valid_until <= p_valid_from then
    raise exception 'Tanggal berakhir harus setelah tanggal mulai' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.platform_promo_codes p where p.code = v_code and p.id is distinct from p_id) then
    raise exception 'Kode promo sudah dipakai' using errcode = 'P0001';
  end if;

  if p_id is null then
    insert into public.platform_promo_codes (code, description, kind, value, plan_codes, min_months, first_payment_only, max_redemptions,
      per_cafe_limit, valid_from, valid_until, is_active, created_by)
    values (v_code, nullif(left(trim(coalesce(p_description, '')), 200), ''), p_kind, p_value, v_plans, coalesce(p_min_months, 1),
      coalesce(p_first_payment_only, false), p_max_redemptions, coalesce(p_per_cafe_limit, 1), p_valid_from, p_valid_until,
      coalesce(p_is_active, true), v_actor)
    returning * into v;
    perform public.pa_log('promo.create', null, 'promo', v.id::text, null, to_jsonb(v));
  else
    select * into v_before from public.platform_promo_codes p where p.id = p_id for update;
    if not found then
      raise exception 'Kode promo tidak ditemukan' using errcode = 'P0002';
    end if;
    if v_before.code <> v_code and exists (select 1 from public.subscription_invoices i where i.promo_id = p_id) then
      raise exception 'Kode yang sudah dipakai tidak bisa diganti; buat kode baru' using errcode = 'P0001';
    end if;
    update public.platform_promo_codes set code = v_code, description = nullif(left(trim(coalesce(p_description, '')), 200), ''),
      kind = p_kind, value = p_value, plan_codes = v_plans, min_months = coalesce(p_min_months, 1),
      first_payment_only = coalesce(p_first_payment_only, false), max_redemptions = p_max_redemptions,
      per_cafe_limit = coalesce(p_per_cafe_limit, 1), valid_from = p_valid_from, valid_until = p_valid_until,
      is_active = coalesce(p_is_active, true), updated_at = now()
    where id = p_id
    returning * into v;
    perform public.pa_log('promo.update', null, 'promo', v.id::text, to_jsonb(v_before) - 'updated_at', to_jsonb(v) - 'updated_at');
  end if;
  return public.pa_promo_json(v);
end;
$$;

-- ---------------------------------------------------------------------
-- Admin: referral, kredit, grup cabang, pengaturan penagihan
-- ---------------------------------------------------------------------
create or replace function public.pa_referrals_list(p_limit integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.pa_require();
  return jsonb_build_object(
    'summary', (select jsonb_build_object(
        'total', count(*), 'pending', count(*) filter (where r.status = 'pending'), 'rewarded', count(*) filter (where r.status = 'rewarded'),
        'reward_total', coalesce(sum(r.reward_amount) filter (where r.status = 'rewarded'), 0),
        'discount_total', coalesce((select sum(i.referral_discount) from public.subscription_invoices i where i.status = 'paid'), 0))
      from public.cafe_referrals r),
    'credit_outstanding', coalesce((select sum(l.amount) from public.cafe_credit_ledger l), 0),
    'rows', coalesce((select jsonb_agg(x order by x ->> 'created_at' desc) from (
        select jsonb_build_object('id', r.id, 'code', r.code, 'status', r.status, 'created_at', r.created_at, 'rewarded_at', r.rewarded_at,
          'reward_amount', r.reward_amount, 'discount_pct', r.discount_pct,
          'referrer_cafe_id', r.referrer_cafe_id, 'referrer_name', a.name, 'referred_cafe_id', r.referred_cafe_id, 'referred_name', b.name) as x
        from public.cafe_referrals r join public.cafes a on a.id = r.referrer_cafe_id join public.cafes b on b.id = r.referred_cafe_id
        order by r.created_at desc limit least(greatest(coalesce(p_limit, 50), 1), 200)) t), '[]'::jsonb)
  );
end;
$$;

-- Penagihan satu kafe (kartu di detail kafe)
create or replace function public.pa_cafe_billing(p_cafe uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cafe public.cafes;
begin
  perform public.pa_require();
  select * into v_cafe from public.cafes c where c.id = p_cafe;
  if not found then
    raise exception 'Kafe tidak ditemukan' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'referral_code', v_cafe.referral_code,
    'suspended_kind', case when v_cafe.suspended_at is not null then coalesce(v_cafe.suspended_kind, 'manual') end,
    'suspend_at', public.pa_suspend_due_at(p_cafe),
    'billing_pause_until', (select s.billing_pause_until from public.cafe_subscriptions s where s.cafe_id = p_cafe),
    'credit_balance', coalesce((select sum(l.amount) from public.cafe_credit_ledger l where l.cafe_id = p_cafe), 0),
    'credit_available', public.pa_credit_available(p_cafe),
    'ledger', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'amount', l.amount, 'kind', l.kind, 'note', l.note, 'created_at', l.created_at) order by l.created_at desc)
                        from (select * from public.cafe_credit_ledger x where x.cafe_id = p_cafe order by x.created_at desc limit 20) l), '[]'::jsonb),
    'group', (select jsonb_build_object('id', g.id, 'name', g.name) from public.billing_groups g where g.id = v_cafe.billing_group_id),
    'branch_discount_pct', public.pa_branch_discount_pct(p_cafe),
    'referred_by', (select jsonb_build_object('cafe_id', r.referrer_cafe_id, 'name', c.name, 'status', r.status)
                    from public.cafe_referrals r join public.cafes c on c.id = r.referrer_cafe_id where r.referred_cafe_id = p_cafe),
    'referrals_made', (select count(*) from public.cafe_referrals r where r.referrer_cafe_id = p_cafe)
  );
end;
$$;

create or replace function public.pa_credit_adjust(p_cafe uuid, p_amount numeric, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.pa_require();
  v_note text := nullif(left(trim(coalesce(p_note, '')), 200), '');
  v_balance numeric;
  v_row public.cafe_credit_ledger;
begin
  if not exists (select 1 from public.cafes c where c.id = p_cafe) then
    raise exception 'Kafe tidak ditemukan' using errcode = 'P0002';
  end if;
  if p_amount is null or p_amount = 0 or abs(p_amount) > 10000000 then
    raise exception 'Nominal kredit tidak valid' using errcode = 'P0001';
  end if;
  if v_note is null then
    raise exception 'Isi alasan perubahan kredit' using errcode = 'P0001';
  end if;
  perform 1 from public.cafes c where c.id = p_cafe for update;
  if p_amount < 0 and public.pa_credit_available(p_cafe) + p_amount < 0 then
    raise exception 'Kredit tersedia tidak cukup untuk dikurangi' using errcode = 'P0001';
  end if;
  insert into public.cafe_credit_ledger (cafe_id, amount, kind, note, created_by) values (p_cafe, round(p_amount, 2), 'admin', v_note, v_actor)
  returning * into v_row;
  v_balance := coalesce((select sum(l.amount) from public.cafe_credit_ledger l where l.cafe_id = p_cafe), 0);
  perform public.pa_log('credit.adjust', p_cafe, 'credit', v_row.id::text, null, jsonb_build_object('amount', v_row.amount, 'balance', v_balance), v_note);
  if p_amount > 0 then
    perform public.pa_invoice_recalc_cafe(p_cafe);
  end if;
  return jsonb_build_object('balance', v_balance, 'available', public.pa_credit_available(p_cafe));
end;
$$;

create or replace function public.pa_billing_groups_list()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.pa_require();
  return jsonb_build_object(
    'default_pct', (select s.branch_discount_pct from public.platform_settings s where s.id),
    'groups', coalesce((select jsonb_agg(jsonb_build_object(
        'id', g.id, 'name', g.name, 'branch_discount_pct', g.branch_discount_pct, 'note', g.note, 'created_at', g.created_at,
        'cafes', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'discount_pct', public.pa_branch_discount_pct(c.id),
                             'monthly_price', r.monthly_price, 'plan_name', r.plan_name, 'state', r.state) order by c.created_at, c.id)
                           from public.cafes c join public.pa_cafe_rows() r on r.cafe_id = c.id where c.billing_group_id = g.id), '[]'::jsonb)
      ) order by g.name) from public.billing_groups g), '[]'::jsonb)
  );
end;
$$;

create or replace function public.pa_billing_group_upsert(p_id uuid, p_name text, p_branch_discount_pct integer, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.pa_require();
  v_name text := nullif(left(trim(coalesce(p_name, '')), 80), '');
  v_before public.billing_groups;
  v public.billing_groups;
begin
  if v_name is null or length(v_name) < 2 then
    raise exception 'Nama grup minimal 2 karakter' using errcode = 'P0001';
  end if;
  if p_branch_discount_pct is not null and p_branch_discount_pct not between 0 and 90 then
    raise exception 'Diskon cabang 0–90%%' using errcode = 'P0001';
  end if;
  if p_id is null then
    insert into public.billing_groups (name, branch_discount_pct, note, created_by)
    values (v_name, p_branch_discount_pct, nullif(left(trim(coalesce(p_note, '')), 300), ''), v_actor) returning * into v;
    perform public.pa_log('billing_group.create', null, 'billing_group', v.id::text, null, to_jsonb(v));
  else
    select * into v_before from public.billing_groups g where g.id = p_id for update;
    if not found then
      raise exception 'Grup tidak ditemukan' using errcode = 'P0002';
    end if;
    update public.billing_groups set name = v_name, branch_discount_pct = p_branch_discount_pct,
      note = nullif(left(trim(coalesce(p_note, '')), 300), ''), updated_at = now()
    where id = p_id returning * into v;
    perform public.pa_log('billing_group.update', null, 'billing_group', v.id::text, to_jsonb(v_before) - 'updated_at', to_jsonb(v) - 'updated_at');
  end if;
  return to_jsonb(v);
end;
$$;

create or replace function public.pa_billing_group_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.billing_groups;
begin
  perform public.pa_require();
  select * into v_before from public.billing_groups g where g.id = p_id for update;
  if not found then
    raise exception 'Grup tidak ditemukan' using errcode = 'P0002';
  end if;
  delete from public.billing_groups where id = p_id;
  perform public.pa_log('billing_group.delete', null, 'billing_group', p_id::text, to_jsonb(v_before), null);
end;
$$;

-- Masukkan / keluarkan kafe dari grup. Harga baru berlaku di tagihan berikutnya (tagihan menunggu tidak diubah).
create or replace function public.pa_cafe_set_billing_group(p_cafe uuid, p_group uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before uuid;
begin
  perform public.pa_require();
  select c.billing_group_id into v_before from public.cafes c where c.id = p_cafe for update;
  if not found then
    raise exception 'Kafe tidak ditemukan' using errcode = 'P0002';
  end if;
  if p_group is not null and not exists (select 1 from public.billing_groups g where g.id = p_group) then
    raise exception 'Grup tidak ditemukan' using errcode = 'P0002';
  end if;
  update public.cafes set billing_group_id = p_group where id = p_cafe;
  perform public.pa_log('cafe.billing_group', p_cafe, 'cafe', p_cafe::text, jsonb_build_object('billing_group_id', v_before),
    jsonb_build_object('billing_group_id', p_group, 'branch_discount_pct', public.pa_branch_discount_pct(p_cafe)));
  return jsonb_build_object('billing_group_id', p_group, 'branch_discount_pct', public.pa_branch_discount_pct(p_cafe),
                            'monthly_price', (select r.monthly_price from public.pa_cafe_rows() r where r.cafe_id = p_cafe));
end;
$$;

create or replace function public.pa_billing_settings_update(p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allowed text[] := array['billing_suspend_enabled', 'billing_suspend_after_days', 'referral_credit', 'referral_discount_pct',
    'branch_discount_pct', 'billing_company_name', 'billing_company_address', 'billing_company_email', 'billing_tax_id'];
  v_before public.platform_settings;
  v_after public.platform_settings;
  v_keys text[] := v_allowed || array['billing_enforce_from'];
begin
  perform public.pa_require();
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'Data pengaturan tidak valid' using errcode = 'P0001';
  end if;
  if exists (select 1 from jsonb_object_keys(p_patch) k where k <> all (v_allowed)) then
    raise exception 'Pengaturan tidak dikenal' using errcode = 'P0001';
  end if;
  select * into v_before from public.platform_settings s where s.id for update;
  update public.platform_settings s set
    billing_suspend_enabled = case when p_patch ? 'billing_suspend_enabled' then (p_patch ->> 'billing_suspend_enabled')::boolean else s.billing_suspend_enabled end,
    -- Menyalakan kembali: hanya periode yang berakhir mulai sekarang yang ikut (tidak menonaktifkan tunggakan lama sekaligus)
    billing_enforce_from = case when p_patch ? 'billing_suspend_enabled' and (p_patch ->> 'billing_suspend_enabled')::boolean and not s.billing_suspend_enabled
                                then now() else s.billing_enforce_from end,
    billing_suspend_after_days = case when p_patch ? 'billing_suspend_after_days' then (p_patch ->> 'billing_suspend_after_days')::integer else s.billing_suspend_after_days end,
    referral_credit = case when p_patch ? 'referral_credit' then round((p_patch ->> 'referral_credit')::numeric, 0) else s.referral_credit end,
    referral_discount_pct = case when p_patch ? 'referral_discount_pct' then (p_patch ->> 'referral_discount_pct')::integer else s.referral_discount_pct end,
    branch_discount_pct = case when p_patch ? 'branch_discount_pct' then (p_patch ->> 'branch_discount_pct')::integer else s.branch_discount_pct end,
    billing_company_name = case when p_patch ? 'billing_company_name' then coalesce(nullif(left(trim(p_patch ->> 'billing_company_name'), 80), ''), 'Dailybrew') else s.billing_company_name end,
    billing_company_address = case when p_patch ? 'billing_company_address' then nullif(left(trim(coalesce(p_patch ->> 'billing_company_address', '')), 300), '') else s.billing_company_address end,
    billing_company_email = case when p_patch ? 'billing_company_email' then nullif(left(trim(coalesce(p_patch ->> 'billing_company_email', '')), 120), '') else s.billing_company_email end,
    billing_tax_id = case when p_patch ? 'billing_tax_id' then nullif(left(trim(coalesce(p_patch ->> 'billing_tax_id', '')), 40), '') else s.billing_tax_id end,
    updated_at = now(),
    updated_by = (select auth.uid())
  where s.id
  returning * into v_after;
  perform public.pa_log('settings.billing', null, 'platform_settings', 'platform',
    (select jsonb_object_agg(k, to_jsonb(v_before) -> k) from unnest(v_keys) k),
    (select jsonb_object_agg(k, to_jsonb(v_after) -> k) from unnest(v_keys) k));
  return to_jsonb(v_after) - 'id';
exception
  when invalid_text_representation or numeric_value_out_of_range or check_violation then
    raise exception 'Nilai pengaturan tidak valid (nonaktif 7–60 hari, diskon 0–90%%, kredit 0–10 juta)' using errcode = 'P0001';
end;
$$;

-- ---------------------------------------------------------------------
-- I. Keuangan platform
-- ---------------------------------------------------------------------
create or replace function public.pa_finance_overview(p_months integer default 12)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_months integer := least(greatest(coalesce(p_months, 12), 3), 24);
  v_this timestamptz := public.pa_month_start(0);
  v_prev timestamptz := public.pa_month_start(-1);
begin
  perform public.pa_require();
  return jsonb_build_object(
    'mrr', (select coalesce(sum(r.monthly_price) filter (where r.state in ('active', 'past_due')), 0) from public.pa_cafe_rows() r),
    'collected_month', coalesce((select sum(i.amount) from public.subscription_invoices i where i.status = 'paid' and i.paid_at >= v_this), 0),
    'collected_prev', coalesce((select sum(i.amount) from public.subscription_invoices i where i.status = 'paid' and i.paid_at >= v_prev and i.paid_at < v_this), 0),
    'outstanding', (select jsonb_build_object('count', count(*), 'amount', coalesce(sum(i.amount), 0))
                    from public.subscription_invoices i where i.status = 'pending'),
    'aging', (select jsonb_build_object(
        'not_due', jsonb_build_object('count', count(*) filter (where i.due_at >= now()), 'amount', coalesce(sum(i.amount) filter (where i.due_at >= now()), 0)),
        'd1_7', jsonb_build_object('count', count(*) filter (where i.due_at < now() and i.due_at >= now() - interval '7 days'),
                                   'amount', coalesce(sum(i.amount) filter (where i.due_at < now() and i.due_at >= now() - interval '7 days'), 0)),
        'd8_30', jsonb_build_object('count', count(*) filter (where i.due_at < now() - interval '7 days' and i.due_at >= now() - interval '30 days'),
                                    'amount', coalesce(sum(i.amount) filter (where i.due_at < now() - interval '7 days' and i.due_at >= now() - interval '30 days'), 0)),
        'd31', jsonb_build_object('count', count(*) filter (where i.due_at < now() - interval '30 days'),
                                  'amount', coalesce(sum(i.amount) filter (where i.due_at < now() - interval '30 days'), 0)))
      from public.subscription_invoices i where i.status = 'pending'),
    -- Perkiraan 30 hari: tagihan menunggu yang jatuh tempo + perpanjangan yang belum ditagih
    'forecast_30', (select jsonb_build_object(
        'invoiced', coalesce((select sum(i.amount) from public.subscription_invoices i where i.status = 'pending' and i.due_at < now() + interval '30 days'), 0),
        'renewals', coalesce(sum(r.monthly_price), 0), 'renewal_count', count(*))
      from public.pa_cafe_rows() r
      where r.state in ('active', 'trial', 'past_due') and r.monthly_price > 0
        and coalesce(case when r.sub_status = 'trialing' then r.trial_ends_at else r.current_period_end end, 'infinity'::timestamptz) < now() + interval '30 days'
        and not exists (select 1 from public.subscription_invoices i where i.cafe_id = r.cafe_id and i.status = 'pending')),
    'months', (select coalesce(jsonb_agg(jsonb_build_object(
        'month', (m.start at time zone 'Asia/Jakarta')::date,
        'collected', coalesce((select sum(i.amount) from public.subscription_invoices i where i.status = 'paid' and i.paid_at >= m.start and i.paid_at < m.next), 0),
        'invoices', (select count(*) from public.subscription_invoices i where i.status = 'paid' and i.paid_at >= m.start and i.paid_at < m.next),
        'discounts', coalesce((select sum(i.promo_discount + i.referral_discount) from public.subscription_invoices i where i.status = 'paid' and i.paid_at >= m.start and i.paid_at < m.next), 0),
        'credits', coalesce((select sum(i.credit_amount) from public.subscription_invoices i where i.status = 'paid' and i.paid_at >= m.start and i.paid_at < m.next), 0)
      ) order by m.start), '[]'::jsonb)
      from (select public.pa_month_start(-k) as start, public.pa_month_start(-k + 1) as next from generate_series(0, v_months - 1) k) m),
    'methods', (select coalesce(jsonb_agg(jsonb_build_object('method', x.method, 'count', x.n, 'amount', x.amount) order by x.amount desc), '[]'::jsonb)
                from (select coalesce(i.method, 'manual_transfer') as method, count(*) as n, sum(i.amount) as amount
                      from public.subscription_invoices i where i.status = 'paid' and i.paid_at >= public.pa_month_start(-(v_months - 1))
                      group by 1) x),
    'on_time', (select jsonb_build_object('paid', count(*), 'on_time', count(*) filter (where i.paid_at <= i.due_at))
                from public.subscription_invoices i where i.status = 'paid' and i.paid_at >= now() - interval '90 days' and coalesce(i.list_amount, i.amount) > 0),
    'suspended', (select coalesce(jsonb_agg(jsonb_build_object('cafe_id', c.id, 'name', c.name, 'since', c.suspended_at,
                    'pending_amount', coalesce((select sum(i.amount) from public.subscription_invoices i where i.cafe_id = c.id and i.status = 'pending'), 0))
                  order by c.suspended_at), '[]'::jsonb)
                  from public.cafes c where c.suspended_at is not null and c.suspended_kind = 'billing'),
    'at_risk', (select coalesce(jsonb_agg(jsonb_build_object('cafe_id', x.id, 'name', x.name, 'suspend_at', x.suspend_at) order by x.suspend_at), '[]'::jsonb)
                from (select c.id, c.name, public.pa_suspend_due_at(c.id) as suspend_at
                      from public.cafes c join public.cafe_subscriptions s on s.cafe_id = c.id
                      where c.suspended_at is null and s.status = 'past_due'
                        and exists (select 1 from public.subscription_invoices i where i.cafe_id = c.id and i.status = 'pending')) x
                where x.suspend_at is not null),
    'promos', (select coalesce(jsonb_agg(jsonb_build_object('code', x.promo_code, 'count', x.n, 'discount', x.d) order by x.d desc), '[]'::jsonb)
               from (select i.promo_code, count(*) as n, sum(i.promo_discount) as d from public.subscription_invoices i
                     where i.status = 'paid' and i.promo_code is not null group by i.promo_code order by 3 desc limit 5) x),
    'credit_outstanding', coalesce((select sum(l.amount) from public.cafe_credit_ledger l), 0),
    'settings', (select jsonb_build_object('billing_suspend_enabled', s.billing_suspend_enabled, 'billing_suspend_after_days', s.billing_suspend_after_days,
                   'billing_enforce_from', s.billing_enforce_from, 'referral_credit', s.referral_credit, 'referral_discount_pct', s.referral_discount_pct,
                   'branch_discount_pct', s.branch_discount_pct, 'billing_company_name', s.billing_company_name,
                   'billing_company_address', s.billing_company_address, 'billing_company_email', s.billing_company_email, 'billing_tax_id', s.billing_tax_id)
                 from public.platform_settings s where s.id)
  );
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
    'pa_rupiah(numeric)', 'pa_next_invoice_number()', 'pa_branch_discount_pct(uuid)', 'pa_plan_price(uuid, text)', 'pa_cafe_rows()',
    'pa_referral_code_new(text)', 'cafes_fill_referral_code()', 'cafes_suspend_kind()', 'pa_credit_available(uuid, uuid)',
    'pa_cafe_has_paid(uuid, uuid)', 'pa_promo_discount(public.platform_promo_codes, numeric)', 'pa_invoice_recalc(uuid)',
    'pa_invoice_settle_zero(uuid)', 'pa_invoice_recalc_cafe(uuid)', 'pa_invoice_json(public.subscription_invoices)',
    'pa_owner_invoice_json(public.subscription_invoices)',
    'pa_invoice_insert(uuid, text, integer, numeric, timestamptz, timestamptz, text, uuid, text)', 'subscription_invoice_on_paid()',
    'pa_suspend_due_at(uuid)', 'pa_code_attempts_ok(uuid)', 'pa_promo_json(public.platform_promo_codes)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', v_sig);
  end loop;
  -- Khusus service_role (Edge Function / pg_cron)
  foreach v_sig in array array['pa_billing_run()', 'pa_daily_check()', 'pa_gateway_apply(text, text, text, numeric, jsonb)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', v_sig);
    execute format('grant execute on function public.%s to service_role', v_sig);
  end loop;
  -- Dashboard admin (pa_require menolak non-admin / non-2FA) + owner (fungsi memeriksa sendiri)
  foreach v_sig in array array[
    'pa_invoice_create(uuid, text, integer, numeric, integer, text)',
    'pa_promos_list()',
    'pa_promo_upsert(uuid, text, text, text, numeric, text[], integer, boolean, integer, integer, timestamptz, timestamptz, boolean)',
    'pa_referrals_list(integer)', 'pa_cafe_billing(uuid)', 'pa_credit_adjust(uuid, numeric, text)',
    'pa_billing_groups_list()', 'pa_billing_group_upsert(uuid, text, integer, text)', 'pa_billing_group_delete(uuid)',
    'pa_cafe_set_billing_group(uuid, uuid)', 'pa_billing_settings_update(jsonb)', 'pa_finance_overview(integer)',
    'cafe_platform_status(uuid)', 'owner_invoices(uuid)', 'owner_invoice_request(uuid, text, integer)',
    'owner_invoice_apply_promo(uuid, uuid, text)', 'owner_referral_info(uuid)', 'owner_referral_claim(uuid, text)',
    'invoice_receipt(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', v_sig);
    execute format('grant execute on function public.%s to authenticated', v_sig);
  end loop;
end;
$$;

notify pgrst, 'reload schema';

commit;

-- Verifikasi: 6 tabel + 3 trigger = 9 baris, dan baris "tanpa_rls" TIDAK boleh muncul
select 'table' as kind, table_name as name
from information_schema.tables
where table_schema = 'public' and table_name in ('billing_groups', 'platform_promo_codes', 'cafe_referrals', 'cafe_credit_ledger',
  'billing_code_attempts', 'invoice_number_counters')
union all
select 'trigger', tgname::text from pg_trigger
where tgname in ('cafes_fill_referral_code', 'cafes_suspend_kind', 'subscription_invoice_on_paid') and not tgisinternal
union all
select 'tanpa_rls', c.relname
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
order by 1, 2;

-- =====================================================================
-- JADWAL: tidak ada jadwal baru. pa_daily_check (08.00 WIB) kini juga mengirim pengingat telat 3 hari,
-- peringatan 2 hari sebelum nonaktif, dan menonaktifkan otomatis (bila dinyalakan di Keuangan → Pengaturan).
-- KUITANSI PDF: deploy ulang Edge Function "subscription-billing" (versi file ini menambah aksi "receipt").
-- =====================================================================
