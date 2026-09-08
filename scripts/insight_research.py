"""Fetch bounded, auditable source bodies for the daily insight pipeline.

Research text stays in memory. Never publish or commit this pack: publish source
metadata and the article's own analysis only. RSS text is never evidence.

RESEARCH_SOURCE_FILE: optional JSON list, or {"sources": [...]}, replacing the
curated catalogue. Each source has url, title, tags (topic-matching strings), and
optionally published and text_file (UTF-8 plain text/HTML fixture, relative to the
JSON file). A fixture is explicitly labelled local_fixture in the result.
RESEARCH_MIN_SOURCES / RESEARCH_MIN_DOMAINS: defaults 3 / 2, hard floors 3 / 2.
RESEARCH_MAX_SOURCES: default 5 (at most 8).
RESEARCH_MIN_BODY_CHARS: default 900 (at least 300).
RESEARCH_MAX_SOURCE_CHARS: default 10000 (at most 10000).
RESEARCH_FETCH_TIMEOUT: seconds per request, default 20 (maximum 45).
RESEARCH_MAX_RESPONSE_BYTES: default 2500000 (maximum 4000000).
"""
from __future__ import annotations

import hashlib
import ipaddress
import json
import os
import re
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Mapping, Sequence


# Exact hosts, not arbitrary subdomains. No DNS, proxy or host-state inspection.
TRUSTED_HOSTS = {
    "developers.google.com": ("google.com", "Google Search Central", "platform_documentation"),
    "support.google.com": ("google.com", "Google", "platform_documentation"),
    "blog.google": ("google.com", "Google", "platform_announcement"),
    "blogs.bing.com": ("bing.com", "Microsoft Bing", "platform_announcement"),
    "www.bing.com": ("bing.com", "Microsoft Bing", "platform_documentation"),
    "www.bcg.com": ("bcg.com", "BCG", "consulting_analysis"),
    "arxiv.org": ("arxiv.org", "arXiv authors", "research_paper"),
}

DEFAULT_SOURCES = [
    {
        "url": "https://developers.google.com/search/docs/appearance/ai-features",
        "title": "AI features and your website",
        "tags": ["geo", "AI搜索", "AI search", "seo", "引用", "索引", "可见度", "监测", "技术", "结构化"],
    },
    {
        "url": "https://developers.google.com/search/docs/fundamentals/creating-helpful-content",
        "title": "Creating helpful, reliable, people-first content",
        "tags": ["geo", "内容", "content", "证据", "信任", "权威", "质量", "原创", "品牌"],
    },
    {
        "url": "https://blogs.bing.com/search/April-2025/Introducing-Copilot-Search-in-Bing",
        "title": "Introducing Copilot Search in Bing",
        "tags": ["geo", "AI搜索", "AI search", "引用", "citation", "推荐", "品牌", "搜索"],
    },
    {
        "url": "https://www.bcg.com/x/the-multiplier/how-generative-engines-bring-web-to-you",
        "title": "Reimagining Discoverability: How Generative Engines Bring the Web to You",
        "tags": ["geo", "AI搜索", "AI search", "品牌", "营销", "战略", "增长", "预算", "转化", "衡量"],
    },
    {
        "url": "https://www.bing.com/webmasters/help/bing-webmaster-guidelines-30fba23a",
        "title": "Bing Webmaster Guidelines",
        "tags": ["geo", "seo", "技术", "抓取", "索引", "引用", "内容", "质量"],
    },
    {
        "url": "https://www.bcg.com/publications/2025/how-cmos-scaling-gen-ai-in-turbulent-times",
        "title": "How CMOs Are Scaling GenAI in Turbulent Times",
        "tags": ["营销", "cmo", "roi", "组织", "团队", "预算", "投资", "运营", "衡量", "规模"],
    },
    {
        "url": "https://www.bcg.com/publications/2026/making-the-agentic-marketing-transformation-a-reality",
        "title": "Making the Agentic Marketing Transformation a Reality",
        "tags": ["营销", "marketing", "cmo", "组织", "团队", "运营", "转型", "增长", "品牌", "agentic", "智能体"],
    },
    {
        "url": "https://www.bcg.com/publications/2026/agentic-scenarios-every-marketer-must-prepare-for",
        "title": "Agentic Scenarios Every Marketer Must Prepare For",
        "tags": ["营销", "marketing", "品牌", "战略", "情景", "规划", "预算", "投资", "转化", "agentic", "智能体"],
    },
]

