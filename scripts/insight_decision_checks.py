"""Bounded exact arithmetic for authored decision checks; never a semantic pass.

No eval, code execution, calls, attributes, powers, or external I/O. The author
supplies assumptions; the independent reviewer still verifies their provenance,
coverage, and agreement with the visible article.
"""
from __future__ import annotations

import ast
from fractions import Fraction
from html.parser import HTMLParser
import re


DECISION_CHECK_REQUIREMENTS = """中文新稿和续修稿必须另附 decision_checks（不放入HTML）。每次重写须同步重建，
旧检查不是本轮正确性证明。所有关键算式、资源互斥假设、表格情景和边界均须覆盖；
不要用无关算式或恒真规则充数。正文原句 quote 必须逐字匹配可见正文（至少12字符）。
JSON结构：{"version":1,"calculations":[{"id":"threshold","quote":"正文中写明输入和结果的原句",
"inputs":{"cost":"48","rate":"0.15"},"expression":"cost * rate","expected":"7.2"}],
"budgets":[{"id":"hours","quote":"正文中写明共同前置、完整成本与容量的原句",
"capacity":"48","shared":"12","option_a":"40","option_b":"48","exclusive":true}],
"cases":[{"id":"below","quote":"正文中该情景的输入和最终推荐原句",
"inputs":{"a_cost":"40","b_cost":"48","a_gain":"6","b_gain":"7","capacity":"48"},
"derived":[{"name":"threshold","expression":"a_gain * b_cost / a_cost"}],
"rules":[{"when":"capacity < a_cost and capacity < b_cost","choice":"defer"},
{"when":"b_gain > threshold","choice":"B"},{"when":"b_gain == threshold","choice":"defer"},
{"when":"True","choice":"A"}],"expected_choice":"A"}]}。
这是协议示例，不是本文的固定模型或参数。calculations至少1项，cases至少2项且分别绑定
不同真实情景；budgets在本文涉及容量/机会成本的量化比较时必填，否则可为空。
数值用十进制字符串；允许+ - * /、括号、比较、and/or/not及True/False，不支持调用/幂运算。
inputs只放原始输入，derived按依赖顺序计算；rules按先后顺序，第一条真条件决定最终选项。
覆盖阈值两侧、等号、零产出和预算边界。预算的option_a/b是包含shared的完整成本，
联合成本=option_a+option_b-shared。联合方案在容量内时不可声称仅由预算导致互斥；
若真实排他原因是组织约束，正文说明该独立约束并令exclusive=false，不伪造工时。
算术通过不代表假设真实、检查覆盖完整或正文推理正确，仍须独立逐段审稿。
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


def validate_decision_checks(article, *, required=False):
    checks = article.get("decision_checks")
    if checks is None and not required:
        return {"passed": True, "errors": [], "status": "legacy_not_supplied"}
    errors, results = [], []
    if not isinstance(checks, dict) or checks.get("version") != 1:
        return {"passed": False, "errors": ["decision_checks version 1 is required for every new Chinese draft"], "results": []}
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
                    if isinstance(value, bool) or value != _number(item.get("expected")):
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
