import copy
import hashlib
import sys
from pathlib import Path
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'editorial'))
import apply_saved_revision as repair


def fixture():
    quote = '成本70小时低于阈值10×8=80小时，产出门槛8个也满足，改选B'
    fragments = [old for old, _ in repair.TEXT_REPAIRS if old != '产出门槛8个也满足']
    fragments.append(quote)
    calculations = []
    for name, left, right in (('unit_b_low_scenario', '70', '6'),
                              ('unit_b_gain9_62', '62', '9'),
                              ('unit_b_cost80_gain9', '80', '9')):
        text = f'此项示意完整成本为{left}小时，增量为{right}个，分别验证精确除法'
        fragments.append(text)
        calculations.append({'id': name, 'quote': text, 'inputs': {'cost': left, 'gain': right},
                             'expression': 'cost/gain', 'expected': repair.QUOTIENTS[name][0]})
    c_quote = '选项C完整成本含共同前置和监测，合计28小时'
    fragments.append(c_quote)
    model = {'inputs': {'a_gain': '6', 'b_gain': '8', 'b_cost': '70'},
             'derived': [], 'rules': [{'when': 'b_gain>=a_gain and b_cost*a_gain<60*b_gain', 'choice': 'B'},
                                      {'when': 'True', 'choice': 'A'}]}
    cases = [{'id': name, 'quote': quote, 'model': 'comparison', 'inputs': inputs, 'expected_choice': 'B'}
             for name, inputs in [('unit_a_low_threshold', {}),
                                  ('b_gain8_cost70_low_scenario', {'a_gain': '6'}),
                                  ('different_scenario', {'b_cost': '71'})]]
    cases[-1]['quote'] = '另一个真实输入情景中成本71小时，按同一比较规则选择B'
    fragments.append(cases[-1]['quote'])
    checks = {'version': 2, 'models': {'comparison': model}, 'calculations': calculations,
              'cases': cases, 'budgets': [{'id': 'c_hours', 'quote': c_quote,
                  'capacity': '80', 'shared': '20', 'option_a': '28', 'option_b': '28', 'exclusive': False}]}
    article = {'title': 'Synthetic authored regression', 'excerpt': 'Synthetic only',
               'body_html': '<p>' + '</p><p>'.join(fragments) + '</p>',
               'decision_checks': checks, 'quality': {'passed': True}}
    return {'version': 'insights-v3', 'row': 710, 'language': 'zh', 'passed': False,
            'attempts': [{'revision': 6, 'article': article, 'review': {'blockers': ['preserved original finding']}}]}


def pins(audit):
    article = audit['attempts'][-1]['article']
    return patch.multiple(repair, BODY_SHA256=hashlib.sha256(article['body_html'].encode()).hexdigest(),
                          CHECKS_SHA256=repair.digest(article['decision_checks']))


class SavedAuthoredRevisionTests(unittest.TestCase):
    def test_exact_math_distinct_cases_and_single_c_budget(self):
        audit = fixture()
        before = copy.deepcopy(audit)
        with pins(audit):
            article = repair.authored_revision(audit)
        self.assertEqual(audit, before)
        self.assertNotIn('quality', article)
        self.assertEqual([item['expected'] for item in article['decision_checks']['calculations']], ['35/3', '62/9', '80/9'])
        self.assertEqual(len(article['decision_checks']['cases']), 2)
        self.assertIn('different_scenario', [item['id'] for item in article['decision_checks']['cases']])
        result = repair.validate_decision_checks(article, required=True)
        self.assertTrue(result['passed'])
        self.assertEqual(next(item['combined'] for item in result['results'] if item['id'] == 'c_hours'), '28')

    def test_source_hash_rejects_body_and_metadata_changes(self):
        for field in ('body_html', 'decision_checks'):
            audit = fixture()
            with pins(audit):
                if field == 'body_html':
                    audit['attempts'][-1]['article'][field] += ' changed'
                else:
                    audit['attempts'][-1]['article'][field]['calculations'][0]['expected'] = 'wrong'
                with self.assertRaisesRegex(ValueError, 'identity differs'):
                    repair.authored_revision(audit)

    def test_wrong_topic_revision_or_claimed_pass_rejected(self):
        for key, value in (('row', 709), ('language', 'en'), ('passed', True)):
            audit = fixture()
            audit[key] = value
            with pins(audit), self.assertRaises(ValueError):
                repair.authored_revision(audit)
        audit = fixture()
        audit['attempts'][-1]['revision'] = 7
        with pins(audit), self.assertRaises(ValueError):
            repair.authored_revision(audit)

    def test_conflicting_case_is_never_dropped(self):
        for field, value in (('expected_choice', 'A'), ('inputs', {'b_cost': '69'})):
            audit = fixture()
            audit['attempts'][-1]['article']['decision_checks']['cases'][1][field] = value
            with pins(audit), self.assertRaisesRegex(ValueError, 'identical model'):
                repair.authored_revision(audit)

    def test_missing_or_repeated_authored_passage_rejected(self):
        for repeated in (False, True):
            audit = fixture()
            article = audit['attempts'][-1]['article']
            old = repair.TEXT_REPAIRS[0][0]
            article['body_html'] = article['body_html'] + old if repeated else article['body_html'].replace(old, '')
            with pins(audit), self.assertRaisesRegex(ValueError, 'one exact source passage'):
                repair.authored_revision(audit)

    def test_changed_quotient_or_c_budget_is_not_normalized(self):
        for group in ('calculations', 'budgets'):
            audit = fixture()
            checks = audit['attempts'][-1]['article']['decision_checks']
            checks[group][0]['expected' if group == 'calculations' else 'option_a'] = '999'
            with pins(audit), self.assertRaises(ValueError):
                repair.authored_revision(audit)

    def test_visible_assumptions_and_quotes_remain_synchronized(self):
        audit = fixture()
        with pins(audit):
            article = repair.authored_revision(audit)
        self.assertIn('三列另设E_A=E_B=1', article['body_html'])
        self.assertIn('最多2个允许，3个及以上排除', article['body_html'])
        self.assertIn('双可行时只有ΔQ_B不低于ΔQ_A', article['body_html'])
        self.assertIn('组合情景', article['body_html'])
        quote = article['decision_checks']['cases'][0]['quote']
        self.assertIn('低情境的产出门槛6个也满足', quote)
        self.assertIn(quote, article['body_html'])


if __name__ == '__main__':
    unittest.main()
