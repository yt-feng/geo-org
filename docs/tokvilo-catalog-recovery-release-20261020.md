# tokvilo catalogue and account recovery

## Catalogue coverage

The old storefront was a hand-written list of 16 gateway models plus nine studio
references. It was not a complete gateway inventory.

The public pricing catalogue rechecked on 2026-10-20 at 12:11 UTC contains 295
distinct gateway identifiers: 49 image, 54 video, two music, and 190 entries under
its `llm` category. Two image entries (`flux-3-image-klein` and
`hy-image-v3.5-preview`) were added after the 293-model test fixture was captured.
The complete public metadata snapshot is in `lib/model-directory-snapshot.json`;
no prices, source URLs, discounts, or account credentials are bundled with it.
Seven transcription/realtime models are displayed under audio, leaving 183 text
and nine audio entries in the gateway storefront. All 295 identifiers remain.
The nine studio reference entries are additional.

The production directory and price API were compared with a fresh source response:
all 295 gateway identifiers were present, all had retail prices, and 248 had
implemented request and billing adapters at that initial readback. The two new
image models were then checked against their official generation/task contracts
and adapted separately, bringing implemented adapter coverage to 250. A newly
listed price alone does not enable a model for execution.

Coverage evidence: the official structured inventory at
`https://apimart.ai/api/pricing/models/all`, also used by its pricing page.
The raw response is retained only under ignored local `.artifacts/`.

`/models` and `/api/model-catalog` refresh the whole inventory from the structured
catalogue. Unsupported billing does not remove a model from discovery. When the
catalogue is unavailable, the page explicitly identifies the dated complete
snapshot. A catalogue entry, a configured billing adapter, and a successful paid
call are separate acceptance facts.

Manufacturer options are scoped to the selected model category and service.
Switching category or service clears incompatible manufacturer/capability
selections. This fixes the previous image/ZHIPU combination caused by retaining
filters across categories. Four documented identifiers with an intermediary
suffix have explicit public tokvilo aliases; unknown identifiers are not rewritten.

## Retail-only public data

The storefront, model prices, quotes, wallet copy, and service billing receipts
show final customer amounts. Source prices and markup metadata remain confined
to server-side settlement records and operator audit material.

`lib/public-products.ts` is a separate client-safe catalogue. Tests compare its
eight final prices with the internal products and prohibit client imports from
the internal product module. Price APIs use field allowlists. Response
sanitization removes service cost metadata while preserving generated content.

## Non-chat coverage

The 16 specialised identifiers below remain in discovery with their final retail
prices. Their paid adapters are not activated by the existence of token prices.
This review used the official documentation index, model pricing catalogue, and
targeted official-site searches on 2026-10-20; it made no generation requests.

| Kind | Catalogue identifiers | Official interface evidence and remaining contract |
| --- | --- | --- |
| Embedding | `text-embedding-3-large`, `text-embedding-3-small`, `text-embedding-ada-002` | Token prices exist, but no provider-specific embedding endpoint, request schema, or usage response was found. An OpenAI-compatible marketing description is insufficient to infer the route. |
| Moderation | `omni-moderation-latest` | [Official moderation documentation](https://docs.apimart.ai/en/api-reference/moderations/omni-moderation-latest/generation) confirms `POST /v1/moderations`, `model`, text/text-array/content-block `input`, and `stream: false`. The page supplies no response, usage, or per-request cost contract, so exact settlement is not established. |
| Moderation | `text-moderation-latest`, `text-moderation-stable` | The catalogue lists token prices, but the official moderation page explicitly lists only `omni-moderation-latest`. Support for these older identifiers and their usage response is unconfirmed. |
| Legacy completion | `babbage-002`, `davinci-002`, `gpt-3.5-turbo-instruct` | Input/output prices exist. No provider-specific legacy completion route or `prompt`/usage contract was found; the general chat-completions documentation does not establish it. |
| Transcription | `gpt-4o-mini-transcribe`, `gpt-4o-transcribe` | [Official audio documentation](https://docs.apimart.ai/en/api-reference/audios/whisper-1) confirms multipart `POST /v1/audio/transcriptions` for `whisper-1`, not these two identifiers. It also lacks their token usage response. A comparison blog's mention of OpenAI transcription models is not evidence of gateway support. |
| Realtime | `gpt-4o-mini-realtime-preview`, `gpt-4o-mini-realtime-preview-2024-12-17`, `gpt-4o-realtime-preview`, `gpt-4o-realtime-preview-2024-10-01`, `gpt-4o-realtime-preview-2024-12-17` | No provider-specific WebSocket/WebRTC/session or usage contract was found. The two generic token rates in the catalogue do not establish audio/cache billing dimensions or bounded session settlement. |

The smallest next integration is `omni-moderation-latest` once a documented,
request-bound usage or cost response is available. The other routes need their
provider-specific request and accounting contracts before paid execution.

## Email recovery

The login page links to `/forgot-password`. Requests accept an email address and
return a generic receipt to avoid revealing account existence. Origin checks,
request limits, and per-email limits apply.

Signed recovery emails link to `/reset-password` with a one-time hash in the URL
fragment. The page clears the URL and waits for an explicit click before
exchanging that hash. A successful provider verification creates a separate,
HttpOnly, ten-minute recovery cookie. The database stores only its hash and an
encrypted recovery access token.

Password changes require this recovery grant; ordinary login cookies do not
authorize recovery. A grant is claimed atomically before the provider request.
Successful changes clear the local session, invalidate other ready grants, and
request revocation of the provider's refresh sessions. Uncertain updates are not
automatically repeated. Existing access JWTs can remain valid until expiry.

Migration `0017_password_recovery.sql` was applied to production on 2026-10-20.
The 34 combined recovery UI, backend, signed-email, confirmation callback, and
session refresh isolation tests passed locally.
They do not prove production email delivery.

## Production readback

Cloudflare Worker version `9fa13c56-bae1-4ea7-a6a5-27a988ff089d` was deployed on
2026-10-20. The independent readback at 12:18:56 UTC confirmed:

- All 295 current gateway IDs were present in both the live directory and public
  price API, alongside nine existing studio references.
- The gateway had 49 image, 54 video, 183 text and nine audio catalogue entries;
  250 had implemented request and billing adapters, while 45 remained disabled.
- No catalogue price was unavailable. Public responses and visible storefront
  text contained no source prices or markup metadata. Customer copy used tokvilo.
- Home, products, models, pricing, login and both recovery pages returned 200.
  Login linked to the recovery page. Invalid recovery requests and unsigned mail
  hooks were rejected as expected.

The production build, TypeScript and ESLint checks passed, as did all 363 local
tests. All 29 browser JavaScript chunks were checked for internal price fields,
with no matches. Chrome was unavailable for visual acceptance. No paid model
generation or real signup/recovery email round trip was performed in this round.

## Remaining external acceptance

The Supabase Send Email hook must be enabled for the deployed
`https://tokvilo.com/api/auth/email-hook` endpoint. Its secret is already stored
privately and configured on the Worker. Browser access is currently disabled in
Work settings, and no configured Supabase Management API credential was found.
No real signup, mailbox confirmation, or password-reset round trip is claimed
from offline tests or from an HTTP-200 provider settings check.
