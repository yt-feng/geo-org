"""Local translation invariants, distinct from editorial/style diagnostics.

Preserve source-authored formal expressions. Narrative numeric-token
counts are not equivalent to meaning: named months and written-out numbers can
be valid localization. This module does not claim to verify prose semantics.
"""
from collections import Counter
from decimal import Decimal
from html import unescape
import re
import unicodedata


# Whole expressions retain the relationship between variables and values. Do
# not independently mask financial amounts, scale words, units or predicates.
_ATOM = r'(?:[A-Za-z_\u0370-\u03ff][A-Za-z0-9_\u0370-\u03ff]*|[+\-−]?\d+(?:\.\d+)?)'
_OP = r'(?:<=|>=|==|!=|[=＝<>＜＞≤≥≠≈±×÷+−*/-])'
TECHNICAL_EXPRESSION = re.compile(rf'{_ATOM}(?:\s*{_OP}\s*{_ATOM})+')
SYMBOLIC_OPERATOR = re.compile(r'<=|>=|==|!=|[=＝<>＜＞≤≥≠≈±×÷]')
_TAG = re.compile(r'''<!--.*?-->|</?[A-Za-z](?:"[^"]*"|'[^']*'|[^'">])*>''', re.DOTALL)
_RESOURCE = re.compile(r'https?://[^\s<>"\']+|\[S\d+\]|__[A-Za-z0-9_]+?__')
PROTECTED_INLINE = re.compile(r'<(?P<name>code|pre)\b[^>]*>.*?</(?P=name)\s*>|<span\b[^>]*\blang=["\']zh(?:-[A-Za-z]+)?["\'][^>]*>.*?</span\s*>', re.I | re.S)


def is_technical_expression(value: str) -> bool:
    # Dates, prose ranges and ordinary A/B choices are not equations.
    compact = re.sub(r'\s+', '', canonical(value))
    if re.fullmatch(r'\d{4}[-/]\d{1,2}(?:[-/]\d{1,2})?', compact) or re.fullmatch(r'\d+(?:\.\d+)?-\d+(?:\.\d+)?', compact):
        return False
    return bool(re.search(r'\d|_|[=＝<>＜＞≤≥≠≈±×÷\u0370-\u03ff]', value))


def visible(text: str) -> str:
    return _RESOURCE.sub(' ', unescape(_TAG.sub(' ', text)))


def canonical(text: str) -> str:
    value = unicodedata.normalize('NFKC', text)
    value = ''.join(str(unicodedata.decimal(c)) if c.isdecimal() else c for c in value)
    return value.translate(str.maketrans({'−': '-', '×': '*', '÷': '/'})).replace('<=', '≤').replace('>=', '≥').replace('!=', '≠').replace('==', '=')


def expressions(text: str, *, allowed_identifiers=None) -> Counter:
    value = canonical(visible(text))
    # ISO/numeric calendar dates and two-endpoint prose ranges are not formulae.
    value = re.sub(r"(?<!\d)\d{4}[-/]\d{1,2}[-/]\d{1,2}(?!\d)", ' ', value)
    if allowed_identifiers is not None:
        value = re.sub(r"[A-Za-z_\u0370-\u03ff][A-Za-z0-9_\u0370-\u03ff]*",
                       lambda m: m.group() if m.group() in allowed_identifiers else ';', value)
    result = Counter()
    for match in TECHNICAL_EXPRESSION.finditer(value):
        expression = re.sub(r'\s+', '', match.group())
        if not is_technical_expression(expression) or re.fullmatch(r'\d+(?:\.\d+)?-\d+(?:\.\d+)?', expression):
            continue
        expression = re.sub(r'(?<![A-Za-z_\u0370-\u03ff])\d+(?:\.\d+)?',
                            lambda m: format(Decimal(m.group()).normalize(), 'f'), expression)
        result[expression] += 1
    return result


def missing_expressions(source: str, translated: str) -> Counter:
    expected = expressions(source)
    identifiers = set(re.findall(r'[A-Za-z_\u0370-\u03ff][A-Za-z0-9_\u0370-\u03ff]*', ' '.join(expected)))
    actual = expressions(translated, allowed_identifiers=identifiers)
    # Follow the source's formal notation. Ordinary target phrasing such as
    # "cost = ..." or "gain -1" is not a newly authored mathematical claim.
    return expected - actual


def operators(text: str) -> Counter:
    # Plain-text definitions may render '=' as "equals"/"تساوي". Equations with
    # named variables/numeric operands are already checked atomically above.
    return Counter(re.findall(r'[<>≤≥≠≈±]', canonical(visible(text))))


def notation_warnings(source: str, translated: str) -> list[str]:
    """Natural-language notation changes need review, not a false completion failure."""
    warnings = []
    if missing_expressions(source, translated):
        warnings.append('Translation uses different technical notation; prose equivalence is not automatically verified')
    if operators(source) - operators(translated):
        warnings.append('Translation expresses a mathematical operator differently; prose equivalence is not automatically verified')
    return warnings


def integrity_errors(source: str, translated: str, target: str, *, protected_terms=()) -> list[str]:
    """Hard local invariants only; ordinary wording still needs human review."""
    if target not in ('en', 'ar'):
        return []
    # Source-authored code or explicitly marked Chinese names/quotations remain
    # opaque. Never infer an exemption merely from a short Chinese text length.
    protected = [visible(match.group()) for match in PROTECTED_INLINE.finditer(source)] + list(protected_terms)
    source_text, target_text = visible(source), visible(translated)
    errors = []
    # Also reject unresolved decoder tokens in restored article checkpoints.
    # Masked decoder validation legitimately contains the same tokens on both
    # sides; a finished block must not introduce any that the source lacks.
    placeholder = r'__(?:HYMTPH|KC_PH)_[A-Za-z0-9_]+?__'
    if Counter(re.findall(placeholder, source)) != Counter(re.findall(placeholder, translated)):
        errors.append('Translation contains an unresolved or changed placeholder')
    for term in protected:
        if not term:
            continue
        if source_text.count(term) != target_text.count(term):
            errors.append('Translation changed protected source text')
        source_text, target_text = source_text.replace(term, ''), target_text.replace(term, '')
    if re.search(r'[\u3400-\u9fff]', target_text):
        errors.append('Translation retained Chinese source text')
    if re.search(r'[\u3400-\u9fff]', source_text):
        script = r'[A-Za-z]' if target == 'en' else r'[\u0600-\u06ff]'
        if not re.search(script, target_text):
            errors.append('Translation is missing the target language')
    return errors