TOPIC_CONCEPTS = [
    ("geo", "generative engine", "aeo", "answer engine"),
    ("AI搜索", "AI search", "generative search", "copilot search"),
    ("品牌", "brand"), ("营销", "marketing", "cmo"),
    ("内容", "content"), ("引用", "citation", "cited"),
    ("信任", "trust", "权威", "authority"),
    ("监测", "衡量", "指标", "measurement", "performance", "analytics"),
    ("预算", "投资", "budget", "investment", "roi"),
    ("增长", "growth"), ("转化", "conversion"),
    ("组织", "团队", "运营", "operating model", "organization"),
    ("智能体", "agentic", "agents"),
    ("结构化", "structured data"), ("抓取", "索引", "crawl", "indexing"),
]


class ResearchError(RuntimeError):
    """The source pack cannot meet its evidence requirements."""


def _integer(name: str, default: int, low: int, high: int) -> int:
    try:
        value = int(os.environ.get(name, str(default)))
    except ValueError as exc:
        raise ResearchError(f"{name} must be an integer") from exc
    if not low <= value <= high:
        raise ResearchError(f"{name} must be between {low} and {high}")
    return value


def validate_source_url(url: str) -> str:
    """Accept only HTTPS on curated public publisher hosts, including redirects."""
    if not isinstance(url, str) or any(ord(ch) < 32 or ch.isspace() for ch in url):
        raise ResearchError("Source URL contains whitespace or control characters")
    try:
        parsed = urllib.parse.urlsplit(url)
        hostname = parsed.hostname or ""
        if parsed.scheme != "https" or parsed.username or parsed.password or parsed.port not in (None, 443):
            raise ResearchError("Source URLs must be HTTPS without credentials or custom ports")
        try:
            ipaddress.ip_address(hostname)
        except ValueError:
            pass
        else:
            raise ResearchError("IP address source URLs are not allowed")
        if hostname not in TRUSTED_HOSTS:
            raise ResearchError(f"Source host is not in the publisher allowlist: {hostname}")
        if hostname == "arxiv.org" and not parsed.path.startswith("/html/"):
            raise ResearchError("Research papers require an arXiv HTML full-text URL, not an abstract or PDF")
        # Tracking variants should not count as separate sources.
        query = urllib.parse.urlencode([
            (key, val) for key, val in urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
            if not key.lower().startswith("utm_") and key.lower() not in {"gclid", "fbclid", "recommendedarticles"}
        ])
        return urllib.parse.urlunsplit(("https", hostname, parsed.path or "/", query, ""))
    except ValueError as exc:
        raise ResearchError("Malformed source URL") from exc


class _SafeRedirect(urllib.request.HTTPRedirectHandler):
    max_redirections = 5
    max_repeats = 2

    def redirect_request(self, req: Any, fp: Any, code: int, msg: str, headers: Any, newurl: str) -> Any:
        safe_url = validate_source_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, safe_url)


