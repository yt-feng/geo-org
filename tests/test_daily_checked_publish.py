import importlib.util
import json
from pathlib import Path
import subprocess
import unittest

spec = importlib.util.spec_from_file_location("checked_publish", Path(__file__).parents[1] / "scripts/publish_checked_article.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class CheckedPublishTests(unittest.TestCase):
    SHA = "a" * 40
    BRANCH = "automation/daily-article-123-2"

    def setUp(self):
        self.calls = []
        self.clock = 0
        self.lists = 0
        self.result = "success"
        self.run_sha = self.SHA
        self.check_sha = self.SHA
        self.check_app = 15368
        self.check_run = 11
        self.check_result = "success"
        self.check_present = True
        self.status_result = "success"
        self.status_creator = 41898282
        self.status_run = 11
        self.status_sha = self.SHA
        self.cleanup_fails = False
        self.push_rejected = False

    def sleep(self, seconds):
        self.clock += seconds

    def execute(self, *args):
        self.calls.append(args)
        if args[:2] == ("git", "rev-parse"):
            return self.SHA
        if args[:3] == ("gh", "run", "list"):
            self.lists += 1
            # A previous successful run must never satisfy a new dispatch.
            old = {"databaseId": 10, "headSha": self.SHA,
                   "status": "completed", "conclusion": "success"}
            fresh = {"databaseId": 11, "headSha": self.run_sha,
                     "status": "completed", "conclusion": self.result}
            return json.dumps([old] if self.lists == 1 else [old, fresh])
        if args[:2] == ("gh", "api"):
            if "/statuses?" in args[2]:
                return json.dumps([{"id": 111, "context": module.STATUS_CONTEXT,
                    "state": self.status_result, "creator": {"id": self.status_creator},
                    "target_url": f"https://github.com/test/repo/actions/runs/{self.status_run}"}])
            if "/status?" in args[2]:
                return json.dumps({"sha": self.status_sha, "statuses": [{
                    "id": 111, "context": module.STATUS_CONTEXT, "state": self.status_result,
                    "target_url": f"https://github.com/test/repo/actions/runs/{self.status_run}"}]})
            check = {"name": module.CHECK_NAME, "head_sha": self.check_sha,
                     "app": {"id": self.check_app}, "status": "completed",
                     "conclusion": self.check_result,
                     "details_url": f"https://github.com/test/repo/actions/runs/{self.check_run}/job/22"}
            return json.dumps({"check_runs": [check] if self.check_present else []})
        if args[-1] == f"{self.SHA}:refs/heads/main" and self.push_rejected:
            raise subprocess.CalledProcessError(1, args, stderr="non-fast-forward")
        if "--delete" in args and self.cleanup_fails:
            raise subprocess.CalledProcessError(1, args)
        return ""

    def publish(self):
        return module.publish("test/repo", self.BRANCH, run=self.execute,
            monotonic=lambda: self.clock, sleep=self.sleep, timeout=20)

    def main_pushes(self):
        return [call for call in self.calls if call[-1] == f"{self.SHA}:refs/heads/main"]

    def test_success_dispatches_and_verifies_exact_commit_before_main(self):
        self.assertEqual(self.publish(), self.SHA)
        self.assertEqual(len(self.main_pushes()), 1)
        api_index = next(i for i, call in enumerate(self.calls) if call[:2] == ("gh", "api"))
        self.assertGreater(self.calls.index(self.main_pushes()[0]), api_index)

    def test_failed_cancelled_or_skipped_gate_never_publishes(self):
        for result in ("failure", "cancelled", "skipped", "timed_out"):
            with self.subTest(result=result):
                self.setUp()
                self.result = result
                with self.assertRaises(RuntimeError): self.publish()
                self.assertEqual(self.main_pushes(), [])
                self.assertFalse(any("--delete" in call for call in self.calls))

    def test_success_for_other_sha_does_not_reuse_old_success(self):
        self.run_sha = "b" * 40
        with self.assertRaises(TimeoutError): self.publish()
        self.assertEqual(self.main_pushes(), [])
        self.assertEqual(self.clock, 20)

    def test_untrusted_or_mismatched_check_never_publishes(self):
        for field, value in (("check_sha", "b" * 40), ("check_app", 99),
                             ("check_run", 10), ("check_result", "failure"),
                             ("check_present", False)):
            with self.subTest(field=field):
                self.setUp()
                setattr(self, field, value)
                with self.assertRaises(RuntimeError): self.publish()
                self.assertEqual(self.main_pushes(), [])

    def test_concurrent_main_update_is_not_force_pushed_or_discarded(self):
        self.push_rejected = True
        with self.assertRaises(subprocess.CalledProcessError): self.publish()
        self.assertFalse(any("--force" in call or "--delete" in call for call in self.calls))

    def test_pending_failed_foreign_or_stale_commit_status_never_publishes(self):
        for field, value in (("status_result", "pending"), ("status_result", "failure"),
                             ("status_creator", 1), ("status_run", 10),
                             ("status_sha", "b" * 40)):
            with self.subTest(field=field, value=value):
                self.setUp()
                setattr(self, field, value)
                with self.assertRaises(RuntimeError): self.publish()
                self.assertEqual(self.main_pushes(), [])

    def test_cleanup_failure_does_not_report_published_article_as_failed(self):
        self.cleanup_fails = True
        self.assertEqual(self.publish(), self.SHA)
        self.assertEqual(len(self.main_pushes()), 1)

    def test_invalid_branch_is_rejected_before_any_command(self):
        with self.assertRaises(ValueError):
            module.publish("test/repo", "main", run=self.execute)
        self.assertEqual(self.calls, [])

    def test_all_automated_article_writers_can_pass_the_required_gate(self):
        workflows = Path(__file__).parents[1] / ".github/workflows"
        for name in ("generate-daily-blog.yml", "generate-blog.yml", "generate-blog-sample.yml"):
            with self.subTest(workflow=name):
                text = (workflows / name).read_text()
                self.assertIn("scripts/publish_checked_article.py", text)
                for permission in ("actions: write", "checks: read", "contents: write"):
                    self.assertIn(permission, text)
                self.assertIn("GH_TOKEN: ${{ github.token }}", text)
                self.assertNotIn("git push origin", text)


if __name__ == "__main__":
    unittest.main()
