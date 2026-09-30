"""Small independent arithmetic fixture for pipeline integration tests."""
from copy import deepcopy


def with_decision_checks(article):
    article = deepcopy(article)
    quote = "示意计算：完整成本40与48，共同前置12，联合76，容量48；阈值6×48÷40=7.2。"
    article["body_html"] += f"<p>{quote}</p>"
    rules = [{"when": "b_gain > 7.2", "choice": "B"}, {"when": "True", "choice": "A"}]
    article["decision_checks"] = {"version": 1,
        "calculations": [{"id": "threshold", "quote": quote, "inputs": {"gain": "6", "a": "40", "b": "48"}, "expression": "gain * b / a", "expected": "7.2"}],
        "budgets": [{"id": "hours", "quote": quote, "capacity": "48", "option_a": "40", "option_b": "48", "shared": "12", "exclusive": True}],
        "cases": [{"id": name, "quote": quote, "inputs": {"b_gain": gain}, "rules": deepcopy(rules), "expected_choice": choice}
                  for name, gain, choice in (("below", "7", "A"), ("above", "9", "B"))]}
    return article


def coverage_review(article):
    finding = "独立核对本轮正文位置、原始输入与结果、共享成本和预算及有序规则边界，确认一致。"
    return {"verdict": "complete", "finding": finding, "missing_checks": [],
            "checks": [{"check_id": item["id"], "finding": finding}
                       for group in ("calculations", "budgets", "cases") for item in article["decision_checks"][group]]}
