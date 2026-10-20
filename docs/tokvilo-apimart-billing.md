# tokvilo APIMart relay and billing

The authenticated adapter exposes `GET /api/apimart/v1/models`, non-streaming
`POST /api/apimart/v1/chat/completions`, `POST /api/apimart/v1/images/generations`,
and owner-scoped `GET /api/apimart/v1/tasks[/{task_id}]`. All generation requests
require a stable `Idempotency-Key`. Member and administrator requests use the same
wallet billing path. The server retains the upstream credential.

The official APIMart pricing website's browser client calls
`https://apimart.ai/api/pricing/models/all`. This endpoint was fetched and its
actual JSON parsed on 2026-10-20. It reports `pricing.effective_rates` in
`usd_per_million_tokens` and image `fixed_prices` in `usd_per_image`. The current
adapter accepts a single standard text tier with input, output and optional
cached input rates, and fixed image prices with resolution/default dimensions.
Time pricing, multiple tiers, extra tools, material charges and unknown units
remain unavailable for paid requests. Neither cached prices nor reference
catalog entries are used when the current pricing fetch fails.

Displayed prices are upstream rates multiplied by 1.20. Wallet amounts are
integer micro-USD. Text totals use actual prompt/completion token counts and
cache details, with final rounding once. The pure-text request has a bounded
maximum output; the input hold uses a conservative UTF-8 byte bound plus message
overhead. A mismatching response model, inconsistent usage, missing usage or a
charge above the hold preserves the reservation for reconciliation.

Image requests reserve their selected quoted price. The asynchronous task's
documented `cost` field supplies the final USD upstream charge, multiplied by
1.20; failed/cancelled tasks refund their hold. Missing cost is never inferred
from credits or account balance changes. Task GET and the five-minute scheduled
reconciler settle idempotently, without generating anything new. The scheduled
worker atomically leases at most ten recorded tasks per run and stops automatic
querying after 288 attempts. Owners can still explicitly query their task.
Transport uncertainty preserves request identity and the hold.

Local validation covers owner isolation, real SQLite wallet transitions,
concurrent duplicates, API key authentication, secret redaction, failed tasks,
malformed output, unknown outcomes, and bounded scheduled reconciliation.
These tests do not claim a live paid model call.

Sources:

- [Official pricing](https://apimart.ai/pricing)
- [Models metadata](https://docs.apimart.ai/en/api-reference/texts/models/list)
- [Non-streaming chat contract](https://docs.apimart.ai/en/api-reference/texts/general/chat-completions-nostream)
- [GPT Image 2 generation](https://docs.apimart.ai/en/api-reference/images/gpt-image-2/generation)
- [Task result and cost](https://docs.apimart.ai/en/api-reference/tasks/status)
- [Usage query](https://docs.apimart.ai/en/api-reference/account/usage), which is
  aggregated by key/account and time, and is not used as per-member request evidence.
