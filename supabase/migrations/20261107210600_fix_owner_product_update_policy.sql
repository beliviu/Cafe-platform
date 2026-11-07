alter table public.products enable row level security;

grant update on public.products to authenticated;

drop policy if exists "Owners can update their cafe products"
  on public.products;

create policy "Owners can update their cafe products"
  on public.products for update
  to authenticated
  using (
    public.has_cafe_role(cafe_id, array['owner']::public.app_role[])
  )
  with check (
    public.has_cafe_role(cafe_id, array['owner']::public.app_role[])
  );
