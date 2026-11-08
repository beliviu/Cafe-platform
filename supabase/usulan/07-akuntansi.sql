-- =====================================================================
-- 07 · AKUNTANSI & KEUANGAN (Fase 3 roadmap V2)
--   A. Bagan akun per kafe (templat kafe Indonesia), periode akuntansi
--   B. Jurnal umum double-entry: seimbang (dijaga database), tidak bisa diubah,
--      anti-dobel per kejadian, periode tertutup ditolak, koreksi = jurnal pembalik
--   C. Jurnal otomatis dari kejadian bisnis (mulai tanggal go-live):
--      pesanan selesai (penjualan, diskon, service, pajak, pembulatan, HPP),
--      pembayaran & refund, mutasi stok, pembelian & pembayaran supplier,
--      kas masuk/keluar kasir, selisih kas saat tutup kasir, beban
--   D. Beban operasional (+ lampiran nota), jurnal manual, pembalikan
--   E. Laporan dari jurnal: neraca saldo, buku besar, laba rugi, neraca,
--      arus kas (metode langsung), perubahan ekuitas, ringkasan keuangan
--   F. Go-live + saldo awal, sinkronisasi ulang, tutup/buka periode
--
-- Jalankan manual di Supabase SQL Editor SETELAH 06-pesanan-v2-pos.sql.
-- Semua dalam satu transaksi: kalau ada error, tidak ada yang berubah.
--
-- Dampak ke data yang sudah ada:
--   - TIDAK ada jurnal yang dibuat sampai owner mengisi tanggal go-live & saldo awal
--     (Keuangan → Mulai pembukuan). Kejadian sebelum go-live tidak pernah dijurnal.
--   - Trigger baru (AFTER) di orders, payments, stock_movements, supplier_payments,
--     cash_movements, cashier_sessions: hanya mencatat jurnal; bila gagal, transaksi
--     TETAP berjalan dan kegagalan dicatat di acc_sync_issues.
--   - Kolom baru: cafe_settings.accounting_go_live, stock_movements.funding,
--     cash_movements.purpose (nilai bawaan; data lama tidak diubah).
--   - Fungsi diganti dengan parameter tambahan berawalan bawaan:
--     inventory_stock_in (+ p_funding), cashier_cash_move (+ p_purpose).
--   - inv_next_document_number: nomor tidak lagi terpotong setelah 9999 per tahun.
--   - Bucket storage baru 'expense-receipts' (privat) untuk foto nota beban.
-- Akses: semua data keuangan hanya untuk OWNER kafe itu.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0. Pemeriksaan awal
-- ---------------------------------------------------------------------
do $$
begin
  if to_regclass('public.cashier_sessions') is null or to_regclass('public.refunds') is null then
    raise exception 'File 06-pesanan-v2-pos.sql belum dijalankan. Jalankan file 06 dulu.';
  end if;
end;
$$;

