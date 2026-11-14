# Dailybrew Platform (`platform-admin`)

Dashboard khusus **pemilik SaaS Dailybrew** (bukan owner kafe). Fungsinya menggantikan pekerjaan manual di SQL Editor untuk mengelola kafe yang berlangganan:

- **Ringkasan:** jumlah kafe aktif, masa coba, dan nonaktif; MRR dan pendapatan bulan ini dibanding bulan lalu; tagihan yang telat.
- **Kafe:** cari, saring per status dan paket, dan buat **kafe baru sekaligus akun owner-nya**.
- **Detail kafe:** profil, owner (termasuk reset password), paket, pemakaian dibanding batas, aksi nonaktifkan dan aktifkan, ganti paket, perpanjang, beri masa coba, dan buat tagihan.
- **Paket:** nama, harga, batas staff/meja/menu, modul, publik atau arsip.
- **Tagihan:** status menunggu, telat, lunas, dan batal; tombol **Tandai lunas** untuk transfer bank. Pembayaran Midtrans lunas otomatis.
- **Log audit:** siapa, kapan, aksi apa, di kafe mana, dan nilai sebelum dan sesudah.
- **Login email + password**, ditambah **2FA TOTP wajib** (Supabase Auth MFA, sesi `aal2`).
- **Versi 2 (file 15):**
  - satu sidebar yang bisa diciutkan jadi rail ikon, breadcrumb di bar atas, satu tombol cari (Ctrl K),
  - **lonceng notifikasi realtime**,
  - **warna tema bebas** (preset, color picker, gradasi, mode gelap/terang) di **Pengaturan**,
  - kartu **Perlu tindakan**, grafik 12 bulan, **harga kustom** untuk paket tanpa harga (Enterprise) yang ikut dihitung di MRR,
  - tombol **Chat WA** dengan template (manual lewat wa.me, gratis),
  - **Pengumuman** ke owner, **notifikasi & email** otomatis harian.

Pengguna yang sama juga mendapat dua hal di `web-dashboard`:
- Banner "kafe dinonaktifkan" dan "langganan lewat jatuh tempo".
- Kartu **Tagihan & pembayaran** di Pengaturan → Langganan. Owner bisa membayar tagihan atau memilih paket dan lama langganan sendiri lewat Midtrans.

---

## Arsitektur & keamanan

| Lapisan | Isi |
|---|---|
| Browser (`platform-admin`) | Hanya memakai kunci **publik** (anon/publishable). Tidak ada kunci service-role. |
| Database (file SQL 14) | Admin disimpan di tabel `platform_admins`, **bukan** nilai baru di enum `app_role`. Data lintas kafe hanya bisa diakses lewat fungsi `pa_*` (`SECURITY DEFINER`). Setiap fungsi memanggil `pa_require()`, yang menolak pemanggil kalau ia bukan admin aktif **atau** sesinya belum `aal2`. Tabel platform tidak bisa di-select langsung oleh siapa pun dari browser. |
| Edge Function `platform-admin` | Untuk aksi yang butuh service-role: membuat akun owner dan me-reset password. Fungsi ini memeriksa token, claim `aal = aal2`, dan baris di `platform_admins`. |
| Edge Function `subscription-billing` | Owner membayar lewat Midtrans Snap, plus webhook. Status lunas hanya berasal dari API Midtrans (signature diverifikasi, lalu status dicek ulang ke API). |
| Audit | Setiap fungsi yang mengubah data menulis ke `platform_audit_logs` **di transaksi yang sama**. Kalau aksinya gagal, log-nya ikut batal. |

Tes otomatis (`supabase/tests/test-14-platform-admin.mjs`, 256 pemeriksaan; `test-16-kesehatan-tiket.mjs`, 195 pemeriksaan) membuktikan bahwa anon, customer, staff, owner, admin tanpa 2FA, dan admin nonaktif **ditolak** di setiap fungsi admin.

### Design system bersama
Komponen UI, mesin tema, kerangka (sidebar, palet perintah), dan grafik berasal dari folder `shared/ui/` di root repo, dipakai bersama dengan `web-dashboard` lewat alias `@dailybrew/ui`. Aturannya ada di `DESIGN.md`. Karena folder itu di luar `platform-admin/`, build di hosting harus bisa membaca root repo (lihat **Deploy dashboard**).

---

## Setup lokal

