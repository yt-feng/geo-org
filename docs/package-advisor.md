# Client package advisor

The unlisted Chinese page is `/package-advisor/`. It is excluded from homepage,
navigation and sitemap links. HTML metadata and Vercel response headers request
no indexing. Anyone with the direct URL can view it; it is not an authenticated
member page.

The three core inputs are the project CNY budget, business goal and current
stage. The budget control starts with three cooperation bands (focused project,
systematic build, or phased scale), followed by a band-specific slider and an
exact amount field. It accepts CNY 5,000–1,000,000. Optional notes are sent only after the visitor requests an AI suggestion.
The Worker calls DeepSeek and does not persist request/response contents. The
browser previews the public service catalogue locally. It does not call the AI
provider directly, contain credentials or receive any internal pricing model.

## Pricing and recommendation contract

`package-advisor/catalog.mjs` contains only approved customer-facing reference
prices, delivery units, scope and prerequisites. The private source workbook,
cost engine and delivery documents must never be published or given to the
model. Prices are versioned as public service prices, with no profitability or
staffing fields. Small budgets buy bounded alternative specialties; large
budgets show a first-phase allocation and a separately identified unallocated
amount for later scope confirmation. Customer amounts are CNY before tax. Third-party placements and
unscoped work are separately confirmed.

`planner.mjs` computes quantities and totals from the public catalogue. Budget is
a ceiling. DeepSeek may prioritize/exclude known modules and explain the fit;
it cannot set prices. Model output is schema-checked. If the provider times out,
returns invalid output or is unavailable, the response explicitly reports a
basic rules-based recommendation and that notes have not been incorporated.

## Deployment

The website remains deployed through GitHub main to the existing Vercel project.
Only files in this repository are deployment inputs; local `.artifacts`, private
source materials and `api_key` must remain outside published changes.

The independently deployed Cloudflare Worker is `eco-geo-advisor` at
`recommend.eco-geo.org`. Use the existing authenticated Wrangler installation:

```sh
wrangler deploy --config advisor-service/wrangler.jsonc
wrangler secret put DEEPSEEK_API_KEY --config advisor-service/wrangler.jsonc
node --test tests/test-advisor.mjs
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

The page only creates an on-screen proposal and a local download. It does not
send messages or inquiries automatically.
