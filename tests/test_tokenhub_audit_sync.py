"""Offline fixtures only; never starts Wrangler or accesses a remote database."""
import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("audit_sync", ROOT / "scripts/tokenhub-audit-sync.py")
sync = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(sync)


def fixture():
    campaign = {"id": "campaign'quoted", "state": "active", "started_at": "2026-10-18T00:00:00.000Z", "ends_at": "2026-10-25T00:00:00.000Z", "budget_micros": 5_000_000,
                "key_hint": "••••abcd", "catalog_json": "{}", "catalog_hash": "a" * 64, "plan_version": "tokenhub-audit-v1", "pause_reason": None,
                "created_at": "2026-10-18T00:00:00.000Z", "updated_at": "2026-10-18T00:00:00.000Z", "encrypted_key": "FORBIDDEN_CIPHERTEXT"}
    row = {"campaign_id": campaign["id"], "slot": 0, "case_id": sync.CHAT_MODELS[0] + ":short", "kind": "chat", "model": sync.CHAT_MODELS[0], "state": "succeeded",
           "reserved_micros": 30000, "request_json": '{"messages":[{"role":"user","content":"test"}]}', "request_hash": "b" * 64,
           "expected_json": '{"answers":[1,2,3,4],"nonce":"n"}', "price_json": "{}", "price_hash": "c" * 64,
           "response_json": '{"choices":[{"message":{"content":"answer"}}]}', "response_hash": "d" * 64, "flags_json": "[]", "http_status": 200,
           "submitted_at": "2026-10-18T00:01:00.000Z", "updated_at": "2026-10-18T00:02:00.000Z"}
    analysis = {"schemaVersion": 1, "campaignId": campaign["id"], "cases": [{"slot": row["slot"], "caseId": row["case_id"], "kind": "chat", "requestedModel": row["model"],
                "requestHash": row["request_hash"], "responseHash": row["response_hash"], "status": "provisional", "findings": ["quote ' and Unicode 测试"], "tokenVerification": "provisional_local_counts_not_model_authentication"}]}
    return campaign, row, analysis


