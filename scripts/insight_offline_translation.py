"""Translate authored insight text on an Actions CPU, preserving its HTML skeleton.

The model and runtime are pinned in hymt_translation_model_manifest.json. Every
accepted block is checkpointed immediately; invalid output never calls a paid
provider and never replaces the source. Content review remains a separate gate.
"""
from __future__ import annotations

from collections import Counter
import hashlib
from html import unescape
import json
from pathlib import Path
import re

from hymt_offline_translation import HyMTOfflineTranslator, OfflineTranslationError, PROTECTED_TERM_PATTERN, atomic_json
from insight_quality import _numbers

ADAPTER_VERSION = "insight-html-blocks-v1"
_TAG = re.compile(r'''<!--.*?-->|</?[A-Za-z](?:"[^"]*"|'[^']*'|[^'">])*>''', re.DOTALL)
_BLOCK = re.compile(r'</?(?:article|section|div|p|h[1-6]|ul|ol|li|blockquote|figure|figcaption|table|thead|tbody|tfoot|tr|td|th|caption|dl|dt|dd|hr)\b', re.I)
_URL = re.compile(r'https?://[^\s<>"\']+')
_TERM = re.compile(PROTECTED_TERM_PATTERN)


def digest(value: object) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                     separators=(",", ":")).encode()).hexdigest()


def html_parts(body: str) -> list[tuple[bool, str]]:
    """Keep whole inline sentences together; never send block tags to a model."""
    parts, pending, offset = [], [], 0
    for match in _TAG.finditer(body):
        pending.append(body[offset:match.start()])
        token = match.group()
        if _BLOCK.match(token) or token.startswith("<!--"):
            if pending:
                parts.append((True, "".join(pending)))
                pending = []
            parts.append((False, token))
        else:
            pending.append(token)
        offset = match.end()
    pending.append(body[offset:])
    if pending:
        parts.append((True, "".join(pending)))
    return parts


def validate_block(source: str, translated: str, target: str) -> None:
    if not isinstance(translated, str) or (source.strip() and not translated.strip()):
        raise OfflineTranslationError("Offline translation is empty")
    if _TAG.findall(source) != _TAG.findall(translated):
        raise OfflineTranslationError("Offline translation changed HTML tags, attributes, or their order")
    if Counter(_URL.findall(source)) != Counter(_URL.findall(translated)):
        raise OfflineTranslationError("Offline translation changed a URL")
    if Counter(_TERM.findall(source)) != Counter(_TERM.findall(translated)):
        raise OfflineTranslationError("Offline translation changed a protected term")
    if re.findall(r"\[S\d+\]", source) != re.findall(r"\[S\d+\]", translated):
        raise OfflineTranslationError("Offline translation changed citation labels or their order")
    clean_source, clean_result = (unescape(_TAG.sub(" ", text)) for text in (source, translated))
    operators = r"[=<>≤≥≠≈±×÷]"
    if Counter(re.findall(operators, clean_source)) != Counter(re.findall(operators, clean_result)):
        raise OfflineTranslationError("Offline translation changed comparison or formula operators")
    if _numbers(clean_source) != _numbers(clean_result):
        raise OfflineTranslationError("Offline translation changed numeric values within a text block")
    if re.search(r"[\u3400-\u9fff]", clean_result):
        raise OfflineTranslationError("Offline translation retained Chinese source text")
    if re.search(r"[\u3400-\u9fff]", clean_source):
        target_pattern = r"[A-Za-z]" if target == "en" else r"[\u0600-\u06ff]"
        if not re.search(target_pattern, clean_result):
            raise OfflineTranslationError("Offline translation is missing the target language")


def translate_article(original: dict, target: str, *, checkpoint_path: Path,
                      translator: HyMTOfflineTranslator | None = None) -> dict:
    if target not in ("en", "ar"):
        raise ValueError("Insight offline translation supports en and ar")
    source = {key: original[key] for key in ("title", "excerpt", "body_html", "tags")}
    if not all(isinstance(source[key], str) and source[key].strip()
               for key in ("title", "excerpt", "body_html")):
        raise ValueError("Offline translation requires the complete Chinese article")
    translator = translator or HyMTOfflineTranslator(cache_dir=checkpoint_path.parent / "offline-fragments")
    identity = {"version": ADAPTER_VERSION, "model": translator.model_id,
                "source_article_sha256": digest(source), "target_language": target}
    checkpoint = {**identity, "blocks": {}, "complete": False, "paid_provider_requests": 0}
    try:
        saved = json.loads(checkpoint_path.read_text(encoding="utf-8"))
        if all(saved.get(key) == value for key, value in identity.items()) and isinstance(saved.get("blocks"), dict):
            checkpoint = saved
    except (OSError, ValueError, TypeError):
        pass
    checkpoint["complete"] = False
    atomic_json(checkpoint_path, checkpoint)
    stats = {"translated_blocks": 0, "reused_blocks": 0}

    def translate_block(key: str, text: str) -> str:
        block_hash = digest(text)
        saved = checkpoint["blocks"].get(key, {})
        result = saved.get("translation")
        if saved.get("source_sha256") == block_hash and isinstance(result, str) and saved.get("translation_sha256") == digest(result):
            try:
                validate_block(text, result, target)
                stats["reused_blocks"] += 1
                return result
            except OfflineTranslationError:
                pass
        result = translator.translate(text, target, source="zh")
        validate_block(text, result, target)
        checkpoint["blocks"][key] = {"source_sha256": block_hash, "translation": result,
                                     "translation_sha256": digest(result)}
        atomic_json(checkpoint_path, checkpoint)
        stats["translated_blocks"] += 1
        return result

    result = {key: translate_block(key, source[key]) for key in ("title", "excerpt")}
    body = []
    for index, (translatable, text) in enumerate(html_parts(source["body_html"])):
        if translatable and _TAG.sub("", text).strip():
            body.append(translate_block(f"body_html.{index}", text))
        else:
            body.append(text)
    result["body_html"] = "".join(body)
    validate_block(source["body_html"], result["body_html"], target)
    tags = source["tags"]
    if isinstance(tags, str):
        result["tags"] = translate_block("tags", tags)
    elif isinstance(tags, list) and all(isinstance(tag, str) for tag in tags):
        result["tags"] = [translate_block(f"tags.{index}", tag) for index, tag in enumerate(tags)]
    else:
        raise ValueError("Offline translation requires string or string-array tags")
    checkpoint["complete"] = True
    checkpoint["article_sha256"] = digest(result)
    checkpoint["stats"] = stats
    atomic_json(checkpoint_path, checkpoint)
    result["translation_provenance"] = {**identity, **stats, "provider": "hymt-cpu",
                                        "paid_provider_requests": 0}
    return result
