#!/usr/bin/env python3
"""Generate a researched, reviewed insight in Chinese, English and Arabic.

No article or public index is written until every language passes quality gates.
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
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Dict, List, Mapping, Optional

import enhance_blog_index
import authority_site
import generate_blog as gb
import i18n_site
import insight_pipeline
from insight_research import build_research_pack, industry_search_plan, reread_research_pack


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


def tavily_search_plan(topic: gb.TopicRow) -> List[dict]:
    """Reserve discovery slots for the actual industry, with its own publishers.

    Queries only discover candidate URLs. A search result, industry tag or
    summary never substitutes for the research pack's retrieved-body checks.
    """
    industry_plan = industry_search_plan(topic)
    industry_entries = []
    if industry_plan["industries"]:
        if not industry_plan["queries"] or not industry_plan["domains"]:
            raise ValueError("Industry search plan requires independent queries and official source domains")
        industry_entries = [
            {"query": query, "include_domains": list(industry_plan["domains"]),
             "discovery_role": industry_plan["source_role"],
             "industries": list(industry_plan["industries"])}
            for query in industry_plan["queries"][:2]
        ]
    configured = os.environ.get("TAVILY_QUERIES", "").strip()
    if configured:
        queries = [line.strip() for line in re.split(r"\n|\|\|", configured) if line.strip()]
    else:
        topic_bits = gb.clean_text(" ".join(bit for bit in [topic.category, topic.keywords, topic.title] if bit))[:220]
        platform_query = "AI search citations indexing measurement official documentation Google Bing"
        queries = [
            f"{topic_bits} AI search brand discovery evidence research",
            f"{topic_bits} AI search customer journey resource allocation measurement research",
            platform_query,
        ]
        if industry_entries:
            queries = [platform_query, *queries[:-1]]
    max_queries = int(os.environ.get("TAVILY_MAX_QUERIES", "3"))
    if not 1 <= max_queries <= 6:
        raise ValueError("TAVILY_MAX_QUERIES must be between 1 and 6; use TAVILY_CONTEXT_DISABLED to disable discovery")
    generic_entries = [
        {"query": query, "include_domains": ["bcg.com", "developers.google.com", "blogs.bing.com", "arxiv.org"],
         "discovery_role": "general_context", "industries": []}
        for query in queries
    ]
    plan = []
    seen_queries = set()
    for entry in [*industry_entries, *generic_entries]:
        normalized_query = entry["query"].strip().casefold()
        if not normalized_query or normalized_query in seen_queries:
            continue
        seen_queries.add(normalized_query)
        plan.append(entry)
        if len(plan) == max_queries:
            break
    return plan


def tavily_queries(topic: gb.TopicRow) -> List[str]:
    """Compatibility view of the bounded, industry-aware discovery plan."""
    return [entry["query"] for entry in tavily_search_plan(topic)]


def fetch_tavily_market_items(topic: gb.TopicRow) -> List[Dict[str, object]]:
    api_key = os.environ.get("TAVILY_API_KEY", "").strip()
    if not api_key or os.environ.get("TAVILY_CONTEXT_DISABLED", "").lower() in {"1", "true", "yes"}:
        return []

    max_results = int(os.environ.get("TAVILY_MAX_RESULTS", "3"))
    search_depth = os.environ.get("TAVILY_SEARCH_DEPTH", "advanced")
    seen_urls = set()
    items: List[Dict[str, object]] = []

    for search in tavily_search_plan(topic):
        query = search["query"]
        payload = {
            "api_key": api_key,
            "query": query,
            "search_depth": search_depth,
            "max_results": max_results,
            "include_domains": search["include_domains"],
            "include_answer": False,
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

        # Ignore provider-generated answers even if unexpectedly returned. Only
        # original-page discovery leads proceed to independent body retrieval.
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
                    "discovery_role": search["discovery_role"],
                    "industries": search["industries"],
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
    titles = {"zh": "来源与研究方法", "en": "Sources and Methodology", "ar": "المصادر والمنهجية"}
    notes = {
        "zh": "本文基于下列公开资料的已读取正文展开分析。外部事实、作者推论和示例假设在正文中分别标明；来源适用的市场、样本和时间不自动外推到其他行业。",
        "en": "This analysis draws on the retrieved source text below. External facts, analytical inferences and illustrative assumptions are distinguished in the article; findings are bounded by their market, sample and date.",
        "ar": "يستند هذا التحليل إلى النصوص المسترجعة من المصادر العامة أدناه. يميز المقال بين الحقائق الخارجية والاستنتاجات التحليلية والافتراضات التوضيحية، ضمن حدود السوق والعينة والتاريخ."
    }
    links = "".join(
        f'<li id="source-{html.escape(str(item["id"]))}">'
        f'<a href="{html.escape(str(item["url"]), quote=True)}" rel="noopener" target="_blank">'
        f'[{html.escape(str(item["id"]))}] {html.escape(str(item["title"]))}</a>'
        f' — {html.escape(str(item.get("publisher", "")))}'
        f' · {html.escape(str(item.get("published") or ""))}'
        f' · {html.escape(str(item.get("retrieved_at", ""))[:10])}</li>' for item in items
    )
    return f'<section class="source-list"><h2>{titles[lang]}</h2><p>{notes[lang]}</p><ol>{links}</ol></section>'


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
        "quality": article.get("quality", {}),
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


def localize_reviewed_article(topic, sources, api_key, original, audit_dir):
    """Review independent translations concurrently; return only a complete pair."""
    with ThreadPoolExecutor(max_workers=2, thread_name_prefix="insight-locale") as executor:
        pending = {lang: executor.submit(insight_pipeline.produce_article,
            topic, sources, api_key, lang=lang, original=original,
            audit_path=audit_dir / f"{lang}.json") for lang in ("en", "ar")}
        return {lang: result.result() for lang, result in pending.items()}


def load_resume_audit(resume_dir: Path, topic: gb.TopicRow) -> dict:
    """Load only the selected backlog topic's failed Chinese editorial audit."""
    audit_path = resume_dir / gb.slugify(topic.title, topic.idx) / "zh.json"
    if not audit_path.is_file():
        raise ValueError(f"No resume audit for selected topic: {audit_path}")
    if audit_path.stat().st_size > 10_000_000:
        raise ValueError("Resume audit exceeds 10 MB")
    audit = json.loads(audit_path.read_text(encoding="utf-8"))
    if not isinstance(audit, dict) or audit.get("row") != topic.idx or audit.get("language") != "zh":
        raise ValueError("Resume audit must match selected row and Chinese language")
    if audit.get("passed") is not False or not audit.get("attempts") or not audit.get("sources"):
        raise ValueError("Resume requires a failed audit with saved drafts and source provenance")
    return audit


