# Rencana upgrade: Cafe Management System (dailybrew → white-label SaaS)

> Fase 1 (audit dan arsitektur), 8 Nov 2026. Belum ada kode atau database yang diubah.
> Semua perubahan database tetap berupa file SQL di `supabase/usulan/`. Owner menjalankannya sendiri di SQL Editor (lihat `USULAN-DATABASE.md`).

---

## 0. Roadmap V2 (audit V2 disetujui 8 Nov 2026)

Brief V2 mengurutkan keuangan lebih dulu, tetapi HPP, profit produk, rekonsiliasi kas, dan refund bergantung pada resep dan POS. Urutan yang disetujui:

| Langkah | Isi | Bagian brief V2 | Status |
|---|---|---|---|
| 0b | Fondasi: file 04 + `staff-admin`, skema live (diagnostik), perubahan belum commit | 8 | ✅ |
| 1 | Inventori & supplier: bahan, batch kedaluwarsa, resep (+varian), HPP & profit produk, supplier & katalog harga, PO → terima → bayar (utang), opname, mutasi + ekspor, perkiraan & draf PO otomatis, pemotongan stok saat pesanan selesai | 2, 1C | ✅ file 05 dijalankan |
| 2 | Pesanan v2 & POS: `place_order` (idempoten, pajak, diskon berizin, varian), cadangan stok + tolak checkout bila bahan kurang + HABIS di app, sesi kasir & rekonsiliasi, serah terima, hold, split payment, refund berpersetujuan, struk & tiket dapur | 3, 1D, 1F, 2C | ✅ file 06 dijalankan |
| 3 | Akuntansi & keuangan: bagan akun, jurnal double-entry otomatis (pesanan, pembayaran, refund, stok, PO & bayar supplier, kas kasir, selisih kas, beban), jurnal manual & pembalik, tutup periode, saldo awal (go-live), beban + foto nota, laporan laba rugi / neraca / arus kas / perubahan ekuitas / neraca saldo / buku besar, ekspor Excel/CSV/PDF | 1A, 1B, 1E, 1G | ✅ kode selesai · menunggu file 07 |
| 4 | Customer app & QR meja: keranjang tersimpan, varian & catatan, lupa password, status buka/tutup + jeda + estimasi, pesanan terjadwal, QR meja (token rahasia, tolak lintas kafe, keterisian, cetak), voucher, poin & tingkat member, pesan ulang (harga & stok terkini), batal sendiri + detail pembatalan, riwayat pembayaran, ulasan & rating, wishlist, bantuan (tiket), notifikasi + push | 4, 7 | ✅ kode selesai · menunggu file 08 |
| 5 | Payment gateway (Midtrans): QRIS dinamis dari app & kasir, masa berlaku QR, status bayar terpisah dari status pesanan, webhook terverifikasi (tanda tangan + cek ulang API), idempoten, rekonsiliasi (cek status semua tagihan menunggu), refund lewat gateway, riwayat & ringkasan pembayaran online | 5 | ✅ kode selesai · menunggu file 09 + Edge Function `payments` + akun Midtrans |
| 6 | BI, forecast penjualan, AI advisor | 6 | — |
| **7** | **Izin per staff, langganan, keamanan & keandalan**: 9 izin staff ditegakkan database, paket Basic/Pro/Enterprise (fitur & batas), RLS wajib di semua tabel publik, hak tulis anonim dicabut, penyisiran isolasi lintas kafe otomatis, kunci Midtrans per kafe, index, coba ulang otomatis untuk permintaan baca, banner offline | 8, 9 | ✅ kode selesai · menunggu file 10 |

**Langkah 7 — catatan keputusan:**
- Izin staff ditegakkan **trigger di database** (bukan hanya tombol disembunyikan): berlaku untuk web, app, maupun panggilan API langsung. Null = semua izin, agar staff lama tidak berubah.
- Langganan "siap SaaS" tanpa penagihan otomatis: paket & status diatur pengelola platform (`subscription_set`, service_role). Kafe lama = Enterprise; batas & gerbang fitur hanya berlaku untuk paket yang membatasi. Masa coba habis → fitur dasar saja, data tidak dihapus.
- Isolasi antar-kafe dibuktikan tes otomatis: semua tabel ber-`cafe_id` (≥ 30 terisi data) dicoba dibaca/diubah/dihapus owner, staff, customer kafe lain, dan pengunjung anonim → tidak ada kebocoran.
- Keandalan: permintaan baca diulang otomatis saat jaringan putus sesaat (penulisan tidak, agar tidak dobel); banner offline di web & app versi web; realtime papan staff sudah punya indikator & sambung ulang sejak fase sebelumnya.
- Belum: penagihan langganan otomatis (Midtrans subscription), konsol admin platform, NetInfo (status offline) di app Android/iOS.

