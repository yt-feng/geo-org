import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import insight_pipeline as ip
from insight_quality import validate_insight
SOURCES = [{'id': f'S{i}', 'url': f'https://example.org/source-{i}', 'text': '实际读取的来源内容。'} for i in (1, 2)]

def article():
    sections = []
    for i, heading in enumerate(('说明问题', '实施方法', '检查结果')):
        paragraph = ''.join(f'{chr(0x7532+i)}项步骤{chr(0x4e10+j)}：根据资料说明做法及其适用条件，实际成效需要后续观察。' for j in range(12))
        sections.append(f'<section><h2>{heading}</h2><p>{paragraph}</p></section>')
    citations = ''.join(f'<p>来源范围<a href="{s["url"]}" data-source-id="{s["id"]}">[{s["id"]}]</a></p>' for s in SOURCES)
    return {'title': '如何核对内容是否便于搜索理解', 'excerpt': '说明可执行的内容检查方法及适用边界。', 'tags': ['SEO', 'GEO'], 'body_html': '<section data-role="executive-summary"><ul><li>确认内容清楚。</li><li>核对来源。</li></ul></section>' + ''.join(sections) + citations + '<section data-role="assumptions"><p>这里只提供检查建议，不保证业务效果。</p></section>'}

def review():
    return {'scores': {k: (3 if k == 'evidence' else 1) for k in ip.SCORE_KEYS}, 'issues': ['普通写法可更简洁'], 'blockers': [], 'claim_checks': [{'claim': f'当前第{i}项内容检查的适用范围说明', 'source_ids': [f'S{i+1}'] if i < 2 else [], 'verdict': 'supported' if i < 2 else 'inference', 'reason': '是明确标注的实施建议，不是外部统计事实。'} for i in range(5)]}

class PracticalProfileTests(unittest.TestCase):
    def test_short_article_without_tables_or_model_passes_practical(self):
        with patch.dict(os.environ, {}, clear=True):
            result = validate_insight(article(), SOURCES, profile='seo-practical')
            self.assertTrue(result['passed'], result['errors'])
            self.assertEqual(result['metrics']['h2_count'], 3)
            self.assertEqual(result['metrics']['table_count'], 0)
            self.assertFalse(validate_insight(article(), SOURCES)['passed'])

    def test_source_mismatch_and_unsafe_html_remain_blocking(self):
        for source, target in [('https://example.org/source-1', 'https://wrong.example/'), ('<p>来源范围', '<script>bad</script><p>来源范围')]:
            changed = article(); changed['body_html'] = changed['body_html'].replace(source, target)
            with patch.dict(os.environ, {}, clear=True):
                self.assertFalse(validate_insight(changed, SOURCES, profile='seo-practical')['passed'])

    def test_existing_decision_checks_still_validated(self):
        changed = article(); changed['decision_checks'] = {'broken': True}
        with patch.dict(os.environ, {}, clear=True):
            result = validate_insight(changed, SOURCES, profile='seo-practical')
        self.assertFalse(result['passed'])
        self.assertIn('decision_checks', result['metrics'])

    def test_style_scores_warn_but_evidence_and_blockers_fail(self):
        with patch.dict(os.environ, {'INSIGHT_QUALITY_PROFILE':'seo-practical'}, clear=True):
            value = review(); self.assertEqual(ip.review_errors(value), [])
            value['scores']['evidence'] = 2; self.assertTrue(ip.review_errors(value))
            value = review(); value['blockers'] = ['引用不支持核心事实']
            self.assertIn('引用不支持核心事实', ip.review_errors(value))
            value = review(); value['claim_checks'][0]['verdict'] = 'unsupported'
            self.assertTrue(ip._publication_blocking_errors(value, SOURCES, []))

    def test_review_prompt_uses_practical_contract(self):
        with patch.dict(os.environ, {'INSIGHT_QUALITY_PROFILE':'seo-practical'}, clear=True), patch.object(ip, 'request_json', return_value=review()) as request:
            result = ip.review_article(article(), SOURCES, 'unused', 'zh')
        prompt = request.call_args.args[0]
        self.assertIn('SEO/GEO实用文章', prompt)
        self.assertNotIn('至少两张表', prompt)
        self.assertNotIn('每项至少 4', prompt)
        self.assertEqual(result['scores']['originality'], 1)

    def test_production_path_accepts_short_fact_checked_draft_without_style_rewrite(self):
        with tempfile.TemporaryDirectory() as temporary, patch.dict(os.environ, {'INSIGHT_QUALITY_PROFILE':'seo-practical'}, clear=True), patch.object(ip, 'request_json', side_effect=[{'thesis':'实用说明'}, article(), review()]) as request:
            result = ip.produce_article(ip.gb.TopicRow(2, 'Example', {}, 'Brand', 'GEO'), SOURCES, 'unused', audit_path=Path(temporary)/'audit.json')
        self.assertEqual([c.kwargs['stage'] for c in request.call_args_list], ['research-brief', 'zh-draft-0', 'zh-review'])
        self.assertIn('300–500', request.call_args_list[0].args[0])
        self.assertIn('1200–2000', request.call_args_list[1].args[0])
        self.assertNotIn('3200–4800', request.call_args_list[1].args[0])
        self.assertNotIn('decision_checks', result)
        self.assertIn('普通写法可更简洁', result['quality']['warnings'])

    def test_unknown_profile_rejected(self):
        with patch.dict(os.environ, {'INSIGHT_QUALITY_PROFILE':'unknown'}, clear=True):
            with self.assertRaises(ValueError): ip.validate_insight(article(), SOURCES)

if __name__ == '__main__': unittest.main()
