"""Learn only real source receipts, then re-fetch before using them as evidence."""
import copy
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import insight_research as research
import research_source_catalog as catalog
from types import SimpleNamespace


class SourceCatalogTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.cache = self.root / "cache.json"
        self.seed = self.root / "seed.json"
        self.posts = self.root / "posts.json"
        self.env = mock.patch.dict(os.environ, {"RESEARCH_CATALOG_PATH": str(self.cache)}, clear=True)
        self.env.start()
        self.addCleanup(self.env.stop)
        for name, value in (("SEED_PATH", self.seed), ("POSTS_PATH", self.posts)):
            patch = mock.patch.object(catalog, name, value)
            patch.start()
            self.addCleanup(patch.stop)
        self.topic = SimpleNamespace(title="供应链 GEO", category="供应链", keywords="GEO", context={"行业": "供应链"})

    def receipt(self, url="https://www.oecd.org/verified-industry.pdf"):
        text = "Synthetic supply chain management research and industry evidence. " * 30
        return {"url": url, "title": "Synthetic supply chain management research", "publisher": "OECD",
                "publisher_domain": "oecd.org", "published": "2024-01-01", "retrieved_at": "2026-01-01T00:00:00+00:00",
                "retrieval_method": "https_pdf_text", "evidence_kind": "institutional_analysis",
                "evidence_role": "industry_context", "industries": ["supply_chain"],
                "scope_notes": "Synthetic bounded industry observation; no GEO return is established.",
                "text_sha256": hashlib.sha256(text.encode()).hexdigest(), "body_chars": len(text),
                "excerpt_start": 0, "excerpt_end": len(text), "excerpt_truncated": False}

    def save(self, path, records):
        path.write_text(json.dumps({"version": 1, "metadata_only": True, "sources": records}))

    def test_seed_posts_and_failed_run_cache_merge_without_promoting_ordinary_citations(self):
        first, second, third = [self.receipt(f"https://www.oecd.org/{name}.pdf") for name in ("seed", "published", "failed-run")]
        self.save(self.seed, [first])
        self.posts.write_text(json.dumps([{"sources": [second, {"url": "https://www.oecd.org/just-a-citation"}]},
                                        {"sources": None}, {"sources": "not receipts"}]))
        self.save(self.cache, [third, first])
        self.assertEqual({r["url"] for r in catalog.records()}, {first["url"], second["url"], third["url"]})
        self.assertTrue(all(set(r) <= set(catalog.FIELDS) for r in catalog.records()))

    def test_invalid_generated_untrusted_future_or_incomplete_receipts_are_never_candidates(self):
        mutations = [("retrieval_method", "generated"), ("retrieval_method", "local_fixture"),
                     ("url", "https://untrusted.example/source"), ("url", "http://www.oecd.org/source"),
                     ("retrieved_at", "2099-01-01T00:00:00+00:00"), ("retrieved_at", "2020-01-01"),
                     ("text_sha256", ""), ("scope_notes", ""), ("industries", []),
                     ("publisher", {}), ("published", {"text": "body"}), ("published", "2099-01-01"),
                     ("excerpt_start", -1), ("excerpt_end", 999999), ("excerpt_truncated", True),
                     ("publisher_domain", "google.com"), ("evidence_kind", "generated_analysis"),
                     ("evidence_role", "general_context"), ("text", "cached body is not new evidence")]
        for key, value in mutations:
            with self.subTest(field=key, value=value):
                receipt = self.receipt()
                receipt[key] = value
                self.save(self.cache, [receipt])
                self.assertEqual(catalog.candidates(), [])
        receipt = self.receipt()
        del receipt["text_sha256"]
        self.save(self.cache, [receipt])
        self.assertEqual(catalog.candidates(), [])

    def test_corrupt_cache_is_ignored_and_rebuilt_from_real_receipt_without_body(self):
        self.cache.write_text('{broken')
        receipt = self.receipt()
        catalog.remember({**receipt, "text": "RAW SOURCE MUST NOT BE PERSISTED", "_fixture_path": "/secret"})
        saved = self.cache.read_text()
        self.assertNotIn("RAW SOURCE", saved)
        self.assertNotIn("_fixture_path", saved)
        self.assertEqual(json.loads(saved)["sources"], [receipt])

    def test_success_before_overall_research_failure_is_kept_and_next_day_re_fetched(self):
        industry_url = self.receipt()["url"]
        live_lead = {"url": industry_url, "title": "Supply chain management evidence"}
        generic = [{"url": f"https://{host}/general", "title": "GEO evidence", "tags": ["GEO"]}
                   for host in ("developers.google.com", "blogs.bing.com")]
        fetched = []
        fail_generic = True
        fail_industry = False

        def fetch(source, *_):
            url = source["url"]
            fetched.append(url)
            if (url != industry_url and fail_generic) or (url == industry_url and fail_industry):
                raise research.ResearchError("HTTP Error 403")
            text = ("Synthetic supply chain management methodology. " if url == industry_url else f"Synthetic generic source {url}. ") * 40
            return text, url, {}, "https_pdf_text" if url == industry_url else "https_fetch"

        with mock.patch.object(research, "DEFAULT_SOURCES", generic), mock.patch.object(research, "_fetch_source", side_effect=fetch):
            with self.assertRaisesRegex(research.ResearchError, "Insufficient research"):
                research.build_research_pack(self.topic, [live_lead])
            saved = catalog.records()
            self.assertEqual([r["url"] for r in saved], [industry_url])
            self.assertNotIn("Synthetic supply chain management methodology", self.cache.read_text())
            fail_generic = False
            fetched.clear()
            recovered = research.build_research_pack(self.topic, [])  # Search no longer returns the source.
            self.assertIn(industry_url, fetched)
            self.assertIn(["supply_chain"], [r["industries"] for r in recovered])
            self.cache.unlink()
            audit = [{key: value for key, value in row.items() if key != "text"} for row in recovered]
            research.reread_research_pack(audit)
            self.assertIn(industry_url, [r["url"] for r in catalog.records()])
            fail_industry = True
            with self.assertRaisesRegex(research.ResearchError, "Missing industry evidence: supply_chain"):
                research.build_research_pack(self.topic, [])  # Stored receipt cannot replace a failed fresh read.

    def test_cached_industry_label_cannot_replace_actual_body_evidence(self):
        self.save(self.cache, [self.receipt()])
        with mock.patch.object(research, "DEFAULT_SOURCES", []), \
                mock.patch.object(research, "_fetch_source", return_value=("Unrelated farming discussion. " * 100,
                    self.receipt()["url"], {}, "https_fetch")):
            with self.assertRaisesRegex(research.ResearchError, "Missing industry evidence: supply_chain"):
                research.build_research_pack(self.topic, [])

    def test_historical_date_cannot_supply_missing_current_page_date(self):
        self.save(self.cache, [self.receipt()])
        candidate = catalog.candidates()[0]
        self.assertNotIn("published", candidate)
        published, note = research._publication_metadata({"publication_date_status": "absent"}, candidate)
        self.assertEqual(published, "")

    def test_explicit_source_file_retains_its_exclusive_scope(self):
        self.save(self.cache, [self.receipt()])
        config = self.root / "explicit.json"
        config.write_text('{"sources": []}')
        with mock.patch.dict(os.environ, {"RESEARCH_SOURCE_FILE": str(config)}):
            self.assertEqual(research._load_candidates(self.topic, []), [])

    def test_promote_preserves_seed_and_cache_then_survives_cache_loss(self):
        seed, new = self.receipt(), self.receipt("https://www.oecd.org/new.pdf")
        self.save(self.seed, [seed])
        self.save(self.cache, [new])
        catalog.promote()
        self.cache.unlink()
        self.assertEqual({r["url"] for r in catalog.records()}, {seed["url"], new["url"]})

    def test_late_generator_snapshot_cannot_hide_new_preflight_receipt(self):
        base = self.receipt()
        future = self.receipt("https://www.oecd.org/future-industry.pdf")
        today = self.receipt("https://www.oecd.org/today.pdf")
        preflight = self.root / "preflight.json"
        # Independent runners restored the same base. Preflight finishes first;
        # the slow generator finishes last with an older snapshot plus today.
        self.save(preflight, [base, future])
        self.save(self.cache, [base, today])
        with mock.patch.dict(os.environ, {"RESEARCH_CATALOG_PEER_PATH": str(preflight)}):
            self.assertEqual({r["url"] for r in catalog.records()},
                             {base["url"], future["url"], today["url"]})
            catalog.remember(today)
            catalog.promote()
        self.cache.unlink()
        preflight.unlink()
        self.assertEqual({r["url"] for r in catalog.records()},
                         {base["url"], future["url"], today["url"]})

    def test_atomic_write_failure_keeps_previous_receipts(self):
        self.save(self.cache, [self.receipt()])
        before = self.cache.read_bytes()
        with mock.patch.object(Path, "replace", side_effect=OSError("interrupted")):
            catalog.remember(self.receipt("https://www.oecd.org/new.pdf"))
        self.assertEqual(self.cache.read_bytes(), before)
        self.assertEqual(set(self.root.iterdir()), {self.cache})

    def test_byte_bound_prunes_old_metadata_and_preserves_newest_without_blocking(self):
        old, new = self.receipt(), self.receipt("https://www.oecd.org/new.pdf")
        old["scope_notes"] = "边界" * 300
        new["scope_notes"] = "Scope " * 500
        old["retrieved_at"] = "2025-01-01T00:00:00+00:00"
        self.save(self.seed, [old])
        with mock.patch.object(catalog, "MAX_CATALOG_BYTES", 5000):
            catalog.remember(new)
        self.assertLessEqual(self.cache.stat().st_size, 5000)
        self.assertEqual([r["url"] for r in json.loads(self.cache.read_text())["sources"]], [new["url"]])

    def test_same_url_independent_industries_and_utc_order_are_retained(self):
        older, newer = self.receipt(), self.receipt()
        older["retrieved_at"] = "2026-01-01T09:00:00+10:00"
        newer["retrieved_at"] = "2026-01-01T00:00:00+00:00"
        newer["title"] = "Newer true read"
        another_industry = self.receipt()
        another_industry["industries"] = ["gaming"]
        self.save(self.seed, [older, another_industry])
        self.save(self.cache, [newer])
        rows = catalog.records()
        self.assertEqual(len(rows), 2)
        self.assertEqual(next(r["title"] for r in rows if r["industries"] == ["supply_chain"]), "Newer true read")
        self.assertTrue(all(r["retrieved_at"].endswith("+00:00") for r in rows))
        candidates = catalog.candidates()
        self.assertEqual(len(candidates), 1)
        self.assertEqual(candidates[0]["industries"], ["gaming", "supply_chain"])
        self.assertEqual(candidates[0]["scope_notes"], self.receipt()["scope_notes"])

    def test_repeating_the_same_receipt_does_not_grow_or_change_catalog(self):
        catalog.remember(self.receipt())
        before = self.cache.read_bytes()
        for _ in range(3):
            catalog.remember(self.receipt())
        self.assertEqual(self.cache.read_bytes(), before)

    def test_new_daily_read_does_not_append_the_same_scope_boundary_again(self):
        receipt = self.receipt()
        receipt["industries"] = ["smart_hardware"]
        receipt["scope_notes"] += " Sector boundary: " + research.INDUSTRY_SCOPE_NOTES["smart_hardware"]
        self.save(self.cache, [receipt])
        topic = SimpleNamespace(title="智能硬件 GEO", category="智能硬件", keywords="GEO", context={"行业": "智能硬件"})
        generic = [{"url": f"https://{host}/general", "title": "GEO evidence", "tags": ["GEO"]}
                   for host in ("developers.google.com", "blogs.bing.com")]
        def fetch(source, *_):
            return (f"Synthetic smart devices source {source['url']}. " * 40,
                    source["url"], {}, "https_fetch")
        with mock.patch.object(research, "DEFAULT_SOURCES", generic), mock.patch.object(research, "_fetch_source", side_effect=fetch):
            for _ in range(3):
                pack = research.build_research_pack(topic, [])
                industry = next(r for r in pack if r["industries"])
                self.assertEqual(industry["scope_notes"], receipt["scope_notes"])

    def test_one_frequent_industry_cannot_displace_all_other_industries(self):
        rows = [self.receipt(f"https://www.oecd.org/supply-{i}.pdf") for i in range(12)]
        gaming = self.receipt("https://www.oecd.org/gaming.pdf")
        gaming["industries"] = ["gaming"]
        gaming["retrieved_at"] = "2025-01-01T00:00:00+00:00"
        self.save(self.cache, rows + [gaming])
        result = catalog.records()
        self.assertEqual(len(result), catalog.MAX_PER_INDUSTRY + 1)
        self.assertIn(gaming["url"], [r["url"] for r in result])

    def test_checked_seed_is_only_validated_metadata(self):
        seed = json.loads((Path(__file__).resolve().parents[1] / "scripts/research_source_catalog_seed.json").read_text())
        self.assertTrue(seed["metadata_only"])
        self.assertLessEqual(len(seed["sources"]), catalog.MAX_RECORDS)
        for entry in seed["sources"]:
            self.assertEqual(set(entry) - set(catalog.FIELDS), set())
            self.assertIsNotNone(catalog.validate_record(entry))


if __name__ == "__main__":
    unittest.main()