```bash
cd platform-admin
cp .env.example .env.local    # isi VITE_SUPABASE_URL & VITE_SUPABASE_ANON_KEY (sama dengan web-dashboard)
npm install
npm run dev                   # http://localhost:5174
VITE_MOCK=1 npm run dev       # pratinjau tampilan dengan data contoh (tanpa database; tidak aktif di build produksi)
npm run lint
npm run build
```

### Variabel environment

| Nama | Isi |
|---|---|
| `VITE_SUPABASE_URL` | URL project Supabase (sama dengan web-dashboard) |
| `VITE_SUPABASE_ANON_KEY` | Kunci **publik** (anon / publishable). **Jangan** isi kunci service-role/secret. |

---

## Urutan pemasangan (sekali)

### 1. Jalankan file SQL 14
Supabase Dashboard → **SQL Editor** → tempel isi `supabase/usulan/14-platform-admin.sql` → **Run**.
- Wajib sudah menjalankan file **04** dan **10**.
- Hasil verifikasi harus **6 baris** (5 tabel + trigger `orders_block_suspended`), dan **tidak boleh** ada baris `tanpa_rls`.
- Aman dijalankan ulang.

### 2. Buat admin pertama
1. **Authentication → Users → Add user → Create new user.** Isi email dan password yang kuat, lalu centang **Auto Confirm User**.
2. Di SQL Editor (ganti nama dan email):
   ```sql
   insert into public.platform_admins (user_id, full_name)
   select id, 'Nama Kamu' from auth.users where email = 'admin@domainkamu.id'
   on conflict (user_id) do update set is_active = true, full_name = excluded.full_name
   returning user_id;
   ```
   Harus keluar 1 baris. Kalau kosong, email-nya belum cocok.
3. Pastikan **Authentication → Sign In / Providers → Multi-Factor (TOTP)** dalam keadaan aktif. Biasanya sudah aktif secara bawaan.
4. Buka dashboard dan login. Aplikasi akan meminta **daftar 2FA**: scan QR dengan Google Authenticator, Authy, atau 1Password, lalu masukkan kode 6 digit.

> Untuk menambah admin lain, ulangi langkah 2.1 dan 2.2. Untuk mencabut akses: `update public.platform_admins set is_active = false where user_id = '…';`
> Kalau HP authenticator hilang: hapus faktornya di **Authentication → Users → (admin) → MFA factors**, lalu login lagi untuk mendaftar ulang.

### 3. Deploy Edge Function `platform-admin`
Dashboard → **Edge Functions → Deploy a new function → Via Editor**:
- Nama: `platform-admin`
- Hapus semua contoh kode, tempel isi `supabase/functions/platform-admin/index.ts`, lalu klik **Deploy**.
- **Verify JWT: OFF.** Fungsi ini sudah memeriksa token, 2FA, dan status admin sendiri. Pengaturan ini juga **wajib** OFF kalau project memakai kunci API baru (publishable/secret).
- Tidak perlu secret tambahan. `SUPABASE_URL` dan kunci service-role disediakan otomatis.

### 4. Deploy Edge Function `subscription-billing` (bayar online)
Caranya sama dengan langkah 3, dengan nama `subscription-billing` dan isi `supabase/functions/subscription-billing/index.ts`. **Verify JWT: OFF**, karena webhook Midtrans datang tanpa token.

Tambahkan **Secrets** di Edge Functions → Secrets:

| Secret | Isi |
|---|---|
| `PLATFORM_MIDTRANS_SERVER_KEY` | Server Key akun Midtrans **milik Dailybrew**. Kalau kosong, dipakai `MIDTRANS_SERVER_KEY`. |
| `PLATFORM_MIDTRANS_ENV` | `sandbox` untuk uji coba, `production` untuk transaksi asli |

- Tidak perlu mengubah *Payment Notification URL* di Midtrans. Fungsi ini mengirim URL webhook-nya sendiri per transaksi (header `X-Override-Notification`), sehingga tidak bentrok dengan webhook pesanan kafe (`payments`).
- Midtrans tidak memungut biaya bulanan, hanya potongan per transaksi yang berhasil. Daftar dan sandbox gratis. Untuk mode production, akun Midtrans harus sudah lolos verifikasi.
- Kalau fungsi ini belum di-deploy, owner tetap melihat tagihannya dan diminta transfer manual. Admin lalu menandai lunas dari dashboard.

