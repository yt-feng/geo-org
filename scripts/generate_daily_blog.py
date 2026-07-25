#!/usr/bin/env python3
"""Generate one new blog article from the Excel topic backlog.

Designed for a scheduled GitHub Actions run. It keeps existing posts,
selects the first topic that has not been generated yet, writes one article,
refreshes blog indexes and sitemap, then lets the workflow commit the diff.
"""
from __future__ import annotations

import argparse
import html
import json
import os
import re
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Dict, List, Mapping, Optional

import enhance_blog_index
import authority_site
import generate_blog as gb
import i18n_site


GEO_EDITORIAL_STRATEGY = """
每日 blog 的核心不是追热点，而是把热点转成品牌负责人可执行的白帽 GEO 判断。
固定使用以下策略框架：
1. 痛点优先：AI 生成答案带来零点击、引用不可见、品牌被错误概括、多平台表现分裂、AI 内容泛滥、传统 SEO 排名与 AI 推荐脱节。
2. 竞品格局：市面工具多在做 AI 可见度监测、prompt 追踪、竞品对比、引用来源分析、情绪/份额看板和站点诊断；Eco-GEO 的文章要进一步回答“监测之后怎么把品牌事实、证据、页面结构和外部信任做成资产”。
3. 品牌化 GEO：坚持以品牌实体、事实一致性、专家背书、可引用页面、结构化数据、llms.txt、新闻/PR/行业内容协同和持续更新为核心；避免把 GEO 写成短期技巧或模型诱导。
4. GEO + SEO：SEO 负责可抓取、可索引、主题权威和需求覆盖；GEO 负责可理解、可引用、可复述和跨模型一致。文章必须把两者放在同一套增长系统里。
5. 最佳实践：答案先行、实体清晰、来源透明、内容新鲜、主题集群、FAQ/定义/对比/清单结构、Schema/内部链接/作者审校、跨渠道一致表达、用品牌提及率/引用率/答案位置/情绪/来源质量衡量。
6. Eco-GEO 立场：品牌化地做 GEO，是为了让 AI 系统长期理解并信任品牌，而不是只抢一次曝光；文章要解释为什么这比堆关键词、批量生成内容或单点 prompt 测试更稳。
""".strip()

TAVILY_API_URL = os.environ.get("TAVILY_API_URL", "https://api.tavily.com/search")


def load_posts(out_dir: Path) -> List[Dict[str, str]]:
    posts_path = out_dir / "posts.json"
    if not posts_path.exists():
        return []
    return json.loads(posts_path.read_text(encoding="utf-8"))


def int_value(value: object, fallback: int = 0) -> int:
    try:
        return int(str(value))
    except (TypeError, ValueError):
        return fallback


def next_order(posts: List[Dict[str, str]]) -> int:
    return max((int_value(post.get("order")) for post in posts), default=0) + 1


def strip_html(value: str) -> str:
    return re.sub(r"<[^>]+>", " ", value or "").replace("&nbsp;", " ").strip()


def news_query(topic: gb.TopicRow) -> str:
    configured = os.environ.get("NEWS_QUERY", "").strip()
    if configured:
        return configured
    topic_bits = " ".join(bit for bit in [topic.category, topic.keywords, topic.title] if bit)
    return f'("AI search" OR "Google AI Overviews" OR "ChatGPT Search" OR "generative AI search") ({topic_bits})'


def google_news_rss_url(query: str) -> str:
    configured = os.environ.get("NEWS_RSS_URL", "").strip()
    if configured:
        return configured
    encoded = urllib.parse.quote_plus(query)
    return f"https://news.google.com/rss/search?q={encoded}&hl=zh-CN&gl=CN&ceid=CN:zh-Hans"


