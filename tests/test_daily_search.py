"""Offline tests for bounded daily industry discovery and publisher selection."""
import io
import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import generate_daily_blog as daily


INDUSTRY_PLAN = {
    "industries": ["agriculture_technology"],
    "terms": {"zh": ["农业科技"], "en": ["agricultural technology", "precision agriculture"]},
    "domains": ["www.fao.org", "www.oecd.org", "ers.usda.gov", "www.ers.usda.gov"],
    "queries": [
        "agricultural technology precision agriculture adoption costs evidence farmers official research",
        "农业科技 数字农业 采用 成本 信任 研究 官方",
    ],
    "source_role": "industry_context",
}
EMPTY_PLAN = {"industries": [], "terms": {"zh": [], "en": []}, "domains": [], "queries": [], "source_role": "industry_context"}


class DailySearchTests(unittest.TestCase):
    def setUp(self):
        clean_environment = patch.dict(os.environ, {}, clear=True)
        clean_environment.start()
        self.addCleanup(clean_environment.stop)
        self.topic = daily.gb.TopicRow(694, "农业科技在竞争加剧期如何配置预算", {"行业": "农业科技"}, "竞争加剧期", "GEO")

    def test_real_industry_plan_uses_industry_not_category_stage(self):
        plan = daily.tavily_search_plan(self.topic)
        self.assertEqual(len(plan), 3)
        self.assertEqual([entry["discovery_role"] for entry in plan], ["industry_context", "industry_context", "general_context"])
        for entry in plan[:2]:
            self.assertEqual(entry["industries"], ["agriculture_technology"])
            self.assertNotIn("竞争加剧期", entry["query"])
            self.assertIn("www.fao.org", entry["include_domains"])
            self.assertNotIn("developers.google.com", entry["include_domains"])
        self.assertIn("Google Bing", plan[2]["query"])

    def test_custom_queries_cannot_displace_industry_slots(self):
        with patch.object(daily, "industry_search_plan", return_value=INDUSTRY_PLAN), patch.dict(os.environ, {"TAVILY_QUERIES": "Custom platform query||Another custom query"}):
            plan = daily.tavily_search_plan(self.topic)
        self.assertEqual([entry["query"] for entry in plan[:2]], INDUSTRY_PLAN["queries"])
        self.assertEqual(plan[2]["query"], "Custom platform query")
        self.assertEqual(len(plan), 3)

    def test_smaller_budget_retains_an_industry_query(self):
        with patch.object(daily, "industry_search_plan", return_value=INDUSTRY_PLAN), patch.dict(os.environ, {"TAVILY_MAX_QUERIES": "1"}):
            plan = daily.tavily_search_plan(self.topic)
            self.assertEqual(daily.tavily_queries(self.topic), [plan[0]["query"]])
        self.assertEqual(len(plan), 1)
        self.assertEqual(plan[0]["discovery_role"], "industry_context")

    def test_generic_topic_keeps_three_general_queries(self):
        with patch.object(daily, "industry_search_plan", return_value=EMPTY_PLAN):
            plan = daily.tavily_search_plan(self.topic)
        self.assertEqual(len(plan), 3)
        self.assertTrue(all(entry["discovery_role"] == "general_context" for entry in plan))
        self.assertIn(self.topic.title, plan[1]["query"])

    def test_incomplete_industry_plan_cannot_silently_fall_back(self):
        for key in ("queries", "domains"):
            with self.subTest(key=key), patch.object(daily, "industry_search_plan", return_value={**INDUSTRY_PLAN, key: []}):
                with self.assertRaisesRegex(ValueError, "independent queries"):
                    daily.tavily_search_plan(self.topic)

    def test_query_budget_is_bounded_and_duplicates_removed(self):
        with patch.object(daily, "industry_search_plan", return_value=EMPTY_PLAN), patch.dict(os.environ, {"TAVILY_QUERIES": "same query||SAME QUERY||distinct query"}):
            self.assertEqual(daily.tavily_queries(self.topic), ["same query", "distinct query"])
        for value in ("0", "7"):
            with self.subTest(value=value), patch.object(daily, "industry_search_plan", return_value=INDUSTRY_PLAN), patch.dict(os.environ, {"TAVILY_MAX_QUERIES": value}):
                with self.assertRaisesRegex(ValueError, "between 1 and 6"):
                    daily.tavily_search_plan(self.topic)

    def test_requests_use_separate_domains_and_preserve_discovery_provenance(self):
        payloads = []

        def urlopen(request, timeout):
            payload = json.loads(request.data)
            payloads.append(payload)
            number = len(payloads)
            # A provider summary is a lead, not an evidence body. An unexpected
            # generated answer must never enter the source list.
            result = {"answer": "Unverified provider synthesis", "results": [
                {"title": f"Official agriculture research {number}", "url": f"https://www.fao.org/report-{number}", "content": "<p>Lead summary</p>", "raw_content": "Do not persist this source body"},
                {"title": "Duplicate result", "url": "https://www.fao.org/report-1", "content": "duplicate"},
            ]}
            self.assertEqual(timeout, 45)
            return io.BytesIO(json.dumps(result).encode())

        with patch.dict(os.environ, {"TAVILY_API_KEY": "test-value"}), patch.object(daily, "industry_search_plan", return_value=INDUSTRY_PLAN), patch.object(daily.urllib.request, "urlopen", side_effect=urlopen), patch.object(daily.time, "sleep"):
            leads = daily.fetch_tavily_market_items(self.topic)
        self.assertEqual(len(payloads), 3)
        self.assertEqual(len(leads), 3)
        for payload in payloads[:2]:
            self.assertEqual(payload["include_domains"], INDUSTRY_PLAN["domains"])
        self.assertIn("developers.google.com", payloads[2]["include_domains"])
        self.assertNotIn("www.fao.org", payloads[2]["include_domains"])
        self.assertTrue(all(payload["include_answer"] is False and payload["include_raw_content"] is False for payload in payloads))
        self.assertTrue(all(payload["max_results"] == 3 for payload in payloads))
        self.assertEqual(leads[0]["discovery_role"], "industry_context")
        self.assertEqual(leads[0]["industries"], ["agriculture_technology"])
        self.assertTrue(all(lead["kind"] == "market_source" and "text" not in lead and "raw_content" not in lead for lead in leads))
        self.assertNotIn("Unverified provider synthesis", json.dumps(leads))

    def test_disabling_tavily_makes_no_search_or_industry_lookup(self):
        for environment in ({}, {"TAVILY_API_KEY": "test-value", "TAVILY_CONTEXT_DISABLED": "true"}):
            with self.subTest(environment=environment), patch.dict(os.environ, environment, clear=True), patch.object(daily, "industry_search_plan") as planner, patch.object(daily.urllib.request, "urlopen") as request:
                self.assertEqual(daily.fetch_tavily_market_items(self.topic), [])
                planner.assert_not_called()
                request.assert_not_called()

    def test_industry_search_failure_does_not_fabricate_a_source(self):
        responses = [OSError("unavailable"), io.BytesIO(b'{"results": []}'), io.BytesIO(b'{"results": []}')]
        with patch.dict(os.environ, {"TAVILY_API_KEY": "test-value"}), patch.object(daily, "industry_search_plan", return_value=INDUSTRY_PLAN), patch.object(daily.urllib.request, "urlopen", side_effect=responses) as request, patch.object(daily.time, "sleep"):
            self.assertEqual(daily.fetch_tavily_market_items(self.topic), [])
        self.assertEqual(request.call_count, 3)


if __name__ == "__main__":
    unittest.main()