def generate_daily_article(excel_path: Path, out_dir: Path, start_row: int, dry_run: bool,
                           preview_dir: Optional[Path] = None,
                           resume_dir: Optional[Path] = None,
                           editorial_revision_path: Optional[Path] = None) -> bool:
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

    resume_audit = load_resume_audit(resume_dir, topic) if resume_dir is not None else None
    editorial_revision = None
    if editorial_revision_path is not None:
        if resume_audit is None:
            raise ValueError("An editorial revision requires a failed resume audit")
        if editorial_revision_path.stat().st_size > 60_000:
            raise ValueError("Editorial revision exceeds 60 KB")
        editorial_revision = json.loads(editorial_revision_path.read_text(encoding="utf-8"))
        if not isinstance(editorial_revision, dict):
            raise ValueError("Editorial revision must be an article JSON object")
    if resume_audit is not None:
        sources = reread_research_pack(resume_audit["sources"])
        print(f"Resuming saved Chinese draft after revalidating {len(sources)} source bodies.", flush=True)
    else:
        # Discovery summaries are leads only; the research pack contains retrieved originals.
        leads = [*fetch_news_items(topic), *fetch_tavily_market_items(topic)]
        sources = build_research_pack(topic, leads)
    metadata = insight_pipeline.public_sources(sources)
    audit_dir = Path(os.environ.get("INSIGHT_AUDIT_DIR", ".artifacts/insights")) / slug
    recent = [{key: post.get(key, "") for key in ("title", "category", "excerpt")} for post in posts[:30]]
    articles = {}
    articles["zh"] = insight_pipeline.produce_article(topic, sources, api_key, recent_posts=recent,
                                                       audit_path=audit_dir / "zh.json", resume_audit=resume_audit,
                                                       editorial_revision=editorial_revision)
    articles.update(localize_reviewed_article(topic, sources, api_key, articles["zh"], audit_dir))
    author, initials = gb.deterministic_author(topic.title)
    publish_date = gb.today_publish_date()
    image = gb.image_url(topic)
    for lang, article in articles.items():
        article.update(date=publish_date, sources=metadata, sources_html=source_section(metadata, lang))

    # Stage all three complete, reviewed versions before touching any public index.
    if preview_dir is not None:
        preview_dir.mkdir(parents=True, exist_ok=True)
        for lang, article in articles.items():
            (preview_dir / f"{lang}.json").write_text(json.dumps(article, ensure_ascii=False, indent=2), encoding="utf-8")
            page = gb.article_html(topic, article, slug, author, initials) if lang == "zh" else i18n_site.localized_article_html(
                lang=lang, post={**article, "category": localized_category(lang), "author": author,
                "image": image, "url": f"{gb.SITE_URL}/{lang}/blog/articles/{slug}/"},
                body_html=article["body_html"] + article["sources_html"], initials=initials)
            (preview_dir / f"{lang}.html").write_text(page, encoding="utf-8")
        print(f"Reviewed preview written to {preview_dir}; site indexes untouched.", flush=True)
        return True

    article = articles["zh"]
    i18n_site.ensure_language_scaffold()
    article_dir = out_dir / "articles" / slug
    article_dir.mkdir(parents=True, exist_ok=True)
    article_dir.joinpath("index.html").write_text(gb.article_html(topic, article, slug, author, initials), encoding="utf-8")
    post = {
        "order": str(next_order(posts)), "row": str(topic.idx), "slug": slug,
        "title": article["title"], "excerpt": article["excerpt"], "category": topic.category,
        "tags": article["tags"], "author": author, "date": publish_date, "image": image,
        "url": f"{gb.SITE_URL}/blog/articles/{slug}/", "sources": metadata,
        "reviewed_by": gb.REVIEWER_NAME, "quality": article["quality"],
    }
    posts.insert(0, post)
    write_indexes(posts, out_dir)
    localized_posts = {}
    for lang in ("en", "ar"):
        localized_posts[lang] = write_localized_output(lang=lang, slug=slug, topic=topic,
            article=articles[lang], author=author, initials=initials, image=image,
            order=post["order"], date=publish_date)
    i18n_site.write_sitemap({"zh": posts, **localized_posts})
    authority_site.main()
    print(f"Generated reviewed daily insight: blog/articles/{slug}/", flush=True)
    return True


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--excel", default="assets/blog_articles.xlsx")
    parser.add_argument("--out", default="blog")
    parser.add_argument("--start-row", type=int, default=2)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--preview-dir", type=Path, help="Write reviewed preview only; do not update the site")
    parser.add_argument("--resume-dir", type=Path, help="Resume a failed Chinese audit after exact source revalidation")
    parser.add_argument("--editorial-revision", type=Path, help="Review an authored repair of the resumed Chinese draft")
    args = parser.parse_args()

    excel_path = Path(args.excel)
    if not excel_path.exists():
        raise FileNotFoundError(excel_path)
    generate_daily_article(excel_path, Path(args.out), args.start_row, args.dry_run, args.preview_dir, args.resume_dir,
                           args.editorial_revision)


if __name__ == "__main__":
    main()
