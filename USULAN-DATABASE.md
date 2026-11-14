# Usulan perubahan database — dailybrew

> Dokumen ini **hanya usulan**. Tidak ada SQL yang dijalankan oleh Claude.
> Semua perubahan dijalankan manual oleh owner di Supabase SQL Editor.
> Setiap fitur UI yang bergantung pada usulan ini punya *fallback* aman: kalau perubahan belum diterapkan, bagian itu disembunyikan/nonaktif dengan keterangan.

## Status

| Langkah | Status |
|---|---|
| 0. Cek kondisi database (read-only) | ✅ 0a, 0b, 0c diterima (8 Nov) |
| 1a. Tutup celah keamanan profil — [`supabase/usulan/01-tutup-celah-profil.sql`](supabase/usulan/01-tutup-celah-profil.sql) | ✅ sudah dijalankan (8 Nov) |
| 1b. Fitur operasional — [`supabase/usulan/02-fitur-operasional.sql`](supabase/usulan/02-fitur-operasional.sql) | ✅ sudah dijalankan (8 Nov) |
| 3. Branding kafe (nama tampilan, logo, tagline, warna) — [`supabase/usulan/03-branding-kafe.sql`](supabase/usulan/03-branding-kafe.sql) | ✅ sudah dijalankan (8 Nov) |
| 4. Fase 3 owner (gradasi brand, pajak & biaya, meja, varian produk, tim, shift, log aktivitas) — [`supabase/usulan/04-owner-dashboard.sql`](supabase/usulan/04-owner-dashboard.sql) | ✅ sudah dijalankan (halaman Tim aktif) |
| 4b. Edge Function `staff-admin` (tambah/nonaktifkan staff, reset password) — [`supabase/functions/staff-admin/index.ts`](supabase/functions/staff-admin/index.ts) | ✅ terhubung (8 Nov) |
| 5. Inventori, resep & supplier — [`supabase/usulan/05-inventori-supplier.sql`](supabase/usulan/05-inventori-supplier.sql) | ✅ sudah dijalankan (dari diagnostik 8 Nov) |
| 6. Pesanan v2 & kasir (POS) (place_order, varian, diskon, pajak, cadangan stok, HABIS di app, sesi kasir, split payment, hold, refund) — [`supabase/usulan/06-pesanan-v2-pos.sql`](supabase/usulan/06-pesanan-v2-pos.sql) | ✅ sudah dijalankan (kasir dipakai) |
| 7. **Akuntansi & keuangan** (bagan akun, jurnal otomatis, beban, laporan, saldo awal, tutup periode) — [`supabase/usulan/07-akuntansi.sql`](supabase/usulan/07-akuntansi.sql) | 🟢 **siap dijalankan** · diuji 83 skenario (+ 05 & 06 diuji ulang) |
| 8. **Aplikasi customer & QR meja** (status buka/tutup, jeda, terjadwal, estimasi, QR meja, voucher, poin & member, pesan ulang, ulasan, wishlist, bantuan, notifikasi & push) — [`supabase/usulan/08-pelanggan-qr.sql`](supabase/usulan/08-pelanggan-qr.sql) | 🟢 **siap dijalankan** · diuji 93 skenario (dengan & tanpa 07) |
| 8b. Edge Function `push-send` (kirim notifikasi push) — [`supabase/functions/push-send/index.ts`](supabase/functions/push-send/index.ts) | 📝 opsional — kotak masuk notifikasi di app tetap jalan tanpa ini |
| 9. **Payment gateway — QRIS dinamis Midtrans** (tagihan QRIS, webhook terverifikasi, rekonsiliasi, refund lewat gateway) — [`supabase/usulan/09-payment-gateway.sql`](supabase/usulan/09-payment-gateway.sql) | 🟢 **siap dijalankan** · diuji 51 skenario end-to-end |
| 9b. Edge Function `payments` — [`supabase/functions/payments/index.ts`](supabase/functions/payments/index.ts) | 📝 wajib untuk QRIS online (butuh akun Midtrans) |
| 10. **Izin staff, langganan & pengetatan keamanan** — [`supabase/usulan/10-izin-langganan-keamanan.sql`](supabase/usulan/10-izin-langganan-keamanan.sql) | 🟢 **siap dijalankan** · diuji 60 skenario termasuk penyisiran isolasi lintas kafe |
| 11. **BI: prediksi penjualan, analitik pelanggan & advisor bisnis** — [`supabase/usulan/11-bi-analitik.sql`](supabase/usulan/11-bi-analitik.sql) | 🟢 **siap dijalankan** · diuji 110 skenario (dengan & tanpa 07/08/10) |
| 11b. Edge Function `advisor` (Tanya AI, Claude) — [`supabase/functions/advisor/index.ts`](supabase/functions/advisor/index.ts) | 📝 opsional — Jawaban cepat, prediksi & analitik jalan tanpa ini |
| 12. **QRIS statis kafe** (owner unggah gambar QRIS, pelanggan scan & staff konfirmasi) — [`supabase/usulan/12-qris-statis.sql`](supabase/usulan/12-qris-statis.sql) | 🟢 **siap dijalankan** · diuji 11 skenario |
| 13. **Pesan tanpa login lewat QR meja (tamu)** — [`supabase/usulan/13-tamu-qr-meja.sql`](supabase/usulan/13-tamu-qr-meja.sql) + nyalakan *Allow anonymous sign-ins* | 🟢 **siap dijalankan** · diuji 11 skenario |
| 14. **Dashboard platform, suspend kafe, tagihan & langganan otomatis** — [`supabase/usulan/14-platform-admin.sql`](supabase/usulan/14-platform-admin.sql) + Edge Function `platform-admin` & `subscription-billing` | 🟢 **siap dijalankan** · diuji 256 pemeriksaan · panduan lengkap: [`platform-admin/README.md`](platform-admin/README.md) |
| 15. **Notifikasi platform & owner, Perlu tindakan, WA manual, pengaturan & tema platform, pengecekan harian** — [`supabase/usulan/15-notifikasi-platform.sql`](supabase/usulan/15-notifikasi-platform.sql) + Edge Function `notify` | 🟢 **siap dijalankan** · diuji 169 pemeriksaan · panduan: [`platform-admin/README.md`](platform-admin/README.md) langkah 5–9 |
| 16. **Skor kesehatan kafe, progres setup, sinyal upgrade, analitik MRR, linimasa & catatan, tiket bantuan owner → admin** — [`supabase/usulan/16-kesehatan-analitik-tiket.sql`](supabase/usulan/16-kesehatan-analitik-tiket.sql) | 🟢 **siap dijalankan** (setelah 14 & 15) · diuji 195 pemeriksaan · tanpa jadwal baru · panduan: [`platform-admin/README.md`](platform-admin/README.md) langkah 9 |
| 2. Migrasi checkout v2 (dine-in/meja, catatan per item, metode bayar) | 📝 draf — dibutuhkan di fase 5 |

