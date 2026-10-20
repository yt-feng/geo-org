# tokvilo gateway: executable scope and billing

Updated 2026-10-20. This is an internal implementation and audit document; the
customer website and public API show only tokvilo retail prices. Provider names,
source prices and the markup policy below are internal evidence, not customer copy.

## Public routes and request identity

The authenticated canonical API is `/api/gateway`:

- `GET /v1/models`: models and supported retail pricing.
- `POST /v1/chat/completions`: non-streaming, plain-text chat.
- `POST /v1/images/generations`: supported fixed-price image generation, including
  one Midjourney Imagine task per request.
- `POST /v1/videos/generations`: documented video models with bounded duration and
  model-specific resolution, sound and reference-image rules.
- `POST /v1/music/generations`: Suno v6/v6-mini/v6-wild and Flow Music generation.
- `GET /v1/tasks` and `GET /v1/tasks/{task_id}`: only the current account's tasks.
- `GET /v1/music/tasks/{task_id}`: equivalent owner-scoped music task query.

The older `/api/apimart` routes remain compatible and share the same canonical
request hash and idempotency receipt. Every generation requires a stable
`Idempotency-Key`. Members and administrators use the same wallet billing path.
The provider credential remains server-side. Four known catalogue identifiers
have exact `-tokvilo` public aliases; unknown suffixes are not rewritten. The
upstream model is restored before hashing, quoting and forwarding, so an old ID
and its public alias cannot create duplicate paid work under one request key.
Only model metadata is rewritten in responses; generated content is preserved.

The workbench reads the live catalogue and retail prices, selects a valid default
for each supported video model, and requires an exact quote before confirmation.
The quote is bound to the entire current JSON payload; editing it invalidates the
confirmation. The confirmed amount is sent as
`X-Tokvilo-Max-Reserve-Microusd`. A higher recalculated reservation returns 409
before any wallet hold, receipt or provider generation is created. Public
`POST /api/pricing/quote` and generation share one request normalizer.

## Verified adapter coverage

The dated fixture `tests/fixtures/apimart-pricing-20261020.json` contains 293
APIMart catalogue entries. The execution parser admits **248**:

| Category | Catalogue entries | Execution adapters |
| --- | ---: | ---: |
| Text / LLM | 190 | 174 |
| Image | 47 | 32 |
| Video | 54 | 40 |
| Music | 2 | 2 |
| Total | 293 | 248 |

The later production readback at 12:11 UTC on 2026-10-20 matched all **295**
identifiers in a fresh source response: two image models,
`flux-3-image-klein` and `hy-image-v3.5-preview`, were added after the fixture.
Both have public retail prices and are included in the refreshed metadata-only
fallback snapshot. Their official generation/task contracts were subsequently
checked and adapted: Klein supports five resolution tiers and at most ten
reference images; HY supports three resolution tiers and at most five reference
images. Both explicitly default to 1K and one generated image; pixel-size
overrides remain rejected. Current coverage is therefore **250 of 295**, including
34 image adapters, with 45 entries not executable. The table above describes the
unchanged dated test fixture; the two additions have a separate fixture.

`billingReady` means that the local request, price and settlement adapters have
been implemented. It is **not** a claim that every model has passed a real paid
provider call. This round used local tests and official contracts; no paid
model generations were executed. The complete public catalogue can therefore
show more models than the executable adapter list.

Fixed image adapters require an explicit documented model allowlist in
`lib/apimart-image-options.ts`; a new row with `fixed_prices` cannot enable
itself. Video adapter contracts and their official documentation paths are in
`lib/apimart-video-options.ts` and `lib/apimart-video-request.ts`. Forty video
default requests, including required reference images, have positive quotes
against the complete dated fixture.

The 34 image entries include 33 documented asynchronous image models and
Midjourney. Midjourney uses the public image route but is forwarded internally to
`/v1/midjourney/generations`; the model field is removed only from that outbound
body. It supports 24 Imagine version/speed combinations. One task can deliver a
grid and four crops but is charged once, not five times. Paid follow-up actions,
prompt flags that can override pricing, permutations and repeat operations are
rejected. Its basic UI defaults to version 7 / relax.

