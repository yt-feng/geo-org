# SEO / GEO and private analytics operations

## What changed

The production build (`python scripts/build_site.py`) reads the existing editorial sources and produces `_site/`. Both Vercel and GitHub Pages publish only this directory. Python scripts, tests, worker sources, internal research diagnostics and this runbook are not website assets. No article body is rewritten or invented by this build.

The pass normalizes canonical links, fixes duplicate metadata titles, provides reciprocal language alternatives only for existing pages, regenerates XML sitemap and curated `llms.txt`, adds Article/WebPage/Breadcrumb/CollectionPage data, statically renders blog listings and pagination, preserves visible citations, adds article summaries/TOCs/related articles/topic links, and optimizes image loading. It neither invents review dates nor promises search rankings or AI citations. Check `site-build-report.json` in the workflow audit artifact for current counts.

## Hidden entrance

Tap the small dot in the footer five times (no gap longer than two seconds), or use Alt+Shift+A. This opens `/observatory/`. The route is noindex and absent from sitemap and normal navigation. This is a convenience shortcut, NOT the security boundary. Statistics require server authorization even when an attacker knows the route.

The owner-selected credential must be supplied as the `ANALYTICS_PIN` secret. There is no default or embedded credential. Short numeric credentials remain weak despite rate limits; prefer a longer secret for long-term use and do not send it in URLs.

## Backend activation

The existing public website is static. A new, isolated Cloudflare Worker `eco-geo-analytics`, D1 database `eco-geo-analytics`, and custom domain `metrics.eco-geo.org` provide server-side storage and authentication. Existing recommendation, contact and checkout workers are untouched.

Configure these repository Actions secrets before running **Deploy Private Analytics**:

| Secret | Purpose |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Scoped to the existing Cloudflare account/domain, with permission to manage this Worker, its custom-domain route and D1 database. |
| `ANALYTICS_PIN` | The owner-selected login credential; set its value privately. |
| `ANALYTICS_SECRET` | A random secret of at least 32 characters for HMAC authentication and rate-limit hashing. Generate with `openssl rand -hex 32`. Keep it stable across deployments. |

Account ID is read from `analytics-service/wrangler.jsonc`. The script can accept a `CLOUDFLARE_ACCOUNT_ID` environment override; the workflow currently uses the checked-in account ID. Confirm the account owns `eco-geo.org`.

Run the workflow manually after configuring secrets. `deploy.mjs` looks up or creates only the named analytics database, applies idempotent schema statements, deploys the Worker, sends secrets via stdin, and verifies `/health`. Missing secrets fail explicitly. DNS propagation or denied API permission can still prevent activation; a successful static deployment is not proof of analytics activation. Do not paste tokens into issues, commits or public workflow logs.

Acceptance after activation: health returns `ok:true`; a logged-out summary request with the site's Origin returns 401; a wrong PIN returns 401; the correct secret returns an opaque HttpOnly cookie; opt-in navigation writes records; authenticated summary shows those records; logout revokes the session. Historical visits are not reconstructed.

## Event dictionary

Every event has a random event UUID, a per-tab session UUID, canonical path without query/fragment, source category, referring hostname, page language, viewport device bucket, stable component ID and a bounded numeric value. The collector rejects extra fields and oversized batches. It never needs form contents.

| Events | Interpretation |
| --- | --- |
| `page_view`, `section_view` | Page load and first exposure of instrumented sections. |
| `nav_click`, `link_click`, `button_click`, `language_switch` | Navigation and interaction IDs, not entered values. |
| `consult_click`, `contact_click` | Consultation CTA / email / phone click; not a confirmed lead. |
| `outbound_click`, `download_click` | Outbound hostname / download link click. |
| `scroll_depth` | 25 / 50 / 75 / 90 percent milestones once per page. |
| `engagement` | 15 / 30 / 60 / 120 / 300 seconds of visible, recently active page time; approximate. |
| `form_start`, `form_submit` | Start filling / attempted submit; not successful delivery. |
| `contact_success` | Actual existing contact handler observed a successful server response with request ID. |
| `control_change`, `search_use` | Filter/option/search operations without selected or typed content. |
| `audit_complete` | Existing brand diagnostic finished displaying its result. |
| `advisor_success`, `advisor_fallback` | Validated AI advice vs rule-based fallback. |
| `proposal_download` | The existing client-generated proposal download action completed. |
| `script_error`, `resource_error` | Generic error category; no stack trace, message or user content. |
| `web_vital` | LCP in milliseconds, CLS multiplied by 1000; sample means in dashboard, not CrUX p75. |

