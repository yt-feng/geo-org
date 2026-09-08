"""Fetch bounded, auditable source bodies for the daily insight pipeline.

Research text stays in memory. Never publish or commit this pack: publish source
metadata and the article's own analysis only. RSS text is never evidence.

RESEARCH_SOURCE_FILE: optional JSON list, or {"sources": [...]}, replacing the
curated catalogue. Each source has url, title, tags (topic-matching strings), and
optionally published and text_file (UTF-8 plain text/HTML fixture, relative to the
JSON file). Optional industries are exact industry names or supported aliases;
scope_notes explains the geography, population and claim boundaries. Optional
excerpt_anchor selects a verified passage in a long report. A fixture is
explicitly labelled local_fixture in the result.
RESEARCH_MIN_SOURCES / RESEARCH_MIN_DOMAINS: defaults 3 / 2, hard floors 3 / 2.
RESEARCH_MAX_SOURCES: default 5 (at most 8).
RESEARCH_MIN_BODY_CHARS: default 900 (at least 300).
RESEARCH_MAX_SOURCE_CHARS: default 10000 (at most 10000).
RESEARCH_FETCH_TIMEOUT: seconds per request, default 20 (maximum 45).
RESEARCH_MAX_RESPONSE_BYTES: default 2500000 (maximum 4000000).
Industry topics require at least one matching industry source body. General AI
search/marketing sources cannot satisfy this additional evidence requirement.
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
    "www.fao.org": ("fao.org", "Food and Agriculture Organization of the United Nations", "institutional_analysis"),
    "openknowledge.fao.org": ("fao.org", "Food and Agriculture Organization of the United Nations", "institutional_research"),
    "www.oecd.org": ("oecd.org", "OECD", "institutional_analysis"),
    "ers.usda.gov": ("usda.gov", "USDA Economic Research Service", "government_research"),
    "www.ers.usda.gov": ("usda.gov", "USDA Economic Research Service", "government_research"),
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
    {
        "url": "https://www.oecd.org/en/topics/innovation-and-digital-in-agriculture.html",
        "title": "Innovation and digital in agriculture",
        "tags": ["信任", "证据", "投入", "成本", "预算", "采用", "数字化"],
        "industries": ["agriculture_technology"],
        "excerpt_anchor": "Innovation and digitalisation are transformative forces",
        "scope_notes": "OECD policy synthesis about agricultural digitalisation: adoption barriers and trust. It does not measure a brand's GEO conversion, prove procurement-cycle length, or establish that its market is currently more competitive.",
    },
    {
        "url": "https://www.fao.org/newsroom/detail/fao-state-of-food-and-agriculture--sofa-2022-automation-agrifood-systems/en",
        "title": "The State of Food and Agriculture 2022: Leveraging automation to transform agrifood systems",
        "tags": ["采用", "成本", "投入", "预算", "证据", "基础设施", "自动化"],
        "industries": ["agriculture_technology"],
        "published": "2022-11-02",
        "scope_notes": "FAO's own 2022 report announcement discussing 27 global case studies, adoption and local enabling conditions. This is the complete announcement body, not the full report or evidence of current Chinese agricultural technology purchasing behaviour.",
    },
    {
        "url": "https://ers.usda.gov/data-products/charts-of-note/110550",
        "title": "Precision agriculture use increases with farm size and varies widely by technology",
        "tags": ["分层", "采用", "规模", "投入", "成本", "预算", "证据"],
        "industries": ["agriculture_technology"],
        "published": "2024-12-10",
        "scope_notes": "USDA analysis of US farms in 2023, stratified by farm size and technology. Adoption percentages describe those US populations and technologies only; they are not Chinese market estimates, GEO metrics or a causal estimate of marketing effectiveness.",
    },
    {
        "url": "https://www.oecd.org/en/publications/progress-in-implementing-the-european-union-coordinated-plan-on-artificial-intelligence-volume-2_3ac96d41-en/full-report/ai-in-agriculture_c9ac6d24.html",
        "title": "AI in agriculture — Progress in Implementing the European Union Coordinated Plan on Artificial Intelligence (Volume 2)",
        "tags": ["采用", "证据", "信任", "成本", "预算", "采购", "投资"],
        "industries": ["agriculture_technology"],
        "excerpt_anchor": "Scepticism among European farmers",
        "scope_notes": "OECD chapter on EU agriculture; the selected passage includes interview-based adoption observations. Attribute interview anecdotes and geography explicitly; do not generalise them into universal procurement timelines, Chinese market statistics or GEO outcomes.",
    },
]

INDUSTRY_ALIASES = {
    "agriculture_technology": ("农业科技", "农科", "农业技术", "智慧农业", "数字农业", "精准农业", "农业", "agriculture technology", "agricultural technology", "agriculture", "agricultural", "agritech", "agri-tech", "agtech", "digital farming", "precision farming"),
}
INDUSTRY_FIELDS = {"行业", "行业类别", "所属行业", "industry", "sector", "industry category"}
GENERIC_CATEGORIES = {"", "brand geo", "geo", "seo", "品牌化geo", "内容", "阶段路线图", "营销", "marketing"}

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
            body_marker = bool(re.search(r"article[-_ ]?(?:body|content)|post[-_ ]?(?:body|content)|devsite-article-body|richtextbody|news-detail__body", marker, re.I))
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


def _industry_name(value: str) -> str:
    value = re.sub(r"\s+", " ", value.strip().lower())
    return next((key for key, aliases in INDUSTRY_ALIASES.items() if value == key or value in aliases), value)


def _industry_values(value: Any) -> set[str]:
    values = re.split(r"[,，;；|/、]", value) if isinstance(value, str) else value
    if not isinstance(values, list) or any(not isinstance(item, str) for item in values):
        raise ResearchError("Source industries must be a list of exact industry names")
    return {_industry_name(item) for item in values if item.strip()}


def topic_industries(topic: Any) -> set[str]:
    """Prefer the Excel industry column; category aliases are exact fallbacks.

    An unrelated sector merely mentioned in a title/context never changes an
    explicitly declared industry (for example cloud services used by farmers).
    """
    context = getattr(topic, "context", {})
    explicit = [str(value) for key, value in context.items() if key.strip().lower() in INDUSTRY_FIELDS and value]
    if explicit:
        return set().union(*(_industry_values(value) for value in explicit)) - GENERIC_CATEGORIES
    category = str(getattr(topic, "category", "")).strip().lower()
    name = _industry_name(category)
    return {name} if name in INDUSTRY_ALIASES else set()


def _industry_mentions(text: str, industries: set[str]) -> set[str]:
    text = text.lower()
    return {industry for industry in industries
            if any(_matches(alias, text) for alias in INDUSTRY_ALIASES.get(industry, (industry,)))}


def _excerpt(body: str, candidate: Mapping[str, Any], max_chars: int) -> tuple[str, int]:
    anchor = candidate.get("excerpt_anchor")
    start = 0
    if anchor:
        if not isinstance(anchor, str) or not anchor.strip():
            raise ResearchError("excerpt_anchor must be a nonempty exact passage")
        start = body.lower().find(anchor.lower())
        if start < 0:
            raise ResearchError("The configured source excerpt anchor was not found in the read body")
    return body[start:start + max_chars], start


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
    industries = topic_industries(topic)
    candidates = []
    for entry in entries:
        if not isinstance(entry, dict):
            raise ResearchError("Each research source must be an object")
        candidate = dict(entry)
        candidate["url"] = validate_source_url(candidate.get("url", ""))
        source_industries = _industry_values(candidate.get("industries", []))
        matched = industries & source_industries
        if source_industries and not matched:
            continue
        score = _relevance(candidate, topic_text)
        if not score and not matched:
            continue
        if candidate.get("text_file"):
            if path is None:
                raise ResearchError("Source fixtures require an explicit RESEARCH_SOURCE_FILE")
            candidate["_fixture_path"] = str((path.parent / candidate["text_file"]).resolve())
        candidate["_matched_industries"] = sorted(matched)
        candidate["_relevance"] = score + (100 if matched else 0)
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
            matched = _industry_mentions(title, industries)
            if not score and not matched:
                continue
            candidates.append({"url": url, "title": title, "_relevance": (150 if matched else 50) + score,
                               "_matched_industries": sorted(matched)})
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
    industries = topic_industries(topic)
    pack: list[dict[str, Any]] = []
    seen_urls, seen_bodies, publisher_domains = set(), set(), set()
    failures = []
    for candidate in _load_candidates(topic, news_items):
        requested_url = candidate["url"]
        if requested_url in seen_urls:
            continue
        candidate_domain = TRUSTED_HOSTS[urllib.parse.urlsplit(requested_url).hostname][0]
        covered_industries = {industry for item in pack for industry in item["industries"]}
        new_industries = set(candidate.get("_matched_industries", [])) - covered_industries
        if len(pack) >= maximum and candidate_domain in publisher_domains and not new_industries:
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
            excerpt, excerpt_start = _excerpt(body, candidate, max_chars)
            if len(excerpt) < min_chars:
                raise ResearchError(f"Selected excerpt has only {len(excerpt)} characters; minimum {min_chars}")
            matched_industries = set(candidate.get("_matched_industries", []))
            if matched_industries and _industry_mentions(excerpt, matched_industries) != matched_industries:
                raise ResearchError("Read excerpt does not contain the declared industry context")
            digest = hashlib.sha256(excerpt.encode("utf-8")).hexdigest()
            if digest in seen_bodies:
                continue
            domain, publisher, evidence_kind = TRUSTED_HOSTS[urllib.parse.urlsplit(url).hostname]
            if len(pack) >= maximum:
                if domain in publisher_domains and not new_industries:
                    continue
                # A later successful source from a missing domain can replace a
                # duplicate publisher; initial fetch failures must not make the
                # diversity requirement impossible merely due to ordering.
                replaceable = []
                for index in range(len(pack) - 1, -1, -1):
                    remaining = pack[:index] + pack[index + 1:]
                    next_domains = {item["publisher_domain"] for item in remaining} | {domain}
                    next_industries = {industry for item in remaining for industry in item["industries"]} | matched_industries
                    if len(next_domains) >= min(domains_min, len(publisher_domains)) and next_industries >= covered_industries:
                        replaceable.append(index)
                if not replaceable:
                    continue
                duplicate = replaceable[0]
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
                "evidence_role": "industry_context" if matched_industries else "general_context",
                "industries": sorted(matched_industries),
                "scope_notes": str(candidate.get("scope_notes") or (
                    "Industry relevance was matched by title and confirmed in the read excerpt. Use only the geography, population, period and statements explicitly supported by the excerpt; do not infer GEO effectiveness."
                    if matched_industries else
                    "General platform, search or marketing context only. This source cannot establish the selected industry's buying cycle, competition, adoption rates, budget thresholds or GEO conversion."
                )),
                "retrieval_method": method,
                "excerpt_start": excerpt_start,
                "excerpt_end": excerpt_start + len(excerpt),
                "body_chars": len(body),
                "excerpt_truncated": excerpt_start > 0 or len(excerpt) < len(body),
                "text_sha256": digest,
            })
            publisher_domains = {item["publisher_domain"] for item in pack}
            covered_industries = {industry for item in pack for industry in item["industries"]}
            if len(pack) >= maximum and len(publisher_domains) >= domains_min and covered_industries >= industries:
                break
        except (OSError, ValueError, LookupError, ResearchError) as exc:
            failures.append(f"{requested_url}: {type(exc).__name__}: {exc}")
    covered_industries = {industry for item in pack for industry in item["industries"]}
    missing_industries = sorted(industries - covered_industries)
    if len(pack) < minimum or len(publisher_domains) < domains_min or missing_industries:
        detail = "; ".join(failures) or "No additional relevant, distinct source bodies were available"
        raise ResearchError(
            f"Insufficient research: {len(pack)}/{minimum} source bodies and "
            f"{len(publisher_domains)}/{domains_min} publisher domains. "
            f"Missing industry evidence: {', '.join(missing_industries) or 'none'}. {detail}"
        )
    print(f"Research pack: {len(pack)} read source bodies across {len(publisher_domains)} publisher domains.", flush=True)
    for index, item in enumerate(pack, 1):
        item["id"] = f"S{index}"
    return pack
