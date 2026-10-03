"""Apply one reviewed, source-bound authored repair; never grant a review pass."""
from __future__ import annotations

import argparse
from copy import deepcopy
from fractions import Fraction
import hashlib
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from insight_decision_checks import expand_decision_case, validate_decision_checks

RECIPE = 'row710-exact-arithmetic-v1'
SOURCE_RUN = '37152742304'
BODY_SHA256 = '1ac0c4134bc26c4fcd72320973a1e394a60ec8964ea57d06b066f3ff6e63178d'
CHECKS_SHA256 = '12621d3d81e62891487211ff2372be3d0d790ed03f453d071c7993a8514acb97'
QUOTIENTS = {
    'unit_b_low_scenario': ('11.66666667', '35/3'),
    'unit_b_gain9_62': ('6.88888889', '62/9'),
    'unit_b_cost80_gain9': ('8.88888889', '80/9'),
}
TEXT_REPAIRS = (
    ('<td>1，落在第9条</td><td>3，按第5条排除B</td><td>6，按第5条排除B</td>',
     '<td>1，落在第9条</td><td>1，落在第7条</td><td>1，落在第6条</td>'),
    ('该表的E_B行低/基准/高三列为1、3、6，其中3与6都超过门槛2.5，直接落入第3条或第5条的范围；',
     '表2三列另设E_A=E_B=1，均在门槛2.5内，用于隔离成本与产出的敏感性；这不是原始基准的实测值。原始示意基准B的错误计数3仍超过门槛，必须先按第5条排除，不能只靠提高产出解除错误门槛；'),
    ('<strong>反转要逐项复核：固定其他变量、只改一个，再代回公式看阈值两侧与阈值处。</strong>',
     '<strong>以下反转例另设E_A=E_B=1个，均在门槛2.5内，并检查容量；原始示意基准B的3个错误仍须先排除。前三例固定其他变量、只改一个，组合情景则明确同时改两个，再代回完整顺序规则复核。</strong>'),
    ('产出门槛8个也满足', '低情境的产出门槛6个也满足'),
    ('<strong>反转四（只在基准情境内提高产出）：</strong>固定基准unit_a=7.5，只把ΔQ_B从5提到10、C_B从62提到70小时',
     '<strong>组合情景（基准情境同时提高产出与成本）：</strong>固定基准unit_a=7.5，同时把ΔQ_B从5提到10、C_B从62提到70小时'),
    ('E_B恰好等于上限计数2.5个时不被排除，B仍在门槛内。',
     'E_B恰好等于上限计数2.5个时不被排除，B仍在门槛内。这里2.5仅是连续数学边界测试，严重错误问题计数在实际25问样本中必须为整数：最多2个允许，3个及以上排除，不能把2.5个当作可观测样本结果。'),
    ('错误计数在门槛内、增量为正、单位增量工时更低，扩大该路径',
     '扩大前必须重跑完整顺序规则；A不可行而B可行时按第3条选B，双可行时只有ΔQ_B不低于ΔQ_A且B的单位增量工时严格更低才选B，单位成本相等或B增量更低但单位成本也更低时暂缓，其余可行情形保留A'),
    ('错误计数在门槛内且增量为正，扩大该路径',
     '错误计数在门槛内且增量为正，并由完整顺序规则判定保留A，才扩大该路径'),
    ('只有增量不低于A且单位增量工时严格更低时才扩大',
     'A不可行而B可行时按第3条选B；双可行时，只有增量不低于A且单位增量工时严格更低才扩大'),
    ('驱动反转的只有两个可观测变量：错误计数是否在门槛内，以及单位增量工时谁更低。',
     '反转必须同时核对错误计数、容量、正增量、ΔQ_B是否不低于ΔQ_A与单位增量工时；任何一个条件不能代替完整顺序规则。'),
    ('扩覆盖必须在同一口径下增量不低于A，且单位增量工时严格低于A；',
     '两条路径都可行时，扩覆盖必须在同一口径下增量不低于A，且单位增量工时严格低于A；A不可行而B可行则按第3条选B；'),
    ('此时A已通过前三步', '此时A已通过前四步'),
)


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                     separators=(',', ':')).encode()).hexdigest()


