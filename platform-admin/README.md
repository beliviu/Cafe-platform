# Dailybrew Platform (`platform-admin`)

Dashboard khusus **pemilik SaaS Dailybrew** (bukan owner kafe). Fungsinya menggantikan pekerjaan manual di SQL Editor untuk mengelola kafe yang berlangganan:

- **Ringkasan:** jumlah kafe aktif, masa coba, dan nonaktif; MRR dan pendapatan bulan ini dibanding bulan lalu; tagihan yang telat.
- **Kafe:** cari, saring per status dan paket, dan buat **kafe baru sekaligus akun owner-nya**.
- **Detail kafe:** profil, owner (termasuk reset password), paket, pemakaian dibanding batas, aksi nonaktifkan dan aktifkan, ganti paket, perpanjang, beri masa coba, dan buat tagihan.
- **Paket:** nama, harga, batas staff/meja/menu, modul, publik atau arsip.
- **Tagihan:** status menunggu, telat, lunas, dan batal; tombol **Tandai lunas** untuk transfer bank. Pembayaran Midtrans lunas otomatis.
- **Log audit:** siapa, kapan, aksi apa, di kafe mana, dan nilai sebelum dan sesudah.
- **Login email + password**, ditambah **2FA TOTP wajib** (Supabase Auth MFA, sesi `aal2`).

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
Token warna, font, `AppShell`, dan komponen `ui/` **disalin** dari `web-dashboard`. Tiap file salinan punya baris pertama `Salinan dari web-dashboard/…`. Alasannya:
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

### 5. Jadwalkan penagihan otomatis (pg_cron)
Dashboard → **Database → Extensions** → aktifkan **pg_cron**, lalu jalankan di SQL Editor:
```sql
select cron.schedule('dailybrew-tagihan-harian', '0 1 * * *', $$select public.pa_billing_run()$$);
```
Jadwal ini berjalan setiap hari pukul 08.00 WIB:
- Tagihan 1 bulan dibuat otomatis **H-7** sebelum masa coba atau periode berakhir (hanya untuk paket berbayar dan kafe yang aktif).
- Langganan yang lewat jatuh tempo ditandai `past_due`. Fitur tetap jalan selama **tenggang 7 hari**, lalu turun ke paket Basic sampai tagihan dibayar.
- Snapshot MRR bulanan disimpan untuk perbandingan dengan bulan lalu.

Cek jadwal: `select * from cron.job;` · Hapus jadwal: `select cron.unschedule('dailybrew-tagihan-harian');`

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

## Belum termasuk versi ini
- Email atau WhatsApp pengingat tagihan.
- Refund otomatis untuk pembayaran yang masuk setelah tagihan dibatalkan. Kasus ini tercatat di log audit sebagai `invoice.paid_after_void` untuk ditangani manual.
- Prorata saat ganti paket di tengah periode. Paket baru berlaku mulai dibayar.
- Peran admin bertingkat. Semua admin punya hak penuh.
