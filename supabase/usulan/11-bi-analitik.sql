-- =====================================================================
-- 11 · BI: PREDIKSI PENJUALAN, ANALITIK PELANGGAN & ADVISOR BISNIS (Langkah 6 roadmap V2)
--   A. Dasar: penjualan harian (WIB) dan pengecekan owner.
--   B. Prediksi penjualan: harian, mingguan, bulanan + rentang perkiraan + uji mundur (backtest),
--      perbandingan historis, dan prediksi permintaan per produk.
--   C. Analitik pelanggan: pelanggan kembali, frekuensi beli, nilai rata-rata pesanan, produk favorit,
--      retensi per kohort bulan, dan pelanggan tidak aktif. HANYA OWNER.
--   D. Advisor bisnis: satu paket fakta (penjualan & penyebab perubahan, profit produk, bahan menipis,
--      beban & pembelian, kandidat promosi, kualitas data) yang dihitung database. Jawaban cepat di web
--      dan Edge Function `advisor` (AI) hanya memakai paket ini — tidak ada angka karangan.
--   E. Log & kuota pertanyaan AI (ai_advisor_logs), gerbang paket "ai_advisor".
--
-- Jalankan manual di Supabase SQL Editor SETELAH file 06 (07/08/10 tidak wajib; bagian yang bergantung
-- pada tabelnya dilewati otomatis). Semua dalam satu transaksi.
--
-- Dampak ke data yang sudah ada:
--   - TIDAK ada data yang diubah atau dihapus. Hampir semuanya fungsi baca (read-only).
--   - Tabel baru: ai_advisor_logs (kosong; riwayat pertanyaan AI, hanya owner kafe itu yang bisa melihat).
--   - Bila file 10 sudah dijalankan: paket Pro & Enterprise mendapat fitur "ai_advisor" dan batas
--     pertanyaan AI per hari (Pro 30, Enterprise 100). Basic tidak mendapat AI; prediksi & analitik
--     tetap tersedia untuk semua paket.
--   - Index baru untuk query penjualan per kafe & tanggal.
--
-- Definisi yang dipakai (sama dengan dashboard): penjualan = pesanan LUNAS yang tidak dibatalkan,
-- dikelompokkan per tanggal WIB saat pesanan dibuat. Refund ditampilkan terpisah.
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
-- A. Dasar
-- ---------------------------------------------------------------------
create index if not exists orders_cafe_created_idx on public.orders (cafe_id, created_at);