def authored_revision(audit):
    if (audit.get('version') != 'insights-v3' or audit.get('row') != 710
            or audit.get('language') != 'zh' or audit.get('passed') is not False):
        raise ValueError('Recipe requires the exact failed Chinese topic')
    attempt = audit['attempts'][-1]
    if attempt.get('revision') != 6:
        raise ValueError('Recipe requires saved authored revision 6')
    saved = attempt['article']
    body = saved['body_html']
    if hashlib.sha256(body.encode()).hexdigest() != BODY_SHA256 or digest(saved['decision_checks']) != CHECKS_SHA256:
        raise ValueError('Recipe source body or decision-check identity differs')
    article = deepcopy({key: saved[key] for key in
                        ('title', 'excerpt', 'body_html', 'tags', 'decision_checks') if key in saved})
    for old, new in TEXT_REPAIRS:
        count = article['body_html'].count(old)
        if count != 1:
            raise ValueError('Authored replacement requires one exact source passage')
        article['body_html'] = article['body_html'].replace(old, new)
    checks = article['decision_checks']
    calculations = {item['id']: item for item in checks['calculations']}
    for name, (old, new) in QUOTIENTS.items():
        if calculations[name]['expected'] != old:
            raise ValueError('Authored quotient source differs')
        calculations[name]['expected'] = new
    cases = {item['id']: item for item in checks['cases']}
    retained, redundant = cases['unit_a_low_threshold'], cases['b_gain8_cost70_low_scenario']
    first = expand_decision_case(retained, checks['models'])
    second = expand_decision_case(redundant, checks['models'])
    if (retained['model'] != redundant['model'] or retained['expected_choice'] != redundant['expected_choice']
            or {k: Fraction(v) for k, v in first['inputs'].items()} != {k: Fraction(v) for k, v in second['inputs'].items()}
            or first['rules'] != second['rules'] or first['derived'] != second['derived']):
        raise ValueError('Authored duplicate must have the identical model, inputs and conclusion')
    checks['cases'] = [item for item in checks['cases'] if item['id'] != redundant['id']]
    retained['quote'] = retained['quote'].replace('产出门槛8个也满足', '低情境的产出门槛6个也满足')
    c_budget = next(item for item in checks['budgets'] if item['id'] == 'c_hours')
    if (c_budget['shared'], c_budget['option_a'], c_budget['option_b']) != ('20', '28', '28'):
        raise ValueError('Authored single-path C budget source differs')
    c_budget.update(shared='0', option_a='28', option_b='0')
    # A zero second option registers the single C path. Its complete 28 already
    # includes the real 20-hour prerequisite; there is no duplicated shared cost.
    article['revision_response'] = [
        {'issue_id': f'r6-structure-{i}', 'change': change,
         'location': location, 'verification': verification}
        for i, change, location, verification in (
            (1, 'expected改为精确35/3，正文近似值保留', 'unit_b_low_scenario', '70/6=35/3'),
            (2, 'expected改为精确62/9，正文近似值保留', 'unit_b_gain9_62', '62/9保持精确商'),
            (3, 'expected改为精确80/9，正文近似值保留', 'unit_b_cost80_gain9', '80/9保持精确商'),
            (4, '实际删除重复case，保留全部不同输入与历史', 'unit_a_low_threshold', '相同模型、完整输入和结论仅保留一项'),
        )
    ]
    article['revision_response'].append({
        'issue_id': 'r3-issue-6', 'change': '表2三列明确采用E_A=E_B=1的示意隔离情景，原始B错误3保留；同步正文、门槛6、复合反转和完整规则',
        'location': '表2、反转例与执行路径',
        'verification': '三列分别走规则9/7/6；实际整数错误≤2允许、≥3排除；C单路径预算28+0−0=28',
    })
    result = validate_decision_checks(article, required=True)
    if not result['passed']:
        raise ValueError('Authored repair still fails exact checks: ' + json.dumps(result['errors'], ensure_ascii=False))
    return article


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--recipe', choices=[RECIPE], required=True)
    parser.add_argument('--source-run', choices=[SOURCE_RUN], required=True)
    parser.add_argument('--resume-root', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    options = parser.parse_args()
    audit = json.loads((options.resume_root / 'insights' / '00710-geo-012e1e51' / 'zh.json').read_text(encoding='utf-8'))
    article = authored_revision(audit)
    encoded = json.dumps(article, ensure_ascii=False, separators=(',', ':')).encode()
    if len(encoded) > 60_000:
        raise ValueError('Authored revision exceeds the existing 60 KB limit')
    options.out.write_bytes(encoded)
    print(f'Authored recipe prepared: row=710 revision=7 bytes={len(encoded)}; independent review remains required')


if __name__ == '__main__':
    main()
