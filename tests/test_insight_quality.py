"""Structural acceptance and rejection cases; semantic review remains separate."""
from __future__ import annotations

from copy import deepcopy
from pathlib import Path
import re
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from insight_quality import DRAFT_REQUIREMENTS, REVIEW_DIMENSIONS, REVIEW_RUBRIC, validate_insight


SOURCES = [
    {"id": "S1", "url": "https://research.example.com/study", "title": "Study"},
    {"id": "S2", "url": "https://official.example.org/documentation", "title": "Documentation"},
    {"id": "S3", "url": "https://research.example.com/method", "title": "Method"},
]


def valid_article() -> dict:
    # Programmatically large enough to test the structural gate. This is expressly
    # not a fixture for independent claims about editorial/semantic quality.
    seed = (
        "公开材料只能支持其实际展示的观察，分析需要区分平台能力和客户效果，"
        "并说明从内容可获取到进入候选集合再到用户采纳之间的条件。"
        "负责人应记录实验前的基线，控制渠道和产品组合的变化，比较具有相近"
        "需求但采用不同执行路径的业务组，识别季节性和销售活动等替代解释。"
        "如果新增内容并未改变可验证的决策指标，就应当审查假设和投入方向，"
        "不能把活动数量直接视为业务回报。"
    )
    sections = []
    for index, heading in enumerate(("核心判断", "证据边界", "传导机制", "业务取舍", "经济性测算", "执行与反证")):
        paragraphs = "".join(
            f"<p>{heading}的{chr(0x7532 + index * 3 + part)}项分析。{seed}{seed}</p>"
            for part in range(2)
        )
        sections.append(f"<section><h2>{heading}</h2>{paragraphs}</section>")
    tables = "".join(
        f"<table><caption>{caption}</caption><thead><tr><th>情景</th><th>决策条件</th></tr></thead>"
        "<tbody><tr><td>试点</td><td>证据充足则继续</td></tr>"
        "<tr><td>扩大</td><td>效果不足则调整</td></tr></tbody></table>"
        for caption in ("不同客户情景的资源取舍", "实施路径与检验方法")
    )
    citations = "".join(
        f'<p>给定来源界定了本文可以使用的证据范围。<a href="{source["url"]}" data-source-id="{source["id"]}">[{source["id"]}]</a></p>'
        for source in SOURCES
    )
    return {
        "title": "Eco-GEO：把资源投入与可验证决策相连接",
        "excerpt": "文章论证何种条件下的资源投入具有可检验价值，并明确不适用的场景。",
        "tags": ["GEO", "资源配置"],
        "body_html": (
            '<section data-role="executive-summary"><ul><li>明确适用条件。</li>'
            '<li>区分行为和效果。</li><li>把投入与停止条件连接。</li></ul></section>'
            + "".join(sections) + tables + citations
            + '<section data-role="assumptions"><p>本计算是示意假设。样本可能受季节性影响；'
            '若对照组具有相同增长，本解释不能成立。假设投入为1,200元，观察转化率为5%，'
            '测试期为30天。这里的输入不是外部统计值。</p></section>'
        ),
    }


