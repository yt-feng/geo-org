"""Report actual editorial outcomes as a required, source-bound commit status."""
from __future__ import annotations

import os
import re
import subprocess

CONTEXT = "Editorial verified commit"
REQUIRED = ("IDENTITY_OUTCOME", "PYTHON_OUTCOME", "NODE_OUTCOME",
            "DEPENDENCIES_OUTCOME", "VERIFY_OUTCOME")


def status_arguments(env):
    repo, sha, expected = (env.get(key, "") for key in
                           ("GH_REPO", "TESTED_SHA", "GITHUB_SHA"))
    run_id = env.get("GITHUB_RUN_ID", "")
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9-]*/[A-Za-z0-9_][A-Za-z0-9_.-]*", repo):
        raise ValueError("Invalid repository")
    if not re.fullmatch(r"[0-9a-f]{40}", sha) or sha != expected:
        raise ValueError("Checked-out SHA differs from the workflow event")
    if not re.fullmatch(r"[0-9]+", run_id):
        raise ValueError("Invalid workflow run")
    state = "success" if (env.get("JOB_STATUS") == "success" and
                           all(env.get(key) == "success" for key in REQUIRED)) else "failure"
    return ["gh", "api", "--method", "POST", f"repos/{repo}/statuses/{sha}",
            "-f", f"state={state}", "-f", f"context={CONTEXT}",
            "-f", "description=Editorial build and regression tests " + state,
            "-f", f"target_url=https://github.com/{repo}/actions/runs/{run_id}"]


def main():
    # API failure must fail the job; no silent success or credential output.
    subprocess.run(status_arguments(os.environ), check=True,
                   stdout=subprocess.DEVNULL, timeout=90)


if __name__ == "__main__":
    main()
