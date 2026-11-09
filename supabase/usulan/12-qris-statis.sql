-- =====================================================================
-- 12 · QRIS STATIS MERCHANT (gambar QRIS dari bank / e-wallet milik kafe)
--   - cafe_settings.qris_image_url: gambar QRIS yang diunggah owner (bucket cafe-assets, folder <cafe_id>/).
--   - App customer: pilih "QRIS kafe" → pesanan ditandai payment_method = 'qris' (belum lunas).
--   - Kasir/staff menandai LUNAS setelah mengecek mutasi (alur "Tandai lunas" yang sudah ada,
--     butuh izin "Konfirmasi non-tunai"). QRIS statis TIDAK terverifikasi otomatis.
--
-- Jalankan di SQL Editor SETELAH file 06 (dan 03 untuk bucket cafe-assets). Satu transaksi.
-- Dampak ke data lama: hanya menambah 1 kolom kosong + 1 fungsi. Tidak ada data yang diubah.
-- =====================================================================

begin;

alter table public.cafe_settings add column if not exists qris_image_url text;
alter table public.cafe_settings drop constraint if exists cafe_settings_qris_image_url_check;
alter table public.cafe_settings add constraint cafe_settings_qris_image_url_check
  check (qris_image_url is null or (char_length(qris_image_url) <= 500 and qris_image_url like 'https://%'));
-- Owner boleh mengubah (policy "Owners can update cafe settings" dari file 04 tetap berlaku)
grant update (qris_image_url) on public.cafe_settings to authenticated;

-- Pelanggan memilih bayar dengan QRIS statis kafe untuk pesanannya sendiri
create or replace function public.customer_use_static_qris(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders o where o.id = p_order_id for update;
  if not found or v_order.customer_id is distinct from (select auth.uid()) then
    raise exception 'Pesanan tidak ditemukan' using errcode = 'P0002';
  end if;
  if v_order.order_status::text = 'cancelled' or v_order.payment_status::text = 'paid' then
    raise exception 'Pesanan ini sudah dibayar atau dibatalkan' using errcode = '22023';
  end if;
  if not exists (select 1 from public.cafe_settings s where s.cafe_id = v_order.cafe_id and s.qris_image_url is not null) then
    raise exception 'Kafe belum memasang QRIS' using errcode = '22023';
  end if;
  update public.orders set payment_method = 'qris' where id = p_order_id;
end;
$$;
revoke all on function public.customer_use_static_qris(uuid) from public, anon;
grant execute on function public.customer_use_static_qris(uuid) to authenticated;

notify pgrst, 'reload schema';

commit;

-- Verifikasi: 2 baris (kolom + fungsi)
select 'column' as kind, column_name as name from information_schema.columns
where table_schema = 'public' and table_name = 'cafe_settings' and column_name = 'qris_image_url'
union all
select 'function', proname from pg_proc where proname = 'customer_use_static_qris';