**Langkah 5 — catatan keputusan:**
- Provider: **Midtrans Core API, QRIS** (acquirer GoPay). Semua panggilan lewat satu Edge Function `payments`; logika data di fungsi SQL `pay_*` (service_role saja), sehingga provider lain (mis. Xendit) bisa ditambah tanpa mengubah alur app.
- Satu akun Midtrans per instalasi (Secrets Edge Function). Kunci per kafe (multi-merchant) butuh penyimpanan rahasia terenkripsi — masuk langkah 7 (langganan/SaaS).
- Webhook tidak dipercaya mentah: tanda tangan diverifikasi lalu status diambil dari API Midtrans. Bila API gagal → respons 500 agar Midtrans mengirim ulang.
- Pembayaran gateway tercatat di `payments` (`verification = gateway`), sehingga jurnal (07), poin (08), dan laporan memakai jalur yang sama.
- Kasir: "QRIS otomatis" (dinamis) ditambahkan di samping "QRIS manual" (statis, konfirmasi kasir). QRIS demo di app hanya muncul bila gateway mati.
- Belum: biaya MDR & pencairan ke bank dijurnal otomatis (butuh laporan settlement Midtrans), metode lain (VA bank, kartu), pembayaran sebagian lewat QRIS di app (app selalu menagih sisa penuh).

**Langkah 4 — catatan keputusan:**
- Checkout app lewat `customer_place_order` (membungkus `place_order` file 06): cek jam buka/jeda/jadwal/QR, lalu voucher & poin dihitung ulang di server sebagai diskon (pajak & service dihitung dari harga setelah diskon). Diskon voucher/poin otomatis tercatat sebagai *Diskon penjualan* di akuntansi (file 07).
- Jam buka memakai `cafes.opening_hours` (WIB). Belum diatur = selalu buka. Pesanan terjadwal: 15 menit–7 hari ke depan, harus di jam buka; tidak berlaku untuk QR meja.
- QR berisi `<VITE_CUSTOMER_APP_URL>/meja/<token>`. Token bisa diganti owner (QR lama langsung mati). App customer satu kafe per build menolak QR kafe lain; server juga menolak.
- Poin: didapat saat pesanan **selesai** (total setelah diskon × pengali tingkat), dikurangi sebanding saat refund disetujui, poin yang ditukar kembali bila pesanan batal. Tingkat naik berdasarkan total belanja.
- Customer hanya bisa membatalkan selama status *Menunggu* dan belum dibayar; setelah itu lewat kafe (tiket bantuan).
- Push lewat Expo Push API dari Edge Function `push-send` (Database Webhook). Tanpa itu, notifikasi tetap ada di kotak masuk app. Web tidak memakai push.
- Belum: pesan dari QR tanpa akun (perlu login customer), reservasi meja, hadiah tukar poin berupa produk gratis (saat ini poin = potongan harga), verifikasi pembayaran otomatis (langkah 5).

**Langkah 3 — catatan keputusan:**
- Pembukuan dimulai dari **tanggal go-live** yang dipilih owner + saldo awal (kas, bank, QRIS, persediaan, piutang, peralatan, utang, pajak, pinjaman, modal). Selisihnya masuk *Ekuitas saldo awal* sehingga neraca seimbang. Transaksi sebelum go-live **tidak** dijurnal (tidak ada angka karangan); sesudahnya otomatis, termasuk yang terlewat (backfill idempoten).
- Pendapatan diakui saat pesanan **selesai**; pembayaran yang masuk lebih dulu dicatat sebagai *uang muka pesanan* (1-1300). HPP = nilai bahan yang benar-benar terpakai (mutasi stok), bukan estimasi.
- QRIS/e-wallet masuk *Saldo QRIS & e-wallet* (1-1150); pencairan ke bank dicatat owner lewat jurnal manual sampai payment gateway (langkah 5) memberi data settlement.
- Jurnal **tidak pernah diedit/dihapus**: koreksi lewat jurnal pembalik. Satu sumber hanya bisa menghasilkan satu jurnal per kejadian (unik di DB) → tidak ada jurnal dobel. Jurnal wajib seimbang (dicek fungsi + constraint trigger).
- Kegagalan jurnal **tidak pernah memblokir transaksi** (kasir tetap jalan); kejadian dicatat di `acc_sync_issues` dan tampil di Ringkasan → *Sinkronkan*.
- Periode yang ditutup menolak jurnal baru bertanggal di bulan itu (termasuk otomatis); membuka kembali wajib alasan dan tercatat di log aktivitas.
- Laporan dihitung di database dari jurnal; browser hanya menampilkan. Semua data keuangan hanya untuk owner (RLS).
- Belum: penyesuaian pajak saat refund (refund penuh ke *Retur & refund*), penyusutan otomatis, rekonsiliasi bank, multi-cabang. Dashboard operasional (omzet) masih belum mengurangi refund sebagian; angka yang benar ada di Laba rugi.

