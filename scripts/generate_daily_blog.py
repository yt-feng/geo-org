#!/usr/bin/env python3
"""Generate one new blog article from the Excel topic backlog.

Designed for a scheduled GitHub Actions run. It keeps existing posts,
selects the first topic that has not been generated yet, writes one article,
refreshes blog indexes and sitemap, then lets the workflow commit the diff.
"""
from __future__ import annotations

import argparse
import json
import os
import time
from pathlib import Path
from typing import Dict, List, Optional

import enhance_blog_index
import generate_blog as gb


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

    author, initials = gb.deterministic_author(topic.title)
    article = gb.deepseek_article(topic, api_key)
    article["date"] = gb.today_publish_date()
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
        "image": gb.image_url(topic),
        "url": f"{gb.SITE_URL}/blog/articles/{slug}/",
    }
    posts = [existing for existing in posts if existing.get("slug") != slug]
    posts.insert(0, post)
    write_indexes(posts, out_dir)
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
