# Eco Geo API Gateway

Authenticated member portal and API relay for Eco Geo. The application is a
Cloudflare-native vinext Worker with D1 persistence.

## Included

- Public login and registration pages backed by a managed auth provider.
- HttpOnly session cookies and server-side session verification.
- Private dashboard, API key management, usage summary, and searchable OpenAPI
  reference.
- Administrator dashboard protected by a host-configured account; an optional
  email allowlist can also grant administrator access to managed-auth users.
- APIMart settings in the same administrator dashboard as the existing data
  upstream: validate and save an API key, test its quota, and browse its available
  models. Credentials are encrypted in D1 and never returned to the browser.
- TokenHub settings and an administrator-only generation relay: authenticated
  model discovery, non-streaming chat, image generation, and video task creation,
  polling, cancellation, and history. The upstream key stays on the server.
- Wildcard `/api/v1/*` relay with server-side upstream credentials.
- Per-user and platform-wide daily limits, atomic D1 counters, and request IDs.
- Response-header allowlisting, same-domain URL rewriting, configurable marker
  replacement, and generic relay errors.
- Fail-closed activation: the relay is disabled until `SERVICE_ENABLED=true`.

## Interface

The gateway uses a shared monochrome ECO-GEO design inspired by APIMart, with
local Geist fonts, light/dark themes, responsive navigation and model artwork.

- `/` — public product page, capability cards, integration guide and FAQ.
- `/models` — curated public capability catalogue with category/provider search,
  grid/list views and model details. This is not a live availability or price list.
- `/dashboard` — real account quota, aggregate metrics and a 30-day usage trend.
- `/dashboard/keys` — all active keys and the 20 most recently revoked keys.
- `/dashboard/usage` — per-user request totals and searchable exception records.
- `/dashboard/docs` — authenticated API reference.
- `/admin` — APIMart/TikHub/TokenHub configuration, platform usage and members.
- `/playground` — authenticated APIMart parameters and local JSON/cURL request
  previews; it does not submit generation requests.
- `/tokenhub` — administrator workbench for TokenHub chat, images, and video
  tasks. Submitting a model request can consume TokenHub credit.

Model artwork source references are in `public/model-art/SOURCES.md` and the
font license is in `public/fonts/OFL.txt`. Existing account data, credentials,
quota checks and data-relay behavior remain connected to the same D1 database.

## Free-tier guardrails

The checked-in defaults reserve headroom below the infrastructure analysis:

- 5,000 proxied requests per UTC day across the service.
- 100 requests per member per UTC day.
- 5 active API keys per member.
- A service-wide upstream spend guard reserves the current endpoint price in D1
  before forwarding and stops at the configured USD ceiling.
- Unknown or temporarily unavailable endpoint prices fail closed before any
  upstream request is sent.
- The data relay stores compact aggregate and error metadata without request or
  response bodies. TokenHub additionally stores video task ownership and the
  creation response used to prevent duplicate video submissions. The submitted
  TokenHub request body itself is not persisted.
- R2 is not enabled.

The data-relay spend ceiling is cumulative and fail-closed. Its endpoints whose
future cost cannot be bounded before forwarding remain unavailable. TokenHub
uses its own upstream key budget and administrator access restriction, as
described below; the data-relay price table does not price TokenHub generation.

## Local setup

1. Copy `.dev.vars.example` to `.dev.vars` and add local configuration.
2. Generate or inspect migrations with `npm run db:generate`.
3. Start the development server with `npm run dev`.
4. Validate with `npm test`, `npm run lint`, and `npx tsc --noEmit`.

The production environment uses the same keys listed in `.env.example`.
Secrets belong in the hosting platform and must not be committed.

## APIMart configuration

Open `https://api.eco-geo.org/admin` with the existing administrator account.
Under **服务连接 → APIMart**, enter an API key and select **验证并保存**.
The server validates it using APIMart's read-only `GET /v1/balance` endpoint
before replacing the saved key. A failed validation leaves the previous
configuration intact. The input is cleared on success and only the last four
characters are displayed thereafter. An empty input never removes a key.

**测试已保存连接** reads the key's remaining quota (not the account balance),
and **读取模型目录** reads `GET /v1/models?expand=category`. These checks do not
submit inference or generation requests. Model visibility follows the key's
permissions. Quota units are those returned by APIMart and are not assumed to be
USD. This release provides configuration and discovery; APIMart inference
relaying, generation tools, billing and task history are not implemented yet.

## TokenHub configuration and generation

In `/admin`, save a TokenHub API key under **服务连接 → TokenHub**. The server
validates the explicitly supplied Bearer key with `GET /api/v1/models` before
replacing the saved key. Anonymous access to that upstream endpoint is public,
so omitting the Authorization header would not validate a credential. Test and
model-discovery actions do not submit generation requests. The returned model
count is the current key's catalogue, not an account balance or a promise that
every publicly advertised model is enabled. During verification, the model API
listed four chat models while the signed-in marketplace displayed nine models;
the workbench includes the separately verified marketplace media presets.

