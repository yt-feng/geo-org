# Official manufacturer price comparison

Review date: **2026-10-24**. Implementation: `lib/official-pricing.ts`; regression suite: `tests/official-pricing.test.mjs`.

This reference is independent of tokvilo's supplier costs. The comparison accepts only the public customer price (`retailMicrousd`) and compares it to a documented manufacturer API rate. It imports no internal procurement or pricing-fetch module. It is a dated reference, not a live price feed or a claim that every catalog model is cheaper or currently available from its manufacturer.

## Sources and coverage

The initial snapshot contains 70 canonical models, 10 explicitly enumerated aliases and 9 manufacturers. Some entries are useful reference data even when current catalog conditions do not allow a numeric comparison.

| Manufacturer | Canonical models | Official evidence | Basis |
| --- | ---: | --- | --- |
| OpenAI | 20 | [Model documentation](https://developers.openai.com/api/docs/models), [pricing](https://developers.openai.com/api/docs/pricing) | Each entry links its own exact model page; standard text input/output/cache read, USD. GPT-6/6.1 and specified 5.x long-context tiers are separate. |
| Anthropic | 14 | [Claude API pricing](https://platform.claude.com/docs/en/about-claude/pricing), [model IDs](https://platform.claude.com/docs/en/models/overview) | Direct Claude API global routing, USD; explicit 5-minute/1-hour cache writes. Haiku 5.5 has a 100,000-token boundary. |
| Google | 9 | [Gemini Developer API pricing](https://ai.google.dev/gemini-api/docs/pricing) | Paid Standard tier, text tokens, USD; thinking is output; storage and tools are extra. Free, Batch, Flex, Priority and Contributor tiers excluded. |
| Zhipu | 7 | [Z.AI API pricing](https://docs.z.ai/guides/overview/pricing) | Direct international Z.AI API, USD; China-platform CNY prices are not substituted. |
| xAI | 8 | [API pricing](https://docs.x.ai/developers/pricing) | Global on-demand endpoint, USD; long context starts at **≥200,000** input tokens. US-region premium excluded. |
| MiniMax | 2 | [API pricing](https://platform.minimax.io/docs/pricing/overview) | Standard M3/M3.1 Flash USD rates; M3 uses actual current discounted prices, not struck-through prices. M3 boundary is >512,000 input tokens. |
| Moonshot | 1 | [Kimi API homepage](https://platform.kimi.ai/), [billing conditions](https://platform.kimi.ai/docs/pricing/chat), [K3 model guide](https://platform.kimi.ai/docs/guide/kimi-k3-quickstart) | K3 direct API, USD. No Kimi membership/Code plan pricing. Cache-write TTL prices are not inferred from an unspecific homepage amount. |
| Alibaba Qwen | 7 | [Model Studio pricing](https://help.aliyun.com/en/model-studio/model-pricing) | China (Beijing)/global deployment standard rates, **CNY**; no invented exchange rate. Cache discount excluded until its exact conditions are verified. |
| DeepSeek | 2 | [Direct API models and pricing](https://api-docs.deepseek.com/quick_start/pricing/) | Current `deepseek-flash` and `deepseek-v4-pro` routes; USD; peak/off-peak rules require explicit verification. |

OpenAI entries were read from their model pages, not inferred from neighboring versions. The verified pages include [GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol), [GPT-6 Astra](https://developers.openai.com/api/docs/models/gpt-6-astra), [GPT-5.4](https://developers.openai.com/api/docs/models/gpt-5.4), [GPT-4.1](https://developers.openai.com/api/docs/models/gpt-4.1) and their individually linked entries. The exact `gpt-5.4-2026-03-05` alias appears on its model page. No other date suffix is automatically accepted.

Claude 4.5 dated IDs and undated aliases are verified in the individual [Opus](https://platform.claude.com/docs/en/models/opus-4-5/overview), [Sonnet](https://platform.claude.com/docs/en/models/sonnet-4-5/overview) and [Haiku](https://platform.claude.com/docs/en/models/haiku-4-5/overview) pages. They have a 200K context cap; the comparison does not extrapolate their prices above it. Sonnet 4.5's published retirement date is recorded. MiniMax lowercase spellings are explicit catalog case aliases. Qwen dated aliases and Gemini customtools appear alongside their prices in their source tables.

## Comparison contract

`matchOfficialModel(modelId)` requires an exact canonical ID or an explicitly listed alias. It does not strip provider prefixes, dates, thinking/highspeed suffixes, spaces or punctuation. A similar version is not evidence of identical prices.

`compareOfficialRate(modelId, retailRate, options?)` returns `verified`, `conditions_unknown`, `unverified`, `currency_mismatch`, `unit_mismatch` or `dimension_unverified`. All non-verified statuses have null savings/multiple/price position. The source and as-of date remain available; a single known but incompatible rate can still be displayed in its original currency.

`retailRate` accepts `dimension`, `unit`, `retailMicrousd`, optional `condition`, `tierMinInputTokens` and `tierMaxInputTokens`. The lower token bound is exclusive, upper inclusive; `null` upper means no further billing tier. Known public adapter dimension formats include `tier1:input`, `input:standard`, `input:long_context` and `cacheRead`. Free-form conditions are not silently discarded. Structured bounds must agree with any parsed condition text. Unknown unit, audio/image/tool dimensions, or cache writes with no verified TTL cannot become text-price comparisons.

If an official model has multiple context tiers, the public retail tier must lie wholly inside one official tier, or the caller must provide an explicit `options.inputTokens` point within the retail tier. Missing context does **not** select the cheapest official tier. The UI can display separate rows per public context tier without asking the customer to enter a prompt length. Compare only rates that share billing units and conditions; this does not estimate a request's total cost, cache hit rate or quality.

DeepSeek's current official peak windows are weekday UTC 01:00–04:00 and 06:00–10:00, excluding Chinese public holidays; all other times are off-peak. The observed tokvilo public snapshot instead describes UTC 00:00–14:00. These are **not equivalent**. A `peak`/`off_peak` label alone therefore does not enable a comparison. `options.timeBand` is reserved for a caller that has separately verified both schedules; unresolved free-form time conditions still prevent comparison.

Savings are `(official - tokvilo) / official × 100`; a negative result remains negative. `multiple` means `official / tokvilo`, not “times cheaper.” Zero denominators never produce Infinity/NaN. Rates use integer micro-USD for monetary equality. There is no currency conversion.

`options.now` enables deterministic tests. Runtime defaults to the current date. Promotional/reference validity ends at the recorded `validThrough`; afterward, comparisons return `official_price_requires_refresh` until a human verifies and updates the source. Gemini 4 Argon expires here on November 30, Gemini 3.6/3.8 Flash on December 31, and GPT-5.6 Sol requires review after November 21, 2026. The implementation intentionally does not automatically apply announced future prices without a fresh check.

## Deliberate gaps

- Catalog `claude-fable-5.1` is not silently matched to official API ID `claude-fable-5-1`.
- DeepSeek accepts old V4 Flash route names but serves V4.1 weights. This does not prove that a catalog listing for the old model is the same current model; those entries remain unmatched.
- Gemini `-thinking`, `-nothinking` and unverified preview IDs remain unmatched. A stable release's price is not copied to its preview.
- The current MiniMax pricing page no longer contains M2.7 despite an older search index retaining prices. M2.1/M2.5/M2.7 are unverified here.
- Kimi's currently rendered pricing guide omits the numerical table. The current homepage verifies K3; older indexed K2.6/K2.7 cards are not promoted to current verified prices.
- Qwen 3.7 Plus has ambiguous limited-time discount presentation; unverified discount expiry is not converted to an invented payable rate.
- Images, audio, video, embeddings, subscriptions, tools, storage, arbitrary fine-tunes and unsupported catalog models have no fallback to a nearby text model.

## Updating

1. Open the current **first-party** source and the exact model/version; record the actual review date. Check ordinary payable pricing, currency, text modality, region, long-context boundary (including equality), caching TTL and expiry. Do not copy search snippets when the live page disagrees.
2. Add or change an explicit entry in `OFFICIAL_MODEL_PRICING`. Attach a model-specific URL where available. Add an alias only with documentary evidence; record that evidence here. Keep amounts in the original currency and do not import supplier data.
3. Preserve unknown status if a price or condition cannot be verified. Do not remove expiry guards merely to restore a savings badge.
4. Run `node --test tests/official-pricing.test.mjs`, scoped ESLint and TypeScript. Add boundary tests for any new conditional pricing. Inspect actual public normalized rate shapes before expanding supported condition parsing.
5. Review Chinese and English comparison displays and their source/date/condition labels. Production price references and runtime retail billing are separate: changing this reference does not change customer charges.