### File 15 — Notifikasi platform, WhatsApp manual, pengaturan & tema

Jalankan **setelah file 14**. Panduan lengkap: [`platform-admin/README.md`](platform-admin/README.md) langkah 5–9.

| Bagian | Yang berubah | Dampak ke data lama |
|---|---|---|
| Tabel baru `platform_settings` (1 baris), `platform_notifications`, `cafe_notifications`, `notification_outbox`, `platform_announcements` | RLS menyala. Notifikasi admin hanya bisa dibaca admin 2FA; notifikasi owner hanya oleh owner kafe itu; antrean email tertutup dari browser. | Tabel baru. |
| Kolom `cafes.owner_whatsapp` | Format `62…`. Diubah lewat fungsi (owner sendiri atau admin), bukan update langsung. | Kosong untuk semua kafe. |
| `pa_overview()` diganti | Isi lama tetap ada, ditambah daftar kafe tanpa harga, riwayat pendapatan 12 bulan, dan jumlah perlu tindakan. | Tidak mengubah data. |
| Trigger `pa_audit_notify` | Notifikasi otomatis saat kafe dibuat dan saat tagihan lunas atau batal. | Tidak mengubah data. |
| `pa_daily_check()` | Menggantikan jadwal harian file 14 (sudah memanggil `pa_billing_run()`). | Hanya berjalan bila dijadwalkan. |

Verifikasi: **6 baris** (5 tabel + trigger `pa_audit_notify`) dan **tidak ada** baris `tanpa_rls`.

### File 14 — Dashboard platform (admin SaaS) & langganan otomatis

Jalankan **setelah file 10** (dan 04). Panduan langkah demi langkah ada di [`platform-admin/README.md`](platform-admin/README.md).

| Bagian | Yang berubah | Dampak ke data lama |
|---|---|---|
| Tabel baru `platform_admins`, `platform_audit_logs`, `subscription_invoices`, `platform_mrr_snapshots` | RLS menyala, **tanpa** akses langsung dari browser; hanya lewat fungsi `pa_*` yang wajib admin aktif + sesi 2FA (aal2). | Tabel baru, kosong. |
| Kolom baru `cafes.suspended_at/suspended_reason`, `cafe_subscriptions.price_override`, `plans.is_archived` | Tidak diberi grant update ke owner. | Semua kosong/`false` → tidak ada kafe yang berubah. |
| Trigger `orders_block_suspended` | Kafe nonaktif tidak bisa menerima pesanan baru (semua jalur). | Tidak ada kafe nonaktif saat file dijalankan. |
| `cafe_plan()` diganti | Kini mengecek `current_period_end` + **tenggang 7 hari**, lalu turun ke Basic; kafe nonaktif → Basic. | Kafe dengan `current_period_end` kosong (kafe lama Enterprise) **tetap berlaku tanpa batas**. |
| `pa_billing_run()` + pg_cron | Tagihan otomatis H-7, tandai `past_due`. | Hanya berjalan bila dijadwalkan. |

**Cara menjalankan:** SQL Editor → tempel isi file → Run. Verifikasi: **6 baris** (5 tabel + 1 trigger) dan **tidak ada** baris `tanpa_rls`. Lalu ikuti README: admin pertama, deploy 2 Edge Function, jadwal pg_cron.

### File 13 — Pesan tanpa login lewat QR meja (tamu)

Jalankan **setelah file 08 & 12**. Pelanggan yang scan QR meja bisa memesan tanpa daftar/login: app otomatis membuat **sesi tamu** (Supabase Anonymous Sign-in). Sesi tamu tetap punya `auth.uid()`, jadi semua RLS tetap berlaku (tamu hanya melihat pesanannya sendiri).

| Bagian | Yang berubah | Dampak ke data lama |
|---|---|---|
| Trigger `orders_guest_table_only` | `before insert` pada `orders`: akun tamu **hanya** boleh membuat pesanan yang punya `table_id` (pesanan meja). | Tidak mengubah data. Pesanan staff/POS dan pelanggan login tidak terpengaruh. |

**Cara menjalankan:**
1. Jalankan `supabase/usulan/13-tamu-qr-meja.sql` di SQL Editor. Hasil verifikasi: **1 baris** `orders_guest_table_only`.
2. Supabase Dashboard → **Authentication → Sign In / Providers** → nyalakan **Allow anonymous sign-ins** → Save.
3. (Disarankan) **Authentication → Rate Limits**: naikkan batas *anonymous sign-ins* (bawaan ±30/jam per IP) bila banyak pelanggan memakai Wi-Fi kafe yang sama.

Tanpa langkah 2, app menampilkan "Pesan tanpa login belum diaktifkan kafe" dan pelanggan tetap bisa masuk/daftar seperti biasa.

### File 11 — BI: prediksi penjualan, analitik pelanggan & advisor bisnis

Jalankan **setelah file 06** (07, 08, 10 opsional; bagian yang membutuhkannya dilewati otomatis). Bila file 10 dijalankan **setelah** 11, jalankan ulang file 11 agar paket Pro/Enterprise mendapat fitur AI. **Dampak ke data yang sudah ada:**

| Bagian | Yang berubah | Dampak ke data lama |
|---|---|---|
| Fungsi analitik | `bi_sales_forecast`, `bi_product_demand`, `bi_customer_analytics`, `bi_advisor_facts` (+ fungsi internal `bi_*`) | **Hanya membaca.** Tidak ada data yang diubah atau dihapus. Hanya owner kafe itu yang bisa memanggil (dicek di database). |
| Tabel baru | `ai_advisor_logs` (riwayat pertanyaan AI) | Kosong. RLS: hanya owner kafe itu yang bisa membaca; tidak ada yang bisa menulis langsung (lewat fungsi `bi_advisor_log`). |
| Paket (bila file 10 ada) | Fitur `ai_advisor` + batas `ai_daily` di `plans` | Pro 30 & Enterprise 100 pertanyaan AI/hari. Basic tanpa AI. Kafe lama (Enterprise) otomatis dapat. Prediksi & analitik tersedia di semua paket. |
| Index | `orders (cafe_id, created_at)` | Hanya mempercepat. |

