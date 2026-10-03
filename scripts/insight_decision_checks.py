"""Bounded exact arithmetic for authored decision checks; never a semantic pass.

No eval, code execution, calls, attributes, powers, or external I/O. The author
supplies assumptions; the independent reviewer still verifies their provenance,
coverage, and agreement with the visible article.
"""
from __future__ import annotations

import ast
from collections import Counter
from copy import deepcopy
import json
from fractions import Fraction
from html.parser import HTMLParser
import re


DECISION_CHECK_REQUIREMENTS = """中文新稿和续修稿必须另附紧凑的 decision_checks version=2（不放入HTML）。
所有关键算式、资源互斥假设、表格情景和交叉边界均须覆盖；每次重写同步更新，旧检查
不是本轮通过证明。quote逐字匹配当前可见正文至少12字符，不能引用无关原句充数。
JSON结构：{"version":2,
"models":{"comparison":{"inputs":{"a_cost":"40","b_cost":"48","a_gain":"6","b_gain":"4","capacity":"48"},
"derived":[{"name":"threshold","expression":"a_gain*b_cost/a_cost"}],
"rules":[{"when":"capacity<a_cost and capacity<b_cost","choice":"defer"},
{"when":"b_gain>threshold","choice":"B"},{"when":"b_gain==threshold","choice":"defer"},
{"when":"True","choice":"A"}]}},
"calculations":[{"id":"threshold","quote":"正文写明输入和结果的原句","inputs":{"cost":"48","rate":"0.15"},"expression":"cost*rate","expected":"7.2"}],
"budgets":[{"id":"hours","quote":"正文写明共同前置、完整成本与容量的原句","capacity":"48","shared":"12","option_a":"40","option_b":"48","exclusive":true}],
"cases":[{"id":"below","quote":"正文对应情景的输入和最终推荐原句","model":"comparison","inputs":{"b_gain":"7"},"expected_choice":"A"},
{"id":"above","quote":"正文另一情景的输入和最终推荐原句","model":"comparison","inputs":{"b_gain":"9"},"expected_choice":"B"}]}。
这只是协议示例，不是本文固定的模型或参数。models每个模型仅定义一次默认inputs、
derived和有序rules；每case引用model，inputs只写与默认值不同的覆盖值，禁止逐case
重复rules/derived。展开默认值后逐案复算，第一条真条件决定最终选择。不要输出冗余
缩进、重复默认输入、完整历史审稿原文。calculations至少1项；cases至少2项、最多40项，
针对不同真实情景；展开models默认inputs后完全相同的情景只能保留一项，即使ID不同，
不得用重复项充当新增边界覆盖。正文量化容量/机会成本时budgets必填。输入数值用十进制
字符串；calculations.expected必须为精确值，除法产生循环小数时写有界分数字符串，例如
35/3的expected为"35/3"，不能写11.7或11.66666667；正文可明确标注约11.7，但检查另保留
精确商。不要为了有限小数协议删掉真实的除法计算。允许
+ - * /、括号、比较、and/or/not、True/False，不支持调用/幂运算。derived按依赖顺序，
不能覆盖原始输入。示意预算option_a/b包含shared，联合成本=option_a+option_b-shared；
联合方案能放入容量时，不得仅凭预算宣称互斥。组织排他约束必须另说明，exclusive=false。
正文只定义一套完整有序规则，其他段落和表格引用该规则的适用范围；不要把某个分支
省略前序条件后又写成独立充分条件。覆盖相互作用：联合可行+错误越界、容量不足+错误
越界、联合可行+零/负增量等；新增分支须核对所有既有案例和摘要/两表/执行路径。
算术通过不代表假设真实、覆盖完整或正文推理正确；独立逐段来源及语义审稿仍须通过。
"""


class CheckError(ValueError):
    pass