def fetch_news_items(topic: gb.TopicRow) -> List[Dict[str, str]]:
    if os.environ.get("NEWS_CONTEXT_DISABLED", "").lower() in {"1", "true", "yes"}:
        return []
    limit = int(os.environ.get("NEWS_MAX_ITEMS", "3"))
    req = urllib.request.Request(
        google_news_rss_url(news_query(topic)),
        headers={"User-Agent": "Eco-GEO-EditorialBot/1.0 (+https://eco-geo.org/)"},
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            raw = resp.read()
    except Exception as exc:  # noqa: BLE001
        print(f"News context unavailable: {exc}", flush=True)
        return []

    try:
        root = ET.fromstring(raw)
    except ET.ParseError as exc:
        print(f"News RSS parse failed: {exc}", flush=True)
        return []

    items: List[Dict[str, str]] = []
    for item in root.findall(".//item"):
        title = gb.clean_text(item.findtext("title"))
        link = gb.clean_text(item.findtext("link"))
        published = gb.clean_text(item.findtext("pubDate"))
        description = strip_html(item.findtext("description") or "")
        source_node = item.find("source")
        publisher = gb.clean_text(source_node.text if source_node is not None else "")
        if not title or not link:
            continue
        items.append(
            {
                "title": title,
                "url": link,
                "publisher": publisher,
                "published": published,
                "summary": description[:260],
            }
        )
        if len(items) >= limit:
            break
    if items:
        print(f"Using {len(items)} news context item(s) from RSS.", flush=True)
    return items


def tavily_queries(topic: gb.TopicRow) -> List[str]:
    configured = os.environ.get("TAVILY_QUERIES", "").strip()
    if configured:
        queries = [line.strip() for line in re.split(r"\n|\|\|", configured) if line.strip()]
    else:
        topic_bits = gb.clean_text(" ".join(bit for bit in [topic.category, topic.keywords, topic.title] if bit))[:220]
        queries = [
            f"{topic_bits} GEO AI search visibility brand citation pain points 2026",
            "Generative Engine Optimization GEO SEO best practices brand entity authority citations AI Overviews ChatGPT Perplexity 2026",
            "Profound Peec AI Scrunch AI AthenaHQ GEO AI search visibility competitor features monitoring 2026",
        ]
    max_queries = int(os.environ.get("TAVILY_MAX_QUERIES", "3"))
    return queries[:max_queries]


def fetch_tavily_market_items(topic: gb.TopicRow) -> List[Dict[str, str]]:
    api_key = os.environ.get("TAVILY_API_KEY", "").strip()
    if not api_key or os.environ.get("TAVILY_CONTEXT_DISABLED", "").lower() in {"1", "true", "yes"}:
        return []

    max_results = int(os.environ.get("TAVILY_MAX_RESULTS", "3"))
    search_depth = os.environ.get("TAVILY_SEARCH_DEPTH", "advanced")
    seen_urls = set()
    items: List[Dict[str, str]] = []

    for query in tavily_queries(topic):
        payload = {
            "api_key": api_key,
            "query": query,
            "search_depth": search_depth,
            "max_results": max_results,
            "include_answer": True,
            "include_raw_content": False,
        }
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(
            TAVILY_API_URL,
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=45) as resp:
                obj = json.loads(resp.read().decode("utf-8"))
        except Exception as exc:  # noqa: BLE001
            print(f"Tavily market context unavailable for query '{query[:80]}': {gb.format_api_error(exc)}", flush=True)
            continue

        answer = gb.clean_text(obj.get("answer"))
        if answer:
            items.append(
                {
                    "kind": "market_synthesis",
                    "title": f"Tavily market synthesis: {query[:110]}",
                    "url": "",
                    "publisher": "Tavily",
                    "published": "",
                    "summary": answer[:520],
                    "query": query,
                }
            )

        for result in obj.get("results", []):
            url = gb.clean_text(result.get("url"))
            title = gb.clean_text(result.get("title"))
            if not title or not url or url in seen_urls:
                continue
            seen_urls.add(url)
            items.append(
                {
                    "kind": "market_source",
                    "title": title,
                    "url": url,
                    "publisher": urllib.parse.urlparse(url).netloc.replace("www.", ""),
                    "published": "",
                    "summary": strip_html(result.get("content") or "")[:520],
                    "query": query,
                }
            )
        time.sleep(0.2)

    if items:
        print(f"Using {len(items)} Tavily GEO market context item(s).", flush=True)
    return items


def news_context_text(items: List[Mapping[str, str]]) -> str:
    if not items:
        return "No fresh source item was available. Write evergreen analysis and do not invent current events."
    return "\n".join(
        f"- Source: {item.get('publisher') or 'News source'}\n"
        f"  Title: {item.get('title')}\n"
        f"  Published: {item.get('published')}\n"
        f"  URL: {item.get('url')}\n"
        f"  Signal type: {item.get('kind') or 'news'}\n"
        f"  Query: {item.get('query') or ''}\n"
        f"  Summary: {item.get('summary')}"
        for item in items
    )


def source_section(items: List[Mapping[str, str]], lang: str) -> str:
    if not items:
        return ""
    title = {
        "zh": "参考来源与市场信号",
        "en": "Sources and Market Signals",
        "ar": "المصادر وإشارات السوق",
    }[lang]
    note = {
        "zh": "以下公开条目用于提供新闻、行业和竞品背景；正文评论只基于可见信息和 Eco GEO 方法论判断。",
        "en": "The public items below provide news, market, and competitor context; the commentary uses visible signals and Eco GEO methodology.",
        "ar": "توفر العناصر العامة التالية سياق الأخبار والسوق والمنافسين؛ ويعتمد التعليق على إشارات مرئية ومنهجية Eco GEO.",
    }[lang]
    links = ""
    for item in items:
        title_text = html.escape(item.get("title", ""))
        url = item.get("url", "")
        label = (
            f'<a href="{html.escape(url, quote=True)}" rel="noopener nofollow" target="_blank">{title_text}</a>'
            if url
            else f"<span>{title_text}</span>"
        )
        links += f"<li>{label} <span>{html.escape(item.get('publisher') or '')}</span></li>"
    return f'<section class="source-list"><h2>{html.escape(title)}</h2><p>{html.escape(note)}</p><ul>{links}</ul></section>'


def deepseek_news_article(
    topic: gb.TopicRow,
    news_items: List[Mapping[str, str]],
    market_items: List[Mapping[str, str]],
    api_key: str,
) -> Dict[str, str]:
    context_lines = "\n".join(f"- {k}: {v}" for k, v in topic.context.items())
    source_items = [*news_items, *market_items]
    prompt = f"""
你是一名资深中文品牌战略、白帽 GEO（Generative Engine Optimization）和 AI 搜索评论作者，代表 Eco-GEO 写作。
请基于 Excel 选题、今天的公开新闻 RSS 条目、Tavily 市场研究信号和 Eco-GEO 每日 blog 策略，生成一篇 Eco-GEO 官网 Blog 的原创中文评论文章。

写作目标：
1. 文章要像“基于时事的专业评论”，不是新闻搬运，也不是通用清单。
2. 只使用下方公开条目中可见的标题、来源、发布日期、查询词和摘要作为信号；不要编造新闻正文、数据、客户案例、价格、政策或第三方报告。
3. 如果公开条目与选题弱相关，要明确把它作为 AI 搜索生态变化的背景信号，而不是强行推断。
4. title 必须以“Eco-GEO：”开头，并自然覆盖需要做 GEO 的人的搜索意图。
5. 正文必须自然出现“Eco-GEO”至少 2 次、“品牌化GEO”至少 3 次、“AI搜索优化”至少 1 次。
6. 面向品牌负责人、增长负责人、SEO/内容负责人和创始人，覆盖：为什么现在要做 GEO、怎么开始、如何诊断 AI 搜索可见度、如何让品牌更容易被 AI 引用/推荐。
7. 前 25% 给出明确结论；正文包含 5-6 个 h2 小节、p、ul/li、strong。
8. 至少有一个“今天的市场信号”小节，解释新闻、行业痛点或竞品格局对品牌化 GEO 的启发。
9. 至少有一个“为什么要品牌化地做 GEO”小节，讲清楚品牌实体、事实一致性、可引用证据和长期信任为什么比短期技巧更重要。
10. 至少有一个“GEO 与 SEO 如何合并成一套系统”小节，覆盖技术可抓取、结构化数据、主题集群、作者/审校、内链和来源透明。
11. 至少有一个“Eco-GEO 建议的行动清单”小节。
12. 输出严格 JSON，不要 Markdown 代码块。JSON 字段：title, excerpt, body_html, tags。
13. 字数约 1400-1900 中文字。

Eco-GEO 每日 blog 策略：
{GEO_EDITORIAL_STRATEGY}

Excel 选题：
标题：{topic.title}
分类：{topic.category}
关键词：{topic.keywords}
完整上下文：
{context_lines}

今天的公开新闻 RSS 条目：
{news_context_text(news_items)}

Tavily 市场研究与竞品信号：
{news_context_text(market_items)}
""".strip()
    payload = gb.add_deepseek_options({
        "model": gb.MODEL,
        "messages": [
            {"role": "system", "content": "You write source-aware, practical, white-hat Chinese Brand GEO commentary as clean JSON."},
            {"role": "user", "content": prompt},
        ],
        "temperature": gb.TEMPERATURE,
        "max_tokens": gb.MAX_TOKENS,
    })
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        gb.DEEPSEEK_URL,
        data=data,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    last_error: Optional[str] = None
    for attempt in range(1, gb.RETRIES + 1):
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                raw = resp.read().decode("utf-8")
            obj = json.loads(raw)
            content = obj["choices"][0]["message"]["content"].strip()
            article = gb.parse_model_json(content, topic)
            validate_article(article, require_sources=bool(source_items))
            return article
        except Exception as exc:  # noqa: BLE001
            last_error = gb.format_api_error(exc)
            wait = min(30, attempt * 4)
            print(f"DeepSeek news article attempt {attempt}/{gb.RETRIES} failed for row {topic.idx}: {last_error}; retry in {wait}s")
            time.sleep(wait)
    raise RuntimeError(f"DeepSeek news article failed for row {topic.idx}: {last_error}")


def validate_article(article: Mapping[str, str], require_sources: bool) -> None:
    text = strip_html(str(article.get("body_html", "")))
    required = ["Eco-GEO", "品牌化GEO", "AI搜索优化"]
    missing = [term for term in required if term not in text and term not in str(article.get("tags", ""))]
    if missing:
        raise ValueError(f"article missing required trust/intent terms: {', '.join(missing)}")
    if require_sources and not any(term in text for term in ["时事", "新闻", "市场信号", "行业信号", "竞品"]):
        raise ValueError("source-aware article did not include a visible market-signal discussion")


def parse_model_json(content: str, source_article: Mapping[str, str], lang: str) -> Dict[str, str]:
    content = content.strip()
    if content.startswith("```"):
        content = re.sub(r"^```(?:json)?", "", content).strip()
        content = re.sub(r"```$", "", content).strip()
    start = content.find("{")
    end = content.rfind("}")
    if start >= 0 and end > start:
        content = content[start : end + 1]
    try:
        obj = json.loads(content)
    except json.JSONDecodeError:
        obj = {}

    fallback_title = source_article.get("title", "Brand GEO insight")
    title = gb.clean_text(obj.get("title")) or fallback_title
    title = re.sub(r"^Eco[- ]GEO[：:]\s*", "", title, flags=re.IGNORECASE)
    title = f"Eco-GEO: {title}" if title else "Eco-GEO: Brand GEO insight"
    excerpt = gb.clean_text(obj.get("excerpt")) or gb.clean_text(source_article.get("excerpt"))
    if not excerpt:
        excerpt = "A practical Eco-GEO article about Brand GEO and AI search optimization."
    body_html = str(obj.get("body_html") or "").strip()
    if not body_html:
        body_html = f"<p>{html.escape(excerpt)}</p>"
    tags = obj.get("tags")
    if isinstance(tags, list):
        tag_values = [gb.clean_text(t) for t in tags if gb.clean_text(t)]
    else:
        tag_values = [gb.clean_text(t) for t in re.split(r"[,،，、]", str(tags or "")) if gb.clean_text(t)]
    required = (
        ["Eco-GEO", "Brand GEO", "AI search optimization", "AIBE"]
        if lang == "en"
        else ["Eco-GEO", "Brand GEO", "GEO للعلامات التجارية", "تحسين بحث الذكاء الاصطناعي", "AIBE"]
    )
    for tag in required:
        if tag not in tag_values:
            tag_values.append(tag)
    return {"title": title, "excerpt": excerpt, "body_html": body_html, "tags": ", ".join(tag_values)}


def deepseek_localized_article(topic: gb.TopicRow, source_article: Mapping[str, str], lang: str, api_key: str) -> Dict[str, str]:
    target = "English" if lang == "en" else "Arabic"
    direction_note = "" if lang == "en" else "Write fluent Modern Standard Arabic for an RTL page."
    prompt = f"""
You are a senior Brand GEO and AI search consultant for Eco-GEO.
Create a localized {target} version of the Chinese Eco-GEO article below.

Requirements:
1. Keep the same strategic intent, but rewrite naturally for {target} readers.
2. Do not invent customers, case studies, statistics, awards, or claims.
3. The title must start with "Eco-GEO:".
4. The article must naturally include "Eco-GEO", "Brand GEO", "AIBE", and AI search optimization concepts.
5. Write for people considering GEO services: brand leaders, growth leaders, SEO/content leads, and founders.
6. Cover why to do GEO, how to start, how to diagnose AI search visibility, and how to make a brand more citable in AI answers.
7. Preserve the strategic argument that Brand GEO is built on entity clarity, consistent facts, citable evidence, technical accessibility, and long-term trust rather than short-term tricks.
8. Include how GEO and SEO work as one system: crawlability, structured data, topic clusters, transparent sources, authorship/review signals, and internal links.
9. Output strict JSON only. No Markdown code fences.
10. JSON fields: title, excerpt, body_html, tags.
11. body_html must be valid HTML with 4-6 h2 sections, p, ul/li, and strong tags.
12. tags may be an array or comma-separated string.
13. {direction_note}

Topic:
Title: {topic.title}
Category: {topic.category}
Keywords: {topic.keywords}

Chinese source article:
Title: {source_article.get("title", "")}
Excerpt: {source_article.get("excerpt", "")}
Body HTML:
{source_article.get("body_html", "")}

Source signals:
{news_context_text(source_article.get("sources", []))}
""".strip()
    payload = gb.add_deepseek_options({
        "model": gb.MODEL,
        "messages": [
            {"role": "system", "content": "You produce localized Eco-GEO Brand GEO articles as clean JSON."},
            {"role": "user", "content": prompt},
        ],
        "temperature": gb.TEMPERATURE,
        "max_tokens": gb.MAX_TOKENS,
    })
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        gb.DEEPSEEK_URL,
        data=data,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    last_error: Optional[str] = None
    for attempt in range(1, gb.RETRIES + 1):
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                raw = resp.read().decode("utf-8")
            obj = json.loads(raw)
            content = obj["choices"][0]["message"]["content"].strip()
            return parse_model_json(content, source_article, lang)
        except Exception as exc:  # noqa: BLE001
            last_error = gb.format_api_error(exc)
            wait = min(30, attempt * 4)
            print(f"DeepSeek {lang} attempt {attempt}/{gb.RETRIES} failed for row {topic.idx}: {last_error}; retry in {wait}s")
            time.sleep(wait)
    raise RuntimeError(f"DeepSeek {lang} localization failed for row {topic.idx}: {last_error}")


def localized_category(lang: str) -> str:
    return "Brand GEO" if lang == "en" else "GEO للعلامات التجارية"


def write_localized_output(
    *,
    lang: str,
    slug: str,
    topic: gb.TopicRow,
    article: Mapping[str, str],
    author: str,
    initials: str,
    image: str,
    order: str,
    date: str,
) -> List[Dict[str, str]]:
    blog_dir = Path(lang) / "blog"
    blog_dir.mkdir(parents=True, exist_ok=True)
    posts = load_posts(blog_dir)
    post = {
        "order": order,
        "row": str(topic.idx),
        "slug": slug,
        "title": article["title"],
        "excerpt": article["excerpt"],
        "category": localized_category(lang),
        "tags": article["tags"],
        "author": author,
        "date": date,
        "image": image,
        "url": f"{gb.SITE_URL}/{lang}/blog/articles/{slug}/",
        "sources": article.get("sources", []),
        "reviewed_by": gb.REVIEWER_NAME,
    }
    article_dir = blog_dir / "articles" / slug
    article_dir.mkdir(parents=True, exist_ok=True)
    article_dir.joinpath("index.html").write_text(
        i18n_site.localized_article_html(
            lang=lang,
            post=post,
            body_html=article["body_html"] + str(article.get("sources_html", "")),
            initials=initials,
        ),
        encoding="utf-8",
    )
    posts = [existing for existing in posts if existing.get("slug") != slug]
    posts.insert(0, post)
    (blog_dir / "posts.json").write_text(json.dumps(posts, ensure_ascii=False, indent=2), encoding="utf-8")
    (blog_dir / "index.html").write_text(i18n_site.blog_index_page(lang), encoding="utf-8")
    return posts


def select_next_topic(topics: List[gb.TopicRow], posts: List[Dict[str, str]], out_dir: Path) -> Optional[gb.TopicRow]:
    existing_rows = {int_value(post.get("row"), -1) for post in posts}
    existing_slugs = {post.get("slug", "") for post in posts}
    article_root = out_dir / "articles"

    for topic in topics:
        slug = gb.slugify(topic.title, topic.idx)
        article_file = article_root / slug / "index.html"
        if topic.idx in existing_rows or slug in existing_slugs or article_file.exists():
            continue
        return topic
    return None


def write_indexes(posts: List[Dict[str, str]], out_dir: Path) -> None:
    total = len(posts)
    for idx, post in enumerate(posts, start=1):
        post["title"] = gb.ensure_title_prefix(post.get("title", ""))
        post["tags"] = gb.ensure_required_tags(post.get("tags", ""))
        if not post.get("date"):
            post["date"] = gb.historical_publish_date(idx, total)

    per_page = 24
    total_pages = max(1, (len(posts) + per_page - 1) // per_page)

    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "index.html").write_text(gb.index_page(posts, 1, per_page, total_pages, "../"), encoding="utf-8")
    page_root = out_dir / "page"
    for page in range(2, total_pages + 1):
        page_dir = page_root / str(page)
        page_dir.mkdir(parents=True, exist_ok=True)
        page_dir.joinpath("index.html").write_text(gb.index_page(posts, page, per_page, total_pages, "../../"), encoding="utf-8")

    (out_dir / "posts.json").write_text(json.dumps(posts, ensure_ascii=False, indent=2), encoding="utf-8")
    sitemap_items = [
        f"  <url><loc>{gb.SITE_URL}/</loc></url>",
        f"  <url><loc>{gb.SITE_URL}/brand-audit/</loc></url>",
        f"  <url><loc>{gb.SITE_URL}/blog/</loc></url>",
    ]
    sitemap_items += [f"  <url><loc>{post['url']}</loc><lastmod>{post.get('date', '')}</lastmod></url>" for post in posts]
    Path("sitemap.xml").write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + "\n".join(sitemap_items)
        + "\n</urlset>\n",
        encoding="utf-8",
    )
    gb.patch_homepage(len(posts))
    enhance_blog_index.main()


