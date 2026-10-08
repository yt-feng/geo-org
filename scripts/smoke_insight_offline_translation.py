#!/usr/bin/env python3
"""Exercise the production HTML translator with real en/ar CPU inference and resume.

Run only after setup-offline-translation, without paid-provider credentials.
The public corpus and raw results are retained as operational evidence. Wording,
terminology and language-quality differences are warnings, not release gates.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import time
from unittest.mock import patch

from compare_hymt_translation import require_actions
from hymt_offline_translation import HyMTOfflineTranslator, OfflineTranslationError, atomic_json
from insight_offline_translation import translate_article, digest

ARTICLE = {
    "title": "Eco-GEO：先核对事实，再扩大内容投入",
    "excerpt": "以下是示意假设：预算为1000元，错误率从10%降至5%。这不是已观测的商业结果。",
    "body_html": '<section data-role="analysis"><h2>同一预算下的选择</h2>'
        '<p>团队应先核对AI答案中的事实，再决定是否扩大内容投入。以下比较仅用于解释决策方法，不能保证收入增长。</p>'
        '<p>示意假设：在100个问题中，错误数量从10个降至5个，因此错误率从10%降至5%。参见<a href="https://example.org/method?sample=100&amp;lang=zh" data-source-id="S1">[S1]</a>。</p>'
        '<table><thead><tr><th>指标</th><th>预算</th></tr></thead><tbody><tr><td>核对事实</td><td>1000元</td></tr></tbody></table>'
        '<p>只有错误率≤5%时才扩大试验；否则继续核对事实。保留证据与不确定性。</p></section>',
    "tags": ["GEO", "事实核查"],
}
# Replay the exact two source paragraphs that previously fell back to Chinese,
# plus one short formal-expression case. This adds three blocks per locale, not
# a full article regeneration, and still uses the pinned free CPU translator.
_regression = json.loads((Path(__file__).resolve().parents[1] / 'tests/fixtures/row709-translation-integrity.json').read_text())
ARTICLE['body_html'] += '<section data-role="regression">' + ''.join(
    '<p>' + block['source'] + '</p>' for block in _regression['resource_blocks']) + '<p>' + _regression['formula_sample'] + '</p></section>'
# Exact pending block from row710: both locales repeatedly dropped a protected
# token around the short formatted label. Keep this sentence in the real smoke.
# Cover source-known label classes, including units and parenthesized variables,
# rather than adding a special production translation for a particular sentence.
_LABEL_REGRESSIONS = [
    '<strong>问题集：</strong>与云产品决策直接相关的目标问题，示意m=25个，覆盖区域可用性、SLA赔偿口径、计费单位、认证状态、版本与配额五类。',
    '<strong>抽样单位：</strong>一个问题在一个平台上的一次回答记为一次采样记录；同一组问题至少在两个平台重复采样，采样顺序一致。',
    '<strong>严重事实错误（E）：</strong>某问题在任一平台答案中出现至少一处与官方事实台账冲突的陈述，该问题计1。',
]
ARTICLE['body_html'] += '<section data-role="row710-regression">' + ''.join('<p>' + text + '</p>' for text in _LABEL_REGRESSIONS) + '</section>'
# Exact row711 heading: a token-free input repeatedly acquired a malformed
# placeholder from the decoder's unconditional token-preservation examples.
# The existing raw-decode artifact proves the pinned model's actual behavior.
ARTICLE['body_html'] += '<h2>四、品牌事实统一：官网、媒体、社媒、案例说同一套话</h2>'


class InterruptAfterThree:
    def __init__(self, translator):
        self.translator = translator
        self.model_id = translator.model_id
        self.calls = 0

    def translate(self, *args, **kwargs):
        self.calls += 1
        if self.calls == 4:
            raise OfflineTranslationError("intentional-smoke-checkpoint-interruption")
        return self.translator.translate(*args, **kwargs)


def append_smoke_diagnostic(path: Path, event: dict) -> None:
    """Persist failed as well as accepted decodes of this fixed public corpus."""
    # Explicit opt-in here only: production article translation does not record
    # raw inputs or outputs. Close each append before validation can fail so the
    # always-uploaded smoke artifact contains the exact failing decode.
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps({"corpus": "fixed-public-smoke", **event}, ensure_ascii=False) + "\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=Path(".artifacts/offline-smoke"))
    args = parser.parse_args()
    require_actions()
    if any(os.environ.get(name) for name in ("DEEPSEEK_API_KEY", "OPENAI_API_KEY", "TAVILY_API_KEY")):
        raise RuntimeError("Offline smoke requires no paid-provider credentials")
    args.output_dir.mkdir(parents=True, exist_ok=True)
    diagnostics_path = args.output_dir / "model-decodes.jsonl"
    diagnostics_path.unlink(missing_ok=True)
    report = {"created_at": datetime.now(timezone.utc).isoformat(), "source": ARTICLE,
              "source_sha256": digest(ARTICLE), "paid_provider_requests": 0, "languages": {}, "passed": False,
              "model_decodes_file": diagnostics_path.name}
    report_path = args.output_dir / "report.json"
    atomic_json(report_path, report)
    try:
        # The installed runtime talks through http.client only to its own remote
        # runner-local server. Any accidental URL/API request in translation fails.
        with patch("urllib.request.urlopen", side_effect=AssertionError("Network/paid API calls forbidden during inference")):
            for language in ("en", "ar"):
                started = time.monotonic()
                checkpoint = args.output_dir / f"{language}.checkpoint.json"
                checkpoint.unlink(missing_ok=True)
                translator = HyMTOfflineTranslator(cache_dir=args.output_dir / "fragment-cache", quality_mode="publish",
                    diagnostic_callback=lambda event: append_smoke_diagnostic(diagnostics_path, event))
                try:
                    translate_article(ARTICLE, language, checkpoint_path=checkpoint,
                                      translator=InterruptAfterThree(translator))
                    raise AssertionError("Expected deliberate checkpoint interruption")
                except OfflineTranslationError as error:
                    if str(error) != "intentional-smoke-checkpoint-interruption":
                        raise
                interrupted = json.loads(checkpoint.read_text())
                assert len(interrupted["blocks"]) == 3 and not interrupted["complete"]
                result = translate_article(ARTICLE, language, checkpoint_path=checkpoint, translator=translator)
                assert result["translation_provenance"]["reused_blocks"] == 3
                replay = translate_article(ARTICLE, language, checkpoint_path=checkpoint, translator=translator)
                assert replay["translation_provenance"]["translated_blocks"] == 0
                assert all(result[key] == replay[key] for key in ARTICLE)
                report["languages"][language] = {"article": result, "duration_seconds": round(time.monotonic() - started, 1),
                    "resumed_blocks": 3, "replay_translated_blocks": 0, "model": translator.model_id,
                    "model_stats": translator.stats, "passed": True}
                atomic_json(report_path, report)
                print(f"Offline {language}: content, HTML/URL structure and interrupted resume passed; "
                      f"quality_warnings={len(result['translation_provenance']['quality_warnings'])}", flush=True)
        report["passed"] = True
    except Exception as error:
        report["error"] = str(error)
        raise
    finally:
        atomic_json(report_path, report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
