# tokvilo selected service operations

This is an internal operating note. The customer site calls the service **tokvilo 精选** and returns `provider: selected`; no supplier rates, group names or markup fields belong in public responses.

## Inventory and supported requests

The signed-in RKAPI model square was read on 2026-10-21. Its four pages contain 32 models. The dated server-only snapshot includes every model and its visible base rates, group multipliers, and context tiers. It is not a live price feed.

- 29 text models: `POST /api/selected/v1/chat/completions`, one response, plain text messages, non-streaming, explicit output limit 1–4096, input up to 32 KB. Tools, native Responses/Anthropic/Gemini payloads, storage, media input and streaming are not admitted.
- `gpt-image-2`: `POST /api/selected/v1/images/generations`, one standard 1024x1024 image, `response_format=url` only. Base64 requests are rejected before a wallet hold; settlement requires one HTTPS image URL. Responses retain a 1.5 MB byte cap and a 30-second body deadline, keeping persisted JSON below D1's 2,000,000-byte row limit. Image binary storage is outside this adapter.
- `gemini-3.1-flash-image` and `gpt-image-2.5`: listed with prices; their generation/billing contracts still require separate adapters.
- Each service uses its own route and request table. A model ID shared with another service does not switch the customer silently to another supplier.

The model detail API examples explicitly advertise `https://rkapi.com/v1/chat/completions` for GPT and Claude's **openai** tab, and `https://rkapi.com/v1/images/generations` for `gpt-image-2`. The standalone setup guide's Claude Code CDN address is for a different native protocol. No native CLI compatibility is implied by the plain chat adapter.

## Cash conversion

The public `/api/status` returned `price=0.2`, `usd_exchange_rate=7.3`, and `quota_per_unit=500000`. The wallet sells 50 displayed quota units for CNY 9.90 after the 1% discount; its undiscounted cash value is CNY 10. The catalogue's public frontend multiplies quota rates by `price` but formats the result with a fixed `$` symbol, without dividing by the exchange rate in its catalogue branch.

Consequently, a captured displayed base rate is already in nominal CNY. Server billing divides out the snapshot's original CNY-per-quota factor, applies the current public cash conversion, applies the explicitly configured fixed group multiplier, converts CNY to USD, and applies 1.20 exactly once. Request totals use rational arithmetic and round to integer micro-USD only at the end. Volume/top-up promotional discounts are not assumed.

The source-code evidence is the public `index.7eaf712b62.js` module 79220 (catalogue conversion) and module 43459 (`Tg`, fixed USD formatter), with page scripts `7952.1b8083ff7a.js` and `5063.8935527d97.js`. The current page and status response remain authoritative if this implementation changes.

## Credential configuration

Create dedicated fixed-group keys at `https://rkapi.com/keys`. Do not reuse an inherited/automatic key: a successful model-list response does not establish which billing group it will choose.

Recommended groups are `codex` (5 models), `claude` (9), `gemini` (13, of which 12 text adapters), `Grok` (3), and `gpt-image-2` (2, of which one adapter). Explicitly limit each key to the models its service should expose. Existing user keys remain independent.

Store the following only as the Worker secret `RKAPI_ROUTES_JSON`, never in source control, client bundles, issue text or logs:

```json
{"routes":[{"group":"codex","apiKey":"REPLACE_IN_SECRET_STORE","groupVerifiedAt":"ACTUAL_FIXED_GROUP_CHECK_TIME_ISO","crossGroupRetry":false,"modelIds":["gpt-6.1-sol"]}]}
```

The timestamp attests that the operator checked the key's actual fixed group in the provider UI; it is not inferred from the supplied name. Disable the provider's cross-group retry option and attest `crossGroupRetry:false`, so a failed channel cannot move to a differently priced group. The server additionally verifies the key's `/v1/models` list and intersects it with the explicit allowlist. Unknown/automatic groups, cross-group retries, a missing attestation, invalid credentials or absent models keep billing disabled. Key checks and cash conversion have 60-second caches. Key validity alone does not prove paid acceptance.

## Price refresh and expiry

The catalogue expires seven days after its real observation time. Once expired, listed prices remain visible as dated references but `billingReady=false`; new quotes and requests stop. Existing receipts remain accessible. `observedAt` always denotes the catalogue observation, not a later exchange-rate check.

Unauthenticated `/api/pricing` returned HTTP 401 on 2026-10-21. The discovered public `/api/ratio_config` returned HTTP 403 with “倍率配置接口未启用”. The site documentation does not establish that a business API key can read either endpoint. Do not extract browser login credentials or claim an automatic price sync until an authorized machine-readable pricing contract is available.

To refresh before expiry:

1. In the supported signed-in browser, open `/pricing`, clear all filters, and read every page. Capture each model's detail dialog **概览** text into a JSON array of `{model, detail}`. Verify the unique count equals the complete visible catalogue; include all price tiers and groups, not only the card's “from” price.
2. Save a fresh unauthenticated `GET https://rkapi.com/api/status` JSON response separately. Record the actual capture timestamp in UTC. Do not copy API keys or any browser login state.
3. Run `node scripts/import-rkapi-catalog.mjs DETAILS_JSON PUBLIC_STATUS_JSON OBSERVED_AT_ISO`. It validates groups, base rates, tier shape, duplicates, and removals, and sets a seven-day expiry. New model IDs remain without an adapter until their request contract is checked; removals/group additions require explicit review.
4. Review the snapshot diff and model counts. Run `node --test tests/rkapi-relay.test.mjs tests/selected-playground.test.mjs`, `npx tsc --noEmit`, the normal build and lint, then deploy the Worker. Read back `/api/model-catalog`, `/api/pricing` and the dated selected-service label.

Refreshing only the timestamp without a new complete price capture is not a refresh. If the source opens a supported pricing API, replace this manual capture with a bounded authenticated fetch and retain expiry/failure closure.

## Settlement and acceptance

The relay uses the existing tokvilo account, hashed API keys, wallet reserves/ledger and usage logs. `0019_rkapi_relay.sql` creates an owner-scoped receipt table. Idempotency keys apply across retries; timeouts, malformed responses or unknown outcomes never trigger a second paid request. Read outcomes with `GET /api/selected/v1/requests/ID` or list recent IDs with `GET /api/selected/v1/requests`.

A successful bounded response is saved before settling its wallet hold. Replay overlays the actual wallet state. If reservation insertion commits but a following database read fails before dispatch, the handler reads the wallet back and refunds only when it confirms the original request was not sent. Unreadable state is retained for review.

Chat settlement requires complete prompt/completion totals and explicit cache counts whenever that model has cache rates. Conflicting cache aliases, native cache fields with different inclusion semantics, undocumented paid usage, missing counts or out-of-bound usage retain the hold. This is deliberately distinct from a verified real paid call: before enabling customer traffic, perform small controlled calls on each configured group, inspect only redacted usage fields, and confirm provider debit, tokvilo charge, output persistence and replay. Do not announce operational paid acceptance from local tests alone.

Unknown holds need an operator to match the original request with the supplier usage log. Do not resend to discover its outcome. No automated refund or manual charge is authorized merely by a timeout.
