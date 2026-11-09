import { PGlite } from '@electric-sql/pglite'
import fs from 'node:fs'

const db = new PGlite()
const root = new URL('../', import.meta.url)
const q = async (sql, params = []) => (await db.query(sql, params)).rows
const one = async (sql, params = []) => (await q(sql, params))[0]
const failures = []
let passed = 0
const check = (name, condition, detail = '') => {
  if (condition) passed += 1
  else failures.push(`${name}${detail ? ` → ${detail}` : ''}`)
}

await db.exec(fs.readFileSync(new URL('./base-schema.sql', import.meta.url), 'utf8'))
await db.exec(`
  CREATE TYPE public.app_role AS ENUM ('owner', 'staff', 'customer');
  CREATE SCHEMA storage;
  CREATE TABLE storage.buckets (
    id text PRIMARY KEY, name text NOT NULL, public boolean NOT NULL DEFAULT false,
    file_size_limit bigint, allowed_mime_types text[]
  );
  CREATE TABLE storage.objects (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text NOT NULL
  );
  ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
  GRANT USAGE ON SCHEMA storage TO anon, authenticated;
  GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO anon, authenticated;
  CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
    SELECT string_to_array(name, '/')
  $$;
  CREATE FUNCTION public.has_cafe_role(target_cafe_id uuid, allowed_roles public.app_role[])
  RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid())
        AND p.cafe_id = target_cafe_id
        AND p.role::text = ANY (allowed_roles::text[])
    )
  $$;
  GRANT EXECUTE ON FUNCTION public.has_cafe_role(uuid, public.app_role[]) TO authenticated;
`)
await db.exec(fs.readFileSync(new URL('../migrations/20261109070000_create_promotional_banners.sql', import.meta.url), 'utf8'))

const ids = {
  ownerA: '00000000-0000-0000-0000-0000000000a1',
  ownerB: '00000000-0000-0000-0000-0000000000b1',
  customer: '00000000-0000-0000-0000-0000000000c1',
  staff: '00000000-0000-0000-0000-0000000000a2',
}
for (const id of Object.values(ids)) await q('INSERT INTO auth.users (id) VALUES ($1)', [id])
const cafeA = (await one("INSERT INTO cafes (name) VALUES ('Cafe A') RETURNING id")).id
const cafeB = (await one("INSERT INTO cafes (name) VALUES ('Cafe B') RETURNING id")).id
await q(
  `INSERT INTO profiles (id, cafe_id, role) VALUES
    ($1, $2, 'owner'), ($3, $4, 'owner'), ($5, $2, 'customer'), ($6, $2, 'staff')`,
  [ids.ownerA, cafeA, ids.ownerB, cafeB, ids.customer, ids.staff],
)
const productA = (await one("INSERT INTO products (cafe_id, name, price) VALUES ($1, 'Latte', 100) RETURNING id", [cafeA])).id
const productB = (await one("INSERT INTO products (cafe_id, name, price) VALUES ($1, 'Mocha', 100) RETURNING id", [cafeB])).id

async function as(userId) {
  await db.exec('RESET ROLE')
  await q("SELECT set_config('request.jwt.claim.sub', $1, false)", [userId || ''])
  await db.exec(userId ? 'SET ROLE authenticated' : 'SET ROLE anon')
}

await db.exec('GRANT SELECT ON public.promotional_banners TO anon, authenticated')
await db.exec('GRANT INSERT, UPDATE, DELETE ON public.promotional_banners TO authenticated')
await as(ids.ownerA)
const bannerA = await one(
  `INSERT INTO promotional_banners (cafe_id, title, image_path, destination_type, destination_id, is_active)
   VALUES ($1, 'Cafe A promo', $2, 'product', $3, true) RETURNING id`,
  [cafeA, `${cafeA}/banner.jpg`, productA],
)
const draftA = await one(
  `INSERT INTO promotional_banners (cafe_id, title, image_path, destination_type, is_active)
   VALUES ($1, 'Draft', $2, 'menu', false) RETURNING id`,
  [cafeA, `${cafeA}/draft.jpg`],
)
await q("INSERT INTO storage.objects (bucket_id, name) VALUES ('cafe-banners', $1)", [`${cafeA}/banner.jpg`])

await as(null)
check('anon reads active promotional banner', (await q('SELECT id FROM promotional_banners WHERE id = $1', [bannerA.id])).length === 1)
check('anon cannot read inactive draft', (await q('SELECT id FROM promotional_banners WHERE id = $1', [draftA.id])).length === 0)
check('public can read banner image', (await q("SELECT id FROM storage.objects WHERE bucket_id = 'cafe-banners'")).length === 1)

await as(ids.customer)
check('customer cannot read inactive draft', (await q('SELECT id FROM promotional_banners WHERE id = $1', [draftA.id])).length === 0)
await db.exec('RESET ROLE')
await as(ids.ownerB)
check('owner B cannot read cafe A draft', (await q('SELECT id FROM promotional_banners WHERE id = $1', [draftA.id])).length === 0)
let otherCafeWriteDenied = false
try {
  await q(
    `INSERT INTO promotional_banners (cafe_id, title, image_path, destination_type, is_active)
     VALUES ($1, 'Wrong cafe', $2, 'menu', true)`,
    [cafeA, `${cafeA}/wrong.jpg`],
  )
} catch {
  otherCafeWriteDenied = true
}
check('owner B cannot insert for cafe A', otherCafeWriteDenied)

await as(ids.ownerA)
let crossCafeDestinationDenied = false
try {
  await q(
    `INSERT INTO promotional_banners (cafe_id, title, image_path, destination_type, destination_id)
     VALUES ($1, 'Wrong destination', $2, 'product', $3)`,
    [cafeA, `${cafeA}/wrong-target.jpg`, productB],
  )
} catch {
  crossCafeDestinationDenied = true
}
check('banner cannot target another cafe product', crossCafeDestinationDenied)

let otherCafeUploadDenied = false
try {
  await q("INSERT INTO storage.objects (bucket_id, name) VALUES ('cafe-banners', $1)", [`${cafeB}/wrong.jpg`])
} catch {
  otherCafeUploadDenied = true
}
check('owner cannot upload into another cafe folder', otherCafeUploadDenied)
await q("INSERT INTO storage.objects (bucket_id, name) VALUES ('cafe-banners', $1)", [`${cafeA}/second.jpg`])
check('owner can upload into own cafe folder', (await q("SELECT id FROM storage.objects WHERE name = $1", [`${cafeA}/second.jpg`])).length === 1)

await db.close()
if (failures.length) {
  console.error(`FAIL ${failures.length}/${passed + failures.length}\n${failures.join('\n')}`)
  process.exitCode = 1
} else {
  console.log(`PASS ${passed} promotional-banner checks`)
}
