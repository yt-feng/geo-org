# Tokvilo English payments: Paddle and enterprise bank transfer

This document records approval, implementation and configuration separately. It
does not establish that a live customer payment and its service grant succeeded.

The operator verified the existing live **BO** Paddle account, seller **342323**,
through the signed-in Chrome session. The live dashboard now shows `tokvilo.com`
as **Checkout approved** and **Apple Pay approved**. The deployment configuration
sets `PADDLE_SALES_ENABLED=true`, `PADDLE_APPROVED_DOMAIN=tokvilo.com` and
`PADDLE_APPROVED_PRODUCT_SCOPE=tokvilo_api_usage`. Runtime checkout still requires
the correct live credentials and destination signing secret. These domain statuses
do not claim that every model output has been reviewed or technically moderated.

Remote setup verified during this implementation:

- Product: `pro_01m5m36cxv8g1zs93gm9t1c35q`.
- USD 20 price: `pri_01m5m3axm9ph27nmy42422rjca`.
- USD 50 price: `pri_01m5m3cpgs6f9nhqjh6g1y5ewx`.
- USD 100 price: `pri_01m5m3eg4xq179jp1khn9tc257`.
- All three prices are one-time USD prices, tax-exclusive, quantity one.
- A dedicated live Tokvilo API key was created with `price.read`,
  `transaction.read`, `transaction.write` and `adjustment.read` permissions.
  The dashboard displays its expiry as **January 21, 2027, 10:06 AM**; the displayed
  timezone was not recorded. Rotate it before that expiry and verify the new key
  against the live API before retiring the old one.
- A new live client-side token was created for Tokvilo. Credential values are
  deliberately excluded from this document and the repository.
- The live notification destination `https://tokvilo.com/api/billing/paddle/webhook`
  is active with Platform and Simulation usage. It subscribes to
  `transaction.completed`, `adjustment.created` and `adjustment.updated`.
- D1 migrations `0020_paddle_billing.sql` and
  `0021_manual_wallet_adjustments.sql` were applied remotely and verified.
- Production Worker version `a72374d7-1857-4c0f-bd30-60173870d85d`
  receives 100% of production traffic, with new Paddle sales enabled and all three
  credentials installed as encrypted production secrets.
- Public billing, terms, refund and privacy pages returned HTTP 200. The public
  Paddle configuration returned `enabled:true`, production mode and the three
  correct packs. Unauthenticated checkout and unsigned webhook requests returned
  HTTP 401.
- An official Paddle simulation delivered a correctly signed request and received
  HTTP 200 with `{"received":true,"ignored":true}`. It used `transaction.created`
  to verify delivery and HMAC without granting credit. That event was temporarily
  subscribed for this check, then removed; the destination has the three required
  events listed above. Simulation ID: `ntfsim_01m5m5kcskce22md9d26782vg4`.
- The signed-in English wallet opened the real production Paddle checkout for a
  USD 20 package. The checkout showed the correct Tokvilo product and one-time
  price. It was closed without entering customer/payment details or paying.
  Remote D1 readback found one `checkout_ready` order, a Paddle transaction ID,
  zero applied service credit and zero Paddle ledger entries. The existing
  wallet balance was unchanged. English checkout and enterprise inquiry controls
  were present without Chinese redemption purchase controls.
- The current suite passed 553 tests; production build, scoped lint, TypeScript
  and whitespace validation passed. A real paid transaction and resulting
  service grant have **not** been exercised.

The first production checkout attempt exposed a Cloudflare Workers compatibility
issue: `fetch` with `redirect:"error"` threw before reading the Paddle price. No
order or transaction was created by that attempt. Paddle requests now use
`redirect:"manual"` and reject non-success responses without following redirects
or forwarding credentials. Regression tests model the Workers restriction and
reject 301/302/303/307/308 responses. Safe diagnostics emit fixed stage, error-type
and category labels only. Resuming the same request after deployment opened the
successful unpaid checkout described above.

The IDs above are catalogue references, not credentials.

## Product scope and customer promise

The Paddle product is **Tokvilo API service usage**: access to Tokvilo's API and
Playground for text, image, video and audio generation through its model catalogue.
Tokvilo meters requests and maintains the customer's service balance. Describe
the complete model aggregation and generation service accurately during review;
the service is not limited to text if the live catalogue also sells other modes.