**Cara menjalankan:**
1. SQL Editor → tempel **seluruh isi** `supabase/usulan/11-bi-analitik.sql` → **Run**.
2. Verifikasi harus **7 baris** (1 `table`, 6 `function`).
3. Error merah = tidak ada yang berubah. Aman dijalankan ulang.

**Tanya AI (opsional) — Edge Function `advisor`:**
1. Buat API key di console.anthropic.com (penagihan per pemakaian).
2. Dashboard → Edge Functions → Deploy new function → Via Editor, nama **`advisor`**, tempel `supabase/functions/advisor/index.ts`, Deploy. **Verify JWT: ON.**
3. Edge Functions → Secrets: `ANTHROPIC_API_KEY`. Opsional `ADVISOR_MODEL` (bawaan `claude-opus-5-5`).
4. Yang dikirim ke AI hanya angka ringkasan kafe (tanpa nama/kontak pelanggan). Tanpa langkah ini, tombol Tanya AI memberi pesan "belum diaktifkan"; Jawaban cepat tetap jalan.

**Uji ulang lokal:** `cd supabase/tests && npm test` (05–11).

### File 10 — izin staff, langganan & pengetatan keamanan

Jalankan **setelah file 06** (07/08/09 opsional; bagian yang membutuhkan tabelnya dilewati otomatis). Bila nanti menjalankan 08/09 **setelah** 10, jalankan ulang file 10 agar gerbang fiturnya ikut terpasang. **Dampak ke data yang sudah ada:**

| Bagian | Yang berubah | Dampak ke data lama |
|---|---|---|
| `profiles` | Kolom `staff_permissions` | Kosong = **semua izin** (perilaku sekarang). Staff tidak bisa mengubahnya sendiri (hak kolom dari file 01). |
| Trigger izin | `orders`, `payments`, `refunds`, `cash_movements`, `products`, `support_messages`, `cafe_settings` | Hanya membatasi **staff** yang izinnya dicabut owner. Owner, customer, dan proses server tidak terpengaruh. |
| Langganan | Tabel `plans` (Basic, Pro, Enterprise) & `cafe_subscriptions` | **Semua kafe yang ada = Enterprise aktif** (semua fitur, tanpa batas) → tidak ada yang terkunci. Kafe baru = Pro masa coba 30 hari. |
| Batas & gerbang fitur | Trigger: jumlah staff aktif, meja, menu; inventori, keuangan, loyalti, QR meja, QRIS online | Hanya berlaku untuk paket yang punya batas (Basic/Pro). Enterprise tidak dibatasi. |
| Hak akses | RLS dinyalakan di `categories` & `order_status_events` (policy setara sekarang); hak INSERT/UPDATE/DELETE **anon** dicabut; TRUNCATE/REFERENCES/TRIGGER dicabut dari pengguna; default untuk tabel baru ikut | Aplikasi tidak pernah menulis tanpa login, jadi tidak ada fitur yang berubah. Menutup celah: tabel tanpa RLS bisa diubah siapa saja. |
| Index | Riwayat pesanan customer, item pesanan, menu, kategori, profil per kafe | Hanya mempercepat. |
| Pembayaran | Fungsi `pay_intent_cafe` (bila file 09 ada) | Edge Function `payments` bisa memakai kunci Midtrans per kafe. |

**Cara menjalankan:**
1. SQL Editor → tempel **seluruh isi** `supabase/usulan/10-izin-langganan-keamanan.sql` → **Run**.
2. Verifikasi harus **8 baris** (2 `table`, 6 `function`) dan **tidak boleh ada baris `tanpa_rls`**. Bila ada, kirim hasilnya ke saya.
3. Error merah = tidak ada yang berubah. Aman dijalankan ulang.

**Setelah dijalankan:**
- Owner → **Tim** → menu ⋯ staff → **Atur izin** (preset Semua / Kasir / Barista).
- Owner → **Pengaturan → Langganan**: paket, fitur, pemakaian vs batas.
- Pengelola platform mengubah paket lewat SQL Editor: `select subscription_set('<cafe_id>', 'pro', 'active', now() + interval '30 days');`
- Banyak kafe dengan akun Midtrans masing-masing: Secrets Edge Function `MIDTRANS_SERVER_KEY_<ID KAFE TANPA TANDA ->` (tanpa itu memakai `MIDTRANS_SERVER_KEY`). Deploy ulang Edge Function `payments` dari file terbaru.

**Uji ulang lokal:** `cd supabase/tests && npm test` (05–10).

### File 09 — payment gateway (QRIS dinamis Midtrans)

Jalankan **setelah file 06** (07/08 tidak wajib). **Dampak ke data yang sudah ada:**

| Bagian | Yang berubah | Dampak ke data lama |
|---|---|---|
| `cafe_settings` | 3 kolom: gateway aktif, provider (`midtrans`), masa berlaku QR | Gateway **NONAKTIF** sampai owner menyalakan di Pengaturan → Pembayaran. |
| 3 tabel baru | `payment_intents` (tagihan QRIS per percobaan bayar), `payment_events` (log notifikasi, anti-dobel), `payment_refunds` (refund lewat gateway) | Kosong. |
| Fungsi `pay_*` | Hanya bisa dipanggil server (`service_role` = Edge Function), tidak bisa dari aplikasi | — |
| Realtime | `payment_intents` ditambahkan ke publikasi | Layar bayar berubah otomatis saat lunas. |

Pesanan & pembayaran lama tidak diubah. Tunai, QRIS manual kasir, dan transfer tetap berjalan seperti sekarang; QRIS demo di app tetap demo (tidak pernah melunasi).

**Keamanan:**
- **Lunas hanya dari gateway.** Webhook diverifikasi dengan tanda tangan SHA512 (`order_id + status_code + gross_amount + ServerKey`), lalu status **diambil ulang dari API Midtrans**. Webhook palsu, atau tanda tangan valid tapi status asli masih pending, tidak melunasi pesanan (diuji).
- **Nominal dari server:** tagihan = total pesanan − yang sudah dibayar, dihitung database.
- **Anti-dobel:** notifikasi ganda/terlambat diproses sekali; status setelah lunas diabaikan; satu tagihan aktif per pesanan.
- **Bayar ganda** (QRIS masuk padahal pesanan sudah lunas/dibatalkan): tidak dicatat dobel, ditandai **Perlu ditinjau** di halaman Pembayaran online.
- **Kunci Midtrans** hanya di Secrets Edge Function, tidak pernah di database atau aplikasi.

