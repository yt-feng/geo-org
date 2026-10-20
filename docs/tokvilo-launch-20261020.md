# tokvilo launch — 2026-10-20

The API gateway from geo-org is now branded tokvilo. Its existing Worker,
database, encrypted provider settings, API keys and audit history are retained.
The separate eco-geo.org marketing site is not part of this release.

## Public surfaces

- `https://tokvilo.com`: main site, model market, prices and digital goods.
- `https://www.tokvilo.com`: same service.
- `https://api.eco-geo.org`: legacy gateway alias.
- `https://tokvilo.com/dashboard/wallet`: recharge and one-time code redemption.
- `https://tokvilo.com/admin/orders`: manual digital-goods fulfillment.

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
One source item was sold out and is disabled. Procurement and fulfillment are
manual; no dealer-account integration is assumed.

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

- Production migrations 0008–0013 applied successfully.
- Build, ESLint, TypeScript and all 215 automated tests passed.
- Production D1 verification used isolated QA identities and actual application
  modules to test redemption/replay, reservation/settlement/replay, order
  creation/cancellation/replay and revocation. It ended with zero QA balance,
  no pending reservation, one revoked code and both QA users disabled.
- HTTPS homepage, www, products and pricing returned 200. Unauthenticated
  wallet and orders returned 401.
- Desktop and mobile product layout checked in the supported Chrome session.
- Merchant UI showed all three products on sale with 20 codes each. Public
  purchase page showed CNY 30 and Alipay/WeChat choices.

No real customer payment, paid model generation or registration email was sent
for verification. Authentication secrets remain in the existing Worker.
The authentication provider's remote redirect allowlist was not readable through
available configuration; registration requests specify
`https://tokvilo.com/login?verified=1`. Email delivery and the email-confirmation
round trip require a separate actual-user check.