The independent Jianong checkout domain is excluded intentionally. No cross-domain fingerprinting is introduced. Cross-domain checkout analytics requires a separate, consent-aware integration. Future pages processed by the build automatically inherit the common instrumentation; new custom success handlers must explicitly emit an allowlisted `eco:conversion` event after successful completion.

Component IDs are in rendered DOM (`data-eco-id`). A path and component ID in the dashboard identify the relevant element using the browser inspector. Counts are event counts, not screen recordings or pixel heatmaps.

## Privacy and coverage

Telemetry starts only after opt-in. GPC / Do Not Track disable collection, including at the collector. Consent persists in localStorage; the random session ID is held in sessionStorage and rotates after 30 minutes idle. No names, emails, search queries, brand inputs, raw IP addresses, full referrer URLs, advertising identifiers or fingerprints are stored in event rows. A daily HMAC of trusted ingress IP is used only for rate limiting; it is pseudonymous, not a claim of absolute anonymity. Application observability logs are disabled; underlying hosting providers may retain their own operational logs.

Events are retained 90 days and expired auth/rate-limit records are cleaned by the daily Worker cron. Dashboard auth expires in one hour. The cookie is Secure, HttpOnly, SameSite=Strict and host-only; only token hashes are stored. Wrong attempts are bounded per IP and globally. Deliberate telemetry spoofing is still possible with public client analytics; Origin checks and rate limits are not proof that an event came from a human.

Dashboard windows are UTC, and show only received/retained data. Tab-session counts are not cross-device unique visitors. Known ChatGPT, Perplexity, Gemini, Copilot, Claude, DeepSeek, Doubao and Kimi referrals are categorized by referring host; missing referrers remain direct/unknown, not invented AI traffic. This is not an AI mention/citation monitoring service. Consent refusal, tracking prevention, offline browsing, event delivery failures and tool privacy behavior limit coverage.

## Tests and rollback

```
python -m pip install -r build-requirements.txt
python scripts/build_site.py
python -m unittest discover -s tests -p 'test_site_build.py'
node --test tests/test-analytics-worker.mjs
python -m pip install playwright==1.58.0
python -m playwright install chromium
python tests/site_browser_check.py
```

Worker tests use actual SQLite semantics behind a D1-compatible adapter, including deduplication and authentication. Browser tests use explicitly mocked traffic and test credentials, never production statistics. Passing these tests is not proof that the live Worker has been provisioned.

Revert the implementation commit to return to previous static deployment. To pause analytics without changing content, remove the build's tracker injection or disable the Worker route. To rotate access, update the secret and redeploy. Rotating `ANALYTICS_SECRET` invalidates existing sessions; it does not delete event history. Do not delete D1 unless data removal is specifically intended.

## Technical references

- Google AI features: https://developers.google.com/search/docs/appearance/ai-features
- Vercel build/output configuration: https://vercel.com/docs/project-configuration
- Cloudflare Worker secrets: https://developers.cloudflare.com/workers/configuration/secrets/
- Cloudflare D1 API: https://developers.cloudflare.com/d1/worker-api/d1-database/

`llms.txt` is an optional navigation aid. Google does not require a special AI file or AI-only schema for AI Overviews / AI Mode; crawlability, visible useful content and accurate structured data remain the fundamentals.
