"""Metadata-only, revalidated candidate history for daily source discovery.

No record here is article evidence. Its URL must pass the normal network fetch,
body, industry, diversity and excerpt checks again before entering a research pack.
"""
from __future__ import annotations

from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import tempfile
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
SEED_PATH = Path(__file__).with_name("research_source_catalog_seed.json")
POSTS_PATH = ROOT / "blog/posts.json"
MAX_RECORDS = 500
MAX_PER_INDUSTRY = 8
MAX_CATALOG_BYTES = 2_000_000
FIELDS = ("url", "title", "publisher", "publisher_domain", "published", "retrieved_at",
          "retrieval_method", "evidence_kind", "evidence_role", "industries", "scope_notes",
          "text_sha256", "body_chars", "excerpt_start", "excerpt_end", "excerpt_truncated")


def cache_path() -> Path | None:
    value = os.environ.get("RESEARCH_CATALOG_PATH", "").strip()
    return Path(value) if value else None


def validate_record(record: object, *, now: datetime | None = None) -> dict | None:
    """Require a historical real-read receipt, never an ordinary citation."""
    from insight_research import TRUSTED_HOSTS, validate_source_url, ResearchError

    if not isinstance(record, dict) or "text" in record or "body" in record:
        return None
    try:
        url = validate_source_url(record["url"])
        if url != record["url"] or record.get("retrieval_method") not in {"https_fetch", "https_pdf_text"}:
            return None
        if record.get("publisher_domain") != TRUSTED_HOSTS[urlsplit(url).hostname][0]:
            return None
        if record.get("evidence_kind") != TRUSTED_HOSTS[urlsplit(url).hostname][2]:
            return None
        if record.get("evidence_role") != "industry_context":
            return None
        if not isinstance(record.get("publisher"), str) or not 1 <= len(record["publisher"]) <= 400:
            return None
        published = record.get("published", "")
        if not isinstance(published, str) or (published and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", published)):
            return None
        industries = record["industries"]
        if not isinstance(industries, list) or not industries or any(
                not isinstance(value, str) or not value.strip() or len(value) > 120 for value in industries):
            return None
        if not isinstance(record["title"], str) or not record["title"].strip() or len(record["title"]) > 1000:
            return None
        if not isinstance(record["scope_notes"], str) or not record["scope_notes"].strip() or len(record["scope_notes"]) > 8000:
            return None
        if not re.fullmatch(r"[0-9a-f]{64}", record["text_sha256"]):
            return None
        retrieved = datetime.fromisoformat(record["retrieved_at"].replace("Z", "+00:00"))
        if retrieved.tzinfo is None or retrieved > (now or datetime.now(timezone.utc)):
            return None
        if published and datetime.strptime(published, "%Y-%m-%d").date() > retrieved.date():
            return None
        start, end, total = (record[key] for key in ("excerpt_start", "excerpt_end", "body_chars"))
        if any(type(value) is not int for value in (start, end, total)) or not (0 <= start < end <= total):
            return None
        if not 300 <= end - start <= 10000:
            return None
        if type(record["excerpt_truncated"]) is not bool or record["excerpt_truncated"] != (start > 0 or end < total):
            return None
    except (KeyError, TypeError, ValueError, AttributeError, ResearchError):
        return None
    result = {key: record[key] for key in FIELDS if key in record}
    result["retrieved_at"] = retrieved.astimezone(timezone.utc).isoformat(timespec="seconds")
    return result


def _read_records(path: Path, *, posts: bool = False) -> list:
    if not path.is_file():
        return []
    try:
        # posts.json is the existing publication inventory, not this bounded
        # cache. Read only its public source metadata, never article HTML.
        if not posts and path.stat().st_size > MAX_CATALOG_BYTES:
            raise ValueError("catalog byte limit exceeded")
        value = json.loads(path.read_text(encoding="utf-8"))
        if posts:
            if not isinstance(value, list):
                raise ValueError("invalid posts inventory")
            result = []
            for post in value:
                if isinstance(post, dict) and isinstance(post.get("sources"), list):
                    result.extend(post["sources"])
            return result
        if not isinstance(value, dict) or value.get("version") != 1 or not isinstance(value.get("sources"), list):
            raise ValueError("invalid catalog schema")
        return value["sources"]
    except (OSError, ValueError, TypeError) as exc:
        print(f"Research catalog ignored ({path.name}): {type(exc).__name__}", flush=True)
        return []


def records(*, extra: dict | None = None) -> list[dict]:
    """Merge checked seeds, publication receipts and a failed-run cache safely."""
    path = cache_path()
    if path is None:
        return []
    entries = [*_read_records(SEED_PATH), *_read_records(POSTS_PATH, posts=True), *_read_records(path)]
    # Separate producer snapshots prevent a slower generator overwriting the
    # newer preflight history. Both workflows restore both fixed cache paths.
    peer = os.environ.get("RESEARCH_CATALOG_PEER_PATH", "").strip()
    if peer:
        entries.extend(_read_records(Path(peer)))
    if extra is not None:
        entries.append(extra)
    unique = {}
    for entry in entries:
        record = validate_record(entry)
        if record is None:
            continue
        # Keep distinct verified industry scopes for a shared publisher URL.
        key = (record["url"], tuple(sorted(set(record["industries"]))))
        prior = unique.get(key)
        if prior is None or datetime.fromisoformat(record["retrieved_at"]) > datetime.fromisoformat(prior["retrieved_at"]):
            unique[key] = record
    ordered = sorted(unique.values(), key=lambda row: datetime.fromisoformat(row["retrieved_at"]), reverse=True)
    retained, per_industry = [], {}
    for row in ordered:
        if all(per_industry.get(industry, 0) >= MAX_PER_INDUSTRY for industry in row["industries"]):
            continue
        retained.append(row)
        for industry in row["industries"]:
            per_industry[industry] = per_industry.get(industry, 0) + 1
        if len(retained) == MAX_RECORDS:
            break
    return retained


def candidates() -> list[dict]:
    # Internal transport/fixture fields can never arrive from this file.
    grouped = {}
    for record in records():
        grouped.setdefault(record["url"], []).append(record)
    result = []
    for receipts in grouped.values():
        # A past publication date is not a new read of the page's date metadata.
        # Do not let a historical receipt become a curated date fallback.
        candidate = {key: receipts[0][key] for key in ("url", "title")}
        candidate["industries"] = sorted({industry for row in receipts for industry in row["industries"]})
        scopes = []
        for scope in sorted({row["scope_notes"] for row in receipts}, key=len, reverse=True):
            if not any(scope in existing for existing in scopes):
                scopes.append(scope)
        candidate["scope_notes"] = " ".join(scopes)
        result.append(candidate)
    return result


def _write(path: Path, entries: list[dict]) -> None:
    entries = list(entries)
    original_count = len(entries)
    while True:
        payload = json.dumps({"version": 1, "metadata_only": True, "sources": entries}, ensure_ascii=False, indent=2)
        if len(payload.encode("utf-8")) <= MAX_CATALOG_BYTES:
            break
        if not entries:
            raise ValueError("Research catalog limit cannot fit its header")
        entries.pop()  # Oldest first, preserving the newest successful reads.
    if len(entries) < original_count:
        print(f"Research catalog pruned {original_count - len(entries)} older receipts to its byte limit", flush=True)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as file:
            temporary = Path(file.name)
            file.write(payload)
        temporary.replace(path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def _persist(path: Path, entries: list[dict]) -> None:
    try:
        _write(path, entries)
    except (OSError, ValueError) as exc:
        # This catalog is a discovery aid, never a new dependency for already
        # verified evidence. Preserve the old atomic file and report the fault.
        print(f"Research catalog persistence unavailable: {type(exc).__name__}; verified sources remain usable", flush=True)


def remember(source: dict) -> None:
    path = cache_path()
    if path is None:
        return
    # Source text is deliberately discarded before validating/persisting.
    receipt = validate_record({key: source[key] for key in FIELDS if key in source})
    if receipt is not None:
        _persist(path, records(extra=receipt))


def promote() -> None:
    """Commit the cumulative receipts with a successfully checked publication."""
    if cache_path() is None:
        raise ValueError("RESEARCH_CATALOG_PATH is required")
    _persist(SEED_PATH, records())


if __name__ == "__main__":
    promote()
