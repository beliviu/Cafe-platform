alter table public.orders
  add column if not exists payment_method text,
  add column if not exists notes text;

notify pgrst, 'reload schema';