Saved TokenHub keys are encrypted in D1 with an independent encryption context.
`TOKENHUB_API_KEY` is the optional hosting-secret fallback when no key has been
saved. A corrupt saved key fails closed rather than silently switching keys.
Only a masked suffix is returned to the configuration UI. The production
integration key was created with a USD 20 spending limit in TokenHub; that
provider-side setting is separate from this application's request limits and
must be preserved when replacing the key. Model-specific prices and remaining
credit are not inferred from the model list.

The following routes accept an administrator's signed-in session or an
ECO-GEO API key owned by an active administrator. Ordinary member keys cannot
use these generation routes. Browser mutations require a same-origin request.

| ECO-GEO route | Methods | Behavior |
| --- | --- | --- |
| `/api/tokenhub/v1/models` | GET | Read the authenticated upstream model list |
| `/api/tokenhub/v1/chat/completions` | POST | Non-streaming OpenAI-compatible chat |
| `/api/tokenhub/v3/images/generations` | POST | Image generation |
| `/api/tokenhub/v3/contents/generations/tasks` | POST | Submit a video task |
| `/api/tokenhub/v3/contents/generations/tasks` | GET | List this ECO-GEO user's latest 50 recorded video tasks |
| `/api/tokenhub/v3/contents/generations/tasks/{id}` | GET, DELETE | Query or cancel/delete an owned video task |

Only these operations are forwarded to the fixed TokenHub origin. Responses,
embeddings, streaming chat, asset-library management, and arbitrary upstream
paths are not exposed by this relay. `SERVICE_ENABLED=true` is required.
Requests are capped at 1,000,000 bytes and upstream JSON responses at 8,000,000
bytes; the browser workbench currently caps its request at 60,000 bytes. Use
public media URLs for larger inputs. Each administrator is limited
to five mutations and 60 reads per minute. Generation POST results contribute
to the existing usage summary, while video task state is tracked separately.

Video submission requires an `Idempotency-Key` header containing 8–128 ASCII
letters, digits, underscores, or hyphens. Reusing it with the same request
returns the stored creation result. Reusing it with another request is rejected.
If the upstream outcome is unknown, the reservation remains in place: inspect
the task records or upstream request log rather than retrying with a new key.
Task reads and deletion are restricted to the originating ECO-GEO user.

```sh
curl https://api.eco-geo.org/api/tokenhub/v3/contents/generations/tasks \
  -H 'Authorization: Bearer YOUR_ECO_GEO_KEY' \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: video-project-001' \
  -d '{"model":"MODEL_ID_FROM_TOKENHUB","content":[{"type":"text","text":"A calm coastline at sunrise"}],"duration":5,"ratio":"16:9","resolution":"720p"}'
```

Use the exact model ID exposed by TokenHub; the verified Seedance 2.0
marketplace example uses `dreamina-seedance-2-0-260128`. The `doubao` and
`dreamina` names are not assumed to be interchangeable. Successful video output links are
documented to expire after 24 hours. Cancelling a queued task and deleting a
completed task record are different upstream operations; running tasks cannot
be cancelled through the documented DELETE operation. Official source links,
parameter constraints, and the current `/v3` versus older documentation `/v2`
discrepancy are recorded in [the integration contract](docs/tokenhub-integration.md).
The existing `/api/v1/*` data relay continues to use its own upstream settings.

An optional host-side `APIMART_API_KEY` is used only when no admin-saved key
exists. Saved keys use AES-256-GCM with a purpose-specific key derived from
`ADMIN_SESSION_SECRET`. Preserve that secret across deployments; changing it
requires re-entering the saved APIMart credential. Credentials, prompts and
model outputs are not stored in request logs by this feature.

Deploy this gateway from the `api-gateway-cloudflare` branch, independently of
the main marketing website. Apply the additive migration before publishing:

```sh
npm ci
npx wrangler d1 migrations apply eco-geo-api --remote
npm run build
npx wrangler deploy --keep-vars
```

The migration adds only `provider_settings`; existing members, API keys,
quotas and data-provider configuration are preserved.

## Production configuration

- Configure the managed auth project and verified redirect URL.
- Set the administrator credentials and session-signing secret in the host.
- Add the upstream base URL, documentation URL, token, path rewrites, and all
  identity markers as host-side secrets.
- Bind the intended custom hostname.
- Set the spend ceiling and daily request limits before enabling the relay.

## Commands

- `npm run dev` — local development server
- `npm run build` — Cloudflare-compatible production build
- `npm test` — build and verify privacy/guardrail assertions
- `npm run lint` — ESLint checks
- `npm run db:generate` — generate D1 migrations