class _BodyParser(HTMLParser):
    """Prefer semantic article body containers; remove navigation and hidden UI."""

    VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}
    BLOCK = {"p", "div", "li", "section", "article", "main", "h1", "h2", "h3", "h4", "tr", "blockquote", "br"}
    SKIP = {"script", "style", "noscript", "nav", "footer", "aside", "form", "button", "svg", "template", "iframe"}
    UI = re.compile(r"(?:^|[\s_-])(?:nav(?:igation)?|footer|cookie|breadcrumb|subscribe|newsletter|share-tools|related-content|related-articles)(?:$|[\s_-])", re.I)

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.stack: list[tuple[str, bool, int | None]] = []
        self.candidates: list[dict[str, Any]] = []
        self.fallback: list[str] = []
        self.title: list[str] = []
        self.meta: dict[str, str] = {}

    def _append(self, text: str) -> None:
        if any(frame[1] for frame in self.stack):
            return
        if any(frame[0] == "title" for frame in self.stack):
            self.title.append(text)
            return
        if any(frame[0] == "head" for frame in self.stack):
            return
        self.fallback.append(text)
        for _, _, index in self.stack:
            if index is not None:
                self.candidates[index]["parts"].append(text)

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        if tag == "meta":
            key = attributes.get("property") or attributes.get("name") or attributes.get("itemprop")
            value = attributes.get("content")
            if key and value:
                self.meta[key.lower()] = value.strip()
        marker = f"{attributes.get('class') or ''} {attributes.get('id') or ''}"
        skip = (tag in self.SKIP or bool(self.UI.search(marker)) or "hidden" in attributes
                or attributes.get("aria-hidden", "").lower() == "true"
                or bool(re.search(r"display\s*:\s*none|visibility\s*:\s*hidden", attributes.get("style") or "", re.I)))
        inherited_skip = skip or any(frame[1] for frame in self.stack)
        if tag in self.BLOCK:
            self._append("\n")
        index = None
        if not inherited_skip:
            body_marker = bool(re.search(r"article[-_ ]?(?:body|content)|post[-_ ]?(?:body|content)|devsite-article-body|richtextbody", marker, re.I))
            priority = 3 if body_marker or attributes.get("itemprop") == "articleBody" else 2 if tag == "article" else 1 if tag == "main" or attributes.get("role") == "main" else 0
            if priority:
                index = len(self.candidates)
                self.candidates.append({"priority": priority, "parts": []})
        if tag not in self.VOID:
            self.stack.append((tag, inherited_skip, index))

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.handle_starttag(tag, attrs)
        if tag not in self.VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag: str) -> None:
        if tag in self.BLOCK:
            self._append("\n")
        for index in range(len(self.stack) - 1, -1, -1):
            if self.stack[index][0] == tag:
                del self.stack[index:]
                break

    def handle_data(self, data: str) -> None:
        self._append(data)

    @staticmethod
    def normalize(parts: Sequence[str]) -> str:
        lines = [re.sub(r"\s+", " ", line).strip() for line in "".join(parts).splitlines()]
        return "\n".join(line for line in lines if line)

    def body(self) -> str:
        candidates = [(item["priority"], self.normalize(item["parts"])) for item in self.candidates]
        substantial = [(priority, body) for priority, body in candidates if len(body) >= 300]
        if substantial:
            return max(substantial, key=lambda item: (item[0], len(item[1])))[1]
        # Some official blogs have no semantic main/article containers.
        return self.normalize(self.fallback)


def extract_body(document: str) -> tuple[str, dict[str, str]]:
    parser = _BodyParser()
    parser.feed(document)
    parser.close()
    metadata = dict(parser.meta)
    metadata["title"] = metadata.get("og:title") or " ".join(parser.title).strip()
    return parser.body(), metadata


def _fetch_source(source: Mapping[str, Any], max_bytes: int, timeout: int) -> tuple[str, str, dict[str, str], str]:
    url = validate_source_url(str(source.get("url", "")))
    if source.get("_fixture_path"):
        fixture = Path(source["_fixture_path"])
        with fixture.open("rb") as file:
            raw = file.read(max_bytes + 1)
        content_type = "text/html" if fixture.suffix.lower() in {".html", ".htm"} else "text/plain"
        charset, method = "utf-8", "local_fixture"
    else:
        request = urllib.request.Request(url, headers={
            "User-Agent": "Eco-GEO-EditorialBot/2.0 (+https://eco-geo.org/)",
            "Accept": "text/html,application/xhtml+xml,text/plain;q=0.8",
            "Accept-Encoding": "identity",
        })
        opener = urllib.request.build_opener(_SafeRedirect())
        with opener.open(request, timeout=timeout) as response:
            url = validate_source_url(response.geturl())
            if getattr(response, "status", 200) != 200:
                raise ResearchError(f"Source returned status {response.status}")
            content_type = response.headers.get_content_type()
            if content_type not in {"text/html", "application/xhtml+xml", "text/plain"}:
                raise ResearchError(f"Unsupported source content type: {content_type}")
            length = response.headers.get("Content-Length")
            if length and int(length) > max_bytes:
                raise ResearchError("Source response exceeds the byte limit")
            raw = response.read(max_bytes + 1)
            charset = response.headers.get_content_charset() or "utf-8"
        method = "https_fetch"
    if len(raw) > max_bytes:
        raise ResearchError("Source response exceeds the byte limit")
    document = raw.decode(charset, errors="replace")
    if content_type in {"text/html", "application/xhtml+xml"}:
        body, metadata = extract_body(document)
    else:
        body, metadata = _BodyParser.normalize([document]), {}
    return body, url, metadata, method