class _Text(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []

    def handle_data(self, data):
        self.parts.append(data)


def _compact(text):
    return re.sub(r"\s+", "", text)


def _number(value):
    if isinstance(value, bool) or not isinstance(value, (str, int, float)):
        raise CheckError("numbers must be finite decimal values")
    raw = str(value)
    if not re.fullmatch(r"[+-]?\d{1,15}(?:\.\d{1,15})?", raw):
        raise CheckError("numbers must be bounded finite decimals")
    return Fraction(raw)


def _expected_number(value):
    """Expected quotients may be exact bounded fractions; inputs stay decimal."""
    if isinstance(value, str) and "/" in value:
        if not re.fullmatch(r"[+-]?\d{1,15}/[1-9]\d{0,14}", value):
            raise CheckError("expected fractions require bounded integers and a positive nonzero denominator")
        return Fraction(value)
    return _number(value)


def _display(value):
    if isinstance(value, bool):
        return value
    return str(value.numerator) if value.denominator == 1 else f"{value.numerator}/{value.denominator}"


def _bounded(value):
    if not isinstance(value, bool) and (value.numerator.bit_length() > 256 or value.denominator.bit_length() > 256):
        raise CheckError("intermediate number exceeds 256-bit limit")
    return value


def evaluate(expression, variables):
    if not isinstance(expression, str) or len(expression) > 500:
        raise CheckError("expression must be a string of at most 500 characters")
    try:
        tree = ast.parse(expression, mode="eval")
    except (SyntaxError, ValueError) as exc:
        raise CheckError("invalid expression syntax") from exc
    nodes = list(ast.walk(tree))
    if len(nodes) > 120:
        raise CheckError("expression is too complex")
    allowed = (ast.Expression, ast.Constant, ast.Name, ast.Load, ast.BinOp, ast.Add, ast.Sub,
               ast.Mult, ast.Div, ast.UnaryOp, ast.UAdd, ast.USub, ast.Not,
               ast.BoolOp, ast.And, ast.Or, ast.Compare, ast.Lt, ast.LtE, ast.Gt,
               ast.GtE, ast.Eq, ast.NotEq)
    if any(not isinstance(node, allowed) for node in nodes):
        raise CheckError("unsupported expression element, including in an unevaluated branch")

    def numeric(value):
        if isinstance(value, bool):
            raise CheckError("boolean used as a number")
        return value

    def boolean(value):
        if not isinstance(value, bool):
            raise CheckError("rule conditions must return booleans")
        return value

    def visit(node):
        if isinstance(node, ast.Constant):
            if isinstance(node.value, bool):
                return node.value
            return _number(ast.get_source_segment(expression, node))
        if isinstance(node, ast.Name):
            if node.id not in variables:
                raise CheckError(f"unknown variable {node.id}")
            return variables[node.id]
        if isinstance(node, ast.BinOp) and isinstance(node.op, (ast.Add, ast.Sub, ast.Mult, ast.Div)):
            left, right = numeric(visit(node.left)), numeric(visit(node.right))
            if isinstance(node.op, ast.Add):
                return _bounded(left + right)
            if isinstance(node.op, ast.Sub):
                return _bounded(left - right)
            if isinstance(node.op, ast.Mult):
                return _bounded(left * right)
            if right == 0:
                raise CheckError("division by zero")
            return _bounded(left / right)
        if isinstance(node, ast.UnaryOp):
            if isinstance(node.op, ast.Not):
                return not boolean(visit(node.operand))
            if isinstance(node.op, ast.UAdd):
                return numeric(visit(node.operand))
            if isinstance(node.op, ast.USub):
                return -numeric(visit(node.operand))
        if isinstance(node, ast.BoolOp) and isinstance(node.op, (ast.And, ast.Or)):
            for operand in node.values:
                result = boolean(visit(operand))
                if isinstance(node.op, ast.And) and not result:
                    return False
                if isinstance(node.op, ast.Or) and result:
                    return True
            return isinstance(node.op, ast.And)
        if isinstance(node, ast.Compare):
            left = numeric(visit(node.left))
            for op, other in zip(node.ops, node.comparators):
                right = numeric(visit(other))
                if isinstance(op, ast.Lt): result = left < right
                elif isinstance(op, ast.LtE): result = left <= right
                elif isinstance(op, ast.Gt): result = left > right
                elif isinstance(op, ast.GtE): result = left >= right
                elif isinstance(op, ast.Eq): result = left == right
                elif isinstance(op, ast.NotEq): result = left != right
                else: raise CheckError("unsupported comparison")
                if not result:
                    return False
                left = right
            return True
        raise CheckError(f"unsupported expression element {type(node).__name__}")

    return _bounded(visit(tree.body))


def _inputs(raw):
    if not isinstance(raw, dict) or len(raw) > 40:
        raise CheckError("inputs must be an object with at most 40 variables")
    if any(not isinstance(key, str) or not re.fullmatch(r"[a-zA-Z][a-zA-Z0-9_]{0,39}", key) for key in raw):
        raise CheckError("invalid input name")
    return {key: _number(value) for key, value in raw.items()}


def compact_decision_checks(checks):
    """Losslessly factor repeated v1 case programs; preserve every case and ID.

    Default values are selected only for inputs present in every case of the
    same program. Case overrides preserve the original raw numeric values.
    This representation change grants no acceptance and does not mutate audits.
    """
    result = deepcopy(checks)
    if not isinstance(checks, dict) or checks.get("version") not in (1, 2):
        raise CheckError("cannot compact an unknown decision-check protocol")
    if checks["version"] == 2:
        return result
    cases = checks.get("cases")
    if not isinstance(cases, list) or not 2 <= len(cases) <= 40:
        raise CheckError("cannot compact invalid case records")
    grouped = {}
    for case in cases:
        if (not isinstance(case, dict) or not isinstance(case.get("inputs"), dict)
                or not isinstance(case.get("rules"), list) or not isinstance(case.get("derived", []), list)
                or "model" in case):
            raise CheckError("cannot compact ambiguous case records")
        program = {"derived": case.get("derived", []), "rules": case["rules"]}
        key = json.dumps(program, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        grouped.setdefault(key, []).append(case)
    models, assignment = {}, {}
    for index, (key, group) in enumerate(grouped.items(), 1):
        name = f"model_{index}"
        common = set.intersection(*(set(case["inputs"]) for case in group))
        defaults = {}
        for variable in sorted(common):
            values = [case["inputs"][variable] for case in group]
            encoded = [json.dumps(value, ensure_ascii=False, sort_keys=True) for value in values]
            most_common = Counter(encoded).most_common(1)[0][0]
            defaults[variable] = json.loads(most_common)
        models[name] = {"inputs": defaults, **json.loads(key)}
        for case in group:
            assignment[id(case)] = name
    compact_cases = []
    for case in cases:
        name = assignment[id(case)]
        defaults = models[name]["inputs"]
        overrides = {key: value for key, value in case["inputs"].items()
                     if key not in defaults or type(value) is not type(defaults[key]) or value != defaults[key]}
        compact_cases.append({**{key: deepcopy(value) for key, value in case.items()
                                 if key not in ("inputs", "derived", "rules")},
                              "model": name, "inputs": overrides})
    result.update(version=2, models=models, cases=compact_cases)
    return result


def expand_decision_case(case, models):
    """Resolve the exact shared program and explicit per-case numeric overrides."""
    if "rules" in case or "derived" in case:
        raise CheckError("v2 cases must reference shared rules/derived, not override them")
    name = case.get("model")
    if not isinstance(name, str) or name not in models:
        raise CheckError("case must reference an existing shared model")
    model = models[name]
    if not isinstance(model, dict):
        raise CheckError("shared model must be an object")
    defaults, overrides = model.get("inputs"), case.get("inputs")
    _inputs(defaults)
    _inputs(overrides)
    return {**case, "inputs": {**defaults, **overrides},
            "derived": model.get("derived", []), "rules": model.get("rules")}


def validate_decision_checks(article, *, required=False):
    checks = article.get("decision_checks")
    if checks is None and not required:
        return {"passed": True, "errors": [], "status": "legacy_not_supplied"}
    errors, results = [], []
    if not isinstance(checks, dict) or type(checks.get("version")) is not int or checks["version"] not in (1, 2):
        return {"passed": False, "errors": ["decision_checks version 1 or 2 is required for every new Chinese draft"], "results": []}
    models = checks.get("models", {})
    if checks["version"] == 2:
        if (not isinstance(models, dict) or not 1 <= len(models) <= 40
                or any(not isinstance(name, str) or not re.fullmatch(r"[a-zA-Z][a-zA-Z0-9_]{0,39}", name) for name in models)):
            return {"passed": False, "errors": ["decision_checks.models requires 1..40 named shared models"], "results": []}
        used = {case.get("model") for case in checks.get("cases", [])
                if isinstance(case, dict) and isinstance(case.get("model"), str)} if isinstance(checks.get("cases"), list) else set()
        if set(models) != used:
            errors.append("decision_checks.models must all be referenced; no missing or unused models")
    parser = _Text()
    parser.feed(article.get("body_html", ""))
    body = _compact("".join(parser.parts))
    ids = set()
    scenario_inputs = set()
    # This is deliberately a narrow syntactic guard, not a claim to infer all
    # resource models from prose. The independent reviewer audits completeness.
    quantitative_capacity = re.search(r"(?:预算|容量)[^。！？\n]{0,20}\d|\d[^。！？\n]{0,10}(?:预算|容量)", body)
    if quantitative_capacity and not checks.get("budgets"):
        errors.append("decision_checks.budgets is required for quantified capacity in the current body")
    for group, minimum in (("calculations", 1), ("budgets", 0), ("cases", 2)):
        items = checks.get(group)
        if not isinstance(items, list) or not minimum <= len(items) <= 40:
            errors.append(f"decision_checks.{group} requires {minimum}..40 checks")
            continue
        for item in items:
            label = f"decision_checks.{group}"
            try:
                if not isinstance(item, dict):
                    raise CheckError("check must be an object")
                identifier = item.get("id")
                if not isinstance(identifier, str) or not identifier.strip() or len(identifier) > 80 or identifier in ids:
                    raise CheckError("id must be nonempty and unique")
                ids.add(identifier)
                label += f"[{identifier}]"
                quote = item.get("quote")
                if not isinstance(quote, str) or len(_compact(quote)) < 12 or _compact(quote) not in body:
                    raise CheckError("quote must match at least 12 characters of current visible body")
                if group == "calculations":
                    expression = item.get("expression")
                    value = evaluate(expression, _inputs(item.get("inputs")))
                    if not any(isinstance(node, ast.BinOp) for node in ast.walk(ast.parse(expression, mode="eval"))):
                        raise CheckError("calculation must recompute an arithmetic expression, not repeat a literal")
                    if isinstance(value, bool) or value != _expected_number(item.get("expected")):
                        raise CheckError(f"calculation mismatch: computed {_display(value)}, expected {item.get('expected')}")
                    results.append({"id": identifier, "computed": _display(value)})
                elif group == "budgets":
                    values = {key: _number(item.get(key)) for key in ("capacity", "shared", "option_a", "option_b")}
                    if min(values.values()) < 0 or values["shared"] > min(values["option_a"], values["option_b"]):
                        raise CheckError("costs must be nonnegative and shared cost included in each option")
                    if not isinstance(item.get("exclusive"), bool):
                        raise CheckError("exclusive must be boolean")
                    combined = values["option_a"] + values["option_b"] - values["shared"]
                    if item["exclusive"] and combined <= values["capacity"]:
                        raise CheckError(f"budget cannot imply exclusivity: combined {_display(combined)} <= capacity {_display(values['capacity'])}")
                    results.append({"id": identifier, "combined": _display(combined), "jointly_feasible": combined <= values["capacity"]})
                else:
                    if checks["version"] == 2:
                        item = expand_decision_case(item, models)
                    variables = _inputs(item.get("inputs"))
                    signature = tuple(sorted((key, str(value)) for key, value in variables.items()))
                    if signature in scenario_inputs:
                        raise CheckError("duplicate scenario inputs; cases must cover different scenarios")
                    scenario_inputs.add(signature)
                    derived = item.get("derived", [])
                    if not isinstance(derived, list) or len(derived) > 40:
                        raise CheckError("derived must be an ordered list of at most 40 formulas")
                    for formula in derived:
                        if not isinstance(formula, dict) or not re.fullmatch(r"[a-zA-Z][a-zA-Z0-9_]{0,39}", str(formula.get("name", ""))) or formula["name"] in variables:
                            raise CheckError("derived name must be valid and not overwrite an input")
                        variables[formula["name"]] = evaluate(formula.get("expression"), variables)
                    rules = item.get("rules")
                    if not isinstance(rules, list) or not 1 <= len(rules) <= 40:
                        raise CheckError("rules requires 1..40 ordered rules")
                    conditional = False
                    for rule_position, rule in enumerate(rules):
                        if isinstance(rule, dict) and isinstance(rule.get("when"), str):
                            if len(rule["when"]) > 500:
                                raise CheckError("rule expression exceeds 500 characters")
                            try:
                                nodes = list(ast.walk(ast.parse(rule["when"], mode="eval")))
                            except (SyntaxError, ValueError):
                                raise CheckError("invalid rule syntax")
                            if (rule_position < len(rules) - 1 and not any(isinstance(node, ast.Name) for node in nodes)
                                    and evaluate(rule["when"], variables) is True):
                                raise CheckError("an unconditional true rule is only allowed as the final fallback")
                            conditional |= any(isinstance(node, ast.Name) for node in nodes) and any(isinstance(node, ast.Compare) for node in nodes)
                    if not conditional:
                        raise CheckError("cases require an input-dependent comparison, not only constant rules")
                    chosen = None
                    for index, rule in enumerate(rules):
                        if not isinstance(rule, dict) or not isinstance(rule.get("choice"), str) or not rule["choice"].strip():
                            raise CheckError("every rule requires a choice")
                        condition = evaluate(rule.get("when"), variables)
                        if not isinstance(condition, bool):
                            raise CheckError("rule condition must be boolean")
                        if condition:
                            chosen = rule["choice"]
                            break
                    if chosen is None:
                        raise CheckError("no ordered rule covers this scenario")
                    if chosen != item.get("expected_choice"):
                        raise CheckError(f"ordered decision mismatch: computed {chosen}, expected {item.get('expected_choice')}")
                    results.append({"id": identifier, "chosen": chosen, "rule_index": index, "values": {key: _display(value) for key, value in variables.items()}})
            except (CheckError, TypeError, KeyError, RecursionError) as exc:
                errors.append(f"{label}: {exc}")
    return {"passed": not errors, "errors": errors, "results": results,
            "scope": "Exact arithmetic and submitted cases only; independent review must verify coverage, prose agreement and source support."}
