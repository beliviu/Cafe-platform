insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images',
  'product-images',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "Public can view product images"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'product-images');

create policy "Cafe owners can upload product images"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'product-images'
    and exists (
      select 1
      from public.profiles as p
      where p.id = (select auth.uid())
        and p.role = 'owner'
        and p.cafe_id::text = (storage.foldername(name))[1]
    )
  );

create policy "Cafe owners can update product images"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'product-images'
    and exists (
      select 1
      from public.profiles as p
      where p.id = (select auth.uid())
        and p.role = 'owner'
        and p.cafe_id::text = (storage.foldername(name))[1]
    )
  )
  with check (
    bucket_id = 'product-images'
    and exists (
      select 1
      from public.profiles as p
      where p.id = (select auth.uid())
        and p.role = 'owner'
        and p.cafe_id::text = (storage.foldername(name))[1]
    )
  );

create policy "Cafe owners can delete product images"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'product-images'
    and exists (
      select 1
      from public.profiles as p
      where p.id = (select auth.uid())
        and p.role = 'owner'
        and p.cafe_id::text = (storage.foldername(name))[1]
    )
  );
