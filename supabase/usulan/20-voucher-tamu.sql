-- =====================================================================
-- 20 · VOUCHER UNTUK TAMU (pesan lewat QR meja tanpa login)
-- ---------------------------------------------------------------------
-- Bergantung pada file 08 (voucher & checkout) dan 13 (tamu QR meja).
--
-- Owner memilih per voucher siapa yang boleh memakai:
--   audience = 'members' → hanya pelanggan yang login (perilaku lama, bawaan)
--   audience = 'all'     → semua pelanggan, termasuk tamu QR meja tanpa login
--
-- Yang berubah:
--   - Kolom baru vouchers.audience (voucher lama otomatis 'members', jadi tidak ada yang berubah sampai owner mengubahnya).
--   - voucher_evaluate: menolak tamu untuk voucher 'members'.
--   - voucher_check: tamu (sesi tamu atau belum ada sesi) boleh cek voucher; hasilnya mengikuti audience.
--   - customer_place_order: tamu boleh memakai voucher 'all'. Tukar POIN tetap khusus member.
--
-- Catatan: batas "per pelanggan" untuk tamu dihitung per sesi tamu (per HP/browser). Untuk promo tamu,
-- isi juga "Kuota total" agar voucher tidak bisa dipakai tanpa batas.
--
-- Satu transaksi. Aman dijalankan ulang.
-- =====================================================================

begin;

alter table public.vouchers
  add column if not exists audience text not null default 'members';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'vouchers_audience_check') then
    alter table public.vouchers add constraint vouchers_audience_check check (audience in ('all', 'members'));
  end if;
end;
$$;

create or replace function public.voucher_evaluate(p_cafe_id uuid, p_code text, p_customer uuid, p_subtotal numeric, p_lock boolean default false)
returns table (voucher_id uuid, voucher_name text, discount numeric, problem text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
  v public.vouchers%rowtype;
  v_used integer;
  v_mine integer;
  v_discount numeric(12, 2);
begin
  if v_code = '' then
    return query select null::uuid, null::text, 0::numeric, 'Masukkan kode voucher';
    return;
  end if;
  if p_lock then
    select * into v from public.vouchers x where x.cafe_id = p_cafe_id and x.code = v_code for update;
  else
    select * into v from public.vouchers x where x.cafe_id = p_cafe_id and x.code = v_code;
  end if;
  if v.id is null or not v.is_active then
    return query select null::uuid, null::text, 0::numeric, 'Kode voucher tidak ditemukan';
    return;
  end if;
  -- File 20: voucher khusus member tidak bisa dipakai tamu (belum login / sesi tamu QR meja)
  if coalesce(v.audience, 'members') = 'members'
     and (p_customer is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)) then
    return query select v.id, v.name, 0::numeric, 'Voucher ini khusus member. Masuk atau daftar dulu untuk memakainya.';
    return;
  end if;
  if v.starts_at is not null and now() < v.starts_at then
    return query select v.id, v.name, 0::numeric, 'Voucher belum berlaku';
    return;
  end if;
  if v.ends_at is not null and now() >= v.ends_at then
    return query select v.id, v.name, 0::numeric, 'Voucher sudah berakhir';
    return;
  end if;
  if coalesce(p_subtotal, 0) < v.min_subtotal then
    return query select v.id, v.name, 0::numeric, 'Minimal belanja Rp ' || replace(to_char(v.min_subtotal, 'FM999,999,999,990'), ',', '.') || ' untuk voucher ini';
    return;
  end if;
  select count(*) into v_used from public.voucher_redemptions r where r.voucher_id = v.id and r.status = 'applied';
  if v.usage_limit is not null and v_used >= v.usage_limit then
    return query select v.id, v.name, 0::numeric, 'Kuota voucher sudah habis';
    return;
  end if;
  if p_customer is not null then
    select count(*) into v_mine from public.voucher_redemptions r where r.voucher_id = v.id and r.status = 'applied' and r.customer_id = p_customer;
    if v_mine >= v.per_customer_limit then
      return query select v.id, v.name, 0::numeric, 'Kamu sudah memakai voucher ini';
      return;
    end if;
  end if;
  v_discount := case when v.discount_type = 'percent' then round(coalesce(p_subtotal, 0) * v.discount_value / 100, 0) else v.discount_value end;
  if v.max_discount is not null then
    v_discount := least(v_discount, v.max_discount);
  end if;
  v_discount := least(v_discount, coalesce(p_subtotal, 0));
  return query select v.id, v.name, v_discount, null::text;
end;
$$;
revoke all on function public.voucher_evaluate(uuid, text, uuid, numeric, boolean) from public, anon, authenticated;

