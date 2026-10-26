# Model comparison and selection assistant — 2026-10-24

The bilingual storefront now offers `/compare`, `/en/compare`, `/advisor`, and
`/en/advisor`. Homepage, model cards, public navigation, the footer and a small
advisor launcher connect discovery, comparison, selection and Playground.

## Comparison and evidence

- Compare up to four exact model/service pairs across coding, math, writing,
  creativity, reasoning, speed, context, input capabilities and price.
- The current guidance dataset contains 40 exact model IDs across nine model
  families. Four benchmark records retain their original test conditions.
  Vendor descriptions, editorial suggestions and unverified dimensions are
  separate; there is no invented IQ score or cross-benchmark ranking.
- Official pricing contains 70 canonical models plus ten explicit aliases from
  nine manufacturers, checked on 2026-10-24. See `official-pricing.md` and
  `model-guidance-maintenance.md` for sources and maintenance rules.
- Compare manufacturer prices with public tokvilo retail rates, never supplier
  costs. Preserve currency, context thresholds, time windows and cache terms.
  Unknown versions and incompatible conditions do not receive savings claims.
- Keep the existing retail pricing policy. At this release, Gemini 3.8 Flash and
  Claude Sonnet 5.5 standard input/output rates save 4%. GPT-6.1 Sol long-context
  output is 12% above the verified official rate. A blanket claim that tokvilo is
  many times cheaper is therefore unsupported and is not displayed.

## Questionnaire and AI follow-up

The public four-question form filters currently configured text-chat routes and
returns three candidates with reasons, trade-offs, matching-tier retail prices
and exact Playground links. Short examples use 2K input + 1K output tokens;
long-document filtering uses 128K input + 1K output. Image input is explicitly
unavailable in this assistant until the platform route is confirmed to support it.

Signed-in users can add follow-up requirements. A real, inexpensive model extracts
four validated preferences from the conversation; server-side rules then produce
recommendations from the verified dataset. AI cannot invent prices, model IDs,
benchmark scores or factual recommendation prose. Unavailable AI calls are labeled
as questionnaire guidance, without pretending that a model response succeeded.

The engine is selected from freshly authenticated live inventory with comparable
plain input/output rates. The 2026-10-24 live check selected `qwen3.7-flash`.
This means cheapest eligible engine on the defined short-request basis, not a
claim to have found the cheapest model on the entire internet. No automatic
upgrade to a more expensive engine occurs.

Calls do not touch the customer's wallet. A separate D1 allowance enforces 20
requests/account/UTC day, three/minute, 2,000 globally/day, a conservative $0.50
global daily allowance and $0.005 maximum per request. Output is capped at 384
tokens. Account-bound request IDs prevent re-executing an ambiguous request.
Stored records contain a request hash and trusted result, not raw prompts or
conversation history. Credentials stay in existing encrypted runtime bindings.

## Verification

- Production build, TypeScript and scoped ESLint passed; 651 tests passed.
- Cloudflare Worker release: `90bce932-f698-4655-b8b0-be1591fe5b2b`.
- D1 migration `0022_model_advisor.sql` was applied remotely. No other migrations
  were pending.
- The four new routes returned HTTP 200 with matching language/canonical metadata;
  the 28-URL sitemap includes all four. Same-origin anonymous chat returned 401,
  while a foreign-origin request returned 403.
- Chrome completed the questionnaire, displayed three candidates and opened a
  recommended Gemini model in the English Playground with the exact service,
  model and category. This check did not submit a paid Playground generation.
- Two actual AI requests succeeded at 08:10:24 and 08:10:49 UTC. The first selected
  coding/economy/short/text. A follow-up changed the result to math/quality/long/text.
  D1 readback confirmed both as `ai`, using `qwen3.7-flash`, with three candidates.
  Reservations of 102 and 113 micro-USD are operating allowances, not measured
  charges or customer wallet debits.
- Chinese and English comparison pages displayed the verified 4% Gemini savings,
  source links and the higher long-context output rate where applicable. Switching
  languages preserved the selected model/service pair.
- Login return-path tests preserve `/advisor` and `/en/advisor` while rejecting
  external destinations and discarding unrelated query strings/fragments.

This validates the selection assistant and its navigation. It does not establish
successful generation for every catalog model, measured model latency, or a new
payment settlement. Missing exact-version evidence remains visibly unverified.
