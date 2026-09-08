"""Saved-pass identity, review-contract and three-language publication checks."""
import copy
import hashlib
import json
import os
import sys
import tempfile
import unittest
from contextlib import ExitStack
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import generate_daily_blog as daily
import insight_pipeline as ip
from test_insight_quality import SOURCES, valid_article


class PassedChineseResumeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.topic = ip.gb.TopicRow(694, "条件式资源配置", {}, "Brand", "GEO")
        self.sources = []
        for source in SOURCES:
            body = f"Synthetic source {source['id']} contains scoped observations. " * 40
            self.sources.append({**source, "text": body, "excerpt_start": 0, "excerpt_end": len(body),
                                 "body_chars": len(body), "excerpt_truncated": False, "published": "2025-01-02",
                                 "retrieved_at": "2026-01-01T00:00:00+00:00", "scope_notes": "Original source boundary."})
        normalization = {}
        self.article = ip.normalize_article(valid_article(), "zh", normalization=normalization)
        structural = ip.validate_insight(self.article, self.sources)
        self.assertTrue(structural["passed"], structural["errors"])
        prior_review = self.good_review()
        prior_review.update(scores=dict.fromkeys(ip.SCORE_KEYS, 3), blockers=["修正同一基线下的计算公式"], blocker_checks=[])
        last = {"revision": 2, "article": self.article, "article_sha256": ip._article_sha256(self.article),
                "structure": structural, "normalization": normalization, "review_state": "completed",
                "review": self.good_review(), "errors": [], "feedback_applied": {}, "metadata_state": "valid"}
        prior = {**copy.deepcopy(last), "revision": 0, "review": prior_review, "errors": ["prior editorial failure"]}
        self.audit = {"version": "insights-v3", "row": 694, "language": "zh", "passed": True,
                      "brief": {"decision_question": "同一预算下如何配置资源"}, "sources": ip.public_sources(self.sources),
                      "attempts": [prior, last]}
        self.destination = self.root / "new-artifact" / "zh.json"

    def good_review(self):
        return {"scores": {**dict.fromkeys(ip.SCORE_KEYS, 4), "originality": 5}, "issues": [], "blockers": [],
                "claim_checks": [{"claim": f"Concrete scoped source observation number {index}",
                                  "reason": "The supplied original contains this scoped observation.",
                                  "source_ids": ["S1" if index % 2 else "S2"], "verdict": "supported"} for index in range(5)],
                "blocker_checks": [{"issue_id": "r0-blocker-1", "status": "resolved", "location": "经济性表格",
                                    "finding": "当前正文已经统一起始基线并核对各个公式。"}]}

    def reuse(self, audit=None, sources=None):
        return ip.reuse_passed_chinese_audit(self.topic, sources or self.sources, "test",
            resume_audit=self.audit if audit is None else audit, audit_path=self.destination)

    def assert_invalid(self, audit, pattern=None):
        with mock.patch.object(ip, "review_article") as review, mock.patch.object(ip, "request_json") as model:
            with self.assertRaisesRegex(ValueError, pattern or "."):
                self.reuse(audit)
            review.assert_not_called()
            model.assert_not_called()
        self.assertFalse(self.destination.exists())

    def test_signed_pass_reuses_exact_article_and_preserves_audit_without_model_calls(self):
        original = copy.deepcopy(self.audit)
        self.audit["attempts"][-1]["article"]["quality"] = {"scores": "untrusted"}
        with mock.patch.object(ip, "review_article") as review, mock.patch.object(ip, "request_json") as model:
            result = self.reuse()
        review.assert_not_called()
        model.assert_not_called()
        saved = json.loads(self.destination.read_text())
        self.assertTrue(saved["passed"])
        self.assertEqual(saved["attempts"], self.audit["attempts"])
        self.assertEqual(saved["resume_history"][-1]["mode"], "validated_passed_chinese")
        self.assertEqual(result["quality"]["scores"], original["attempts"][-1]["review"]["scores"])
        self.assertEqual(result["body_html"], original["attempts"][-1]["article"]["body_html"])
        self.assertNotIn("text", saved["sources"][0])

    def test_old_metadata_repair_full_fingerprint_is_verified_without_new_review(self):
        last = self.audit["attempts"][-1]
        last["metadata_repair"] = {"state": "warning", "article_sha256": last.pop("article_sha256")}
        with mock.patch.object(ip, "review_article") as review:
            self.reuse()
        review.assert_not_called()

    def test_unsigned_legacy_pass_gets_one_review_of_identical_article_without_draft_or_brief(self):
        self.audit["attempts"][-1].pop("article_sha256")
        original = copy.deepcopy(self.audit)
        with mock.patch.object(ip, "review_article", return_value=self.good_review()) as review, \
                mock.patch.object(ip, "request_json", side_effect=AssertionError("No drafting")):
            result = self.reuse()
        self.assertEqual(self.audit, original)
        self.assertEqual(review.call_count, 1)
        self.assertEqual(review.call_args.args[0], self.article)
        self.assertIn("r0-blocker-1", [item["id"] for item in review.call_args.kwargs["required_fixes"]])
        saved = json.loads(self.destination.read_text())
        self.assertEqual(len(saved["attempts"]), 3)
        self.assertEqual(saved["attempts"][-1]["draft_origin"], "saved_chinese_fresh_review")
        self.assertEqual(saved["attempts"][-1]["article_sha256"], ip._article_sha256(self.article))
        self.assertEqual(result["quality"]["revisions"], 3)

    def test_unsigned_pass_fresh_review_failure_is_saved_and_cannot_publish(self):
        self.audit["attempts"][-1].pop("article_sha256")
        bad = self.good_review()
        bad["claim_checks"][0]["verdict"] = "unsupported"
        with mock.patch.object(ip, "review_article", return_value=bad):
            with self.assertRaisesRegex(RuntimeError, "unsupported claim"):
                self.reuse()
        saved = json.loads(self.destination.read_text())
        self.assertFalse(saved["passed"])
        self.assertIn("error", saved)
        self.assertEqual(saved["attempts"][-1]["review_state"], "completed")

    def test_top_level_pass_cannot_override_incomplete_states_or_errors(self):
        changes = [("version", "old-version"), ("row", True), ("language", "ar"), ("error", ""), ("brief", {})]
        for key, value in changes:
            with self.subTest(key=key):
                audit = copy.deepcopy(self.audit)
                audit[key] = value
                self.assert_invalid(audit)
        for key, value in [("review_state", "pending"), ("errors", ["unresolved"]), ("review", {}), ("normalization", {})]:
            with self.subTest(attempt_key=key):
                audit = copy.deepcopy(self.audit)
                audit["attempts"][-1][key] = value
                self.assert_invalid(audit)

    def test_full_fingerprint_detects_title_excerpt_tags_and_body_changes(self):
        for field in ("title", "excerpt", "tags", "body_html"):
            with self.subTest(field=field):
                audit = copy.deepcopy(self.audit)
                audit["attempts"][-1]["article"][field] += " 被改动"
                self.assert_invalid(audit, "SHA256|normalization")

    def test_normalization_and_original_structure_proofs_cannot_be_skipped(self):
        mutations = [
            lambda last: last["article"].update(body_html=" " + last["article"]["body_html"]),
            lambda last: last["normalization"].update(raw_body_sha256="0" * 64),
            lambda last: last["normalization"].update(inline_style_attributes_removed=True),
            lambda last: last["structure"]["metrics"].update(table_count=17),
            lambda last: last["structure"].update(passed=False),
        ]
        for mutate in mutations:
            audit = copy.deepcopy(self.audit)
            mutate(audit["attempts"][-1])
            self.assert_invalid(audit)

    def test_complete_claim_contract_and_score_thresholds_are_revalidated(self):
        mutations = [
            lambda review: review["scores"].update(evidence=True),
            lambda review: review["scores"].update(mechanism=3),
            lambda review: review["scores"].update(extra=5),
            lambda review: review.update(scores=dict.fromkeys(ip.SCORE_KEYS, 4)),
            lambda review: review.update(blockers=["事实尚无来源"]),
            lambda review: review["claim_checks"][0].update(verdict="unsupported"),
            lambda review: review["claim_checks"][0].update(source_ids=["S99"]),
            lambda review: review["claim_checks"][0].update(source_ids=[]),
            lambda review: review.update(claim_checks=[copy.deepcopy(review["claim_checks"][0])] * 5),
            lambda review: [check.update(source_ids=["S1"]) for check in review["claim_checks"]],
            lambda review: review["claim_checks"][0].update(reason=""),
        ]
        for mutate in mutations:
            audit = copy.deepcopy(self.audit)
            mutate(audit["attempts"][-1]["review"])
            self.assert_invalid(audit)

    def test_historical_blockers_are_rebuilt_without_trusting_feedback(self):
        for status in (None, "unresolved", "unverifiable"):
            audit = copy.deepcopy(self.audit)
            audit["attempts"][-1]["feedback_applied"] = {"required_fixes": []}
            checks = audit["attempts"][-1]["review"]["blocker_checks"]
            if status is None:
                checks.clear()
            else:
                checks[0]["status"] = status
            self.assert_invalid(audit, "blocker")

    def test_same_draft_format_repair_cannot_erase_a_factual_blocker(self):
        self.audit["attempts"][-1]["review"]["format_repair"] = {
            "errors": ["Missing source ID"], "original_review": {"blockers": [],
            "claim_checks": [{"claim": "This concrete claim was not supported.", "verdict": "unsupported"}]}}
        self.assert_invalid(self.audit, "format repair erased factual blockers")

    def test_source_hash_url_order_and_window_changes_reject_before_any_reuse(self):
        mutations = [lambda sources: sources[0].update(text="changed source"),
                     lambda sources: sources[0].update(url="https://other.example/source"),
                     lambda sources: sources.reverse(), lambda sources: sources[0].update(excerpt_end=300)]
        for mutate in mutations:
            sources = copy.deepcopy(self.sources)
            mutate(sources)
            with mock.patch.object(ip, "review_article") as review:
                with self.assertRaises(ValueError):
                    self.reuse(sources=sources)
                review.assert_not_called()
            self.assertFalse(self.destination.exists())

    def test_publication_or_scope_reaudit_requires_fresh_semantic_review(self):
        for field, value in (("published", ""), ("scope_notes", "Publication dates conflict.")):
            sources = copy.deepcopy(self.sources)
            sources[0][field] = value
            with mock.patch.object(ip, "review_article", return_value=self.good_review()) as review:
                self.reuse(sources=sources)
            self.assertEqual(review.call_count, 1)
            saved = json.loads(self.destination.read_text())
            self.assertTrue(saved["resume_history"][-1]["source_metadata_changed"])

    def test_loader_only_accepts_selected_complete_internal_audit(self):
        folder = self.root / "downloaded"
        path = folder / ip.gb.slugify(self.topic.title, self.topic.idx) / "zh.json"
        path.parent.mkdir(parents=True)
        path.write_text(json.dumps(self.audit))
        self.assertEqual(daily.load_resume_audit(folder, self.topic), self.audit)
        path.write_text('{"row":694,"row":694,"language":"zh"}')
        with self.assertRaisesRegex(ValueError, "duplicate JSON"):
            daily.load_resume_audit(folder, self.topic)
        path.unlink()
        outside = self.root / "outside.json"
        outside.write_text(json.dumps(self.audit))
        path.symlink_to(outside)
        with self.assertRaisesRegex(ValueError, "inside the downloaded"):
            daily.load_resume_audit(folder, self.topic)

    def daily_run(self, translate, *, editorial=None):
        folder = self.root / "downloaded"
        slug = ip.gb.slugify(self.topic.title, self.topic.idx)
        source_path = folder / slug / "zh.json"
        source_path.parent.mkdir(parents=True, exist_ok=True)
        source_path.write_text(json.dumps(self.audit))
        out = self.root / "blog"
        out.mkdir(exist_ok=True)
        (out / "posts.json").write_text("[]")
        self.languages = []
        def produce(*args, lang="zh", **kwargs):
            self.languages.append(lang)
            if lang == "zh":
                self.editorial_received = kwargs["editorial_revision"]
                return {**self.article, "quality": {"scores": self.good_review()["scores"]}}
            return translate(lang)
        with ExitStack() as stack:
            stack.enter_context(mock.patch.dict(os.environ, {"DEEPSEEK_API_KEY": "test", "INSIGHT_AUDIT_DIR": str(self.root / "artifacts")}))
            stack.enter_context(mock.patch.object(daily.gb, "read_topics", return_value=[self.topic]))
            stack.enter_context(mock.patch.object(daily, "select_next_topic", return_value=self.topic))
            self.reread = stack.enter_context(mock.patch.object(daily, "reread_research_pack", return_value=self.sources))
            self.build = stack.enter_context(mock.patch.object(daily, "build_research_pack"))
            self.produce = stack.enter_context(mock.patch.object(ip, "produce_article", side_effect=produce))
            stack.enter_context(mock.patch.object(ip, "review_article", return_value=self.good_review()))
            self.scaffold = stack.enter_context(mock.patch.object(daily.i18n_site, "ensure_language_scaffold"))
            self.indexes = stack.enter_context(mock.patch.object(daily, "write_indexes"))
            stack.enter_context(mock.patch.object(daily.gb, "article_html", return_value="<article>Reviewed</article>"))
            stack.enter_context(mock.patch.object(daily, "write_localized_output", return_value=[]))
            stack.enter_context(mock.patch.object(daily.i18n_site, "write_sitemap"))
            stack.enter_context(mock.patch.object(daily.authority_site, "main"))
            return daily.generate_daily_article(Path("unused.xlsx"), out, 2, False, resume_dir=folder, editorial_revision_path=editorial)

    def translated(self, lang):
        return {"title": "Translated", "excerpt": "A reviewed translation", "body_html": "<p>Translated</p>",
                "tags": "GEO", "quality": {"scores": self.good_review()["scores"]}}

    def test_reused_chinese_still_requires_both_translations_before_site_writes(self):
        def translate(lang):
            if lang == "ar":
                raise RuntimeError("Arabic independent review failed")
            return self.translated(lang)
        with self.assertRaisesRegex(RuntimeError, "Arabic independent review failed"):
            self.daily_run(translate)
        self.assertEqual(set(self.languages), {"en", "ar"})
        self.reread.assert_called_once_with(self.audit["sources"])
        self.build.assert_not_called()
        self.scaffold.assert_not_called()
        self.indexes.assert_not_called()
        self.assertFalse((self.root / "blog" / "articles").exists())
        zh_audit = self.root / "artifacts" / ip.gb.slugify(self.topic.title, self.topic.idx) / "zh.json"
        self.assertTrue(json.loads(zh_audit.read_text())["passed"])

    def test_three_passed_languages_can_write_output_without_regenerating_signed_chinese(self):
        self.assertTrue(self.daily_run(self.translated))
        self.assertEqual(set(self.languages), {"en", "ar"})
        self.scaffold.assert_called_once()
        self.indexes.assert_called_once()
        self.assertTrue((self.root / "blog" / "articles" / ip.gb.slugify(self.topic.title, self.topic.idx) / "index.html").is_file())

    def test_user_editorial_revision_never_uses_saved_pass_reuse_branch(self):
        candidate = self.root / "editorial.json"
        candidate.write_text(json.dumps({**self.article, "excerpt": "作者的新修订必须独立审稿", "passed": True}))
        with mock.patch.object(ip, "reuse_passed_chinese_audit", side_effect=AssertionError("Do not reuse authored edits")):
            self.assertTrue(self.daily_run(self.translated, editorial=candidate))
        self.assertIn("zh", self.languages)
        self.assertEqual(self.editorial_received["excerpt"], "作者的新修订必须独立审稿")

    def test_new_attempt_binds_complete_article_before_independent_review(self):
        def review(article, *args, **kwargs):
            saved = json.loads(self.destination.read_text())
            self.assertEqual(saved["attempts"][-1]["article_sha256"], ip._article_sha256(article))
            return {**self.good_review(), "blocker_checks": []}
        with mock.patch.object(ip, "request_json", side_effect=[{"decision_question": "选择哪个方案"}, valid_article()]), \
                mock.patch.object(ip, "review_article", side_effect=review):
            ip.produce_article(self.topic, self.sources, "test", audit_path=self.destination)

    def test_numeric_change_details_are_retained_in_revision_feedback(self):
        numeric = {"missing": {"28": 2}, "added": {"4": 1}}
        self.audit["attempts"][-1]["structure"]["metrics"]["translation"] = {"numeric_changes": numeric}
        self.assertEqual(ip._revision_feedback(self.audit)["numeric_changes"], numeric)


if __name__ == "__main__":
    unittest.main()
