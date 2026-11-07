# Supabase database

This directory contains the PostgreSQL schema, row-level security policies,
trusted order-creation function, and demo catalog seed data for Cafe Platform.

## Requirements

- Supabase CLI
- Docker, for local Supabase development
- A Supabase project for remote deployment

## Run locally

From the workspace root:

```sh
npx supabase start
npx supabase db reset
```

`db reset` applies every migration in `migrations/` in filename order, then
loads `seed.sql`. To apply only pending migrations to an already-running local
database, run:

```sh
npx supabase migration up --local
```

## Apply to a remote project

Authenticate with the Supabase CLI, then link the project and push the
migrations:

```sh
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

The seed is intended for local development and is not automatically inserted
into a remote database by `db push`. Run it against a remote project only when
you intentionally want the demo cafe and catalog there.

The owner dashboard's product/category workflows and statistics require all
migrations in order. The product-image migration creates the public
`product-images` bucket with a 5 MB image limit and cafe-owner-only write
policies. A product deletion preserves the item name and price snapshots for
historical orders by clearing only the deleted product reference.
The owner-product-update migration grants authenticated owners permission to
update products only within their own cafe; RLS remains enabled.
The latest `20261107210700_repair_owner_catalog_and_order_access.sql`
reconciles category/product CRUD grants and policies and owner order/detail
read policies for projects whose tables were created manually. It can be
applied through the Supabase SQL Editor if the CLI is not configured.
The `20261107210800_staff_order_workflow.sql` migration grants cafe-scoped
staff access to operational order data, exposes customer display names through
a scoped RPC, enables Realtime for orders, and enforces sequential status
transitions in the database. Apply it after the repair migration on an existing
database.
The `20261107210900_customer_mobile_workflows.sql` migration permits customers
to update only their own display name and adds
`record_customer_payment_simulation`, which logs a pending demo payment only
for the caller's own order. It never marks the order paid, so demo actions
cannot inflate paid-revenue analytics. This RPC is not connected to a payment
processor; production payment confirmation must come from a trusted
payment-provider webhook.

## Tenant and role model

Each owner or staff profile belongs to one cafe through `profiles.cafe_id`.
Customer profiles have a null `cafe_id`. A new Auth user is provisioned as a
customer by the `on_auth_user_created` trigger; user-supplied Auth metadata
cannot choose an elevated role. Creating a cafe and assigning its first owner,
as well as inviting staff, must be performed by a trusted server-side
provisioning flow using the Supabase service role. Never expose the service
role key in either client application.

RLS is enabled on all application tables. Public/anonymous access is limited to
cafes, categories, and available products. Authenticated customers can read
only their own orders, order items, and payments. Cafe owners can update their
cafe and manage its catalog; owners and staff can read that cafe's orders and
update only `orders.order_status`. Staff can read customer display names only
for their cafe's orders through `staff_order_customer_names`. Client roles
cannot insert orders/items or write payment records.

## Creating orders safely

Customers place an order by calling the `create_order` RPC while authenticated:

```js
const { data: orderId, error } = await supabase.rpc('create_order', {
  p_cafe_id: cafeId,
  p_items: [
    { product_id: productId, quantity: 2 },
  ],
  p_payment_method: 'cash',
  p_notes: null,
});
```

The RPC verifies the customer profile, cafe, product availability, and
quantities. It loads prices from `products`, snapshots them into
`order_items`, calculates each generated subtotal and the order total in the
database, and assigns a cafe-scoped order number under a cafe-row lock. It
does not accept client-supplied prices or totals. Real payment status and
payment records must be updated only by a trusted payment/backend workflow.

If checkout reports that `public.create_order` cannot be found in the schema
cache, apply `20261107210200_add_secure_order_creation.sql` to the Supabase
project (after the base schema migration). That migration notifies PostgREST to
reload its schema cache. With the Supabase CLI linked to the project, apply
pending migrations using `npx supabase db push`; otherwise, run the migration
SQL in the Supabase SQL Editor and then run `NOTIFY pgrst, 'reload schema';`.

If checkout reports that `COALESCE` cannot match text and integer types, apply
`20261107211000_fix_create_order_number_type.sql`. It supports numeric order
numbers stored as either text or a numeric column type and reloads the
PostgREST schema cache.

If checkout reports that `orders.payment_method` does not exist, apply
`20261107211100_repair_order_checkout_columns.sql`. It safely adds the
optional `payment_method` and `notes` columns expected by order creation.

For projects whose order tables were created manually with an older schema,
apply `20261107211200_reconcile_remote_ordering_schema.sql`. This final
reconciliation also replaces the earlier one-column repair steps. It
reconciles all order, item, and payment columns used by the customer, staff,
and owner apps; backfills item cafe IDs and price snapshots; preserves
generated subtotals while adding a trigger for legacy non-generated subtotal
columns; reinstates cafe-scoped RLS, status transitions, staff customer-name
access, simulated-payment logging, Realtime, and the secure server-side
checkout RPC. The migration stops with an explicit error if existing items
cannot be safely assigned to an order cafe or reconstructed with a price.

Some manually created `order_items` tables also require a separate `unit_price`
column. Apply `20261107211300_reconcile_order_item_unit_price.sql` after the
reconciliation migration. It backfills that snapshot, synchronizes it with
`price`, and updates the secure checkout RPC to populate both columns from the
current database product price.

## Owner dashboard analytics

The web owner dashboard calls `owner_dashboard_analytics` with the signed-in
owner's cafe ID and a date range of up to 90 days. The function is
`SECURITY INVOKER`, verifies the owner membership, and reads only rows visible
under RLS. Revenue and popular-product totals include paid, non-cancelled
orders. The RPC returns aggregate metrics, daily revenue, popular products,
and recent orders without exposing customer email or profile data.

If the dashboard reports that `owner_dashboard_analytics` is missing from the
schema cache, apply
`20261108000100_restore_owner_dashboard_analytics.sql` in the Supabase SQL
Editor after the ordering-schema reconciliation migrations. It recreates the
owner-only, cafe-scoped analytics function and reloads the PostgREST schema
cache.

If that function reports that `public.app_role[]` does not exist, apply
`20261108000200_fix_owner_dashboard_role_type.sql`. This version validates the
owner against their own profile without depending on the optional role enum.

Apply migrations before starting the dashboard or testing its data workflows.
For an existing remote project linked through the Supabase CLI:

```sh
npx supabase db push
```

## Demo data

`seed.sql` inserts the cafe **Kopi Senja** and four catalog products with
stable UUIDs. It deliberately does not create Auth users or memberships.
Provision an owner through a trusted server-side process before testing
owner/staff dashboard actions.