**Cara menjalankan:**
1. SQL Editor → tempel **seluruh isi** `supabase/usulan/09-payment-gateway.sql` → **Run**. Verifikasi harus **10 baris** (3 `table`, 7 `function`).
2. Edge Functions → Deploy a new function → Via Editor → nama **`payments`** → tempel `supabase/functions/payments/index.ts` → Deploy. **Verify JWT: OFF** (fungsi memeriksa token sendiri; webhook Midtrans datang tanpa token).
3. Edge Functions → Secrets: `MIDTRANS_SERVER_KEY` (Server Key dari Midtrans Dashboard → Settings → Access Keys) dan `MIDTRANS_ENV` = `sandbox` (uji) atau `production`.
4. Midtrans Dashboard → Settings → Payment → **Notification URL**: `https://<project>.supabase.co/functions/v1/payments?webhook=midtrans` (URL lengkap bisa disalin dari web owner → Pengaturan → Pembayaran).
5. Web owner → **Pengaturan → Pembayaran** → nyalakan, tekan **Tes koneksi**.
6. Uji sandbox: pesan dari app → **QRIS · bayar sekarang** → bayar dengan simulator QRIS Midtrans sandbox → pesanan berubah lunas sendiri, muncul di **Pembayaran online** & jurnal (bila 07 aktif).

**Catatan:** refund QRIS harus diaktifkan Midtrans untuk akunmu (hubungi support Midtrans bila refund ditolak); batas waktu refund mengikuti acquirer (GoPay QRIS ±45 hari). Biaya MDR gateway belum dijurnal otomatis — catat lewat jurnal manual saat dana cair ke bank.

**Uji ulang lokal:** `cd supabase/tests && npm test` (05–09).

### File 08 — aplikasi customer & QR meja

Jalankan **setelah file 06** (file 07 tidak wajib; urutan 07 → 08 juga aman). **Dampak ke data yang sudah ada:**

| Bagian | Yang berubah | Dampak ke data lama |
|---|---|---|
| `cafe_settings` | 12 kolom: jeda pesanan + pesan, pesanan terjadwal, estimasi waktu siap, QR meja aktif, aturan poin & tingkat member | Nilai bawaan. **Loyalti & pesanan terjadwal NONAKTIF** sampai owner menyalakan. |
| `cafe_tables` | Kolom `qr_token` (token acak 32 karakter, unik) | Semua meja lama otomatis mendapat token. Kolom ini **tidak bisa dibaca lewat API publik** (hak baca per kolom) — hanya owner lewat fungsi, jadi QR tidak bisa ditebak. Kolom meja lain tetap terbaca seperti sekarang. |
| `orders` | 8 kolom: jadwal ambil, perkiraan siap, siapa yang membatalkan, voucher & poin yang dipakai | Kosong/0 untuk pesanan lama. Total lama tidak diubah. |
| `create_order` (app versi lama) | Kini lewat `customer_place_order` | **Menolak pesanan saat kafe tutup atau dijeda.** Bila jam buka belum diatur, kafe dianggap selalu buka (perilaku lama). |
| 10 tabel baru | voucher & pemakaiannya, akun & riwayat poin, ulasan, wishlist, tiket & pesan bantuan, notifikasi, token push | Kosong. |
| Trigger baru (AFTER) | `orders` (poin saat selesai; voucher & poin dikembalikan saat batal; notifikasi status), `refunds` (poin dikurangi saat refund disetujui), `support_messages` (notifikasi balasan) | Hanya berlaku untuk perubahan berikutnya. Tidak mengubah total pesanan. |
| Realtime | `notifications`, `support_messages` ditambahkan ke publikasi realtime | — |

**Keamanan:** QR kafe lain ditolak (server mencocokkan token dengan kafe); voucher, poin, harga, dan jadwal dihitung & dicek ulang di database (bukan di aplikasi); kunci anti-dobel mencegah pesanan/voucher/poin terpakai dua kali saat koneksi buruk; poin hanya diubah lewat fungsi (riwayat tidak bisa diedit); nama pengulas disingkat ("Rani P."); customer hanya melihat tiket, poin, notifikasi, dan wishlist miliknya.

**Cara menjalankan:**
1. SQL Editor → tempel **seluruh isi** `supabase/usulan/08-pelanggan-qr.sql` → **Run**.
2. Verifikasi harus **32 baris**: 10 `table`, 16 `function`, 6 `trigger`.
3. Error merah = tidak ada yang berubah. Aman dijalankan ulang.

**Setelah dijalankan (owner):**
1. **Pengaturan → Operasional**: pastikan jam buka benar (app menolak pesanan di luar jam buka).
2. **Pengaturan → Pesanan app**: nyalakan pesanan terjadwal bila mau, atur estimasi waktu siap.
3. **Pengaturan → Meja**: isi `VITE_CUSTOMER_APP_URL` (alamat app customer versi web) di `web-dashboard/.env.local`, lalu **Cetak semua QR** dan tempel di meja.
4. **Pelanggan → Loyalti & voucher**: nyalakan program poin, atur tingkat member, buat voucher.

**Lupa password (app):** Supabase Dashboard → Authentication → URL Configuration → *Redirect URLs* → tambahkan `mobilecustomer://reset-password` dan `<alamat app web>/reset-password`.

**Notifikasi push (opsional, butuh build EAS):**
1. Edge Functions → Deploy a new function → Via Editor → nama `push-send` → tempel `supabase/functions/push-send/index.ts` → Deploy (Verify JWT: **OFF**).
2. Edge Functions → Secrets → tambah `PUSH_WEBHOOK_SECRET` (teks acak panjang).
3. Database → Webhooks → Create: tabel `notifications`, event **Insert**, tipe HTTP Request POST ke URL fungsi `push-send`, header `x-push-secret: <secret yang sama>`.
4. App: isi `extra.eas.projectId` di `app.json` (dari `eas init`), lalu build ulang dengan EAS. Tanpa langkah ini notifikasi tetap tampil di kotak masuk app (ikon lonceng), hanya tidak muncul sebagai push.