The launch prices are one-time, non-renewing service usage packs:

| Package ID | Pretax price | Service usage credited |
| --- | ---: | ---: |
| `20` | USD 20 | 20,000,000 microUSD |
| `50` | USD 50 | 50,000,000 microUSD |
| `100` | USD 100 | 100,000,000 microUSD |

Taxes are added by Paddle where applicable. Published Tokvilo usage prices
determine how quickly the service balance is consumed; a pack does not promise a
fixed number of tokens or generations across every model. There is no automatic
renewal, cash withdrawal, customer-to-customer transfer, interest or general
third-party spending. The service price already contains the configured markup;
the pack amount is not marked up a second time.

Paddle's [AI-company documentation](https://developer.paddle.com/get-started/how-paddle-works/ai-companies/)
expressly describes one-time credit packs and app-managed prepaid usage. This
supports the billing architecture; it does not replace a review of Tokvilo's
actual service. A balance labelled in USD is not by itself proof of prohibited
stored value, and changing the label alone does not establish eligibility.

Third-party memberships, account access, subscription top-ups and other digital
goods remain a **separate inquiry-only flow**. They cannot be purchased with
Paddle API usage funds. `/api/orders` rejects new legacy purchases. Inquiries do
not collect payment or debit the wallet; the operator replies by email within
24 hours. Disclose these separately visible pages when Paddle reviews the site.

