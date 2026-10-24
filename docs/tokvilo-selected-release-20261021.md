# tokvilo selected-service release — 2026-10-21

Production Worker version: `50fbe54e-9d75-4e27-b7d8-8aa413150c93`.

The RKAPI catalogue has been integrated under the customer-facing service name
**tokvilo 精选**, using the existing tokvilo account, wallet, API-key ownership,
usage logs and durable request receipts. No upstream account credential has been
created or configured for this release; generation remains disabled until those
credentials and actual paid acceptance are completed.

## Coverage and prices

- All 32 entries observed across the signed-in catalogue's four pages are present.
- 29 bounded, non-streaming text adapters and one `gpt-image-2` URL-result adapter
  are implemented. `gemini-3.1-flash-image` and `gpt-image-2.5` have directory and
  price entries but no generation adapter.
- Customer prices apply 1.20 to the actual cash basis after fixed-group and
  currency conversion. The source catalogue's dollar symbol is not treated as
  USD cash. Public pages and API projections contain final retail amounts only.
- The server-only snapshot was observed at `2026-10-21T13:57:52.000Z` and expires
  after seven days. Public status supplies the cash conversion, but the model
  rates are a dated snapshot, not an automatic live pricing feed.
- Existing APIMart coverage remains 295 directory entries and 251 adapters;
  44 entries still lack enabled execution. Adapter coverage does not establish
  successful paid generation for every model.

## Verification

The production build, TypeScript, ESLint and all **399 tests** passed. Tests cover
fixed groups and cross-group retry rejection, retail conversion and usage
dimensions, ownership, idempotency, pre-dispatch reservation failures, generated
output persistence before settlement, and receipt recovery. Image requests reject
base64 output before a reservation, keeping durable responses within D1 limits.

Migration `0019_rkapi_relay.sql` was applied to the production D1 database. The
client JavaScript contains no selected-service source prices, API credentials,
group attestations or upstream hostname.

Production readback at `2026-10-21T14:08:36Z` confirmed **336 service entries**:
295 gateway, nine multimodal references and 32 selected entries. All currently
published gateway IDs and all captured selected IDs are present in both the
directory and price API. Every selected entry correctly reports unavailable
while no route credentials are configured. Unauthenticated `/selected` redirects
to login; the existing signed-in account can open the workbench, read retail
prices, and see its empty owner-scoped request history.

Chrome verification confirmed the new 32-entry filter, tokvilo branding, the
selected workbench navigation and generation disabled until service activation.
Screenshots and raw acceptance logs are kept in the ignored `.artifacts` folder.

## Remaining acceptance

Five dedicated fixed-group keys and a total paid verification budget of at most
CNY 1 have been prepared for action-time user confirmation. Keys are to be
restricted to the 30 implemented models, with cross-group retries disabled, and
stored only as a Cloudflare Worker secret. Existing user keys are unchanged.

No live selected-service generation or provider debit has been claimed. The
protocol intentionally does not claim native Responses, Anthropic, Gemini or
streaming compatibility. Price refresh and operator procedures are in
`tokvilo-selected-operations.md`.

Authentication email configuration and delivery were separately verified in this
release round. The latest recovery email has a Cloudflare `Delivered` record and
successful Supabase token issuance; the user's mailbox, new-password submission,
subsequent login and a fresh signup still require end-to-end acceptance.
