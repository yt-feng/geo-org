"""Synthetic, offline fixtures: no third-party source bodies are persisted."""
import io
import json
import os
import sys
import tempfile
import unittest
import urllib.request
import xml.etree.ElementTree as ET
from email.message import Message
from pathlib import Path
from types import SimpleNamespace
from unittest import mock
from zipfile import ZipFile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import insight_research as research


class ResearchTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.env = mock.patch.dict(os.environ, {}, clear=True)
        self.env.start()
        self.addCleanup(self.env.stop)
        self.addCleanup(self.directory.cleanup)
        self.topic = SimpleNamespace(title="品牌 GEO 内容与证据", category="内容", keywords="GEO, 品牌", context={})

    def sources(self, count=3, same_domain=False):
        hosts = ["developers.google.com", "blogs.bing.com", "www.bcg.com"]
        sources = []
        for index in range(count):
            name = f"source-{index}.txt"
            (self.root / name).write_text((f"Synthetic body {index}: evidence and its methodology have stated boundaries. " * 40), encoding="utf-8")
            host = hosts[0] if same_domain else hosts[index % len(hosts)]
            sources.append({"url": f"https://{host}/article-{index}", "title": f"Article {index}", "tags": ["GEO", "内容"], "text_file": name})
        self.configure(sources)
        return sources

    def configure(self, sources):
        config = self.root / "sources.json"
        config.write_text(json.dumps({"sources": sources}), encoding="utf-8")
        os.environ["RESEARCH_SOURCE_FILE"] = str(config)

    def test_three_fixture_sources_have_metadata_and_exact_excerpt(self):
        self.sources()
        pack = research.build_research_pack(self.topic, [])
        self.assertEqual([item["id"] for item in pack], ["S1", "S2", "S3"])
        self.assertEqual(len({item["publisher_domain"] for item in pack}), 3)
        for item in pack:
            self.assertEqual(item["retrieval_method"], "local_fixture")
            self.assertEqual(item["excerpt_start"], 0)
            self.assertEqual(item["excerpt_end"], len(item["text"]))
            self.assertEqual(item["published"], "")
            self.assertEqual(len(item["text_sha256"]), 64)
            self.assertIn("+00:00", item["retrieved_at"])

    def test_excerpt_does_not_claim_unread_tail(self):
        self.sources()
        os.environ["RESEARCH_MAX_SOURCE_CHARS"] = "1000"
        pack = research.build_research_pack(self.topic, [])
        self.assertTrue(all(item["excerpt_truncated"] for item in pack))
        self.assertTrue(all(item["excerpt_end"] == 1000 < item["body_chars"] for item in pack))

    def test_sparse_research_fails_instead_of_using_rss_summary(self):
        self.sources(count=2)
        news = [{"title": "GEO content", "url": "https://news.google.com/rss/articles/example", "summary": "FAKE_EVIDENCE " * 1000}]
        with self.assertRaisesRegex(research.ResearchError, "Insufficient research"):
            research.build_research_pack(self.topic, news)

    def test_two_domain_minimum_is_enforced(self):
        self.sources(same_domain=True)
        with self.assertRaisesRegex(research.ResearchError, "1/2 publisher domains"):
            research.build_research_pack(self.topic, [])

    def test_unrelated_source_tags_are_not_used(self):
        sources = self.sources()
        sources[-1]["tags"] = ["astronomy", "火星"]
        self.configure(sources)
        with self.assertRaisesRegex(research.ResearchError, "2/3 source bodies"):
            research.build_research_pack(self.topic, [])

    def test_explicit_excel_industry_overrides_incidental_mentions_and_category(self):
        topic = SimpleNamespace(title="农业科技用户如何选择云服务", category="农业科技", keywords="GEO", context={"行业": "云计算"})
        self.assertEqual(research.topic_industries(topic), {"cloud_computing"})
        urls = [item["url"] for item in research._load_candidates(topic, [])]
        self.assertFalse(any("fao.org" in url or "oecd.org" in url or "usda.gov" in url for url in urls))
        topic.category, topic.context = "非农业科技", {}
        self.assertEqual(research.topic_industries(topic), set())

    def test_exact_industry_aliases_work_across_chinese_and_english(self):
        self.topic.context = {"行业": "农业科技"}
        self.assertEqual(research.topic_industries(self.topic), {"agriculture_technology"})
        sources = self.sources()
        sources[0]["industries"] = ["agri-tech"]
        (self.root / sources[0]["text_file"]).write_text("Agricultural technology and the measured adoption context. " * 40, encoding="utf-8")
        self.configure(sources)
        pack = research.build_research_pack(self.topic, [])
        scoped = [item for item in pack if item["evidence_role"] == "industry_context"]
        self.assertEqual(len(scoped), 1)
        self.assertEqual(scoped[0]["industries"], ["agriculture_technology"])
        general = next(item for item in pack if item["evidence_role"] == "general_context")
        self.assertIn("cannot establish", general["scope_notes"])

    def test_generic_sources_never_satisfy_explicit_industry_evidence(self):
        self.sources()
        self.topic.context = {"行业": "农业科技"}
        with self.assertRaisesRegex(research.ResearchError, "Missing industry evidence: agriculture_technology"):
            research.build_research_pack(self.topic, [])

    def test_late_industry_source_can_replace_generic_source_at_capacity(self):
        sources = self.sources(count=4)
        self.topic.context = {"行业": "农业科技"}
        os.environ["RESEARCH_MAX_SOURCES"] = "3"
        candidates = [{**source, "_fixture_path": str(self.root / source["text_file"]), "_matched_industries": []} for source in sources]
        candidates[-1]["_matched_industries"] = ["agriculture_technology"]
        (self.root / sources[-1]["text_file"]).write_text("Agricultural adoption conditions in the source population. " * 40, encoding="utf-8")
        with mock.patch.object(research, "_load_candidates", return_value=candidates):
            pack = research.build_research_pack(self.topic, [])
        self.assertEqual(len(pack), 3)
        self.assertTrue(any(item["evidence_role"] == "industry_context" for item in pack))
        self.assertGreaterEqual(len({item["publisher_domain"] for item in pack}), 2)

    def test_source_industry_tag_must_be_supported_in_the_read_body(self):
        self.topic.context = {"行业": "农业科技"}
        sources = self.sources()
        sources[0]["industries"] = ["农业科技"]
        self.configure(sources)
        with self.assertRaisesRegex(research.ResearchError, "does not contain the declared industry"):
            research.build_research_pack(self.topic, [])

    def test_industry_defaults_are_prioritized_after_platform_reference(self):
        self.topic.context = {"行业": "农业科技"}
        candidates = research._load_candidates(self.topic, [])
        self.assertEqual(candidates[0]["url"], research.DEFAULT_SOURCES[0]["url"])
        self.assertTrue(all(item["_matched_industries"] == ["agriculture_technology"] for item in candidates[1:4]))

    def test_new_industry_publisher_lead_matches_chinese_industry_without_geo_keyword(self):
        self.topic.context = {"行业": "农业科技"}
        url = "https://www.fao.org/newsroom/detail/agriculture-research/en"
        candidates = research._load_candidates(self.topic, [{"url": url, "title": "Agricultural technology adoption in small farms"}])
        lead = next(item for item in candidates if item["url"] == url)
        self.assertEqual(lead["_matched_industries"], ["agriculture_technology"])
        self.assertEqual(candidates[1]["url"], url)

    def test_next_ten_industries_have_bilingual_independent_search_and_specific_sources(self):
        industries = ["直播电商", "本地生活", "医美", "保险", "管理咨询", "美妆个护", "B2B外贸", "线下门店", "知识产权", "AI工具"]
        for industry in industries:
            with self.subTest(industry=industry):
                self.topic.context = {"行业": industry}
                self.topic.category = "阶段路线图"
                plan = research.industry_search_plan(self.topic)
                self.assertEqual(len(plan["industries"]), 1)
                self.assertEqual(len(plan["queries"]), 2)
                self.assertTrue(plan["terms"]["zh"])
                self.assertTrue(plan["terms"]["en"])
                self.assertTrue(all(domain in research.TRUSTED_HOSTS for domain in plan["domains"]))
                self.assertNotIn("阶段路线图", " ".join(plan["queries"]))
                self.assertNotIn("GEO", " ".join(plan["queries"]))
                candidates = research._load_candidates(self.topic, [])
                self.assertTrue(any(candidate.get("_matched_industries") == plan["industries"] for candidate in candidates))

    def test_all_sixty_actual_excel_industries_have_distinct_bilingual_official_search(self):
        ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
        workbook = Path(__file__).resolve().parents[1] / "assets" / "blog_articles.xlsx"
        with ZipFile(workbook) as archive:
            shared = ["".join(item.itertext()) for item in ET.fromstring(archive.read("xl/sharedStrings.xml"))] if "xl/sharedStrings.xml" in archive.namelist() else []
            rows = ET.fromstring(archive.read("xl/worksheets/sheet1.xml")).findall(".//m:row", ns)

            def values(row):
                result = {}
                for cell in row:
                    reference = cell.attrib.get("r", "")
                    column = "".join(char for char in reference if char.isalpha())
                    raw = cell.find("m:v", ns)
                    result[column] = (shared[int(raw.text)] if cell.attrib.get("t") == "s" else raw.text) if raw is not None else "".join(cell.itertext())
                return result

            industry_column = next(column for column, name in values(rows[0]).items() if name == "行业")
            industries = {values(row).get(industry_column, "") for row in rows[1:]} - {""}
        self.assertEqual(len(industries), 60)
        canonical = set()
        for industry in industries:
            with self.subTest(industry=industry):
                self.topic.context = {"行业": industry}
                self.topic.category = "阶段路线图"
                plan = research.industry_search_plan(self.topic)
                key, = plan["industries"]
                self.assertNotIn(key, canonical)
                canonical.add(key)
                self.assertIn(key, research.INDUSTRY_SEARCH_PROFILES)
                self.assertTrue(plan["terms"]["en"])
                self.assertTrue(all(any(char.isascii() and char.isalpha() for char in term) for term in plan["terms"]["en"]))
                self.assertTrue(all(research._industry_name(alias) == key for alias in research.INDUSTRY_ALIASES[key]))
                self.assertTrue(all(research._industry_name(term) == key for term in plan["terms"]["zh"] + plan["terms"]["en"]))
                self.assertIn(plan["terms"]["en"][0], plan["queries"][0])
                self.assertNotIn("GEO", " ".join(plan["queries"]))
                self.assertNotIn("阶段路线图", " ".join(plan["queries"]))
                self.assertTrue(all(domain in research.TRUSTED_HOSTS for domain in plan["domains"]))
                self.assertTrue(any(domain not in {"www.bcg.com", "arxiv.org"} for domain in plan["domains"]))
                body = f"This source studies {plan['terms']['en'][0]} in its stated market. " * 40
                self.assertIn(key, research._industry_mentions(body, {key}))
        self.assertEqual(len(canonical), 60)

    def test_adjacent_sectors_do_not_share_industry_identity_or_generic_matches(self):
        pairs = [("B2B外贸", "跨境电商"), ("招聘平台", "人力资源"), ("品牌咨询", "管理咨询"),
                 ("知识付费", "教育培训"), ("社群平台", "私域运营"), ("工业品", "制造业")]
        for first, second in pairs:
            with self.subTest(first=first, second=second):
                self.assertNotEqual(research._industry_name(first), research._industry_name(second))
        key = research._industry_name("B2B外贸")
        self.assertEqual(research._industry_mentions("Domestic B2B purchasing research.", {key}), set())
        self.assertEqual(research._industry_mentions("Cross-border ecommerce for retail consumers.", {key}), set())
        self.assertEqual(research._industry_mentions("B2B exports and overseas buyers.", {key}), {key})
        self.topic.context = {"行业": "B2B外贸"}
        plan = research.industry_search_plan(self.topic)
        self.assertTrue(all("B2B" in query for query in plan["queries"]))
        urls = {item["url"] for item in research._load_candidates(self.topic, [])}
        self.assertIn("https://www.trade.gov/european-b2b-ecommerce-markets-forecast", urls)
        self.assertNotIn("https://www.trade.gov/ecommerce-digital-strategy", urls)
        for industry in ("企业服务", "内容平台", "品牌咨询", "社群平台", "数据服务"):
            key = research._industry_name(industry)
            self.assertEqual(research._industry_mentions("Brands use platforms, services and data.", {key}), set())

    def test_no_industry_has_no_invented_industry_plan(self):
        plan = research.industry_search_plan(self.topic)
        self.assertEqual(plan["industries"], [])
        self.assertEqual(plan["queries"], [])
        self.assertEqual(plan["domains"], [])

    def test_unknown_industry_keeps_exact_name_without_borrowing_known_sector(self):
        self.topic.context = {"行业": "工业胶粘剂"}
        plan = research.industry_search_plan(self.topic)
        self.assertEqual(plan["industries"], ["工业胶粘剂"])
        self.assertTrue(all("工业胶粘剂" in query for query in plan["queries"]))
        self.assertNotIn("agriculture", " ".join(plan["queries"]))
        self.assertFalse(any(item.get("_matched_industries") for item in research._load_candidates(self.topic, [])))
        self.topic.context = {"industry": "Industrial Adhesives"}
        plan = research.industry_search_plan(self.topic)
        self.assertEqual(plan["industries"], ["Industrial Adhesives"])
        self.assertTrue(all('"Industrial Adhesives"' in query for query in plan["queries"]))
        self.assertEqual(research._industry_mentions("Industrial adhesives supplier evidence", {"Industrial Adhesives"}), {"Industrial Adhesives"})
        self.assertEqual(research._industry_mentions("Industrial products supplier evidence", {"Industrial Adhesives"}), set())

    def test_cosmetic_products_are_not_substituted_for_medical_aesthetic_procedures(self):
        self.topic.context = {"行业": "医美"}
        candidates = research._load_candidates(self.topic, [])
        self.assertTrue(any("dermal-fillers" in item["url"] for item in candidates))
        self.assertFalse(any("/cosmetics/" in item["url"] for item in candidates))

    def test_query_role_allows_retrieval_but_cannot_turn_unrelated_body_into_evidence(self):
        self.topic.context = {"行业": "保险"}
        lead = {"url": "https://www.iais.org/news/new-analysis", "title": "New analysis",
                "discovery_role": "industry_context", "industries": ["insurance"]}
        with mock.patch.object(research, "DEFAULT_SOURCES", []):
            candidates = research._load_candidates(self.topic, [lead])
            self.assertEqual(candidates[0]["_matched_industries"], ["insurance"])
            with mock.patch.object(research, "_fetch_source", return_value=("Unrelated agriculture data. " * 100, lead["url"], {}, "https_fetch")):
                with self.assertRaisesRegex(research.ResearchError, "does not contain the declared industry"):
                    research.build_research_pack(self.topic, [lead])

    def test_selected_report_passage_records_absolute_excerpt_offsets(self):
        sources = self.sources()
        prefix = "Introductory context. " * 100
        selected = "Scepticism among European farmers: " + "Evidence from the selected passage. " * 100
        (self.root / sources[0]["text_file"]).write_text(prefix + selected, encoding="utf-8")
        sources[0]["excerpt_anchor"] = "Scepticism among European farmers"
        self.configure(sources)
        os.environ["RESEARCH_MAX_SOURCE_CHARS"] = "1200"
        pack = research.build_research_pack(self.topic, [])
        chosen = next(item for item in pack if item["requested_url"] == sources[0]["url"])
        self.assertEqual(chosen["excerpt_start"], len(prefix))
        self.assertEqual(chosen["excerpt_end"], len(prefix) + 1200)
        self.assertTrue(chosen["text"].startswith("Scepticism among European farmers"))

    def test_missing_verified_report_anchor_fails_instead_of_reading_irrelevant_opening(self):
        sources = self.sources()
        sources[0]["excerpt_anchor"] = "A heading absent from this body"
        self.configure(sources)
        with self.assertRaisesRegex(research.ResearchError, "excerpt anchor was not found"):
            research.build_research_pack(self.topic, [])

    def test_fao_news_body_excludes_page_chrome(self):
        body = "Agricultural automation evidence and local conditions. " * 40
        text, _ = research.extract_body(f'<div>Menu irrelevant text</div><div class="news-detail__body">{body}</div><div>Other footer content</div>')
        self.assertEqual(text, body.strip())

    def test_body_theme_footer_class_does_not_hide_the_entire_article(self):
        body = "Insurance research source body with a clearly defined population. " * 30
        text, _ = research.extract_body(f'<body class="theme-default-footer-width"><article>{body}</article><footer>Remove this menu</footer></body>')
        self.assertEqual(text, body.strip())

    def test_minimum_cannot_be_silently_lowered(self):
        self.sources()
        os.environ["RESEARCH_MIN_SOURCES"] = "1"
        with self.assertRaisesRegex(research.ResearchError, "RESEARCH_MIN_SOURCES"):
            research.build_research_pack(self.topic, [])

    def test_duplicate_body_does_not_count_twice(self):
        sources = self.sources()
        sources[-1]["text_file"] = sources[0]["text_file"]
        self.configure(sources)
        with self.assertRaisesRegex(research.ResearchError, "2/3 source bodies"):
            research.build_research_pack(self.topic, [])

    def test_tracking_and_fragment_variants_are_deduplicated(self):
        sources = self.sources()
        sources[-1]["url"] = sources[0]["url"] + "?utm_source=feed#section"
        self.configure(sources)
        with self.assertRaisesRegex(research.ResearchError, "2/3 source bodies"):
            research.build_research_pack(self.topic, [])

    def test_short_article_body_rejected(self):
        sources = self.sources()
        (self.root / sources[0]["text_file"]).write_text("Only a headline and snippet.", encoding="utf-8")
        with self.assertRaisesRegex(research.ResearchError, "minimum 900"):
            research.build_research_pack(self.topic, [])

    def test_response_size_is_bounded_even_for_fixtures(self):
        sources = self.sources()
        (self.root / sources[0]["text_file"]).write_text("x" * 10001, encoding="utf-8")
        os.environ["RESEARCH_MAX_RESPONSE_BYTES"] = "10000"
        with self.assertRaisesRegex(research.ResearchError, "byte limit"):
            research.build_research_pack(self.topic, [])

    def test_private_and_untrusted_urls_are_rejected_before_fetch(self):
        forbidden = ["http://developers.google.com/a", "https://localhost/a", "https://127.0.0.1/a", "https://[::1]/a", "https://169.254.169.254/", "https://10.1.2.3/a", "https://developers.google.com.evil.test/a", "https://evil.test/a", "https://developers.google.com@127.0.0.1/a", "https://developers.google.com:8080/a", "https://user:pass@developers.google.com/a", "https://developers.google.com/\na"]
        for url in forbidden:
            with self.subTest(url=url), self.assertRaises(research.ResearchError):
                research.validate_source_url(url)

    def test_private_redirect_is_rejected_before_another_request(self):
        request = urllib.request.Request("https://developers.google.com/a")
        with self.assertRaises(research.ResearchError):
            research._SafeRedirect().redirect_request(request, None, 302, "Found", {}, "https://127.0.0.1/metadata")

    def test_paper_abstract_is_not_full_body_evidence(self):
        with self.assertRaisesRegex(research.ResearchError, "full-text"):
            research.validate_source_url("https://arxiv.org/abs/2311.09735")
        self.assertEqual(research.validate_source_url("https://arxiv.org/html/2311.09735v3"), "https://arxiv.org/html/2311.09735v3")

    def test_late_diverse_source_replaces_duplicate_publisher_at_capacity(self):
        sources = self.sources(count=5, same_domain=True)
        sources[0]["url"] = "https://www.bcg.com/unavailable"
        sources[0]["text_file"] = "missing.txt"
        sources[-1]["url"] = "https://www.bcg.com/available"
        self.configure(sources)
        os.environ["RESEARCH_MAX_SOURCES"] = "3"
        pack = research.build_research_pack(self.topic, [])
        self.assertEqual(len(pack), 3)
        self.assertEqual({item["publisher_domain"] for item in pack}, {"google.com", "bcg.com"})
        self.assertEqual([item["id"] for item in pack], ["S1", "S2", "S3"])

    def test_official_redirect_is_validated_and_supported(self):
        request = urllib.request.Request("https://www.bcg.com/old")
        result = research._SafeRedirect().redirect_request(request, None, 301, "Moved", {}, "https://www.bcg.com/new")
        self.assertEqual(result.full_url, "https://www.bcg.com/new")

    def test_html_extraction_uses_article_body_without_navigation(self):
        body = "A synthetic factual paragraph with scoped observations and methodology. " * 20
        document = f'''<html><head><title>Source title</title><meta property="article:published_time" content="2025-07-31"></head>
          <body><nav>BAD NAVIGATION</nav><main><div class="sidebar-navigation">BAD SIDEBAR</div>
          <article><h1>Article title</h1><div class="devsite-article-body"><p>{body}</p><p>Second paragraph <strong>remains.</strong></p>
          <script>BAD SCRIPT</script><style>BAD STYLE</style><span hidden>BAD HIDDEN</span></div>
          <aside>BAD RELATED</aside></article></main><footer>BAD FOOTER</footer></body></html>'''
        text, metadata = research.extract_body(document)
        self.assertIn(body.strip(), text)
        self.assertIn("Second paragraph remains.", text)
        self.assertNotIn("BAD", text)
        self.assertEqual(metadata["article:published_time"], "2025-07-31")
        self.assertEqual(metadata["title"], "Source title")

    def test_rss_aggregator_is_never_fetched_as_source(self):
        with mock.patch.object(research, "DEFAULT_SOURCES", []):
            items = [{"url": "https://news.google.com/rss/articles/example", "title": "GEO news", "summary": "Not evidence"}]
            self.assertEqual(research._load_candidates(self.topic, items), [])

    def test_current_original_publisher_lead_precedes_generic_background(self):
        candidates = research._load_candidates(self.topic, [
            {"url": "https://www.bcg.com/publications/2026/new-brand-content-insight", "title": "Brand Content and AI Search", "summary": "Never use this as evidence"},
        ])
        urls = [item["url"] for item in candidates]
        self.assertEqual(urls[0], research.DEFAULT_SOURCES[0]["url"])
        self.assertEqual(urls[1], "https://www.bcg.com/publications/2026/new-brand-content-insight")
        self.assertNotIn("summary", candidates[1])

    def test_unrelated_live_leads_are_ignored(self):
        candidates = research._load_candidates(self.topic, [
            {"url": "https://www.bcg.com/publications/2026/mining", "title": "Mining Productivity and Steel Demand"},
        ])
        self.assertNotIn("https://www.bcg.com/publications/2026/mining", [item["url"] for item in candidates])

    def test_http_fetch_checks_content_type_and_timeout(self):
        response = io.BytesIO(b"<article><p>Actual body</p></article>")
        response.headers = Message()
        response.headers["Content-Type"] = "text/html; charset=utf-8"
        response.status = 200
        response.geturl = lambda: "https://developers.google.com/article"
        opener = mock.Mock()
        opener.open.return_value = response
        with mock.patch.object(research.urllib.request, "build_opener", return_value=opener):
            body, url, _, method = research._fetch_source({"url": "https://developers.google.com/article"}, 10000, 7)
        self.assertEqual(body, "Actual body")
        self.assertEqual(method, "https_fetch")
        self.assertEqual(opener.open.call_args.kwargs["timeout"], 7)

    def test_pdf_is_not_misread_as_html(self):
        response = io.BytesIO(b"%PDF-1.7")
        response.headers = Message()
        response.headers["Content-Type"] = "application/pdf"
        response.status = 200
        response.geturl = lambda: "https://www.bcg.com/paper.pdf"
        opener = mock.Mock()
        opener.open.return_value = response
        with mock.patch.object(research.urllib.request, "build_opener", return_value=opener):
            with self.assertRaisesRegex(research.ResearchError, "content type"):
                research._fetch_source({"url": "https://www.bcg.com/paper.pdf"}, 10000, 7)


if __name__ == "__main__":
    unittest.main()
