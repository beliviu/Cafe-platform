-- =====================================================================
-- RESET TRANSAKSI SAJA (mulai operasi dari nol, kafe & menu tetap)
-- ---------------------------------------------------------------------
-- TIDAK BISA DIBATALKAN. Backup dulu: Supabase → Database → Backups.
--
-- DIHAPUS (semua kafe): pesanan & item, status pesanan, pembayaran & refund, pembayaran online, sesi kasir & kas,
--   pesanan ditahan (POS), pembukuan (jurnal), pengeluaran, pembelian & bayar supplier, riwayat & opname stok,
--   batch bahan, ulasan, pemakaian voucher, riwayat poin, chat dukungan pelanggan, notifikasi pesanan,
--   log aktivitas kafe, catatan shift staff, nomor dokumen (mulai dari 1 lagi).
-- DINOLKAN: stok bahan (on_hand) dan saldo poin pelanggan.
-- DISIMPAN: kafe & pengaturan, menu/kategori/opsi, meja & QR, akun owner/staff/customer, bahan & resep,
--   supplier, voucher & promo (definisinya), daftar akun pembukuan, langganan Dailybrew & tagihannya.
--
-- Cara pakai: jalankan LANGKAH 1 (hanya melihat). Kalau sesuai, jalankan isi LANGKAH 2.
-- =====================================================================

-- LANGKAH 1 — LIHAT DULU
select 'pesanan' as data, count(*) from public.orders
union all select 'kafe (disimpan)', count(*) from public.cafes
union all select 'produk (disimpan)', count(*) from public.products
union all select 'akun owner/staff/customer (disimpan)', count(*) from public.profiles;


-- LANGKAH 2 — HAPUS TRANSAKSI (satu transaksi; gagal = tidak ada yang berubah)
/*
begin;

do $$
declare
  t text;
  v_tables text[] := '{}';
begin
  foreach t in array array[
    'orders', 'order_items', 'order_item_options', 'order_status_events',
    'payments', 'payment_intents', 'payment_events', 'payment_refunds', 'refunds',
    'cashier_sessions', 'cash_movements', 'pos_held_orders',
    'journal_lines', 'journal_entries', 'accounting_periods', 'acc_sync_issues',
    'expenses', 'purchase_order_items', 'purchase_orders', 'supplier_payments',
    'stock_movements', 'stock_reservations', 'stock_count_lines', 'stock_counts', 'ingredient_batches', 'inventory_sync_issues',
    'product_reviews', 'voucher_redemptions', 'loyalty_ledger',
    'support_messages', 'support_tickets', 'notifications', 'audit_logs', 'staff_shifts', 'document_counters'
  ] loop
    if to_regclass('public.' || t) is not null then
      v_tables := array_append(v_tables, format('public.%I', t));
    end if;
  end loop;
  -- Satu perintah TRUNCATE untuk semua tabel di atas (tanpa CASCADE: gagal bila ada tabel lain yang masih merujuk → aman)
  execute 'truncate table ' || array_to_string(v_tables, ', ') || ' restart identity';
  raise notice 'Dikosongkan: %', array_to_string(v_tables, ', ');

  if to_regclass('public.ingredients') is not null then
    update public.ingredients set on_hand = 0;
  end if;
  if to_regclass('public.loyalty_accounts') is not null then
    update public.loyalty_accounts set points_balance = 0, lifetime_points = 0;
  end if;
end;
$$;

commit;

-- Cek
select 'pesanan' as data, count(*) from public.orders
union all select 'kafe', count(*) from public.cafes
union all select 'produk', count(*) from public.products
union all select 'akun', count(*) from public.profiles;
*/
