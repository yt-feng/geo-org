# tokvilo signup confirmation email

`POST https://tokvilo.com/api/auth/email-hook` implements the
[Supabase Send Email Hook](https://supabase.com/docs/guides/auth/auth-hooks/send-email-hook)
using the [Standard Webhooks signature contract](https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md).
It sends signup confirmation only. Recovery, invitation, magic-link and email-change
events return HTTP 422 explicitly; do not enable those product flows yet.

Before enabling the Supabase hook:

1. Apply `drizzle/0016_auth_email_hook.sql` to the existing D1 database.
2. Set Worker secrets `AUTH_EMAIL_HOOK_SECRET` to the generated Supabase hook
   secret (`v1,whsec_…`) and `AUTH_BASE_URL` to the exact configured HTTPS
   Supabase project origin. Keep the signing secret out of Git and logs.
3. Deploy the endpoint and the separate `AUTH_EMAIL` send binding. Its only
   allowed sender is `auth@tokvilo.com`; it uses the configured Cloudflare
   sending domain. The binding intentionally has no `remote: true`, so local
   development does not send real email.
4. In that Supabase project's Auth Hooks, create the HTTPS Send Email hook
   with this endpoint and the same secret. Enable the Email Provider and email
   confirmation. Allow redirect `https://tokvilo.com/login?verified=1`.

The request body is bounded to 64 KiB and one second of body reading. Verification
uses HMAC-SHA256 over the exact original `webhook-id.timestamp.body` bytes and
accepts timestamps only within five minutes. Web Crypto verifies the signature.
Recipient addresses come only from signed `user.email`; sender and subject are
fixed. Confirmation links use the configured project `/auth/v1/verify`, signed
`token_hash`, `type=signup`, and the fixed tokvilo login redirect. Payload
`site_url`, `redirect_to`, raw OTP and user metadata are ignored.

The email send has a maximum three-second wait and a deadline 4.5 seconds after
request handling begins. Supabase's HTTP hook limit is five seconds; unusually
slow database operations can still cause Supabase to time out. Only confirmed
Cloudflare acceptance followed by a saved receipt returns HTTP 200 `{}`.
Acceptance does not prove inbox delivery.

D1 stores only SHA256 request/delivery identifiers, request-body hash, state
and timestamps. It never stores recipient addresses, raw hook bodies, OTPs or
confirmation links. The same webhook ID cannot be reused with changed content.
Concurrent attempts and different webhook IDs for the same confirmation token
share one delivery owner. A successfully completed retry returns `{}` without
sending again.

An exception or ambiguous timeout is retained as `unknown`; an interrupted
owner may remain `sending`. Neither state automatically resends that token.
Inspect Cloudflare Email activity before any manual intervention. A fresh
Supabase confirmation token creates a separate delivery. Do not delete receipts
to force an uncertain send to repeat. Responses omit underlying provider
diagnostics, tokens and addresses.

Offline verification:

```sh
node --test tests/auth-email-hook.test.mjs
```

The tests use an in-memory SQLite database and a simulated email binding; they
make no network requests and send no real mail. Deployment and a dedicated QA
signup are separate acceptance steps.
