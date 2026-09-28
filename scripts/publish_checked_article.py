"""Publish generated commits only after the required check passes on that SHA.

GITHUB_TOKEN pushes do not start push workflows. Explicit workflow_dispatch on
the staging branch creates the check before the protected main branch moves.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import time

WORKFLOW = "editorial-regressions.yml"
CHECK_NAME = "Editorial regression gate"
STATUS_CONTEXT = "Editorial verified commit"


def command(*args):
    return subprocess.run(args, check=True, capture_output=True, text=True,
                          timeout=90).stdout.strip()


def publish(repo, branch, *, run=command, sleep=time.sleep,
            monotonic=time.monotonic, timeout=900):
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9-]*/[A-Za-z0-9_][A-Za-z0-9_.-]*", repo):
        raise ValueError("Invalid repository")
    if not re.fullmatch(r"automation/daily-article-[0-9]+-[0-9]+", branch):
        raise ValueError("Invalid staging branch")
    sha = run("git", "rev-parse", "HEAD")
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise ValueError("Invalid commit SHA")
    deadline = monotonic() + timeout
    run("git", "push", "origin", f"{sha}:refs/heads/{branch}")

    def runs():
        return json.loads(run("gh", "run", "list", "--repo", repo,
            "--workflow", WORKFLOW, "--branch", branch, "--event",
            "workflow_dispatch", "--limit", "20", "--json",
            "databaseId,headSha,status,conclusion"))

    previous = {item["databaseId"] for item in runs()}
    run("gh", "workflow", "run", WORKFLOW, "--repo", repo, "--ref", branch)
    while monotonic() < deadline:
        candidates = [item for item in runs()
                      if item["headSha"] == sha and item["databaseId"] not in previous]
        if candidates:
            candidate = max(candidates, key=lambda item: item["databaseId"])
            if candidate["status"] == "completed":
                if candidate["conclusion"] != "success":
                    raise RuntimeError(f"Editorial check {candidate['databaseId']} "
                                       f"ended {candidate['conclusion']}; main unchanged")
                checks = json.loads(run("gh", "api",
                    f"repos/{repo}/commits/{sha}/check-runs?per_page=100"))
                matched = [item for item in checks["check_runs"]
                           if item["name"] == CHECK_NAME
                           and item.get("head_sha") == sha
                           and item.get("app", {}).get("id") == 15368
                           and f"/actions/runs/{candidate['databaseId']}/" in item.get("details_url", "")]
                if not matched or any(item["status"] != "completed" or
                                      item["conclusion"] != "success" for item in matched):
                    raise RuntimeError("Required editorial check is absent or unsuccessful; main unchanged")
                statuses = json.loads(run("gh", "api",
                    f"repos/{repo}/commits/{sha}/status?per_page=100"))
                required = [item for item in statuses.get("statuses", [])
                            if item.get("context") == STATUS_CONTEXT]
                expected_url = f"https://github.com/{repo}/actions/runs/{candidate['databaseId']}"
                if (len(required) != 1 or required[0].get("state") != "success" or
                        required[0].get("target_url") != expected_url or
                        statuses.get("sha") != sha):
                    raise RuntimeError("Required commit status is absent, stale or unsuccessful; main unchanged")
                # Combined statuses omit creator. Bind its exact status ID to
                # the full status record rather than guessing its author.
                history = json.loads(run("gh", "api",
                    f"repos/{repo}/commits/{sha}/statuses?per_page=100"))
                authored = [item for item in history if item.get("id") == required[0].get("id")
                            and item.get("context") == STATUS_CONTEXT
                            and item.get("state") == "success"
                            and item.get("target_url") == expected_url
                            and item.get("creator", {}).get("id") == 41898282]
                if len(authored) != 1:
                    raise RuntimeError("Required commit status has an untrusted source; main unchanged")
                # A concurrent main update is rejected by this ordinary push.
                # Keep the staging branch and article for recovery on any failure.
                run("git", "push", "origin", f"{sha}:refs/heads/main")
                try:
                    run("git", "push", "origin", "--delete", branch)
                except (subprocess.SubprocessError, OSError):
                    print(f"Article published; staging branch retained: {branch}")
                print(f"Published {sha} after editorial run {candidate['databaseId']}")
                return sha
        sleep(min(10, max(0, deadline - monotonic())))
    raise TimeoutError(f"Editorial check deadline exceeded; main unchanged, saved branch: {branch}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", default=os.environ.get("GITHUB_REPOSITORY", ""))
    parser.add_argument("--branch", required=True)
    args = parser.parse_args()
    publish(args.repo, args.branch)


if __name__ == "__main__":
    main()
