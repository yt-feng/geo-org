# Website inquiry form

The public contact address is `info@eco-geo.com`. Contact pages at `/contact/`, `/en/contact/`, and `/ar/contact/` post to `https://forms.eco-geo.org/api/contact`.

The independently deployed `eco-geo-contact` Cloudflare Worker sends notifications to a fixed, privately configured owner inbox. It sets the visitor address as Reply-To. The API never accepts a client-specified recipient or sender. No inquiry database is used.

## Deployment

The site is deployed by Vercel from GitHub main. The Worker is deployed separately. Keep the live Wrangler configuration outside the public repository/static upload: its recipient restrictions contain the private inbox.

Required bindings/configuration: `EMAIL`, `CONTACT_RATE_LIMIT`, `CONTACT_NOTIFY_TO`, `CONTACT_FROM_EMAIL`. The production sender is `notifications@eco-geo.org`; allowed origins are `https://eco-geo.org` and `https://www.eco-geo.org`. The limiter allows three requests per minute per Cloudflare-observed IP. Request bodies are limited to 12,000 UTF-8 bytes. The form validates this before submission.

The public `.com` contact address is a site contact setting; changing this link does not provision a mailbox. Notification sending uses the configured `.org` sender.

## Verification on 2026-09-08

All three contact pages and homepage inquiry links were checked on the public site. A synthetic inquiry was submitted through the Chinese browser form at 02:04:46 UTC; the UI reported success and cleared the fields. Cloudflare `emailRoutingAdaptive` recorded `status=delivered` to the configured owner inbox. This binding reports the delivery in routing analytics, so the separate Email Sending activity log is not the delivery verification source for this notification.

Validation: 18 Worker tests and 7 form tests passed, including fixed-recipient enforcement, provider failure, input preservation, localization, byte limits, and rate limits.
