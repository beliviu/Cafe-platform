-- =====================================================================
-- 21 · RINCIAN HARGA SEBELUM CHECKOUT (angka sama persis dengan setelah pesan)
-- ---------------------------------------------------------------------
-- Bergantung pada file 06 (place_order: harga, varian, service, pajak, pembulatan) dan 08 (voucher & poin).
--
-- customer_quote_order menghitung rincian harga TANPA membuat pesanan, dengan aturan yang sama seperti
-- place_order + customer_place_order: harga menu terbaru, varian (termasuk pilihan bawaan grup wajib),
-- voucher, tukar poin, service charge, pajak, dan pembulatan. App pelanggan menampilkannya di checkout,
-- jadi pelanggan tahu total final sebelum menekan "Buat pesanan".
--
-- Bisa dipanggil tamu (belum login) — hanya membaca harga publik. Poin hanya untuk member yang login.
-- Hanya fungsi baru (aditif). Aman dijalankan ulang.
-- =====================================================================

begin;

create or replace function public.customer_quote_order(
  p_cafe_id uuid,
  p_items jsonb,
  p_voucher_code text default null,
  p_redeem_points integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_guest boolean := (select auth.uid()) is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false);
  v_settings public.cafe_settings%rowtype;
  v_item jsonb;
  v_product public.products%rowtype;
  v_qty integer;
  v_option_ids uuid[];
  v_final uuid[];
  v_pick uuid;
  v_group record;
  v_delta numeric(12, 2);
  v_lines jsonb := '[]'::jsonb;
  v_problems jsonb := '[]'::jsonb;
  v_subtotal numeric(12, 2) := 0;
  v_voucher_id uuid;
  v_voucher_name text;
  v_voucher_discount numeric(12, 2) := 0;
  v_voucher_problem text;
  v_points integer := greatest(coalesce(p_redeem_points, 0), 0);
  v_points_discount numeric(12, 2) := 0;
  v_points_problem text;
  v_balance integer;
  v_cap numeric(12, 2);
  v_base numeric(12, 2);
  v_service numeric(12, 2) := 0;
  v_tax_base numeric(12, 2);
  v_tax numeric(12, 2) := 0;
  v_before numeric(12, 2);
  v_total numeric(12, 2);
  v_index integer := -1;