**Uji ulang lokal:** `cd supabase/tests && npm test` (05 + 06 + 07 + 08).

### File 07 — akuntansi & keuangan

Jalankan **setelah** file 06 (file 07 menolak jalan bila 06 belum ada). **Dampak ke data yang sudah ada:**

| Bagian | Yang berubah | Dampak ke data lama |
|---|---|---|
| 6 tabel baru | `accounts` (bagan akun), `accounting_periods`, `journal_entries`, `journal_lines`, `expenses` (beban), `acc_sync_issues` | Kosong. **Tidak ada jurnal yang dibuat** sampai owner menekan *Mulai pembukuan* (tanggal go-live + saldo awal). Transaksi sebelum go-live tidak pernah dijurnal. |
| `cafe_settings` | Kolom `accounting_go_live` | Kosong (= pembukuan belum dimulai). |
| `stock_movements` | Kolom `funding` (stok masuk dibayar dari kas/bank/QRIS/utang) | Kosong untuk data lama. |
| `cash_movements` | Kolom `purpose` (tujuan kas masuk/keluar kasir) | Data lama = `other`. |
| 6 trigger baru (AFTER) | `orders`, `payments`, `stock_movements`, `supplier_payments`, `cash_movements`, `cashier_sessions` → jurnal otomatis | Hanya aktif setelah go-live. **Tidak pernah memblokir transaksi**: bila jurnal gagal (mis. periode ditutup), transaksi tetap tersimpan dan kejadiannya dicatat di `acc_sync_issues`. |
| `inventory_stock_in` | Parameter baru `p_funding` (bawaan `cash`) | Pemanggilan lama tetap jalan. |
| `cashier_cash_move` | Parameter baru `p_purpose` (bawaan `other`) | Pemanggilan lama tetap jalan. |
| `inv_next_document_number` | Nomor dokumen tidak terpotong setelah 9999 per tahun | Nomor yang sudah ada tidak berubah. |
| `log_audit_event` | Label untuk akun, periode, beban | Log lama tidak berubah. |
| Storage | Bucket privat `expense-receipts` (foto/PDF nota, maks. 5 MB) | Baru; hanya owner kafe itu yang bisa unggah/lihat. |

**Keamanan & integritas:** semua data keuangan hanya untuk owner (RLS + cek di setiap fungsi); jurnal wajib seimbang (dicek fungsi + constraint trigger), tidak bisa diubah/dihapus (koreksi = jurnal pembalik), satu kejadian hanya satu jurnal (unik di DB, anti-dobel); periode tertutup menolak jurnal baru; laporan dihitung di database, bukan di browser.

**Cara menjalankan:**
1. SQL Editor → tempel **seluruh isi** `supabase/usulan/07-akuntansi.sql` → **Run**.
2. Verifikasi harus **26 baris**: 6 `table`, 14 `function`, 6 `trigger` (`zz_acc_*`).
3. Error merah = tidak ada yang berubah. Aman dijalankan ulang.

**Setelah dijalankan:**
1. Web owner → **Keuangan** → isi tanggal mulai (paling mudah: hari ini atau tanggal 1 bulan ini) dan saldo awal. Persediaan, piutang, dan utang supplier diberi saran dari data. Selisihnya otomatis menjadi *Ekuitas saldo awal*.
2. Tekan **Mulai pembukuan**. Transaksi sejak tanggal itu langsung dijurnal (termasuk yang sudah terjadi sejak tanggal itu).
3. Catat sewa, listrik, gaji, dll. di **Beban**. Pencairan QRIS ke bank dicatat lewat **Keuangan → Jurnal → Jurnal manual**.
4. Kasir: kas masuk/keluar kini punya pilihan *Tujuan* (belanja, setor ke bank, diambil owner, …) agar jurnalnya tepat. Stok masuk punya pilihan *Dibayar dari*.

**Uji ulang lokal:** `cd supabase/tests && npm test` (05 + 06 + 07).

### File 06 — pesanan v2 & kasir (POS)

Dirancang dari hasil `diagnostik-fase2.sql` (skema live persis). **Dampak ke data yang sudah ada:**

| Bagian | Yang berubah | Dampak ke data lama |
|---|---|---|
| `orders` | 19 kolom baru (sumber, jenis & meja, rincian subtotal/diskon/service/pajak/pembulatan, tamu walk-in, kunci anti-dobel, dibayar/direfund, sesi kasir, versi harga) | Nilai bawaan saja. **Satu pengisian:** `paid_amount = total_amount` untuk pesanan yang sudah lunas. Total, status, nomor pesanan lama tidak berubah. |
| `payments` | Kolom baru: referensi, pencatat, sesi kasir, verifikasi, uang diterima, kembalian, refund | Pembayaran simulasi lama ditandai `verification = 'demo'`. Nominal tidak berubah. |
| Trigger `trg_update_order_total` | Pesanan **baru** (versi 2) tidak ditimpa sehingga pajak/diskon aman | Pesanan lama tetap dihitung seperti sekarang (diuji). |
| `create_order` (dipakai app) | Kini memanggil `place_order` | App lama tetap jalan tanpa build ulang. Nomor pesanan memakai UUID bawaan — **memperbaiki bentrok** `order_number` antar kafe. Varian wajib terisi pilihan bawaan. Bila pajak/service aktif, pesanan app ikut kena. |
| `staff_mark_order_paid` | Melunasi **sisa** tagihan, mencatat pencatat & sesi kasir | Papan staff tetap sama. |
| `ingredients` | Kolom `reserved` (stok dipesan) | 0. Cadangan hanya dibuat bila pelacakan stok aktif. |
| 6 tabel baru | sesi kasir, kas masuk/keluar, varian per item pesanan, cadangan stok, pesanan ditahan, refund | Kosong. |

**Keamanan:** pesanan kasir hanya oleh staff/owner aktif kafe itu; diskon staff dibatasi pengaturan (bawaan 0%); tunai wajib sesi kasir terbuka; refund staff menunggu owner; sesi kasir hanya terlihat oleh pembukanya, penerima serah terima, dan owner; jumlah porsi stok tidak terlihat oleh customer.

**Cara menjalankan:**
1. SQL Editor → tempel **seluruh isi** `supabase/usulan/06-pesanan-v2-pos.sql` → **Run**.
2. Verifikasi harus **21 baris**: 7 `table`, 13 `function`, 1 `trigger` (`inv_on_order_cancelled`).
3. Error merah = tidak ada yang berubah. Aman dijalankan ulang.

