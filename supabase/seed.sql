insert into public.cafes (id, name, slug, description, logo_url)
values (
  '11111111-1111-4111-8111-111111111111',
  'Kopi Senja',
  'kopi-senja-demo',
  'Kopi lokal, pastry hangat, dan ruang nyaman untuk jeda sejenak.',
  'https://images.unsplash.com/photo-1442512595331-e89e73853f31?auto=format&fit=crop&w=256&q=80'
)
on conflict (id) do update
set name = excluded.name,
    slug = excluded.slug,
    description = excluded.description,
    logo_url = excluded.logo_url;

insert into public.categories (id, cafe_id, name)
values
  ('22222222-2222-4222-8222-222222222221', '11111111-1111-4111-8111-111111111111', 'Kopi'),
  ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'Non-kopi'),
  ('22222222-2222-4222-8222-222222222223', '11111111-1111-4111-8111-111111111111', 'Pastry')
on conflict (id) do update
set cafe_id = excluded.cafe_id,
    name = excluded.name;

insert into public.products (
  id, cafe_id, category_id, name, description, price, image_url, is_available
)
values
  (
    '33333333-3333-4333-8333-333333333331',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222221',
    'Es Kopi Susu Senja',
    'Espresso, susu segar, dan gula aren.',
    28000,
    'https://images.unsplash.com/photo-1461023058943-07fcbe16d735?auto=format&fit=crop&w=800&q=80',
    true
  ),
  (
    '33333333-3333-4333-8333-333333333332',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222221',
    'Cappuccino',
    'Double espresso dengan susu steamed dan foam lembut.',
    32000,
    'https://images.unsplash.com/photo-1534778101976-62847782c213?auto=format&fit=crop&w=800&q=80',
    true
  ),
  (
    '33333333-3333-4333-8333-333333333333',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    'Matcha Latte',
    'Matcha Jepang dengan susu pilihan.',
    35000,
    'https://images.unsplash.com/photo-1515823064-d6e0c04616a7?auto=format&fit=crop&w=800&q=80',
    true
  ),
  (
    '33333333-3333-4333-8333-333333333334',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222223',
    'Butter Croissant',
    'Croissant berlapis dengan butter dan dipanggang setiap pagi.',
    24000,
    'https://images.unsplash.com/photo-1555507036-ab1f4038808a?auto=format&fit=crop&w=800&q=80',
    true
  )
on conflict (id) do update
set cafe_id = excluded.cafe_id,
    category_id = excluded.category_id,
    name = excluded.name,
    description = excluded.description,
    price = excluded.price,
    image_url = excluded.image_url,
    is_available = excluded.is_available;
