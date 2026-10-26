# Digital goods catalogue audit — 2026-10-20

This internal source comparison records the public catalogue at
`https://xiaoxincodex.codes/products` and all eight product detail pages,
read through the supported browser session on 2026-10-20 (Asia/Shanghai).
The directory had no further pagination. Each detail page had one specification:
eight source products, eight tokvilo entries, no missing entry. Seven were
listed in stock and one was sold out. The other visible Codex, Claude, Grok and
Gemini categories were empty at the time of the check.

All prices below are CNY. Retail reference prices are the observed source
price × 1.20. Counts are source inventory snapshots, not tokvilo inventory or a
real-time availability statement.

| tokvilo ID | Detail page | Source specification | Source price | tokvilo reference price | Observed source stock |
| --- | --- | --- | ---: | ---: | ---: |
| `pro-20x-ph` | https://xiaoxincodex.codes/products/11123 | `pro20X菲区` | 1,250 | 1,500 | 1 |
| `pro-5x-ios` | https://xiaoxincodex.codes/products/222 | `Pro5X` | 740 | 888 | 8 |
| `pro-5x-ph` | https://xiaoxincodex.codes/products/1568 | `PRO 5X` | 740 | 888 | 3 |
| `plus-year` | https://xiaoxincodex.codes/products/132434 | `年puls` | 1,600 | 1,920 | 100 |
| `pro-20x-ios` | https://xiaoxincodex.codes/products/2132324 | `20X(IOS)` | 1,550 | 1,860 | 0 — sold out |
| `plus-ios` | https://xiaoxincodex.codes/products/11111 | `Puls（ios）` | 145 | 174 | 2 |
| `pro-5x-cl` | https://xiaoxincodex.codes/products/111 | `pro5x` | 740 | 888 | 5 |
| `plus-ph` | https://xiaoxincodex.codes/products/123 | `puls` | 135 | 162 | 19 |

## Detail-page observations

- Pro 20x Philippines: the card says automatic delivery, while the detail page
  requires contacting support. It requires an existing personal GPT account.
  The source claims a refund may be requested before activation and no refund
  after activation.
- Pro 5x iOS: card-code redemption or manual support. Its warranty wording
  concerns the subscription rather than account bans.
- Pro 5x Philippines: 30-day subscription; cannot overwrite an iOS subscription;
  an eligible Philippines Plus subscription can be upgraded.
- Plus annual: manual delivery; the source describes one year of validity and
  compatibility with an existing Plus subscription.
- Pro 20x iOS: sold out; one-month subscription, replacing rather than stacking
  the old subscription, without refreshing the usage allowance.
- Plus iOS: one month, for personal accounts; replaces existing Plus time rather
  than stacking and cannot overwrite Pro.
- Pro 5x Chile: card-code redemption or manual support.
- Plus Philippines: existing personal account required. The source claims
  pre-activation refund eligibility, no post-activation refund and subscription
  warranty rather than account-ban coverage.

These are recorded supplier statements, not independently tested guarantees or
tokvilo commitments. Source naming, detail URLs and observed counts are internal
audit information in `productSourceAudit`; public pages use tokvilo branding.

## Current customer flow

Customers can submit a product inquiry without an account. The form displays the
selected product, specification and reference price, asks for an email and
requirements, and optionally a name. It has no password field and performs no
wallet deduction or reservation.

The service stores the inquiry before attempting its notification to
`yt.feng@foxmail.com`. A saved inquiry is acknowledged even when notification
delivery is still pending. The customer is told to expect an email reply within
24 hours. Availability, account eligibility and fulfillment are confirmed
manually. A sold-out snapshot can still receive an availability inquiry.

API calls continue to use the separate wallet, Liandong recharge and usage
settlement flow. No digital-goods automatic delivery is implied by a source
card's delivery label.