## Price and settlement rules

The official pricing client reads
`https://apimart.ai/api/pricing/models/all`. The dated JSON supplies token rates,
fixed image/video/music prices and, where present, reference-image material
charges. Each request fetches current pricing; failure does not fall back to
historical catalogue prices for a paid request.

Internally the configured policy is source USD multiplied by 1.20. Integer
micro-USD wallet amounts are obtained by summing exact decimal costs, applying
the retail conversion, then rounding up once. Prices with fractional micro-USD
values are not rounded before multiplication by duration or material count.
Public responses exclude source prices, provider task cost/credits and private
pricing snapshots. They retain the retail reservation and final retail charge.

Text pricing includes all 37 complex chat entries formerly excluded for tiers,
cache writes, time windows or optional paid extras. Quotes use a conservative
UTF-8 input bound, bounded output of 1–4096 tokens, and the necessary maximum
rates. Settlement uses actual prompt/completion and cache usage, full-request
tier selection and the recorded time window. Plain string messages only are
accepted: tools, explicit cache operations and unadapted paid extras are
rejected. Cache-write models require sufficient usage evidence; Claude's
string-only path permits documented omitted write usage to mean zero, while
other models without that evidence retain the hold. In particular, the 13
GPT/Qwen entries with cache-write rates still require complete cache-write
usage; absent evidence leaves the reservation pending instead of assuming
zero. The 174 count is contract/parser adaptation, not 174 successful live
settlements. A mismatching model,
inconsistent totals, missing evidence, crossing an unresolved time-price
boundary, or a charge exceeding the reservation preserves the hold for review.

Media quotes use the selected resolution/version/quality/mode/audio price, its
unit (per image, per call or per second), duration when applicable, and published
input-image fees above any free allowance. Unpriced reference additions are
blocked. Pixel sizes that override the selected image-resolution price are not
accepted. Seedream 5 Pro/Flash accept at most one reference image until extra
reference prices are available; Flash permits only its verified lower-size
price tier. Flux 2 accepts at most eight images. Unsupported edit/continuation,
reference video/audio and automatic-duration operations are rejected.

Suno supports only the three v6 variants and generation; custom max mode uses
the documented double charge. Flow Music supports generation, not its other
priced operations. Music polls are sent to the provider's music task endpoint;
all media tasks remain available through tokvilo's unified owner-scoped route.

The asynchronous task's documented numeric USD `cost` supplies the actual
media charge, converted once to retail micro-USD. A missing cost is never
inferred from credits or account balance changes. Failed/cancelled tasks refund
the reservation. Successful tasks with incomplete or conflicting billing
retain the reservation. Replayed creation receipts overlay the persisted wallet
state, and the first stored terminal task result is preserved.

Task GET and the five-minute scheduled reconciler settle idempotently without
creating paid work. The worker atomically leases at most ten existing tasks per
run and stops automatic polling after 288 attempts. Explicit owner queries
remain available. Unknown transport outcomes keep their original request ID
and hold; they are never silently resubmitted.

## Entries still not executable

The following 45 entries from the dated fixture retain catalogue/retail-price visibility but have no
paid adapter in this release. Backend guards reject them before a hold or
provider request, even if a client bypasses the UI.

**13 token-priced images:** no proven request-level maximum cost or equivalent
provider quote contract for a conservative complete reservation. Catalogue
`limits` alone are not treated as a hard execution limit:

`gemini-nano-banana-2.1`, `gemini-3.1-flash-lite-image`,
`gemini-2.5-flash-image-preview-official`, `gemini-3-pro-image-preview-official`,
`gemini-3.1-flash-image-preview-official`, `gpt-image-1`, `gpt-image-1-official`,
`gpt-image-1.5-official`, `gpt-image-2-official`, `gpt-image-2.5-flare`,
`gpt-image-2.5-sunburst`, `mai-image-2.6`, `mai-image-2.6-flash`.

