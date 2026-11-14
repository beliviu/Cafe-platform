-- =====================================================================
-- 13 · Pesan tanpa login lewat QR meja (tamu)
-- ---------------------------------------------------------------------
-- App memakai Supabase "Anonymous Sign-ins": pelanggan yang scan QR meja
-- otomatis mendapat sesi tamu (tanpa email/password). Sesi tamu tetap
-- punya auth.uid(), jadi semua aturan keamanan (RLS) tetap berlaku —
-- tamu hanya bisa melihat pesanannya sendiri.
--
-- Akun TAMU hanya boleh membuat pesanan untuk MEJA (table_id terisi) dan
-- wajib memiliki nama. Voucher, poin, pesanan bawa pulang, dan jadwal tetap
-- memerlukan akun customer biasa.
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
declare
  v_customer_name text;
begin
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) and new.table_id is null then
    raise exception 'Pesan tanpa login hanya bisa lewat QR meja. Masuk atau daftar untuk pesan bawa pulang.'
      using errcode = '42501', hint = 'guest_table_only';
  end if;
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    select p.full_name
    into v_customer_name
    from public.profiles p
    where p.id = new.customer_id;

    if nullif(btrim(v_customer_name), '') is null or char_length(btrim(v_customer_name)) > 60 then
      raise exception 'Nama wajib diisi (maksimal 60 karakter) untuk memesan sebagai tamu.'
        using errcode = '22023', hint = 'guest_name_required';
    end if;
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