create or replace function public.voucher_check(p_cafe_id uuid, p_code text, p_subtotal numeric)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  -- Tamu tanpa sesi (anon) → p_customer null; sesi tamu → is_anonymous. Keduanya dicek audience di voucher_evaluate.
  return (
    select jsonb_build_object('ok', e.problem is null, 'name', e.voucher_name, 'discount', e.discount, 'message', e.problem)
    from public.voucher_evaluate(p_cafe_id, p_code, (select auth.uid()), p_subtotal, false) e
  );
end;
$$;
revoke all on function public.voucher_check(uuid, text, numeric) from public;
grant execute on function public.voucher_check(uuid, text, numeric) to anon, authenticated;

create or replace function public.customer_place_order(
  p_cafe_id uuid,
  p_items jsonb,
  p_order_type text default null,
  p_table_token text default null,
  p_notes text default null,
  p_payment_method text default null,
  p_idempotency_key text default null,
  p_scheduled_for timestamptz default null,
  p_voucher_code text default null,
  p_redeem_points integer default 0
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_existing uuid;
  v_hours jsonb;
  v_settings public.cafe_settings%rowtype;
  v_table public.cafe_tables%rowtype;
  v_order_id uuid;
  v_order public.orders%rowtype;
  v_voucher_id uuid;
  v_voucher_problem text;
  v_voucher_discount numeric(12, 2) := 0;
  v_points integer := greatest(coalesce(p_redeem_points, 0), 0);
  v_points_discount numeric(12, 2) := 0;
  v_balance integer;
  v_cap numeric(12, 2);
  v_reason text;
  v_next timestamptz;
begin
  if v_uid is null then
    raise exception 'Login diperlukan untuk membuat pesanan' using errcode = '28000';
  end if;
  -- File 20: tamu boleh memakai voucher yang diizinkan owner (dicek di voucher_evaluate); poin tetap khusus member
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) and coalesce(p_redeem_points, 0) > 0 then
    raise exception 'Masuk ke akun customer untuk memakai poin.'
      using errcode = '42501', hint = 'member_benefits_required';
  end if;
  -- Kunci anti-dobel dipegang sejak awal (place_order memakai kunci yang sama)
  if v_key is not null then
    if char_length(v_key) not between 8 and 80 then
      raise exception 'Kunci pesanan tidak valid' using errcode = '22023';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(p_cafe_id::text || ':order:' || v_key, 0));
    select o.id into v_existing from public.orders o where o.cafe_id = p_cafe_id and o.idempotency_key = v_key;
    if v_existing is not null then
      return v_existing;
    end if;
  end if;

  select c.opening_hours into v_hours from public.cafes c where c.id = p_cafe_id;
  if not found then
    raise exception 'Kafe tidak ditemukan' using errcode = '22023';
  end if;
  select * into v_settings from public.cafe_settings s where s.cafe_id = p_cafe_id;

  if coalesce(v_settings.ordering_paused, false) then
    raise exception '%', coalesce('Kafe sedang tidak menerima pesanan: ' || v_settings.ordering_message, 'Kafe sedang tidak menerima pesanan dari aplikasi. Coba lagi nanti.')
      using errcode = 'P0001', hint = 'ordering_paused';
  end if;

  if p_table_token is not null then
    select * into v_table from public.cafe_tables t where t.qr_token = p_table_token;
    if not found then
      raise exception 'QR meja tidak valid. Scan ulang QR di meja.' using errcode = '22023', hint = 'table_invalid';
    end if;
    if v_table.cafe_id <> p_cafe_id then
      raise exception 'QR meja ini milik kafe lain.' using errcode = '42501', hint = 'table_other_cafe';
    end if;
    if not v_table.is_active then
      raise exception 'Meja % sedang tidak dipakai. Hubungi kasir.', v_table.label using errcode = '22023', hint = 'table_inactive';
    end if;
    if not coalesce(v_settings.qr_ordering_enabled, true) then
      raise exception 'Pesan lewat QR meja sedang dinonaktifkan kafe.' using errcode = 'P0001', hint = 'qr_disabled';
    end if;
    if p_scheduled_for is not null then
      raise exception 'Pesanan dari meja tidak bisa dijadwalkan' using errcode = '22023';
    end if;
  end if;

  if p_scheduled_for is not null then
    if not coalesce(v_settings.scheduled_orders_enabled, false) then
      raise exception 'Kafe ini belum menerima pesanan terjadwal' using errcode = 'P0001', hint = 'scheduled_disabled';
    end if;
    if p_scheduled_for < now() + interval '15 minutes' or p_scheduled_for > now() + interval '7 days' then
      raise exception 'Jadwal ambil minimal 15 menit dari sekarang, maksimal 7 hari' using errcode = '22023';
    end if;
    if not public.cafe_open_at(v_hours, p_scheduled_for) then
      raise exception 'Kafe tutup pada jam yang dipilih' using errcode = '22023', hint = 'scheduled_closed';
    end if;
  elsif not public.cafe_open_at(v_hours, now()) then
    v_next := public.cafe_next_open(v_hours, now());
    raise exception '%', 'Kafe sedang tutup' || coalesce('. Buka lagi ' || to_char(v_next at time zone 'Asia/Jakarta', 'DD/MM HH24:MI') || ' WIB', '')
      || case when coalesce(v_settings.scheduled_orders_enabled, false) then '. Kamu bisa menjadwalkan pesanan.' else '.' end
      using errcode = 'P0001', hint = 'cafe_closed';
  end if;

  v_order_id := public.place_order(
    p_cafe_id, p_items, 'app',
    case when v_table.id is not null then coalesce(p_order_type, 'dine_in') else p_order_type end,
    v_table.id, null, p_notes, null, p_payment_method, v_key
  );
  select * into v_order from public.orders o where o.id = v_order_id for update;

  -- Voucher
  if nullif(btrim(coalesce(p_voucher_code, '')), '') is not null then
    select e.voucher_id, e.discount, e.problem into v_voucher_id, v_voucher_discount, v_voucher_problem
    from public.voucher_evaluate(p_cafe_id, p_voucher_code, v_uid, v_order.subtotal_amount, true) e;
    if v_voucher_problem is not null then
      raise exception '%', v_voucher_problem using errcode = '22023', hint = 'voucher_invalid';
    end if;
    insert into public.voucher_redemptions (cafe_id, voucher_id, order_id, customer_id, amount)
    values (p_cafe_id, v_voucher_id, v_order_id, v_uid, v_voucher_discount);
  end if;

  -- Tukar poin (dibatasi persen maksimal dari sisa subtotal)
  if v_points > 0 then
    if not coalesce(v_settings.loyalty_enabled, false) then
      raise exception 'Program poin tidak aktif di kafe ini' using errcode = '22023';
    end if;
    if v_points < v_settings.loyalty_min_redeem then
      raise exception 'Minimal tukar % poin', v_settings.loyalty_min_redeem using errcode = '22023';
    end if;
    select a.points_balance into v_balance from public.loyalty_accounts a where a.cafe_id = p_cafe_id and a.customer_id = v_uid for update;
    if coalesce(v_balance, 0) < v_points then
      raise exception 'Poin tidak cukup (saldo %)', coalesce(v_balance, 0) using errcode = '22023';
    end if;
    v_cap := floor((v_order.subtotal_amount - v_voucher_discount) * v_settings.loyalty_max_redeem_pct / 100);
    v_points := least(v_points, floor(v_cap / v_settings.loyalty_point_value)::integer);
    if v_points < v_settings.loyalty_min_redeem then
      raise exception 'Belanja terlalu kecil untuk menukar poin' using errcode = '22023';
    end if;
    v_points_discount := v_points * v_settings.loyalty_point_value;
    perform public.loyalty_post(p_cafe_id, v_uid, 'redeem', -v_points, v_order_id, null, 'Tukar poin', 0);
  end if;

  if v_voucher_discount + v_points_discount > 0 then
    v_reason := concat_ws(' + ',
      case when v_voucher_discount > 0 then 'Voucher ' || upper(btrim(p_voucher_code)) end,
      case when v_points > 0 then v_points || ' poin' end);
    perform public.ord_reprice(v_order_id, v_voucher_discount + v_points_discount, v_reason);
  end if;

  update public.orders
  set scheduled_for = p_scheduled_for,
      estimated_ready_at = coalesce(p_scheduled_for, now() + make_interval(mins => public.cafe_prep_minutes(p_cafe_id))),
      voucher_id = v_voucher_id,
      voucher_code = case when v_voucher_id is not null then upper(btrim(p_voucher_code)) end,
      voucher_discount = v_voucher_discount,
      points_redeemed = v_points,
      points_discount = v_points_discount
  where id = v_order_id;
  return v_order_id;
end;
$$;
revoke all on function public.customer_place_order(uuid, jsonb, text, text, text, text, text, timestamptz, text, integer) from public, anon;
grant execute on function public.customer_place_order(uuid, jsonb, text, text, text, text, text, timestamptz, text, integer) to authenticated;

notify pgrst, 'reload schema';

commit;

-- Verifikasi: 1 baris, kolom audience ada
select column_name as kolom_baru from information_schema.columns
where table_schema = 'public' and table_name = 'vouchers' and column_name = 'audience';
