# Tokvilo product design review — 2026-10-23

## Customer journey and changes

| Finding | Delivered change | Acceptance evidence |
| --- | --- | --- |
| The home page used placeholder identity marks and a simulated dashboard; the first useful action was unclear. | Genuine local SVG logos, a focused model-discovery hero, model-family entry cards, and a three-step browse → compare → use journey. | Rendered homepage tests and production browser review. |
| Versions from the same manufacturer were scattered, with decorative images taking attention away from differences. | Manufacturer → family → version grouping, numeric generation ordering, compact side-by-side cards, distinct service identities and visible availability. | Identity and market tests retain every service:model pair and check generation/date ordering. |
| Several independent filters could produce confusing empty results. | Search-first layout; compact manufacturer and family selectors; advanced service/capability filters; category changes clear incompatible selections. Shareable URLs and browser Back/Forward restore filters. | Filter/state tests and production interaction checks. |
| A long pricing table made it difficult to compare versions. | Pricing uses the same family taxonomy, with key rates visible and complete tier/add-on rates expandable. Manufacturer and service filters are separate. | Pricing UI tests preserve every retail rate, billing unit, service route and unavailable state. |
| Digital subscriptions were listed without a clear plan hierarchy. | Group the existing eight goods into Plus, Pro 5x and Pro 20x, then compare fulfillment variants. Keep inquiry and 24-hour email response prominent. | Product inquiry and rendered UI tests. |
| Chinese-only interfaces interrupted the English customer journey. | English public routes at `/en`, `/en/models`, `/en/pricing`, `/en/products`; `lang=en` for account entry and signed-in customer pages. Language changes retain filters, model selection and recovery state. | Locale, authentication, recovery, rendering and console/workbench tests. |
| Public copy could expose the source service or imply that a listed price guarantees availability. | Tokvilo service names only; retain manufacturer names for model identity. Show retail prices and distinguish configured, pending and reference entries. | Existing branding, price-sanitization and adapter tests. |

## Product decisions

- Logos identify the original model/product, while tokvilo remains the service brand. Assets and licensing are documented in `model-logo-sources.md`.
- Version order is inferred from identifiers; it is not a release-date or performance ranking. Different capabilities (for example GPT Image and GPT text models) have separate families.
- Two tokvilo services offering the same model ID remain separate, with their original prices, availability and workbench URLs.
- Prices show their billing units and conditions. Tokens, images, seconds and requests are never compared as a single normalized amount.
- Digital goods continue to use an inquiry form, not an automatic fulfillment promise. The destination remains `yt.feng@foxmail.com`, with a 24-hour response statement.
- The homepage developer example reads the real public catalogue endpoint without credentials. Paid model endpoints stay in the authenticated documentation/workbench flow.

## Verification boundary

This iteration changes presentation, information architecture and language. Existing catalog synchronization, billing, payment and authentication safeguards remain in place. Automated tests exercise the request/quote/confirmation contracts. Browser checks cover rendering, navigation, filtering, language switching and responsive layouts without sending generation requests, inquiry emails, payments or credential changes.

The presence of a catalogue item is not evidence of a paid execution. Previously pending provider activation and real signup/recovery-email acceptance remain separate operational checks.

## Release acceptance

- Cloudflare worker `eco-geo-api` version `3236ded6-7954-49cf-9e68-bfed44498ace` is deployed at 100%; deployment history was read back after publishing.
- Production build, ESLint, TypeScript and all **457 tests** passed. No database migration was needed for this iteration.
- At `2026-10-23T06:22:17.239Z`, all 12 public/account-entry routes returned HTTP 200. All nine protected English routes redirected unauthenticated visitors to `/login?lang=en`. All 26 logo SVGs returned HTTP 200. The final locale and Playground bundles were fetched from production and matched the local build byte for byte.
- The live catalogue and pricing each contained **337 service entries**, including **296 gateway entries** whose IDs exactly matched the current public source after the four existing brand aliases. Existing studio and selected entries remain separate; counts are a point-in-time check, not execution acceptance.
- Chrome checks covered desktop and 390px mobile layouts, both themes, manufacturer/family filters, pricing details, product forms and the existing authenticated English dashboard, wallet, workbench and core docs. Browser access was disabled in Work settings before the final two small fixes (ready-model selection and login callback link cleanup) could be rechecked interactively; these passed regression tests and production asset verification.
- Screenshots and raw check logs are retained locally under `.artifacts/`. No paid request, payment, product inquiry, key creation or credential change was submitted in this design iteration.
