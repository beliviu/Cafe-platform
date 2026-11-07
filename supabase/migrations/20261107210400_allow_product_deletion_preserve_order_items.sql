alter table public.order_items
  drop constraint order_items_product_same_cafe_fk;

alter table public.order_items
  alter column product_id drop not null;

alter table public.order_items
  add constraint order_items_product_id_fkey
  foreign key (product_id)
  references public.products (id)
  on delete set null;