**Langkah 2 — catatan keputusan:**
- `create_order` dipertahankan sebagai pembungkus `place_order` sehingga app lama tetap jalan dan otomatis ikut cek stok/pajak.
- Pesanan kasir langsung berstatus *Sedang dibuat*. Stok dicadangkan saat pesanan dibuat, dipotong saat selesai, dilepas saat batal atau saat pelacakan dimatikan.
- Tunai wajib sesi kasir terbuka di Kasir; tombol *Tandai lunas* di papan tetap bisa tanpa sesi (alur lama) dan otomatis menempel ke sesi bila ada.
- QRIS/transfer di kasir = konfirmasi manual kasir (ditandai `verification = manual`); verifikasi otomatis menunggu payment gateway (langkah 5).
- Refund dicatat sebagai baris pembayaran `refunded`; dashboard omzet belum mengurangi refund sebagian — akan dibenahi bersama laporan akuntansi (langkah 3).
- Owner memakai web owner; Kasir & Sesi kasir ada di web staff (akun owner belum bisa membuka web staff).

**Langkah 1 — catatan keputusan:**
- Biaya bahan memakai **rata-rata tertimbang bergerak**; batch hanya untuk kedaluwarsa (FEFO saat stok keluar).
- Stok dipotong saat pesanan **selesai**, hanya bila owner menyalakan pelacakan. Stok **boleh minus** dari pesanan (pesanan tidak pernah tertahan); stok manual (keluar/opname/penyesuaian) tidak boleh minus. Pencegahan oversell sebenarnya ada di langkah 2.
- Varian belum tersimpan di pesanan, jadi pemotongan memakai resep dasar; tambahan per varian sudah bisa diisi dan dihitung HPP-nya.
- Profit produk: HPP **aktual** dari mutasi pemakaian bila ada; selain itu **estimasi** (jumlah × HPP resep saat ini), ditandai jelas. Perkiraan stok menolak menebak bila < 7 hari berjualan.
- Semua data inventori hanya untuk owner (RLS). Uji SQL: `supabase/tests` (PGlite, tanpa DB live).

---

## 1. Ringkasan audit

### 1.1 Struktur proyek

| Bagian | Teknologi | Isi |
|---|---|---|
| `web-dashboard/` | React 19, Vite 8, React Router 7, Tailwind 4 dan CSS token, lucide | Web owner (`/`) dan staff (`/staff`) dalam satu app. Peran ditentukan dari `profiles.role`. |
| `mobile-customer/` (repo git terpisah) | Expo 58, expo-router, RN 0.88 | Aplikasi customer |
| `supabase/` | Postgres, RLS, RPC | 16 file migrasi (**tidak sama** dengan DB live), `usulan/01` dan `usulan/02` belum dipastikan sudah dijalankan |

Build dan lint web: ✅ lulus. Tidak ada test otomatis sama sekali.

### 1.2 Fitur yang sudah berjalan (dipertahankan)

- **Owner:** dashboard (dihitung di browser dengan zona WIB, grafik, heatmap jam, perbandingan periode), CRUD produk dengan crop dan unggah foto, kategori dengan urutan, daftar transaksi dengan detail dan ekspor Excel, pengaturan (info kafe, jam buka, metode bayar, daftar tim read-only).
- **Staff:** papan Kanban realtime dengan suara notifikasi, riwayat, toggle menu habis, cetak label.
- **Customer:** login/daftar, beranda, menu, detail produk, keranjang, checkout, lacak pesanan, riwayat, profil.
- **Database:** `create_order` menghitung harga di server ✅, trigger alur status ✅, RLS aktif di tabel inti ✅, foto produk per folder `cafe_id` ✅.
- **Design system v1:** token terpusat (`web-dashboard/src/styles/tokens.css` dan `mobile-customer/src/theme/tokens.js`), komponen UI bersama, kontras AA.

### 1.3 Temuan keamanan

| # | Tingkat | Temuan | Status |
|---|---|---|---|
| S1 | 🔴 Kritis | Customer bisa mengubah `profiles.role` dan `cafe_id` miliknya, lalu menjadi owner kafe mana pun (policy update tanpa `WITH CHECK` dan grant UPDATE ke semua kolom). | Perbaikan siap di `usulan/01`. **Perlu dipastikan sudah dijalankan.** |
| S2 | 🔴 Tinggi | `create_order(jsonb)` versi lama tanpa cek login masih bisa dipanggil. | Diperbaiki di `usulan/01` |
| S3 | 🟠 Sedang | `anon`/`authenticated` punya grant INSERT/UPDATE/DELETE penuh di `cafes`, `categories`, `products`. Aman hanya selama policy RLS benar. | Sebagian di `usulan/02` (bagian K). Sisanya dirapikan di fase 1b. |
| S4 | 🟠 Sedang | Checkout punya metode **"Simulasi pembayaran"**. Di produksi, ini pembayaran palsu. | Dihapus di fase 7 dan diganti alur QRIS yang nyata. |
| S5 | 🟡 Rendah | Angka dashboard dihitung di browser dari ribuan baris pesanan (`fetchAllRows`, maksimal 20.000). Hasilnya tidak bisa diaudit dan tidak skala. | Laporan keuangan pindah ke fungsi SQL dan buku besar (fase 6). |
| ✅ | — | Tidak ada `service_role` di kode klien. File `.env` di-ignore di kedua repo. | — |