def _topic_text(topic: Any) -> str:
    context = getattr(topic, "context", {})
    return " ".join([str(getattr(topic, key, "")) for key in ("title", "category", "keywords")]
                    + [str(value) for value in context.values()]).lower()


def _matches(term: str, text: str) -> bool:
    term = term.strip().lower()
    if not term:
        return False
    if re.fullmatch(r"[a-z0-9 ]+", term):
        return re.search(r"(?<![a-z0-9])" + re.escape(term) + r"(?![a-z0-9])", text) is not None
    return term in text


def _relevance(source: Mapping[str, Any], topic_text: str) -> int:
    tags = source.get("tags", [])
    if isinstance(tags, str):
        tags = re.split(r"[,，;；|]", tags)
    if not isinstance(tags, list) or any(not isinstance(tag, str) for tag in tags):
        raise ResearchError("Source tags must be a list of strings")
    # Specific tags outrank generic GEO matches; custom topic tags should be narrow.
    return sum(1 if tag.lower() in {"geo", "seo", "AI搜索".lower(), "ai search"} else 3
               for tag in tags if _matches(tag, topic_text))


def _lead_relevance(title: str, topic_text: str) -> int:
    """Match current first-party leads across the Chinese/English topic boundary."""
    title = title.lower()
    score = sum(1 for concept in TOPIC_CONCEPTS
                if any(_matches(term, topic_text) for term in concept)
                and any(_matches(term, title) for term in concept))
    tokens = set(re.findall(r"[a-z]{3,}|[\u4e00-\u9fff]{2,}", topic_text))
    return score + sum(1 for term in tokens if _matches(term, title))


