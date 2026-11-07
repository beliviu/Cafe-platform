-- =====================================================================
-- 01 · TUTUP CELAH KEAMANAN PROFIL  (PRIORITAS — jalankan duluan)
-- Jalankan manual di Supabase SQL Editor. Tidak mengubah/menghapus data.
--
-- Masalah:
--   Policy "Users update own profile" tidak punya WITH CHECK dan role
--   `authenticated` punya UPDATE di SEMUA kolom profiles. Customer mana pun
--   bisa menjalankan (lewat API publik):
--     update profiles set role = 'owner', cafe_id = '<id kafe>' where id = auth.uid()
--   lalu mendapat akses owner penuh.
--
-- Perbaikan:
--   - Klien hanya boleh mengubah full_name & phone milik sendiri.
--   - Fungsi lama create_order(jsonb) (tanpa cek login) tidak bisa dipanggil
--     dari API lagi. Fungsinya tidak dihapus; app memakai versi 4 argumen.
--
-- Dampak ke app: tidak ada. Profil customer tetap bisa ganti nama
-- (dan nanti nomor HP). Pembuatan profil saat daftar tetap lewat trigger
-- handle_new_user (security definer), tidak terpengaruh.
-- =====================================================================

begin;

-- 1. Kolom profil: hanya full_name & phone yang boleh diubah klien
revoke insert, update, delete, truncate on public.profiles from anon, authenticated;
grant update (full_name, phone) on public.profiles to authenticated;

-- 2. Policy update: hanya baris sendiri, dan hasil update tetap baris sendiri
drop policy if exists "Users update own profile" on public.profiles;
create policy "Users update own profile"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- 3. Fungsi lama tanpa cek login
revoke execute on function public.create_order(jsonb) from public, anon, authenticated;

commit;

-- Verifikasi (harus muncul tepat 2 baris: full_name, phone)
select column_name, privilege_type
from information_schema.column_privileges
where table_schema = 'public'
  and table_name = 'profiles'
  and grantee = 'authenticated'
  and privilege_type = 'UPDATE'
order by column_name;
