# Playground generation recovery — 2026-10-23

## Observed production cause

The reported example selected `gemini-3.8-flash` in the English text Playground. The test account initially had no wallet funds. Quote and generation rate-limit records existed, but there was no completed generation receipt or task.

The user then explicitly requested USD 10 of test credit. A single idempotent `test_credit` ledger entry granted 10,000,000 micro-USD. This is test credit, not a customer payment. A real, bounded request to the selected Gemini model returned HTTP 402 from the model service because that service account had insufficient funds. The 1,433 micro-USD reservation was refunded completely; charged amount was zero. Subsequent production readback confirmed the test wallet still held USD 10. Temporary verification API keys were revoked.

Successful paid generation is **not verified**. The service account must be funded before this model can generate. No additional paid requests were made after this confirmed failure.

## Changes

- Every catalogue card, model detail and price card has a Playground link, including models whose integration is pending. A common `/playground` route dispatches to the appropriate request builder without changing the selected model.
- Login returns to the precise service, model, category and language. The return target only permits the workspace and its public selection parameters.
- All three workbenches show available balance, configuration state and actionable messages beside the generation button. Quotes remain separate from paid confirmation; unavailable or unknown configuration blocks new generation.
- Configuration checks are read-only and explicitly describe configuration, not verified provider health or successful generation.
- Insufficient customer funds and insufficient model-service funds are distinct errors. Service-account failures do not expose internal balances, token identifiers or raw diagnostics, and confirmed refunds say no charge was made.
- Gateway and multimodal requests expose owner-scoped GET receipt recovery. Reading an existing result does not require new funds or another generation request. Gateway pending requests retain their original ID while querying.
- Gateway polling handles both nested and root-level task responses. Results, progress and errors remain visible; dedicated endpoint models cannot be accidentally dispatched as generic chat.
- Chinese and English copy, readable feedback styles and short-window layouts are included.

## Verification and deployment

- 509 tests passed; ESLint, TypeScript and production build passed.
- Cloudflare Worker version: `34c5b8ae-4e07-4a46-94d9-f60597040a72`, read back at 100% traffic.
- Six public Chinese/English pages returned HTTP 200. Eight deployed CSS/JavaScript assets matched local build bytes.
- The production login redirect retained the Gemini model, service, text category and English language. Anonymous status lookup returned the expected 401 code.
- A production GET of the earlier failed receipt returned `503/service_balance_unavailable`, `refunded`, charged amount zero, and no internal provider details. That check issued zero generation requests.
- Live catalogue and pricing both contained 337 entries. Playground link coverage is separate from execution readiness: the observed price response had 251 configured gateway billing adapters, 9 multimodal adapters and 0 activated selected routes.
- Browser visual acceptance remains unperformed because the supported browser tool still reports local browser access disabled. HTTP, asset, component interaction, route and production ledger checks are recorded separately.

Local evidence is kept in ignored `.artifacts/playground-*` files; private account receipts and temporary key material are not committed.