class AuditSyncTests(unittest.TestCase):
    def test_wranger_envelopes_and_errors(self):
        row = {"id": "campaign"}
        for value in [[{"results": [row], "success": True}], {"result": [{"results": [row], "success": True}], "success": True}, {"results": [row], "success": True}]:
            self.assertEqual(sync.wrangler_rows(value), [row])
        for value in [{"success": False, "result": []}, [{"success": False, "results": []}], "unexpected", {"results": ["bad"]}]:
            with self.assertRaises(sync.SyncError):
                sync.wrangler_rows(value)

    def test_explicit_column_export_contains_all_planned_slots_and_no_secret(self):
        campaign, row, _ = fixture()
        queries = []
        def query(**kwargs):
            queries.append(kwargs["command"])
            return [campaign] if len(queries) == 1 else [row]
        saved_campaign, rows = sync.current_snapshot(query)
        data = sync.evidence(saved_campaign, rows, sync.parse_time("2026-10-18T01:00:00Z"))
        self.assertEqual(len(data["cases"]), 116)
        self.assertEqual(data["counts"]["succeeded"], 1)
        self.assertEqual(data["counts"]["planned"], 115)
        self.assertEqual(data["campaign"]["reservedMicros"], 30000)
        self.assertEqual(data["campaign"]["plannedReservationMicros"], 4_540_000)
        self.assertEqual(data["cases"][0]["responseHash"], row["response_hash"])
        self.assertEqual(data["cases"][0]["request"]["messages"][0]["content"], "test")
        self.assertNotIn("encrypted_key", json.dumps(data))
        self.assertNotIn("FORBIDDEN_CIPHERTEXT", json.dumps(data))
        for query in queries:
            self.assertNotIn("*", query)
            self.assertNotIn("encrypted_key", query)
        self.assertIn("campaign''quoted", queries[1])

    def test_planned_budget_preserves_two_calibration_reservations(self):
        campaign, row, _ = fixture()
        now = sync.parse_time("2026-10-18T01:00:00Z")
        fresh = sync.evidence(campaign, [], now)
        self.assertEqual(fresh["campaign"]["plannedReservationMicros"], 4_520_000)
        long_row = dict(row, case_id=sync.CHAT_MODELS[0] + ":long")
        calibrated = sync.evidence(campaign, [row, long_row], now)
        self.assertEqual(calibrated["campaign"]["reservedMicros"], 60_000)
        self.assertEqual(calibrated["campaign"]["plannedReservationMicros"], 4_560_000)
        self.assertEqual([case["reservedMicros"] for case in calibrated["cases"][:2]], [30_000, 30_000])

    def test_import_checks_every_identity_and_hash_before_writing(self):
        campaign, row, analysis = fixture()
        for field, value in [("campaignId", "stale"), ("responseHash", "e" * 64), ("requestHash", "f" * 64), ("requestedModel", "other")]:
            altered = json.loads(json.dumps(analysis))
            (altered if field == "campaignId" else altered["cases"][0])[field] = value
            with self.assertRaises(sync.SyncError):
                sync.import_analysis(altered, campaign, [row], lambda **_: self.fail("Must not write unmatched analysis"))
        duplicated = json.loads(json.dumps(analysis))
        duplicated["cases"].append(duplicated["cases"][0])
        with self.assertRaises(sync.SyncError):
            sync.prepare_import(duplicated, campaign, [row])
        forbidden = json.loads(json.dumps(analysis))
        forbidden["cases"][0]["nested"] = {"Authorization": "secret"}
        with self.assertRaises(sync.SyncError):
            sync.prepare_import(forbidden, campaign, [row])

    def test_sql_file_is_private_deleted_and_rechecks_current_hashes(self):
        campaign, row, report = fixture()
        connection = sqlite3.connect(":memory:")
        connection.row_factory = sqlite3.Row
        connection.executescript("CREATE TABLE tokenhub_audit_campaigns(id TEXT,created_at TEXT); CREATE TABLE tokenhub_audit_cases(campaign_id TEXT,slot INTEGER,case_id TEXT,request_hash TEXT,response_hash TEXT,independent_analysis_json TEXT);")
        connection.execute("INSERT INTO tokenhub_audit_campaigns VALUES (?,?)", (campaign["id"], campaign["created_at"]))
        connection.execute("INSERT INTO tokenhub_audit_cases VALUES (?,?,?,?,?,NULL)", (campaign["id"], 0, row["case_id"], row["request_hash"], row["response_hash"]))
        paths = []
        def execute(**kwargs):
            path = kwargs["sql_file"]
            paths.append(path)
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            sql = path.read_text()
            self.assertIn("AND request_hash=", sql)
            self.assertIn("AND response_hash=", sql)
            self.assertIn("AND campaign_id=(SELECT id", sql)
            return [dict(item) for item in connection.execute(sql).fetchall()]
        self.assertEqual(sync.import_analysis(report, campaign, [row], execute)["importedCases"], 1)
        self.assertTrue(all(not path.exists() for path in paths))
        stored = json.loads(connection.execute("SELECT independent_analysis_json FROM tokenhub_audit_cases").fetchone()[0])
        self.assertEqual(stored, report["cases"][0])
        connection.execute("UPDATE tokenhub_audit_cases SET response_hash=?", ("e" * 64,))
        with self.assertRaises(sync.SyncError):
            sync.import_analysis(report, campaign, [row], execute)
        connection.close()

    def test_incomplete_analysis_skipped_and_export_is_private(self):
        campaign, row, report = fixture()
        report["cases"].append({"slot": 1, "caseId": "future", "requestHash": None, "responseHash": None})
        updates, skipped = sync.prepare_import(report, campaign, [row])
        self.assertEqual((len(updates), skipped), (1, 1))
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "evidence.json"
            sync.write_private_json(path, sync.evidence(campaign, [row]))
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertEqual(len(json.loads(path.read_text())["cases"]), 116)

    def test_subprocess_is_argv_only_and_raw_errors_not_exposed(self):
        with patch.object(sync.subprocess, "run") as run:
            run.return_value.returncode = 0
            run.return_value.stdout = '[{"success":true,"results":[{"count":1}]}]'
            self.assertEqual(sync.run_wrangler(command="SELECT 1"), [{"count": 1}])
            args, kwargs = run.call_args
            self.assertEqual(args[0], ["npx", "wrangler", "d1", "execute", "eco-geo-api", "--remote", "--json", "--command", "SELECT 1"])
            self.assertFalse(kwargs["shell"])
            run.return_value.returncode = 1
            run.return_value.stdout = "secret SQL content"
            with self.assertRaises(sync.SyncError) as context:
                sync.run_wrangler(command="SELECT 1")
            self.assertNotIn("secret", str(context.exception))


if __name__ == "__main__":
    unittest.main()