### 1.4 Keterbatasan database dan kode

1. **Skema live ≠ file migrasi.** Tidak ada sumber kebenaran skema. Contoh: `orders.order_number` bertipe text/uuid, ada kolom ganda `status` dan `order_status`, ada `price` dan `unit_price` di `order_items`, dan ada dua versi `create_order`.
2. **Tidak ada tenant binding di app customer.** App mengambil `cafes[0]` (kafe pertama menurut abjad). Kalau ada kafe kedua, customer bisa memesan di kafe yang salah.
3. **Kasir (POS) belum bisa dibuat.** `create_order` hanya menerima akun customer (`role = 'customer'`), dan `orders.customer_id` wajib diisi. Pesanan walk-in tidak punya tempat.
4. **Peran satu kolom.** `profiles.role` dan `profiles.cafe_id` membuat satu orang hanya bisa terikat ke satu kafe dengan satu peran. Belum ada izin granular, akun nonaktif, atau undangan staff (butuh Edge Function).
5. **Belum ada:** pajak/PB1, service charge, diskon, meja, varian/add-on, refund, sesi kasir, inventori, resep, supplier, pembelian, akuntansi, audit log, notifikasi push, loyalti, payment gateway, branding per kafe, paket langganan.
6. **Produk habis disembunyikan** di app customer (`.eq('is_available', true)`). Produk tidak tampil sebagai "HABIS".
7. **Zona waktu dan mata uang di-hardcode** (`Asia/Jakarta`, IDR). Untuk SaaS, ini perlu jadi pengaturan per kafe.
8. **Branding di-hardcode.** Nama "Dailybrew", ikon Expo bawaan, dan warna ada di kode dan `app.json`.

### 1.5 Duplikasi dan kerapian

- `web-dashboard/src/components/PageHeader.jsx` hanya meneruskan `ui/PageHeader.jsx`. Dibiarkan atau dihapus saat refactor.
- `mobile-customer/src/components/ui.jsx` adalah barrel lama yang masih dipakai 14 file, berdampingan dengan `components/ui/*`. Disatukan di fase 7.
- Pesan error checkout menyebut nama file migrasi ke customer. Diganti pesan yang ramah.
- Logika deteksi fitur DB ada di dua tempat (`web/lib/db.js` dan `mobile/lib/orders.js`). Pola ini tetap dipakai, tetapi digabung jadi satu probe "versi skema".

---

## 2. Arsitektur target

### 2.1 Prinsip

1. **Satu jalur transaksi.** App customer dan POS staff memanggil RPC yang sama (`place_order`). Harga, pajak, diskon, stok, dan jurnal dihitung di database dalam **satu transaksi**. Kalau salah satu gagal, semuanya batal.
2. **Klien tidak pernah menulis tabel keuangan atau stok secara langsung.** Semua penulisan lewat fungsi `SECURITY DEFINER` yang mengecek keanggotaan kafe dan izin.
3. **Buku besar tidak bisa diubah.** Jurnal yang sudah diposting tidak bisa di-UPDATE atau DELETE (dijaga trigger). Koreksi dilakukan lewat jurnal pembalik.
4. **Idempoten.** Setiap kejadian bisnis (pesanan lunas, barang diterima, beban dicatat) punya kunci unik `(source_type, source_id, event)`, sehingga jurnal tidak bisa dobel.
5. **Data jujur.** Sebelum tanggal *go-live akuntansi*, tidak ada jurnal yang dikarang. Angka estimasi (misalnya HPP dari resep untuk pesanan lama) diberi label **Estimasi**.
6. **Aditif.** Kolom dan tabel baru tidak menghapus yang lama. Fungsi lama tetap ada sampai semua app pindah.

### 2.2 Model tenant dan white-label (permintaan tambahan)

Owner menjadi "editor" untuk semua platform. Branding terbagi dua jenis, dan bedanya perlu jelas sejak awal:

| Jenis | Bisa diubah owner dari dashboard? | Contoh |
|---|---|---|
| **Runtime** (disimpan di DB dan storage, langsung berlaku) | ✅ Ya, tanpa build ulang | Nama bisnis, nama tampilan app, logo terang dan gelap, favicon web, warna aksen (dengan validasi kontras), tagline, foto sampul, kontak, media sosial, header/footer struk, teks sambutan, banner promo |
| **Build-time** (tertanam di file app HP) | ⚠️ Disiapkan dari dashboard, tetapi perlu **build ulang** dan upload ke Play Store/App Store | Nama app di layar HP, ikon app, splash screen, bundle ID, listing store |

