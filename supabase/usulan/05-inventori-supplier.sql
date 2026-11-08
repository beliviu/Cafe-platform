-- =====================================================================
-- 05 · INVENTORI, RESEP & SUPPLIER (Fase 1 roadmap V2)
--   A. Pengaturan inventori per kafe (cafe_settings)
--   B. Supplier & katalog bahan per supplier
--   C. Bahan baku (ingredients) + batch kedaluwarsa
--   D. Resep per produk (+ tambahan per varian)
--   E. Mutasi stok (buku besar stok, tidak bisa diubah) + fungsi inti
--   F. Stok masuk / keluar / penyesuaian / stok opname
--   G. Purchase order: draf → dipesan → diterima, pembayaran supplier (utang)
--   H. HPP per produk, profit produk, perkiraan kebutuhan stok
--   I. Pemakaian bahan otomatis saat pesanan SELESAI (hanya jika owner menyalakan)
--   J. Log aktivitas untuk tabel baru
--
-- Jalankan manual di Supabase SQL Editor SETELAH 04-owner-dashboard.sql.
-- Semua dalam satu transaksi: kalau ada error, tidak ada yang berubah.
--
-- Dampak ke data yang sudah ada:
--   - cafe_settings: 4 kolom BARU dengan nilai bawaan. Pelacakan stok MATI
--     sampai owner menyalakannya → perilaku pesanan sama persis seperti sekarang.
--   - log_audit_event: dibuat ulang hanya untuk membaca label "po_number".
--   - orders: ditambah SATU trigger AFTER UPDATE. Trigger hanya bekerja bila
--     pelacakan stok aktif DAN pesanan berubah menjadi "completed". Kalau
--     pencatatan stok gagal, pesanan TETAP selesai; kegagalan dicatat di
--     inventory_sync_issues untuk ditinjau owner. Kolom pesanan tidak diubah.
--   - Tabel lain: hanya tabel BARU. Tidak ada UPDATE/DELETE/DROP pada data lama.
-- Akses: semua data inventori hanya untuk OWNER kafe itu (RLS). Staff & customer
-- tidak bisa membaca harga modal, supplier, atau stok.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0. Pemeriksaan awal (berhenti dengan pesan jelas bila prasyarat belum ada)
-- ---------------------------------------------------------------------
do $$
declare
  v_missing text;
begin
  if to_regclass('public.cafe_settings') is null
     or to_regclass('public.audit_logs') is null
     or to_regclass('public.product_options') is null then
    raise exception 'File 04-owner-dashboard.sql belum dijalankan. Jalankan file 04 dulu, lalu ulangi file ini.';
  end if;

  select string_agg(need.tbl || '.' || need.col, ', ')
  into v_missing
  from (values
    ('orders', 'id'), ('orders', 'cafe_id'), ('orders', 'order_status'), ('orders', 'created_at'),
    ('order_items', 'id'), ('order_items', 'order_id'), ('order_items', 'product_id'),
    ('order_items', 'product_name'), ('order_items', 'quantity'), ('order_items', 'price'),
    ('order_items', 'subtotal'), ('products', 'price'), ('products', 'is_available')
  ) as need (tbl, col)
  where not exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = need.tbl and c.column_name = need.col
  );
  if v_missing is not null then
    raise exception 'Kolom yang dibutuhkan tidak ditemukan: %. Kirim pesan ini ke developer.', v_missing;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- A. Pengaturan inventori
-- ---------------------------------------------------------------------
alter table public.cafe_settings
  add column if not exists inventory_tracking boolean not null default false,
  add column if not exists inventory_started_at timestamptz,
  add column if not exists expiry_alert_days smallint not null default 3,
  add column if not exists reorder_cover_days smallint not null default 7;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.cafe_settings'::regclass and conname = 'cafe_settings_expiry_alert_days_range') then
    alter table public.cafe_settings add constraint cafe_settings_expiry_alert_days_range check (expiry_alert_days between 0 and 60);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.cafe_settings'::regclass and conname = 'cafe_settings_reorder_cover_days_range') then
    alter table public.cafe_settings add constraint cafe_settings_reorder_cover_days_range check (reorder_cover_days between 1 and 60);
  end if;
end;
$$;

-- inventory_tracking hanya lewat RPC (agar tanggal mulai tercatat)
grant update (expiry_alert_days, reorder_cover_days) on public.cafe_settings to authenticated;