def translated_article(source: dict, lang: str = "en") -> dict:
    result = deepcopy(source)
    replacement = "تحليل " if lang == "ar" else "Analysis "
    translated_segments = {}

    def replace_segment(match):
        segment = match.group()
        if segment not in translated_segments:
            sequence = len(translated_segments)
            translated_segments[segment] = replacement + chr(97 + sequence // 26) + chr(97 + sequence % 26) + " "
        return translated_segments[segment]

    for key in ("title", "excerpt", "body_html"):
        result[key] = re.sub(r"[\u3400-\u4dbf\u4e00-\u9fff]+", replace_segment, result[key])
    # Source paragraphs become intentionally terse in this structural fixture;
    # the independent reviewer is responsible for detecting real abridgement.
    return result


class InsightQualityTests(unittest.TestCase):
    def validate(self, article: dict, **kwargs) -> dict:
        with patch.dict("os.environ", {"INSIGHT_MIN_ZH_CHARS": "2600"}):
            return validate_insight(article, SOURCES, **kwargs)

    def assert_rejected(self, article: dict, reason: str, **kwargs) -> dict:
        result = self.validate(article, **kwargs)
        self.assertFalse(result["passed"], result)
        self.assertTrue(any(reason in error for error in result["errors"]), result["errors"])
        return result

    def test_structurally_valid_chinese_article_still_requires_semantic_review(self):
        result = self.validate(valid_article())
        self.assertTrue(result["passed"], result["errors"])
        self.assertGreaterEqual(result["metrics"]["zh_character_count"], 2600)
        self.assertEqual(result["metrics"]["tables_meeting_structure"], 2)
        self.assertEqual(result["metrics"]["unique_cited_sources"], 3)
        self.assertEqual(result["metrics"]["unique_cited_domains"], 2)
        self.assertTrue(result["metrics"]["semantic_review_required"])

    def test_short_article_rejected_without_fallback(self):
        article = valid_article()
        article["body_html"] = "<h2>简短意见</h2><p>开展试点，持续优化。</p>"
        before = deepcopy(article)
        self.assert_rejected(article, "Han characters")
        self.assertEqual(article, before)

    def test_minimum_is_configurable(self):
        with patch.dict("os.environ", {"INSIGHT_MIN_ZH_CHARS": "99999"}):
            result = validate_insight(valid_article(), SOURCES)
        self.assertFalse(result["passed"])
        self.assertEqual(result["metrics"]["minimum_zh_characters"], 99999)

    def test_bad_configuration_is_auditable_failure(self):
        with patch.dict("os.environ", {"INSIGHT_MIN_ZH_CHARS": "disabled"}):
            result = validate_insight(valid_article(), SOURCES)
        self.assertFalse(result["passed"])
        self.assertIn("INSIGHT_MIN_ZH_CHARS must be a positive integer.", result["errors"])

    def test_normalized_comma_separated_tags_are_accepted(self):
        article = valid_article()
        article["tags"] = ",".join(article["tags"])
        result = self.validate(article)
        self.assertTrue(result["passed"], result["errors"])

    def test_pipeline_normalization_preserves_structural_acceptance(self):
        from insight_pipeline import normalize_article

        article = normalize_article(valid_article(), "zh")
        self.assertIsInstance(article["tags"], str)
        result = self.validate(article)
        self.assertTrue(result["passed"], result["errors"])

    def test_role_markers_and_three_takeaways_required(self):
        for original, replacement, reason in (
            ('data-role="assumptions"', 'class="assumptions"', 'data-role="assumptions"'),
            ('data-role="executive-summary"', 'class="executive-summary"', 'data-role="executive-summary"'),
            ("<li>把投入与停止条件连接。</li>", "", "at least 3"),
        ):
            with self.subTest(reason=reason):
                article = valid_article()
                article["body_html"] = article["body_html"].replace(original, replacement)
                self.assert_rejected(article, reason)

    def test_h2_and_real_table_structure_required(self):
        for mutate, reason in (
            (lambda body: body.replace("<h2>核心判断</h2>", "<h3>核心判断</h3>"), "h2 sections"),
            (lambda body: body.replace("<caption>不同客户情景的资源取舍</caption>", ""), "Table 1 needs"),
            (lambda body: body.replace("<th>", "<td>").replace("</th>", "</td>"), "th headers"),
        ):
            with self.subTest(reason=reason):
                article = valid_article()
                article["body_html"] = mutate(article["body_html"])
                self.assert_rejected(article, reason)

    def test_citations_require_exact_source_url_and_id(self):
        for old, new, reason in (
            (SOURCES[0]["url"], "https://invented.example.net/study", "does not exactly match"),
            ('data-source-id="S1"', 'data-source-id="S9"', "unknown source"),
            ('data-source-id="S1"', "", "missing its data-source-id"),
            (">[S1]</a>", ">[S2]</a>", "visible label"),
        ):
            with self.subTest(reason=reason):
                article = valid_article()
                article["body_html"] = article["body_html"].replace(old, new)
                self.assert_rejected(article, reason)

    def test_same_domain_sources_are_not_independent_domains(self):
        article = valid_article()
        sources = deepcopy(SOURCES)
        replacement = "https://research.example.com/documentation"
        article["body_html"] = article["body_html"].replace(sources[1]["url"], replacement)
        sources[1]["url"] = replacement
        result = validate_insight(article, sources)
        self.assertFalse(result["passed"])
        self.assertEqual(result["metrics"]["unique_cited_domains"], 1)

    def test_unsafe_html_rejected(self):
        for unsafe in (
            "<script>alert(1)</script>", '<iframe src="https://example.com"></iframe>',
            '<p onclick="alert(1)">内容</p>', '<p style="display:none">隐藏内容</p>',
            '<a href="javascript:alert(1)">链接</a>', '<a href="java&#10;script:alert(1)">链接</a>',
            '<a href="data:text/html,unsafe">链接</a>', '<p hidden>隐藏内容</p>',
            '<svg><a href="https://example.com">嵌入</a></svg>',
        ):
            with self.subTest(unsafe=unsafe):
                article = valid_article()
                article["body_html"] += unsafe
                self.assert_rejected(article, "HTML contains")

    def test_broken_html_rejected(self):
        article = valid_article()
        article["body_html"] += "<p><strong>未闭合</p>"
        self.assert_rejected(article, "mismatched closing tag")

    def test_repeated_substantive_paragraph_rejected(self):
        article = valid_article()
        paragraph = re.search(r"<p>核心判断.*?</p>", article["body_html"]).group()
        article["body_html"] += paragraph
        result = self.assert_rejected(article, "repeats")
        self.assertEqual(result["metrics"]["duplicate_paragraph_count"], 1)

    def test_translation_preserves_structure_without_chinese_length_gate(self):
        source = valid_article()
        article = translated_article(source)
        result = self.validate(article, lang="en", source_article=source)
        self.assertTrue(result["passed"], result["errors"])
        self.assertEqual(result["metrics"]["zh_character_count"], 0)
        self.assertNotIn("minimum_zh_characters", result["metrics"])

    def test_arabic_digits_separators_and_percent_are_normalized(self):
        source = valid_article()
        article = translated_article(source, "ar")
        article["body_html"] = article["body_html"].replace("1,200", "١٬٢٠٠").replace("5%", "٥٪").replace("30", "٣٠")
        result = self.validate(article, lang="ar", source_article=source)
        self.assertTrue(result["passed"], result["errors"])

    def test_translation_requires_original(self):
        self.assert_rejected(translated_article(valid_article()), "requires source_article", lang="en")

    def test_translation_deleting_section_table_citation_or_marker_rejected(self):
        source = valid_article()
        mutations = (
            (lambda body: body.replace("<h2>", "<h3>", 1).replace("</h2>", "</h3>", 1), "source h2_count"),
            (lambda body: re.sub(r"<table>.*?</table>", "", body, count=1), "source table_count"),
            (lambda body: re.sub(r"(<td>.*?</td>)", r"\1<td>Extra</td>", body, count=1), "source table_shapes"),
            (lambda body: re.sub(r'<a[^>]*data-source-id="S1"[^>]*>.*?</a>', "", body), "source citation_id_counts"),
            (lambda body: body.replace('data-role="assumptions"', 'data-role="limitations"'), "source role_counts"),
        )
        for mutate, reason in mutations:
            with self.subTest(reason=reason):
                article = translated_article(source)
                article["body_html"] = mutate(article["body_html"])
                self.assert_rejected(article, reason, lang="en", source_article=source)

    def test_changed_or_added_translation_numbers_rejected(self):
        source = valid_article()
        for old, new in (("1,200", "1,500"), ("5%", "5"), ("30", ""), ("30", "30 to 60")):
            with self.subTest(new=new):
                article = translated_article(source)
                article["body_html"] = article["body_html"].replace(old, new)
                result = self.assert_rejected(article, "numeric values", lang="en", source_article=source)
                changes = result["metrics"]["translation"]["numeric_changes"]["body_html"]
                self.assertTrue(changes["missing"] or changes["added"])

    def test_magnitude_translation_preserves_value(self):
        source = valid_article()
        source["body_html"] += "<p>示意规模为120万元。</p>"
        article = translated_article(source)
        article["body_html"] = re.sub(r"120Analysis [a-z]+ ", "1.2 million ", article["body_html"])
        result = self.validate(article, lang="en", source_article=source)
        self.assertTrue(result["passed"], result["errors"])

    def test_invalid_article_or_sources_return_failure(self):
        for article, sources in ((None, SOURCES), ({}, SOURCES), (valid_article(), None), (valid_article(), [None])):
            with self.subTest(article_type=type(article), sources=sources):
                result = validate_insight(article, sources)
                self.assertFalse(result["passed"])
                self.assertIn("errors", result)

    def test_rubric_exposes_stable_dimensions_and_does_not_equate_format_with_quality(self):
        self.assertEqual(REVIEW_DIMENSIONS, ("thesis", "evidence", "mechanism", "tradeoffs", "actionability", "originality"))
        for dimension in REVIEW_DIMENSIONS:
            self.assertIn(dimension, REVIEW_RUBRIC)
        self.assertIn("25/30", REVIEW_RUBRIC)
        self.assertIn("blockers", REVIEW_RUBRIC)
        self.assertIn("不能替代实质审稿", DRAFT_REQUIREMENTS)


if __name__ == "__main__":
    unittest.main()