Dampaknya: ikon dan nama app di layar HP **tidak bisa** berubah sendiri dari dashboard. Itu batasan Android/iOS, bukan batasan kode. Solusinya:
- `app.json` diganti `app.config.js` yang membaca `tenant.config.json` (nama, slug, bundle ID, warna, path ikon, `cafe_id`).
- Script `npm run brand:pull -- <slug-kafe>` mengambil branding dari DB, membuat ikon dan splash dari logo yang diunggah owner, lalu mengisi `tenant.config.json`. Setelah itu dijalankan `eas build`.
- Dashboard menampilkan status "Logo app di HP berubah setelah rilis versi berikutnya".

Web owner/staff: kafe dikenali dari domain (`cafe_domains`, misalnya `kopiku.app.com` atau domain sendiri) atau dari akun yang login. Halaman login sudah tampil dengan logo kafe.

Tabel baru:
- `cafe_branding` (1:1 dengan cafes): `business_name`, `app_name`, `logo_url`, `logo_dark_url`, `icon_url`, `favicon_url`, `cover_url`, `accent_color`, `tagline`, kontak, `social_links jsonb`, `updated_at`.
- `cafe_settings` (1:1): `timezone`, `currency`, `tax_rate`, `tax_inclusive`, `service_charge_rate`, `rounding`, `order_types`, `inventory_policy`, `receipt_header`, `receipt_footer`, `accounting_go_live date`.
- `cafe_domains`, `cafe_tables`.
- Bucket storage `cafe-assets` dengan folder per `cafe_id`, hanya owner yang boleh menulis.
- Persiapan langganan: `plans`, `cafe_subscriptions` (status, periode, batas fitur). Fitur dikunci per paket lewat satu helper `cafe_has_feature()`.
- Peran **platform admin** (pemilik sistem): membuat kafe dan owner baru, mengatur paket. Lewat Edge Function, bukan dari browser.

### 2.3 Peran dan izin

- Tabel baru `cafe_members (cafe_id, user_id, role, permissions text[], is_active)`. `profiles.role` dan `cafe_id` tetap diisi (disinkronkan) agar app lama tidak rusak.
- Peran bawaan: `owner`, `manager`, `cashier`, `barista`, dan `customer`. Izin granular, misalnya `pos.discount`, `pos.refund`, `inventory.adjust`, `reports.financial`, `settings.edit`.
- `is_cafe_member()` diperluas menjadi `has_permission(cafe_id, permission)`. Staff biasa **tidak** punya `reports.financial`, jadi RLS menolak mereka membaca tabel jurnal.
- Undang staff, nonaktifkan, dan reset password lewat Edge Function `staff-admin` (service-role hanya di server).

### 2.4 Inventori dan resep

```
ingredients ──< recipe_items >── products / product_option_values
     │
     ├──< ingredient_batches (qty sisa, harga per unit, kedaluwarsa)
     └──< stock_movements (buku besar stok, tidak bisa diubah)
suppliers ──< purchases ──< purchase_items  → movement 'purchase'
stock_counts ──< stock_count_lines          → movement 'opname'
```

- **Satuan dasar** per bahan (g, ml, pcs) dengan konversi beli (misalnya 1 karton = 12 L = 12.000 ml).
- **Metode biaya: rata-rata tertimbang bergerak** (*moving average*). Cocok untuk kafe dan sederhana diaudit. Batch hanya untuk melacak kedaluwarsa.
- **Kolom cache** `on_hand_qty`, `reserved_qty`, `avg_cost` di `ingredients`, diperbarui di transaksi yang sama dengan movement. Constraint `on_hand_qty >= 0` mencegah stok minus.
- **Kebijakan default (bisa diubah di pengaturan):**
  - Saat pesanan dibuat: stok **dicadangkan** (`reserved_qty`). Baris bahan dikunci `FOR UPDATE` berurutan menurut id agar dua pesanan bersamaan tidak saling mengunci dan tidak oversell.
  - Saat pesanan **selesai**: cadangan menjadi **pemakaian** (movement `sale`, HPP diakui dengan `avg_cost` saat itu).
  - Saat pesanan **dibatalkan sebelum diproses**: cadangan dilepas.
  - Saat pesanan dibatalkan **setelah diproses**: staff memilih apakah bahan terbuang. Kalau ya, dicatat sebagai movement `waste`.
- **Ketersediaan produk:** view `product_stock_status` menghitung `porsi_tersedia = min(floor((on_hand − reserved) / qty_resep))`. Produk otomatis berstatus **HABIS** kalau porsinya 0, dan toggle manual tetap berlaku. Checkout ditolak di server kalau stok tidak cukup, meskipun tampilan app sudah basi.

### 2.5 Pesanan, POS, dan kasir