-- Helper: pemanggil wajib owner aktif kafe ini
create or replace function public.inv_require_owner(p_cafe_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Login diperlukan' using errcode = '28000';
  end if;
  if p_cafe_id is null or not public.is_cafe_member(p_cafe_id, array['owner']) then
    raise exception 'Hanya owner kafe ini yang bisa mengelola inventori' using errcode = '42501';
  end if;
end;
$$;
revoke all on function public.inv_require_owner(uuid) from public, anon, authenticated;

create or replace function public.inv_clean_text(p_value text, p_max integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select left(nullif(btrim(regexp_replace(coalesce(p_value, ''), '\s+', ' ', 'g')), ''), p_max);
$$;

create or replace function public.inventory_set_tracking(p_cafe_id uuid, p_enabled boolean)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_started timestamptz;
begin
  perform public.inv_require_owner(p_cafe_id);
  update public.cafe_settings
  set inventory_tracking = coalesce(p_enabled, false),
      inventory_started_at = case
        when coalesce(p_enabled, false) then coalesce(case when inventory_tracking then inventory_started_at end, now())
        else null
      end
  where cafe_id = p_cafe_id
  returning inventory_started_at into v_started;
  if not found then
    raise exception 'Pengaturan kafe tidak ditemukan' using errcode = 'P0002';
  end if;
  return v_started;
end;
$$;
revoke all on function public.inventory_set_tracking(uuid, boolean) from public, anon;
grant execute on function public.inventory_set_tracking(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- B. Supplier
-- ---------------------------------------------------------------------
create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  cafe_id uuid not null references public.cafes (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  contact_name text check (contact_name is null or char_length(contact_name) <= 80),
  phone text check (phone is null or char_length(phone) <= 30),
  email text check (email is null or char_length(email) <= 254),
  address text check (address is null or char_length(address) <= 300),
  payment_terms_days smallint not null default 0 check (payment_terms_days between 0 and 180),
  notes text check (notes is null or char_length(notes) <= 500),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists suppliers_cafe_name_key on public.suppliers (cafe_id, lower(btrim(name)));

drop trigger if exists touch_updated_at on public.suppliers;
create trigger touch_updated_at before update on public.suppliers
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- C. Bahan baku. Satuan dasar: g, ml, atau pcs. Semua jumlah stok dalam satuan dasar.
--    on_hand & avg_cost hanya diubah oleh fungsi mutasi (tidak ada izin UPDATE langsung).
-- ---------------------------------------------------------------------
create table if not exists public.ingredients (
  id uuid primary key default gen_random_uuid(),
  cafe_id uuid not null references public.cafes (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  sku text check (sku is null or char_length(sku) between 1 and 40),
  category text check (category is null or char_length(category) <= 40),
  unit text not null check (unit in ('g', 'ml', 'pcs')),
  min_stock numeric(14, 3) not null default 0 check (min_stock >= 0),
  on_hand numeric(14, 3) not null default 0,
  avg_cost numeric(14, 4) not null default 0 check (avg_cost >= 0),
  last_purchase_cost numeric(14, 4) check (last_purchase_cost is null or last_purchase_cost >= 0),
  default_supplier_id uuid references public.suppliers (id) on delete set null,
  purchase_unit text check (purchase_unit is null or char_length(purchase_unit) between 1 and 20),
  purchase_unit_size numeric(14, 3) check (purchase_unit_size is null or purchase_unit_size > 0),
  lead_time_days smallint not null default 2 check (lead_time_days between 0 and 60),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists ingredients_cafe_name_key on public.ingredients (cafe_id, lower(btrim(name)));
create unique index if not exists ingredients_cafe_sku_key on public.ingredients (cafe_id, lower(sku)) where sku is not null;

drop trigger if exists touch_updated_at on public.ingredients;
create trigger touch_updated_at before update on public.ingredients
  for each row execute function public.touch_updated_at();

-- Batch hanya untuk melacak kedaluwarsa (stok masuk yang diberi tanggal kedaluwarsa)
create table if not exists public.ingredient_batches (
  id uuid primary key default gen_random_uuid(),
  cafe_id uuid not null references public.cafes (id) on delete cascade,
  ingredient_id uuid not null references public.ingredients (id) on delete cascade,
  expires_at date not null,
  quantity numeric(14, 3) not null check (quantity > 0),
  remaining numeric(14, 3) not null check (remaining >= 0),
  received_at timestamptz not null default now()
);
create index if not exists ingredient_batches_open_idx
  on public.ingredient_batches (ingredient_id, expires_at) where remaining > 0;
create index if not exists ingredient_batches_cafe_expiry_idx
  on public.ingredient_batches (cafe_id, expires_at) where remaining > 0;

-- Satu baris katalog per (supplier, bahan): kode & harga terakhir dari supplier itu
create table if not exists public.supplier_items (
  id uuid primary key default gen_random_uuid(),
  cafe_id uuid not null references public.cafes (id) on delete cascade,
  supplier_id uuid not null references public.suppliers (id) on delete cascade,
  ingredient_id uuid not null references public.ingredients (id) on delete cascade,
  supplier_sku text check (supplier_sku is null or char_length(supplier_sku) <= 40),
  unit_label text check (unit_label is null or char_length(unit_label) between 1 and 20),
  unit_size numeric(14, 3) not null default 1 check (unit_size > 0),
  last_price numeric(14, 2) check (last_price is null or last_price >= 0),
  last_purchased_at timestamptz,
  created_at timestamptz not null default now(),
  unique (supplier_id, ingredient_id)
);

-- Data milik kafe yang sama: cafe_id tidak dipercaya dari klien
create or replace function public.inv_check_ingredient_refs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.default_supplier_id is not null and not exists (
    select 1 from public.suppliers s where s.id = new.default_supplier_id and s.cafe_id = new.cafe_id
  ) then
    raise exception 'Supplier tidak ditemukan di kafe ini' using errcode = '23503';
  end if;
  if tg_op = 'UPDATE' and new.cafe_id is distinct from old.cafe_id then
    raise exception 'Kafe bahan tidak bisa dipindah' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.unit is distinct from old.unit and (
    exists (select 1 from public.stock_movements m where m.ingredient_id = new.id)
    or exists (select 1 from public.recipe_items r where r.ingredient_id = new.id)
  ) then
    raise exception 'Satuan tidak bisa diubah karena bahan sudah punya riwayat stok atau dipakai di resep' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function public.inv_check_ingredient_refs() from public, anon, authenticated;

create or replace function public.inv_set_supplier_item_cafe()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select s.cafe_id into new.cafe_id from public.suppliers s where s.id = new.supplier_id;
  if new.cafe_id is null then
    raise exception 'Supplier tidak ditemukan' using errcode = '23503';
  end if;
  if not exists (select 1 from public.ingredients i where i.id = new.ingredient_id and i.cafe_id = new.cafe_id) then
    raise exception 'Bahan tidak ditemukan di kafe ini' using errcode = '23503';
  end if;
  return new;
end;
$$;
revoke all on function public.inv_set_supplier_item_cafe() from public, anon, authenticated;

drop trigger if exists inv_set_supplier_item_cafe on public.supplier_items;
create trigger inv_set_supplier_item_cafe
  before insert or update of supplier_id, ingredient_id, cafe_id on public.supplier_items
  for each row execute function public.inv_set_supplier_item_cafe();

-- ---------------------------------------------------------------------
-- D. Resep: bahan per 1 porsi produk. option_id terisi = tambahan bila varian itu dipilih.
-- ---------------------------------------------------------------------
create table if not exists public.recipe_items (
  id uuid primary key default gen_random_uuid(),
  cafe_id uuid not null references public.cafes (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  option_id uuid references public.product_options (id) on delete cascade,
  ingredient_id uuid not null references public.ingredients (id),
  quantity numeric(14, 3) not null check (quantity > 0 and quantity <= 1000000),
  created_at timestamptz not null default now()
);
create unique index if not exists recipe_items_base_key
  on public.recipe_items (product_id, ingredient_id) where option_id is null;
create unique index if not exists recipe_items_option_key
  on public.recipe_items (option_id, ingredient_id) where option_id is not null;
create index if not exists recipe_items_ingredient_idx on public.recipe_items (ingredient_id);
create index if not exists recipe_items_cafe_idx on public.recipe_items (cafe_id);

-- ---------------------------------------------------------------------
-- E. Mutasi stok: setiap perubahan stok = 1 baris. Tidak bisa diubah.
--    quantity bertanda (+ masuk, − keluar) dalam satuan dasar bahan.
-- ---------------------------------------------------------------------
create table if not exists public.stock_counts (
  id uuid primary key default gen_random_uuid(),
  cafe_id uuid not null references public.cafes (id) on delete cascade,
  note text check (note is null or char_length(note) <= 300),
  line_count integer not null default 0,
  difference_value numeric(16, 2) not null default 0,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists stock_counts_cafe_idx on public.stock_counts (cafe_id, created_at desc);

create table if not exists public.stock_count_lines (
  id uuid primary key default gen_random_uuid(),
  cafe_id uuid not null references public.cafes (id) on delete cascade,
  stock_count_id uuid not null references public.stock_counts (id) on delete cascade,
  ingredient_id uuid not null references public.ingredients (id),
  system_qty numeric(14, 3) not null,
  counted_qty numeric(14, 3) not null check (counted_qty >= 0),
  difference numeric(14, 3) generated always as (counted_qty - system_qty) stored,
  unit_cost numeric(14, 4) not null default 0,
  unique (stock_count_id, ingredient_id)
);

create table if not exists public.stock_movements (
  id bigint generated always as identity primary key,
  cafe_id uuid not null references public.cafes (id) on delete cascade,
  ingredient_id uuid not null references public.ingredients (id),
  movement_type text not null check (movement_type in (
    'opening', 'purchase', 'sale', 'adjustment', 'opname', 'waste', 'damaged', 'expired', 'usage', 'return'
  )),
  quantity numeric(14, 3) not null check (quantity <> 0),
  unit_cost numeric(14, 4) not null check (unit_cost >= 0),
  total_cost numeric(16, 2) generated always as (round(quantity * unit_cost, 2)) stored,
  balance_after numeric(14, 3) not null,
  avg_cost_after numeric(14, 4) not null,
  batch_id uuid references public.ingredient_batches (id),
  supplier_id uuid references public.suppliers (id),
  purchase_order_id uuid,
  stock_count_id uuid references public.stock_counts (id),
  -- Referensi pesanan sengaja tanpa foreign key: pesanan tidak pernah terhalang oleh tabel stok
  order_id uuid,
  order_item_id uuid,
  product_id uuid,
  note text check (note is null or char_length(note) <= 300),
  created_by uuid default auth.uid(),
  occurred_at timestamptz not null default now()
);
create index if not exists stock_movements_cafe_time_idx on public.stock_movements (cafe_id, occurred_at desc);
create index if not exists stock_movements_ingredient_time_idx on public.stock_movements (ingredient_id, occurred_at desc);
create index if not exists stock_movements_po_idx on public.stock_movements (purchase_order_id) where purchase_order_id is not null;
create index if not exists stock_movements_order_idx on public.stock_movements (order_id) where order_id is not null;
-- Satu pemakaian per (item pesanan, bahan): pemakaian tidak bisa tercatat dobel
create unique index if not exists stock_movements_sale_once
  on public.stock_movements (order_item_id, ingredient_id) where movement_type = 'sale';

create or replace function public.inv_block_movement_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Mutasi stok tidak bisa diubah. Buat mutasi koreksi.' using errcode = '42501';
end;
$$;
drop trigger if exists inv_block_movement_update on public.stock_movements;
create trigger inv_block_movement_update before update on public.stock_movements
  for each row execute function public.inv_block_movement_update();

-- Kegagalan pencatatan stok otomatis (pesanan tetap selesai) — untuk ditinjau owner
create table if not exists public.inventory_sync_issues (
  id bigint generated always as identity primary key,
  cafe_id uuid not null references public.cafes (id) on delete cascade,
  order_id uuid,
  message text not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists inventory_sync_issues_open_idx on public.inventory_sync_issues (cafe_id, created_at desc) where resolved_at is null;

-- Fungsi inti: kunci bahan, hitung saldo & harga rata-rata, tulis mutasi, kurangi batch (FEFO)
create or replace function public.inv_apply_movement(
  p_ingredient_id uuid,
  p_type text,
  p_quantity numeric,
  p_unit_cost numeric default null,
  p_expires_at date default null,
  p_note text default null,
  p_refs jsonb default '{}'::jsonb,
  p_allow_negative boolean default false
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ing public.ingredients%rowtype;
  v_cost numeric(14, 4);
  v_new_qty numeric(14, 3);
  v_new_avg numeric(14, 4);
  v_batch_id uuid;
  v_movement_id bigint;
  v_left numeric(14, 3);
  v_take numeric(14, 3);
  v_batch record;
  v_pick uuid := nullif(p_refs ->> 'batch_id', '')::uuid;
begin
  if p_quantity is null or p_quantity = 0 then
    raise exception 'Jumlah tidak boleh nol' using errcode = '22023';
  end if;
  if abs(p_quantity) > 100000000 then
    raise exception 'Jumlah terlalu besar' using errcode = '22023';
  end if;

  select * into v_ing from public.ingredients where id = p_ingredient_id for update;
  if not found then
    raise exception 'Bahan tidak ditemukan' using errcode = 'P0002';
  end if;

  v_new_qty := v_ing.on_hand + p_quantity;
  if p_type in ('opening', 'purchase') then
    if p_quantity < 0 then
      raise exception 'Stok masuk harus bernilai positif' using errcode = '22023';
    end if;
    if p_unit_cost is null or p_unit_cost < 0 then
      raise exception 'Harga per satuan wajib diisi' using errcode = '22023';
    end if;
    v_cost := p_unit_cost;
    -- Rata-rata tertimbang bergerak; stok kosong/minus → harga baru
    v_new_avg := case
      when v_ing.on_hand <= 0 then p_unit_cost
      else round((v_ing.on_hand * v_ing.avg_cost + p_quantity * p_unit_cost) / v_new_qty, 4)
    end;
  else
    v_cost := v_ing.avg_cost;
    v_new_avg := v_ing.avg_cost;
    -- Selisih lebih saat bahan belum punya harga: pakai harga yang diberikan (bila ada)
    if p_quantity > 0 and v_ing.avg_cost = 0 and p_unit_cost is not null and p_unit_cost > 0 then
      v_cost := p_unit_cost;
      v_new_avg := p_unit_cost;
    end if;
  end if;

  if v_new_qty < 0 and not p_allow_negative then
    raise exception 'Stok % tidak cukup: tersedia % %', v_ing.name, trim_scale(v_ing.on_hand), v_ing.unit
      using errcode = '22023';
  end if;

  if p_quantity > 0 and p_expires_at is not null then
    insert into public.ingredient_batches (cafe_id, ingredient_id, expires_at, quantity, remaining)
    values (v_ing.cafe_id, v_ing.id, p_expires_at, p_quantity, p_quantity)
    returning id into v_batch_id;
  end if;

  insert into public.stock_movements (
    cafe_id, ingredient_id, movement_type, quantity, unit_cost, balance_after, avg_cost_after,
    batch_id, supplier_id, purchase_order_id, stock_count_id, order_id, order_item_id, product_id, note
  )
  values (
    v_ing.cafe_id, v_ing.id, p_type, p_quantity, v_cost, v_new_qty, v_new_avg,
    coalesce(v_batch_id, v_pick),
    nullif(p_refs ->> 'supplier_id', '')::uuid,
    nullif(p_refs ->> 'purchase_order_id', '')::uuid,
    nullif(p_refs ->> 'stock_count_id', '')::uuid,
    nullif(p_refs ->> 'order_id', '')::uuid,
    nullif(p_refs ->> 'order_item_id', '')::uuid,
    nullif(p_refs ->> 'product_id', '')::uuid,
    public.inv_clean_text(p_note, 300)
  )
  returning id into v_movement_id;

  update public.ingredients
  set on_hand = v_new_qty,
      avg_cost = v_new_avg,
      last_purchase_cost = case when p_type in ('opening', 'purchase') then p_unit_cost else last_purchase_cost end
  where id = v_ing.id;

  -- Stok keluar: kurangi batch, batch pilihan dulu lalu yang paling cepat kedaluwarsa
  if p_quantity < 0 then
    v_left := -p_quantity;
    for v_batch in
      select b.id, b.remaining
      from public.ingredient_batches b
      where b.ingredient_id = v_ing.id and b.remaining > 0
      order by (b.id = v_pick) desc nulls last, b.expires_at, b.received_at
      for update
    loop
      exit when v_left <= 0;
      v_take := least(v_left, v_batch.remaining);
      update public.ingredient_batches set remaining = remaining - v_take where id = v_batch.id;
      v_left := v_left - v_take;
    end loop;
  end if;

  return v_movement_id;
end;
$$;
revoke all on function public.inv_apply_movement(uuid, text, numeric, numeric, date, text, jsonb, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- F. Stok masuk / keluar / penyesuaian / opname (dipanggil dari web owner)
-- ---------------------------------------------------------------------
create or replace function public.inventory_stock_in(
  p_ingredient_id uuid,
  p_quantity numeric,
  p_unit_cost numeric,
  p_expires_at date default null,
  p_supplier_id uuid default null,
  p_note text default null,
  p_is_opening boolean default false
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cafe uuid;
begin
  select i.cafe_id into v_cafe from public.ingredients i where i.id = p_ingredient_id;
  if v_cafe is null then
    raise exception 'Bahan tidak ditemukan' using errcode = 'P0002';
  end if;
  perform public.inv_require_owner(v_cafe);
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Jumlah masuk harus lebih dari 0' using errcode = '22023';
  end if;
  if p_supplier_id is not null and not exists (
    select 1 from public.suppliers s where s.id = p_supplier_id and s.cafe_id = v_cafe
  ) then
    raise exception 'Supplier tidak ditemukan di kafe ini' using errcode = '23503';
  end if;
  if p_expires_at is not null and p_expires_at < (now() at time zone 'Asia/Jakarta')::date - 365 then
    raise exception 'Tanggal kedaluwarsa tidak masuk akal' using errcode = '22023';
  end if;
  return public.inv_apply_movement(
    p_ingredient_id,
    case when coalesce(p_is_opening, false) then 'opening' else 'purchase' end,
    p_quantity, p_unit_cost, p_expires_at, p_note,
    jsonb_build_object('supplier_id', p_supplier_id)
  );
end;
$$;
revoke all on function public.inventory_stock_in(uuid, numeric, numeric, date, uuid, text, boolean) from public, anon;
grant execute on function public.inventory_stock_in(uuid, numeric, numeric, date, uuid, text, boolean) to authenticated;

create or replace function public.inventory_stock_out(
  p_ingredient_id uuid,
  p_quantity numeric,
  p_reason text,
  p_note text default null,
  p_batch_id uuid default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cafe uuid;
begin
  select i.cafe_id into v_cafe from public.ingredients i where i.id = p_ingredient_id;
  if v_cafe is null then
    raise exception 'Bahan tidak ditemukan' using errcode = 'P0002';
  end if;
  perform public.inv_require_owner(v_cafe);
  if p_reason is null or p_reason not in ('waste', 'damaged', 'expired', 'usage', 'return') then
    raise exception 'Alasan stok keluar tidak dikenal' using errcode = '22023';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Jumlah keluar harus lebih dari 0' using errcode = '22023';
  end if;
  if p_batch_id is not null and not exists (
    select 1 from public.ingredient_batches b where b.id = p_batch_id and b.ingredient_id = p_ingredient_id
  ) then
    raise exception 'Batch tidak ditemukan untuk bahan ini' using errcode = '23503';
  end if;
  return public.inv_apply_movement(
    p_ingredient_id, p_reason, -p_quantity, null, null, p_note,
    jsonb_build_object('batch_id', p_batch_id)
  );
end;
$$;
revoke all on function public.inventory_stock_out(uuid, numeric, text, text, uuid) from public, anon;
grant execute on function public.inventory_stock_out(uuid, numeric, text, text, uuid) to authenticated;

-- Set stok ke angka tertentu (koreksi cepat satu bahan). Alasan wajib.
create or replace function public.inventory_adjust(
  p_ingredient_id uuid,
  p_new_quantity numeric,
  p_note text,
  p_unit_cost numeric default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cafe uuid;
  v_on_hand numeric(14, 3);
begin
  select i.cafe_id into v_cafe from public.ingredients i where i.id = p_ingredient_id;
  if v_cafe is null then
    raise exception 'Bahan tidak ditemukan' using errcode = 'P0002';
  end if;
  perform public.inv_require_owner(v_cafe);
  if p_new_quantity is null or p_new_quantity < 0 then
    raise exception 'Stok baru tidak boleh minus' using errcode = '22023';
  end if;
  if char_length(coalesce(public.inv_clean_text(p_note, 300), '')) < 3 then
    raise exception 'Tulis alasan penyesuaian (minimal 3 huruf)' using errcode = '22023';
  end if;
  select i.on_hand into v_on_hand from public.ingredients i where i.id = p_ingredient_id for update;
  if round(p_new_quantity, 3) = v_on_hand then
    raise exception 'Stok tidak berubah' using errcode = '22023';
  end if;
  return public.inv_apply_movement(p_ingredient_id, 'adjustment', round(p_new_quantity, 3) - v_on_hand, p_unit_cost, null, p_note);
end;
$$;
revoke all on function public.inventory_adjust(uuid, numeric, text, numeric) from public, anon;
grant execute on function public.inventory_adjust(uuid, numeric, text, numeric) to authenticated;

-- Stok opname: hasil hitung fisik banyak bahan sekaligus, diposting dalam satu transaksi.
-- p_lines = [{ "ingredient_id": uuid, "counted": angka }]
create or replace function public.inventory_post_count(p_cafe_id uuid, p_lines jsonb, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count_id uuid;
  v_line record;
  v_on_hand numeric(14, 3);
  v_avg numeric(14, 4);
  v_lines integer := 0;
  v_value numeric(16, 2) := 0;
begin
  perform public.inv_require_owner(p_cafe_id);
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) not between 1 and 500 then
    raise exception 'Isi hasil hitung 1–500 bahan' using errcode = '22023';
  end if;

  insert into public.stock_counts (cafe_id, note)
  values (p_cafe_id, public.inv_clean_text(p_note, 300))
  returning id into v_count_id;

  -- Urut id bahan: dua opname bersamaan tidak saling mengunci
  for v_line in
    select (e ->> 'ingredient_id')::uuid as ingredient_id, round((e ->> 'counted')::numeric, 3) as counted
    from jsonb_array_elements(p_lines) as e
    order by 1
  loop
    if v_line.counted is null or v_line.counted < 0 then
      raise exception 'Hasil hitung tidak boleh kosong atau minus' using errcode = '22023';
    end if;
    select i.on_hand, i.avg_cost into v_on_hand, v_avg
    from public.ingredients i
    where i.id = v_line.ingredient_id and i.cafe_id = p_cafe_id
    for update;
    if not found then
      raise exception 'Bahan tidak ditemukan di kafe ini' using errcode = '23503';
    end if;

    insert into public.stock_count_lines (cafe_id, stock_count_id, ingredient_id, system_qty, counted_qty, unit_cost)
    values (p_cafe_id, v_count_id, v_line.ingredient_id, v_on_hand, v_line.counted, v_avg);

    if v_line.counted <> v_on_hand then
      perform public.inv_apply_movement(
        v_line.ingredient_id, 'opname', v_line.counted - v_on_hand, null, null, p_note,
        jsonb_build_object('stock_count_id', v_count_id)
      );
      v_value := v_value + round((v_line.counted - v_on_hand) * v_avg, 2);
    end if;
    v_lines := v_lines + 1;
  end loop;

  update public.stock_counts set line_count = v_lines, difference_value = v_value where id = v_count_id;
  return v_count_id;
end;
$$;
revoke all on function public.inventory_post_count(uuid, jsonb, text) from public, anon;
grant execute on function public.inventory_post_count(uuid, jsonb, text) to authenticated;

-- ---------------------------------------------------------------------
-- G. Purchase order & pembayaran supplier
-- ---------------------------------------------------------------------
create table if not exists public.document_counters (
  cafe_id uuid not null references public.cafes (id) on delete cascade,
  doc_type text not null,
  period integer not null,
  last_value integer not null default 0,
  primary key (cafe_id, doc_type, period)
);

create or replace function public.inv_next_document_number(p_cafe_id uuid, p_doc_type text, p_prefix text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_year integer := extract(year from now() at time zone 'Asia/Jakarta')::integer;
  v_value integer;
begin
  insert into public.document_counters (cafe_id, doc_type, period, last_value)
  values (p_cafe_id, p_doc_type, v_year, 1)
  on conflict (cafe_id, doc_type, period)
  do update set last_value = public.document_counters.last_value + 1
  returning last_value into v_value;
  return p_prefix || '-' || v_year || '-' || lpad(v_value::text, 4, '0');
end;
$$;
revoke all on function public.inv_next_document_number(uuid, text, text) from public, anon, authenticated;

create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  cafe_id uuid not null references public.cafes (id) on delete cascade,
  supplier_id uuid not null references public.suppliers (id),
  po_number text not null,
  status text not null default 'draft' check (status in ('draft', 'ordered', 'partial', 'received', 'cancelled')),
  order_date date not null default (now() at time zone 'Asia/Jakarta')::date,
  expected_date date,
  due_date date,
  notes text check (notes is null or char_length(notes) <= 500),
  total_amount numeric(14, 2) not null default 0 check (total_amount >= 0),
  received_amount numeric(14, 2) not null default 0 check (received_amount >= 0),
  paid_amount numeric(14, 2) not null default 0 check (paid_amount >= 0),
  closed_short boolean not null default false,
  cancel_reason text check (cancel_reason is null or char_length(cancel_reason) <= 300),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ordered_at timestamptz,
  received_at timestamptz,
  cancelled_at timestamptz,
  unique (cafe_id, po_number)
);
create index if not exists purchase_orders_cafe_idx on public.purchase_orders (cafe_id, created_at desc);
create index if not exists purchase_orders_supplier_idx on public.purchase_orders (supplier_id, created_at desc);

drop trigger if exists touch_updated_at on public.purchase_orders;
create trigger touch_updated_at before update on public.purchase_orders
  for each row execute function public.touch_updated_at();

create table if not exists public.purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  cafe_id uuid not null references public.cafes (id) on delete cascade,
  purchase_order_id uuid not null references public.purchase_orders (id) on delete cascade,
  ingredient_id uuid not null references public.ingredients (id),
  quantity numeric(14, 3) not null check (quantity > 0),
  unit_label text not null check (char_length(unit_label) between 1 and 20),
  unit_size numeric(14, 3) not null check (unit_size > 0),
  unit_price numeric(14, 2) not null check (unit_price >= 0),
  received_quantity numeric(14, 3) not null default 0 check (received_quantity >= 0),
  line_total numeric(16, 2) generated always as (round(quantity * unit_price, 2)) stored,
  sort_order integer not null default 0
);
create index if not exists purchase_order_items_po_idx on public.purchase_order_items (purchase_order_id, sort_order);

alter table public.stock_movements drop constraint if exists stock_movements_purchase_order_fk;
alter table public.stock_movements add constraint stock_movements_purchase_order_fk
  foreign key (purchase_order_id) references public.purchase_orders (id);

create table if not exists public.supplier_payments (
  id uuid primary key default gen_random_uuid(),
  cafe_id uuid not null references public.cafes (id) on delete cascade,
  purchase_order_id uuid not null references public.purchase_orders (id),
  supplier_id uuid not null references public.suppliers (id),
  amount numeric(14, 2) not null check (amount > 0),
  method text not null check (method in ('cash', 'bank_transfer', 'qris', 'ewallet', 'other')),
  paid_on date not null,
  reference text check (reference is null or char_length(reference) <= 60),
  note text check (note is null or char_length(note) <= 300),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  void_reason text check (void_reason is null or char_length(void_reason) <= 300)
);
create index if not exists supplier_payments_po_idx on public.supplier_payments (purchase_order_id, created_at);
create index if not exists supplier_payments_cafe_idx on public.supplier_payments (cafe_id, paid_on desc);

-- Simpan draf PO (baru atau ubah). p_items = [{ingredient_id, quantity, unit_label?, unit_size?, unit_price}]
create or replace function public.purchase_order_save(
  p_cafe_id uuid,
  p_po_id uuid,
  p_supplier_id uuid,
  p_order_date date,
  p_expected_date date,
  p_notes text,
  p_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po_id uuid := p_po_id;
  v_item jsonb;
  v_ing public.ingredients%rowtype;
  v_qty numeric(14, 3);
  v_size numeric(14, 3);
  v_price numeric(14, 2);
  v_label text;
  v_sort integer := 0;
begin
  perform public.inv_require_owner(p_cafe_id);
  if not exists (select 1 from public.suppliers s where s.id = p_supplier_id and s.cafe_id = p_cafe_id) then
    raise exception 'Pilih supplier' using errcode = '23503';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 100 then
    raise exception 'PO harus berisi 1–100 bahan' using errcode = '22023';
  end if;
  if p_expected_date is not null and p_order_date is not null and p_expected_date < p_order_date then
    raise exception 'Tanggal kirim tidak boleh sebelum tanggal pesan' using errcode = '22023';
  end if;

  if v_po_id is null then
    insert into public.purchase_orders (cafe_id, supplier_id, po_number, order_date, expected_date, notes)
    values (
      p_cafe_id, p_supplier_id,
      public.inv_next_document_number(p_cafe_id, 'purchase_order', 'PO'),
      coalesce(p_order_date, (now() at time zone 'Asia/Jakarta')::date),
      p_expected_date, public.inv_clean_text(p_notes, 500)
    )
    returning id into v_po_id;
  else
    perform 1 from public.purchase_orders po
    where po.id = v_po_id and po.cafe_id = p_cafe_id and po.status = 'draft'
    for update;
    if not found then
      raise exception 'Hanya PO berstatus draf yang bisa diubah' using errcode = '22023';
    end if;
    update public.purchase_orders
    set supplier_id = p_supplier_id,
        order_date = coalesce(p_order_date, order_date),
        expected_date = p_expected_date,
        notes = public.inv_clean_text(p_notes, 500)
    where id = v_po_id;
    delete from public.purchase_order_items where purchase_order_id = v_po_id;
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_ing from public.ingredients i
    where i.id = nullif(v_item ->> 'ingredient_id', '')::uuid and i.cafe_id = p_cafe_id;
    if not found then
      raise exception 'Bahan tidak ditemukan di kafe ini' using errcode = '23503';
    end if;
    v_qty := round((v_item ->> 'quantity')::numeric, 3);
    v_size := round(coalesce(nullif(v_item ->> 'unit_size', '')::numeric, v_ing.purchase_unit_size, 1), 3);
    v_price := round((v_item ->> 'unit_price')::numeric, 2);
    v_label := coalesce(public.inv_clean_text(v_item ->> 'unit_label', 20), v_ing.purchase_unit, v_ing.unit);
    if v_qty is null or v_qty <= 0 or v_qty > 1000000 then
      raise exception 'Jumlah % harus lebih dari 0', v_ing.name using errcode = '22023';
    end if;
    if v_size <= 0 then
      raise exception 'Isi per kemasan % harus lebih dari 0', v_ing.name using errcode = '22023';
    end if;
    if v_price is null or v_price < 0 or v_price > 1000000000 then
      raise exception 'Harga % tidak valid', v_ing.name using errcode = '22023';
    end if;
    insert into public.purchase_order_items (
      cafe_id, purchase_order_id, ingredient_id, quantity, unit_label, unit_size, unit_price, sort_order
    )
    values (p_cafe_id, v_po_id, v_ing.id, v_qty, v_label, v_size, v_price, v_sort);
    v_sort := v_sort + 1;
  end loop;

  update public.purchase_orders po
  set total_amount = coalesce((select sum(i.line_total) from public.purchase_order_items i where i.purchase_order_id = v_po_id), 0)
  where po.id = v_po_id;

  return v_po_id;
end;
$$;
revoke all on function public.purchase_order_save(uuid, uuid, uuid, date, date, text, jsonb) from public, anon;
grant execute on function public.purchase_order_save(uuid, uuid, uuid, date, date, text, jsonb) to authenticated;

-- Aksi status: 'order' (draf → dipesan), 'delete' (hapus draf),
-- 'cancel' (batal, hanya bila belum ada barang diterima), 'close' (sisa tidak dikirim)
create or replace function public.purchase_order_transition(p_po_id uuid, p_action text, p_reason text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po public.purchase_orders%rowtype;
begin
  select * into v_po from public.purchase_orders where id = p_po_id for update;
  if not found then
    raise exception 'PO tidak ditemukan' using errcode = 'P0002';
  end if;
  perform public.inv_require_owner(v_po.cafe_id);

  if p_action = 'order' then
    if v_po.status <> 'draft' then
      raise exception 'Hanya PO draf yang bisa ditandai dipesan' using errcode = '22023';
    end if;
    update public.purchase_orders set status = 'ordered', ordered_at = now() where id = p_po_id;
    return 'ordered';
  elsif p_action = 'delete' then
    if v_po.status <> 'draft' then
      raise exception 'Hanya PO draf yang bisa dihapus. Batalkan PO yang sudah dipesan.' using errcode = '22023';
    end if;
    delete from public.purchase_orders where id = p_po_id;
    return 'deleted';
  elsif p_action = 'cancel' then
    if v_po.status not in ('draft', 'ordered') or v_po.received_amount > 0 then
      raise exception 'PO yang sudah menerima barang tidak bisa dibatalkan. Gunakan "Tutup PO".' using errcode = '22023';
    end if;
    if v_po.paid_amount > 0 then
      raise exception 'PO ini sudah dibayar. Batalkan pembayarannya dulu.' using errcode = '22023';
    end if;
    update public.purchase_orders
    set status = 'cancelled', cancelled_at = now(), cancel_reason = public.inv_clean_text(p_reason, 300)
    where id = p_po_id;
    return 'cancelled';
  elsif p_action = 'close' then
    if v_po.status <> 'partial' then
      raise exception 'Hanya PO yang diterima sebagian yang bisa ditutup' using errcode = '22023';
    end if;
    update public.purchase_orders
    set status = 'received', closed_short = true, cancel_reason = public.inv_clean_text(p_reason, 300)
    where id = p_po_id;
    return 'received';
  end if;
  raise exception 'Aksi PO tidak dikenal' using errcode = '22023';
end;
$$;
revoke all on function public.purchase_order_transition(uuid, text, text) from public, anon;
grant execute on function public.purchase_order_transition(uuid, text, text) to authenticated;

-- Terima barang. p_lines = [{item_id, quantity (dalam satuan beli), expires_at?}]
create or replace function public.purchase_order_receive(p_po_id uuid, p_lines jsonb, p_note text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po public.purchase_orders%rowtype;
  v_line record;
  v_item public.purchase_order_items%rowtype;
  v_value numeric(14, 2) := 0;
  v_received_lines integer := 0;
  v_terms smallint;
  v_status text;
  v_note text := coalesce(public.inv_clean_text(p_note, 300), '');
begin
  select * into v_po from public.purchase_orders where id = p_po_id for update;
  if not found then
    raise exception 'PO tidak ditemukan' using errcode = 'P0002';
  end if;
  perform public.inv_require_owner(v_po.cafe_id);
  if v_po.status not in ('draft', 'ordered', 'partial') then
    raise exception 'PO ini sudah selesai atau dibatalkan' using errcode = '22023';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Isi jumlah barang yang diterima' using errcode = '22023';
  end if;

  for v_line in
    select i.ingredient_id, l.item_id, l.quantity, l.expires_at
    from (
      select nullif(e ->> 'item_id', '')::uuid as item_id,
             round((e ->> 'quantity')::numeric, 3) as quantity,
             nullif(e ->> 'expires_at', '')::date as expires_at
      from jsonb_array_elements(p_lines) as e
    ) as l
    join public.purchase_order_items i on i.id = l.item_id and i.purchase_order_id = p_po_id
    where l.quantity > 0
    order by i.ingredient_id, l.item_id
  loop
    select * into v_item from public.purchase_order_items where id = v_line.item_id for update;
    if v_line.quantity > v_item.quantity - v_item.received_quantity + 0.0005 then
      raise exception 'Jumlah diterima melebihi sisa pesanan' using errcode = '22023';
    end if;
    perform public.inv_apply_movement(
      v_item.ingredient_id, 'purchase', round(v_line.quantity * v_item.unit_size, 3),
      round(v_item.unit_price / v_item.unit_size, 4), v_line.expires_at,
      trim(both ' ' from v_po.po_number || ' ' || v_note),
      jsonb_build_object('supplier_id', v_po.supplier_id, 'purchase_order_id', v_po.id)
    );
    update public.purchase_order_items
    set received_quantity = received_quantity + v_line.quantity
    where id = v_item.id;
    v_value := v_value + round(v_line.quantity * v_item.unit_price, 2);
    v_received_lines := v_received_lines + 1;

    insert into public.supplier_items (cafe_id, supplier_id, ingredient_id, unit_label, unit_size, last_price, last_purchased_at)
    values (v_po.cafe_id, v_po.supplier_id, v_item.ingredient_id, v_item.unit_label, v_item.unit_size, v_item.unit_price, now())
    on conflict (supplier_id, ingredient_id) do update
    set unit_label = excluded.unit_label, unit_size = excluded.unit_size,
        last_price = excluded.last_price, last_purchased_at = excluded.last_purchased_at;
  end loop;

  if v_received_lines = 0 then
    raise exception 'Isi jumlah barang yang diterima' using errcode = '22023';
  end if;

  select s.payment_terms_days into v_terms from public.suppliers s where s.id = v_po.supplier_id;
  v_status := case
    when exists (
      select 1 from public.purchase_order_items i
      where i.purchase_order_id = p_po_id and i.received_quantity < i.quantity
    ) then 'partial'
    else 'received'
  end;

  update public.purchase_orders
  set status = v_status,
      received_amount = received_amount + v_value,
      received_at = now(),
      ordered_at = coalesce(ordered_at, now()),
      due_date = coalesce(due_date, (now() at time zone 'Asia/Jakarta')::date + coalesce(v_terms, 0))
  where id = p_po_id;
  return v_status;
end;
$$;
revoke all on function public.purchase_order_receive(uuid, jsonb, text) from public, anon;
grant execute on function public.purchase_order_receive(uuid, jsonb, text) to authenticated;

create or replace function public.purchase_order_pay(
  p_po_id uuid,
  p_amount numeric,
  p_method text,
  p_paid_on date default null,
  p_reference text default null,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po public.purchase_orders%rowtype;
  v_amount numeric(14, 2) := round(p_amount, 2);
  v_limit numeric(14, 2);
  v_id uuid;
begin
  select * into v_po from public.purchase_orders where id = p_po_id for update;
  if not found then
    raise exception 'PO tidak ditemukan' using errcode = 'P0002';
  end if;
  perform public.inv_require_owner(v_po.cafe_id);
  if v_po.status in ('draft', 'cancelled') then
    raise exception 'PO draf atau batal tidak bisa dibayar' using errcode = '22023';
  end if;
  if p_method is null or p_method not in ('cash', 'bank_transfer', 'qris', 'ewallet', 'other') then
    raise exception 'Metode pembayaran tidak dikenal' using errcode = '22023';
  end if;
  -- Bisa bayar di muka (uang muka) sampai nilai PO; setelah diterima sampai nilai barang yang diterima
  v_limit := case when v_po.status = 'ordered' then v_po.total_amount else v_po.received_amount end - v_po.paid_amount;
  if v_amount is null or v_amount <= 0 then
    raise exception 'Nominal pembayaran harus lebih dari 0' using errcode = '22023';
  end if;
  if v_amount > v_limit then
    raise exception 'Nominal melebihi sisa tagihan (Rp %)', to_char(greatest(v_limit, 0), 'FM999G999G999G990') using errcode = '22023';
  end if;
  if p_paid_on is not null and p_paid_on > (now() at time zone 'Asia/Jakarta')::date then
    raise exception 'Tanggal bayar tidak boleh di masa depan' using errcode = '22023';
  end if;

  insert into public.supplier_payments (cafe_id, purchase_order_id, supplier_id, amount, method, paid_on, reference, note)
  values (
    v_po.cafe_id, v_po.id, v_po.supplier_id, v_amount, p_method,
    coalesce(p_paid_on, (now() at time zone 'Asia/Jakarta')::date),
    public.inv_clean_text(p_reference, 60), public.inv_clean_text(p_note, 300)
  )
  returning id into v_id;
  update public.purchase_orders set paid_amount = paid_amount + v_amount where id = v_po.id;
  return v_id;
end;
$$;
revoke all on function public.purchase_order_pay(uuid, numeric, text, date, text, text) from public, anon;
grant execute on function public.purchase_order_pay(uuid, numeric, text, date, text, text) to authenticated;

-- Pembayaran tidak dihapus; dibatalkan dengan alasan (jejak tetap ada)
create or replace function public.supplier_payment_void(p_payment_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.supplier_payments%rowtype;
begin
  select * into v_payment from public.supplier_payments where id = p_payment_id;
  if not found then
    raise exception 'Pembayaran tidak ditemukan' using errcode = 'P0002';
  end if;
  perform public.inv_require_owner(v_payment.cafe_id);
  perform 1 from public.purchase_orders where id = v_payment.purchase_order_id for update;
  select * into v_payment from public.supplier_payments where id = p_payment_id for update;
  if v_payment.voided_at is not null then
    raise exception 'Pembayaran ini sudah dibatalkan' using errcode = '22023';
  end if;
  if char_length(coalesce(public.inv_clean_text(p_reason, 300), '')) < 3 then
    raise exception 'Tulis alasan pembatalan' using errcode = '22023';
  end if;
  update public.supplier_payments
  set voided_at = now(), void_reason = public.inv_clean_text(p_reason, 300)
  where id = p_payment_id;
  update public.purchase_orders set paid_amount = paid_amount - v_payment.amount where id = v_payment.purchase_order_id;
end;
$$;
revoke all on function public.supplier_payment_void(uuid, text) from public, anon;
grant execute on function public.supplier_payment_void(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- H. Resep, HPP, profit produk, perkiraan stok
-- ---------------------------------------------------------------------
-- Ganti seluruh resep satu produk. p_items = [{ingredient_id, quantity, option_id?}]
create or replace function public.recipe_save(p_product_id uuid, p_items jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cafe uuid;
  v_name text;
  v_item jsonb;
  v_option uuid;
  v_ingredient uuid;
  v_qty numeric(14, 3);
  v_count integer := 0;
begin
  select p.cafe_id, p.name into v_cafe, v_name from public.products p where p.id = p_product_id;
  if v_cafe is null then
    raise exception 'Produk tidak ditemukan' using errcode = 'P0002';
  end if;
  perform public.inv_require_owner(v_cafe);
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 60 then
    raise exception 'Resep maksimal 60 baris' using errcode = '22023';
  end if;

  delete from public.recipe_items where product_id = p_product_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_ingredient := nullif(v_item ->> 'ingredient_id', '')::uuid;
    v_option := nullif(v_item ->> 'option_id', '')::uuid;
    v_qty := round((v_item ->> 'quantity')::numeric, 3);
    if not exists (select 1 from public.ingredients i where i.id = v_ingredient and i.cafe_id = v_cafe) then
      raise exception 'Bahan tidak ditemukan di kafe ini' using errcode = '23503';
    end if;
    if v_qty is null or v_qty <= 0 then
      raise exception 'Takaran bahan harus lebih dari 0' using errcode = '22023';
    end if;
    if v_option is not null and not exists (
      select 1 from public.product_options o
      join public.product_option_groups g on g.id = o.group_id
      where o.id = v_option and g.product_id = p_product_id
    ) then
      raise exception 'Varian tidak ditemukan pada produk ini' using errcode = '23503';
    end if;
    begin
      insert into public.recipe_items (cafe_id, product_id, option_id, ingredient_id, quantity)
      values (v_cafe, p_product_id, v_option, v_ingredient, v_qty);
    exception when unique_violation then
      raise exception 'Bahan yang sama muncul dua kali di resep' using errcode = '23505';
    end;
    v_count := v_count + 1;
  end loop;

  insert into public.audit_logs (cafe_id, actor_id, action, entity, entity_id, label, changes)
  values (v_cafe, (select auth.uid()), 'update', 'recipe', p_product_id::text, left(v_name, 120),
          jsonb_build_object('baris_resep', v_count));
  return v_count;
end;
$$;
revoke all on function public.recipe_save(uuid, jsonb) from public, anon;
grant execute on function public.recipe_save(uuid, jsonb) to authenticated;

-- HPP per porsi (resep dasar × harga rata-rata bahan) dan porsi yang bisa dibuat dari stok
create or replace function public.inventory_product_costing(p_cafe_id uuid)
returns table (
  product_id uuid,
  product_name text,
  category_id uuid,
  price numeric,
  is_available boolean,
  recipe_lines integer,
  uncosted_lines integer,
  cost_per_portion numeric,
  gross_profit numeric,
  margin_pct numeric,
  portions_available numeric,
  limiting_ingredient text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform public.inv_require_owner(p_cafe_id);
  return query
  with base as (
    select r.product_id, i.name, r.quantity, i.avg_cost, i.on_hand,
           floor(greatest(i.on_hand, 0) / r.quantity) as portions
    from public.recipe_items r
    join public.ingredients i on i.id = r.ingredient_id
    where r.cafe_id = p_cafe_id and r.option_id is null
  ),
  agg as (
    select b.product_id,
           count(*)::integer as lines,
           count(*) filter (where b.avg_cost = 0)::integer as uncosted,
           sum(b.quantity * b.avg_cost) as cost,
           min(b.portions) as portions
    from base b
    group by b.product_id
  ),
  lim as (
    select distinct on (b.product_id) b.product_id, b.name
    from base b
    order by b.product_id, b.portions, b.name
  )
  select p.id, p.name, p.category_id, p.price::numeric, p.is_available,
         coalesce(a.lines, 0), coalesce(a.uncosted, 0),
         round(a.cost, 2),
         round(p.price - a.cost, 2),
         case when p.price > 0 and a.cost is not null then round((p.price - a.cost) / p.price * 100, 1) end,
         a.portions,
         l.name
  from public.products p
  left join agg a on a.product_id = p.id
  left join lim l on l.product_id = p.id
  where p.cafe_id = p_cafe_id
  order by p.name;
end;
$$;
revoke all on function public.inventory_product_costing(uuid) from public, anon;
grant execute on function public.inventory_product_costing(uuid) to authenticated;

-- Profit per produk pada rentang tanggal (pesanan SELESAI).
-- HPP aktual dari mutasi pemakaian bila ada; selain itu ESTIMASI = jumlah × HPP resep saat ini.
create or replace function public.inventory_product_profitability(p_cafe_id uuid, p_from timestamptz, p_to timestamptz)
returns table (
  product_id uuid,
  product_name text,
  quantity_sold numeric,
  revenue numeric,
  actual_cost numeric,
  estimated_cost numeric,
  uncosted_quantity numeric,
  gross_profit numeric,
  margin_pct numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform public.inv_require_owner(p_cafe_id);
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '400 days' then
    raise exception 'Rentang tanggal tidak valid (maksimal 400 hari)' using errcode = '22023';
  end if;
  return query
  with unit_cost as (
    select r.product_id, sum(r.quantity * i.avg_cost) as cost
    from public.recipe_items r
    join public.ingredients i on i.id = r.ingredient_id
    where r.cafe_id = p_cafe_id and r.option_id is null
    group by r.product_id
  ),
  items as (
    select oi.id, oi.product_id, oi.product_name, oi.quantity::numeric as qty,
           coalesce(oi.subtotal, oi.price * oi.quantity)::numeric as revenue
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where o.cafe_id = p_cafe_id
      and o.order_status::text = 'completed'
      and o.created_at >= p_from and o.created_at < p_to
  ),
  actual as (
    select m.order_item_id, -sum(m.total_cost) as cost
    from public.stock_movements m
    where m.cafe_id = p_cafe_id and m.movement_type = 'sale'
      and m.order_item_id in (select it.id from items it)
    group by m.order_item_id
  ),
  costed as (
    select it.product_id, it.product_name, it.qty, it.revenue,
           a.cost as actual_cost,
           case when a.cost is null and u.cost is not null then it.qty * u.cost end as estimated_cost,
           case when a.cost is null and u.cost is null then it.qty else 0 end as uncosted_qty
    from items it
    left join actual a on a.order_item_id = it.id
    left join unit_cost u on u.product_id = it.product_id
  )
  select c.product_id,
         max(c.product_name),
         sum(c.qty),
         round(sum(c.revenue), 2),
         round(coalesce(sum(c.actual_cost), 0), 2),
         round(coalesce(sum(c.estimated_cost), 0), 2),
         sum(c.uncosted_qty),
         round(sum(c.revenue) - coalesce(sum(c.actual_cost), 0) - coalesce(sum(c.estimated_cost), 0), 2),
         case when sum(c.revenue) > 0
           then round((sum(c.revenue) - coalesce(sum(c.actual_cost), 0) - coalesce(sum(c.estimated_cost), 0)) / sum(c.revenue) * 100, 1)
         end
  from costed c
  group by c.product_id, case when c.product_id is null then c.product_name end
  order by 4 desc;
end;
$$;
revoke all on function public.inventory_product_profitability(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.inventory_product_profitability(uuid, timestamptz, timestamptz) to authenticated;

-- Perkiraan kebutuhan stok. TIDAK menebak bila hari berjualan < 7 di rentang acuan.
create or replace function public.inventory_forecast(p_cafe_id uuid, p_lookback_days integer default 28)
returns table (
  ingredient_id uuid,
  name text,
  unit text,
  on_hand numeric,
  min_stock numeric,
  basis text,
  active_days integer,
  avg_daily_usage numeric,
  days_left numeric,
  depletion_date date,
  lead_time_days integer,
  suggested_quantity numeric,
  purchase_unit text,
  purchase_unit_size numeric,
  suggested_purchase_units numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_days integer := least(greatest(coalesce(p_lookback_days, 28), 7), 90);
  -- Rentang = N tanggal kalender WIB terakhir (termasuk hari ini), mulai 00.00 WIB
  v_from timestamptz := (((now() at time zone 'Asia/Jakarta')::date - (least(greatest(coalesce(p_lookback_days, 28), 7), 90) - 1))::timestamp) at time zone 'Asia/Jakarta';
  v_tracking boolean;
  v_started timestamptz;
  v_cover integer;
  v_active integer;
  v_basis text;
  v_today date := (now() at time zone 'Asia/Jakarta')::date;
begin
  perform public.inv_require_owner(p_cafe_id);
  select s.inventory_tracking, s.inventory_started_at, s.reorder_cover_days
  into v_tracking, v_started, v_cover
  from public.cafe_settings s where s.cafe_id = p_cafe_id;
  v_cover := coalesce(v_cover, 7);

  select count(distinct (o.created_at at time zone 'Asia/Jakarta')::date)::integer
  into v_active
  from public.orders o
  where o.cafe_id = p_cafe_id and o.order_status::text = 'completed' and o.created_at >= v_from;

  v_basis := case
    when v_active < 7 then 'data_kurang'
    when coalesce(v_tracking, false) and v_started <= v_from then 'aktual'
    else 'estimasi'
  end;

  return query
  with usage as (
    select m.ingredient_id, -sum(m.quantity) as qty
    from public.stock_movements m
    where v_basis = 'aktual' and m.cafe_id = p_cafe_id
      and m.movement_type in ('sale', 'usage') and m.occurred_at >= v_from
    group by m.ingredient_id
    union all
    select r.ingredient_id, sum(oi.quantity * r.quantity)
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    join public.recipe_items r on r.product_id = oi.product_id and r.option_id is null
    where v_basis = 'estimasi' and o.cafe_id = p_cafe_id
      and o.order_status::text = 'completed' and o.created_at >= v_from
    group by r.ingredient_id
  ),
  rates as (
    select i.*, case when v_basis = 'data_kurang' then null else coalesce(u.qty, 0) / v_days end as daily
    from public.ingredients i
    left join usage u on u.ingredient_id = i.id
    where i.cafe_id = p_cafe_id and i.is_active
  ),
  plan as (
    select r.*,
           case when r.daily is null then greatest(r.min_stock - greatest(r.on_hand, 0), 0)
                else greatest(r.daily * (r.lead_time_days + v_cover) + r.min_stock - greatest(r.on_hand, 0), 0)
           end as need
    from rates r
  )
  select p.id, p.name, p.unit, p.on_hand, p.min_stock, v_basis, v_active,
         round(p.daily, 3),
         case when p.daily > 0 then round(greatest(p.on_hand, 0) / p.daily, 1) end,
         case when p.daily > 0 then v_today + floor(greatest(p.on_hand, 0) / p.daily)::integer end,
         p.lead_time_days::integer,
         ceil(p.need),
         p.purchase_unit,
         p.purchase_unit_size,
         case when p.purchase_unit_size > 0 then ceil(p.need / p.purchase_unit_size) end
  from plan p
  order by case when p.daily > 0 then greatest(p.on_hand, 0) / p.daily end nulls last, p.name;
end;
$$;
revoke all on function public.inventory_forecast(uuid, integer) from public, anon;
grant execute on function public.inventory_forecast(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------
-- I. Pemakaian bahan otomatis saat pesanan SELESAI
--    Hanya resep dasar (varian belum tersimpan di pesanan sampai Fase 2/POS).
--    Stok boleh minus agar pesanan tidak pernah terhalang; minus = tanda perlu opname.
-- ---------------------------------------------------------------------
create or replace function public.inv_consume_order(p_order_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cafe uuid;
  v_line record;
  v_count integer := 0;
begin
  select o.cafe_id into v_cafe from public.orders o where o.id = p_order_id;
  if v_cafe is null then
    return 0;
  end if;
  if not exists (select 1 from public.cafe_settings s where s.cafe_id = v_cafe and s.inventory_tracking) then
    return 0;
  end if;
  if exists (select 1 from public.stock_movements m where m.order_id = p_order_id and m.movement_type = 'sale') then
    return 0;
  end if;

  -- Kunci bahan berurutan (cegah deadlock antar pesanan)
  perform 1 from public.ingredients i
  where i.id in (
    select r.ingredient_id from public.order_items oi
    join public.recipe_items r on r.product_id = oi.product_id and r.option_id is null
    where oi.order_id = p_order_id
  )
  order by i.id
  for update;

  for v_line in
    select oi.id as order_item_id, oi.product_id, r.ingredient_id, round(r.quantity * oi.quantity, 3) as qty
    from public.order_items oi
    join public.recipe_items r on r.product_id = oi.product_id and r.option_id is null
    where oi.order_id = p_order_id and oi.quantity > 0
    order by r.ingredient_id, oi.id
  loop
    perform public.inv_apply_movement(
      v_line.ingredient_id, 'sale', -v_line.qty, null, null, null,
      jsonb_build_object('order_id', p_order_id, 'order_item_id', v_line.order_item_id, 'product_id', v_line.product_id),
      true
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.inv_consume_order(uuid) from public, anon, authenticated;

create or replace function public.inv_on_order_completed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform public.inv_consume_order(new.id);
  exception when others then
    -- Pesanan TIDAK boleh gagal karena stok; catat untuk ditinjau owner
    insert into public.inventory_sync_issues (cafe_id, order_id, message)
    values (new.cafe_id, new.id, left(sqlerrm, 500));
  end;
  return null;
end;
$$;
revoke all on function public.inv_on_order_completed() from public, anon, authenticated;

drop trigger if exists inv_on_order_completed on public.orders;
create trigger inv_on_order_completed
  after update of order_status on public.orders
  for each row
  when (new.order_status::text = 'completed' and old.order_status::text is distinct from 'completed')
  execute function public.inv_on_order_completed();

-- ---------------------------------------------------------------------
-- RLS & izin: semua tabel inventori hanya untuk owner kafe itu.
-- Tulis langsung hanya untuk data master (supplier, bahan, katalog supplier).
-- Stok, PO, pembayaran, resep, opname: wajib lewat fungsi di atas.
-- ---------------------------------------------------------------------
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'suppliers', 'ingredients', 'ingredient_batches', 'supplier_items', 'recipe_items',
    'stock_counts', 'stock_count_lines', 'stock_movements', 'inventory_sync_issues',
    'document_counters', 'purchase_orders', 'purchase_order_items', 'supplier_payments'
  ] loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('revoke all on public.%I from anon, authenticated', v_table);
    execute format('drop policy if exists "Owners view %s" on public.%I', v_table, v_table);
    if v_table <> 'document_counters' then
      execute format('grant select on public.%I to authenticated', v_table);
      execute format(
        'create policy "Owners view %s" on public.%I for select to authenticated using (public.is_cafe_member(cafe_id, array[''owner'']))',
        v_table, v_table
      );
    end if;
  end loop;
end;
$$;

grant insert, delete on public.suppliers, public.ingredients, public.supplier_items to authenticated;
grant update (name, contact_name, phone, email, address, payment_terms_days, notes, is_active)
  on public.suppliers to authenticated;
grant update (name, sku, category, unit, min_stock, default_supplier_id, purchase_unit, purchase_unit_size, lead_time_days, is_active)
  on public.ingredients to authenticated;
grant update (supplier_sku, unit_label, unit_size, last_price) on public.supplier_items to authenticated;
grant update (resolved_at) on public.inventory_sync_issues to authenticated;

-- Insert bahan: kolom stok & harga tidak bisa diisi klien (tetap 0, diisi lewat "stok awal")
revoke insert on public.ingredients from authenticated;
grant insert (cafe_id, name, sku, category, unit, min_stock, default_supplier_id, purchase_unit, purchase_unit_size, lead_time_days, is_active)
  on public.ingredients to authenticated;

do $$
declare
  v_table text;
begin
  foreach v_table in array array['suppliers', 'ingredients', 'supplier_items'] loop
    execute format('drop policy if exists "Owners insert %s" on public.%I', v_table, v_table);
    execute format('drop policy if exists "Owners update %s" on public.%I', v_table, v_table);
    execute format('drop policy if exists "Owners delete %s" on public.%I', v_table, v_table);
    execute format(
      'create policy "Owners insert %s" on public.%I for insert to authenticated with check (public.is_cafe_member(cafe_id, array[''owner'']))',
      v_table, v_table
    );
    execute format(
      'create policy "Owners update %s" on public.%I for update to authenticated using (public.is_cafe_member(cafe_id, array[''owner''])) with check (public.is_cafe_member(cafe_id, array[''owner'']))',
      v_table, v_table
    );
    execute format(
      'create policy "Owners delete %s" on public.%I for delete to authenticated using (public.is_cafe_member(cafe_id, array[''owner'']))',
      v_table, v_table
    );
  end loop;
end;
$$;

drop policy if exists "Owners resolve sync issues" on public.inventory_sync_issues;
create policy "Owners resolve sync issues" on public.inventory_sync_issues for update to authenticated
  using (public.is_cafe_member(cafe_id, array['owner']))
  with check (public.is_cafe_member(cafe_id, array['owner']));

drop trigger if exists inv_check_ingredient_refs on public.ingredients;
create trigger inv_check_ingredient_refs
  before insert or update of default_supplier_id, cafe_id, unit on public.ingredients
  for each row execute function public.inv_check_ingredient_refs();

-- ---------------------------------------------------------------------
-- J. Log aktivitas: label PO memakai nomornya. Perubahan stok dicatat di stock_movements.
-- ---------------------------------------------------------------------
create or replace function public.log_audit_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_cafe uuid;
  v_changes jsonb;
  v_key text;
begin
  v_cafe := case
    when tg_table_name = 'cafes' then (v_row ->> 'id')::uuid
    else nullif(v_row ->> 'cafe_id', '')::uuid
  end;
  if v_cafe is null then
    return null;
  end if;

  if tg_op = 'UPDATE' then
    v_changes := '{}'::jsonb;
    for v_key in select jsonb_object_keys(v_new) loop
      if v_key not in ('updated_at', 'created_at')
         and (v_new -> v_key) is distinct from (v_old -> v_key) then
        v_changes := v_changes || jsonb_build_object(v_key, jsonb_build_array(v_old -> v_key, v_new -> v_key));
      end if;
    end loop;
    if v_changes = '{}'::jsonb then
      return null;
    end if;
  end if;

  insert into public.audit_logs (cafe_id, actor_id, action, entity, entity_id, label, changes)
  values (
    v_cafe,
    (select auth.uid()),
    lower(tg_op),
    tg_table_name,
    v_row ->> 'id',
    left(coalesce(v_row ->> 'name', v_row ->> 'label', v_row ->> 'full_name', v_row ->> 'app_name', v_row ->> 'po_number'), 120),
    v_changes
  );
  return null;
end;
$$;
revoke all on function public.log_audit_event() from public, anon, authenticated;

drop trigger if exists log_audit_event on public.suppliers;
create trigger log_audit_event after insert or update or delete on public.suppliers
  for each row execute function public.log_audit_event();

-- Bahan: hanya data master (bukan setiap perubahan stok)
drop trigger if exists log_audit_event on public.ingredients;
create trigger log_audit_event
  after insert or delete or update of name, sku, category, unit, min_stock, default_supplier_id,
    purchase_unit, purchase_unit_size, lead_time_days, is_active
  on public.ingredients
  for each row execute function public.log_audit_event();

drop trigger if exists log_audit_event on public.purchase_orders;
create trigger log_audit_event
  after insert or delete or update of status, supplier_id, paid_amount on public.purchase_orders
  for each row execute function public.log_audit_event();

drop trigger if exists log_audit_event on public.supplier_payments;
create trigger log_audit_event
  after insert or update of voided_at on public.supplier_payments
  for each row execute function public.log_audit_event();

notify pgrst, 'reload schema';

commit;

-- Verifikasi: harus 13 tabel + 12 fungsi + 1 trigger pesanan = 26 baris
select 'table' as kind, table_name as name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'suppliers', 'ingredients', 'ingredient_batches', 'supplier_items', 'recipe_items', 'stock_counts',
    'stock_count_lines', 'stock_movements', 'inventory_sync_issues', 'document_counters',
    'purchase_orders', 'purchase_order_items', 'supplier_payments'
  )
union all
select 'function', p.proname
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in (
  'inventory_set_tracking', 'inventory_stock_in', 'inventory_stock_out', 'inventory_adjust', 'inventory_post_count',
  'purchase_order_save', 'purchase_order_transition', 'purchase_order_receive', 'purchase_order_pay',
  'supplier_payment_void', 'recipe_save', 'inventory_forecast'
)
union all
select 'trigger', t.tgname
from pg_trigger t
where t.tgrelid = 'public.orders'::regclass and t.tgname = 'inv_on_order_completed'
order by 1, 2;