def _load_candidates(topic: Any, news_items: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    configured = os.environ.get("RESEARCH_SOURCE_FILE", "").strip()
    if configured:
        path = Path(configured).expanduser().resolve()
        try:
            obj = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise ResearchError(f"Cannot read RESEARCH_SOURCE_FILE: {exc}") from exc
        entries = obj.get("sources") if isinstance(obj, dict) else obj
        if not isinstance(entries, list):
            raise ResearchError("RESEARCH_SOURCE_FILE must contain a sources list")
    else:
        entries = DEFAULT_SOURCES
        path = None
    topic_text = _topic_text(topic)
    candidates = []
    for entry in entries:
        if not isinstance(entry, dict):
            raise ResearchError("Each research source must be an object")
        candidate = dict(entry)
        candidate["url"] = validate_source_url(candidate.get("url", ""))
        score = _relevance(candidate, topic_text)
        if not score:
            continue
        if candidate.get("text_file"):
            if path is None:
                raise ResearchError("Source fixtures require an explicit RESEARCH_SOURCE_FILE")
            candidate["_fixture_path"] = str((path.parent / candidate["text_file"]).resolve())
        candidate["_relevance"] = score
        candidates.append(candidate)
    # A direct original-publisher URL may provide a lead. RSS titles/descriptions
    # are never copied into the evidence body or counted towards source minimums.
    if not configured:
        for item in news_items:
            try:
                url = validate_source_url(str(item.get("url", "")))
            except ResearchError:
                continue
            title = str(item.get("title", ""))
            score = _lead_relevance(title, topic_text)
            if not score:
                continue
            candidates.append({"url": url, "title": title, "_relevance": 50 + score})
    # Start with one candidate from each publisher to avoid a one-domain pack.
    ranked = sorted(candidates, key=lambda item: item["_relevance"], reverse=True)
    first, rest, domains = [], [], set()
    # Keep a relevant Google platform reference, then prioritize original pages
    # discovered today over reusable background sources. Do not inject defaults
    # into an explicit per-topic research file.
    baseline = next((item for item in ranked if item["url"] == DEFAULT_SOURCES[0]["url"]), None) if not configured and DEFAULT_SOURCES else None
    if baseline is not None:
        first.append(baseline)
        domains.add("google.com")
    for item in ranked:
        if item is baseline:
            continue
        domain = TRUSTED_HOSTS[urllib.parse.urlsplit(item["url"]).hostname][0]
        if domain in domains:
            rest.append(item)
        else:
            first.append(item)
            domains.add(domain)
    return first + rest


def build_research_pack(topic: Any, news_items: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """Read actual publisher bodies or explicit fixtures; fail closed if sparse.

    text contains only [excerpt_start, excerpt_end) of the normalized body. The
    model must not infer anything outside that exact window. published is empty
    when no publication metadata was present; retrieval time is not publication.
    """
    minimum = _integer("RESEARCH_MIN_SOURCES", 3, 3, 8)
    domains_min = _integer("RESEARCH_MIN_DOMAINS", 2, 2, 5)
    maximum = _integer("RESEARCH_MAX_SOURCES", 5, minimum, 8)
    min_chars = _integer("RESEARCH_MIN_BODY_CHARS", 900, 300, 10000)
    max_chars = _integer("RESEARCH_MAX_SOURCE_CHARS", 10000, min_chars, 10000)
    timeout = _integer("RESEARCH_FETCH_TIMEOUT", 20, 1, 45)
    max_bytes = _integer("RESEARCH_MAX_RESPONSE_BYTES", 2500000, 10000, 4000000)
    if domains_min > maximum:
        raise ResearchError("RESEARCH_MIN_DOMAINS exceeds RESEARCH_MAX_SOURCES")
    pack: list[dict[str, Any]] = []
    seen_urls, seen_bodies, publisher_domains = set(), set(), set()
    failures = []
    for candidate in _load_candidates(topic, news_items):
        requested_url = candidate["url"]
        if requested_url in seen_urls:
            continue
        candidate_domain = TRUSTED_HOSTS[urllib.parse.urlsplit(requested_url).hostname][0]
        if len(pack) >= maximum and candidate_domain in publisher_domains:
            continue
        seen_urls.add(requested_url)
        try:
            body, url, metadata, method = _fetch_source(candidate, max_bytes, timeout)
            if url != requested_url and url in seen_urls:
                continue
            seen_urls.add(url)
            if len(body) < min_chars:
                raise ResearchError(f"Extracted body has only {len(body)} characters; minimum {min_chars}")
            if re.search(r"access denied|just a moment|verify (?:you are|you're) human|robot check|page not found", metadata.get("title", ""), re.I):
                raise ResearchError("Source returned an error or access-check page instead of an article")
            excerpt = body[:max_chars]
            digest = hashlib.sha256(excerpt.encode("utf-8")).hexdigest()
            if digest in seen_bodies:
                continue
            domain, publisher, evidence_kind = TRUSTED_HOSTS[urllib.parse.urlsplit(url).hostname]
            if len(pack) >= maximum:
                if domain in publisher_domains:
                    continue
                # A later successful source from a missing domain can replace a
                # duplicate publisher; initial fetch failures must not make the
                # diversity requirement impossible merely due to ordering.
                duplicate = next(index for index in range(len(pack) - 1, -1, -1)
                                 if sum(item["publisher_domain"] == pack[index]["publisher_domain"] for item in pack) > 1)
                pack.pop(duplicate)
            seen_bodies.add(digest)
            publisher_domains.add(domain)
            pack.append({
                "id": f"S{len(pack) + 1}",
                "title": metadata.get("title") or str(candidate.get("title") or urllib.parse.urlsplit(url).path),
                "url": url,
                "requested_url": requested_url,
                "publisher": publisher,
                "publisher_domain": domain,
                "published": metadata.get("article:published_time") or metadata.get("datepublished")
                    or metadata.get("date") or str(candidate.get("published") or ""),
                "retrieved_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "text": excerpt,
                "evidence_kind": evidence_kind,
                "retrieval_method": method,
                "excerpt_start": 0,
                "excerpt_end": len(excerpt),
                "body_chars": len(body),
                "excerpt_truncated": len(excerpt) < len(body),
                "text_sha256": digest,
            })
            if len(pack) >= maximum and len(publisher_domains) >= domains_min:
                break
        except (OSError, ValueError, LookupError, ResearchError) as exc:
            failures.append(f"{requested_url}: {type(exc).__name__}: {exc}")
    if len(pack) < minimum or len(publisher_domains) < domains_min:
        detail = "; ".join(failures) or "No additional relevant, distinct source bodies were available"
        raise ResearchError(
            f"Insufficient research: {len(pack)}/{minimum} source bodies and "
            f"{len(publisher_domains)}/{domains_min} publisher domains. {detail}"
        )
    print(f"Research pack: {len(pack)} read source bodies across {len(publisher_domains)} publisher domains.", flush=True)
    for index, item in enumerate(pack, 1):
        item["id"] = f"S{index}"
    return pack
