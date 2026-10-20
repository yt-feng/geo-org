# tokvilo

AI model gateway, prepaid wallet and digital-goods storefront at **https://tokvilo.com**.
This is the API-gateway branch of geo-org; the eco-geo.org marketing site remains
independent. The existing Cloudflare Worker, D1 database, encrypted provider
credentials and historical records are retained.

## Product

- `/models`: model catalogue and per-model prices.
- `/pricing`: current structured TokenHub/APIMart prices multiplied by 1.20.
- `/products`: eight digital subscriptions from the source public catalogue,
  observed 2026-10-20, at public retail price × 1.20 in CNY. Source stock is not
  represented as owned inventory. Orders are fulfilled manually.
- `/dashboard/wallet`: Liandong purchase links, one-time TK code redemption,
  available/reserved USD balance and ledger.
- `/dashboard/orders`: order status, delivery and cancellation before processing.
- `/admin/orders`: claim an order, deliver and settle, or cancel and release funds.
- `/tokenhub`: billed text, image and video generation.
- `/playground`: billed APIMart text and supported fixed-price image generation.
- `/dashboard/docs`: authenticated OpenAPI references and request examples.
- `/admin`: provider configuration; credentials remain server-side.
- `/tokenhub/audit`: existing independent administrator audit and saved evidence.

Public relay calls use the caller's prepaid wallet, including administrator-owned
API keys. Separate provider diagnostics and the existing audit retain their own
contracts. Fresh provider quotes are required before a paid call. Indeterminate
results remain reserved for reconciliation; retrying an idempotency key never
submits the generation twice. Unsupported or ambiguous prices cannot be billed.
Scheduled reconciliation polls already-owned asynchronous tasks without creating
new generations. The legacy data gateway only bills verified fixed-price routes.

## Payments and prices

Recharge codes are specific to tokvilo and independent of JiaNong. The launch
conversion is fixed at CNY 7.2 per USD of platform credit, disclosed before
purchase and stored with each issued batch. Redemption grants credit once.
Digital orders lock the displayed CNY price and converted wallet amount before
reserving balance; administrator delivery settles, cancellation releases.
A successful return to the website is never treated as payment confirmation.

See [payment operations](docs/tokvilo-payments.md) and
[TokenHub billing](docs/tokvilo-tokenhub-billing.md). Source subscription prices
are in `lib/products.ts`; they are a dated public-price snapshot, not an automatic
wholesale integration. Provider model pricing is read dynamically.

## Development and release

```sh
npm ci
npm run dev
npx tsc --noEmit
npm run lint
npm run build
node --test tests/*.test.mjs
npx wrangler d1 migrations apply eco-geo-api --remote
npx wrangler deploy --keep-vars
```

Use `.env.example` for configuration names. Never commit real credentials,
plaintext redemption stock, generated private inventory, or `.dev.vars`. Preserve
`ADMIN_SESSION_SECRET`, which protects existing encrypted provider settings.
New API keys use `tk_live_`; existing `eco_live_` keys remain accepted.

Routes: `tokvilo.com`, `www.tokvilo.com`, and legacy `api.eco-geo.org` share the
same Worker and persistence. This does not change the main eco-geo.org website.
