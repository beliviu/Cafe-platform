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

Tes otomatis (`supabase/tests/test-14-platform-admin.mjs`, 256 pemeriksaan) membuktikan bahwa anon, customer, staff, owner, admin tanpa 2FA, dan admin nonaktif **ditolak** di setiap fungsi admin.

### Kenapa komponen UI disalin, bukan dibagi?
Token warna, mesin tema (`lib/theme.js`), font, dan komponen `ui/` **disalin** dari `web-dashboard`. Kerangka (sidebar, bar atas, lonceng) di `components/shell/AdminShell.jsx` ditulis khusus untuk admin. Tiap file salinan punya baris pertama `Salinan dari web-dashboard/…`. Alasannya:
1. Komponen `web-dashboard` bergantung pada `lib/` miliknya (status pesanan, mesin tema white-label per kafe). Mengekstraknya ke folder bersama berarti merefaktor aplikasi produksi, dan risikonya lebih besar daripada manfaatnya.
2. Dua proyek di-deploy terpisah dengan *Root Directory* masing-masing. Kode di luar folder itu membuat build Vercel/Cloudflare lebih rumit.
3. Admin memakai satu palet tetap (Espresso, gelap/terang) tanpa white-label.

Kalau komponen aslinya berubah dan perubahannya juga dibutuhkan di sini, salin ulang file yang bersangkutan.

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

### 9. Notifikasi realtime di lonceng
File 15 otomatis mendaftarkan tabel `platform_notifications` ke Supabase Realtime. Kalau lonceng tidak langsung bertambah saat ada kejadian baru, cek **Database → Publications → supabase_realtime** dan pastikan `platform_notifications` tercentang. Lonceng tetap memuat ulang saat halaman dibuka.

---

## Deploy dashboard

### Vercel
1. **Add New → Project**, lalu import repo ini.
2. **Root Directory:** `platform-admin`. Framework: Vite (terdeteksi otomatis).
3. **Environment Variables:** `VITE_SUPABASE_URL` dan `VITE_SUPABASE_ANON_KEY`.
4. Deploy, lalu pasang domain, mis. `admin.domainkamu.id`. File `vercel.json` sudah menangani refresh halaman SPA.

> ⚠️ Paket **Hobby (gratis) Vercel tidak boleh dipakai komersial**. Karena Dailybrew menjual langganan, pilih Vercel Pro atau Cloudflare Pages.

### Cloudflare Pages (gratis, boleh komersial)
1. **Workers & Pages → Create → Pages → Connect to Git**, lalu pilih repo ini.
2. Isi **Root directory** `platform-admin`, **Build command** `npm run build`, dan **Output** `dist`.
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
| Kafe tidak bayar | Biarkan sistem: setelah tenggang 7 hari, kafe otomatis turun ke Basic. Untuk menghentikan total: Detail kafe → **Nonaktifkan** (pesanan baru ditolak, data tetap aman). |
| Ingatkan owner lewat WA | Ringkasan → **Perlu tindakan** → **Chat WA** (template sudah berisi nominal & jatuh tempo), atau dari detail kafe |
| Enterprise / harga khusus | Detail kafe → **Ganti paket** → isi **Harga kustom / bulan**, lalu harga itu ikut dihitung di MRR |
| Kabari semua kafe | **Pengumuman** → tulis → semua kafe / kafe tertentu (opsional + email) |
| Ganti warna dashboard | **Pengaturan → Tampilan** |

## Belum termasuk versi ini
- **WhatsApp otomatis.** Masih manual lewat wa.me karena WhatsApp Business API berbayar. Antrean sudah punya kolom `channel` untuk menambahkannya nanti.
- Notifikasi push ke HP admin, dan email ringkasan harian.
- Refund otomatis untuk pembayaran yang masuk setelah tagihan dibatalkan. Kasus ini tercatat sebagai `invoice.paid_after_void` dan muncul di Perlu tindakan.
- Prorata saat ganti paket di tengah periode. Paket baru berlaku mulai dibayar.
- Peran admin bertingkat. Semua admin punya hak penuh.
