# Model identity and logo sources

The logos in `public/provider-logos/` are genuine marks distributed by the maintained [Lobe Icons project](https://github.com/lobehub/lobe-icons), not generated symbols or letter substitutions. Source package: [`@lobehub/icons-static-svg` version 1.98.0](https://www.npmjs.com/package/@lobehub/icons-static-svg/v/1.98.0), retrieved 2026-10-23 from the npm registry. Each SVG is copied unchanged from the package's `icons/` directory. No runtime request to an external icon CDN is required.

The package is MIT licensed. The original LobeHub copyright and complete license are retained in [`public/provider-logos/LICENSE`](../public/provider-logos/LICENSE). Brand names and marks identify model manufacturers/products; they do not imply that the manufacturers operate or endorse tokvilo. The license covers the supplied icon artwork/code and does not transfer ownership of trademarks.

| Manufacturer or product | Local/source SVG filename |
| --- | --- |
| OpenAI | `openai.svg` |
| Anthropic / Claude | `anthropic.svg`, `claude.svg` |
| Google / Gemini | `google.svg`, `gemini.svg` |
| DeepSeek | `deepseek.svg` |
| Alibaba / Qwen | `alibaba.svg`, `qwen.svg` |
| Zhipu | `zhipu.svg` |
| ByteDance | `bytedance.svg` |
| xAI | `xai.svg` |
| Black Forest Labs / FLUX | `bfl.svg`, `flux.svg` |
| Kuaishou / Kling | `kling.svg` (product mark) |
| MiniMax | `minimax.svg` |
| Moonshot / Kimi | `moonshot.svg`, `kimi.svg` |
| Xiaomi / MiMo | `xiaomimimo.svg` (product mark) |
| Microsoft | `microsoft.svg` |
| Tencent / Hunyuan | `tencent.svg`, `hunyuan.svg` |
| Shengshu / Vidu | `vidu.svg` (product mark) |
| PixVerse | `pixverse.svg` |
| StepFun | `stepfun.svg` |
| Suno | `suno.svg` |
| Midjourney | `midjourney.svg` |

SkyReels and unknown manufacturers currently use a neutral text fallback, explicitly avoiding an invented brand mark. Mono SVGs are rendered with a CSS mask using the page's text color, so the original geometry remains readable in light and dark themes. A caller may override `--provider-logo-color` without modifying the artwork.

## Catalogue organization

`lib/model-identity.ts` contains only public manufacturer names, product taxonomy and version identifiers. The catalogue groups manufacturer → model family → identifier version. Numeric version components sort descending, then explicit date suffixes break ties within a generation. This ordering is a browsing aid based on identifiers, not a claim about release dates or comparative performance. Capabilities such as GPT Image, Gemini Image, realtime audio and transcription stay in separate families. Same model identifiers served by different tokvilo interfaces remain separate entries; grouping never deduplicates them.
