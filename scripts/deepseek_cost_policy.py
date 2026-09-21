"""Per-request off-peak admission and a durable, content-free batch ledger.

Pricing window source: https://api-docs.deepseek.com/quick_start/pricing/
Checked 2026-09-21. Weekday UTC 01-04 and 06-10 are blocked conservatively,
including Chinese holidays, so the policy needs no changing holiday calendar.
Unknown provider usage retains its full reservation; it is never reported as zero.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import re
import sys
import threading
import uuid

_LOCK = threading.RLock()


class CostDeferredError(RuntimeError):
    """Stop without retrying; saved editorial/translation work remains resumable."""


def utcnow():
    return datetime.now(timezone.utc)


def assert_offpeak(timeout_seconds=1200, *, now=None):
    now = now or utcnow()
    if now.tzinfo is None:
        raise ValueError("Cost policy requires a timezone-aware clock")
    now = now.astimezone(timezone.utc)
    if timeout_seconds <= 0:
        raise ValueError("Request deadline must be positive")
    # Include a one-minute boundary margin and the complete request deadline.
    finish = now + timedelta(seconds=timeout_seconds + 60)
    day = now.replace(hour=0, minute=0, second=0, microsecond=0)
    while day <= finish:
        if day.weekday() < 5:
            for start_hour, end_hour in ((1, 4), (6, 10)):
                start, end = day + timedelta(hours=start_hour), day + timedelta(hours=end_hour)
                if now < end and finish >= start:
                    raise CostDeferredError(
                        "DeepSeek deferred: request could overlap peak pricing; "
                        f"resume after {end.isoformat()}. Saved checkpoints are retained."
                    )
        day += timedelta(days=1)


def _path():
    return Path(os.environ.get("DEEPSEEK_USAGE_LOG", ".artifacts/usage/deepseek.jsonl"))


def _positive(name, default):
    value = int(os.environ.get(name, str(default)))
    if value <= 0:
        raise ValueError(f"{name} must be positive")
    return value


def _events(path):
    if not path.exists():
        return []
    try:
        return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]
    except (ValueError, OSError):
        raise CostDeferredError("DeepSeek deferred: usage ledger unreadable; refusing an unaccounted request") from None


def _append(path, event):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as stream:
        stream.write(json.dumps(event, sort_keys=True) + "\n")
        stream.flush()
        os.fsync(stream.fileno())


def _run_id():
    return os.environ.get("GITHUB_RUN_ID", "local") + ":" + os.environ.get("GITHUB_RUN_ATTEMPT", "1")


def begin_request(stage, payload, timeout_seconds):
    assert_offpeak(timeout_seconds)
    if not re.fullmatch(r"[A-Za-z0-9_.-]{1,80}", stage):
        raise ValueError("Invalid usage stage")
    # UTF-8 byte length deliberately overestimates prompt token count.
    reserve = len(json.dumps(payload.get("messages", []), ensure_ascii=False).encode()) + int(payload["max_tokens"]) + 4096
    if reserve <= 0:
        raise ValueError("Invalid token reservation")
    path, run_id = _path(), _run_id()
    with _LOCK:
        events = [event for event in _events(path) if event.get("run_id") == run_id]
        requests = {event["ticket"]: event for event in events if event.get("event") == "request"}
        completed = {event["ticket"]: event for event in events if event.get("event") == "result"}
        charged = sum(completed.get(ticket, {}).get("accounted_tokens", entry["reserved_tokens"])
                      for ticket, entry in requests.items())
        if len(requests) >= _positive("DEEPSEEK_MAX_RUN_REQUESTS", 12):
            raise CostDeferredError("DeepSeek deferred: run request budget reached; resume saved work in another run")
        if charged + reserve > _positive("DEEPSEEK_MAX_RUN_TOKENS", 600000):
            raise CostDeferredError("DeepSeek deferred: run token budget reached; resume saved work in another run")
        ticket = uuid.uuid4().hex
        _append(path, {"event": "request", "ticket": ticket, "run_id": run_id,
            "timestamp": utcnow().isoformat(), "stage": stage, "model": str(payload.get("model", ""))[:80],
            "reserved_tokens": reserve, "max_output_tokens": payload["max_tokens"],
            "pricing_window": "off_peak", "provider": "deepseek"})
        return ticket


def complete_request(ticket, usage=None, status="completed"):
    if status not in {"completed", "failed_unknown_usage"}:
        raise ValueError("Invalid usage status")
    usage = usage if isinstance(usage, dict) else {}
    safe = {key: usage[key] for key in ("prompt_tokens", "completion_tokens", "total_tokens",
            "prompt_cache_hit_tokens", "prompt_cache_miss_tokens")
            if type(usage.get(key)) is int and usage[key] >= 0}
    details = usage.get("completion_tokens_details", {})
    if isinstance(details, dict) and type(details.get("reasoning_tokens")) is int and details["reasoning_tokens"] >= 0:
        safe["reasoning_tokens"] = details["reasoning_tokens"]
    with _LOCK:
        path = _path()
        events = _events(path)
        if any(event.get("event") == "result" and event.get("ticket") == ticket for event in events):
            return
        request = next(event for event in events if event.get("event") == "request" and event.get("ticket") == ticket)
        observed = safe.get("total_tokens")
        if "prompt_tokens" in safe and "completion_tokens" in safe:
            observed = max(observed or 0, safe["prompt_tokens"] + safe["completion_tokens"])
        known = observed is not None and observed > 0
        _append(path, {"event": "result", "ticket": ticket, "run_id": request["run_id"],
            "timestamp": utcnow().isoformat(), "stage": request["stage"], "status": status,
            "usage": safe, "usage_known": known,
            "accounted_tokens": observed if known else request["reserved_tokens"]})


def usage_summary():
    events = [event for event in _events(_path()) if event.get("run_id") == _run_id()]
    requests = [event for event in events if event.get("event") == "request"]
    results = {event["ticket"]: event for event in events if event.get("event") == "result"}
    rows = {}
    for request in requests:
        row = rows.setdefault(request["stage"], {"requests": 0, "observed_tokens": 0,
            "reasoning_tokens": 0, "unknown_usage_requests": 0})
        result = results.get(request["ticket"], {})
        row["requests"] += 1
        if result.get("usage_known"):
            row["observed_tokens"] += result["accounted_tokens"]
            row["reasoning_tokens"] += result.get("usage", {}).get("reasoning_tokens", 0)
        else:
            row["unknown_usage_requests"] += 1
    report = {"run_id": _run_id(), "provider": "deepseek", "requests": len(requests), "stages": rows,
        "note": "Observed tokens exclude unknown usage; unknown calls keep their full reservation. Pure translation uses CPU only."}
    print(json.dumps(report, indent=2))
    destination = os.environ.get("GITHUB_STEP_SUMMARY")
    if destination:
        lines = ["### Paid generation usage", "", "Pure translation: pinned local CPU model; no paid fallback.", "",
            "| Stage | Requests | Observed tokens | Reasoning tokens | Unknown usage |",
            "|---|---:|---:|---:|---:|"]
        for stage, row in rows.items():
            lines.append(f"| {stage} | {row['requests']} | {row['observed_tokens']} | {row['reasoning_tokens']} | {row['unknown_usage_requests']} |")
        lines += ["", report["note"], ""]
        with Path(destination).open("a", encoding="utf-8") as stream:
            stream.write("\n".join(lines))
    return report


if __name__ == "__main__":
    if "--summary" in sys.argv:
        usage_summary()
    else:
        assert_offpeak()
        print("DeepSeek admission: off-peak for the next 21 minutes")
