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
are stated separately in the delivery schedule. Chinese optional services use an
independent, numeric reference fee table (`CN_REFERENCE_PRICES`), rather than
inheriting the overseas tariff. The confirmed base remains CNY 50,000 per unit.

Website foundation is a required customer choice in the page. The visitor can
choose an existing-site optimization profile (high, medium or low completion)
or a GEO-ready rebuild. Each profile has a customer-facing package price and a
crossed standalone reference price; the rebuild profile uses CNY 100,000 as its
standalone reference and CNY 78,000 in the wider GEO package. The proposal
breaks the website line into build or structural work, framework and knowledge
architecture, SEO, GEO pages and FAQ, plus first-period maintenance and scheduled
updates. Hosting, themes, plugins, paid media and other third-party purchases
remain separate. These are preliminary sales references, not internal cost or
margin fields.

Overseas enterprise and expanded scopes use the same coverage axes to plan a
quarter's work. Each coverage unit requests W04 × 1, W05 × 1 and W22 × 3, worth
CNY 30,000 at the English reference tariff. Existing quantities of each component
are subtracted before the remaining work is listed as `OVERSEAS_SCOPE`; components
explicitly set to zero are not re-added. A fully covered scope has no extra row.
Content, channels and AI sampling retain their own stated quantities. A large or
open budget never automatically multiplies those deliverables.

Social listening has a numeric quarterly preliminary fee:

```
ceil_to_100(platform_count × depth_base × cadence_factor
            × (1 + 0.35 × (markets - 1) + 0.20 × (languages - 1)))
```

Depth bases are CNY 15,000 / 45,000 / 120,000 for mentions / insights / strategy;
cadence factors are 1 / 2 / 4 / 8 for monthly / weekly / daily / realtime.
An unspecified platform list provisionally means one platform. Historical window,
data access, reporting and alert-response arrangements are confirmed in the
formal scope. External data acquisition is separate from the service fee.

`pricing.mjs` is authoritative for service estimates; `planner.mjs` chooses
quantities using those estimates. Configured plans have numeric `items`, empty
`pendingItems`, `pricingStatus: "estimate"`, `estimated: true` and
`quoteRequired: false`. `total` is the full preliminary service fee across selected
languages. Amount budgets compare that total directly; discuss budgets retain
null `withinBudget` and `remainingBudget` while still displaying a service estimate.
An empty configuration retains `configurationRequired`, requires service selection
and has no budget comparison. Every proposal states “初步报价，实际以正式报价单为准。”

Original required minimums remain locked; optional modules can be removed,
restored or changed in quantity. Explicit customer quantities and zero exclusions
take precedence over AI choices. Repeated customization is idempotent and
prerequisite services and material requirements remain visible.

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
overwritten. The PDF is generated locally from the current proposal snapshot and
includes selected quantities, scope, service-language detail and the preliminary
quote notice. No credentials or private pricing fields are included.

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
The price composition is derived from the currently selected priced items, not
a fixed example amount. English W10 is CNY 1,500 per article; quantity one means
one adaptation and agreed upload, not a three-article bundle. It is not presented as a discount or a claim
about competitors.

The following supplier references were checked during development on
2026-09-20, but are not price anchors on the client page:

- https://www.webfx.com/seo/services/ai-search-optimization/
- https://archonconsultancy.com/pricing
- https://modemarketing.co.uk/geo/
- https://otterly.ai/pricing

The page creates a proposal, local download and optional contact-form draft.
It does not send messages or inquiries automatically.

## Service languages and channel adaptation

`languages` is a canonical nonempty array. Overseas values are `en`, `ar`, `fr`,
`de`, `es`, `pt`, `ru`, `ja`, `ko`, and `other`; omitted values default to `en`.
Chinese plans accept only `zh` and default to it. Unknown codes, null values and
cross-market codes are rejected. The choice goes to the provider and consultation
summary, but the provider cannot change it. The numeric language count inside
`listening` remains a separate research-scope input.

English-only plans use English public module prices. W10 is explicitly CNY 1,500
per adapted article with agreed own-channel upload. A planner recipe that formerly
selected one three-article bundle now requests three articles and reserves CNY
4,500. Reusing the mother article does not create three new originals, and paid
media procurement is separate. Manual W10 quantities now always mean articles.

All selected languages now receive numeric preliminary service prices. Public
language factors are English 1.0; Arabic, Japanese and Korean 1.5; French, German,
Spanish and Portuguese 1.3; Russian 1.4; and other languages 1.6. Primary-language
selection is deterministic in the published language order, with English first
when present. Content and channel execution use the primary-language factor,
then 50% of each additional language's reference fee for localization and review.
W10 is an exception: each language requires the full channel-execution fee of
CNY 1,500 × its language factor, including additional languages.
Each pricing component is rounded to whole CNY before quantities are applied.
AI sampling instead charges the complete protocol for each language; its
`sampling.plannedAnswersPerLanguage`, `languageCount`, `languages` and
`plannedAnswersTotal` make the complete observation count explicit.

Shared research, facts, scope planning and technical work are billed once. The
shared service IDs are W01, W03, W04, W05, W06, W19, W21, W22, W23, W24, W27,
W28, W29, W30, W31 and PITCH_SETUP. Different language versions of an existing
asset are not counted as additional original assets. Paid media remains separate.

Every row contains public `pricingDetails` with language, label, unitPrice,
quantity and amount. `estimateServiceUnitPrice(id, input)` gives a numeric unit
estimate for optional-service controls; `estimateServicePricing(id, input,
quantity)` also returns those details. These functions use only canonical scope
and catalogues; clients and AI cannot submit custom prices or factors.

The former W20 universal language fee stays hidden from new purchase options.
Existing W20 and CN_W20 inputs are accepted as legacy aliases and absorbed into
the canonical language selection; they add no second line or fee. A language
alias without any selected service does not create a quoted service.
