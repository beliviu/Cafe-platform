-- =====================================================================
-- 13 · Pesan tanpa login lewat QR meja (tamu)
-- ---------------------------------------------------------------------
-- App memakai Supabase "Anonymous Sign-ins": pelanggan yang scan QR meja
-- otomatis mendapat sesi tamu (tanpa email/password). Sesi tamu tetap
-- punya auth.uid(), jadi semua aturan keamanan (RLS) tetap berlaku —
-- tamu hanya bisa melihat pesanannya sendiri.
--
-- File ini menambah satu pengaman: akun TAMU hanya boleh membuat pesanan
-- untuk MEJA (table_id terisi). Pesan bawa pulang / terjadwal tetap wajib
-- login dengan akun biasa.
--
-- WAJIB setelah menjalankan file ini:
--   Supabase Dashboard → Authentication → Sign In / Providers →
--   nyalakan "Allow anonymous sign-ins" → Save.
--
-- Aman dijalankan ulang. Tidak mengubah data yang sudah ada.
-- =====================================================================

create or replace function public.orders_guest_table_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) and new.table_id is null then
    raise exception 'Pesan tanpa login hanya bisa lewat QR meja. Masuk atau daftar untuk pesan bawa pulang.'
      using errcode = '42501', hint = 'guest_table_only';
  end if;
  return new;
end;
$$;

drop trigger if exists orders_guest_table_only on public.orders;
create trigger orders_guest_table_only
  before insert on public.orders
  for each row execute function public.orders_guest_table_only();

-- Verifikasi: harus 1 baris
select tgname as trigger_terpasang
from pg_trigger
where tgname = 'orders_guest_table_only' and not tgisinternal;
