#!/usr/bin/env python3
"""Safe category-sample blog generator.

Reads all rows from assets/blog_articles.xlsx, keeps N rows per category,
prints cost estimates and per-article progress, then delegates page rendering
helpers from generate_blog.py.
"""
from __future__ import annotations

import argparse
import json
import os
import time
from collections import OrderedDict, defaultdict
from pathlib import Path
from typing import Dict, List

import generate_blog as gb


def select_per_category(topics: List[gb.TopicRow], per_category_limit: int) -> List[gb.TopicRow]:
    groups: "OrderedDict[str, List[gb.TopicRow]]" = OrderedDict()
    for topic in topics:
        cat = topic.category or "Brand GEO"
        groups.setdefault(cat, [])
        if len(groups[cat]) < per_category_limit:
            groups[cat].append(topic)
    selected: List[gb.TopicRow] = []
    for rows in groups.values():
        selected.extend(rows)
    return selected


def estimate_cost(article_count: int) -> None:
    input_per_article = int(os.environ.get("EST_INPUT_TOKENS_PER_ARTICLE", "1800"))
    output_per_article = int(os.environ.get("EST_OUTPUT_TOKENS_PER_ARTICLE", "2200"))
    input_price = float(os.environ.get("DEEPSEEK_PRICE_INPUT_PER_M", "2"))
    output_price = float(os.environ.get("DEEPSEEK_PRICE_OUTPUT_PER_M", "8"))
    currency = os.environ.get("DEEPSEEK_PRICE_CURRENCY", "CNY")
    in_tokens = article_count * input_per_article
    out_tokens = article_count * output_per_article
    cost = in_tokens / 1_000_000 * input_price + out_tokens / 1_000_000 * output_price
    print("=== Blog generation estimate ===", flush=True)
    print(f"Articles: {article_count}", flush=True)
    print(f"Estimated input tokens: {in_tokens:,}", flush=True)
    print(f"Estimated output tokens: {out_tokens:,}", flush=True)
    print(f"Estimated DeepSeek cost: {cost:.2f} {currency}", flush=True)
    print("Pricing is only an estimate; check DeepSeek billing for the final amount.", flush=True)


def write_blog_verbose(topics: List[gb.TopicRow], out_dir: Path, overwrite: bool) -> None:
    api_key = os.environ.get("DEEPSEEK_API_KEY")
    if not api_key:
        raise RuntimeError("DEEPSEEK_API_KEY is required in repository secrets")

    out_dir.mkdir(parents=True, exist_ok=True)
    articles_dir = out_dir / "articles"
    articles_dir.mkdir(exist_ok=True)

    posts: List[Dict[str, str]] = []
    total = len(topics)
    for n, topic in enumerate(topics, start=1):
        slug = gb.slugify(topic.title, topic.idx)
        article_dir = articles_dir / slug
        article_file = article_dir / "index.html"
        author, initials = gb.deterministic_author(topic.title)
        print(f"[{n}/{total}] row={topic.idx} category={topic.category} title={topic.title}", flush=True)

        if article_file.exists() and not overwrite:
            print(f"  - skip existing: blog/articles/{slug}/", flush=True)
            article = {
                "title": topic.title,
                "excerpt": f"围绕 {topic.title} 的品牌化 GEO 实践框架。",
                "tags": topic.keywords,
                "body_html": "",
            }
        else:
            print("  - calling DeepSeek...", flush=True)
            started = time.time()
            article = gb.deepseek_article(topic, api_key)
            article_dir.mkdir(parents=True, exist_ok=True)
            article_file.write_text(gb.article_html(topic, article, slug, author, initials), encoding="utf-8")
            print(f"  - done in {time.time() - started:.1f}s", flush=True)
            time.sleep(gb.REQUEST_DELAY)

        posts.append({
            "row": str(topic.idx),
            "slug": slug,
            "title": article["title"],
            "excerpt": article["excerpt"],
            "category": topic.category,
            "tags": article["tags"],
            "author": author,
            "image": gb.image_url(topic),
            "url": f"{gb.SITE_URL}/blog/articles/{slug}/",
        })

    per_page = 24
    total_pages = max(1, (len(posts) + per_page - 1) // per_page)
    (out_dir / "index.html").write_text(gb.index_page(posts, 1, per_page, total_pages, "../"), encoding="utf-8")
    page_root = out_dir / "page"
    for page in range(2, total_pages + 1):
        page_dir = page_root / str(page)
        page_dir.mkdir(parents=True, exist_ok=True)
        page_dir.joinpath("index.html").write_text(gb.index_page(posts, page, per_page, total_pages, "../../"), encoding="utf-8")
    (out_dir / "posts.json").write_text(json.dumps(posts, ensure_ascii=False, indent=2), encoding="utf-8")

    sitemap_items = [f"  <url><loc>{gb.SITE_URL}/</loc></url>", f"  <url><loc>{gb.SITE_URL}/blog/</loc></url>"]
    sitemap_items += [f"  <url><loc>{p['url']}</loc></url>" for p in posts]
    Path("sitemap.xml").write_text('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + "\n".join(sitemap_items) + "\n</urlset>\n", encoding="utf-8")
    gb.patch_homepage(len(posts))
    print(f"Generated {len(posts)} posts into {out_dir}/", flush=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--excel", default="assets/blog_articles.xlsx")
    parser.add_argument("--out", default="blog")
    parser.add_argument("--per-category-limit", type=int, default=10)
    parser.add_argument("--overwrite", action="store_true")
    args = parser.parse_args()

    all_topics = gb.read_topics(Path(args.excel), start_row=2, limit=0)
    counts = defaultdict(int)
    for topic in all_topics:
        counts[topic.category or "Brand GEO"] += 1

    print("=== Excel category summary ===", flush=True)
    for category, count in sorted(counts.items(), key=lambda x: x[0]):
        print(f"{category}: {count}", flush=True)

    topics = select_per_category(all_topics, args.per_category_limit)
    print(f"Selected {len(topics)} articles: up to {args.per_category_limit} per category", flush=True)
    estimate_cost(len(topics))
    write_blog_verbose(topics, Path(args.out), args.overwrite)


if __name__ == "__main__":
    main()
