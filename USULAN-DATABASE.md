# Usulan perubahan database — dailybrew

> Dokumen ini **hanya usulan**. Tidak ada SQL yang dijalankan oleh Claude.
> Semua perubahan dijalankan manual oleh owner di Supabase SQL Editor.
> Setiap fitur UI yang bergantung pada usulan ini punya *fallback* aman: kalau perubahan belum diterapkan, bagian itu disembunyikan/nonaktif dengan keterangan.

## Status

| Langkah | Status |
|---|---|
| 0. Cek kondisi database (read-only) | ⏳ menunggu hasil query di bawah |
| 1. Migrasi inti (pembayaran, batal, antrean, riwayat status, nama customer) | 📝 draf — SQL final ditulis setelah hasil langkah 0 |
| 2. Migrasi checkout v2 (dine-in/meja, catatan per item, metode bayar) | 📝 draf — dibutuhkan di fase 5 |

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

---

## Langkah 1 — migrasi inti (draf, SQL final menyusul)

| # | Perubahan | Untuk fitur | Fallback UI sebelum diterapkan |
|---|---|---|---|
| A | RPC `staff_mark_order_paid(order_id, method)` — `security definer`, cek pemanggil owner/staff kafe itu lewat `profiles`; insert `payments` (`status/payment_status = 'paid'`, `paid_at = now()`), update `orders.payment_status = 'paid'` + `payment_method`. Tambah kolom `orders.paid_at`. | Tombol **Tandai lunas** (staff & owner), pendapatan dashboard | Tombol nonaktif: "Perlu pembaruan database". Dashboard menampilkan *Nilai pesanan selesai (belum tercatat lunas)* terpisah dari *Pendapatan lunas*. |
| B | Izinkan transisi ke `cancelled` dari `pending/confirmed/preparing/ready` + RPC `staff_cancel_order(order_id, reason)`; kolom `orders.cancel_reason`, `orders.cancelled_at`. | Tombol **Batalkan** dengan alasan | Tombol batal disembunyikan. |
| C | Kolom `orders.queue_number int` + trigger `before insert` (urutan per kafe per hari WIB) + isi kolom baru untuk pesanan lama (hanya mengisi kolom baru, data lama tidak diubah). | Nomor antrean **A-012** di 3 aplikasi | `#9334` = 4 digit terakhir `order_number` (deterministik, sama di 3 aplikasi). |
| D | Tabel `order_status_events (order_id, status, changed_by, created_at)` + trigger `after update of order_status`; RLS: owner/staff kafe & customer pemilik pesanan boleh baca. | Timeline status & "diproses oleh" di detail transaksi; estimasi di customer | Timeline hanya menampilkan waktu dibuat & status sekarang. |
| E | RPC nama customer untuk **owner** (sekarang `staff_order_customer_names` hanya untuk role staff). | Kolom Customer di Transaksi owner | "Pelanggan" + 4 karakter ID. |
| F | RPC `staff_set_product_availability(product_id, is_available)` — hanya kolom `is_available`. | Toggle cepat **Produk habis** di staff | Toggle disembunyikan untuk staff. |
| G | Policy baca produk: customer boleh melihat produk `is_available = false` (checkout tetap menolak). | Produk **Habis** tampil abu-abu di menu | Produk habis tidak tampil (seperti sekarang). |
| H | `grant update (phone)` + policy: customer hanya baris profilnya sendiri. | Edit nomor HP di profil | Field HP hanya-baca/disembunyikan. |
| I | `cafes.opening_hours jsonb`, `cafes.description text`. | Jam buka, status Buka/Tutup, halaman Pengaturan | Bagian jam buka disembunyikan. |

## Langkah 2 — checkout v2 (draf, untuk fase 5)

| # | Perubahan | Untuk fitur |
|---|---|---|
| J | Kolom `orders.order_type` (`dine_in`/`takeaway`), `orders.table_number`. | Pilihan dine-in + nomor meja di checkout; tampil di kartu staff |
| K | Fungsi **baru** `create_order_v2(...)` (fungsi lama tetap ada): menerima catatan per item (`order_items.notes`), `order_type`, `table_number`, metode `cash/qris/bank_transfer/ewallet`. | Kustomisasi tanpa biaya (gula, es) sebagai catatan item; metode bayar lebih lengkap |
| L | *(Ditunda)* Varian berbayar (ukuran S/M/L) butuh tabel opsi produk + harga tambahan di `create_order_v2`. | Opsi varian dengan harga berbeda |