**Setelah dijalankan:** staff membuka **Sesi kasir** → **Kasir**. Owner mengatur batas diskon staff di Pengaturan → Pajak & biaya, dan cetak otomatis di Pengaturan → Struk. Refund disetujui di **Kasir & refund**.

**Uji ulang lokal:** `cd supabase/tests && npm install && npm test`.

### File 05 — inventori, resep & supplier

**Dampak ke data yang sudah ada (semua aditif, satu transaksi):**

| Bagian | Yang berubah | Dampak ke data lama |
|---|---|---|
| `cafe_settings` | 4 kolom baru: `inventory_tracking` (default **mati**), `inventory_started_at`, `expiry_alert_days` (3), `reorder_cover_days` (7) | Tidak ada. Selama pelacakan mati, pesanan berjalan **persis** seperti sekarang. |
| `orders` | **Satu trigger baru** `AFTER UPDATE` — hanya bekerja bila pelacakan stok **aktif** dan pesanan berubah menjadi `completed` | Kolom & baris pesanan **tidak diubah**. Bila pencatatan stok gagal, pesanan **tetap selesai**; kegagalan dicatat di `inventory_sync_issues` dan muncul di dashboard. |
| `log_audit_event` | Dibuat ulang, hanya menambah label nomor PO | Log lama tidak tersentuh. |
| 13 tabel baru | supplier, bahan, batch kedaluwarsa, katalog supplier, resep, mutasi stok, opname (+baris), PO (+item), pembayaran supplier, penghitung nomor dokumen, catatan gagal sinkron | Tabel baru kosong. Tidak ada `UPDATE`/`DELETE`/`DROP` pada tabel lama. |

**Keamanan:** semua tabel baru RLS aktif, hanya **owner kafe itu** yang bisa membaca (staff & customer tidak melihat harga modal, supplier, atau stok). Saldo stok, harga rata-rata, PO, pembayaran, resep, dan opname hanya bisa diubah lewat fungsi database yang memeriksa owner; mutasi stok tidak bisa diubah (koreksi = mutasi baru).

**Cara menjalankan:**
1. Pastikan file 04 sudah jalan (sudah ✅). File 05 berhenti sendiri dengan pesan jelas bila prasyarat atau kolom pesanan yang dibutuhkan tidak ada.
2. SQL Editor → New query → tempel **seluruh isi** `supabase/usulan/05-inventori-supplier.sql` → **Run**.
3. Hasil verifikasi harus **26 baris**: 13 `table`, 12 `function`, 1 `trigger` (`inv_on_order_completed`).
4. Error merah = tidak ada yang berubah. Kirim pesan error-nya.
5. Aman dijalankan ulang (idempoten).

**Setelah dijalankan (urutan yang disarankan):** Supplier → Stok bahan (isi bahan + stok awal) → Resep & HPP (isi resep) → baru **Aktifkan pelacakan** di tab Bahan. Sebelum diaktifkan, stok tidak berkurang dari pesanan.

**Belum termasuk (Fase 2 · POS):** stok dipesan (*reserve*) saat pesanan dibuat, checkout ditolak bila bahan kurang, dan label HABIS otomatis di app customer. Di fase ini stok dipotong saat pesanan **selesai** dan boleh minus (tanda perlu opname) agar pesanan tidak pernah tertahan.

**Uji ulang lokal (tanpa database live):** `cd supabase/tests && npm install && npm test`.

### Cara menjalankan file 04 (fase 3 owner)

1. Supabase Dashboard → **SQL Editor** → New query → copy **seluruh isi** `supabase/usulan/04-owner-dashboard.sql` → **Run**.
2. Hasil verifikasi harus **11 baris**: 6 `table` (audit_logs, cafe_settings, cafe_tables, product_option_groups, product_options, staff_shifts), 3 `column` (cafes.brand_color_2, profiles.is_active, profiles.job_title), 2 `function`.
3. Error merah = tidak ada yang berubah (satu transaksi). Kirim pesan error-nya.

Isi file 04 (semua aditif):
- Kolom baru: `cafes.brand_color_2` (gradasi), `profiles.is_active` (default **true** — staff lama tetap aktif), `profiles.job_title`.
- Tabel baru: pengaturan bisnis (1 baris default per kafe, **pajak & service charge nonaktif**), meja, varian produk, shift, log aktivitas.
- `is_cafe_member` diperbarui: staff yang dinonaktifkan langsung kehilangan akses. `cafe_team_members` dibuat ulang (kolom bertambah: jabatan, status, email untuk owner).
- Trigger log aktivitas di tabel katalog/pengaturan/meja/shift dan perubahan peran/status staff (perubahan nama customer **tidak** dicatat).

### Cara deploy Edge Function `staff-admin` (setelah file 04)

Fungsi ini memegang kunci service-role di server, jadi tombol **Tambah staff / Nonaktifkan / Reset password** aman dari browser.

1. Supabase Dashboard → **Edge Functions** → **Deploy a new function** → **Via Editor**.
2. Nama fungsi: `staff-admin` (harus persis).
3. Hapus contoh kode, tempel **seluruh isi** `supabase/functions/staff-admin/index.ts`, klik **Deploy**.
4. **Matikan Verify JWT** (Details/Settings fungsi → *Enforce JWT verification* OFF). Project ini memakai kunci API baru (publishable/secret); bila menyala, gateway menolak dengan "Invalid JWT". Aman: fungsi sendiri memeriksa token dan peran owner. Tidak perlu menambah secret — kunci server disediakan otomatis (lama atau baru, keduanya didukung).
5. Uji: web owner → **Tim → Tambah staff** dengan email uji milikmu.

**Bila muncul pesan error di web:**
- *"tidak ditemukan (404)"* → fungsi belum ada atau namanya bukan persis `staff-admin`.
- *"tidak bisa dihubungi"* → cek nama fungsi, Verify JWT OFF, dan tab **Logs** (error saat start).
- *"menolak token (401 Invalid JWT)"* → Verify JWT masih menyala.

### Cara menjalankan file 03 (branding)

1. Supabase Dashboard → **SQL Editor** → New query.
2. Copy **seluruh isi** `supabase/usulan/03-branding-kafe.sql`, paste, **Run**.
3. Hasil verifikasi harus **9 baris**: 4 `column` (app_name, brand_color, logo_url, tagline), 1 `bucket` (cafe-assets), dan 4 `policy` (…cafe assets).
4. Kalau ada error merah, **tidak ada yang berubah** — kirim pesan error-nya.
5. Muat ulang web owner (Ctrl+Shift+R) → **Pengaturan → Brand & tampilan** aktif.