- Kolom baru di `orders`: `source` (`app`/`pos`), `order_type` (`dine_in`/`takeaway`), `table_id`, `subtotal`, `discount_amount`, `tax_amount`, `service_charge_amount`, `cashier_session_id`, `idempotency_key` (unik). `customer_id` boleh kosong untuk walk-in.
- `order_item_options`: snapshot varian dan add-on beserta harganya.
- RPC `place_order(p_cafe_id, p_items, p_order_type, p_table_id, p_discount, p_payment, p_idempotency_key)`. Fungsi ini memvalidasi harga dari DB, menerapkan pajak dan service charge dari `cafe_settings`, mengecek izin diskon, mencadangkan stok, dan membuat pembayaran untuk POS yang langsung lunas.
- `cashier_sessions`: modal awal, kas masuk/keluar, kas yang dihitung saat tutup, kas seharusnya, dan selisih (selisih otomatis dijurnal).
- `refunds`: penuh atau sebagian, dengan alasan, izin `pos.refund`, dan jurnal pembalik. Stok bisa dikembalikan atau dicatat sebagai waste.
- Struk: cetak dari browser (thermal 58/80 mm) dengan header dan footer dari pengaturan.

### 2.6 Akuntansi double-entry

**Tabel:** `accounts` (bagan akun per kafe, dibuat dari templat), `accounting_periods` (open/closed), `journal_entries` (nomor, tanggal, sumber, status `posted`/`reversed`, `reversal_of`), `journal_lines` (akun, debit, kredit), `expenses`, dan `audit_logs`.

**Penjaga integritas (di database, bukan di UI):**
- Setiap baris jurnal hanya debit **atau** kredit, dan nilainya > 0.
- Constraint trigger *deferred*: Σ debit = Σ kredit per jurnal saat commit.
- Posting ke periode yang ditutup ditolak.
- Jurnal yang sudah diposting tidak bisa diubah atau dihapus. Pembatalan dilakukan lewat `reverse_journal(id, alasan)`.
- Unik `(cafe_id, source_type, source_id, event)` mencegah jurnal dobel.

**Templat bagan akun (ringkas):**

| Kode | Akun | Kode | Akun |
|---|---|---|---|
| 1-1100 | Kas | 3-1000 | Modal pemilik |
| 1-1200 | Bank | 3-2000 | Laba ditahan |
| 1-1300 | Piutang usaha / QRIS belum cair | 3-3000 | Prive |
| 1-1400 | Persediaan bahan | 4-1000 | Penjualan |
| 1-2000 | Peralatan (aset tetap) | 4-1100 | Diskon penjualan (kontra) |
| 2-1100 | Utang usaha (supplier) | 4-1200 | Retur/refund penjualan (kontra) |
| 2-1200 | Utang pajak PB1 | 5-1000 | HPP |
| 2-1300 | Pendapatan service charge* | 5-1100 | Bahan terbuang / selisih opname |
| | | 6-xxxx | Beban operasional (gaji, sewa, listrik, dll.) |

*Pencatatan service charge (pendapatan atau utang ke karyawan) diatur di pengaturan.

**Jurnal otomatis:**

| Kejadian | Debit | Kredit |
|---|---|---|
| Pesanan selesai/lunas | Kas / Bank / Piutang (total), Diskon penjualan | Penjualan (bruto), Utang PB1, Service charge |
| Pemakaian bahan (pesanan selesai) | HPP | Persediaan (avg cost) |
| Pelunasan piutang/QRIS | Kas/Bank | Piutang |
| Pembelian bahan | Persediaan | Kas / Bank / Utang usaha |
| Bayar utang supplier | Utang usaha | Kas/Bank |
| Beban operasional | Beban 6-xxxx | Kas / Bank / Utang |
| Waste / selisih opname (kurang) | Bahan terbuang | Persediaan |
| Refund | Retur penjualan, Utang PB1 | Kas/Bank (lalu HPP dibalik kalau stok kembali) |
| Selisih kas kasir | Selisih kas (beban/pendapatan lain) | Kas (atau sebaliknya) |
| Saldo awal (go-live) | Aset | Liabilitas, Modal (diinput owner, ditandai jurnal pembuka) |

Pembelian bahan **tidak pernah** langsung masuk HPP. HPP hanya diakui dari pemakaian sesungguhnya.

**Laporan (fungsi SQL, dihitung di server):** jurnal umum, buku besar per akun, neraca saldo, laba rugi, neraca (dengan laba berjalan, dan cek Aset = Liabilitas + Ekuitas ditampilkan), arus kas metode langsung (dari baris akun kas/bank, diklasifikasikan per kategori akun lawan), dan perubahan ekuitas.

**Pesanan sebelum go-live:** tidak dijurnal. Dashboard tetap menampilkan omzet historis dari tabel pesanan dengan label "Data operasional, bukan laporan akuntansi".

### 2.7 Pembayaran dan notifikasi

