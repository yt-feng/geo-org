"""Failed translations become independently checked Chinese revision obligations."""
import copy
import json
import os
import unittest
from pathlib import Path
from unittest import mock

import test_daily_resume_passed as fixtures

daily, ip = fixtures.daily, fixtures.ip


class CrossLanguageResumeTests(unittest.TestCase):
    setUp = fixtures.PassedChineseResumeTests.setUp
    good_review = fixtures.PassedChineseResumeTests.good_review

    def translation(self, lang="en", *, signed=True):
        article = ip.normalize_article({"title": "Eco-GEO: Conditional comparison", "excerpt": "A scoped comparison",
            "body_html": "<p>A count of one out of fifty does not fall below one percent.</p>", "tags": "GEO"}, lang)
        value = {"version": "insights-v3", "row": self.topic.idx, "language": lang, "passed": False,
                 "sources": copy.deepcopy(self.audit["sources"]), "error": "translation review failed",
                 "attempts": [{"revision": 0, "article": article, "article_sha256": ip._article_sha256(article),
                     "structure": {"passed": True, "errors": [], "metrics": {}}, "review_state": "completed",
                     "review": {"scores": dict.fromkeys(ip.SCORE_KEYS, 1), "issues": [],
                                "blockers": ["1/50 cannot satisfy the stated <1% gate.",
                                             "S1 describes worthwhile steps, not prerequisites."]},
                     "errors": ["independent factual review failed"]}]}
        if signed:
            value["source_article_sha256"] = ip._article_sha256(self.article)
        return value

    def load(self, translation):
        folder = self.root / "downloaded"
        path = folder / ip.gb.slugify(self.topic.title, self.topic.idx) / "zh.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(self.audit))
        path.with_name("en.json").write_text(json.dumps(translation))
        return daily.load_resume_audit(folder, self.topic)

    def test_loader_carries_original_audit_and_origin_without_transplanting_scores(self):
        original, translation = copy.deepcopy(self.audit), self.translation()
        loaded = self.load(translation)
        self.assertEqual(self.audit, original)
        self.assertEqual(loaded["attempts"], original["attempts"])
        self.assertIs(loaded["passed"], True)
        self.assertEqual(loaded["cross_language_feedback"][0]["audit"], translation)
        self.assertTrue(ip.has_pending_cross_language_feedback(loaded))
        feedback = ip._revision_feedback(loaded)
        self.assertEqual(feedback["scores"], original["attempts"][-1]["review"]["scores"])
        imported = [fix for fix in feedback["required_fixes"] if fix.get("origin_language")]
        self.assertEqual([fix["problem"] for fix in imported], translation["attempts"][0]["review"]["blockers"])
        self.assertTrue(all(fix["origin_language"] == "en" and fix["translation_revision"] == 0 for fix in imported))
        self.assertEqual(ip.attach_cross_language_feedback(loaded, translation, "en"), loaded)

    def test_legacy_bundle_association_is_explicit_and_arabic_is_supported(self):
        legacy = self.translation("ar", signed=False)
        loaded = ip.attach_cross_language_feedback(self.audit, legacy, "ar")
        fix = ip.cross_language_required_fixes(loaded)[0]
        self.assertEqual(fix["association"], "same_directory_row_and_sources_legacy")
        self.assertEqual(fix["source_article_sha256"], ip._article_sha256(self.article))
        self.assertEqual(fix["origin_language"], "ar")
        self.assertNotIn("source_article_sha256", loaded["cross_language_feedback"][0]["audit"])

    def test_wrong_row_sources_language_and_article_identity_rejected(self):
        mutations = [lambda a: a.update(row=695), lambda a: a.update(row=True),
                     lambda a: a.update(language="ar"), lambda a: a.update(source_article_sha256="0" * 64),
                     lambda a: a["sources"][0].update(text_sha256="0" * 64),
                     lambda a: a["sources"][0].update(url="https://different.example/"),
                     lambda a: a["sources"][0].update(id="S99"),
                     lambda a: a["attempts"][0].update(article_sha256="0" * 64)]
        for mutate in mutations:
            translation = self.translation()
            mutate(translation)
            with self.subTest(translation=translation), self.assertRaises(ValueError):
                self.load(translation)

    def test_saved_pass_cannot_bypass_new_cross_language_questions(self):
        loaded = self.load(self.translation())
        with mock.patch.object(ip, "request_json") as model, self.assertRaisesRegex(ValueError, "blocker"):
            ip.reuse_passed_chinese_audit(self.topic, self.sources, "test", resume_audit=loaded, audit_path=self.destination)
        model.assert_not_called()
        self.assertFalse(self.destination.exists())

    def test_invalid_earlier_chinese_draft_does_not_break_current_article_link(self):
        self.audit["passed"] = False
        self.audit["attempts"][0]["article"] = {"body_html": None}
        loaded = self.load(self.translation())
        resumed = ip._resume_article_audit(loaded, self.topic, self.sources, "zh")
        self.assertEqual(resumed["attempts"][0]["article"], {"body_html": None})
        self.assertTrue(ip.has_pending_cross_language_feedback(resumed))

    def test_daily_dispatches_old_pass_to_revision_and_keeps_publication_gate(self):
        loaded = self.load(self.translation())
        folder = self.root / "downloaded"
        out = self.root / "blog"
        out.mkdir()
        (out / "posts.json").write_text("[]")
        with mock.patch.dict(os.environ, {"DEEPSEEK_API_KEY": "test"}), \
                mock.patch.object(daily.gb, "read_topics", return_value=[self.topic]), \
                mock.patch.object(daily, "select_next_topic", return_value=self.topic), \
                mock.patch.object(daily, "reread_research_pack", return_value=self.sources), \
                mock.patch.object(ip, "reuse_passed_chinese_audit") as reuse, \
                mock.patch.object(ip, "produce_article", return_value=self.article) as produce, \
                mock.patch.object(daily, "localize_reviewed_article", side_effect=RuntimeError("translation incomplete")), \
                mock.patch.object(daily, "write_indexes") as indexes:
            with self.assertRaisesRegex(RuntimeError, "translation incomplete"):
                daily.generate_daily_article(Path("unused.xlsx"), out, 2, False, resume_dir=folder)
        reuse.assert_not_called()
        self.assertEqual(produce.call_args.kwargs["resume_audit"], loaded)
        indexes.assert_not_called()

    def editorial(self, *, scope="source_article", status="resolved"):
        loaded = self.load(self.translation())
        fixes = ip._revision_feedback(loaded)["required_fixes"]
        candidate = {**self.article, "revision_response": [{"issue_id": fix["id"], "change": "已核对",
            "location": "表2", "verification": "本轮独立核对计算与来源边界"} for fix in fixes]}
        prompts = []

        def request(prompt, api_key, *, stage, **kwargs):
            self.assertIn(stage, ("zh-review", "zh-review-format-repair"))
            prompts.append(prompt)
            review = self.good_review()
            review["blocker_checks"] = [{"issue_id": fix["id"], "status": status if fix.get("origin_language") else "resolved",
                "scope": scope, "location": "表2", "finding": "独立核对当前中文、整数分母、摘要与来源边界后作出判断。"}
                for fix in fixes if fix["kind"] == "blocker"]
            return review

        with mock.patch.dict(os.environ, {"INSIGHT_RESUME_MAX_ATTEMPTS": "1"}), mock.patch.object(ip, "request_json", side_effect=request):
            if status != "resolved" or scope not in ("source_article", "translation_only"):
                with self.assertRaisesRegex(RuntimeError, "did not pass quality gates"):
                    ip.produce_article(self.topic, self.sources, "test", resume_audit=loaded,
                        editorial_revision=candidate, audit_path=self.destination)
            else:
                result = ip.produce_article(self.topic, self.sources, "test", resume_audit=loaded,
                    editorial_revision=candidate, audit_path=self.destination)
                self.assertEqual(result["quality"]["scores"], self.good_review()["scores"])
        saved = json.loads(self.destination.read_text())
        self.assertEqual(saved["attempts"][:-1], self.audit["attempts"])
        self.assertEqual(saved["cross_language_feedback"], loaded["cross_language_feedback"])
        return saved, prompts

    def test_authored_revision_receives_independent_checks_and_classifies_translation_only(self):
        for scope in ("source_article", "translation_only"):
            with self.subTest(scope=scope):
                saved, prompts = self.editorial(scope=scope)
                self.assertTrue(saved["passed"])
                self.assertEqual(len(prompts), 1)
                self.assertIn("1/50 cannot satisfy", prompts[0])
                self.assertIn("worthwhile", prompts[0])
                self.assertIn("整数计数和分母", prompts[0])
                self.assertFalse(ip.has_pending_cross_language_feedback(saved))
                ip.validate_passed_chinese_audit(saved, self.topic)
                altered = copy.deepcopy(saved)
                altered["attempts"][-1]["review"]["blocker_checks"] = self.good_review()["blocker_checks"]
                with self.assertRaisesRegex(ValueError, "blocker"):
                    ip.validate_passed_chinese_audit(altered, self.topic)

    def test_unresolved_or_unclassified_cross_language_question_cannot_pass(self):
        for scope, status in (("source_article", "unresolved"), ("source_article", "unverifiable"), (None, "resolved")):
            with self.subTest(scope=scope, status=status):
                saved, _ = self.editorial(scope=scope, status=status)
                self.assertFalse(saved["passed"])
                self.assertTrue(ip.has_pending_cross_language_feedback(saved))

    def test_nonfactual_translation_failure_does_not_force_chinese_revision(self):
        translation = self.translation()
        translation["attempts"][0]["review"]["blockers"] = []
        loaded = self.load(translation)
        self.assertFalse(ip.has_pending_cross_language_feedback(loaded))
        with mock.patch.object(ip, "request_json") as model:
            ip.reuse_passed_chinese_audit(self.topic, self.sources, "test", resume_audit=loaded, audit_path=self.destination)
        model.assert_not_called()

    def test_provider_failure_before_first_translation_draft_keeps_normal_resume(self):
        translation = self.translation()
        translation["attempts"] = []
        translation["error"] = "provider failed before first draft"
        loaded = self.load(translation)
        self.assertFalse(ip.has_pending_cross_language_feedback(loaded))
        with mock.patch.object(ip, "request_json") as model:
            ip.reuse_passed_chinese_audit(self.topic, self.sources, "test", resume_audit=loaded, audit_path=self.destination)
        model.assert_not_called()

    def test_new_translation_records_original_core_hash_before_model_calls(self):
        original = {**self.article, "quality": {"scores": "not part of article identity"}}
        with mock.patch.object(ip, "request_json", side_effect=RuntimeError("stop before draft")):
            with self.assertRaisesRegex(RuntimeError, "stop before draft"):
                ip.produce_article(self.topic, self.sources, "test", lang="en", original=original, audit_path=self.destination)
        saved = json.loads(self.destination.read_text())
        self.assertEqual(saved["source_article_sha256"], ip._article_sha256(self.article))


if __name__ == "__main__":
    unittest.main()