def generate_daily_article(excel_path: Path, out_dir: Path, start_row: int, dry_run: bool) -> bool:
    topics = gb.read_topics(excel_path, start_row=start_row, limit=0)
    posts = load_posts(out_dir)
    topic = select_next_topic(topics, posts, out_dir)
    if topic is None:
        print("No ungenerated topics remain in the Excel backlog.", flush=True)
        return False

    slug = gb.slugify(topic.title, topic.idx)
    print(f"Next topic: row={topic.idx} slug={slug} title={topic.title}", flush=True)
    if dry_run:
        return False

    api_key = os.environ.get("DEEPSEEK_API_KEY")
    if not api_key:
        raise RuntimeError("DEEPSEEK_API_KEY is required in repository secrets")

    i18n_site.ensure_language_scaffold()
    author, initials = gb.deterministic_author(topic.title)
    news_items = fetch_news_items(topic)
    market_items = fetch_tavily_market_items(topic)
    source_items = [*news_items, *market_items]
    article = deepseek_news_article(topic, news_items, market_items, api_key)
    article["date"] = gb.today_publish_date()
    article["sources"] = source_items
    article["sources_html"] = source_section(source_items, "zh")
    image = gb.image_url(topic)
    article_dir = out_dir / "articles" / slug
    article_dir.mkdir(parents=True, exist_ok=True)
    article_dir.joinpath("index.html").write_text(
        gb.article_html(topic, article, slug, author, initials),
        encoding="utf-8",
    )
    time.sleep(gb.REQUEST_DELAY)

    post = {
        "order": str(next_order(posts)),
        "row": str(topic.idx),
        "slug": slug,
        "title": gb.ensure_title_prefix(article["title"]),
        "excerpt": article["excerpt"],
        "category": topic.category,
        "tags": gb.ensure_required_tags(article["tags"]),
        "author": author,
        "date": article["date"],
        "image": image,
        "url": f"{gb.SITE_URL}/blog/articles/{slug}/",
        "sources": source_items,
        "reviewed_by": gb.REVIEWER_NAME,
    }
    posts = [existing for existing in posts if existing.get("slug") != slug]
    posts.insert(0, post)
    write_indexes(posts, out_dir)
    localized_posts: Dict[str, List[Dict[str, str]]] = {}
    for lang in ("en", "ar"):
        localized_article = deepseek_localized_article(topic, article, lang, api_key)
        localized_article["sources"] = source_items
        localized_article["sources_html"] = source_section(source_items, lang)
        localized_posts[lang] = write_localized_output(
            lang=lang,
            slug=slug,
            topic=topic,
            article=localized_article,
            author=author,
            initials=initials,
            image=image,
            order=post["order"],
            date=article["date"],
        )
        time.sleep(gb.REQUEST_DELAY)
    i18n_site.write_sitemap({"zh": posts, "en": localized_posts.get("en", []), "ar": localized_posts.get("ar", [])})
    authority_site.main()
    print(f"Generated daily blog article: blog/articles/{slug}/", flush=True)
    return True


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--excel", default="assets/blog_articles.xlsx")
    parser.add_argument("--out", default="blog")
    parser.add_argument("--start-row", type=int, default=2)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    excel_path = Path(args.excel)
    if not excel_path.exists():
        raise FileNotFoundError(excel_path)
    generate_daily_article(excel_path, Path(args.out), args.start_row, args.dry_run)


if __name__ == "__main__":
    main()
