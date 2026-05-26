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
import urllib.request
from pathlib import Path
from typing import Dict, List, Mapping, Optional

import enhance_blog_index
import generate_blog as gb
import i18n_site


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
7. Output strict JSON only. No Markdown code fences.
8. JSON fields: title, excerpt, body_html, tags.
9. body_html must be valid HTML with 4-6 h2 sections, p, ul/li, and strong tags.
10. tags may be an array or comma-separated string.
11. {direction_note}

Topic:
Title: {topic.title}
Category: {topic.category}
Keywords: {topic.keywords}

Chinese source article:
Title: {source_article.get("title", "")}
Excerpt: {source_article.get("excerpt", "")}
Body HTML:
{source_article.get("body_html", "")}
""".strip()
    payload = {
        "model": gb.MODEL,
        "messages": [
            {"role": "system", "content": "You produce localized Eco-GEO Brand GEO articles as clean JSON."},
            {"role": "user", "content": prompt},
        ],
        "temperature": gb.TEMPERATURE,
        "max_tokens": gb.MAX_TOKENS,
    }
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        gb.DEEPSEEK_URL,
        data=data,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    last_error: Optional[Exception] = None
    for attempt in range(1, gb.RETRIES + 1):
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                raw = resp.read().decode("utf-8")
            obj = json.loads(raw)
            content = obj["choices"][0]["message"]["content"].strip()
            return parse_model_json(content, source_article, lang)
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            wait = min(30, attempt * 4)
            print(f"DeepSeek {lang} attempt {attempt}/{gb.RETRIES} failed for row {topic.idx}: {exc}; retry in {wait}s")
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
    }
    article_dir = blog_dir / "articles" / slug
    article_dir.mkdir(parents=True, exist_ok=True)
    article_dir.joinpath("index.html").write_text(
        i18n_site.localized_article_html(lang=lang, post=post, body_html=article["body_html"], initials=initials),
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
    article = gb.deepseek_article(topic, api_key)
    article["date"] = gb.today_publish_date()
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
    }
    posts = [existing for existing in posts if existing.get("slug") != slug]
    posts.insert(0, post)
    write_indexes(posts, out_dir)
    localized_posts: Dict[str, List[Dict[str, str]]] = {}
    for lang in ("en", "ar"):
        localized_article = deepseek_localized_article(topic, article, lang, api_key)
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
