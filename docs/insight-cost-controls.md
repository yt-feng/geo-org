# Daily insight translation and paid-generation controls

The daily workflow runs at 02:17 Asia/Shanghai. GitHub may start scheduled jobs
late, so every paid request (including retries and legacy generation workflows)
also checks its actual start time and complete request deadline. Weekday UTC
01:00–04:00 and 06:00–10:00 are blocked, with a one-minute boundary margin.
This follows the [DeepSeek pricing window](https://api-docs.deepseek.com/quick_start/pricing/)
checked on 2026-09-21, conservatively retaining the weekday block on holidays.

## Translation

English and Arabic article text uses pinned Tencent Hy-MT2-1.8B Q8_0 through
pinned llama.cpp on a standard GitHub-hosted Linux CPU runner. There are no API
credentials or paid-provider fallback in the translator. Model/runtime revisions,
checksums and licenses are in `scripts/hymt_translation_model_manifest.json`.
This public repository uses standard hosted runners, whose compute is included
under [GitHub's public repository policy](https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/choose-the-runner-for-a-job).

The adapter retains HTML structure, links, named terms and numeric values, and
checkpoints each accepted text block in `.artifacts/offline-translations/`.
Reuse requires matching source, model and adapter identities and revalidation.
The Chinese original retains editorial review. Translations receive only local
publication checks; they never call paid editorial review. Ordinary wording,
terminology, numeric-format and language-quality differences are logged as
nonblocking notes. Empty/truncated text, large omissions, broken placeholders,
HTML or links still stop publication of an unusable translation.

Each locale receives one offline translation per attempt. Successful blocks are
reused, including their nonblocking quality notes, rather than repeatedly
polishing the same text. There is no paid translation review or automatic
Chinese-revision-and-retranslate loop. Source corrections use the
existing explicit resume/editorial-revision path and create new source hashes.

## Paid generation

- Ordinary research/drafting disables thinking; independent reviews retain it.
- A run is capped at 12 provider attempts and 600,000 accounted tokens, shared by
  all paid stages. Free locale translation and checks do not consume this budget.
- Before sending a request, reserve an upper estimate of input plus maximum
  output. Replace the reservation with provider usage when available. Missing,
  failed or truncated usage retains the full reservation instead of becoming zero.
- New Chinese content has at most three drafts; explicit resume also has at most
  three attempts within the same global cost budget. Transport attempts are capped at two. All count against the same
  run budget.
- High-peak admission or budget exhaustion stops paid work and retains audit
  files. Resume during an allowed window; no waiting runner or automatic paid
  retry is created. Chinese source content must pass its editorial gate; translated content only
  needs to remain complete and structurally publishable.

Artifacts include a content-free `.artifacts/usage/deepseek.jsonl` ledger. Actions
summaries show stage-level observed tokens, reasoning tokens and unknown-usage
counts. An observed subtotal is not an exact provider bill when usage is missing.

`Offline translation and cost controls` runs unit regressions plus real English
and Arabic CPU inference without paid credentials. It verifies HTML/link/number
preservation, nonblocking quality notes, interrupted resume and a repeated run with zero new inference,
and retains translated samples in its smoke-test artifact for inspection.