create or replace function public.bi_require_owner(p_cafe_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_cafe_id is null or not public.is_cafe_member(p_cafe_id, array['owner']) then
    raise exception 'Hanya owner kafe ini yang dapat melihat analitik' using errcode = '42501';
  end if;
end;
$$;
revoke all on function public.bi_require_owner(uuid) from public, anon, authenticated;

create or replace function public.bi_today()
returns date
language sql
stable
set search_path = ''
as $$ select (now() at time zone 'Asia/Jakarta')::date $$;
grant execute on function public.bi_today() to authenticated;

-- Penjualan per tanggal WIB (semua tanggal terisi, hari tanpa penjualan = 0). Internal.
create or replace function public.bi_daily(p_cafe_id uuid, p_from date, p_to date)
returns table (day date, revenue numeric, orders integer, customers integer)
language sql
stable
security definer
set search_path = ''
as $$
  with days as (
    select generate_series(p_from, p_to, interval '1 day')::date as day
  ),
  sales as (
    select (o.created_at at time zone 'Asia/Jakarta')::date as day, o.total_amount::numeric as amount, o.customer_id
    from public.orders o
    where o.cafe_id = p_cafe_id
      and o.order_status::text <> 'cancelled' and o.payment_status::text = 'paid'
      and o.created_at >= (p_from::timestamp at time zone 'Asia/Jakarta')
      and o.created_at < ((p_to + 1)::timestamp at time zone 'Asia/Jakarta')
  )
  select d.day, coalesce(sum(s.amount), 0), count(s.day)::integer, count(distinct s.customer_id)::integer
  from days d
  left join sales s on s.day = d.day
  group by d.day
  order by d.day
$$;
revoke all on function public.bi_daily(uuid, date, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- B. Prediksi penjualan
-- ---------------------------------------------------------------------
-- Model: indeks hari (Senin–Minggu) dari s/d 8 minggu terakhir × tingkat penjualan 4 minggu terakhir
-- (sudah dibersihkan dari pola hari). sigma = simpangan baku selisih aktual vs model (4 minggu terakhir).
create or replace function public.bi_fit(
  p_cafe_id uuid, p_from date, p_to date,
  out idx numeric[], out level numeric, out oidx numeric[], out olevel numeric, out sigma numeric, out days integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r record;
  v_avg numeric;
  v_oavg numeric;
  v_recent date := greatest(p_from, p_to - 27);
begin
  idx := array_fill(1::numeric, array[7]);
  oidx := array_fill(1::numeric, array[7]);
  select avg(d.revenue), avg(d.orders), count(*)::integer into v_avg, v_oavg, days from public.bi_daily(p_cafe_id, p_from, p_to) d;
  for r in
    select extract(isodow from d.day)::integer as k, avg(d.revenue) as a, avg(d.orders) as ao, count(*) as n
    from public.bi_daily(p_cafe_id, p_from, p_to) d group by 1
  loop
    if r.n >= 2 and v_avg > 0 then idx[r.k] := r.a / v_avg; end if;
    if r.n >= 2 and v_oavg > 0 then oidx[r.k] := r.ao / v_oavg; end if;
  end loop;
  select sum(d.revenue) / nullif(sum(idx[extract(isodow from d.day)::integer]), 0),
         sum(d.orders) / nullif(sum(oidx[extract(isodow from d.day)::integer]), 0)
  into level, olevel
  from public.bi_daily(p_cafe_id, v_recent, p_to) d;
  level := coalesce(level, 0);
  olevel := coalesce(olevel, 0);
  select coalesce(stddev_samp(d.revenue - level * idx[extract(isodow from d.day)::integer]), 0) into sigma
  from public.bi_daily(p_cafe_id, v_recent, p_to) d;
end;
$$;
revoke all on function public.bi_fit(uuid, date, date) from public, anon, authenticated;

-- Perbandingan dua rentang (aktual)
create or replace function public.bi_compare(p_cafe_id uuid, p_label text, p_from date, p_to date, p_prev_from date, p_prev_to date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with c as (select coalesce(sum(revenue), 0) r, coalesce(sum(orders), 0) o from public.bi_daily(p_cafe_id, p_from, p_to)),
       p as (select coalesce(sum(revenue), 0) r, coalesce(sum(orders), 0) o from public.bi_daily(p_cafe_id, p_prev_from, p_prev_to))
  select jsonb_build_object(
    'key', p_label, 'from', p_from, 'to', p_to, 'previous_from', p_prev_from, 'previous_to', p_prev_to,
    'revenue', c.r, 'previous_revenue', p.r, 'orders', c.o, 'previous_orders', p.o,
    'change_pct', case when p.r > 0 then round((c.r - p.r) / p.r * 100, 1) end
  )
  from c, p
$$;
revoke all on function public.bi_compare(uuid, text, date, date, date, date) from public, anon, authenticated;

create or replace function public.bi_sales_forecast(p_cafe_id uuid, p_horizon integer default 14)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  z constant numeric := 1.2816; -- rentang 80%
  v_today date := public.bi_today();
  v_end date := public.bi_today() - 1; -- model memakai hari yang sudah selesai
  v_horizon integer := least(greatest(coalesce(p_horizon, 14), 7), 31);
  v_first date;
  v_start date;
  v_days integer;
  v_active integer;
  v_fit record;
  v_bt record;
  v_wape numeric;
  v_basis text := 'ok';
  v_reason text;
  v_week date := public.bi_today() - (extract(isodow from public.bi_today())::integer - 1);
  v_month date := date_trunc('month', public.bi_today())::date;
  v_daily jsonb := '[]'::jsonb;
  v_weekly jsonb := '[]'::jsonb;
  v_monthly jsonb := '[]'::jsonb;
  v_history jsonb;
  v_comparisons jsonb;
  v_mtd_days integer;
  v_from date;
  v_to date;
  v_actual numeric;
  v_fc numeric;
  v_rest integer;
  i integer;
begin
  perform public.bi_require_owner(p_cafe_id);

  select min((o.created_at at time zone 'Asia/Jakarta')::date) into v_first
  from public.orders o
  where o.cafe_id = p_cafe_id and o.order_status::text <> 'cancelled' and o.payment_status::text = 'paid';

  -- Perbandingan historis (aktual, sampai kemarin)
  v_mtd_days := v_today - v_month; -- hari selesai di bulan ini
  v_comparisons := jsonb_build_array(
    public.bi_compare(p_cafe_id, 'last_7', v_today - 7, v_end, v_today - 14, v_today - 8),
    public.bi_compare(p_cafe_id, 'last_28', v_today - 28, v_end, v_today - 56, v_today - 29)
  );
  if v_mtd_days > 0 then
    v_comparisons := v_comparisons
      || public.bi_compare(p_cafe_id, 'month_to_date', v_month, v_end, (v_month - interval '1 month')::date, ((v_month - interval '1 month')::date + v_mtd_days - 1))
      || public.bi_compare(p_cafe_id, 'month_to_date_last_year', v_month, v_end, (v_month - interval '1 year')::date, ((v_month - interval '1 year')::date + v_mtd_days - 1));
  end if;

  if v_first is null then
    return jsonb_build_object('basis', 'data_kurang', 'reason', 'Belum ada penjualan lunas.', 'today', v_today,
      'history_days', 0, 'active_days', 0, 'daily', '[]'::jsonb, 'weekly', '[]'::jsonb, 'monthly', '[]'::jsonb,
      'history', '[]'::jsonb, 'comparisons', v_comparisons);
  end if;

  v_start := greatest(v_first, v_today - 56);
  v_days := greatest(v_end - v_start + 1, 0);
  select count(*) filter (where d.revenue > 0)::integer into v_active from public.bi_daily(p_cafe_id, v_start, greatest(v_end, v_start)) d where v_days > 0;
  v_active := coalesce(v_active, 0);

  select coalesce(jsonb_agg(jsonb_build_object('day', d.day, 'revenue', d.revenue, 'orders', d.orders) order by d.day), '[]'::jsonb)
  into v_history
  from public.bi_daily(p_cafe_id, greatest(v_start, v_today - 28), v_today) d;

  if v_days < 14 or v_active < 10 then
    v_basis := 'data_kurang';
    v_reason := format('Butuh minimal 14 hari riwayat dan 10 hari berjualan; tersedia %s hari riwayat, %s hari berjualan.', v_days, v_active);
    return jsonb_build_object('basis', v_basis, 'reason', v_reason, 'today', v_today, 'history_days', v_days, 'active_days', v_active,
      'daily', '[]'::jsonb, 'weekly', '[]'::jsonb, 'monthly', '[]'::jsonb, 'history', v_history, 'comparisons', v_comparisons);
  end if;

  select * into v_fit from public.bi_fit(p_cafe_id, v_start, v_end);

  -- Uji mundur: model dibuat 14 hari lalu (tanpa melihat 14 hari terakhir), dibandingkan dengan aktual
  if v_days >= 42 then
    select * into v_bt from public.bi_fit(p_cafe_id, v_start, v_today - 15);
    select case when sum(d.revenue) > 0
             then round(sum(abs(d.revenue - v_bt.level * v_bt.idx[extract(isodow from d.day)::integer])) / sum(d.revenue) * 100, 1) end
    into v_wape
    from public.bi_daily(p_cafe_id, v_today - 14, v_end) d;
  end if;

  -- Harian (hari ini s/d horizon); hari ini menyertakan penjualan aktual sejauh ini
  select jsonb_agg(jsonb_build_object(
           'day', g.day,
           'revenue', round(v_fit.level * v_fit.idx[extract(isodow from g.day)::integer]),
           'low', round(greatest(v_fit.level * v_fit.idx[extract(isodow from g.day)::integer] - z * v_fit.sigma, 0)),
           'high', round(v_fit.level * v_fit.idx[extract(isodow from g.day)::integer] + z * v_fit.sigma),
           'orders', round(v_fit.olevel * v_fit.oidx[extract(isodow from g.day)::integer], 1),
           'actual', case when g.day = v_today then (select d.revenue from public.bi_daily(p_cafe_id, v_today, v_today) d) end
         ) order by g.day)
  into v_daily
  from (select generate_series(v_today, v_today + v_horizon - 1, interval '1 day')::date as day) g;

  -- Mingguan (Senin–Minggu): minggu ini + 3 minggu ke depan. Hari yang sudah lewat = aktual.
  for i in 0..3 loop
    v_from := v_week + i * 7;
    v_to := v_from + 6;
    select coalesce(sum(d.revenue), 0) into v_actual from public.bi_daily(p_cafe_id, v_from, least(v_to, v_end)) d where v_from <= v_end;
    select coalesce(sum(v_fit.level * v_fit.idx[extract(isodow from g.day)::integer]), 0), count(*)::integer
    into v_fc, v_rest
    from (select generate_series(greatest(v_from, v_today), v_to, interval '1 day')::date as day) g;
    v_weekly := v_weekly || jsonb_build_object(
      'week_start', v_from, 'week_end', v_to,
      'actual', coalesce(v_actual, 0), 'forecast_rest', round(v_fc), 'projection', round(coalesce(v_actual, 0) + v_fc),
      'low', round(greatest(coalesce(v_actual, 0) + v_fc - z * v_fit.sigma * sqrt(v_rest), coalesce(v_actual, 0))),
      'high', round(coalesce(v_actual, 0) + v_fc + z * v_fit.sigma * sqrt(v_rest)),
      -- pembanding hanya bila minggu sebelumnya sudah selesai
      'previous_actual', case when v_to - 7 <= v_end then (select coalesce(sum(d.revenue), 0) from public.bi_daily(p_cafe_id, v_from - 7, v_to - 7) d) end
    );
  end loop;

  -- Bulanan: bulan ini + bulan depan
  for i in 0..1 loop
    v_from := (v_month + make_interval(months => i))::date;
    v_to := (v_from + interval '1 month' - interval '1 day')::date;
    select coalesce(sum(d.revenue), 0) into v_actual from public.bi_daily(p_cafe_id, v_from, least(v_to, v_end)) d where v_from <= v_end;
    select coalesce(sum(v_fit.level * v_fit.idx[extract(isodow from g.day)::integer]), 0), count(*)::integer
    into v_fc, v_rest
    from (select generate_series(greatest(v_from, v_today), v_to, interval '1 day')::date as day) g;
    v_monthly := v_monthly || jsonb_build_object(
      'month', v_from, 'month_end', v_to,
      'actual', coalesce(v_actual, 0), 'forecast_rest', round(v_fc), 'projection', round(coalesce(v_actual, 0) + v_fc),
      'low', round(greatest(coalesce(v_actual, 0) + v_fc - z * v_fit.sigma * sqrt(v_rest), coalesce(v_actual, 0))),
      'high', round(coalesce(v_actual, 0) + v_fc + z * v_fit.sigma * sqrt(v_rest)),
      'previous_month_actual', case when v_from - 1 <= v_end then (select coalesce(sum(d.revenue), 0) from public.bi_daily(p_cafe_id, (v_from - interval '1 month')::date, v_from - 1) d) end,
      'last_year_actual', (select case when count(*) filter (where d.revenue > 0) > 0 then sum(d.revenue) end
                           from public.bi_daily(p_cafe_id, (v_from - interval '1 year')::date, (v_to - interval '1 year')::date) d)
    );
  end loop;

  return jsonb_build_object(
    'basis', v_basis, 'today', v_today, 'history_days', v_days, 'active_days', v_active,
    'method', 'Rata-rata per hari (Senin–Minggu) dari riwayat s/d 8 minggu, disesuaikan dengan tingkat penjualan 4 minggu terakhir. Asumsi: pola terakhir berlanjut; promo, libur, dan cuaca tidak diperhitungkan.',
    'level', round(v_fit.level), 'weekday_index', to_jsonb(v_fit.idx), 'sigma', round(v_fit.sigma),
    'backtest_wape', v_wape, 'interval', 80,
    'daily', v_daily, 'weekly', v_weekly, 'monthly', v_monthly, 'history', v_history, 'comparisons', v_comparisons
  );
end;
$$;
revoke all on function public.bi_sales_forecast(uuid, integer) from public, anon;
grant execute on function public.bi_sales_forecast(uuid, integer) to authenticated;

-- Prediksi permintaan per produk untuk p_days hari ke depan (mulai hari ini).
-- Jumlah 28 hari terakhir dibersihkan dari pola hari kafe, lalu dikalikan pola hari ke depan.
create or replace function public.bi_product_demand(p_cafe_id uuid, p_days integer default 7)
returns table (
  product_id uuid, name text, is_available boolean, quantity_28 numeric, quantity_prev_28 numeric, trend_pct numeric,
  avg_daily numeric, forecast_quantity numeric, portions numeric, days_cover numeric, basis text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_today date := public.bi_today();
  v_days integer := least(greatest(coalesce(p_days, 7), 1), 31);
  v_first date;
  v_start date;
  v_fit record;
  v_past numeric;
  v_future numeric;
  v_basis text := 'ok';
  v_hist integer;
  v_active integer;
begin
  perform public.bi_require_owner(p_cafe_id);
  select min((o.created_at at time zone 'Asia/Jakarta')::date) into v_first
  from public.orders o where o.cafe_id = p_cafe_id and o.order_status::text <> 'cancelled' and o.payment_status::text = 'paid';
  v_start := greatest(coalesce(v_first, v_today), v_today - 56);
  v_hist := v_today - 1 - v_start + 1;
  select count(*) filter (where d.revenue > 0)::integer into v_active from public.bi_daily(p_cafe_id, v_start, v_today - 1) d where v_hist > 0;
  if v_first is null or v_hist < 14 or coalesce(v_active, 0) < 10 then
    v_basis := 'data_kurang';
  else
    select * into v_fit from public.bi_fit(p_cafe_id, v_start, v_today - 1);
    select sum(v_fit.oidx[extract(isodow from g.day)::integer]) into v_past
    from (select generate_series(greatest(v_start, v_today - 28), v_today - 1, interval '1 day')::date as day) g;
    select sum(v_fit.oidx[extract(isodow from g.day)::integer]) into v_future
    from (select generate_series(v_today, v_today + v_days - 1, interval '1 day')::date as day) g;
  end if;

  return query
  with sold as (
    select oi.product_id,
           sum(oi.quantity) filter (where o.created_at >= ((v_today - 28)::timestamp at time zone 'Asia/Jakarta'))::numeric as q28,
           sum(oi.quantity) filter (where o.created_at < ((v_today - 28)::timestamp at time zone 'Asia/Jakarta'))::numeric as qprev
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where o.cafe_id = p_cafe_id and o.order_status::text <> 'cancelled' and o.payment_status::text = 'paid'
      and o.created_at >= ((v_today - 56)::timestamp at time zone 'Asia/Jakarta')
      and o.created_at < (v_today::timestamp at time zone 'Asia/Jakarta')
    group by oi.product_id
  ),
  avail as (select a.product_id, a.portions from public.product_availability(p_cafe_id) a)
  select p.id, p.name, p.is_available,
         coalesce(s.q28, 0), coalesce(s.qprev, 0),
         case when coalesce(s.qprev, 0) > 0 and v_first <= v_today - 56 then round((coalesce(s.q28, 0) - s.qprev) / s.qprev * 100, 1) end,
         round(coalesce(s.q28, 0) / least(28, greatest(v_today - v_start, 1)), 2),
         case when v_basis = 'ok' and v_past > 0 then round(coalesce(s.q28, 0) / v_past * v_future, 1) end,
         av.portions,
         case when v_basis = 'ok' and v_past > 0 and av.portions is not null and coalesce(s.q28, 0) > 0
              then round(av.portions / (coalesce(s.q28, 0) / v_past * v_future / v_days), 1) end,
         v_basis
  from public.products p
  left join sold s on s.product_id = p.id
  left join avail av on av.product_id = p.id
  where p.cafe_id = p_cafe_id and (s.product_id is not null or p.is_available)
  order by coalesce(s.q28, 0) desc, p.name;
end;
$$;
revoke all on function public.bi_product_demand(uuid, integer) from public, anon;
grant execute on function public.bi_product_demand(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------
-- C. Analitik pelanggan (hanya owner). Pelanggan = akun app (orders.customer_id).
--    Pesanan kasir tanpa akun dihitung sebagai "tanpa akun" dan tidak masuk analitik per pelanggan.
--    p_include_people = false → tanpa daftar nama (dipakai saat data dikirim ke AI).
-- ---------------------------------------------------------------------
create or replace function public.bi_customer_analytics(p_cafe_id uuid, p_from date, p_to date, p_include_people boolean default true)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_today date := public.bi_today();
  v_from_ts timestamptz;
  v_to_ts timestamptz;
  v_prev_from_ts timestamptz;
  v_days integer;
  v_summary jsonb;
  v_frequency jsonb;
  v_products jsonb;
  v_cohorts jsonb;
  v_inactive jsonb;
  v_people jsonb := null;
  v_interval jsonb;
  v_retention jsonb;
begin
  perform public.bi_require_owner(p_cafe_id);
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then
    raise exception 'Rentang tanggal tidak valid (maksimal 400 hari)' using errcode = '22023';
  end if;
  v_days := p_to - p_from + 1;
  v_from_ts := p_from::timestamp at time zone 'Asia/Jakarta';
  v_to_ts := (p_to + 1)::timestamp at time zone 'Asia/Jakarta';
  v_prev_from_ts := (p_from - v_days)::timestamp at time zone 'Asia/Jakarta';

  create temporary table if not exists pg_temp.bi_sales (
    order_id uuid, customer_id uuid, created_at timestamptz, amount numeric
  ) on commit drop;
  truncate pg_temp.bi_sales;
  insert into pg_temp.bi_sales
  select o.id, o.customer_id, o.created_at, o.total_amount
  from public.orders o
  where o.cafe_id = p_cafe_id and o.order_status::text <> 'cancelled' and o.payment_status::text = 'paid'
    and o.created_at < v_to_ts;

  -- Ringkasan
  with cur as (select * from pg_temp.bi_sales s where s.created_at >= v_from_ts),
       per as (select c.customer_id, count(*) n, sum(c.amount) spend from cur c where c.customer_id is not null group by c.customer_id),
       firsts as (select s.customer_id, min(s.created_at) first_at from pg_temp.bi_sales s where s.customer_id is not null group by s.customer_id)
  select jsonb_build_object(
    'orders', (select count(*) from cur),
    'revenue', (select coalesce(sum(amount), 0) from cur),
    'account_orders', (select count(*) from cur where customer_id is not null),
    'guest_orders', (select count(*) from cur where customer_id is null),
    'account_revenue', (select coalesce(sum(amount), 0) from cur where customer_id is not null),
    'aov', (select round(avg(amount)) from cur),
    'aov_account', (select round(avg(amount)) from cur where customer_id is not null),
    'aov_guest', (select round(avg(amount)) from cur where customer_id is null),
    'customers', (select count(*) from per),
    'new_customers', (select count(*) from per p join firsts f on f.customer_id = p.customer_id where f.first_at >= v_from_ts),
    'returning_customers', (select count(*) from per p join firsts f on f.customer_id = p.customer_id where f.first_at < v_from_ts),
    'repeat_customers', (select count(*) from per where n >= 2),
    'orders_per_customer', (select round(avg(n), 2) from per),
    'spend_per_customer', (select round(avg(spend)) from per)
  ) into v_summary;

  -- Retensi: dari pelanggan yang membeli di periode sebelumnya (panjang sama), berapa yang membeli lagi
  with prev as (select distinct s.customer_id from pg_temp.bi_sales s where s.customer_id is not null and s.created_at >= v_prev_from_ts and s.created_at < v_from_ts),
       cur as (select distinct s.customer_id from pg_temp.bi_sales s where s.customer_id is not null and s.created_at >= v_from_ts)
  select jsonb_build_object(
    'previous_customers', (select count(*) from prev),
    'retained', (select count(*) from prev p where p.customer_id in (select customer_id from cur)),
    'rate_pct', case when (select count(*) from prev) > 0
                  then round((select count(*) from prev p where p.customer_id in (select customer_id from cur))::numeric / (select count(*) from prev) * 100, 1) end
  ) into v_retention;

  -- Frekuensi beli di periode
  with per as (select s.customer_id, count(*) n from pg_temp.bi_sales s where s.customer_id is not null and s.created_at >= v_from_ts group by s.customer_id)
  select jsonb_build_array(
    jsonb_build_object('bucket', '1', 'customers', count(*) filter (where n = 1)),
    jsonb_build_object('bucket', '2-3', 'customers', count(*) filter (where n between 2 and 3)),
    jsonb_build_object('bucket', '4-9', 'customers', count(*) filter (where n between 4 and 9)),
    jsonb_build_object('bucket', '10+', 'customers', count(*) filter (where n >= 10))
  ) into v_frequency from per;

  -- Jarak antar-pesanan (hari): median dari pelanggan dengan >= 2 pesanan dalam 180 hari terakhir
  with per as (
    select s.customer_id, count(*) n, extract(epoch from max(s.created_at) - min(s.created_at)) / 86400 span
    from pg_temp.bi_sales s
    where s.customer_id is not null and s.created_at >= v_to_ts - interval '180 days'
    group by s.customer_id having count(*) >= 2
  )
  select jsonb_build_object('customers', count(*), 'median_days', round((percentile_cont(0.5) within group (order by span / (n - 1)))::numeric, 1))
  into v_interval from per;

  -- Produk favorit pelanggan ber-akun
  select coalesce(jsonb_agg(x order by x.quantity desc, x.name), '[]'::jsonb) into v_products
  from (
    select max(oi.product_name) as name, sum(oi.quantity) as quantity, count(distinct s.customer_id) as buyers,
           (select count(*) from (
              select s2.customer_id from pg_temp.bi_sales s2 join public.order_items oi2 on oi2.order_id = s2.order_id
              where s2.customer_id is not null and s2.created_at >= v_from_ts and oi2.product_id = oi.product_id
              group by s2.customer_id having count(distinct s2.order_id) >= 2) r) as repeat_buyers
    from pg_temp.bi_sales s
    join public.order_items oi on oi.order_id = s.order_id
    where s.customer_id is not null and s.created_at >= v_from_ts
    group by oi.product_id
    order by 2 desc
    limit 10
  ) x;

  -- Kohort: bulan pembelian pertama (6 bulan terakhir) → % yang membeli lagi di bulan +1, +2, +3
  with firsts as (
    select s.customer_id, date_trunc('month', min(s.created_at) at time zone 'Asia/Jakarta')::date m
    from pg_temp.bi_sales s where s.customer_id is not null group by s.customer_id
  ),
  active as (
    select distinct s.customer_id, date_trunc('month', s.created_at at time zone 'Asia/Jakarta')::date m
    from pg_temp.bi_sales s where s.customer_id is not null
  ),
  cohorts as (
    select f.m, count(*) as cohort_size,
           count(*) filter (where exists (select 1 from active a where a.customer_id = f.customer_id and a.m = (f.m + interval '1 month')::date)) m1,
           count(*) filter (where exists (select 1 from active a where a.customer_id = f.customer_id and a.m = (f.m + interval '2 months')::date)) m2,
           count(*) filter (where exists (select 1 from active a where a.customer_id = f.customer_id and a.m = (f.m + interval '3 months')::date)) m3
    from firsts f
    where f.m >= (date_trunc('month', v_today) - interval '5 months')::date
    group by f.m
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'month', c.m, 'size', c.cohort_size,
    'm1', case when (c.m + interval '1 month')::date <= v_today then c.m1 end,
    'm2', case when (c.m + interval '2 months')::date <= v_today then c.m2 end,
    'm3', case when (c.m + interval '3 months')::date <= v_today then c.m3 end
  ) order by c.m), '[]'::jsonb) into v_cohorts from cohorts c;

  -- Tidak aktif: pernah membeli, pesanan terakhir >= 30 hari lalu (per hari ini)
  with all_last as (
    select o.customer_id, max(o.created_at) last_at
    from public.orders o
    where o.cafe_id = p_cafe_id and o.customer_id is not null and o.order_status::text <> 'cancelled' and o.payment_status::text = 'paid'
    group by o.customer_id
  )
  select jsonb_build_object(
    'd30_59', count(*) filter (where v_today - (a.last_at at time zone 'Asia/Jakarta')::date between 30 and 59),
    'd60_89', count(*) filter (where v_today - (a.last_at at time zone 'Asia/Jakarta')::date between 60 and 89),
    'd90_plus', count(*) filter (where v_today - (a.last_at at time zone 'Asia/Jakarta')::date >= 90),
    'total_customers', count(*)
  ) into v_inactive from all_last a;

  if p_include_people then
    select coalesce(jsonb_agg(x order by x.lifetime_spend desc), '[]'::jsonb) into v_people
    from (
      select o.customer_id, nullif(btrim(pr.full_name), '') as full_name, count(*) as orders, sum(o.total_amount) as lifetime_spend,
             max(o.created_at) as last_order_at, v_today - (max(o.created_at) at time zone 'Asia/Jakarta')::date as days_since
      from public.orders o
      left join public.profiles pr on pr.id = o.customer_id
      where o.cafe_id = p_cafe_id and o.customer_id is not null and o.order_status::text <> 'cancelled' and o.payment_status::text = 'paid'
      group by o.customer_id, pr.full_name
      having v_today - (max(o.created_at) at time zone 'Asia/Jakarta')::date >= 30
      order by sum(o.total_amount) desc
      limit 50
    ) x;
  end if;

  return jsonb_build_object(
    'from', p_from, 'to', p_to, 'previous_from', p_from - v_days, 'previous_to', p_from - 1,
    'summary', v_summary, 'retention', v_retention, 'frequency', v_frequency, 'interval', v_interval,
    'products', v_products, 'cohorts', v_cohorts, 'inactive', v_inactive || jsonb_build_object('people', v_people)
  );
end;
$$;
revoke all on function public.bi_customer_analytics(uuid, date, date, boolean) from public, anon;
grant execute on function public.bi_customer_analytics(uuid, date, date, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- D. Paket fakta advisor
-- ---------------------------------------------------------------------
-- Ringkasan satu rentang (internal)
create or replace function public.bi_period_stats(p_cafe_id uuid, p_from date, p_to date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with o as (
    select o.* from public.orders o
    where o.cafe_id = p_cafe_id
      and o.created_at >= (p_from::timestamp at time zone 'Asia/Jakarta')
      and o.created_at < ((p_to + 1)::timestamp at time zone 'Asia/Jakarta')
  ),
  paid as (select * from o where o.order_status::text <> 'cancelled' and o.payment_status::text = 'paid'),
  rf as (
    select coalesce(sum(r.amount), 0) amount, count(*) n from public.refunds r
    where r.cafe_id = p_cafe_id and r.status = 'approved'
      and r.decided_at >= (p_from::timestamp at time zone 'Asia/Jakarta')
      and r.decided_at < ((p_to + 1)::timestamp at time zone 'Asia/Jakarta')
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to, 'days', p_to - p_from + 1,
    'revenue', (select coalesce(sum(total_amount), 0) from paid),
    'orders', (select count(*) from paid),
    'aov', (select round(avg(total_amount)) from paid),
    'unpaid_orders', (select count(*) from o where o.order_status::text <> 'cancelled' and o.payment_status::text <> 'paid'),
    'cancelled_orders', (select count(*) from o where o.order_status::text = 'cancelled'),
    'cancelled_value', (select coalesce(sum(total_amount), 0) from o where o.order_status::text = 'cancelled'),
    'refunds', (select amount from rf), 'refund_count', (select n from rf),
    'discounts', (select coalesce(sum(discount_amount), 0) from paid),
    'days_without_sales', (select count(*) from public.bi_daily(p_cafe_id, p_from, p_to) d where d.revenue = 0),
    'customers', (select count(distinct customer_id) from paid)
  )
$$;
revoke all on function public.bi_period_stats(uuid, date, date) from public, anon, authenticated;

create or replace function public.bi_advisor_facts(p_cafe_id uuid, p_from date default null, p_to date default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_today date := public.bi_today();
  v_from date := coalesce(p_from, date_trunc('month', public.bi_today())::date);
  v_to date := least(coalesce(p_to, public.bi_today()), public.bi_today());
  v_days integer;
  v_prev_from date;
  v_prev_to date;
  v_compare text;
  v_cur jsonb;
  v_prev jsonb;
  v_rev jsonb;
  v_profit jsonb;
  v_stock jsonb;
  v_expenses jsonb := null;
  v_promote jsonb;
  v_quality jsonb;
  v_tracking boolean;
  v_go_live date;
  v_orders_c numeric; v_orders_p numeric; v_aov_c numeric; v_aov_p numeric;
  v_med_margin numeric;
  v_med_qty numeric;
  v_costed integer;
  v_has_reviews boolean := to_regclass('public.product_reviews') is not null;
begin
  perform public.bi_require_owner(p_cafe_id);
  if v_to < v_from or v_to - v_from > 366 then
    raise exception 'Rentang tanggal tidak valid (maksimal 1 tahun)' using errcode = '22023';
  end if;
  v_days := v_to - v_from + 1;

  -- Pembanding: rentang yang mulai tanggal 1 → tanggal yang sama di bulan sebelumnya; selain itu rentang sama panjang tepat sebelumnya
  if extract(day from v_from) = 1 and date_trunc('month', v_from) = date_trunc('month', v_to) then
    v_compare := 'same_days_previous_month';
    v_prev_from := (v_from - interval '1 month')::date;
    v_prev_to := case when v_to = (date_trunc('month', v_from) + interval '1 month' - interval '1 day')::date
                      then v_from - 1 else least((v_to - interval '1 month')::date, v_from - 1) end;
  else
    v_compare := 'previous_equal_period';
    v_prev_to := v_from - 1;
    v_prev_from := v_from - v_days;
  end if;

  v_cur := public.bi_period_stats(p_cafe_id, v_from, v_to);
  v_prev := public.bi_period_stats(p_cafe_id, v_prev_from, v_prev_to);
  v_orders_c := (v_cur ->> 'orders')::numeric; v_orders_p := (v_prev ->> 'orders')::numeric;
  v_aov_c := case when v_orders_c > 0 then (v_cur ->> 'revenue')::numeric / v_orders_c else 0 end;
  v_aov_p := case when v_orders_p > 0 then (v_prev ->> 'revenue')::numeric / v_orders_p else 0 end;

  -- 1. Penjualan & penyebab perubahan
  v_rev := jsonb_build_object(
    'current', v_cur, 'previous', v_prev, 'comparison', v_compare,
    'change', (v_cur ->> 'revenue')::numeric - (v_prev ->> 'revenue')::numeric,
    'change_pct', case when (v_prev ->> 'revenue')::numeric > 0
                    then round(((v_cur ->> 'revenue')::numeric - (v_prev ->> 'revenue')::numeric) / (v_prev ->> 'revenue')::numeric * 100, 1) end,
    -- Perubahan = efek jumlah pesanan + efek nilai rata-rata pesanan (jumlahnya tepat sama dengan perubahan)
    'effect_orders', round((v_orders_c - v_orders_p) * v_aov_p),
    'effect_basket', ((v_cur ->> 'revenue')::numeric - (v_prev ->> 'revenue')::numeric) - round((v_orders_c - v_orders_p) * v_aov_p),
    'by_channel', (
      select coalesce(jsonb_agg(jsonb_build_object('channel', x.channel, 'current', x.cur, 'previous', x.prev, 'current_orders', x.cur_n, 'previous_orders', x.prev_n) order by x.cur desc), '[]'::jsonb)
      from (
        select case when o.source = 'pos' then 'kasir' when o.table_id is not null then 'qr_meja' else 'app' end as channel,
               coalesce(sum(o.total_amount) filter (where o.created_at >= (v_from::timestamp at time zone 'Asia/Jakarta')), 0) cur,
               coalesce(sum(o.total_amount) filter (where o.created_at < ((v_prev_to + 1)::timestamp at time zone 'Asia/Jakarta')), 0) prev,
               count(*) filter (where o.created_at >= (v_from::timestamp at time zone 'Asia/Jakarta')) cur_n,
               count(*) filter (where o.created_at < ((v_prev_to + 1)::timestamp at time zone 'Asia/Jakarta')) prev_n
        from public.orders o
        where o.cafe_id = p_cafe_id and o.order_status::text <> 'cancelled' and o.payment_status::text = 'paid'
          and ((o.created_at >= (v_from::timestamp at time zone 'Asia/Jakarta') and o.created_at < ((v_to + 1)::timestamp at time zone 'Asia/Jakarta'))
            or (o.created_at >= (v_prev_from::timestamp at time zone 'Asia/Jakarta') and o.created_at < ((v_prev_to + 1)::timestamp at time zone 'Asia/Jakarta')))
        group by 1
      ) x
    ),
    'by_weekday', (
      select jsonb_agg(jsonb_build_object('isodow', w.k, 'current_avg', w.cur, 'previous_avg', w.prev) order by w.k)
      from (
        select k,
               (select round(avg(d.revenue)) from public.bi_daily(p_cafe_id, v_from, v_to) d where extract(isodow from d.day) = k) cur,
               (select round(avg(d.revenue)) from public.bi_daily(p_cafe_id, v_prev_from, v_prev_to) d where extract(isodow from d.day) = k) prev
        from generate_series(1, 7) k
      ) w
    ),
    'products', (
      with p as (
        select coalesce(oi.product_id::text, oi.product_name) as key, max(oi.product_name) as name,
               coalesce(sum(oi.subtotal) filter (where o.created_at >= (v_from::timestamp at time zone 'Asia/Jakarta')), 0) cur,
               coalesce(sum(oi.subtotal) filter (where o.created_at < ((v_prev_to + 1)::timestamp at time zone 'Asia/Jakarta')), 0) prev,
               coalesce(sum(oi.quantity) filter (where o.created_at >= (v_from::timestamp at time zone 'Asia/Jakarta')), 0) cur_q,
               coalesce(sum(oi.quantity) filter (where o.created_at < ((v_prev_to + 1)::timestamp at time zone 'Asia/Jakarta')), 0) prev_q
        from public.order_items oi join public.orders o on o.id = oi.order_id
        where o.cafe_id = p_cafe_id and o.order_status::text <> 'cancelled' and o.payment_status::text = 'paid'
          and ((o.created_at >= (v_from::timestamp at time zone 'Asia/Jakarta') and o.created_at < ((v_to + 1)::timestamp at time zone 'Asia/Jakarta'))
            or (o.created_at >= (v_prev_from::timestamp at time zone 'Asia/Jakarta') and o.created_at < ((v_prev_to + 1)::timestamp at time zone 'Asia/Jakarta')))
        group by 1
      )
      select jsonb_build_object(
        'decreases', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'current', cur, 'previous', prev, 'change', cur - prev, 'current_qty', cur_q, 'previous_qty', prev_q) order by cur - prev)
                               from (select * from p where cur < prev order by cur - prev limit 5) d), '[]'::jsonb),
        'increases', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'current', cur, 'previous', prev, 'change', cur - prev, 'current_qty', cur_q, 'previous_qty', prev_q) order by cur - prev desc)
                               from (select * from p where cur > prev order by cur - prev desc limit 5) i), '[]'::jsonb)
      )
    )
  );

  -- 2. Profit produk (pesanan selesai; HPP aktual dari mutasi stok, selain itu estimasi resep)
  create temporary table if not exists pg_temp.bi_profit (
    product_id uuid, product_name text, quantity_sold numeric, revenue numeric, actual_cost numeric,
    estimated_cost numeric, uncosted_quantity numeric, gross_profit numeric, margin_pct numeric
  ) on commit drop;
  truncate pg_temp.bi_profit;
  insert into pg_temp.bi_profit
  select * from public.inventory_product_profitability(p_cafe_id, v_from::timestamp at time zone 'Asia/Jakarta', (v_to + 1)::timestamp at time zone 'Asia/Jakarta');

  select count(*) into v_costed from pg_temp.bi_profit b where b.uncosted_quantity < b.quantity_sold;
  select percentile_cont(0.5) within group (order by b.margin_pct), percentile_cont(0.5) within group (order by b.quantity_sold)
  into v_med_margin, v_med_qty
  from pg_temp.bi_profit b where b.uncosted_quantity < b.quantity_sold and b.margin_pct is not null;

  select jsonb_build_object(
    'basis_note', 'Profit kotor = penjualan − HPP bahan. HPP aktual bila stok dilacak, selain itu estimasi resep saat ini. Produk tanpa resep tidak punya HPP.',
    'totals', (select jsonb_build_object(
                 'revenue', coalesce(sum(revenue), 0), 'gross_profit', coalesce(sum(gross_profit) filter (where uncosted_quantity < quantity_sold), 0),
                 'actual_cost', coalesce(sum(actual_cost), 0), 'estimated_cost', coalesce(sum(estimated_cost), 0),
                 'revenue_without_recipe', coalesce(sum(revenue) filter (where uncosted_quantity >= quantity_sold), 0))
               from pg_temp.bi_profit),
    'top_profit', coalesce((select jsonb_agg(to_jsonb(x) order by x.gross_profit desc) from (
                    select product_name as name, quantity_sold as quantity, revenue, gross_profit, margin_pct,
                           case when estimated_cost > 0 or uncosted_quantity > 0 then 'estimasi' else 'aktual' end as basis
                    from pg_temp.bi_profit where uncosted_quantity < quantity_sold order by gross_profit desc limit 5) x), '[]'::jsonb),
    'top_margin', coalesce((select jsonb_agg(to_jsonb(x) order by x.margin_pct desc) from (
                    select product_name as name, quantity_sold as quantity, revenue, gross_profit, margin_pct,
                           case when estimated_cost > 0 or uncosted_quantity > 0 then 'estimasi' else 'aktual' end as basis
                    from pg_temp.bi_profit where uncosted_quantity < quantity_sold and quantity_sold >= 3 order by margin_pct desc limit 5) x), '[]'::jsonb),
    'low_margin', coalesce((select jsonb_agg(to_jsonb(x) order by x.margin_pct) from (
                    select product_name as name, quantity_sold as quantity, revenue, gross_profit, margin_pct,
                           case when estimated_cost > 0 or uncosted_quantity > 0 then 'estimasi' else 'aktual' end as basis
                    from pg_temp.bi_profit where uncosted_quantity < quantity_sold and quantity_sold >= 3 order by margin_pct limit 5) x), '[]'::jsonb),
    'without_recipe', coalesce((select jsonb_agg(product_name order by revenue desc) from pg_temp.bi_profit where uncosted_quantity >= quantity_sold), '[]'::jsonb)
  ) into v_profit;

  -- 3. Bahan menipis (perkiraan stok file 05)
  select jsonb_build_object(
    'basis', coalesce(max(f.basis), 'data_kurang'),
    'tracked_ingredients', count(*),
    'low', coalesce(jsonb_agg(jsonb_build_object(
              'name', f.name, 'unit', f.unit, 'on_hand', f.on_hand, 'min_stock', f.min_stock, 'avg_daily_usage', f.avg_daily_usage,
              'days_left', f.days_left, 'depletion_date', f.depletion_date, 'lead_time_days', f.lead_time_days,
              'suggested_quantity', f.suggested_quantity, 'below_minimum', f.on_hand <= f.min_stock
            ) order by f.days_left nulls last, f.name)
            filter (where f.on_hand <= f.min_stock or (f.days_left is not null and f.days_left <= f.lead_time_days + 3)), '[]'::jsonb)
  ) into v_stock
  from public.inventory_forecast(p_cafe_id, 28) f;

  -- 4. Beban (file 07) + pembelian bahan & bahan terbuang (mutasi stok)
  if to_regclass('public.expenses') is not null then
    select jsonb_build_object(
      'total', coalesce(sum(x.cur), 0), 'previous_total', coalesce(sum(x.prev), 0),
      'by_account', coalesce(jsonb_agg(jsonb_build_object('account', x.name, 'current', x.cur, 'previous', x.prev, 'change', x.cur - x.prev,
                       'change_pct', case when x.prev > 0 then round((x.cur - x.prev) / x.prev * 100, 1) end) order by x.cur - x.prev desc), '[]'::jsonb)
    ) into v_expenses
    from (
      select a.name,
             coalesce(sum(e.amount) filter (where e.expense_date between v_from and v_to), 0) cur,
             coalesce(sum(e.amount) filter (where e.expense_date between v_prev_from and v_prev_to), 0) prev
      from public.expenses e join public.accounts a on a.id = e.account_id
      where e.cafe_id = p_cafe_id and e.status = 'posted' and e.expense_date between v_prev_from and v_to
      group by a.name
    ) x;
  end if;
  v_expenses := coalesce(v_expenses, jsonb_build_object('available', false)) || (
    select jsonb_build_object(
      'purchases', coalesce(sum(m.total_cost) filter (where m.movement_type = 'purchase' and m.occurred_at >= (v_from::timestamp at time zone 'Asia/Jakarta')), 0),
      'previous_purchases', coalesce(sum(m.total_cost) filter (where m.movement_type = 'purchase' and m.occurred_at < ((v_prev_to + 1)::timestamp at time zone 'Asia/Jakarta')), 0),
      'waste', coalesce(-sum(m.total_cost) filter (where m.movement_type in ('waste', 'damaged', 'expired') and m.occurred_at >= (v_from::timestamp at time zone 'Asia/Jakarta')), 0),
      'previous_waste', coalesce(-sum(m.total_cost) filter (where m.movement_type in ('waste', 'damaged', 'expired') and m.occurred_at < ((v_prev_to + 1)::timestamp at time zone 'Asia/Jakarta')), 0)
    )
    from public.stock_movements m
    where m.cafe_id = p_cafe_id
      and m.occurred_at >= (v_prev_from::timestamp at time zone 'Asia/Jakarta') and m.occurred_at < ((v_to + 1)::timestamp at time zone 'Asia/Jakarta')
  );

  -- 5. Kandidat promosi: margin >= median tetapi terjual <= median (atau turun), tersedia, stok cukup
  if v_costed >= 3 then
    execute format($q$
      select coalesce(jsonb_agg(to_jsonb(x) order by x.margin_pct desc), '[]'::jsonb)
      from (
        select b.product_name as name, b.quantity_sold as quantity, b.margin_pct, b.gross_profit,
               coalesce(prev.q, 0) as previous_quantity,
               av.portions,
               %s
               array_remove(array[
                 'margin_tinggi',
                 case when b.quantity_sold <= $3 then 'penjualan_rendah' end,
                 case when coalesce(prev.q, 0) > b.quantity_sold then 'penjualan_turun' end
               ], null) as reasons
        from pg_temp.bi_profit b
        join public.products p on p.id = b.product_id and p.is_available
        left join (select a.product_id, a.portions, a.available from public.product_availability($1) a) av on av.product_id = b.product_id
        left join (
          select oi.product_id, sum(oi.quantity) q from public.order_items oi join public.orders o on o.id = oi.order_id
          where o.cafe_id = $1 and o.order_status::text = 'completed'
            and o.created_at >= ($4::timestamp at time zone 'Asia/Jakarta') and o.created_at < (($5 + 1)::timestamp at time zone 'Asia/Jakarta')
          group by oi.product_id
        ) prev on prev.product_id = b.product_id
        where b.uncosted_quantity < b.quantity_sold and b.margin_pct >= $2
          and (b.quantity_sold <= $3 or coalesce(prev.q, 0) > b.quantity_sold)
          and coalesce(av.available, true) and (av.portions is null or av.portions >= 10)
        order by b.margin_pct desc
        limit 5
      ) x
    $q$, case when v_has_reviews then '(select round(avg(r.rating), 1) from public.product_reviews r where r.product_id = b.product_id and not r.is_hidden) as rating, (select count(*) from public.product_reviews r where r.product_id = b.product_id and not r.is_hidden) as rating_count,' else '' end)
    into v_promote
    using p_cafe_id, v_med_margin, v_med_qty, v_prev_from, v_prev_to;
    v_promote := jsonb_build_object('basis', 'ok', 'median_margin_pct', round(v_med_margin, 1), 'median_quantity', v_med_qty, 'candidates', v_promote);
  else
    v_promote := jsonb_build_object('basis', 'data_kurang', 'reason', 'Butuh minimal 3 produk terjual yang punya resep (HPP) di periode ini.', 'candidates', '[]'::jsonb);
  end if;

  -- 6. Kualitas data
  select s.inventory_tracking into v_tracking from public.cafe_settings s where s.cafe_id = p_cafe_id;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'cafe_settings' and column_name = 'accounting_go_live') then
    execute 'select accounting_go_live from public.cafe_settings where cafe_id = $1' into v_go_live using p_cafe_id;
  end if;
  v_quality := jsonb_build_object(
    'inventory_tracking', coalesce(v_tracking, false),
    'accounting_go_live', v_go_live,
    'products_without_recipe', jsonb_array_length(v_profit -> 'without_recipe'),
    'account_order_share_pct', (select case when count(*) > 0 then round(count(*) filter (where o.customer_id is not null)::numeric / count(*) * 100, 1) end
                                from public.orders o where o.cafe_id = p_cafe_id and o.payment_status::text = 'paid' and o.order_status::text <> 'cancelled'
                                  and o.created_at >= (v_from::timestamp at time zone 'Asia/Jakarta') and o.created_at < ((v_to + 1)::timestamp at time zone 'Asia/Jakarta'))
  );

  return jsonb_build_object(
    'generated_at', now(), 'today', v_today, 'currency', 'IDR', 'timezone', 'Asia/Jakarta',
    'period', jsonb_build_object('from', v_from, 'to', v_to, 'days', v_days, 'previous_from', v_prev_from, 'previous_to', v_prev_to,
                                 'partial_today', v_to = v_today),
    'definitions', jsonb_build_object(
      'revenue', 'Total pesanan lunas yang tidak dibatalkan, per tanggal pesanan (WIB). Refund ditampilkan terpisah.',
      'effect_orders', 'Bagian perubahan penjualan karena jumlah pesanan berubah (dihitung dengan nilai rata-rata periode lalu).',
      'effect_basket', 'Bagian perubahan penjualan karena nilai rata-rata per pesanan berubah.',
      'estimate', 'Angka bertanda estimasi/perkiraan bukan data aktual.'
    ),
    'revenue', v_rev, 'profit', v_profit, 'stock', v_stock, 'expenses', v_expenses, 'promote', v_promote,
    'customers', public.bi_customer_analytics(p_cafe_id, v_from, v_to, false) - 'products' - 'cohorts',
    'data_quality', v_quality
  );
