# Dailybrew Customer

Expo Router customer app for discovering cafes, browsing live catalog data,
ordering securely through Supabase, and tracking customer-owned orders.

## Run locally

```sh
npm install
npx expo start
```

Set the public Supabase URL and publishable/anon key in `.env`:

```dotenv
EXPO_PUBLIC_SUPABASE_URL=your_project_url
EXPO_PUBLIC_SUPABASE_KEY=your_publishable_key
```

Do not use a Supabase `service_role` key in a mobile application. Expo embeds
`EXPO_PUBLIC_*` values in the app bundle, so only public publishable keys
belong here. Restart Expo after editing `.env`.

## Database setup

Apply the Supabase migrations in order. Customer checkout uses the
`create_order` database function to load current product prices and calculate
the order total on the server. Apply
`20261107210900_customer_mobile_workflows.sql` after the foundation and staff
workflow migrations; it enables customer profile-name updates and a
customer-owned simulated-payment log. Simulations stay `pending` and are
excluded from paid-revenue reports.

The payment simulation is a demo only. It does not connect to a payment
processor or move money. Production payments require a trusted server-side
provider integration and verified webhooks.

## Customer app

- Browse cafe information and available products without signing in.
- View cafe-managed promotional banners on the home screen and open their
  product, category, voucher, or internal destinations. Banner images and
  schedules require the `20261109070000_create_promotional_banners.sql`
  migration.
- Create an account and sign in with Supabase Auth; sessions persist on device.
- Search/filter menu products, maintain a single-cafe cart, and add notes.
- Check out through the server-side `create_order` RPC.
- Choose pay-at-cafe or explicitly simulated payment.
- View order history and realtime status updates for the signed-in customer.
- Edit the customer display name and sign out.

RLS restricts order, item, and payment reads to the authenticated customer.
Never disable RLS to make the app work.

## Checks

```sh
npx expo lint
npx tsc --noEmit
```
