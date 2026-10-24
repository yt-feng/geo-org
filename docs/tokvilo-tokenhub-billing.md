# Tokvilo TokenHub billing

`GET /api/pricing` publishes USD prices with `observedAt`, source and retail
rates. Source rates come from `https://ai-tokenhub.ai/api/pricing`; retail rates
are source rates multiplied by 1.20. Rates and wallet amounts are stored as
integer micro-USD. Fractional micro-USD amounts round upward; usage terms are
summed before rounding the final request total.

Each new member generation request retrieves a fresh source catalog. Missing
prices, inconsistent currencies or units, differently priced deployments, and
unsupported pricing configurations prevent a paid request from being sent.
Cached public display prices are never used as authorization to generate.

Members use a prepaid wallet. All generation POSTs require an
`Idempotency-Key`. The server claims that key, saves a price snapshot and holds
funds before forwarding. Identical retries replay the saved response; changed
payloads cannot reuse the key. `tk_live_` and existing `eco_live_` keys are
accepted. Public generation routes charge administrators and members using the
same wallet rates. Provider configuration checks and the independent audit's
source-cost calculations are unchanged.

- Chat holds a conservative input allowance plus the requested output limit.
  Settlement uses `prompt_tokens`, `completion_tokens` and documented cache-hit
  counts. The current member adapter accepts text input, one response, client
  function tools, and explicit `max_tokens` or `max_completion_tokens`.
- Images hold the requested 1–10 image count. Settlement counts successful
  returned images. Automatic sequential generation has no member billing
  adapter yet.
- Videos hold a conservative allowance for the selected resolution and duration.
  `tokenhub_billing` binds the task owner, wallet request and price snapshot.
  A subsequent task query settles only a successful final response with
  `usage.completion_tokens`. The member adapter supports text/image input,
  480p/720p/1080p and 4–15 seconds (automatic duration reserves 15 seconds).
  Reference-video input, custom frame counts and special billing modes are
  not accepted by this adapter.

`POST /api/pricing/quote` accepts `{provider, mode, body}` from an authenticated
same-origin workbench. It returns the current rates and `reservedMicrousd`
without touching the wallet or sending generation requests. Each account is
limited to ten quote lookups per minute; input is bounded to 128 KB.

The video formula and final usage field are documented in
[TokenHub's billing guide](https://docs.ai-tokenhub.ai/en/api-guides/Dreamina-Seedance-2.0-Billing-Instructions).
The hold uses a conservative pixel/fps bound rather than billing from duration.
The actual final charge uses returned usage and the saved resolution rate.

Explicit rejected requests and confirmed failed/cancelled/expired videos return
the hold. Transport failures, missing or inconsistent usage, above-hold usage,
and incomplete responses preserve it for reconciliation. Deleting an already
completed task does not create a new refund. Polling another user's task is
denied. The response's `tokvilo_billing` reports settled/refunded/pending state.
The cron reconciler polls at most ten existing tasks per tick, with an atomic
five-minute lease and at most 288 polling attempts per task. It cannot create
new generation requests. Response replay overlays the current wallet receipt.

The legacy data relay uses the same wallet for the ten Twitter/X GET endpoints
whose per-request billing is confirmed in the
[provider's endpoint reference](https://tikhub.io/twitter-api). Each new request
reads its current source unit price and adds 20%. Other paid data endpoints are
unavailable until their billing unit is confirmed. The conservative LinkedIn and
batch/live cost caps are never treated as actual customer charges. Known
zero-cost endpoints remain free. Confirmed JSON success settles the fixed
price; explicit rejection refunds the hold; uncertain results remain held.
Successful JSON responses up to 256 KB are stored per owner for idempotent
replay. Larger responses retain a wallet receipt and reject duplicate delivery
attempts rather than create a second paid request.

Apply all migrations through `0013_data_relay_receipts.sql` before enabling the
new routes. Offline checks are `node --test tests/pricing.test.mjs
tests/pricing-api.test.mjs tests/tokenhub-relay.test.mjs
tests/data-relay-billing.test.mjs`; they use real SQLite wallet triggers and no
paid upstream requests.