begin
  if not exists (select 1 from public.cafes c where c.id = p_cafe_id) then
    raise exception 'Kafe tidak ditemukan' using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 50 then
    raise exception 'Pesanan harus berisi 1–50 item' using errcode = '22023';
  end if;
  select * into v_settings from public.cafe_settings s where s.cafe_id = p_cafe_id;

  -- Item: harga terbaru + varian (sama seperti place_order). Item bermasalah dicatat, tidak menggagalkan rincian.
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_index := v_index + 1;
    v_product := null;
    begin
      v_qty := least(greatest(coalesce((v_item ->> 'quantity')::integer, 1), 1), 99);
      select * into v_product from public.products p where p.id = (v_item ->> 'product_id')::uuid and p.cafe_id = p_cafe_id;
      v_option_ids := coalesce(
        (select array_agg(distinct x::uuid) from jsonb_array_elements_text(coalesce(v_item -> 'option_ids', '[]'::jsonb)) as x),
        '{}'::uuid[]);
    exception when others then
      v_problems := v_problems || jsonb_build_object('index', v_index, 'message', 'Item tidak valid');
      continue;
    end;
    if v_product.id is null then
      v_problems := v_problems || jsonb_build_object('index', v_index, 'message', 'Menu sudah tidak tersedia');
      continue;
    end if;
    if not v_product.is_available then
      v_problems := v_problems || jsonb_build_object('index', v_index, 'message', v_product.name || ' sedang habis');
    end if;
    -- Hanya varian milik produk ini
    v_final := coalesce((
      select array_agg(o.id) from public.product_options o join public.product_option_groups g on g.id = o.group_id
      where o.id = any (v_option_ids) and g.product_id = v_product.id), '{}'::uuid[]);
    if exists (select 1 from public.product_options o where o.id = any (v_final) and not o.is_available) then
      v_problems := v_problems || jsonb_build_object('index', v_index, 'message', 'Pilihan varian ' || v_product.name || ' sedang habis');
    end if;
    for v_group in
      select g.id from public.product_option_groups g
      where g.product_id = v_product.id and g.is_required
        and not exists (select 1 from public.product_options o where o.group_id = g.id and o.id = any (v_final))
      order by g.sort_order
    loop
      v_pick := null;
      select o.id into v_pick from public.product_options o
      where o.group_id = v_group.id and o.is_available
      order by o.is_default desc, o.sort_order, o.name limit 1;
      if v_pick is not null then v_final := v_final || v_pick; end if;
    end loop;
    select coalesce(sum(o.price_delta), 0) into v_delta from public.product_options o where o.id = any (v_final);

    v_lines := v_lines || jsonb_build_object('index', v_index, 'product_id', v_product.id, 'quantity', v_qty,
      'unit_price', v_product.price + v_delta, 'line_total', (v_product.price + v_delta) * v_qty);
    v_subtotal := v_subtotal + (v_product.price + v_delta) * v_qty;
  end loop;

  -- Voucher (aturan audience file 20 ikut berlaku bila sudah dijalankan)
  if nullif(btrim(coalesce(p_voucher_code, '')), '') is not null then
    select e.voucher_id, e.voucher_name, e.discount, e.problem
    into v_voucher_id, v_voucher_name, v_voucher_discount, v_voucher_problem
    from public.voucher_evaluate(p_cafe_id, p_voucher_code, v_uid, v_subtotal, false) e;
    if v_voucher_problem is not null then
      v_voucher_discount := 0;
    end if;
  end if;

  -- Poin (khusus member; sama seperti customer_place_order)
  if v_points > 0 then
    if v_guest then
      v_points_problem := 'Masuk ke akun customer untuk memakai poin.';
    elsif not coalesce(v_settings.loyalty_enabled, false) then
      v_points_problem := 'Program poin tidak aktif di kafe ini';
    else
      select a.points_balance into v_balance from public.loyalty_accounts a where a.cafe_id = p_cafe_id and a.customer_id = v_uid;
      v_cap := floor((v_subtotal - v_voucher_discount) * v_settings.loyalty_max_redeem_pct / 100);
      v_points := least(v_points, coalesce(v_balance, 0), floor(v_cap / nullif(v_settings.loyalty_point_value, 0))::integer);
      if coalesce(v_points, 0) < v_settings.loyalty_min_redeem then
        v_points_problem := 'Poin belum cukup untuk ditukar di pesanan ini';
        v_points := 0;
      else
        v_points_discount := v_points * v_settings.loyalty_point_value;
      end if;
    end if;
    if v_points_problem is not null then v_points := 0; end if;
  end if;

  -- Service → pajak → pembulatan (identik dengan place_order)
  v_base := v_subtotal - least(v_voucher_discount + v_points_discount, v_subtotal);
  if coalesce(v_settings.service_charge_enabled, false) then
    v_service := round(v_base * v_settings.service_charge_rate / 100, 2);
  end if;
  v_tax_base := v_base + case when coalesce(v_settings.service_charge_taxable, true) then v_service else 0 end;
  if coalesce(v_settings.tax_enabled, false) then
    v_tax := round(case when v_settings.tax_inclusive
      then v_tax_base - v_tax_base / (1 + v_settings.tax_rate / 100)
      else v_tax_base * v_settings.tax_rate / 100 end, 2);
  end if;
  v_before := v_base + v_service + case when coalesce(v_settings.tax_inclusive, false) then 0 else v_tax end;
  v_total := case when coalesce(v_settings.rounding_unit, 0) > 0
    then round(v_before / v_settings.rounding_unit) * v_settings.rounding_unit
    else round(v_before, 2) end;

  return jsonb_build_object(
    'lines', v_lines,
    'problems', v_problems,
    'subtotal', v_subtotal,
    'voucher', case when nullif(btrim(coalesce(p_voucher_code, '')), '') is null then null
      else jsonb_build_object('code', upper(btrim(p_voucher_code)), 'name', v_voucher_name, 'discount', v_voucher_discount,
        'ok', v_voucher_problem is null, 'message', v_voucher_problem) end,
    'points', v_points,
    'points_discount', v_points_discount,
    'points_message', v_points_problem,
    'service', v_service,
    'service_rate', case when coalesce(v_settings.service_charge_enabled, false) then v_settings.service_charge_rate else 0 end,
    'tax', v_tax,
    'tax_rate', case when coalesce(v_settings.tax_enabled, false) then v_settings.tax_rate else 0 end,
    'tax_inclusive', coalesce(v_settings.tax_inclusive, false),
    'rounding', v_total - v_before,
    'total', v_total
  );
end;
$$;
revoke all on function public.customer_quote_order(uuid, jsonb, text, integer) from public;
grant execute on function public.customer_quote_order(uuid, jsonb, text, integer) to anon, authenticated;

notify pgrst, 'reload schema';

commit;

-- Verifikasi: 1 baris
select proname as fungsi_terpasang from pg_proc where proname = 'customer_quote_order';
