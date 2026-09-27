#!/usr/bin/env python3
"""Check original-source availability for pending topics without drafting or publishing.

The report stores provenance and failure reasons, never third-party source text.
Run explicitly to validate today's backlog plus following days before a release.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path

import generate_daily_blog as daily
import insight_pipeline


def check_pending_topics(excel_path: Path, out_dir: Path, count: int) -> dict:
    if not 1 <= count <= 5:
        raise ValueError("Topic count must be between 1 and 5")
    topics = daily.gb.read_topics(excel_path, start_row=2, limit=0)
    selected_posts = list(daily.load_posts(out_dir))
    report = {"checked_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
              "requested_topics": count, "checks": [], "passed": True,
              "drafting_requests": 0, "publication_writes": 0}
    for _ in range(count):
        topic = daily.select_next_topic(topics, selected_posts, out_dir)
        if topic is None:
            break
        selected_posts.append({"row": str(topic.idx)})
        check = {"row": topic.idx, "title": topic.title, "passed": False}
        try:
            leads = [*daily.fetch_news_items(topic), *daily.fetch_tavily_market_items(topic)]
            sources = daily.build_research_pack(topic, leads)
            check.update(passed=True, sources=insight_pipeline.public_sources(sources))
            print(f"Research row {topic.idx}: {len(sources)} source bodies verified", flush=True)
        except Exception as exc:
            check["error"] = f"{type(exc).__name__}: {exc}"
            report["passed"] = False
            print(f"Research row {topic.idx}: {check['error']}", flush=True)
        report["checks"].append(check)
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--excel", type=Path, default=Path("assets/blog_articles.xlsx"))
    parser.add_argument("--out", type=Path, default=Path("blog"))
    parser.add_argument("--count", type=int, default=3)
    parser.add_argument("--report", type=Path, default=Path(".artifacts/research-preflight.json"))
    args = parser.parse_args()
    report = check_pending_topics(args.excel, args.out, args.count)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
