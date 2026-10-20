# tokvilo launch — 2026-10-20

The API gateway from geo-org is now branded tokvilo. Its existing Worker,
database, encrypted provider settings, API keys and audit history are retained.
The separate eco-geo.org marketing site is not part of this release.

## Public surfaces

- `https://tokvilo.com`: main site, model market, prices and digital goods.
- `https://www.tokvilo.com`: same service.
- `https://api.eco-geo.org`: legacy gateway alias.
- `https://tokvilo.com/dashboard/wallet`: recharge and one-time code redemption.
- `https://tokvilo.com/products`: public digital-goods inquiry form; no login or wallet payment.
- `https://tokvilo.com/studio`: multimodal model workbench.
- `https://tokvilo.com/admin/orders`: retained management for historical product orders.

The apex domain uses a zone Worker route over the existing proxied records.
The www and legacy hosts use Worker custom domains. Keep this distinction when
deploying; creating an apex custom domain conflicts with its existing records.
Run the build after changing Wrangler configuration because Vinext generates a
deployment configuration inside `dist/server`.

## Pricing and delivery

TokenHub and APIMart structured prices are multiplied by 1.20. The live pricing
endpoint returned 191 quoteable models on launch day, with both sources
available. This is catalogue coverage, not proof of a generation call for every
model. Unsupported or ambiguous billing contracts are refused.

The eight digital goods are a 2026-10-20 snapshot of the public catalogue at
`https://xiaoxincodex.codes/products`, at public CNY price × 1.20.
All eight source detail pages were checked: seven were listed in stock and one
was sold out. Each has one observed specification. Source detail URLs, specification
labels and stock snapshots are held in `lib/products.ts` under `productSourceAudit`;
the storefront does not display source-site branding or live inventory claims.
See `docs/tokvilo-product-catalog-audit-20261020.md` for the complete comparison.

Digital goods use the public `POST /api/product-inquiries` form. The customer
selects a product, supplies an email and requirements, and may add a name. The
product, specification and CNY reference price are shown before submission.
Requests are stored durably, then a notification is sent to `yt.feng@foxmail.com`.
The response distinguishes `sent` from `pending`; pending notification delivery
does not erase the inquiry. The page promises a reply by email within 24 hours.
There is no wallet reservation, payment or automatic product delivery in this
flow. The sold-out item remains labelled and can be inquired about. Repeating an
unchanged form uses the same idempotency key; editing it starts a new inquiry.
API-wallet recharge and paid model settlement remain separate and unchanged.

Each paid playground request first displays its maximum reservation. A confirmed
ceiling prevents a higher fresh quote from reserving funds without reconfirmation.
Actual usage settles at the same 20% markup; the unused reservation is returned.
Repeated requests use the same idempotency key.

## Liandong recharge

Dedicated tokvilo products are separate from the existing JiaNong stock:

| Face value | Fixed USD credit | Public purchase page | Initial stock |
| --- | ---: | --- | ---: |
| CNY 30 | 4.166666 | https://wzyp.cn/item/2i2q8j | 20 |
| CNY 90 | 12.500000 | https://wzyp.cn/item/nn19gc | 20 |
| CNY 300 | 41.666666 | https://wzyp.cn/item/mtzq1p | 20 |

The launch conversion is fixed at CNY 7.2 per USD of platform credit, disclosed
before purchase. Liandong handles payment and automatically delivers a TK code.
The buyer redeems it into their tokvilo wallet. This flow does not use a payment
webhook or interpret a browser redirect as payment confirmation.

Private inventory lives in the ignored `.artifacts/tokvilo-private/` directory.
Only hashes and code suffixes are stored in D1. Do not commit or publish the
private manifest or delivery TXT files.

## Verification

- Production migrations 0008–0016 applied successfully.
- Build, ESLint and TypeScript passed. The full suite passed 265 tests; the
  subsequently added signup email hook suite passed another nine offline tests.
- Production D1 verification used isolated QA identities and actual application
  modules to test redemption/replay, reservation/settlement/replay, order
  creation/cancellation/replay and revocation. It ended with zero QA balance,
  no pending reservation, one revoked code and both QA users disabled.
- HTTPS homepage, www, products and pricing returned 200. Unauthenticated
  wallet and orders returned 401.
- Desktop and mobile product layout checked in the supported Chrome session.
- Merchant UI showed all three products on sale with 20 codes each. Public
  purchase page showed CNY 30 and Alipay/WeChat choices.
- Release `150b0ffa-c621-4d07-8a50-d667fddc89dc` deployed the public inquiry
  flow, neutral API routes, current brand display and Supabase authentication fixes.
- A real product inquiry returned 201 with `emailStatus: sent`. D1 confirmed
  one saved inquiry and one accepted notification to the configured operator
  mailbox. Replaying its idempotency key returned the same receipt without
  a second notification. Acceptance does not prove inbox placement.
- Homepage, products, pricing, models, register and login returned 200 with no
  intermediary brand names in rendered text. New wallet product-order POST
  returned 410; unsigned authentication email hooks returned 401.
- The new Supabase project's authentication settings returned HTTP 200 from
  production. Signup and the email provider are enabled; email confirmation
  remains enabled. The current Workers runtime rejects `redirect: "error"`;
  authentication requests now use `"manual"` and reject non-2xx responses.

No real customer payment or paid model generation was sent for verification.
Authentication and email signing secrets remain in Worker secret bindings.
The new Supabase tokvilo project and Cloudflare sending domain are configured.
The Supabase HTTPS Send Email Hook form is prepared but has not yet been
submitted: local browser access was disabled in Work settings during acceptance.
Until the hook is enabled and an actual email confirmation/login round trip
passes, public signup delivery is not accepted as complete. See
`docs/tokvilo-auth-email-hook.md` for the remaining provider configuration.
