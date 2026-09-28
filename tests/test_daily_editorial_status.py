import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("editorial_status", Path(__file__).parents[1] / "scripts/report_editorial_status.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class EditorialStatusTests(unittest.TestCase):
    def setUp(self):
        self.env = dict(GH_REPO="test/repo", TESTED_SHA="a" * 40,
                        GITHUB_SHA="a" * 40, GITHUB_RUN_ID="123", JOB_STATUS="success")
        self.env.update({key: "success" for key in module.REQUIRED})

    def test_success_is_bound_to_exact_tested_commit_and_run(self):
        args = module.status_arguments(self.env)
        self.assertIn("state=success", args)
        self.assertIn("repos/test/repo/statuses/" + "a" * 40, args)
        self.assertIn("target_url=https://github.com/test/repo/actions/runs/123", args)

    def test_skipped_missing_failed_or_cancelled_validation_cannot_report_success(self):
        for key in (*module.REQUIRED, "JOB_STATUS"):
            for outcome in ("", "skipped", "failure", "cancelled"):
                with self.subTest(key=key, outcome=outcome):
                    args = module.status_arguments(dict(self.env, **{key: outcome}))
                    self.assertIn("state=failure", args)

    def test_pull_request_reports_only_its_explicitly_checked_out_head(self):
        env = dict(self.env, GITHUB_SHA="b" * 40, EXPECTED_CHECKOUT_SHA="a" * 40)
        self.assertIn("repos/test/repo/statuses/" + "a" * 40, module.status_arguments(env))
        # A job that accidentally tested the synthetic merge still cannot mark
        # the different pull-request head as verified.
        with self.assertRaises(ValueError):
            module.status_arguments(dict(env, TESTED_SHA="b" * 40))

    def test_wrong_commit_or_malformed_identity_never_creates_status(self):
        for key, value in (("GITHUB_SHA", "b" * 40), ("GH_REPO", "../main"),
                           ("GITHUB_RUN_ID", "unknown"), ("TESTED_SHA", "main")):
            with self.subTest(key=key):
                with self.assertRaises(ValueError):
                    module.status_arguments(dict(self.env, **{key: value}))


if __name__ == "__main__":
    unittest.main()