Review the live [Acceptable Use Policy](https://www.paddle.com/help/start/intro-to-paddle/what-am-i-not-allowed-to-sell-on-paddle)
against image/video/audio capabilities and content restrictions. The payment
integration does **not** implement comprehensive content moderation. Policy copy
must not claim that all prohibited output is technically prevented. Resolve any
additional review requirements before enabling the affected paid scope.

## Paddle account setup

1. Submit `tokvilo.com` for review, with its actual legal seller details, product
   description, pricing, support contact, Terms, Privacy and Refund Policy. Keep
   business and product descriptions consistent with the public site. Use the
   existing BO account only if its legal seller is the correct seller for Tokvilo.
2. Use the existing Tokvilo product and price IDs recorded above; do not create
   duplicate catalogue entries. In a new environment, create an accurately
   described Tokvilo API usage product with the same three prices. Set
   `billing_cycle=null`, `trial_period=null`, `tax_mode=external`, USD
   currency, quantity one, and no localized price overrides. Do not create a
   recurring plan. Avoid discounts until grant logic explicitly supports them.
3. **Keep the account's existing global default payment URL unchanged.** This
   merchant account serves other projects, and changing that default could alter
   their payment links. Tokvilo explicitly sets `checkout.url` on each of its
   transactions to `https://tokvilo.com/dashboard/wallet?lang=en` with the server
   order reference in `paddle_order`. Paddle may append `_ptxn`. The Tokvilo domain
   must be approved for this custom checkout URL before live use. The page requires
   customer authentication and verifies the order owner before reopening it.
4. Create a Tokvilo-specific API key with only the permissions needed for reading
   prices, reading/creating transactions and reading adjustments. Use separate
   sandbox/live credentials and do not copy another project's secrets.
5. Create a client-side token for the correct environment. This token is public;
   the API key and webhook signing secret are server secrets.
6. Create a notification destination at
   `https://tokvilo.com/api/billing/paddle/webhook`, subscribed to exactly these
   required events: `transaction.completed`, `adjustment.created`, and
   `adjustment.updated`. Save its signing secret as a Worker secret.
7. Apply migrations `0020_paddle_billing.sql` and
   `0021_manual_wallet_adjustments.sql` to the actual deployed D1 binding before
   deploying the routes. Verify the tables/triggers exist on that binding.

See Paddle's [domain review requirements](https://www.paddle.com/help/start/account-verification/what-is-domain-verification),
[price creation reference](https://developer.paddle.com/api-reference/prices/create-price/)
and [transaction creation reference](https://developer.paddle.com/api-reference/transactions/create-transaction/).

## Runtime configuration and activation

| Name | Required value / handling |
| --- | --- |
| `PUBLIC_BASE_URL` | `https://tokvilo.com` |
| `PADDLE_ENVIRONMENT` | `production`, or `sandbox` for an isolated test deployment |
| `PADDLE_SALES_ENABLED` | Current deployment configuration: `true`; configuration and approval gates still apply |
| `PADDLE_APPROVED_DOMAIN` | `tokvilo.com`, only after actual domain approval |
| `PADDLE_APPROVED_PRODUCT_SCOPE` | `tokvilo_api_usage`, only after the actual offered scope is accepted |
| `PADDLE_CLIENT_TOKEN` | Live `live_…` or sandbox `test_…` token matching the environment |
| `PADDLE_API_KEY` | Worker secret; never a browser variable or committed value |
| `PADDLE_WEBHOOK_SECRET` | Worker secret for this destination; never committed |
| `PADDLE_PRICE_20_ID` | Actual active USD 20 one-time price ID |
| `PADDLE_PRICE_50_ID` | Actual active USD 50 one-time price ID |
| `PADDLE_PRICE_100_ID` | Actual active USD 100 one-time price ID |

`GET /api/billing/paddle/config` must remain `enabled:false` when production
approval markers or configuration are missing. It returns no API/webhook secret
and withholds the client token while disabled. These markers record a real review
outcome; setting them is not a substitute for that outcome.

Use sandbox first for callback delivery, payment completion, interrupted checkout,
duplicate callbacks and refund/reversal handling. Sandbox receipts never add
spendable production balance, even when their transaction status is completed.
Then verify actual production approval, correct live prices and destination,
current policies and operating service availability. Only then set sales to
`true` and validate a genuine live payment and server-side grant. Keep deployment,
sandbox testing, merchant approval and live payment acceptance as separate results.

To pause new checkouts, set `PADDLE_SALES_ENABLED=false`. Existing authenticated
order lookup, same-request recovery and signed payment/refund reconciliation
remain active. Do not remove the webhook or signing secret while existing orders
can still be completed, refunded or disputed.

## Payment lifecycle and reconciliation

The authenticated browser posts `{packageId, requestId}` to
`POST /api/billing/paddle/checkout`. The server validates the configured price,
stores the order before the external POST, and binds the transaction to that
order and customer. Only the server sets line items, quantities and binding data.
The client opens Paddle with the returned transaction ID.

If a transaction POST response is lost, the order remains `outcome_unknown`.
Reusing its request ID returns the original order and never creates another
Paddle transaction. `GET /api/billing/paddle/orders/{id}` is authenticated and
owner-only. It can recover the original transaction using a bounded, read-only
Paddle query, or reconcile a known transaction. A webhook can also bind an
unknown response to the original order. Unresolved results remain pending; do
not manufacture a second purchase to make the first look successful.

The raw webhook body is checked against the destination's HMAC signature and
timestamp. Browser `checkout.completed` only triggers a status check. Provisioning
requires a Paddle API read showing `completed`, the exact server-bound owner,
one allowlisted one-time price, quantity one, USD and the expected pretax amount
without discounts. API-verified order recovery can perform the same reconciliation
when a webhook receipt is delayed.

Each reconciliation obtains a short per-order lease and reads the current
transaction and its complete current adjustment list. A single D1 batch updates
the order and records the event. A trigger writes only the change in granted
service usage to `wallet_ledger`; the existing ledger trigger updates the wallet
in the same transaction. Concurrent or repeated delivery cannot duplicate a grant.

Approved refunds, credits and chargebacks reduce retained service usage in
proportion to the refunded pretax service amount. Pending/rejected adjustments
and tax-only refunds do not reduce usage. When Paddle marks an original debit
`reversed`, its effect is removed; the separate reverse entry is not added again.
Reconciliation uses current API state, so older webhook delivery cannot undo a
newer adjustment. If the service grant has already been spent, a refund can leave
a negative balance and existing wallet checks block further paid usage.

Do not edit the wallet manually to represent a Paddle refund. Complete the cash
refund in Paddle, then verify the adjustment callback and resulting ledger.
If delivery fails, replay that notification or recover the same order. Use
[signature verification](https://developer.paddle.com/webhooks/about/signature-verification/)
and the [adjustment event reference](https://developer.paddle.com/webhooks/adjustments/adjustment-updated/)
when investigating delivery. No event payload, API secret or binding secret should
be copied into public support messages.

## Audit records and operator checks

- `paddle_orders`: customer, original request ID, environment, price/amount,
  transaction ID, state, currently retained grant and reconciliation version.
  The private binding secret stays server-side.
- `paddle_events`: unique event ID, type, transaction/order relationship and
  occurrence/processing timestamps. Other apps sharing the merchant account are
  ignored when their transactions have no Tokvilo order binding.
- `wallet_ledger`: `paddle_service_credit` and `paddle_service_adjustment` entries
  reference the actual Paddle transaction. Entry IDs include the order and
  reconciliation version. Sandbox does not create these entries.

Read-only investigation queries, replacing the order reference intentionally:

```sql
SELECT id,user_id,environment,package_id,transaction_id,status,
       credit_microusd,applied_credit_microusd,reconciliation_version,
       created_at,updated_at
FROM paddle_orders WHERE id='ORDER_ID';

SELECT event_id,event_type,transaction_id,occurred_at,processed_at
FROM paddle_events WHERE order_id='ORDER_ID' ORDER BY processed_at;

SELECT id,user_id,kind,amount_microusd,reference_id,created_at
FROM wallet_ledger WHERE reference_id=(
  SELECT transaction_id FROM paddle_orders WHERE id='ORDER_ID'
) ORDER BY created_at,id;
```

Do not use `SELECT *` in shared diagnostics: order records contain private binding
data. Customer balance alone cannot establish that a specific payment was received;
match transaction, order, event and grant records.

## Enterprise bank transfers and manual service credit

The English page offers a contact flow for an enterprise quote and bank-transfer
instructions. The email draft is addressed to `yt.feng@foxmail.com`. Opening the
draft is not a sent message, invoice, bank instruction or proof of payment. Send
the actual company's bank details and agreed amount through the operator's usual
process; the website must not invent bank details.

After checking the bank's actual receipt, use `/admin/billing`:

1. Sign in with the dedicated administrator login. An ordinary registered email,
   including a matching email allowlist entry, does not become an administrator.
2. Search the customer's full registered email. Plus aliases remain separate:
   `name@example.com` and `name+test@example.com` identify different accounts.
   The customer must have registered and signed in so their local account exists.
3. Check the returned email, customer ID and current balance. Enter the agreed
   USD service credit, actual bank name/transaction reference and verification
   note. Amounts allow two decimal places, from $0.01 to $100,000 per entry.
4. Select **Enterprise bank transfer**, confirm actual receipt and confirm the
   displayed customer/amount. Submit once, then check the new audit/ledger record.
5. If confirmation is interrupted, recover the same request. Keep the exact bank
   reference; changing a request ID does not permit crediting that reference twice.

`test_credit` and `correction` classify non-bank positive grants separately; they
must not claim bank receipt. The current operator UI adds service credit only; it
does not perform cash refunds or arbitrary negative adjustments. Bank refunds
must be handled through the corresponding banking/operator process.

`tokvilo_manual_wallet_adjustments` records the actor account, customer identity,
amount, reason, receipt confirmation, unique bank/reference ID and note. It is
immutable. Inserting the audit row and its `manual_bank_transfer`,
`manual_test_credit` or `manual_correction` wallet entry is one transaction. The
signed shared administrator account identifies that account; it does not identify
different humans who share those same credentials.

English customers use only Paddle or this enterprise transfer flow. Existing
Chinese Liandong code redemption remains documented separately in
[tokvilo-payments.md](./tokvilo-payments.md).

## Verification commands

```sh
node --test tests/paddle-billing.test.mjs tests/paddle-payment-ui.test.mjs tests/admin-wallet.test.mjs tests/wallet-redemption.test.mjs
npx tsc --noEmit
npm run lint
npm run build
```

The focused backend suite covers signatures, price/owner matching, parallel
checkout, unknown POST outcomes, webhook and GET recovery, duplicate/concurrent
events, atomic rollback, refund-before-completion delivery, chargebacks after
spending, reversals, sandbox isolation and sales pause. Manual-credit tests cover
admin-only access, exact customer identity, receipt confirmation, reference/request
idempotency, integer amount parsing, audit immutability and lost-response recovery.
These local checks do not prove a deployed real charge and its downstream grant.