**2 fixed-price images:** a matching documented asynchronous generation/task
contract was not established: `dall-e-3`, `grok-imagine-1.5-edit-apimart`.
The separate base `grok-imagine-1.5-apimart` and `imagen-4.0-apimart` do have
explicit official contracts and are included under their public aliases.

**14 videos:** additional editing/reference/motion or token-settlement adapters
are not implemented, or the bounded generation contract is missing:

`MiniMax-H3-Context-IR`, `MiniMax-H3-Regeneration`, `gemini-omni-1.1-flash`,
`Omni-Flash-Ext`, `gemini-omni-flash-preview`, `grok-imagine-1.5-video-apimart`,
`kling-v2-6-motion-control`, `kling-v3-motion-control`, `seedance-2.0-face`,
`seedance-2.0-fast-face`, `seedance-2.5`, `wan2.6-i2v`, `wan2.7-r2v`,
`wan2.7-videoedit`.

In particular, Gemini Omni's typical 3–10-second output is not a hard duration
limit and its documented request has no duration parameter. The old Grok video
alias, the two face variants and the old Wan i2v ID lack a matching complete
contract in the reviewed documentation. They are not enabled by inventing a
fixed duration or assuming another model's parameters.

**16 non-chat LLM entries:** generic token rates do not establish that these
models accept chat completions or provide sufficient usage evidence:

`babbage-002`, `davinci-002`, `gpt-3.5-turbo-instruct`,
`gpt-4o-mini-realtime-preview`, `gpt-4o-mini-realtime-preview-2024-12-17`,
`gpt-4o-mini-transcribe`, `gpt-4o-realtime-preview`,
`gpt-4o-realtime-preview-2024-10-01`, `gpt-4o-realtime-preview-2024-12-17`,
`gpt-4o-transcribe`, `omni-moderation-latest`, `text-embedding-3-large`,
`text-embedding-3-small`, `text-embedding-ada-002`, `text-moderation-latest`,
`text-moderation-stable`.

## Validation and source trail

Local tests cover real SQLite wallet transitions; owner isolation; API key and
cookie authentication; concurrent duplicates; new/legacy URL and model alias
replays; exact decimal totals; missing/conflicting usage; failed tasks; unknown
transport outcomes; amount caps before mutation; bounded scheduled queries;
video defaults; music polling; Midjourney per-task billing; and the workbench's
two-step confirmation. These are implementation tests, not live provider or
production deployment acceptance. Release verification records deployment
separately.

- [Official pricing](https://apimart.ai/pricing)
- [Non-streaming chat](https://docs.apimart.ai/en/api-reference/texts/general/chat-completions-nostream)
- [Task result and USD cost](https://docs.apimart.ai/en/api-reference/tasks/status)
- [GPT Image 2](https://docs.apimart.ai/en/api-reference/images/gpt-image-2/generation)
- [Grok base model alias](https://docs.apimart.ai/en/api-reference/images/grok-imagine/generation)
- [Imagen 4 model](https://docs.apimart.ai/en/api-reference/images/imagen-4.0-apimart/generation)
- [Midjourney Imagine](https://docs.apimart.ai/en/api-reference/images/midjourney/imagine)
- [FLUX 2 size precedence](https://docs.apimart.ai/en/api-reference/images/flux-2/generation)
- [Seedream 5 Pro material and size rules](https://docs.apimart.ai/en/api-reference/images/seedream-5-0-pro/generation)
- [FLUX 3 Image Klein](https://docs.apimart.ai/en/api-reference/images/flux-3-image-klein/generation)
- [HY Image 3.5 Preview](https://docs.apimart.ai/cn/api-reference/images/hy-image-v3.5-preview/generation)

The per-model source maps in the image/video options modules retain the rest of
the official endpoint evidence. Usage-account aggregation is not used as
per-member request settlement evidence.
