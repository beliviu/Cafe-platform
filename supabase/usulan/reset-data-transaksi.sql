-- =====================================================================
-- RESET DATA TRANSAKSI (opsi A) — untuk uji ulang dari nol
--
-- DIHAPUS : pesanan & item, pembayaran, refund, riwayat status, sesi & kas kasir, pesanan ditahan,
--           jurnal & periode tutup buku, beban, mutasi stok & batch, opname, PO & bayar supplier,
--           poin & riwayat poin, pemakaian voucher, ulasan, tiket bantuan, notifikasi, token push,
--           tagihan QRIS online, log AI, nomor dokumen, catatan masalah sinkron.
-- TETAP   : kafe, akun owner/staff/pelanggan, menu/kategori/varian, resep, bahan, supplier & katalog,
--           meja (+QR), voucher (definisi), banner promo, wishlist, bagan akun, pengaturan, langganan,
--           log aktivitas tim.
-- DIUBAH  : stok semua bahan = 0 (isi ulang lewat Stok masuk); pembukuan belum dimulai lagi
--           (wizard "Mulai pembukuan" muncul lagi).
--
-- WAJIB: buat backup dulu (Dashboard → Database → Backups). Data yang dihapus TIDAK bisa dikembalikan.
-- Jalankan di SQL Editor. Satu transaksi: kalau ada error, tidak ada yang terhapus.
-- Berlaku untuk SEMUA kafe di database ini.
-- =====================================================================

begin;

do $$
declare
  v_tables text[] := array[
    'order_item_options', 'stock_reservations', 'order_status_events', 'payment_events', 'payment_refunds', 'payment_intents',
    'refunds', 'payments', 'product_reviews', 'voucher_redemptions', 'loyalty_ledger', 'loyalty_accounts',
    'support_messages', 'support_tickets', 'notifications', 'push_tokens', 'pos_held_orders', 'cash_movements',
    'journal_lines', 'journal_entries', 'accounting_periods', 'acc_sync_issues', 'expenses',
    'stock_count_lines', 'stock_counts', 'stock_movements', 'ingredient_batches', 'inventory_sync_issues',
    'supplier_payments', 'purchase_order_items', 'purchase_orders', 'document_counters', 'ai_advisor_logs',
    'order_items', 'orders', 'cashier_sessions'
  ];
  v_existing text[];
begin
  select array_agg(format('public.%I', t)) into v_existing
  from unnest(v_tables) t where to_regclass('public.' || t) is not null;
  -- RESTRICT: gagal (tanpa menghapus apa pun) bila tabel yang dipertahankan masih merujuk data ini
  execute 'truncate table ' || array_to_string(v_existing, ', ') || ' restart identity restrict';
end;
$$;

-- Stok bahan kembali 0
do $$
begin
  if to_regclass('public.ingredients') is not null then
    execute 'alter table public.ingredients disable trigger user';
    update public.ingredients set on_hand = 0, avg_cost = 0;
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ingredients' and column_name = 'reserved') then
      execute 'update public.ingredients set reserved = 0';
    end if;
    execute 'alter table public.ingredients enable trigger user';
  end if;
  -- Pembukuan dimulai ulang
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'cafe_settings' and column_name = 'accounting_go_live') then
    execute 'alter table public.cafe_settings disable trigger user';
    execute 'update public.cafe_settings set accounting_go_live = null';
    execute 'alter table public.cafe_settings enable trigger user';
  end if;
end;
$$;

commit;

-- Cek: semua jumlah harus 0
select 'orders' as tabel, count(*) as baris from public.orders
union all select 'order_items', count(*) from public.order_items
union all select 'payments', count(*) from public.payments
union all select 'bahan dengan stok ≠ 0', count(*) from public.ingredients where on_hand <> 0;
