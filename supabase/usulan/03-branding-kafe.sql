-- =====================================================================
-- 03 · BRANDING KAFE: nama tampilan web/app, logo, tagline, warna brand
-- Jalankan manual di Supabase SQL Editor SETELAH 01 dan 02.
-- Semua dalam satu transaksi: kalau ada error, tidak ada yang berubah.
--
-- Data yang tersentuh:
--   - Menambah kolom BARU di cafes (semua boleh kosong, nilai lama tidak diubah).
--   - Membuat bucket storage baru 'cafe-assets' (logo), terpisah dari foto produk.
--   - Tidak ada DELETE / DROP TABLE / TRUNCATE / UPDATE baris lama.
--
-- Siapa boleh mengubah: hanya OWNER kafe itu sendiri (policy dari file 02,
-- "Owners can update their cafe"). Staff & customer hanya bisa membaca.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- A. Kolom branding (kosong = pakai default: nama kafe & warna bawaan)
-- ---------------------------------------------------------------------
alter table public.cafes
  add column if not exists app_name text,
  add column if not exists logo_url text,
  add column if not exists tagline text,
  add column if not exists brand_color text;

-- Batasan isi (ditambahkan hanya jika belum ada)
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.cafes'::regclass and conname = 'cafes_app_name_length') then
    alter table public.cafes add constraint cafes_app_name_length
      check (app_name is null or char_length(trim(app_name)) between 2 and 40);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.cafes'::regclass and conname = 'cafes_tagline_length') then
    alter table public.cafes add constraint cafes_tagline_length
      check (tagline is null or char_length(tagline) <= 80);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.cafes'::regclass and conname = 'cafes_brand_color_hex') then
    alter table public.cafes add constraint cafes_brand_color_hex
      check (brand_color is null or brand_color ~ '^#[0-9A-Fa-f]{6}$');
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.cafes'::regclass and conname = 'cafes_logo_url_https') then
    alter table public.cafes add constraint cafes_logo_url_https
      check (logo_url is null or (logo_url ~ '^https://' and char_length(logo_url) <= 500));
  end if;
end;
$$;

-- Owner boleh mengubah kolom branding (policy UPDATE owner sudah ada dari file 02)
grant update (app_name, logo_url, tagline, brand_color) on public.cafes to authenticated;

-- ---------------------------------------------------------------------
-- B. Bucket logo: publik untuk dibaca, hanya owner kafe yang menulis
--    Path wajib: <cafe_id>/<nama-file>. SVG ditolak (bisa berisi script).
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cafe-assets', 'cafe-assets', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public can view cafe assets" on storage.objects;
create policy "Public can view cafe assets"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'cafe-assets');

drop policy if exists "Cafe owners can upload cafe assets" on storage.objects;
create policy "Cafe owners can upload cafe assets"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'cafe-assets'
    and exists (
      select 1 from public.profiles as p
      where p.id = (select auth.uid())
        and p.role = 'owner'
        and p.cafe_id::text = (storage.foldername(name))[1]
    )
  );

drop policy if exists "Cafe owners can update cafe assets" on storage.objects;
create policy "Cafe owners can update cafe assets"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'cafe-assets'
    and exists (
      select 1 from public.profiles as p
      where p.id = (select auth.uid())
        and p.role = 'owner'
        and p.cafe_id::text = (storage.foldername(name))[1]
    )
  )
  with check (
    bucket_id = 'cafe-assets'
    and exists (
      select 1 from public.profiles as p
      where p.id = (select auth.uid())
        and p.role = 'owner'
        and p.cafe_id::text = (storage.foldername(name))[1]
    )
  );

drop policy if exists "Cafe owners can delete cafe assets" on storage.objects;
create policy "Cafe owners can delete cafe assets"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'cafe-assets'
    and exists (
      select 1 from public.profiles as p
      where p.id = (select auth.uid())
        and p.role = 'owner'
        and p.cafe_id::text = (storage.foldername(name))[1]
    )
  );

notify pgrst, 'reload schema';

commit;

-- Verifikasi: harus muncul 4 kolom + 1 bucket + 4 policy
select 'column' as kind, column_name as name
from information_schema.columns
where table_schema = 'public' and table_name = 'cafes'
  and column_name in ('app_name', 'logo_url', 'tagline', 'brand_color')
union all
select 'bucket', id from storage.buckets where id = 'cafe-assets'
union all
select 'policy', policyname from pg_policies
where schemaname = 'storage' and tablename = 'objects' and policyname ilike '%cafe assets%'
order by 1, 2;
