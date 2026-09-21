#!/usr/bin/env python3
"""Exercise the production HTML translator with real en/ar CPU inference and resume.

Run only after setup-offline-translation, without paid-provider credentials.
The public corpus and raw results are retained for semantic inspection; structural
success is not a substitute for the production independent editorial review.
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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=Path(".artifacts/offline-smoke"))
    args = parser.parse_args()
    require_actions()
    if any(os.environ.get(name) for name in ("DEEPSEEK_API_KEY", "OPENAI_API_KEY", "TAVILY_API_KEY")):
        raise RuntimeError("Offline smoke requires no paid-provider credentials")
    args.output_dir.mkdir(parents=True, exist_ok=True)
    report = {"created_at": datetime.now(timezone.utc).isoformat(), "source": ARTICLE,
              "source_sha256": digest(ARTICLE), "paid_provider_requests": 0, "languages": {}, "passed": False}
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
                translator = HyMTOfflineTranslator(cache_dir=args.output_dir / "fragment-cache")
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
                canonical_noun = "content investment" if language == "en" else "الاستثمار في المحتوى"
                assert canonical_noun in result["title"], "Content investment must retain its marketing meaning in the title"
                replay = translate_article(ARTICLE, language, checkpoint_path=checkpoint, translator=translator)
                assert replay["translation_provenance"]["translated_blocks"] == 0
                assert all(result[key] == replay[key] for key in ARTICLE)
                report["languages"][language] = {"article": result, "duration_seconds": round(time.monotonic() - started, 1),
                    "resumed_blocks": 3, "replay_translated_blocks": 0, "model": translator.model_id,
                    "model_stats": translator.stats, "passed": True}
                atomic_json(report_path, report)
                print(f"Offline {language}: HTML/URL/numeric/term checks and interrupted resume passed", flush=True)
        report["passed"] = True
    except Exception as error:
        report["error"] = str(error)
        raise
    finally:
        atomic_json(report_path, report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
