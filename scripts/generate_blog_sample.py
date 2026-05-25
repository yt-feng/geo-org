#!/usr/bin/env python3
"""Safe, resumable, concurrent category-sample blog generator.

Reads all rows from assets/blog_articles.xlsx, keeps N rows per category,
prints cost estimates and per-article progress, generates articles concurrently,
and can commit progress every N finished articles inside GitHub Actions.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import time
from collections import OrderedDict, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from threading import Lock
from typing import Dict, List, Optional, Tuple

import generate_blog as gb


def select_per_category(topics: List[gb.TopicRow], per_category_limit: int, max_articles: int) -> List[gb.TopicRow]:
    groups: "OrderedDict[str, List[gb.TopicRow]]" = OrderedDict()
    for topic in topics:
        cat = topic.category or "Brand GEO"
        groups.setdefault(cat, [])
        if len(groups[cat]) < per_category_limit:
            groups[cat].append(topic)
    selected: List[gb.TopicRow] = []
    for rows in groups.values():
        selected.extend(rows)
        if max_articles and len(selected) >= max_articles:
            return selected[:max_articles]
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


def git_commit_progress(message: str) -> None:
    """Commit and push generated progress. No-op if there are no staged changes."""
    try:
        subprocess.run(["git", "add", "blog", "sitemap.xml", "index.html"], check=True)
        diff = subprocess.run(["git", "diff", "--cached", "--quiet"])
        if diff.returncode == 0:
            print("  - checkpoint: no changes to commit", flush=True)
            return
        subprocess.run(["git", "commit", "-m", message], check=True)
        subprocess.run(["git", "push", "origin", "main"], check=True)
        print(f"  - checkpoint committed: {message}", flush=True)
    except Exception as exc:  # noqa: BLE001
        print(f"  - checkpoint commit failed but generation continues: {exc}", flush=True)


def write_indexes(posts: List[Dict[str, str]], out_dir: Path) -> None:
    posts_sorted = sorted(posts, key=lambda p: int(p.get("order", "0")))
    total = len(posts_sorted)
    for idx, post in enumerate(posts_sorted, start=1):
        post["title"] = gb.ensure_title_prefix(post.get("title", ""))
        post["tags"] = gb.ensure_required_tags(post.get("tags", ""))
        if not post.get("date"):
            post["date"] = gb.historical_publish_date(idx, total)
    per_page = 24
    total_pages = max(1, (len(posts_sorted) + per_page - 1) // per_page)
    (out_dir / "index.html").write_text(gb.index_page(posts_sorted, 1, per_page, total_pages, "../"), encoding="utf-8")
    page_root = out_dir / "page"
    for page in range(2, total_pages + 1):
        page_dir = page_root / str(page)
        page_dir.mkdir(parents=True, exist_ok=True)
        page_dir.joinpath("index.html").write_text(gb.index_page(posts_sorted, page, per_page, total_pages, "../../"), encoding="utf-8")
    (out_dir / "posts.json").write_text(json.dumps(posts_sorted, ensure_ascii=False, indent=2), encoding="utf-8")

    sitemap_items = [f"  <url><loc>{gb.SITE_URL}/</loc></url>", f"  <url><loc>{gb.SITE_URL}/brand-audit/</loc></url>", f"  <url><loc>{gb.SITE_URL}/blog/</loc></url>"]
    sitemap_items += [f"  <url><loc>{p['url']}</loc><lastmod>{p.get('date', '')}</lastmod></url>" for p in posts_sorted]
    Path("sitemap.xml").write_text('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + "\n".join(sitemap_items) + "\n</urlset>\n", encoding="utf-8")
    gb.patch_homepage(len(posts_sorted))


def load_existing_posts(out_dir: Path) -> List[Dict[str, str]]:
    posts_path = out_dir / "posts.json"
    if not posts_path.exists():
        return []
    try:
        return json.loads(posts_path.read_text(encoding="utf-8"))
    except Exception:
        return []


def generate_one(order: int, total: int, topic: gb.TopicRow, out_dir: Path, overwrite: bool) -> Tuple[bool, Dict[str, str], Optional[str]]:
    slug = gb.slugify(topic.title, topic.idx)
    article_dir = out_dir / "articles" / slug
    article_file = article_dir / "index.html"
    author, initials = gb.deterministic_author(topic.title)
    print(f"[{order}/{total}] START row={topic.idx} category={topic.category} title={topic.title}", flush=True)

    if article_file.exists() and not overwrite:
        print(f"[{order}/{total}] SKIP existing blog/articles/{slug}/", flush=True)
        existing = {
            "order": str(order),
            "row": str(topic.idx),
            "slug": slug,
            "title": gb.ensure_title_prefix(topic.title),
            "excerpt": f"围绕 {topic.title} 的品牌化 GEO 实践框架。",
            "category": topic.category,
            "tags": gb.ensure_required_tags(topic.keywords),
            "author": author,
            "date": gb.historical_publish_date(order, total),
            "image": gb.image_url(topic),
            "url": f"{gb.SITE_URL}/blog/articles/{slug}/",
        }
        return True, existing, None

    started = time.time()
    try:
        article = gb.deepseek_article(topic, os.environ["DEEPSEEK_API_KEY"])
        article["date"] = gb.historical_publish_date(order, total)
        article_dir.mkdir(parents=True, exist_ok=True)
        article_file.write_text(gb.article_html(topic, article, slug, author, initials), encoding="utf-8")
        post = {
            "order": str(order),
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
        print(f"[{order}/{total}] DONE in {time.time() - started:.1f}s", flush=True)
        return True, post, None
    except Exception as exc:  # noqa: BLE001
        print(f"[{order}/{total}] FAILED: {exc}", flush=True)
        return False, {}, str(exc)


def write_blog_concurrent(topics: List[gb.TopicRow], out_dir: Path, overwrite: bool, workers: int, commit_interval: int) -> None:
    if not os.environ.get("DEEPSEEK_API_KEY"):
        raise RuntimeError("DEEPSEEK_API_KEY is required in repository secrets")

    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "articles").mkdir(exist_ok=True)
    posts_by_slug: Dict[str, Dict[str, str]] = {p.get("slug", ""): p for p in load_existing_posts(out_dir) if p.get("slug")}
    lock = Lock()
    finished_since_commit = 0
    failures: List[str] = []
    total = len(topics)

    print(f"=== Generation mode ===", flush=True)
    print(f"Concurrency: {workers}", flush=True)
    print(f"Checkpoint commit interval: {commit_interval}", flush=True)

    with ThreadPoolExecutor(max_workers=max(1, workers)) as executor:
        futures = {
            executor.submit(generate_one, idx, total, topic, out_dir, overwrite): (idx, topic)
            for idx, topic in enumerate(topics, start=1)
        }
        for future in as_completed(futures):
            ok, post, error = future.result()
            with lock:
                if ok and post:
                    posts_by_slug[post["slug"]] = post
                elif error:
                    failures.append(error)
                finished_since_commit += 1
                write_indexes(list(posts_by_slug.values()), out_dir)
                if commit_interval and finished_since_commit >= commit_interval:
                    git_commit_progress(f"Checkpoint blog generation ({len(posts_by_slug)} posts)")
                    finished_since_commit = 0

    write_indexes(list(posts_by_slug.values()), out_dir)
    git_commit_progress(f"Generate sample blog articles ({len(posts_by_slug)} posts)")

    if failures:
        print(f"Completed with {len(failures)} failures. First failure: {failures[0]}", flush=True)
        raise SystemExit(2)
    print(f"Generated/available {len(posts_by_slug)} posts into {out_dir}/", flush=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--excel", default="assets/blog_articles.xlsx")
    parser.add_argument("--out", default="blog")
    parser.add_argument("--per-category-limit", type=int, default=10)
    parser.add_argument("--max-articles", type=int, default=0, help="0 means no global cap")
    parser.add_argument("--workers", type=int, default=5)
    parser.add_argument("--commit-interval", type=int, default=10)
    parser.add_argument("--overwrite", action="store_true")
    args = parser.parse_args()

    all_topics = gb.read_topics(Path(args.excel), start_row=2, limit=0)
    counts = defaultdict(int)
    for topic in all_topics:
        counts[topic.category or "Brand GEO"] += 1

    print("=== Excel category summary ===", flush=True)
    for category, count in sorted(counts.items(), key=lambda x: x[0]):
        print(f"{category}: {count}", flush=True)

    topics = select_per_category(all_topics, args.per_category_limit, args.max_articles)
    print(f"Selected {len(topics)} articles: up to {args.per_category_limit} per category; max_articles={args.max_articles}", flush=True)
    estimate_cost(len(topics))
    write_blog_concurrent(topics, Path(args.out), args.overwrite, args.workers, args.commit_interval)


if __name__ == "__main__":
    main()
