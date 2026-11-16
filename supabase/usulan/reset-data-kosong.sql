-- =====================================================================
-- RESET DATA KE KOSONG (hapus semua kafe, pesanan, owner/staff/customer uji coba)
-- ---------------------------------------------------------------------
-- TIDAK BISA DIBATALKAN. Backup dulu: Supabase → Database → Backups (atau export tabel penting).
--
-- Yang DIHAPUS : semua kafe beserta semua data yang menempel (menu, pesanan, stok, keuangan, meja, tagihan
--                langganan, tiket, notifikasi, log audit, dsb.), dan semua akun login KECUALI admin platform.
-- Yang DISIMPAN: struktur tabel & fungsi, paket (plans), pengaturan platform, template email, layanan status,
--                fitur flag (katalog), akun admin platform + 2FA-nya.
--
-- Cara pakai: jalankan LANGKAH 1 dulu (hanya melihat). Kalau angkanya sesuai, jalankan LANGKAH 2.
-- =====================================================================

-- LANGKAH 1 — LIHAT DULU (tidak mengubah apa pun)
select 'kafe' as data, count(*) from public.cafes
union all select 'pesanan', count(*) from public.orders
union all select 'akun login (non-admin) yang akan dihapus', count(*) from auth.users u
  where not exists (select 1 from public.platform_admins a where a.user_id = u.id)
union all select 'admin platform (disimpan)', count(*) from public.platform_admins;


-- LANGKAH 2 — HAPUS (blok di bawah ini; satu transaksi, gagal = tidak ada yang berubah)
/*
begin;

-- 1. Semua kafe + SEMUA tabel yang merujuk kafe (berantai: pesanan, item, menu, stok, tagihan, log, dll.)
truncate table public.cafes restart identity cascade;

-- 2. Akun login selain admin platform (owner, staff, customer, tamu QR)
delete from auth.users u where not exists (select 1 from public.platform_admins a where a.user_id = u.id);

-- 3. Sisa data platform yang tidak menempel ke kafe
do $$
declare t text;
begin
  foreach t in array array['platform_mrr_snapshots', 'invoice_number_counters', 'signup_attempts', 'platform_notifications',
                           'platform_audit_logs', 'platform_ai_logs', 'notification_outbox', 'platform_announcements',
                           'platform_incident_updates', 'platform_incidents'] loop
    if to_regclass('public.' || t) is not null then
      execute format('truncate table public.%I restart identity cascade', t);
    end if;
  end loop;
  if to_regclass('public.platform_services') is not null then
    update public.platform_services set status = 'operational', updated_at = now();
  end if;
end;
$$;

commit;

-- Cek: semua harus 0 kecuali admin
select 'kafe' as data, count(*) from public.cafes
union all select 'akun non-admin', count(*) from auth.users u where not exists (select 1 from public.platform_admins a where a.user_id = u.id)
union all select 'admin platform', count(*) from public.platform_admins;
*/
