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