### 5. Jalankan file SQL 15 (notifikasi, WA, pengaturan & tema)
SQL Editor → tempel isi `supabase/usulan/15-notifikasi-platform.sql` → **Run**.
- Wajib sudah menjalankan file **14**.
- Hasil verifikasi harus **6 baris** (5 tabel + trigger `pa_audit_notify`), dan **tidak boleh** ada baris `tanpa_rls`.
- Aman dijalankan ulang. Data lama tidak diubah.

### 6. Jadwalkan pengecekan harian (pg_cron)
1. Dashboard → **Database → Extensions** → cari **pg_cron** → aktifkan (Enable).
2. Di SQL Editor jalankan **satu** jadwal ini. Ia menggantikan jadwal `dailybrew-tagihan-harian` dari file 14, karena `pa_daily_check()` sudah memanggil `pa_billing_run()`:
   ```sql
   select cron.unschedule('dailybrew-tagihan-harian') where exists (select 1 from cron.job where jobname = 'dailybrew-tagihan-harian');
   select cron.schedule('dailybrew-harian', '0 1 * * *', $$select public.pa_daily_check()$$);  -- 01.00 UTC = 08.00 WIB
   ```

Setiap hari pukul 08.00 WIB, jadwal ini:
- membuat tagihan **H-7** sebelum masa coba atau periode habis, dan menandai `past_due`;
- membuat notifikasi owner untuk **tagihan H-7, H-1, telat**, dan **masa coba habis ≤3 hari**;
- membuat notifikasi admin untuk **tagihan telat, masa coba habis, kafe tanpa pesanan 7 hari**, dan **webhook pembayaran gagal**;
- memasukkan email ke antrean sesuai pilihan di Pengaturan;
- mencegah duplikat: notifikasi yang sama untuk kafe yang sama tidak dibuat ulang selama masih berlaku.

Notifikasi **kafe baru** dan **tagihan lunas** dibuat langsung saat kejadian, tidak menunggu jadwal. Cek jadwal: `select * from cron.job;` · Uji manual: `select public.pa_daily_check();`

### 7. Isi nomor WhatsApp Dailybrew & warna
Buka dashboard platform → **Pengaturan**:
- **WhatsApp Dailybrew** (format bebas, mis. `0812…`): dipakai tombol **"Hubungi Dailybrew via WhatsApp"** di web owner (halaman Langganan, layar kafe nonaktif, menu Bantuan, dan kartu WhatsApp di Pengaturan). Selama nomor ini kosong, tombol tersebut tidak tampil.
- **Tampilan:** pilih warna atau gradasi, lalu **Simpan warna** agar berlaku untuk semua admin. Mode gelap/terang dipilih per perangkat.
- **Email:** pilih jenis notifikasi yang juga dikirim lewat email ke admin dan ke owner.

WhatsApp **tetap manual**: tombol **Chat WA** membuka `wa.me` dengan pesan template (pengingat tagihan, bantuan setup, tawaran upgrade, pesan bebas), lalu kamu yang menekan kirim. Setiap klik tercatat di Log audit. Nomor WA owner bisa diisi admin (form Kafe baru / detail kafe) atau oleh owner sendiri di Pengaturan web owner.

### 8. Email otomatis: Edge Function `notify` + Database Webhook
1. **Siapkan Resend** (gratis 3.000 email/bulan): daftar di resend.com → **Domains** → tambahkan domain kamu dan pasang record DNS-nya sampai *Verified* → **API Keys** → buat key.
2. **Deploy fungsi:** Edge Functions → Deploy a new function → Via Editor → nama `notify` → tempel `supabase/functions/notify/index.ts` → Deploy. **Verify JWT: OFF**, karena fungsi ini memeriksa header rahasia sendiri.
3. **Secrets** (Edge Functions → Secrets):

   | Secret | Isi |
   |---|---|
   | `NOTIFY_WEBHOOK_SECRET` | Teks acak panjang (mis. 40 karakter) |
   | `EMAIL_API_KEY` | API key Resend |
   | `EMAIL_FROM` | mis. `Dailybrew <notifikasi@domainkamu.id>` (domain harus sudah terverifikasi) |
   | `EMAIL_PROVIDER` | opsional, bawaan `resend`. Penyedia lain ditambahkan di objek `PROVIDERS` di kode fungsi. |
   | `APP_URL_OWNER` | alamat web owner, mis. `https://dashboard.domainkamu.id` (untuk tombol di email) |
   | `APP_URL_ADMIN` | alamat dashboard platform, mis. `https://admin.domainkamu.id` |