-- Nomor dokumen tidak terpotong setelah 9999 per tahun
create or replace function public.inv_next_document_number(p_cafe_id uuid, p_doc_type text, p_prefix text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_year integer := extract(year from now() at time zone 'Asia/Jakarta')::integer;
  v_value integer;
begin
  insert into public.document_counters (cafe_id, doc_type, period, last_value)
  values (p_cafe_id, p_doc_type, v_year, 1)
  on conflict (cafe_id, doc_type, period)
  do update set last_value = public.document_counters.last_value + 1
  returning last_value into v_value;
  return p_prefix || '-' || v_year || '-' || lpad(v_value::text, greatest(4, char_length(v_value::text)), '0');
end;
$$;
revoke all on function public.inv_next_document_number(uuid, text, text) from public, anon, authenticated;

create or replace function public.acc_require_owner(p_cafe_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Login diperlukan' using errcode = '28000';
  end if;
  if p_cafe_id is null or not public.is_cafe_member(p_cafe_id, array['owner']) then
    raise exception 'Hanya owner kafe ini yang bisa membuka data keuangan' using errcode = '42501';
  end if;
end;
$$;
revoke all on function public.acc_require_owner(uuid) from public, anon, authenticated;

alter table public.cafe_settings add column if not exists accounting_go_live date;

-- ---------------------------------------------------------------------
-- A. Bagan akun & periode
-- ---------------------------------------------------------------------
create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  cafe_id uuid not null references public.cafes (id) on delete cascade,
  code text not null check (code ~ '^[1-9]-[0-9]{4}$'),
  name text not null check (char_length(btrim(name)) between 2 and 80),
  type text not null check (type in ('asset', 'liability', 'equity', 'revenue', 'contra_revenue', 'cogs', 'expense', 'other_income', 'other_expense')),
  cash_flow text not null default 'operating' check (cash_flow in ('operating', 'investing', 'financing')),
  is_cash boolean not null default false,
  is_system boolean not null default false,
  is_active boolean not null default true,
  description text check (description is null or char_length(description) <= 200),
  created_at timestamptz not null default now(),
  unique (cafe_id, code)
);
create index if not exists accounts_cafe_idx on public.accounts (cafe_id, code);

create table if not exists public.accounting_periods (
  cafe_id uuid not null references public.cafes (id) on delete cascade,
  period_start date not null check (extract(day from period_start) = 1),
  status text not null default 'closed' check (status in ('open', 'closed')),
  closed_at timestamptz,
  closed_by uuid,
  note text check (note is null or char_length(note) <= 300),
  primary key (cafe_id, period_start)
);

-- Templat akun kafe (kode tetap; nama bisa diubah owner; akun sistem tidak bisa dihapus)
create or replace function public.acc_seed_accounts(p_cafe_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  insert into public.accounts (cafe_id, code, name, type, cash_flow, is_cash, is_system)
  select p_cafe_id, t.code, t.name, t.type, t.flow, t.is_cash, true
  from (values
    ('1-1100', 'Kas', 'asset', 'operating', true),
    ('1-1150', 'Saldo QRIS & e-wallet', 'asset', 'operating', true),
    ('1-1200', 'Bank', 'asset', 'operating', true),
    ('1-1300', 'Piutang & uang muka pesanan', 'asset', 'operating', false),
    ('1-1400', 'Persediaan bahan', 'asset', 'operating', false),
    ('1-1500', 'Biaya dibayar di muka', 'asset', 'operating', false),
    ('1-2100', 'Peralatan & perlengkapan kafe', 'asset', 'investing', false),
    ('1-2900', 'Akumulasi penyusutan', 'asset', 'investing', false),
    ('2-1100', 'Utang usaha (supplier)', 'liability', 'operating', false),
    ('2-1200', 'Utang pajak (PB1)', 'liability', 'operating', false),
    ('2-1300', 'Utang lain-lain & beban belum dibayar', 'liability', 'operating', false),
    ('2-2100', 'Pinjaman', 'liability', 'financing', false),
    ('3-1000', 'Modal pemilik', 'equity', 'financing', false),
    ('3-2000', 'Laba ditahan', 'equity', 'financing', false),
    ('3-3000', 'Prive (penarikan pemilik)', 'equity', 'financing', false),
    ('3-9000', 'Ekuitas saldo awal', 'equity', 'financing', false),
    ('4-1000', 'Penjualan', 'revenue', 'operating', false),
    ('4-1100', 'Pendapatan service charge', 'revenue', 'operating', false),
    ('4-1900', 'Pembulatan penjualan', 'revenue', 'operating', false),
    ('4-2000', 'Diskon penjualan', 'contra_revenue', 'operating', false),
    ('4-2100', 'Retur & refund penjualan', 'contra_revenue', 'operating', false),
    ('4-9100', 'Pendapatan lain-lain', 'other_income', 'operating', false),
    ('4-9200', 'Selisih kas lebih', 'other_income', 'operating', false),
    ('5-1000', 'HPP bahan', 'cogs', 'operating', false),
    ('5-1100', 'Bahan rusak, terbuang & kedaluwarsa', 'cogs', 'operating', false),
    ('5-1200', 'Pemakaian bahan non-penjualan', 'cogs', 'operating', false),
    ('5-1300', 'Selisih stok opname', 'cogs', 'operating', false),
    ('6-1000', 'Gaji & upah', 'expense', 'operating', false),
    ('6-1100', 'Sewa tempat', 'expense', 'operating', false),
    ('6-1200', 'Listrik, air & gas', 'expense', 'operating', false),
    ('6-1300', 'Internet & telepon', 'expense', 'operating', false),
    ('6-1400', 'Perlengkapan & kemasan non-stok', 'expense', 'operating', false),
    ('6-1500', 'Pemasaran & promosi', 'expense', 'operating', false),
    ('6-1600', 'Perawatan & perbaikan', 'expense', 'operating', false),
    ('6-1700', 'Biaya admin bank & pembayaran', 'expense', 'operating', false),
    ('6-1800', 'Penyusutan', 'expense', 'operating', false),
    ('6-9100', 'Beban lain-lain (kas kecil)', 'expense', 'operating', false),
    ('6-9200', 'Selisih kas kurang', 'other_expense', 'operating', false)
  ) as t (code, name, type, flow, is_cash)
  on conflict (cafe_id, code) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.acc_seed_accounts(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- B. Jurnal
-- ---------------------------------------------------------------------
create table if not exists public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  cafe_id uuid not null references public.cafes (id) on delete cascade,
  number text not null,
  entry_date date not null,
  memo text not null check (char_length(memo) between 1 and 300),
  kind text not null check (kind in ('auto', 'manual', 'opening', 'reversal')),
  source_type text,
  source_id text,
  event text,
  status text not null default 'posted' check (status in ('posted', 'reversed')),
  reversal_of uuid references public.journal_entries (id),
  reversed_by uuid references public.journal_entries (id),
  total numeric(14, 2) not null default 0,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (cafe_id, number)
);
create unique index if not exists journal_entries_source_once
  on public.journal_entries (cafe_id, source_type, source_id, event) where source_type is not null;
create index if not exists journal_entries_cafe_date_idx on public.journal_entries (cafe_id, entry_date desc, created_at desc);

create table if not exists public.journal_lines (
  id bigint generated always as identity primary key,
  cafe_id uuid not null references public.cafes (id) on delete cascade,
  journal_id uuid not null references public.journal_entries (id) on delete cascade,
  account_id uuid not null references public.accounts (id),
  debit numeric(14, 2) not null default 0 check (debit >= 0),
  credit numeric(14, 2) not null default 0 check (credit >= 0),
  memo text check (memo is null or char_length(memo) <= 200),
  line_no integer not null default 0,
  constraint journal_lines_one_side check ((debit > 0) <> (credit > 0))
);
create index if not exists journal_lines_journal_idx on public.journal_lines (journal_id, line_no);
create index if not exists journal_lines_account_idx on public.journal_lines (account_id);
create index if not exists journal_lines_cafe_idx on public.journal_lines (cafe_id);

-- Jurnal tidak bisa diubah (hanya status → reversed oleh fungsi pembalik)
create or replace function public.acc_block_journal_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_table_name = 'journal_lines' then
    raise exception 'Baris jurnal tidak bisa diubah. Buat jurnal pembalik.' using errcode = '42501';
  end if;
  if new.number is distinct from old.number or new.entry_date is distinct from old.entry_date or new.memo is distinct from old.memo
     or new.cafe_id is distinct from old.cafe_id or new.total is distinct from old.total or new.kind is distinct from old.kind
     or new.source_type is distinct from old.source_type or new.source_id is distinct from old.source_id
     or not (old.status = 'posted' and new.status in ('posted', 'reversed')) then
    raise exception 'Jurnal yang sudah diposting tidak bisa diubah. Buat jurnal pembalik.' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists acc_block_update on public.journal_entries;
create trigger acc_block_update before update on public.journal_entries for each row execute function public.acc_block_journal_update();
drop trigger if exists acc_block_update on public.journal_lines;
create trigger acc_block_update before update on public.journal_lines for each row execute function public.acc_block_journal_update();

-- Debit = kredit per jurnal, diperiksa saat commit (pertahanan kedua setelah acc_post)
create or replace function public.acc_check_balanced()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_debit numeric;
  v_credit numeric;
begin
  select coalesce(sum(debit), 0), coalesce(sum(credit), 0) into v_debit, v_credit
  from public.journal_lines where journal_id = new.journal_id;
  if v_debit <> v_credit then
    raise exception 'Jurnal tidak seimbang: debit % ≠ kredit %', v_debit, v_credit using errcode = '23514';
  end if;
  return null;
end;
$$;
drop trigger if exists acc_check_balanced on public.journal_lines;
create constraint trigger acc_check_balanced after insert on public.journal_lines
  deferrable initially deferred for each row execute function public.acc_check_balanced();

create table if not exists public.acc_sync_issues (
  id bigint generated always as identity primary key,
  cafe_id uuid not null references public.cafes (id) on delete cascade,
  source_type text not null,
  source_id text,
  message text not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists acc_sync_issues_open_idx on public.acc_sync_issues (cafe_id, created_at desc) where resolved_at is null;

create or replace function public.acc_period_closed(p_cafe_id uuid, p_date date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.accounting_periods p
    where p.cafe_id = p_cafe_id and p.period_start = date_trunc('month', p_date)::date and p.status = 'closed'
  );
$$;
revoke all on function public.acc_period_closed(uuid, date) from public, anon, authenticated;

-- Inti: posting jurnal. p_lines = [{ code | account_id, debit?, credit?, memo? }]
-- Nilai bersih per baris (debit − kredit) menentukan sisi; baris nol diabaikan.
-- Mengembalikan null bila pembukuan belum dimulai, tanggal sebelum go-live, atau semua baris nol.
create or replace function public.acc_post(
  p_cafe_id uuid,
  p_date date,
  p_kind text,
  p_source_type text,
  p_source_id text,
  p_event text,
  p_memo text,
  p_lines jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_go_live date;
  v_existing uuid;
  v_line jsonb;
  v_account uuid;
  v_net numeric(14, 2);
  v_accounts uuid[] := '{}';
  v_debits numeric[] := '{}';
  v_credits numeric[] := '{}';
  v_memos text[] := '{}';
  v_total_debit numeric(14, 2) := 0;
  v_total_credit numeric(14, 2) := 0;
  v_id uuid;
begin
  select s.accounting_go_live into v_go_live from public.cafe_settings s where s.cafe_id = p_cafe_id;
  if v_go_live is null or p_date is null or p_date < v_go_live then
    return null;
  end if;
  if p_source_type is not null then
    select j.id into v_existing from public.journal_entries j
    where j.cafe_id = p_cafe_id and j.source_type = p_source_type and j.source_id = p_source_id and j.event = p_event;
    if v_existing is not null then
      return v_existing;
    end if;
  end if;
  if public.acc_period_closed(p_cafe_id, p_date) then
    raise exception 'Periode % sudah ditutup. Buka periode itu dulu.', to_char(p_date, 'MM/YYYY') using errcode = '22023';
  end if;

  for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_net := round(coalesce((v_line ->> 'debit')::numeric, 0) - coalesce((v_line ->> 'credit')::numeric, 0), 2);
    continue when v_net = 0;
    if v_line ? 'account_id' then
      select a.id into v_account from public.accounts a where a.id = (v_line ->> 'account_id')::uuid and a.cafe_id = p_cafe_id;
    else
      select a.id into v_account from public.accounts a where a.code = v_line ->> 'code' and a.cafe_id = p_cafe_id;
    end if;
    if v_account is null then
      raise exception 'Akun % tidak ditemukan. Jalankan "Mulai pembukuan" dulu.', coalesce(v_line ->> 'code', v_line ->> 'account_id') using errcode = '23503';
    end if;
    v_accounts := v_accounts || v_account;
    v_debits := v_debits || greatest(v_net, 0);
    v_credits := v_credits || greatest(-v_net, 0);
    v_memos := v_memos || public.inv_clean_text(v_line ->> 'memo', 200);
    v_total_debit := v_total_debit + greatest(v_net, 0);
    v_total_credit := v_total_credit + greatest(-v_net, 0);
  end loop;

  if cardinality(v_accounts) = 0 then
    return null;
  end if;
  if cardinality(v_accounts) < 2 or v_total_debit <> v_total_credit then
    raise exception 'Jurnal tidak seimbang (debit % · kredit %)', v_total_debit, v_total_credit using errcode = '23514';
  end if;

  insert into public.journal_entries (cafe_id, number, entry_date, memo, kind, source_type, source_id, event, total)
  values (
    p_cafe_id, public.inv_next_document_number(p_cafe_id, 'journal', 'JU'), p_date,
    coalesce(public.inv_clean_text(p_memo, 300), 'Jurnal'), p_kind, p_source_type, p_source_id, p_event, v_total_debit
  )
  returning id into v_id;

  insert into public.journal_lines (cafe_id, journal_id, account_id, debit, credit, memo, line_no)
  select p_cafe_id, v_id, v_accounts[i], v_debits[i], v_credits[i], v_memos[i], i
  from generate_subscripts(v_accounts, 1) as i;
  return v_id;
end;
$$;
revoke all on function public.acc_post(uuid, date, text, text, text, text, text, jsonb) from public, anon, authenticated;

-- Pembalik: baris ditukar, tanggal hari ini (atau p_date), asal ditandai reversed
create or replace function public.acc_reverse_internal(p_journal_id uuid, p_reason text, p_date date default null, p_event_suffix text default 'reversal')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry public.journal_entries%rowtype;
  v_date date;
  v_id uuid;
begin
  select * into v_entry from public.journal_entries where id = p_journal_id for update;
  if not found then
    raise exception 'Jurnal tidak ditemukan' using errcode = 'P0002';
  end if;
  if v_entry.status = 'reversed' then
    raise exception 'Jurnal % sudah dibalik', v_entry.number using errcode = '22023';
  end if;
  if v_entry.kind = 'reversal' then
    raise exception 'Jurnal pembalik tidak bisa dibalik lagi. Buat jurnal manual.' using errcode = '22023';
  end if;
  v_date := coalesce(p_date, (now() at time zone 'Asia/Jakarta')::date);
  if v_date < v_entry.entry_date then
    v_date := v_entry.entry_date;
  end if;
  if public.acc_period_closed(v_entry.cafe_id, v_date) then
    raise exception 'Periode % sudah ditutup.', to_char(v_date, 'MM/YYYY') using errcode = '22023';
  end if;

  insert into public.journal_entries (cafe_id, number, entry_date, memo, kind, source_type, source_id, event, reversal_of, total)
  values (
    v_entry.cafe_id, public.inv_next_document_number(v_entry.cafe_id, 'journal', 'JU'), v_date,
    left('Pembalik ' || v_entry.number || ': ' || coalesce(public.inv_clean_text(p_reason, 200), v_entry.memo), 300),
    'reversal', v_entry.source_type, v_entry.source_id,
    case when v_entry.source_type is not null then coalesce(v_entry.event, '') || ':' || p_event_suffix end,
    v_entry.id, v_entry.total
  )
  returning id into v_id;
  insert into public.journal_lines (cafe_id, journal_id, account_id, debit, credit, memo, line_no)
  select l.cafe_id, v_id, l.account_id, l.credit, l.debit, l.memo, l.line_no
  from public.journal_lines l where l.journal_id = v_entry.id;
  update public.journal_entries set status = 'reversed', reversed_by = v_id where id = v_entry.id;
  return v_id;
end;
$$;
revoke all on function public.acc_reverse_internal(uuid, text, date, text) from public, anon, authenticated;

create or replace function public.acc_cash_account(p_method text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_method
    when 'cash' then '1-1100'
    when 'qris' then '1-1150'
    when 'ewallet' then '1-1150'
    when 'payable' then '2-1300'
    when 'unpaid' then '2-1300'
    else '1-1200'
  end;
$$;

create or replace function public.acc_local_date(p_at timestamptz)
returns date
language sql
immutable
set search_path = ''
as $$
  select (coalesce(p_at, now()) at time zone 'Asia/Jakarta')::date;
$$;

create or replace function public.acc_order_label(p_order public.orders)
returns text
language sql
stable
set search_path = ''
as $$
  select case when p_order.queue_number is not null then 'A-' || lpad(p_order.queue_number::text, 3, '0') else 'pesanan ' || left(p_order.id::text, 8) end;
$$;

-- ---------------------------------------------------------------------
-- C. Jurnal otomatis per kejadian
-- ---------------------------------------------------------------------
-- Pesanan selesai: pendapatan + HPP (dari mutasi pemakaian pesanan itu)
create or replace function public.acc_post_order(p_order_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_done timestamptz;
  v_lines jsonb;
  v_cogs numeric(14, 2);
  v_sales numeric(14, 2);
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found or v_order.order_status <> 'completed' then
    return null;
  end if;
  select max(e.created_at) into v_done from public.order_status_events e where e.order_id = v_order.id and e.to_status = 'completed';
  select -coalesce(sum(m.total_cost), 0) into v_cogs from public.stock_movements m where m.order_id = v_order.id and m.movement_type = 'sale';

  if v_order.pricing_version >= 2 then
    v_sales := coalesce(v_order.subtotal_amount, v_order.total_amount) - case when v_order.tax_inclusive then v_order.tax_amount else 0 end;
    v_lines := jsonb_build_array(
      jsonb_build_object('code', '1-1300', 'debit', v_order.total_amount),
      jsonb_build_object('code', '4-2000', 'debit', v_order.discount_amount, 'memo', v_order.discount_reason),
      jsonb_build_object('code', '4-1000', 'credit', v_sales),
      jsonb_build_object('code', '4-1100', 'credit', v_order.service_charge_amount),
      jsonb_build_object('code', '2-1200', 'credit', v_order.tax_amount),
      jsonb_build_object('code', '4-1900', 'credit', v_order.rounding_amount)
    );
  else
    v_lines := jsonb_build_array(
      jsonb_build_object('code', '1-1300', 'debit', v_order.total_amount),
      jsonb_build_object('code', '4-1000', 'credit', v_order.total_amount)
    );
  end if;
  v_lines := v_lines || jsonb_build_array(
    jsonb_build_object('code', '5-1000', 'debit', v_cogs),
    jsonb_build_object('code', '1-1400', 'credit', v_cogs)
  );
  return public.acc_post(
    v_order.cafe_id, public.acc_local_date(coalesce(v_done, v_order.updated_at)), 'auto', 'order', v_order.id::text, 'completed',
    'Penjualan ' || public.acc_order_label(v_order) || case when v_order.source = 'pos' then ' (kasir)' else '' end, v_lines
  );
end;
$$;
revoke all on function public.acc_post_order(uuid) from public, anon, authenticated;

-- Pembayaran pesanan (lunas) dan refund
create or replace function public.acc_post_payment(p_payment_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pay public.payments%rowtype;
  v_order public.orders%rowtype;
  v_cash text;
begin
  select * into v_pay from public.payments where id = p_payment_id;
  if not found or v_pay.verification = 'demo' or v_pay.status not in ('paid', 'refunded') or v_pay.amount <= 0 then
    return null;
  end if;
  select * into v_order from public.orders where id = v_pay.order_id;
  v_cash := public.acc_cash_account(v_pay.method);
  if v_pay.status = 'paid' then
    return public.acc_post(
      v_order.cafe_id, public.acc_local_date(coalesce(v_pay.paid_at, v_pay.created_at)), 'auto', 'payment', v_pay.id::text, 'paid',
      'Pembayaran ' || public.acc_order_label(v_order),
      jsonb_build_array(jsonb_build_object('code', v_cash, 'debit', v_pay.amount), jsonb_build_object('code', '1-1300', 'credit', v_pay.amount))
    );
  end if;
  -- Refund: pesanan selesai → retur penjualan; belum selesai/batal → mengembalikan uang muka
  return public.acc_post(
    v_order.cafe_id, public.acc_local_date(coalesce(v_pay.paid_at, v_pay.created_at)), 'auto', 'payment', v_pay.id::text, 'refunded',
    'Refund ' || public.acc_order_label(v_order),
    jsonb_build_array(
      jsonb_build_object('code', case when v_order.order_status = 'completed' then '4-2100' else '1-1300' end, 'debit', v_pay.amount),
      jsonb_build_object('code', v_cash, 'credit', v_pay.amount)
    )
  );
end;
$$;
revoke all on function public.acc_post_payment(uuid) from public, anon, authenticated;

-- Mutasi stok selain pemakaian penjualan (yang ikut jurnal pesanan)
alter table public.stock_movements add column if not exists funding text;
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.stock_movements'::regclass and conname = 'stock_movements_funding_valid') then
    alter table public.stock_movements add constraint stock_movements_funding_valid
      check (funding is null or funding in ('cash', 'bank', 'qris', 'payable'));
  end if;
end;
$$;

create or replace function public.acc_post_stock_movement(p_movement_id bigint)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_move public.stock_movements%rowtype;
  v_name text;
  v_value numeric(14, 2);
  v_debit text;
  v_credit text;
  v_memo text;
begin
  select * into v_move from public.stock_movements where id = p_movement_id;
  if not found or v_move.movement_type = 'sale' then
    return null;
  end if;
  v_value := abs(v_move.total_cost);
  if v_value = 0 then
    return null;
  end if;
  select i.name into v_name from public.ingredients i where i.id = v_move.ingredient_id;
  case v_move.movement_type
    when 'opening' then v_debit := '1-1400'; v_credit := '3-9000'; v_memo := 'Stok awal ';
    when 'purchase' then
      v_debit := '1-1400';
      v_credit := case
        when v_move.purchase_order_id is not null then '2-1100'
        when v_move.funding = 'bank' then '1-1200'
        when v_move.funding = 'qris' then '1-1150'
        when v_move.funding = 'payable' then '2-1300'
        else '1-1100' end;
      v_memo := 'Pembelian ';
    when 'refund' then v_debit := '1-1400'; v_credit := '5-1000'; v_memo := 'Bahan kembali (refund) ';
    when 'waste', 'damaged', 'expired' then v_debit := '5-1100'; v_credit := '1-1400'; v_memo := 'Bahan terbuang/rusak ';
    when 'usage' then v_debit := '5-1200'; v_credit := '1-1400'; v_memo := 'Pemakaian lain ';
    when 'return' then v_debit := '2-1100'; v_credit := '1-1400'; v_memo := 'Retur ke supplier ';
    else
      if v_move.quantity < 0 then v_debit := '5-1300'; v_credit := '1-1400'; else v_debit := '1-1400'; v_credit := '5-1300'; end if;
      v_memo := 'Selisih stok ';
  end case;
  return public.acc_post(
    v_move.cafe_id, public.acc_local_date(v_move.occurred_at), 'auto', 'stock_movement', v_move.id::text, 'posted',
    v_memo || coalesce(v_name, ''),
    jsonb_build_array(jsonb_build_object('code', v_debit, 'debit', v_value), jsonb_build_object('code', v_credit, 'credit', v_value))
  );
end;
$$;
revoke all on function public.acc_post_stock_movement(bigint) from public, anon, authenticated;

create or replace function public.acc_post_supplier_payment(p_payment_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pay public.supplier_payments%rowtype;
  v_number text;
  v_journal uuid;
begin
  select * into v_pay from public.supplier_payments where id = p_payment_id;
  if not found then
    return null;
  end if;
  select po.po_number into v_number from public.purchase_orders po where po.id = v_pay.purchase_order_id;
  v_journal := public.acc_post(
    v_pay.cafe_id, v_pay.paid_on, 'auto', 'supplier_payment', v_pay.id::text, 'paid', 'Bayar supplier ' || coalesce(v_number, ''),
    jsonb_build_array(jsonb_build_object('code', '2-1100', 'debit', v_pay.amount), jsonb_build_object('code', public.acc_cash_account(v_pay.method), 'credit', v_pay.amount))
  );
  if v_pay.voided_at is not null and v_journal is not null
     and not exists (select 1 from public.journal_entries j where j.reversal_of = v_journal) then
    perform public.acc_reverse_internal(v_journal, 'Pembayaran dibatalkan: ' || coalesce(v_pay.void_reason, ''), public.acc_local_date(v_pay.voided_at), 'void');
  end if;
  return v_journal;
end;
$$;
revoke all on function public.acc_post_supplier_payment(uuid) from public, anon, authenticated;

-- Kas masuk/keluar kasir: tujuan menentukan akun lawan
alter table public.cash_movements add column if not exists purpose text not null default 'other';
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.cash_movements'::regclass and conname = 'cash_movements_purpose_valid') then
    alter table public.cash_movements add constraint cash_movements_purpose_valid
      check (purpose in ('expense', 'to_bank', 'to_owner', 'from_bank', 'from_owner', 'other'));
  end if;
end;
$$;

create or replace function public.acc_post_cash_movement(p_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_move public.cash_movements%rowtype;
  v_other text;
begin
  select * into v_move from public.cash_movements where id = p_id;
  if not found then
    return null;
  end if;
  v_other := case
    when v_move.purpose in ('to_bank', 'from_bank') then '1-1200'
    when v_move.purpose = 'to_owner' then '3-3000'
    when v_move.purpose = 'from_owner' then '3-1000'
    when v_move.direction = 'out' then '6-9100'
    else '4-9100' end;
  return public.acc_post(
    v_move.cafe_id, public.acc_local_date(v_move.created_at), 'auto', 'cash_movement', v_move.id::text, 'posted',
    case when v_move.direction = 'out' then 'Kas keluar: ' else 'Kas masuk: ' end || v_move.reason,
    case when v_move.direction = 'out'
      then jsonb_build_array(jsonb_build_object('code', v_other, 'debit', v_move.amount), jsonb_build_object('code', '1-1100', 'credit', v_move.amount))
      else jsonb_build_array(jsonb_build_object('code', '1-1100', 'debit', v_move.amount), jsonb_build_object('code', v_other, 'credit', v_move.amount)) end
  );
end;
$$;
revoke all on function public.acc_post_cash_movement(uuid) from public, anon, authenticated;

create or replace function public.acc_post_cashier_close(p_session_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.cashier_sessions%rowtype;
  v_diff numeric(14, 2);
begin
  select * into v_session from public.cashier_sessions where id = p_session_id;
  if not found or v_session.status <> 'closed' or coalesce(v_session.difference, 0) = 0 then
    return null;
  end if;
  v_diff := v_session.difference;
  return public.acc_post(
    v_session.cafe_id, public.acc_local_date(v_session.closed_at), 'auto', 'cashier_session', v_session.id::text, 'difference',
    case when v_diff < 0 then 'Selisih kas kurang saat tutup kasir' else 'Selisih kas lebih saat tutup kasir' end,
    case when v_diff < 0
      then jsonb_build_array(jsonb_build_object('code', '6-9200', 'debit', -v_diff), jsonb_build_object('code', '1-1100', 'credit', -v_diff))
      else jsonb_build_array(jsonb_build_object('code', '1-1100', 'debit', v_diff), jsonb_build_object('code', '4-9200', 'credit', v_diff)) end
  );
end;
$$;
revoke all on function public.acc_post_cashier_close(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- D. Beban operasional
-- ---------------------------------------------------------------------
create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  cafe_id uuid not null references public.cafes (id) on delete cascade,
  expense_date date not null,
  account_id uuid not null references public.accounts (id),
  description text not null check (char_length(description) between 3 and 200),
  amount numeric(14, 2) not null check (amount > 0),
  payment_method text not null check (payment_method in ('cash', 'bank_transfer', 'qris', 'ewallet', 'unpaid')),
  vendor text check (vendor is null or char_length(vendor) <= 80),
  receipt_path text check (receipt_path is null or char_length(receipt_path) <= 300),
  status text not null default 'posted' check (status in ('posted', 'void')),
  paid_on date,
  paid_method text check (paid_method is null or paid_method in ('cash', 'bank_transfer', 'qris', 'ewallet')),
  void_reason text check (void_reason is null or char_length(void_reason) <= 300),
  voided_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists expenses_cafe_date_idx on public.expenses (cafe_id, expense_date desc);

create or replace function public.acc_post_expense(p_expense_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exp public.expenses%rowtype;
  v_journal uuid;
  v_paid uuid;
begin
  select * into v_exp from public.expenses where id = p_expense_id;
  if not found then
    return null;
  end if;
  v_journal := public.acc_post(
    v_exp.cafe_id, v_exp.expense_date, 'auto', 'expense', v_exp.id::text, 'recorded', 'Beban: ' || v_exp.description,
    jsonb_build_array(
      jsonb_build_object('account_id', v_exp.account_id, 'debit', v_exp.amount, 'memo', v_exp.vendor),
      jsonb_build_object('code', public.acc_cash_account(v_exp.payment_method), 'credit', v_exp.amount)
    )
  );
  if v_exp.payment_method = 'unpaid' and v_exp.paid_on is not null then
    v_paid := public.acc_post(
      v_exp.cafe_id, v_exp.paid_on, 'auto', 'expense', v_exp.id::text, 'paid', 'Pelunasan beban: ' || v_exp.description,
      jsonb_build_array(jsonb_build_object('code', '2-1300', 'debit', v_exp.amount), jsonb_build_object('code', public.acc_cash_account(v_exp.paid_method), 'credit', v_exp.amount))
    );
  end if;
  if v_exp.status = 'void' then
    if v_journal is not null and not exists (select 1 from public.journal_entries j where j.reversal_of = v_journal) then
      perform public.acc_reverse_internal(v_journal, 'Beban dibatalkan: ' || coalesce(v_exp.void_reason, ''), public.acc_local_date(v_exp.voided_at), 'void');
    end if;
    if v_paid is not null and not exists (select 1 from public.journal_entries j where j.reversal_of = v_paid) then
      perform public.acc_reverse_internal(v_paid, 'Beban dibatalkan', public.acc_local_date(v_exp.voided_at), 'void');
    end if;
  end if;
  return v_journal;
end;
$$;
revoke all on function public.acc_post_expense(uuid) from public, anon, authenticated;

create or replace function public.expense_create(
  p_cafe_id uuid,
  p_date date,
  p_account_id uuid,
  p_description text,
  p_amount numeric,
  p_method text,
  p_vendor text default null,
  p_receipt_path text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform public.acc_require_owner(p_cafe_id);
  if p_date is null or p_date > (now() at time zone 'Asia/Jakarta')::date then
    raise exception 'Tanggal beban tidak boleh di masa depan' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.accounts a
    where a.id = p_account_id and a.cafe_id = p_cafe_id and a.is_active and a.type in ('expense', 'other_expense', 'cogs', 'asset')
  ) then
    raise exception 'Pilih kategori beban yang valid' using errcode = '22023';
  end if;
  if char_length(coalesce(public.inv_clean_text(p_description, 200), '')) < 3 then
    raise exception 'Tulis keterangan beban' using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > 1000000000 then
    raise exception 'Nominal harus lebih dari 0' using errcode = '22023';
  end if;
  if p_receipt_path is not null and split_part(p_receipt_path, '/', 1) <> p_cafe_id::text then
    raise exception 'Lampiran nota tidak valid' using errcode = '22023';
  end if;
  insert into public.expenses (cafe_id, expense_date, account_id, description, amount, payment_method, vendor, receipt_path)
  values (p_cafe_id, p_date, p_account_id, public.inv_clean_text(p_description, 200), round(p_amount, 2), p_method,
          public.inv_clean_text(p_vendor, 80), p_receipt_path)
  returning id into v_id;
  perform public.acc_post_expense(v_id);
  return v_id;
end;
$$;
revoke all on function public.expense_create(uuid, date, uuid, text, numeric, text, text, text) from public, anon;
grant execute on function public.expense_create(uuid, date, uuid, text, numeric, text, text, text) to authenticated;

create or replace function public.expense_pay(p_expense_id uuid, p_method text, p_date date default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exp public.expenses%rowtype;
begin
  select * into v_exp from public.expenses where id = p_expense_id for update;
  if not found then
    raise exception 'Beban tidak ditemukan' using errcode = 'P0002';
  end if;
  perform public.acc_require_owner(v_exp.cafe_id);
  if v_exp.status <> 'posted' or v_exp.payment_method <> 'unpaid' or v_exp.paid_on is not null then
    raise exception 'Beban ini sudah dibayar atau dibatalkan' using errcode = '22023';
  end if;
  if p_method not in ('cash', 'bank_transfer', 'qris', 'ewallet') then
    raise exception 'Metode pembayaran tidak dikenal' using errcode = '22023';
  end if;
  update public.expenses
  set paid_on = greatest(coalesce(p_date, (now() at time zone 'Asia/Jakarta')::date), v_exp.expense_date), paid_method = p_method
  where id = p_expense_id;
  perform public.acc_post_expense(p_expense_id);
end;
$$;
revoke all on function public.expense_pay(uuid, text, date) from public, anon;
grant execute on function public.expense_pay(uuid, text, date) to authenticated;

create or replace function public.expense_void(p_expense_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exp public.expenses%rowtype;
begin
  select * into v_exp from public.expenses where id = p_expense_id for update;
  if not found then
    raise exception 'Beban tidak ditemukan' using errcode = 'P0002';
  end if;
  perform public.acc_require_owner(v_exp.cafe_id);
  if v_exp.status = 'void' then
    raise exception 'Beban ini sudah dibatalkan' using errcode = '22023';
  end if;
  if char_length(coalesce(public.inv_clean_text(p_reason, 300), '')) < 3 then
    raise exception 'Tulis alasan pembatalan' using errcode = '22023';
  end if;
  update public.expenses set status = 'void', void_reason = public.inv_clean_text(p_reason, 300), voided_at = now() where id = p_expense_id;
  perform public.acc_post_expense(p_expense_id);
end;
$$;
revoke all on function public.expense_void(uuid, text) from public, anon;
grant execute on function public.expense_void(uuid, text) to authenticated;

-- Jurnal manual (owner). p_lines = [{ account_id, debit, credit, memo? }]
create or replace function public.acc_manual_journal(p_cafe_id uuid, p_date date, p_memo text, p_lines jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_go_live date;
begin
  perform public.acc_require_owner(p_cafe_id);
  select s.accounting_go_live into v_go_live from public.cafe_settings s where s.cafe_id = p_cafe_id;
  if v_go_live is null then
    raise exception 'Mulai pembukuan dulu (tanggal go-live & saldo awal)' using errcode = '22023';
  end if;
  if p_date is null or p_date < v_go_live or p_date > (now() at time zone 'Asia/Jakarta')::date then
    raise exception 'Tanggal jurnal harus antara go-live (%) dan hari ini', to_char(v_go_live, 'DD/MM/YYYY') using errcode = '22023';
  end if;
  if char_length(coalesce(public.inv_clean_text(p_memo, 300), '')) < 3 then
    raise exception 'Tulis keterangan jurnal' using errcode = '22023';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) not between 2 and 30 then
    raise exception 'Jurnal berisi 2–30 baris' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_lines) x
    where coalesce((x ->> 'debit')::numeric, 0) < 0 or coalesce((x ->> 'credit')::numeric, 0) < 0
       or (coalesce((x ->> 'debit')::numeric, 0) > 0) = (coalesce((x ->> 'credit')::numeric, 0) > 0)
       or not exists (select 1 from public.accounts a where a.id = (x ->> 'account_id')::uuid and a.cafe_id = p_cafe_id and a.is_active)
  ) then
    raise exception 'Setiap baris wajib satu akun aktif dan hanya debit atau kredit' using errcode = '22023';
  end if;
  v_id := public.acc_post(p_cafe_id, p_date, 'manual', null, null, null, p_memo, p_lines);
  insert into public.audit_logs (cafe_id, actor_id, action, entity, entity_id, label)
  select p_cafe_id, (select auth.uid()), 'insert', 'journal_entries', v_id::text, j.number from public.journal_entries j where j.id = v_id;
  return v_id;
end;
$$;
revoke all on function public.acc_manual_journal(uuid, date, text, jsonb) from public, anon;
grant execute on function public.acc_manual_journal(uuid, date, text, jsonb) to authenticated;

create or replace function public.acc_reverse_journal(p_journal_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cafe uuid;
  v_id uuid;
begin
  select j.cafe_id into v_cafe from public.journal_entries j where j.id = p_journal_id;
  perform public.acc_require_owner(v_cafe);
  if char_length(coalesce(public.inv_clean_text(p_reason, 200), '')) < 3 then
    raise exception 'Tulis alasan pembalikan' using errcode = '22023';
  end if;
  v_id := public.acc_reverse_internal(p_journal_id, p_reason, null, 'manual-' || left(gen_random_uuid()::text, 8));
  insert into public.audit_logs (cafe_id, actor_id, action, entity, entity_id, label, changes)
  select v_cafe, (select auth.uid()), 'update', 'journal_entries', p_journal_id::text, j.number, jsonb_build_object('dibalik', p_reason)
  from public.journal_entries j where j.id = p_journal_id;
  return v_id;
end;
$$;
revoke all on function public.acc_reverse_journal(uuid, text) from public, anon;
grant execute on function public.acc_reverse_journal(uuid, text) to authenticated;

-- Kelola akun: tambah akun baru, ubah nama/aktif. Kode & jenis akun sistem tetap.
create or replace function public.acc_account_save(
  p_cafe_id uuid, p_id uuid, p_code text, p_name text, p_type text, p_cash_flow text, p_is_active boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account public.accounts%rowtype;
  v_id uuid := p_id;
begin
  perform public.acc_require_owner(p_cafe_id);
  if char_length(coalesce(public.inv_clean_text(p_name, 80), '')) < 2 then
    raise exception 'Nama akun minimal 2 huruf' using errcode = '22023';
  end if;
  if p_id is null then
    if p_code !~ '^[1-9]-[0-9]{4}$' then
      raise exception 'Kode akun berformat 6-1234' using errcode = '22023';
    end if;
    if p_type not in ('asset', 'liability', 'equity', 'revenue', 'contra_revenue', 'cogs', 'expense', 'other_income', 'other_expense') then
      raise exception 'Jenis akun tidak dikenal' using errcode = '22023';
    end if;
    begin
      insert into public.accounts (cafe_id, code, name, type, cash_flow)
      values (p_cafe_id, p_code, public.inv_clean_text(p_name, 80), p_type, coalesce(nullif(p_cash_flow, ''), 'operating'))
      returning id into v_id;
    exception when unique_violation then
      raise exception 'Kode akun % sudah dipakai', p_code using errcode = '23505';
    end;
    return v_id;
  end if;
  select * into v_account from public.accounts where id = p_id and cafe_id = p_cafe_id for update;
  if not found then
    raise exception 'Akun tidak ditemukan' using errcode = 'P0002';
  end if;
  if v_account.is_system and not coalesce(p_is_active, true) then
    raise exception 'Akun sistem tidak bisa dinonaktifkan' using errcode = '22023';
  end if;
  update public.accounts
  set name = public.inv_clean_text(p_name, 80),
      is_active = coalesce(p_is_active, is_active),
      cash_flow = case when is_system then cash_flow else coalesce(nullif(p_cash_flow, ''), cash_flow) end
  where id = p_id;
  return p_id;
end;
$$;
revoke all on function public.acc_account_save(uuid, uuid, text, text, text, text, boolean) from public, anon;
grant execute on function public.acc_account_save(uuid, uuid, text, text, text, text, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- F. Go-live, sinkronisasi ulang, periode
-- ---------------------------------------------------------------------
create or replace function public.acc_log_issue(p_cafe_id uuid, p_source text, p_id text, p_message text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.acc_sync_issues (cafe_id, source_type, source_id, message)
  values (p_cafe_id, p_source, p_id, left(p_message, 500));
$$;
revoke all on function public.acc_log_issue(uuid, text, text, text) from public, anon, authenticated;

-- Jurnal ulang semua kejadian sejak go-live (aman diulang: kejadian yang sudah dijurnal dilewati)
create or replace function public.acc_backfill(p_cafe_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_go_live date;
  v_from timestamptz;
  v_row record;
  v_ok integer := 0;
  v_failed integer := 0;
begin
  perform public.acc_require_owner(p_cafe_id);
  select s.accounting_go_live into v_go_live from public.cafe_settings s where s.cafe_id = p_cafe_id;
  if v_go_live is null then
    raise exception 'Pembukuan belum dimulai' using errcode = '22023';
  end if;
  v_from := (v_go_live::timestamp at time zone 'Asia/Jakarta');

  for v_row in
    select 'stock_movement' as kind, m.id::text as id, m.occurred_at as at from public.stock_movements m
      where m.cafe_id = p_cafe_id and m.movement_type <> 'sale' and m.occurred_at >= v_from
    union all
    select 'order', o.id::text, o.updated_at from public.orders o
      where o.cafe_id = p_cafe_id and o.order_status = 'completed' and o.updated_at >= v_from
    union all
    select 'payment', p.id::text, coalesce(p.paid_at, p.created_at) from public.payments p
      join public.orders o on o.id = p.order_id
      where o.cafe_id = p_cafe_id and p.status in ('paid', 'refunded') and coalesce(p.paid_at, p.created_at) >= v_from
    union all
    select 'supplier_payment', sp.id::text, sp.created_at from public.supplier_payments sp
      where sp.cafe_id = p_cafe_id and sp.paid_on >= v_go_live
    union all
    select 'cash_movement', cm.id::text, cm.created_at from public.cash_movements cm
      where cm.cafe_id = p_cafe_id and cm.created_at >= v_from
    union all
    select 'cashier_session', cs.id::text, cs.closed_at from public.cashier_sessions cs
      where cs.cafe_id = p_cafe_id and cs.status = 'closed' and cs.closed_at >= v_from
    union all
    select 'expense', e.id::text, e.created_at from public.expenses e
      where e.cafe_id = p_cafe_id and e.expense_date >= v_go_live
    order by 3, 1
  loop
    begin
      case v_row.kind
        when 'stock_movement' then perform public.acc_post_stock_movement(v_row.id::bigint);
        when 'order' then perform public.acc_post_order(v_row.id::uuid);
        when 'payment' then perform public.acc_post_payment(v_row.id::uuid);
        when 'supplier_payment' then perform public.acc_post_supplier_payment(v_row.id::uuid);
        when 'cash_movement' then perform public.acc_post_cash_movement(v_row.id::uuid);
        when 'cashier_session' then perform public.acc_post_cashier_close(v_row.id::uuid);
        when 'expense' then perform public.acc_post_expense(v_row.id::uuid);
      end case;
      v_ok := v_ok + 1;
    exception when others then
      v_failed := v_failed + 1;
      perform public.acc_log_issue(p_cafe_id, v_row.kind, v_row.id, sqlerrm);
    end;
  end loop;
  -- Kegagalan lama yang kini berhasil ditandai selesai
  update public.acc_sync_issues i set resolved_at = now()
  where i.cafe_id = p_cafe_id and i.resolved_at is null
    and exists (select 1 from public.journal_entries j where j.cafe_id = p_cafe_id and j.source_type = i.source_type and j.source_id = i.source_id);
  return jsonb_build_object('checked', v_ok, 'failed', v_failed);
end;
$$;
revoke all on function public.acc_backfill(uuid) from public, anon;
grant execute on function public.acc_backfill(uuid) to authenticated;

-- Saran saldo awal dari data yang ada (persediaan, piutang/uang muka, utang supplier)
create or replace function public.acc_opening_suggestions(p_cafe_id uuid, p_date date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from timestamptz := (p_date::timestamp at time zone 'Asia/Jakarta');
begin
  perform public.acc_require_owner(p_cafe_id);
  -- Semua angka = posisi PADA tanggal go-live (kejadian sesudahnya akan dijurnal otomatis)
  return jsonb_build_object(
    'inventory', (
      select coalesce(round(
        (select coalesce(sum(greatest(i.on_hand, 0) * i.avg_cost), 0) from public.ingredients i where i.cafe_id = p_cafe_id)
        - (select coalesce(sum(m.total_cost), 0) from public.stock_movements m where m.cafe_id = p_cafe_id and m.occurred_at >= v_from), 0), 0)
    ),
    'receivable', (
      select coalesce(round(
        (select coalesce(sum(o.total_amount), 0) from public.orders o
          where o.cafe_id = p_cafe_id and o.order_status = 'completed'
            and exists (select 1 from public.order_status_events e where e.order_id = o.id and e.to_status = 'completed' and e.created_at < v_from))
        - (select coalesce(sum(case when p.status = 'paid' then p.amount else -p.amount end), 0)
             from public.payments p join public.orders o on o.id = p.order_id
             where o.cafe_id = p_cafe_id and p.status in ('paid', 'refunded') and p.verification <> 'demo'
               and coalesce(p.paid_at, p.created_at) < v_from), 0), 0)
    ),
    'payable', (
      select coalesce(round(
        (select coalesce(sum(m.total_cost), 0) from public.stock_movements m
          where m.cafe_id = p_cafe_id and m.purchase_order_id is not null and m.movement_type = 'purchase' and m.occurred_at < v_from)
        - (select coalesce(sum(sp.amount), 0) from public.supplier_payments sp
             where sp.cafe_id = p_cafe_id and sp.paid_on < p_date and (sp.voided_at is null or sp.voided_at >= v_from)), 0), 0)
    )
  );
end;
$$;
revoke all on function public.acc_opening_suggestions(uuid, date) from public, anon;
grant execute on function public.acc_opening_suggestions(uuid, date) to authenticated;

-- Mulai pembukuan: tanggal go-live + saldo awal. p_lines = [{ code, amount }] (aset = saldo debit; utang/modal = saldo kredit)
create or replace function public.acc_setup(p_cafe_id uuid, p_go_live date, p_lines jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Jakarta')::date;
  v_line jsonb;
  v_type text;
  v_amount numeric(14, 2);
  v_lines jsonb := '[]'::jsonb;
  v_debit numeric(14, 2) := 0;
  v_credit numeric(14, 2) := 0;
  v_journal uuid;
  v_backfill jsonb;
begin
  perform public.acc_require_owner(p_cafe_id);
  if exists (select 1 from public.cafe_settings s where s.cafe_id = p_cafe_id and s.accounting_go_live is not null) then
    raise exception 'Pembukuan sudah dimulai. Koreksi saldo awal lewat jurnal manual.' using errcode = '22023';
  end if;
  if p_go_live is null or p_go_live > v_today or p_go_live < v_today - 366 then
    raise exception 'Tanggal mulai harus antara 1 tahun lalu dan hari ini' using errcode = '22023';
  end if;
  perform public.acc_seed_accounts(p_cafe_id);

  for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_amount := round(coalesce((v_line ->> 'amount')::numeric, 0), 2);
    continue when v_amount = 0;
    select a.type into v_type from public.accounts a where a.cafe_id = p_cafe_id and a.code = v_line ->> 'code';
    if v_type is null or v_type not in ('asset', 'liability', 'equity') then
      raise exception 'Saldo awal hanya untuk akun aset, utang, atau modal (%)', v_line ->> 'code' using errcode = '22023';
    end if;
    if v_type = 'asset' then
      v_lines := v_lines || jsonb_build_array(jsonb_build_object('code', v_line ->> 'code', 'debit', v_amount));
      v_debit := v_debit + v_amount;
    else
      v_lines := v_lines || jsonb_build_array(jsonb_build_object('code', v_line ->> 'code', 'credit', v_amount));
      v_credit := v_credit + v_amount;
    end if;
  end loop;
  -- Selisih aset − (utang + modal) masuk Ekuitas saldo awal agar neraca seimbang
  v_lines := v_lines || jsonb_build_array(jsonb_build_object('code', '3-9000', 'credit', v_debit - v_credit));

  update public.cafe_settings set accounting_go_live = p_go_live where cafe_id = p_cafe_id;
  v_journal := public.acc_post(p_cafe_id, p_go_live, 'opening', 'opening', p_cafe_id::text, 'opening', 'Saldo awal pembukuan', v_lines);
  v_backfill := public.acc_backfill(p_cafe_id);
  insert into public.audit_logs (cafe_id, actor_id, action, entity, entity_id, label, changes)
  values (p_cafe_id, (select auth.uid()), 'insert', 'accounting_setup', p_cafe_id::text, 'Mulai pembukuan',
          jsonb_build_object('go_live', p_go_live, 'total_aset', v_debit));
  return jsonb_build_object('journal_id', v_journal, 'backfill', v_backfill);
end;
$$;
revoke all on function public.acc_setup(uuid, date, jsonb) from public, anon;
grant execute on function public.acc_setup(uuid, date, jsonb) to authenticated;

create or replace function public.acc_set_period(p_cafe_id uuid, p_month date, p_close boolean, p_note text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_start date := date_trunc('month', p_month)::date;
begin
  perform public.acc_require_owner(p_cafe_id);
  if p_close and v_start >= date_trunc('month', (now() at time zone 'Asia/Jakarta')::date)::date then
    raise exception 'Bulan berjalan belum bisa ditutup' using errcode = '22023';
  end if;
  if not p_close and char_length(coalesce(public.inv_clean_text(p_note, 300), '')) < 3 then
    raise exception 'Tulis alasan membuka kembali periode' using errcode = '22023';
  end if;
  insert into public.accounting_periods (cafe_id, period_start, status, closed_at, closed_by, note)
  values (p_cafe_id, v_start, case when p_close then 'closed' else 'open' end, now(), (select auth.uid()), public.inv_clean_text(p_note, 300))
  on conflict (cafe_id, period_start) do update
  set status = excluded.status, closed_at = excluded.closed_at, closed_by = excluded.closed_by, note = excluded.note;
  return case when p_close then 'closed' else 'open' end;
end;
$$;
revoke all on function public.acc_set_period(uuid, date, boolean, text) from public, anon;
grant execute on function public.acc_set_period(uuid, date, boolean, text) to authenticated;

-- ---------------------------------------------------------------------
-- E. Laporan (semua dihitung dari jurnal)
-- ---------------------------------------------------------------------
-- Saldo per akun (debit − kredit) untuk rentang tanggal
create or replace function public.acc_account_totals(p_cafe_id uuid, p_from date, p_to date)
returns table (account_id uuid, code text, name text, type text, cash_flow text, is_cash boolean, debit numeric, credit numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.code, a.name, a.type, a.cash_flow, a.is_cash,
         coalesce(sum(l.debit), 0), coalesce(sum(l.credit), 0)
  from public.accounts a
  left join public.journal_lines l on l.account_id = a.id
    and exists (select 1 from public.journal_entries j where j.id = l.journal_id
                and (p_from is null or j.entry_date >= p_from) and j.entry_date <= p_to)
  where a.cafe_id = p_cafe_id
  group by a.id, a.code, a.name, a.type, a.cash_flow, a.is_cash;
$$;
revoke all on function public.acc_account_totals(uuid, date, date) from public, anon, authenticated;

create or replace function public.acc_trial_balance(p_cafe_id uuid, p_as_of date)
returns table (account_id uuid, code text, name text, type text, debit numeric, credit numeric, balance_debit numeric, balance_credit numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform public.acc_require_owner(p_cafe_id);
  return query
  select t.account_id, t.code, t.name, t.type, t.debit, t.credit,
         greatest(t.debit - t.credit, 0), greatest(t.credit - t.debit, 0)
  from public.acc_account_totals(p_cafe_id, null, p_as_of) t
  where t.debit <> 0 or t.credit <> 0
  order by t.code;
end;
$$;
revoke all on function public.acc_trial_balance(uuid, date) from public, anon;
grant execute on function public.acc_trial_balance(uuid, date) to authenticated;

create or replace function public.acc_ledger(p_cafe_id uuid, p_account_id uuid, p_from date, p_to date)
returns table (journal_id uuid, entry_date date, number text, memo text, kind text, debit numeric, credit numeric, balance numeric, opening numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_opening numeric;
  v_sign integer;
begin
  perform public.acc_require_owner(p_cafe_id);
  select case when a.type in ('asset', 'contra_revenue', 'cogs', 'expense', 'other_expense') then 1 else -1 end into v_sign
  from public.accounts a where a.id = p_account_id and a.cafe_id = p_cafe_id;
  if v_sign is null then
    raise exception 'Akun tidak ditemukan' using errcode = 'P0002';
  end if;
  select coalesce(sum(l.debit - l.credit), 0) * v_sign into v_opening
  from public.journal_lines l join public.journal_entries j on j.id = l.journal_id
  where l.account_id = p_account_id and j.entry_date < p_from;
  return query
  select j.id, j.entry_date, j.number, coalesce(l.memo, j.memo), j.kind, l.debit, l.credit,
         v_opening + sum((l.debit - l.credit) * v_sign) over (order by j.entry_date, j.created_at, l.id),
         v_opening
  from public.journal_lines l join public.journal_entries j on j.id = l.journal_id
  where l.account_id = p_account_id and j.entry_date between p_from and p_to
  order by j.entry_date, j.created_at, l.id;
end;
$$;
revoke all on function public.acc_ledger(uuid, uuid, date, date) from public, anon;
grant execute on function public.acc_ledger(uuid, uuid, date, date) to authenticated;

-- Laba rugi: amount bertanda alami (pendapatan +, beban +)
create or replace function public.acc_income_statement(p_cafe_id uuid, p_from date, p_to date)
returns table (section text, code text, name text, amount numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform public.acc_require_owner(p_cafe_id);
  return query
  select t.type, t.code, t.name,
         case when t.type in ('revenue', 'other_income') then t.credit - t.debit else t.debit - t.credit end
  from public.acc_account_totals(p_cafe_id, p_from, p_to) t
  where t.type in ('revenue', 'contra_revenue', 'cogs', 'expense', 'other_income', 'other_expense')
    and (t.debit <> 0 or t.credit <> 0)
  order by t.code;
end;
$$;
revoke all on function public.acc_income_statement(uuid, date, date) from public, anon;
grant execute on function public.acc_income_statement(uuid, date, date) to authenticated;

-- Neraca per tanggal + laba berjalan (belum ditutup ke laba ditahan)
create or replace function public.acc_balance_sheet(p_cafe_id uuid, p_as_of date)
returns table (section text, code text, name text, amount numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform public.acc_require_owner(p_cafe_id);
  return query
  with t as (select * from public.acc_account_totals(p_cafe_id, null, p_as_of))
  select t.type, t.code, t.name,
         case when t.type = 'asset' then t.debit - t.credit else t.credit - t.debit end
  from t
  where t.type in ('asset', 'liability', 'equity') and (t.debit <> 0 or t.credit <> 0)
  union all
  select 'equity', '3-9999', 'Laba (rugi) berjalan',
         coalesce(sum(case when t.type in ('revenue', 'other_income') then t.credit - t.debit else -(t.debit - t.credit) end), 0)
  from t
  where t.type in ('revenue', 'contra_revenue', 'cogs', 'expense', 'other_income', 'other_expense')
  order by 2;
end;
$$;
revoke all on function public.acc_balance_sheet(uuid, date) from public, anon;
grant execute on function public.acc_balance_sheet(uuid, date) to authenticated;

-- Arus kas metode langsung: untuk setiap jurnal yang menyentuh akun kas/bank,
-- (kredit − debit) setiap baris non-kas = arus kas yang terkait akun itu.
create or replace function public.acc_cash_flow(p_cafe_id uuid, p_from date, p_to date)
returns table (section text, code text, name text, amount numeric, opening_cash numeric, closing_cash numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_opening numeric;
  v_closing numeric;
begin
  perform public.acc_require_owner(p_cafe_id);
  select coalesce(sum(l.debit - l.credit), 0) into v_opening
  from public.journal_lines l join public.journal_entries j on j.id = l.journal_id join public.accounts a on a.id = l.account_id
  where j.cafe_id = p_cafe_id and a.is_cash and j.entry_date < p_from;
  select coalesce(sum(l.debit - l.credit), 0) into v_closing
  from public.journal_lines l join public.journal_entries j on j.id = l.journal_id join public.accounts a on a.id = l.account_id
  where j.cafe_id = p_cafe_id and a.is_cash and j.entry_date <= p_to;
  return query
  select a.cash_flow, a.code, a.name, sum(l.credit - l.debit), v_opening, v_closing
  from public.journal_entries j
  join public.journal_lines l on l.journal_id = j.id
  join public.accounts a on a.id = l.account_id
  where j.cafe_id = p_cafe_id and j.entry_date between p_from and p_to and not a.is_cash
    and exists (select 1 from public.journal_lines c join public.accounts ca on ca.id = c.account_id where c.journal_id = j.id and ca.is_cash)
  group by a.cash_flow, a.code, a.name
  having sum(l.credit - l.debit) <> 0
  union all
  select 'none', null, null, 0, v_opening, v_closing
  order by 1, 2;
end;
$$;
revoke all on function public.acc_cash_flow(uuid, date, date) from public, anon;
grant execute on function public.acc_cash_flow(uuid, date, date) to authenticated;

create or replace function public.acc_equity_changes(p_cafe_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_before record;
  v_period record;
begin
  perform public.acc_require_owner(p_cafe_id);
  select
    coalesce(sum(t.credit - t.debit) filter (where t.type = 'equity'), 0) as equity,
    coalesce(sum(case when t.type in ('revenue', 'other_income') then t.credit - t.debit
                      when t.type in ('contra_revenue', 'cogs', 'expense', 'other_expense') then -(t.debit - t.credit) end), 0) as earnings
  into v_before
  from public.acc_account_totals(p_cafe_id, null, p_from - 1) t;
  select
    coalesce(sum(t.credit - t.debit) filter (where t.code in ('3-1000', '3-9000')), 0) as contributions,
    coalesce(sum(t.debit - t.credit) filter (where t.code = '3-3000'), 0) as withdrawals,
    coalesce(sum(t.credit - t.debit) filter (where t.type = 'equity' and t.code not in ('3-1000', '3-9000', '3-3000')), 0) as other,
    coalesce(sum(case when t.type in ('revenue', 'other_income') then t.credit - t.debit
                      when t.type in ('contra_revenue', 'cogs', 'expense', 'other_expense') then -(t.debit - t.credit) end), 0) as net_income
  into v_period
  from public.acc_account_totals(p_cafe_id, p_from, p_to) t;
  return jsonb_build_object(
    'opening', v_before.equity + v_before.earnings,
    'contributions', v_period.contributions,
    'withdrawals', v_period.withdrawals,
    'other', v_period.other,
    'net_income', v_period.net_income,
    'closing', v_before.equity + v_before.earnings + v_period.contributions - v_period.withdrawals + v_period.other + v_period.net_income
  );
end;
$$;
revoke all on function public.acc_equity_changes(uuid, date, date) from public, anon;
grant execute on function public.acc_equity_changes(uuid, date, date) to authenticated;

-- Ringkasan keuangan untuk dashboard owner
create or replace function public.acc_overview(p_cafe_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_go_live date;
  v_pl record;
  v_bal record;
begin
  perform public.acc_require_owner(p_cafe_id);
  select s.accounting_go_live into v_go_live from public.cafe_settings s where s.cafe_id = p_cafe_id;
  if v_go_live is null then
    return jsonb_build_object('go_live', null);
  end if;
  select
    coalesce(sum(t.credit - t.debit) filter (where t.type = 'revenue'), 0) as revenue,
    coalesce(sum(t.debit - t.credit) filter (where t.type = 'contra_revenue'), 0) as contra,
    coalesce(sum(t.debit - t.credit) filter (where t.type = 'cogs'), 0) as cogs,
    coalesce(sum(t.debit - t.credit) filter (where t.type = 'expense'), 0) as expenses,
    coalesce(sum(t.credit - t.debit) filter (where t.type = 'other_income'), 0) - coalesce(sum(t.debit - t.credit) filter (where t.type = 'other_expense'), 0) as other
  into v_pl
  from public.acc_account_totals(p_cafe_id, p_from, p_to) t;
  select
    coalesce(sum(t.debit - t.credit) filter (where t.code = '1-1100'), 0) as cash,
    coalesce(sum(t.debit - t.credit) filter (where t.code = '1-1150'), 0) as wallet,
    coalesce(sum(t.debit - t.credit) filter (where t.code = '1-1200'), 0) as bank,
    coalesce(sum(t.debit - t.credit) filter (where t.code = '1-1300'), 0) as receivable,
    coalesce(sum(t.debit - t.credit) filter (where t.code = '1-1400'), 0) as inventory,
    coalesce(sum(t.credit - t.debit) filter (where t.code = '2-1100'), 0) as payable,
    coalesce(sum(t.credit - t.debit) filter (where t.code = '2-1200'), 0) as tax_payable,
    coalesce(sum(t.debit - t.credit) filter (where t.type = 'asset'), 0) as assets,
    coalesce(sum(t.credit - t.debit) filter (where t.type = 'liability'), 0) as liabilities,
    coalesce(sum(t.credit - t.debit) filter (where t.type = 'equity'), 0)
      + coalesce(sum(case when t.type in ('revenue', 'other_income') then t.credit - t.debit
                          when t.type in ('contra_revenue', 'cogs', 'expense', 'other_expense') then -(t.debit - t.credit) end), 0) as equity
  into v_bal
  from public.acc_account_totals(p_cafe_id, null, p_to) t;
  return jsonb_build_object(
    'go_live', v_go_live,
    'revenue', v_pl.revenue, 'contra_revenue', v_pl.contra, 'net_revenue', v_pl.revenue - v_pl.contra,
    'cogs', v_pl.cogs, 'gross_profit', v_pl.revenue - v_pl.contra - v_pl.cogs,
    'expenses', v_pl.expenses, 'other', v_pl.other,
    'net_profit', v_pl.revenue - v_pl.contra - v_pl.cogs - v_pl.expenses + v_pl.other,
    'cash', v_bal.cash, 'wallet', v_bal.wallet, 'bank', v_bal.bank, 'receivable', v_bal.receivable,
    'inventory', v_bal.inventory, 'payable', v_bal.payable, 'tax_payable', v_bal.tax_payable,
    'assets', v_bal.assets, 'liabilities', v_bal.liabilities, 'equity', v_bal.equity,
    'issues', (select count(*) from public.acc_sync_issues i where i.cafe_id = p_cafe_id and i.resolved_at is null)
  );
end;
$$;
revoke all on function public.acc_overview(uuid, date, date) from public, anon;
grant execute on function public.acc_overview(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------------
-- Pengait otomatis (gagal = dicatat, transaksi tetap jalan)
-- ---------------------------------------------------------------------
create or replace function public.acc_hook()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cafe uuid;
begin
  begin
    case tg_table_name
      when 'orders' then perform public.acc_post_order(new.id);
      when 'payments' then perform public.acc_post_payment(new.id);
      when 'stock_movements' then perform public.acc_post_stock_movement(new.id);
      when 'supplier_payments' then perform public.acc_post_supplier_payment(new.id);
      when 'cash_movements' then perform public.acc_post_cash_movement(new.id);
      when 'cashier_sessions' then perform public.acc_post_cashier_close(new.id);
    end case;
  exception when others then
    if tg_table_name = 'payments' then
      select o.cafe_id into v_cafe from public.orders o where o.id = new.order_id;
    else
      v_cafe := (to_jsonb(new) ->> 'cafe_id')::uuid;
    end if;
    if v_cafe is not null then
      -- 'orders' → 'order' dst., sama dengan source_type jurnal agar sinkron ulang bisa menandai selesai
      perform public.acc_log_issue(v_cafe, left(tg_table_name, -1), new.id::text, sqlerrm);
    end if;
  end;
  return null;
end;
$$;
revoke all on function public.acc_hook() from public, anon, authenticated;

-- "zz_" → berjalan setelah trigger stok & log status (urutan alfabet), sehingga HPP sudah tersedia
drop trigger if exists zz_acc_order_completed on public.orders;
create trigger zz_acc_order_completed after update of order_status on public.orders
  for each row when (new.order_status = 'completed' and old.order_status is distinct from 'completed')
  execute function public.acc_hook();
drop trigger if exists zz_acc_payment on public.payments;
create trigger zz_acc_payment after insert on public.payments
  for each row when (new.status in ('paid', 'refunded')) execute function public.acc_hook();
drop trigger if exists zz_acc_stock_movement on public.stock_movements;
create trigger zz_acc_stock_movement after insert on public.stock_movements
  for each row when (new.movement_type <> 'sale') execute function public.acc_hook();
drop trigger if exists zz_acc_supplier_payment on public.supplier_payments;
create trigger zz_acc_supplier_payment after insert or update of voided_at on public.supplier_payments
  for each row execute function public.acc_hook();
drop trigger if exists zz_acc_cash_movement on public.cash_movements;
create trigger zz_acc_cash_movement after insert on public.cash_movements
  for each row execute function public.acc_hook();
drop trigger if exists zz_acc_cashier_close on public.cashier_sessions;
create trigger zz_acc_cashier_close after update of status on public.cashier_sessions
  for each row when (new.status = 'closed' and old.status <> 'closed') execute function public.acc_hook();

-- ---------------------------------------------------------------------
-- Fungsi lama dengan parameter baru (versi lama dihapus agar tidak ambigu)
-- ---------------------------------------------------------------------
-- Mutasi menyimpan sumber dana (kas/bank/belum dibayar) untuk jurnal pembelian langsung
create or replace function public.inv_apply_movement(
  p_ingredient_id uuid,
  p_type text,
  p_quantity numeric,
  p_unit_cost numeric default null,
  p_expires_at date default null,
  p_note text default null,
  p_refs jsonb default '{}'::jsonb,
  p_allow_negative boolean default false
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ing public.ingredients%rowtype;
  v_cost numeric(14, 4);
  v_new_qty numeric(14, 3);
  v_new_avg numeric(14, 4);
  v_batch_id uuid;
  v_movement_id bigint;
  v_left numeric(14, 3);
  v_take numeric(14, 3);
  v_batch record;
  v_pick uuid := nullif(p_refs ->> 'batch_id', '')::uuid;
begin
  if p_quantity is null or p_quantity = 0 then
    raise exception 'Jumlah tidak boleh nol' using errcode = '22023';
  end if;
  if abs(p_quantity) > 100000000 then
    raise exception 'Jumlah terlalu besar' using errcode = '22023';
  end if;
  select * into v_ing from public.ingredients where id = p_ingredient_id for update;
  if not found then
    raise exception 'Bahan tidak ditemukan' using errcode = 'P0002';
  end if;
  v_new_qty := v_ing.on_hand + p_quantity;
  if p_type in ('opening', 'purchase') then
    if p_quantity < 0 then
      raise exception 'Stok masuk harus bernilai positif' using errcode = '22023';
    end if;
    if p_unit_cost is null or p_unit_cost < 0 then
      raise exception 'Harga per satuan wajib diisi' using errcode = '22023';
    end if;
    v_cost := p_unit_cost;
    v_new_avg := case
      when v_ing.on_hand <= 0 then p_unit_cost
      else round((v_ing.on_hand * v_ing.avg_cost + p_quantity * p_unit_cost) / v_new_qty, 4)
    end;
  else
    v_cost := v_ing.avg_cost;
    v_new_avg := v_ing.avg_cost;
    if p_quantity > 0 and v_ing.avg_cost = 0 and p_unit_cost is not null and p_unit_cost > 0 then
      v_cost := p_unit_cost;
      v_new_avg := p_unit_cost;
    end if;
  end if;
  if v_new_qty < 0 and not p_allow_negative then
    raise exception 'Stok % tidak cukup: tersedia % %', v_ing.name, trim_scale(v_ing.on_hand), v_ing.unit using errcode = '22023';
  end if;
  if p_quantity > 0 and p_expires_at is not null then
    insert into public.ingredient_batches (cafe_id, ingredient_id, expires_at, quantity, remaining)
    values (v_ing.cafe_id, v_ing.id, p_expires_at, p_quantity, p_quantity)
    returning id into v_batch_id;
  end if;
  insert into public.stock_movements (
    cafe_id, ingredient_id, movement_type, quantity, unit_cost, balance_after, avg_cost_after,
    batch_id, supplier_id, purchase_order_id, stock_count_id, order_id, order_item_id, product_id, note, funding
  )
  values (
    v_ing.cafe_id, v_ing.id, p_type, p_quantity, v_cost, v_new_qty, v_new_avg,
    coalesce(v_batch_id, v_pick),
    nullif(p_refs ->> 'supplier_id', '')::uuid,
    nullif(p_refs ->> 'purchase_order_id', '')::uuid,
    nullif(p_refs ->> 'stock_count_id', '')::uuid,
    nullif(p_refs ->> 'order_id', '')::uuid,
    nullif(p_refs ->> 'order_item_id', '')::uuid,
    nullif(p_refs ->> 'product_id', '')::uuid,
    public.inv_clean_text(p_note, 300),
    nullif(p_refs ->> 'funding', '')
  )
  returning id into v_movement_id;
  update public.ingredients
  set on_hand = v_new_qty,
      avg_cost = v_new_avg,
      last_purchase_cost = case when p_type in ('opening', 'purchase') then p_unit_cost else last_purchase_cost end
  where id = v_ing.id;
  if p_quantity < 0 then
    v_left := -p_quantity;
    for v_batch in
      select b.id, b.remaining from public.ingredient_batches b
      where b.ingredient_id = v_ing.id and b.remaining > 0
      order by (b.id = v_pick) desc nulls last, b.expires_at, b.received_at
      for update
    loop
      exit when v_left <= 0;
      v_take := least(v_left, v_batch.remaining);
      update public.ingredient_batches set remaining = remaining - v_take where id = v_batch.id;
      v_left := v_left - v_take;
    end loop;
  end if;
  return v_movement_id;
end;
$$;
revoke all on function public.inv_apply_movement(uuid, text, numeric, numeric, date, text, jsonb, boolean) from public, anon, authenticated;

drop function if exists public.inventory_stock_in(uuid, numeric, numeric, date, uuid, text, boolean);
create or replace function public.inventory_stock_in(
  p_ingredient_id uuid,
  p_quantity numeric,
  p_unit_cost numeric,
  p_expires_at date default null,
  p_supplier_id uuid default null,
  p_note text default null,
  p_is_opening boolean default false,
  p_funding text default 'cash'
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cafe uuid;
begin
  select i.cafe_id into v_cafe from public.ingredients i where i.id = p_ingredient_id;
  if v_cafe is null then
    raise exception 'Bahan tidak ditemukan' using errcode = 'P0002';
  end if;
  perform public.inv_require_owner(v_cafe);
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Jumlah masuk harus lebih dari 0' using errcode = '22023';
  end if;
  if p_funding is not null and p_funding not in ('cash', 'bank', 'qris', 'payable') then
    raise exception 'Sumber dana tidak dikenal' using errcode = '22023';
  end if;
  if p_supplier_id is not null and not exists (
    select 1 from public.suppliers s where s.id = p_supplier_id and s.cafe_id = v_cafe
  ) then
    raise exception 'Supplier tidak ditemukan di kafe ini' using errcode = '23503';
  end if;
  if p_expires_at is not null and p_expires_at < (now() at time zone 'Asia/Jakarta')::date - 365 then
    raise exception 'Tanggal kedaluwarsa tidak masuk akal' using errcode = '22023';
  end if;
  return public.inv_apply_movement(
    p_ingredient_id,
    case when coalesce(p_is_opening, false) then 'opening' else 'purchase' end,
    p_quantity, p_unit_cost, p_expires_at, p_note,
    jsonb_build_object('supplier_id', p_supplier_id, 'funding', case when coalesce(p_is_opening, false) then null else coalesce(p_funding, 'cash') end)
  );
end;
$$;
revoke all on function public.inventory_stock_in(uuid, numeric, numeric, date, uuid, text, boolean, text) from public, anon;
grant execute on function public.inventory_stock_in(uuid, numeric, numeric, date, uuid, text, boolean, text) to authenticated;

drop function if exists public.cashier_cash_move(uuid, text, numeric, text);
create or replace function public.cashier_cash_move(p_session_id uuid, p_direction text, p_amount numeric, p_reason text, p_purpose text default 'other')
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
  if coalesce(p_purpose, 'other') not in ('expense', 'to_bank', 'to_owner', 'from_bank', 'from_owner', 'other')
     or (p_direction = 'out' and p_purpose in ('from_bank', 'from_owner'))
     or (p_direction = 'in' and p_purpose in ('expense', 'to_bank', 'to_owner')) then
    raise exception 'Jenis kas tidak cocok dengan arahnya' using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > 100000000 then
    raise exception 'Nominal harus lebih dari 0' using errcode = '22023';
  end if;
  if char_length(coalesce(public.inv_clean_text(p_reason, 200), '')) < 3 then
    raise exception 'Tulis keterangan kas masuk/keluar' using errcode = '22023';
  end if;
  insert into public.cash_movements (cafe_id, session_id, direction, amount, reason, purpose)
  values (v_session.cafe_id, v_session.id, p_direction, round(p_amount, 2), public.inv_clean_text(p_reason, 200), coalesce(p_purpose, 'other'))
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.cashier_cash_move(uuid, text, numeric, text, text) from public, anon;
grant execute on function public.cashier_cash_move(uuid, text, numeric, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- RLS & izin: keuangan hanya untuk owner
-- ---------------------------------------------------------------------
do $$
declare
  v_table text;
begin
  foreach v_table in array array['accounts', 'accounting_periods', 'journal_entries', 'journal_lines', 'expenses', 'acc_sync_issues'] loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('revoke all on public.%I from anon, authenticated', v_table);
    execute format('grant select on public.%I to authenticated', v_table);
    execute format('drop policy if exists "Owners view %s" on public.%I', v_table, v_table);
    execute format(
      'create policy "Owners view %s" on public.%I for select to authenticated using (public.is_cafe_member(cafe_id, array[''owner'']))',
      v_table, v_table
    );
  end loop;
end;
$$;
grant update (resolved_at) on public.acc_sync_issues to authenticated;
drop policy if exists "Owners resolve acc issues" on public.acc_sync_issues;
create policy "Owners resolve acc issues" on public.acc_sync_issues for update to authenticated
  using (public.is_cafe_member(cafe_id, array['owner'])) with check (public.is_cafe_member(cafe_id, array['owner']));

-- Log aktivitas: label jurnal memakai nomornya
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
    v_cafe, (select auth.uid()), lower(tg_op), tg_table_name, coalesce(v_row ->> 'id', v_row ->> 'period_start'),
    left(coalesce(v_row ->> 'name', v_row ->> 'label', v_row ->> 'full_name', v_row ->> 'app_name', v_row ->> 'po_number',
                  v_row ->> 'number', v_row ->> 'description', v_row ->> 'period_start'), 120),
    v_changes
  );
  return null;
end;
$$;
revoke all on function public.log_audit_event() from public, anon, authenticated;

-- Akun bawaan (templat) tidak membanjiri log; akun baru buatan owner & perubahan dicatat
drop trigger if exists log_audit_event on public.accounts;
create trigger log_audit_event after update on public.accounts for each row execute function public.log_audit_event();
drop trigger if exists log_audit_event_insert on public.accounts;
create trigger log_audit_event_insert after insert on public.accounts for each row when (not new.is_system) execute function public.log_audit_event();
drop trigger if exists log_audit_event on public.accounting_periods;
create trigger log_audit_event after insert or update on public.accounting_periods for each row execute function public.log_audit_event();
drop trigger if exists log_audit_event on public.expenses;
create trigger log_audit_event after insert or update of status, paid_on on public.expenses for each row execute function public.log_audit_event();

-- Storage nota beban (privat, folder = cafe_id). Dilewati bila schema storage tidak ada.
do $$
begin
  if to_regclass('storage.buckets') is null then
    return;
  end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('expense-receipts', 'expense-receipts', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
  on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
  execute 'drop policy if exists "Owners read expense receipts" on storage.objects';
  execute $p$create policy "Owners read expense receipts" on storage.objects for select to authenticated
    using (bucket_id = 'expense-receipts' and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner' and p.is_active and p.cafe_id::text = (storage.foldername(name))[1]))$p$;
  execute 'drop policy if exists "Owners upload expense receipts" on storage.objects';
  execute $p$create policy "Owners upload expense receipts" on storage.objects for insert to authenticated
    with check (bucket_id = 'expense-receipts' and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner' and p.is_active and p.cafe_id::text = (storage.foldername(name))[1]))$p$;
  execute 'drop policy if exists "Owners delete expense receipts" on storage.objects';
  execute $p$create policy "Owners delete expense receipts" on storage.objects for delete to authenticated
    using (bucket_id = 'expense-receipts' and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner' and p.is_active and p.cafe_id::text = (storage.foldername(name))[1]))$p$;
end;
$$;

notify pgrst, 'reload schema';

commit;

-- Verifikasi: 6 tabel + 14 fungsi + 6 trigger = 26 baris
select 'table' as kind, table_name as name
from information_schema.tables
where table_schema = 'public'
  and table_name in ('accounts', 'accounting_periods', 'journal_entries', 'journal_lines', 'expenses', 'acc_sync_issues')
union all
select 'function', p.proname
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in (
  'acc_post', 'acc_setup', 'acc_backfill', 'acc_manual_journal', 'acc_reverse_journal', 'acc_set_period', 'acc_account_save',
  'expense_create', 'expense_pay', 'expense_void', 'acc_overview', 'acc_income_statement', 'acc_balance_sheet', 'acc_cash_flow'
)
union all
select 'trigger', t.tgname
from pg_trigger t
where t.tgname in ('zz_acc_order_completed', 'zz_acc_payment', 'zz_acc_stock_movement', 'zz_acc_supplier_payment', 'zz_acc_cash_movement', 'zz_acc_cashier_close')
order by 1, 2;