- **QRIS siap gateway:** Edge Function `payment-create` (Midtrans/Xendit, memakai kunci merchant milik kafe) dan `payment-webhook` (cek signature, idempoten lewat `payment_events.gateway_ref` yang unik). Sebelum ada akun merchant, QRIS hanya berupa "QRIS statis kafe dan konfirmasi manual oleh kasir" (jujur, bukan simulasi).
- **Push:** tabel `push_tokens` dan Database Webhook ke Edge Function `notify-order` (Expo Push) saat status berubah.

---

## 3. Fase implementasi

Setiap fase terdiri dari: cek file terkait → rencana singkat → SQL usulan (kalau perlu) dan kode UI dengan fallback → build, lint, dan uji → laporan → **berhenti untuk review**. Commit di kedua repo per fase.

### Fase 1 — Audit dan arsitektur ✅ (dokumen ini)
**1b. Fondasi** (sebelum fase lain):
- [x] Owner menjalankan `usulan/01` (kritis) dan `usulan/02` (8 Nov).
- [x] **Branding white-label tahap 1** (8 Nov): `usulan/03-branding-kafe.sql` + Pengaturan → Brand & tampilan (logo, nama tampilan, tagline, warna brand dengan cek kontras), logo/nama di sidebar, tab browser, favicon, halaman login, splash/beranda/login app customer. App customer dikunci ke `EXPO_PUBLIC_CAFE_ID` (tidak lagi `cafes[0]` diam-diam). **Menunggu owner menjalankan file 03.**
- [ ] Owner menjalankan dump skema read-only. Hasilnya dijadikan `supabase/baseline/live-schema.sql`, sumber kebenaran baru, dan migrasi lama diarsipkan.
- [ ] Lingkungan uji (lihat Keputusan D2).
- [ ] SQL `03-fondasi-tenant.sql`: `cafe_settings`, `cafe_branding`, `cafe_members`, `cafe_tables`, bucket `cafe-assets`, perapian grant (S3), `audit_logs` dan trigger generik.

