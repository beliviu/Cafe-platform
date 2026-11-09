# Dailybrew cafe dashboards

The web project contains separate owner and staff workspaces. Owners manage
catalog and view cafe transactions; staff use the operational order board,
real-time incoming orders, status workflow, and order history. It uses React,
Vite, Tailwind CSS, React Router, Supabase Auth/PostgREST/Realtime/Storage, and
Lucide React.

## Run locally

```sh
npm install
npm run dev
```

Set these values in `web-dashboard/.env.local` before starting Vite:

```dotenv
VITE_SUPABASE_URL=your_project_url
VITE_SUPABASE_ANON_KEY=your_publishable_key
```

Use the Supabase publishable/anon key only. Never put a service-role key in
this app. `.env.local` is ignored by Git; `.env.example` contains placeholders.
Restart the Vite server after changing environment variables.

## Database setup

Apply the migrations in the workspace `supabase/migrations/` directory to the
same Supabase project configured above. See [the database guide](../supabase/README.md)
for local and remote migration commands. The dashboard overview requires the
`owner_dashboard_analytics` migration; product photos require the
`create_product_image_storage` migration. Product price editing also requires
`20261107210600_fix_owner_product_update_policy.sql` so the owner UPDATE policy
is present in the connected Supabase project. For a database initialized
outside the project migrations, apply
`20261107210700_repair_owner_catalog_and_order_access.sql` and then
`20261107210800_staff_order_workflow.sql` in the Supabase SQL Editor.

New Auth accounts default to customer profiles. A trusted server-side
provisioning process must associate an owner account with a cafe and set its
role. The dashboard validates that role and cafe membership before showing
owner data. Never promote users from this client application.

Products, categories, and orders are always queried with the signed-in user's
`cafe_id`; RLS policies are the security boundary. Product images use
the public `product-images` bucket, but only cafe owners can upload, replace,
or delete files in their cafe's folder. Product deletion leaves historical
order-item name/price snapshots intact.

Catalog mutations request and verify affected row IDs; a successful HTTP
response with zero rows is reported as an access/not-found error rather than a
success. To use the SQL Editor instead of the CLI, run the required migrations
in order for the project configured in `.env.local`. Do not run `db reset`
against a remote project.

Owner routes are `/` (overview), `/products`, `/categories`, and `/orders`.
The owner route `/promotions` manages customer-home banners. Apply
`20261109070000_create_promotional_banners.sql` first; it creates the
cafe-scoped banner table and public image bucket with owner-only writes.
Staff routes are `/staff` (live order board) and `/staff/history`. Staff
accounts must be provisioned by a trusted server-side process; never expose a
service-role key in this browser app.

The staff dashboard requires
`20261107210800_staff_order_workflow.sql`. It grants staff cafe-scoped access
to orders and their item/customer details, enables Realtime on `orders`, and
enforces the pending → confirmed → preparing → ready → completed sequence in
the database. Staff can update only `orders.order_status`.

## Checks

```sh
npm run lint
npm run build
```