end;
$$;
revoke all on function public.bi_advisor_facts(uuid, date, date) from public, anon;
grant execute on function public.bi_advisor_facts(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------------
-- E. Log & kuota pertanyaan AI
-- ---------------------------------------------------------------------
create table if not exists public.ai_advisor_logs (
  id uuid primary key default gen_random_uuid(),
  cafe_id uuid not null references public.cafes (id) on delete cascade,
  user_id uuid default auth.uid(),
  question text not null check (char_length(btrim(question)) between 3 and 500),
  answer text check (answer is null or char_length(answer) <= 20000),
  period_from date,
  period_to date,
  model text check (model is null or char_length(model) <= 60),
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  status text not null default 'answered' check (status in ('answered', 'refused', 'error')),
  created_at timestamptz not null default now()
);
create index if not exists ai_advisor_logs_cafe_idx on public.ai_advisor_logs (cafe_id, created_at desc);
alter table public.ai_advisor_logs enable row level security;
revoke all on public.ai_advisor_logs from anon, authenticated;
grant select on public.ai_advisor_logs to authenticated;
drop policy if exists "Owners read advisor logs" on public.ai_advisor_logs;
create policy "Owners read advisor logs" on public.ai_advisor_logs for select to authenticated
  using (public.is_cafe_member(cafe_id, array['owner']));

-- Paket: AI hanya Pro & Enterprise (bila file 10 sudah dijalankan)
do $$
begin
  if to_regclass('public.plans') is not null then
    update public.plans set features = array_append(features, 'ai_advisor')
    where code in ('pro', 'enterprise') and not ('ai_advisor' = any (features));
    update public.plans set limits = limits || '{"ai_daily": 30}'::jsonb where code = 'pro' and not limits ? 'ai_daily';
    update public.plans set limits = limits || '{"ai_daily": 100}'::jsonb where code = 'enterprise' and not limits ? 'ai_daily';
  end if;
end;
$$;

create or replace function public.bi_advisor_quota(p_cafe_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_allowed boolean := true;
  v_limit integer := 30;
  v_used integer;
  v_has_plans boolean := to_regprocedure('public.cafe_has_feature(uuid, text)') is not null;
begin
  perform public.bi_require_owner(p_cafe_id);
  if v_has_plans then
    execute 'select public.cafe_has_feature($1, ''ai_advisor''), coalesce(public.cafe_limit($1, ''ai_daily''), 30)'
    into v_allowed, v_limit using p_cafe_id;
  end if;
  select count(*)::integer into v_used from public.ai_advisor_logs l
  where l.cafe_id = p_cafe_id and l.status <> 'error'
    and l.created_at >= (public.bi_today()::timestamp at time zone 'Asia/Jakarta');
  return jsonb_build_object('allowed', v_allowed, 'limit', v_limit, 'used', v_used, 'remaining', greatest(v_limit - v_used, 0));
end;
$$;
revoke all on function public.bi_advisor_quota(uuid) from public, anon;
grant execute on function public.bi_advisor_quota(uuid) to authenticated;

-- Dipanggil Edge Function `advisor` (dengan token owner) setelah AI menjawab
create or replace function public.bi_advisor_log(
  p_cafe_id uuid, p_question text, p_answer text, p_status text, p_model text,
  p_input_tokens integer, p_output_tokens integer, p_period_from date, p_period_to date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform public.bi_require_owner(p_cafe_id);
  insert into public.ai_advisor_logs (cafe_id, user_id, question, answer, status, model, input_tokens, output_tokens, period_from, period_to)
  values (p_cafe_id, (select auth.uid()), left(btrim(p_question), 500), left(p_answer, 20000), coalesce(p_status, 'answered'), left(p_model, 60),
          p_input_tokens, p_output_tokens, p_period_from, p_period_to)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.bi_advisor_log(uuid, text, text, text, text, integer, integer, date, date) from public, anon;
grant execute on function public.bi_advisor_log(uuid, text, text, text, text, integer, integer, date, date) to authenticated;

notify pgrst, 'reload schema';

commit;

-- Verifikasi: 1 tabel + 6 fungsi ⇒ 7 baris
select 'table' as kind, table_name as name
from information_schema.tables
where table_schema = 'public' and table_name = 'ai_advisor_logs'
union all
select 'function', p.proname
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('bi_sales_forecast', 'bi_product_demand', 'bi_customer_analytics', 'bi_advisor_facts', 'bi_advisor_quota', 'bi_advisor_log')
order by 1, 2;