### Fase 2 — Design system "Warm Luxury" dan mesin branding ✅ tahap 1 (8 Nov)
> Selesai: token Warm Luxury di web & app, sidebar gelap espresso, login baru, warna brand owner menimpa `--brand-*` (web) dan tombol/tab/chip (app). Sisa: warna brand di semua layar app customer ikut redesign layar di fase 7 (sekarang layar lama memakai Walnut bawaan).
- Token baru: Ivory `#F2E9DC` (latar), Sand `#D8C3A9` (permukaan sekunder), Taupe `#B69A7D` (garis/dekor), Walnut `#75543D` (tombol utama, teks putih 6,8:1 ✅), Espresso `#38271E` (teks dan navigasi gelap), Terracotta `#B96843` (sorotan).
- ⚠️ Kontras: Terracotta di atas Ivory hanya **3,4:1**. Lolos untuk ikon, badge, dan teks besar, tetapi **tidak** untuk teks biasa. Ditambah varian `terracotta-700` (≈ #8F4C2D) untuk teks tautan dan angka penting. Taupe tidak dipakai untuk teks.
- Token dijadikan variabel yang bisa ditimpa dari `cafe_branding.accent_color`. Warna pilihan owner divalidasi kontrasnya, dan kalau gagal, otomatis digelapkan.
- Perbaikan hierarki: shell navigasi Espresso, tabel padat dengan header tetap, form 2 kolom, empty state, dan grafik dengan palet hangat.
- Halaman **Pengaturan → Brand & tampilan** dengan pratinjau langsung web dan mockup app HP.
- Mobile: token dan font sama. Branding runtime dibaca dari `cafe_branding`.

### Fase 3 — Owner dashboard ✅ (8 Nov, menunggu file 04 + Edge Function)
> Selesai: design system v2 (tanpa pola template: judul tanpa titik, kartu tanpa kotak ikon, strip KPI menyatu dengan satu sorotan brand, badge ringkas, warna grafik pembayaran divalidasi), gradasi brand (web + app), navigasi baru, Pengaturan bertab (Umum, Operasional, Pajak & biaya dengan contoh hitung, Meja, Struk dengan pratinjau), varian & add-on produk, Tim (anggota + tambah/nonaktifkan/reset password via Edge Function, jadwal shift mingguan, log aktivitas).
> Belum: KPI laba (menunggu fase 6), QR meja (fase 7), izin granular per staff (fase 5 bersama POS). Varian, pajak, dan meja **tersimpan** tetapi baru dipakai saat pesanan v2 (fase 5) — ditandai jelas di UI.
- Navigasi baru: Ringkasan · Penjualan · Katalog · Inventori · Keuangan · Tim · Pengaturan.
- Produk: varian/add-on (grup opsi, wajib/opsional, harga tambahan), ketersediaan, dan tautan ke resep.
- Tim: undang/nonaktifkan staff (Edge Function), peran dan izin, log aktivitas (dari `audit_logs`), jadwal shift (`shifts`).
- Pengaturan bisnis: pajak, service charge, metode bayar, jam buka, meja (dengan QR per meja), struk, dan zona waktu.
- Dashboard: KPI operasional sekarang. KPI laba (laba kotor/bersih, beban) muncul setelah fase 6, sebelum itu ditandai "tersedia setelah modul keuangan aktif" (bukan angka palsu).

### Fase 4 — Inventori dan resep
- SQL `05-inventori.sql`: tabel di 2.4, RPC `receive_purchase`, `adjust_stock`, `record_waste`, `submit_stock_count`, dan view `product_stock_status`.
- UI: daftar bahan (stok, minimum, nilai persediaan, kedaluwarsa terdekat), supplier, pembelian/penerimaan barang, stok opname (input hitung fisik, selisih), riwayat movement, editor resep (HPP per porsi, margin %), dan peringatan stok rendah.
- Integrasi ke pesanan **belum** dilakukan di fase ini (dilakukan di fase 5), agar stok bisa disiapkan dulu tanpa mengganggu penjualan.

### Fase 5 — POS staff dan manajemen pesanan
- SQL `06-pesanan-v2.sql`: kolom pesanan baru, `place_order`, reservasi dan pemakaian stok, `cashier_sessions`, `refunds`, dan izin diskon.
- UI POS: grid produk dengan pencarian dan kategori (badge HABIS), pilih varian/add-on, jumlah, catatan, dine-in/takeaway dan meja, diskon (sesuai izin), ringkasan pajak dan service, bayar tunai (kembalian) atau QRIS, cetak struk, dan pintasan keyboard.
- Buka/tutup kasir dengan rekonsiliasi kas.
- Papan Kanban yang ada dipertahankan dan menerima pesanan dari POS dan app. Riwayat mendapat aksi refund.
- Owner: daftar pesanan dengan filter sumber, pembayaran, dan refund.

### Fase 6 — Akuntansi dan laporan keuangan
- SQL `07-akuntansi.sql`: tabel dan penjaga di 2.6, templat bagan akun, `post_*` yang dipanggil dari RPC bisnis (dalam transaksi yang sama), `reverse_journal`, tutup periode, dan fungsi laporan.
- UI: bagan akun, jurnal umum (dan jurnal manual dengan validasi seimbang), buku besar, neraca saldo, laba rugi, neraca, arus kas, perubahan ekuitas, beban, saldo awal/go-live, dan ekspor Excel/PDF.
- Hanya peran dengan izin `reports.financial`.

### Fase 7 — Aplikasi customer
- Tenant binding (`cafe_id` dari `tenant.config.json`, tidak lagi `cafes[0]`), `app.config.js`, dan script `brand:pull`.
- Branding runtime, info kafe dan jam buka, kategori, pencarian, detail dengan varian/add-on, badge **HABIS** (tidak bisa ditambah ke keranjang), keranjang, checkout via `place_order` (dine-in/meja dari QR, takeaway), hapus "Simulasi pembayaran", alur QRIS, lacak pesanan realtime, riwayat, profil, notifikasi push, dan loyalti/promo dasar (`loyalty_ledger`, `promotions`).

### Fase 8 — Integrasi dan pengujian
- Test SQL (skenario akuntansi dan stok: pesanan bersamaan, batal, refund, Σ debit = Σ kredit, Aset = Liabilitas + Ekuitas), test unit frontend untuk helper format dan perhitungan, dan QA browser di halaman utama.
- Uji tenant isolation: akun owner kafe A mencoba membaca dan menulis data kafe B lewat API dan harus ditolak di semua tabel.
- Checklist rilis white-label: domain, `tenant.config.json`, build EAS, dan listing store.

---

## 4. Keputusan yang perlu owner ambil

| # | Pertanyaan | Rekomendasi |
|---|---|---|
| D1 | Apakah `usulan/01` dan `usulan/02` sudah dijalankan? | Jalankan 01 secepatnya (celah S1). |
| D2 | Lingkungan uji. SQL akuntansi dan stok terlalu berisiko kalau hanya diuji di DB produksi. | Buat **proyek Supabase kedua (gratis) sebagai staging**. Claude boleh menjalankan migrasi di staging, sedangkan produksi tetap dijalankan manual oleh owner. (Docker belum terpasang di laptop ini, jadi Supabase lokal belum bisa.) |
| D3 | Model jual sistem: (A) satu platform dihosting kamu, banyak kafe berlangganan, atau (B) setiap pembeli mendapat instalasi sendiri (Supabase dan deploy sendiri). | Bangun kode yang **tenant-aware** (cocok untuk A). Model B tinggal "A dengan satu kafe", jadi keduanya bisa jalan. |
| D4 | Kapan stok dipotong? | Default: dicadangkan saat pesanan dibuat, dipotong saat selesai. Bisa diubah per kafe. |
| D5 | PB1/pajak: harga sudah termasuk pajak atau belum? | Pengaturan per kafe, dengan default "belum termasuk, 10%" (bisa 0%). |
