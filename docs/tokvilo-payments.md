# Tokvilo wallet and Liandong delivery

Tokvilo uses an independent wallet denominated in integer USD micro-units.
Liandong sells CNY 30 / 90 / 300 offers and delivers one-time `TK-…` codes.
The code's USD credit is fixed when issued. `USD_CNY=7.2` is a fixed recharge
conversion, not a live FX quote. The 20% model/product markup is applied to usage
or product prices; it is not applied again to the recharge face value.

JiaNong `JN-…` codes and its three existing product URLs are rejected. Tokvilo
needs its own products and delivery inventory.

## Configuration

- `USD_CNY`: fixed recharge conversion, e.g. `7.2`.
- `REDEMPTION_ENABLED`: existing code redemption.
- `REDEMPTION_ISSUANCE_ENABLED`: administrator code issuance.
- `LIANDONG_SALES_ENABLED`: new purchase links.
- `LIANDONG_STORE_URL`: optional public shop URL.
- `LIANDONG_PRODUCT_30_URL`, `LIANDONG_PRODUCT_90_URL`,
  `LIANDONG_PRODUCT_300_URL`: Tokvilo-specific offer URLs.

Buying is enabled only when all three offer URLs and the conversion are valid
and sales/redemption are enabled. Pausing new sales or issuance does not disable
existing code redemption. No merchant API key or webhook is used in this
automatic-code-delivery integration. A browser return never credits a wallet.

## Inventory

Apply `drizzle/0008_tokvilo_wallet.sql` before importing inventory. The issuance
operator must exist as an active local user; opening the authenticated wallet
calls `ensureUser`. Online issuance requires an administrator session.

The following command prepares 20 codes per offer without submitting anything:

```sh
node scripts/prepare-tokvilo-inventory.mjs \
  --batch tokvilo-launch-20261020 --actor admin --count 20 --usd-cny 7.2
```

The command prints paths/counts only. Manifest and TXT stock are written with
mode `0600` under the ignored `.artifacts/tokvilo-private/<batch>/` directory.
The manifest is persisted before derived output; repeating the exact command
recovers the same files, and changed parameters are rejected.
Offline imports support up to 100 codes per offer and enforce a 90 KB statement
budget below D1's [100 KB SQL statement limit](https://developers.cloudflare.com/d1/platform/limits/).
Online administrator issuance supports up to 1,000 codes with bounded D1 batches.

Run the generated hash-only `import.sql` through `wrangler d1 execute --remote
--file ...` against the configured Tokvilo database. One SQL statement and
triggers import all offers atomically. Re-executing that file is idempotent.
Only after confirming imported counts should the three TXT files be uploaded
into their matching Tokvilo products' automatic delivery stock.

Database records store hashes and suffixes, never plaintext codes. The local
manifest and TXT exports are bearer inventory; they must not be committed or
published. Issuance/stock import creates no cash-paid transaction record.

## Wallet and orders

`reserveWallet`, `settleWallet`, and `refundWallet` use `(userId, requestId)`
identity. Reservation and ledger changes are atomic. Insufficient funds return
402. Settlement above the reservation returns 409 without changing anything.
Unknown upstream results retain their reservation. Repeating the same terminal
result does not move funds again.

Digital product orders bind the buyer's confirmed CNY price and USD reservation
amount. New orders reserve atomically; concurrent duplicate requests create one
order. Administrators first claim pending orders (`processing`) before procurement
or delivery. A buyer can cancel only before processing. The assigned administrator
can deliver and settle, or an administrator can cancel and refund the reservation.
Delivery text is private to its buyer and administrators. Terminal updates are
idempotent and conflicting delivery changes are rejected.

Revoking a redeemed code reverses its original full USD grant once. If it has
already been spent, the balance can become negative and subsequent paid requests
are blocked. Revocation does not issue a monetary refund; the corresponding
Liandong order must be handled in the merchant portal.

## Verification

`node --test tests/wallet-redemption.test.mjs` covers concurrent balance claims,
idempotent settlement, rollback, owner separation, malformed/expired/revoked
codes, 1,000-code D1 batching, private export recovery, atomic SQL import,
confirmed order amounts, processing/cancellation races, and delivery rollback.
Production verification should also use a dedicated non-sale QA batch to redeem,
replay and revoke a code, checking one grant and one reversal. This does not
replace a buyer's completed payment followed by Liandong delivery.