4. **Database Webhook:** Database → **Webhooks** → Create a new hook:
   - Name: `notify-outbox` · Table: `notification_outbox` · Events: **Insert**
   - Type: **Supabase Edge Functions** → pilih `notify` · Method: POST
   - HTTP Headers: tambah `x-notify-secret` = nilai `NOTIFY_WEBHOOK_SECRET`
5. **Uji email:** di SQL Editor jalankan (butuh ekstensi **pg_net**, aktifkan di Database → Extensions bila belum; ganti URL project, secret, dan email):
   ```sql
   select net.http_post(
     url := 'https://<kode-project>.supabase.co/functions/v1/notify',
     headers := '{"Content-Type":"application/json","x-notify-secret":"<NOTIFY_WEBHOOK_SECRET>"}'::jsonb,
     body := '{"test_to":"emailkamu@gmail.com"}'::jsonb
   );
   ```
   Email "Uji email Dailybrew" harus masuk dalam ±1 menit. Kalau tidak masuk, cek Edge Functions → `notify` → **Logs**.
6. **(Opsional) kirim ulang yang gagal:** tambahkan jadwal yang memanggil fungsi dengan body `{}`. Email berstatus `pending` atau `failed` dari 2 hari terakhir dikirim ulang, maksimal 3 percobaan.

Status kirim (Antre / Terkirim / Gagal + alasan) tampil di **detail kafe → Status email**. Baris WhatsApp di antrean selalu berstatus `skipped`. Kolom `channel` sudah disiapkan agar WhatsApp Business API bisa ditambahkan nanti tanpa mengubah tabel.

### 9. Jalankan file SQL 16 (kesehatan kafe, analitik, tiket bantuan)
SQL Editor → tempel isi `supabase/usulan/16-kesehatan-analitik-tiket.sql` → **Run**. Syarat: file 14 dan 15 sudah dijalankan.

- **Hasil yang benar:** query verifikasi di akhir menampilkan **9 baris** (7 tabel + 2 trigger) dan **tidak ada** baris `tanpa_rls`.
- **Data lama:** tidak ada yang diubah atau dihapus. File ini menambah 7 tabel, 2 kolom kosong di `cafe_settings`, dan bucket storage privat `support-attachments`. `cafe_mrr_monthly` diisi awal dari tagihan **lunas** yang sudah ada; skor kesehatan dan progres setup hari ini langsung dihitung.
- **Jadwal:** tidak ada jadwal baru. `pa_daily_check()` (jadwal `dailybrew-harian` dari langkah 6) kini juga menghitung skor kesehatan, progres setup, MRR per kafe, dan sinyal upgrade. Uji manual: `select public.pa_daily_check() -> 'health';`
- **Realtime:** file ini mendaftarkan `platform_tickets` ke publikasi `supabase_realtime` agar kotak masuk tiket langsung bertambah. Kalau tidak, centang tabel itu di **Database → Publications**.
- **Storage:** kalau query di akhir gagal karena schema `storage`, buat bucket **support-attachments** (privat, 5 MB, JPG/PNG/WebP) dari menu Storage lalu jalankan ulang file ini.

Fitur yang aktif setelah langkah ini:

| Fitur | Di mana |
|---|---|
| Skor kesehatan 0–100 (pesanan 14 hari, login owner, modul, riwayat bayar) | Ringkasan, kolom **Kesehatan** di Kafe, kartu di detail kafe (komponen + tren) |
| Progres setup 8 langkah + **Kirim panduan** (WA) | Ringkasan (kafe masa coba), detail kafe |
| Sinyal upgrade (pemakaian ≥ 80% batas paket, atau ≥ 3× terbentur fitur terkunci dalam 14 hari) | **Perlu tindakan**, notifikasi admin seminggu sekali per kafe |
| Pergerakan MRR, retensi per bulan daftar, rata-rata per kafe, nilai seumur hidup, tingkat berhenti | **Analitik** |
| Linimasa + catatan internal (tidak terlihat owner) | Detail kafe |
| Tiket bantuan owner → admin | **Tiket bantuan** (admin) · menu **Bantuan Dailybrew** di dashboard owner |

