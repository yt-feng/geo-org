# Client package advisor

The unlisted Chinese page is `/package-advisor/`. It is excluded from homepage,
navigation and sitemap links. HTML metadata and Vercel response headers request
no indexing. Anyone with the direct URL can view it; it is not an authenticated
member page.

The customer journey is market → budget → business scope → editable proposal →
reviewed inquiry. Visitors can explore without leaving contact details. Definitions
and price explanations sit beside the relevant controls, with advanced preferences
and social listening collapsed until needed.

The budget control starts with three bands. The high band is logarithmic between
CNY 150,000 and a CNY 10,000,000 reference mark, followed by an explicit “discuss”
position. This is not a commercial ceiling. Exact safe-integer amounts above that
mark remain unchanged; an open budget is `budgetMode: "discuss", budget: null`.
A missing price or an open budget is never represented as a free service.

## Pricing and scope contract

Customer-only catalogues contain delivery units, reference prices, scope and
prerequisites. Private workbooks, cost engines, margins, staff costs and internal
case materials are not published or sent to the AI provider.

Chinese and overseas pricing are distinct. The confirmed Chinese standard unit
is CNY 50,000 per quarter: one product line, up to three scenarios and three
audience groups, with 30 deduplicated intent themes as the planning capacity.
An intent is an independent customer decision topic, not a paraphrased prompt,
an article, or an AI answer sample. Scenario and audience inputs apply uniformly
per product line; intent input is the total across the project.

Chinese scope units = product lines × ceil(scenarios / 3) × ceil(audiences / 3).
Intent units = ceil(total intent themes / 30). Charge for the larger unit count,
not the sum. This avoids counting the same coverage twice. The resulting unit
count describes the contracted scope; content volumes and observation rounds
are stated separately in the delivery schedule. Chinese optional services are
quoted separately and never reuse overseas prices.

Overseas modules retain their public unit prices. Large enterprise scopes and
additional product lines, scenarios, audiences or intent coverage require a
separate scope quotation, rather than automatically multiplying article counts.

Social listening is independent of AI answer sampling and one-off discussion
research. Its requested platforms, research depth, frequency, market count and
language count are recorded. Data availability, historical window, reporting,
alerts and response responsibilities are confirmed before a quotation. Its price
is unknown until scoped; it is not a low-price monitoring add-on.

`planner.mjs` is authoritative for prices and quantities. Every plan separates
priced `items` from unpriced `pendingItems`; `total` is only the priced subtotal.
Pending scope cannot be labelled fully within budget. Basic required services
stay locked; optional modules can be removed, restored or changed in quantity.
Explicit customer quantities and zero exclusions take precedence over AI choices.
Prerequisite services and material requirements remain visible after edits.

DeepSeek can propose priorities and exclusions from the current market's public
service whitelist. It cannot change prices, markets, scope or explicit customer
selections. Invalid provider output uses a labelled rules fallback. Optional notes
are sent only when the visitor requests AI analysis.

## Consultation handoff

The main consultation action carries a customer-safe summary into the existing
contact form using the same tab's session storage. The draft expires after 30
minutes and is consumed once. It is not sent to a server by the handoff action.
The customer reviews or edits the populated message and supplies contact details
before explicitly submitting the existing form. Existing message text is never
overwritten. Downloads include current quantities, deleted modules and pending
quotations. No credentials or private pricing fields are included.

## Deployment

The website remains deployed through GitHub main to the existing Vercel project.
Only files in this repository are deployment inputs; local `.artifacts`, private
source materials and `api_key` must remain outside published changes.

The independently deployed Cloudflare Worker is `eco-geo-advisor` at
`recommend.eco-geo.org`. Use the existing authenticated Wrangler installation:

```sh
wrangler deploy --config advisor-service/wrangler.jsonc
wrangler secret put DEEPSEEK_API_KEY --config advisor-service/wrangler.jsonc
node --test tests/test-advisor*.mjs
```

Required secret: `DEEPSEEK_API_KEY` (the credential dedicated to this project).
The configured model is `deepseek-flash`, with thinking disabled and bounded
JSON output. The runtime allows five calls per minute per observed visitor IP,
10 KB request bodies and 1,600-character notes. Only the two production site
origins may call the API from browsers. `/health` reports configuration
readiness, not proof of provider completion; a real recommendation with
`source: "deepseek"` is required for end-to-end verification.

## Value and procurement comparisons

The client page compares procurement models and its own included deliverables.
It does not juxtapose software/monthly supplier charges with our project totals.
The reuse example is derived from public catalog prices: one research article
and three channel adaptations. It is not presented as a discount or a claim
about competitors.

The following supplier references were checked during development on
2026-09-20, but are not price anchors on the client page:

- https://www.webfx.com/seo/services/ai-search-optimization/
- https://archonconsultancy.com/pricing
- https://modemarketing.co.uk/geo/
- https://otterly.ai/pricing

The page creates a proposal, local download and optional contact-form draft.
It does not send messages or inquiries automatically.
