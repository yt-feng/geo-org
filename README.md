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
- Wildcard `/api/v1/*` relay with server-side upstream credentials.
- Per-user and platform-wide daily limits, atomic D1 counters, and request IDs.
- Response-header allowlisting, same-domain URL rewriting, configurable marker
  replacement, and generic relay errors.
- Fail-closed activation: the relay is disabled until `SERVICE_ENABLED=true`.

## Free-tier guardrails

The checked-in defaults reserve headroom below the infrastructure analysis:

- 5,000 proxied requests per UTC day across the service.
- 100 requests per member per UTC day.
- 5 active API keys per member.
- A service-wide upstream spend guard reserves the current endpoint price in D1
  before forwarding and stops at the configured USD ceiling.
- Unknown or temporarily unavailable endpoint prices fail closed before any
  upstream request is sent.
- D1 stores compact aggregate and error metadata; request and response bodies
  are never persisted.
- R2 is not enabled.

The spend ceiling is cumulative and fail-closed. Endpoints whose future cost
cannot be bounded before forwarding are intentionally unavailable.

## Local setup

1. Copy `.dev.vars.example` to `.dev.vars` and add local configuration.
2. Generate or inspect migrations with `npm run db:generate`.
3. Start the development server with `npm run dev`.
4. Validate with `npm test`, `npm run lint`, and `npx tsc --noEmit`.

The production environment uses the same keys listed in `.env.example`.
Secrets belong in the hosting platform and must not be committed.

## APIMart configuration

Open `https://api.eco-geo.org/admin` with the existing administrator account.
Under **上游服务管理 → APIMart**, enter an API key and select **验证并保存**.
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