### 10. Jalankan file SQL 17 (penagihan otomatis, promo, referral, multi-cabang, keuangan)
SQL Editor → tempel isi `supabase/usulan/17-penagihan-otomatis.sql` → **Run**. Syarat: file 14, 15, dan 16 sudah dijalankan.

- **Hasil yang benar:** query verifikasi menampilkan **9 baris** (6 tabel + 3 trigger) dan **tidak ada** baris `tanpa_rls`.
- **Data lama:** tidak dihapus. Tagihan lama mendapat `list_amount` = nominalnya, dan setiap kafe mendapat kode referral. Nomor tagihan berikutnya melanjutkan nomor bulan ini tanpa loncat.
- **Nonaktif otomatis langsung menyala**, tetapi hanya untuk langganan yang masa berlakunya habis **setelah** file ini dijalankan. Tunggakan lama tidak ikut dinonaktifkan. Atur atau matikan di **Keuangan → Pengaturan**.
- **Deploy ulang Edge Function `subscription-billing`** (langkah 4) dengan isi terbaru `supabase/functions/subscription-billing/index.ts`. Versi ini menambah kuitansi PDF dan tetap mengenali order Midtrans lama saat nominal tagihan berubah karena promo atau kredit. Secrets tidak berubah.
- **Jadwal:** tidak ada jadwal baru. `pa_daily_check()` kini juga mengirim pengingat telat 3 hari, peringatan 2 hari sebelum nonaktif (email dipaksa), dan menonaktifkan kafe yang lewat batas.
- **Isi data penerbit kuitansi** (nama, alamat, email, NPWP) di **Keuangan → Pengaturan**.

| Fitur | Di mana |
|---|---|
| Pengingat bertahap: H-7, H-1, telat, telat 3 hari, 2 hari sebelum nonaktif | Otomatis (banner + email owner) |
| Nonaktif otomatis N hari (bawaan 14) setelah masa berlaku habis; aktif lagi otomatis begitu lunas | **Keuangan → Ringkasan** (daftar nonaktif & akan nonaktif) · banner owner dengan tombol **Bayar sekarang** |
| Kuitansi PDF tagihan lunas | Owner: **Langganan → Riwayat pembayaran → Kuitansi** · Admin: ikon unduh di **Tagihan** |
| Kode promo (persen/nominal, kuota, paket, minimal bulan, khusus pembayaran pertama, masa berlaku) | **Keuangan → Kode promo** · owner memasukkan kode di tagihan |
| Referral: diskon tagihan pertama kafe baru + kredit untuk pengundang | Owner: kartu **Ajak kafe lain** · Admin: **Keuangan → Referral** |
| Kredit kafe (otomatis memotong tagihan; total 0 langsung lunas) | Detail kafe → **Penagihan → Atur kredit** |
| Harga multi-cabang (cabang ke-2 dst. didiskon) | **Keuangan → Multi-cabang** · detail kafe → **Grup cabang** |
| Kas masuk per bulan, piutang & umurnya, perkiraan 30 hari, ketepatan bayar, metode | **Keuangan → Ringkasan** |

### 11. Notifikasi realtime di lonceng
File 15 otomatis mendaftarkan tabel `platform_notifications` ke Supabase Realtime. Kalau lonceng tidak langsung bertambah saat ada kejadian baru, cek **Database → Publications → supabase_realtime** dan pastikan `platform_notifications` tercentang. Lonceng tetap memuat ulang saat halaman dibuka.

---

## Deploy dashboard

### Vercel
1. **Add New → Project**, lalu import repo ini.
2. **Root Directory:** `platform-admin`, lalu centang **Include files outside the Root Directory in the Build Step** (dibutuhkan untuk `shared/ui`). Framework: Vite (terdeteksi otomatis).
3. **Environment Variables:** `VITE_SUPABASE_URL` dan `VITE_SUPABASE_ANON_KEY`.
4. Deploy, lalu pasang domain, mis. `admin.domainkamu.id`. File `vercel.json` sudah menangani refresh halaman SPA.

> ⚠️ Paket **Hobby (gratis) Vercel tidak boleh dipakai komersial**. Karena Dailybrew menjual langganan, pilih Vercel Pro atau Cloudflare Pages.

