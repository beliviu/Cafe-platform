-- =====================================================================
-- 19 · OWNER BISA MERESET TRANSAKSI KAFENYA SENDIRI (mulai operasi dari nol)
-- ---------------------------------------------------------------------
-- Bergantung pada file 04–08 (pesanan, stok, akuntansi, pelanggan) dan 14 (log admin platform).
-- Tombol di web owner: Pengaturan → Umum → "Reset transaksi". Owner wajib mengetik nama kafe persis.
--
-- DIHAPUS (hanya kafe itu): pesanan & item, status pesanan, pembayaran & refund, pembayaran online, sesi kasir & kas,
--   pesanan ditahan, jurnal & periode tutup buku, pengeluaran, pembelian & bayar supplier, riwayat & opname stok,
--   batch bahan, ulasan, pemakaian voucher, riwayat poin, chat dukungan, notifikasi, catatan shift, nomor dokumen,
--   log aktivitas kafe.
-- DINOLKAN: stok bahan (on_hand) & poin/total belanja pelanggan di kafe itu.
-- DISIMPAN: kafe & pengaturan, menu, meja & QR, akun owner/staff/pelanggan, bahan & resep, supplier,
--   voucher & promo, daftar akun pembukuan, langganan Dailybrew.
--
-- Satu transaksi, aditif (hanya fungsi baru). Aman dijalankan ulang.
-- =====================================================================

begin;

create or replace function public.owner_reset_transactions(p_cafe_id uuid, p_confirm text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_counts jsonb := '{}'::jsonb;
  v_rows integer;
  t text;
begin
  if not public.is_cafe_member(p_cafe_id, array['owner']) then
    raise exception 'Hanya owner kafe ini yang bisa mereset transaksi' using errcode = '42501';
  end if;
  select c.name into v_name from public.cafes c where c.id = p_cafe_id for update;
  if v_name is null then
    raise exception 'Kafe tidak ditemukan' using errcode = 'P0002';
  end if;
  if trim(coalesce(p_confirm, '')) <> trim(v_name) then
    raise exception 'Ketik nama kafe persis "%" untuk konfirmasi', v_name using errcode = 'P0001', hint = 'confirm_mismatch';
  end if;

  -- Urutan aman untuk relasi antartabel (anak dulu). Tabel yang belum ada di instalasi ini dilewati.
  foreach t in array array[
    'journal_lines', 'journal_entries', 'acc_sync_issues', 'accounting_periods',
    'stock_movements', 'stock_reservations', 'stock_count_lines', 'stock_counts', 'ingredient_batches', 'inventory_sync_issues',
    'supplier_payments', 'purchase_order_items', 'purchase_orders', 'expenses',
    'payment_refunds', 'payment_events', 'payment_intents',
    'product_reviews', 'voucher_redemptions', 'loyalty_ledger', 'support_messages', 'support_tickets',
    'refunds', 'order_item_options', 'order_status_events', 'order_items', 'orders',
    'cash_movements', 'cashier_sessions', 'pos_held_orders',
    'notifications', 'staff_shifts', 'document_counters', 'audit_logs'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('delete from public.%I where cafe_id = $1', t) using p_cafe_id;
      get diagnostics v_rows = row_count;
      v_counts := v_counts || jsonb_build_object(t, v_rows);
    end if;
  end loop;

  if to_regclass('public.ingredients') is not null then
    update public.ingredients set on_hand = 0 where cafe_id = p_cafe_id;
  end if;
  if to_regclass('public.loyalty_accounts') is not null then
    update public.loyalty_accounts set points_balance = 0, lifetime_points = 0, lifetime_spend = 0, tier = null where cafe_id = p_cafe_id;
  end if;

  -- Jejak: log aktivitas kafe (baris pertama setelah reset) + log admin platform
  insert into public.audit_logs (cafe_id, actor_id, action, entity, entity_id, label, changes)
  values (p_cafe_id, (select auth.uid()), 'delete', 'transactions', p_cafe_id::text, 'Reset semua transaksi',
          jsonb_build_object('orders', v_counts -> 'orders', 'journal_entries', v_counts -> 'journal_entries'));
  if to_regprocedure('public.pa_log(text, uuid, text, text, jsonb, jsonb, text, uuid, text)') is not null then
    perform public.pa_log('cafe.reset_transactions', p_cafe_id, 'cafe', p_cafe_id::text, null, v_counts, 'Direset owner dari Pengaturan', (select auth.uid()), null);
  end if;
  return jsonb_build_object('ok', true, 'deleted', v_counts, 'orders', coalesce((v_counts ->> 'orders')::integer, 0));
end;
$$;
revoke all on function public.owner_reset_transactions(uuid, text) from public, anon;
grant execute on function public.owner_reset_transactions(uuid, text) to authenticated;

notify pgrst, 'reload schema';

commit;

-- Verifikasi: 1 baris
select proname as fungsi_terpasang from pg_proc where proname = 'owner_reset_transactions';