Isi file 03: hanya menambah 4 kolom kosong di `cafes`, membuat bucket `cafe-assets` (logo, maks 2 MB, PNG/JPG/WebP), dan policy: semua orang boleh melihat logo, hanya owner kafe itu yang boleh unggah/hapus di folder kafenya. Tidak ada data lama yang diubah.

### Cara menjalankan (file 01 & 02 — sudah selesai)

1. Supabase Dashboard → **SQL Editor** → New query.
2. Buka file `01-tutup-celah-profil.sql`, copy **seluruh isinya**, paste, **Run**. Hasil di bawah harus 2 baris: `full_name`, `phone`.
3. New query lagi → copy seluruh isi `02-fitur-operasional.sql` → **Run**. Hasil harus 7 fungsi + 7 kolom.
4. Kalau ada error merah, **tidak ada yang berubah** (semua dalam satu transaksi) — kirim pesan error-nya.
5. Muat ulang web owner/staff (Ctrl+Shift+R). Tombol "Lunas" & "Batalkan" otomatis muncul, nomor antrean berubah ke `A-001`.

> Database hanya satu (produksi), jadi uji alur dengan **pesanan uji baru** (mis. akun customer milikmu), bukan pesanan customer sungguhan.

---

## Temuan: skema live ≠ file migrasi

Skema yang dikirim owner (8 Nov 2026) berbeda dari `supabase/migrations/`:

| Hal | Di migrasi | Di database live | Dampak ke UI |
|---|---|---|---|
| `orders.order_number` | `bigint` berurutan | `text`, default `gen_random_uuid()` | Nomor tampil `#95449854819529334` → butuh nomor antrean (usulan C) |
| `orders.status` | tidak ada | ada **dan** `order_status` ada | App memakai `order_status`; perlu dipastikan apakah ada trigger yang menyinkronkan keduanya |
| `payments` | `payment_method`, `payment_status` | + `method`, `status`, `paid_at` (CHECK: cash/qris/bank_transfer/ewallet) | `paid_at` sudah ada ✅ |
| `categories.sort_order` | tidak ada | **ada** ✅ | Drag-and-drop urutan kategori bisa langsung tanpa migrasi |
| `order_items.notes` | tidak ada | **ada** ✅ | Catatan/kustomisasi per item bisa dipakai |
| `profiles.phone` | tidak ada | **ada** ✅ (tapi belum ada izin update) | Usulan H |
| `profiles.email` | ada | **tidak ada** | Email customer hanya dari sesi login |
| `cafes` | slug, description, logo_url | address, phone, is_active | Info kafe: alamat & telepon sudah ada ✅ |
| `orders.updated_at` | tidak ada | ada | Bisa dipakai sebagai waktu perubahan terakhir |
| Tipe enum `app_role` | ada | kemungkinan tidak ada (lihat migrasi `20261108000200`) | SQL usulan tidak akan bergantung pada enum/`has_cafe_role` |

---

## Langkah 0 — cek kondisi database (AMAN, read-only)

Kedua query hanya **membaca**. Jalankan satu per satu di SQL Editor, lalu kirim hasilnya (bisa *Export → CSV* atau copy tabelnya).

### Query 0a — fungsi, trigger, policy, grant, realtime

```sql
-- READ-ONLY: hanya membaca katalog sistem Postgres.
select 'function' as kind, p.proname as name, pg_get_function_identity_arguments(p.oid) as detail
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
union all
select 'trigger', t.tgname, c.relname || ' -> ' || pr.proname
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
join pg_proc pr on pr.oid = t.tgfoid
where n.nspname = 'public' and not t.tgisinternal
union all
select 'policy', policyname, schemaname || '.' || tablename || ' | ' || cmd || ' | ' || array_to_string(roles, ',')
from pg_policies
where schemaname in ('public', 'storage')
union all
select 'table_grant', table_name, grantee || ' | ' || string_agg(privilege_type, ',' order by privilege_type)
from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon', 'authenticated')
group by table_name, grantee
union all
select 'column_update_grant', cp.table_name || '.' || cp.column_name, cp.grantee
from information_schema.column_privileges cp
where cp.table_schema = 'public'
  and cp.grantee in ('anon', 'authenticated')
  and cp.privilege_type = 'UPDATE'
  and not exists (
    select 1 from information_schema.role_table_grants tg
    where tg.table_schema = 'public' and tg.table_name = cp.table_name
      and tg.grantee = cp.grantee and tg.privilege_type = 'UPDATE'
  )
union all
select 'realtime', tablename, pubname
from pg_publication_tables
where pubname = 'supabase_realtime'
union all
select 'enum_type', t.typname, ''
from pg_type t
join pg_namespace n on n.oid = t.typnamespace
where n.nspname = 'public' and t.typtype = 'e'
order by 1, 2;
```

### Query 0b — bentuk data pesanan (tanpa data pribadi)

```sql
-- READ-ONLY: 10 pesanan terakhir, tanpa nama/HP/email.
select order_number, status, order_status, payment_status, payment_method,
       total_amount, created_at, updated_at
from public.orders
order by created_at desc
limit 10;
```

### Hasil 0a & 0b (8 Nov 2026)

- **Tidak ada fungsi `has_cafe_role`** di schema public, padahal migrasi memakainya → policy live ditulis berbeda dari file migrasi. SQL final akan mandiri (cek role langsung ke `profiles`).
- **Ada 2 versi `create_order`**: `(p_items jsonb)` versi lama dan `(p_cafe_id, p_items, p_payment_method, p_notes)` yang dipakai app.
- Trigger aktif: `enforce_order_status_workflow` (orders), `set_order_item_snapshot_fields` & `trg_update_order_total` (order_items). Tidak ada trigger yang mengisi `updated_at` atau menyinkronkan kolom `status` → **kolom `status` basi** (mis. `pending` padahal `order_status = completed`). App hanya memakai `order_status`.
- Klien hanya boleh update `orders.order_status` → "Tandai lunas" & "Batalkan" memang butuh RPC.
- Policy profil: hanya `Users read own profile` & `Users update own profile` → owner tidak bisa membaca nama customer.
- `Public read products` → kemungkinan customer sudah bisa membaca produk habis (perlu dicek di 0c; kalau ya, usulan G tidak diperlukan).
- **Bukti bug zona waktu:** pesanan `…334` dibuat `2026-11-07 21:53 UTC` = **8 Nov 04:53 WIB**. Dashboard memakai tanggal UTC, jadi pesanan itu masuk ke 7 Nov dan rentang "7 hari" berhenti di 7 Nov.
- Pesanan Rp 1 (`d9b5…`, `23be…`) tanpa metode bayar — data uji, dibiarkan; UI menanganinya.