### Cloudflare Pages (gratis, boleh komersial)
1. **Workers & Pages → Create → Pages → Connect to Git**, lalu pilih repo ini.
2. Kosongkan **Root directory** (root repo), isi **Build command** `cd platform-admin && npm ci && npm run build` dan **Output** `platform-admin/dist`. Root repo dibutuhkan karena `shared/ui` ada di luar folder aplikasi.
3. Isi environment variables yang sama dengan Vercel. File `public/_redirects` sudah menangani refresh halaman SPA.

Dashboard memasang `noindex`, jadi tidak muncul di mesin pencari. Lapisan keamanannya tetap login, 2FA, dan pemeriksaan di database.

---

## Cara kerja sehari-hari

| Kebutuhan | Di dashboard |
|---|---|
| Pelanggan baru mau coba | **Kafe → Kafe baru**: isi nama kafe dan owner, email, paket, lama coba. Salin email dan password sementara, lalu kirim ke owner. |
| Owner transfer bank | **Tagihan** → cari nomor tagihan → **Lunas** → isi tanggal dan referensi. Langganan otomatis diperpanjang. |
| Owner bayar online | Tidak perlu apa-apa. Webhook Midtrans menandai lunas dan memperpanjang langganan. Hasilnya terlihat di Tagihan dan Log audit. |
| Kasih bonus atau kompensasi | Detail kafe → **Perpanjang** (tanpa tagihan) atau **Beri masa coba** |
| Harga khusus | Detail kafe → **Ganti paket** → isi *Harga khusus / bulan* |
| Kafe tidak bayar | Biarkan sistem: pengingat terkirim otomatis, fitur turun ke Basic setelah tenggang 7 hari, dan kafe nonaktif otomatis setelah 14 hari (file 17). Begitu owner membayar, kafe aktif lagi sendiri. Membuka manual dari detail kafe menunda nonaktif otomatis 7 hari. |
| Beri diskon / kompensasi uang | **Keuangan → Kode promo**, atau detail kafe → **Penagihan → Atur kredit** |
| Owner punya beberapa cabang | **Keuangan → Multi-cabang → Grup baru**, lalu detail tiap kafe → **Grup cabang** |
| Owner minta kuitansi | **Tagihan** → ikon unduh di tagihan lunas (owner juga bisa unduh sendiri) |
| Ingatkan owner lewat WA | Ringkasan → **Perlu tindakan** → **Chat WA** (template sudah berisi nominal & jatuh tempo), atau dari detail kafe |
| Enterprise / harga khusus | Detail kafe → **Ganti paket** → isi **Harga kustom / bulan**, lalu harga itu ikut dihitung di MRR |
| Kabari semua kafe | **Pengumuman** → tulis → semua kafe / kafe tertentu (opsional + email) |
| Ganti warna dashboard | **Pengaturan → Tampilan** |
| Kafe mulai sepi atau jarang login | Ringkasan → **Kesehatan kafe** → buka kafe → lihat alasan & tren, lalu **Chat WA** |
| Kafe masa coba belum selesai setup | Ringkasan → **Progres setup** → **Kirim panduan** (pesan WA menyebut langkah yang macet) |
| Owner kirim pertanyaan | **Tiket bantuan** → buka → tugaskan, balas, atau **Kirim & selesaikan**. Owner dapat notifikasi di dashboard. |
| Catat hasil telepon / janji dengan owner | Detail kafe → **Linimasa** → Catatan internal |

## Belum termasuk versi ini
- **WhatsApp otomatis.** Masih manual lewat wa.me karena WhatsApp Business API berbayar. Antrean sudah punya kolom `channel` untuk menambahkannya nanti.
- Notifikasi push ke HP admin, dan email ringkasan harian.
- Refund otomatis untuk pembayaran yang masuk setelah tagihan dibatalkan. Kasus ini tercatat sebagai `invoice.paid_after_void` dan muncul di Perlu tindakan.
- Prorata saat ganti paket di tengah periode. Paket baru berlaku mulai dibayar.
- Konsep cabang di dalam satu akun owner. Multi-cabang saat ini berupa grup tagihan yang diatur admin; tiap cabang tetap kafe terpisah dengan akun owner sendiri.
- Faktur pajak (e-Faktur). Kuitansi PDF adalah bukti bayar, bukan faktur pajak.
- Peran admin bertingkat. Semua admin punya hak penuh.
- Lampiran gambar dari admin saat membalas tiket (owner sudah bisa melampirkan gambar).
- Wizard setup 8 langkah di sisi owner. Saat ini progres dibaca dari data yang sudah ada dan hanya terlihat oleh admin.
