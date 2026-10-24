# tokvilo authentication email

`POST https://tokvilo.com/api/auth/email-hook` implements the
[Supabase Send Email Hook](https://supabase.com/docs/guides/auth/auth-hooks/send-email-hook)
using the [Standard Webhooks signature contract](https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md).
It sends signup confirmation and password recovery. Invitation, magic-link and
email-change events return HTTP 422 explicitly; those product flows are not enabled.

The HTTPS Send Email hook is enabled on the current production Supabase project.
The deployed structured-send implementation has produced a new recovery-email
`sent` receipt in D1. This confirms Cloudflare accepted that send and the Worker
saved its receipt. Actual mailbox arrival and the password-reset/login round trip
still require user verification; the earlier `unknown` receipt remains unchanged.

Deployment configuration:

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
   confirmation. The required redirect allowlist contains both
   `https://tokvilo.com/login?verified=1` and
   `https://tokvilo.com/reset-password`.

The request body is bounded to 64 KiB and one second of body reading. Verification
uses HMAC-SHA256 over the exact original `webhook-id.timestamp.body` bytes and
accepts timestamps only within five minutes. Web Crypto verifies the signature.
Recipient addresses come only from signed `user.email`; sender and subject are
fixed. Confirmation links use the configured project `/auth/v1/verify`, signed
`token_hash`, `type=signup`, and the fixed tokvilo login redirect. Payload
`site_url`, `redirect_to`, raw OTP and user metadata are ignored.

Recovery messages instead link to the fixed `https://tokvilo.com/reset-password`
page with the signed `token_hash` and `type=recovery` in its URL fragment, which is
not transmitted in the HTTP request. A page GET does not consume
the credential. The user explicitly continues to exchange the hash for a short-lived,
single-use HttpOnly recovery grant, then submits a new password. Ordinary login
cookies cannot authorize password recovery. Recovery and signup have separate
delivery identifiers even when their token hashes match.

The Worker uses Cloudflare's recommended
[structured email builder](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/):
`send({ to, from: { email: "auth@tokvilo.com", name: "tokvilo" }, subject, text })`.
Cloudflare builds the MIME message and message headers; the Worker no longer
constructs a raw `EmailMessage`, MIME encoding, or custom `Message-ID`.
A successful call must return a nonempty `messageId` before D1 can record `sent`.
The provider message ID is not included in the webhook response or diagnostics.

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

Failed sends emit the `auth_email_delivery_failed` log event with only:

- `code`: an allowlisted Cloudflare error code, an internal enum
  (`SEND_TIMEOUT`, `HOOK_DEADLINE`, `INVALID_SEND_RESULT`,
  `RECEIPT_UNAVAILABLE`), or `UNCLASSIFIED`.
- `stage`: `send`, `send_result`, or `receipt`, distinguishing the sending call,
  validation of its result, and the D1 success-receipt write.
- `timedOut` and `elapsedMs`: whether the configured deadline was reached and
  elapsed time since request handling began.

Diagnostics never contain error messages/stacks, addresses, OTPs, token hashes,
payloads, or provider message IDs. Missing `messageId`, sending exceptions, and
success-receipt write failures all retain an unconfirmed outcome without resend.
An eventual send completion after the three-second timeout does not automatically
change `unknown` or trigger another email. The structured API removes manual MIME
construction; it does not itself guarantee latency or inbox delivery.

Offline verification:

```sh
node --test tests/auth-email-hook.test.mjs
```

The tests use an in-memory SQLite database and a simulated email binding; they
make no network requests and send no real mail. They cover structured signup and
recovery payloads, signature verification, concurrent/replayed events, missing
send results, private-error redaction, receipt failure, and late send completion.
These checks and production provider acceptance are separate from an actual
mailbox confirmation and password-reset/login round trip.