### ⚠️ Perlu dicek: grant tabel sangat lebar

`anon` & `authenticated` punya `INSERT, UPDATE, DELETE` penuh pada `cafes`, `categories`, `products`, `profiles` (ini default Supabase). Aman **hanya jika RLS aktif** dan policy-nya ketat. Yang paling berisiko: policy `Users update own profile` + grant UPDATE semua kolom → bila policy tidak membatasi kolom, customer bisa mengubah `role`/`cafe_id` miliknya sendiri menjadi owner kafe mana pun. Query 0c memastikan ini.

### Query 0c — status RLS, isi policy, definisi fungsi & trigger (AMAN, read-only)

```sql
-- READ-ONLY: membaca katalog sistem Postgres.
select 'rls' as kind, c.relname as name,
       case when c.relrowsecurity then 'ON' else 'OFF' end
       || case when c.relforcerowsecurity then ' (force)' else '' end as detail
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
union all
select 'policy', tablename || '.' || policyname,
       cmd || ' | using: ' || coalesce(qual, '-') || ' | check: ' || coalesce(with_check, '-')
from pg_policies
where schemaname = 'public'
union all
select 'trigger_def', t.tgname, pg_get_triggerdef(t.oid)
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and not t.tgisinternal
union all
select 'function_def', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
       case when p.prosecdef then 'SECURITY DEFINER' else 'SECURITY INVOKER' end
       || chr(10) || pg_get_functiondef(p.oid)
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'enforce_order_status_workflow', 'staff_order_customer_names', 'update_order_total',
    'handle_new_user', 'create_order', 'set_order_item_snapshot_fields'
  )
order by 1, 2;
```

---

## Langkah 1 — isi migrasi (SQL final ada di `supabase/usulan/`)

| # | Perubahan | Untuk fitur | Fallback UI sebelum diterapkan |
|---|---|---|---|
| A | RPC `staff_mark_order_paid(order_id, method)` — `security definer`, cek pemanggil owner/staff kafe itu lewat `profiles`; insert `payments` (`status/payment_status = 'paid'`, `paid_at = now()`), update `orders.payment_status = 'paid'` + `payment_method`. Tambah kolom `orders.paid_at`. | Tombol **Tandai lunas** (staff & owner), pendapatan dashboard | Tombol nonaktif: "Perlu pembaruan database". Dashboard menampilkan *Nilai pesanan selesai (belum tercatat lunas)* terpisah dari *Pendapatan lunas*. |
| B | Izinkan transisi ke `cancelled` dari `pending/confirmed/preparing/ready` + RPC `staff_cancel_order(order_id, reason)`; kolom `orders.cancel_reason`, `orders.cancelled_at`. | Tombol **Batalkan** dengan alasan | Tombol batal disembunyikan. |
| C | Kolom `orders.queue_number int` + trigger `before insert` (urutan per kafe per hari WIB) + isi kolom baru untuk pesanan lama (hanya mengisi kolom baru, data lama tidak diubah). | Nomor antrean **A-012** di 3 aplikasi | `#9334` = 4 digit terakhir `order_number` (deterministik, sama di 3 aplikasi). |
| D | Tabel `order_status_events (order_id, status, changed_by, created_at)` + trigger `after update of order_status`; RLS: owner/staff kafe & customer pemilik pesanan boleh baca. | Timeline status & "diproses oleh" di detail transaksi; estimasi di customer | Timeline hanya menampilkan waktu dibuat & status sekarang. |
| E | ~~RPC nama customer untuk owner~~ — **tidak perlu**: `staff_order_customer_names` live sudah mengizinkan owner. Sudah dipakai di frontend. | Kolom Customer di Transaksi owner | — |
| F | RPC `staff_set_product_availability(product_id, is_available)` — hanya kolom `is_available`. | Toggle cepat **Produk habis** di staff | Toggle disembunyikan untuk staff. |
| G | ~~Policy baca produk habis~~ — **tidak perlu**: policy live `Public read products` sudah `using (true)`. | Produk **Habis** tampil abu-abu di menu | — |
| H | `grant update (full_name, phone)` + policy dengan `with check` — **masuk file 01**. | Edit nomor HP di profil | Field HP disembunyikan. |
| I | `cafes.opening_hours jsonb`, `cafes.description text`. | Jam buka, status Buka/Tutup, halaman Pengaturan | Bagian jam buka disembunyikan. |

## Langkah 2 — checkout v2 (draf, untuk fase 5)

| # | Perubahan | Untuk fitur |
|---|---|---|
| J | Kolom `orders.order_type` (`dine_in`/`takeaway`), `orders.table_number`. | Pilihan dine-in + nomor meja di checkout; tampil di kartu staff |
| K | Fungsi **baru** `create_order_v2(...)` (fungsi lama tetap ada): menerima catatan per item (`order_items.notes`), `order_type`, `table_number`, metode `cash/qris/bank_transfer/ewallet`. | Kustomisasi tanpa biaya (gula, es) sebagai catatan item; metode bayar lebih lengkap |
| L | *(Ditunda)* Varian berbayar (ukuran S/M/L) butuh tabel opsi produk + harga tambahan di `create_order_v2`. | Opsi varian dengan harga berbeda |
| M | *(Ditunda, bukan SQL)* Undang/nonaktifkan akun staff dari halaman Pengaturan butuh **Edge Function** dengan service-role (membuat user di Auth + `profiles.role = 'staff'`, `cafe_id`). Tidak bisa dari browser dengan aman. | Tombol "Undang staff" di Pengaturan → Tim kafe. Saat ini Pengaturan hanya menampilkan daftar tim + catatan bahwa akun dibuat administrator. |

**Varian produk (Fase 3):** form produk owner belum punya pilihan varian karena skema belum mendukung. Kustomisasi gratis (gula, es) cukup lewat catatan item (`order_items.notes`, sudah ada) di fase 5; varian berbayar menunggu usulan L.
