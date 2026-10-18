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
        self.assertEqual(len(data["cases"]), 63)
        self.assertEqual(data["counts"]["succeeded"], 1)
        self.assertEqual(data["counts"]["planned"], 62)
        self.assertEqual(data["campaign"]["reservedMicros"], 30000)
        self.assertEqual(data["campaign"]["plannedReservationMicros"], 4_800_000)
        saved = next(case for case in data["cases"] if case["slot"] == row["slot"] and case["caseId"] == row["case_id"])
        self.assertEqual(saved["responseHash"], row["response_hash"])
        self.assertEqual(saved["request"]["messages"][0]["content"], "test")
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
        self.assertEqual(fresh["campaign"]["plannedReservationMicros"], 4_780_000)
        long_row = dict(row, case_id=sync.CHAT_MODELS[0] + ":long")
        calibrated = sync.evidence(campaign, [row, long_row], now)
        self.assertEqual(calibrated["campaign"]["reservedMicros"], 60_000)
        self.assertEqual(calibrated["campaign"]["plannedReservationMicros"], 4_820_000)
        self.assertEqual([case["reservedMicros"] for case in calibrated["cases"] if case["slot"] == 0 and case["requestedModel"] == row["model"]], [30_000, 30_000])

    def test_all_nine_models_have_samples_and_each_day_has_one_chat_pair(self):
        campaign, _, _ = fixture()
        data = sync.evidence(campaign, [], sync.parse_time("2026-10-18T01:00:00Z"))
        cases = data["cases"]
        self.assertEqual(len({case["requestedModel"] for case in cases}), 9)
        self.assertEqual(sum(case["kind"] == "chat" for case in cases), 56)
        self.assertEqual(sum(case["kind"] == "video" for case in cases), 5)
        self.assertEqual(sum(case["kind"] == "image" for case in cases), 2)
        for day in range(7):
            for model in sync.CHAT_MODELS:
                daily = [case for case in cases if case["slot"] // 2 == day and case["requestedModel"] == model]
                self.assertEqual(len(daily), 2)
                self.assertEqual({case["caseId"].split(":")[-1] for case in daily}, {"short", "long"})

    def test_old_removed_slot_is_preserved_with_evidence_and_reservation(self):
        campaign, row, _ = fixture()
        old = dict(row, slot=1, case_id="legacy-provider-case", model="historical-model",
                   request_json='{"max_tokens":4096,"messages":[{"role":"user","content":"old"}]}',
                   expected_json='{"protocolVersion":"tokenhub-audit-v2","answers":[1,2,3,4]}', reserved_micros=50_000)
        data = sync.evidence(campaign, [old], sync.parse_time("2026-10-18T01:00:00Z"))
        self.assertEqual(data["campaign"]["plannedCalls"], 64)
        self.assertEqual(data["campaign"]["plannedReservationMicros"], 4_830_000)
        historical = next(case for case in data["cases"] if case["caseId"] == old["case_id"])
        self.assertEqual(historical["request"], json.loads(old["request_json"]))
        self.assertEqual(historical["requestHash"], old["request_hash"])
        self.assertEqual(historical["responseHash"], old["response_hash"])
        self.assertEqual(historical["expected"], json.loads(old["expected_json"]))
        self.assertEqual((historical["planVersion"], historical["maxOutputTokens"], historical["reservedMicros"]), ("tokenhub-audit-v2", 4096, 50_000))
        self.assertTrue(historical["retainedFromEarlierPlan"])

    def test_daily_catalog_export_preserves_partial_failure_sources_and_hashes(self):
        campaign, _, _ = fixture()
        catalog_model = {"model": "new-video", "kind": "video", "label": "New Video", "sources": ["pricing"], "enabled": True}
        snapshot = {"campaign_id": campaign["id"], "day": 1, "state": "partial", "attempt_count": 2,
                    "next_attempt_at": "2026-10-19T02:00:00Z", "fetched_at": "2026-10-19T01:00:00Z", "updated_at": "2026-10-19T01:00:00Z",
                    "models_json": None, "models_hash": None, "pricing_json": '{"data":[{"id":"new-video","authorization":"redact-me"}]}', "pricing_hash": "e" * 64,
                    "catalog_json": json.dumps([catalog_model]), "error_json": '[{"source":"models","error":"unavailable"}]'}
        queries = []
        def query(**kwargs):
            queries.append(kwargs["command"])
            return [snapshot]
        rows = sync.catalog_snapshot(campaign, query)
        result = sync.evidence(campaign, [], catalog_rows=rows)
        observed = result["catalogObservations"][0]
        self.assertEqual(observed["day"], 2)
        self.assertEqual(observed["status"], "partial")
        self.assertEqual(observed["models"], [catalog_model])
        self.assertEqual(observed["pricingHash"], snapshot["pricing_hash"])
        self.assertIsNone(observed["modelsResponse"])
        self.assertEqual(observed["pricingResponse"]["data"][0]["authorization"], "[REDACTED]")
        self.assertEqual(observed["errors"], [{"source": "models", "error": "unavailable"}])
        discovered = next(model for model in result["catalogModels"] if model["model"] == "new-video")
        self.assertEqual((discovered["catalogState"], discovered["plannedCalls"], discovered["observedDays"]), ("present", 0, 0))
        self.assertFalse(discovered["paidAdapterSupported"])
        self.assertNotIn("redact-me", json.dumps(result))
        self.assertNotIn("*", queries[0])
        self.assertNotIn("encrypted_key", queries[0])
        self.assertIn("campaign''quoted", queries[0])
        for invalid in [dict(snapshot, campaign_id="another"), dict(snapshot, day=7), dict(snapshot, day=True)]:
            with self.assertRaises(sync.SyncError):
                sync.catalog_snapshot(campaign, lambda **_: [invalid])
        with self.assertRaises(sync.SyncError):
            sync.catalog_snapshot(campaign, lambda **_: [snapshot, snapshot])

    def test_catalog_partial_failure_does_not_claim_missing_models_disappeared(self):
        campaign, _, _ = fixture()
        baseline = {"id": "previous-model", "modelType": "text", "label": "Previous Model"}
        campaign["catalog_json"] = json.dumps({"object": "list", "data": [baseline]})
        snapshot = {"campaign_id": campaign["id"], "day": 1, "state": "partial", "catalog_json": "[]",
                    "fetched_at": "2026-10-19T01:00:00Z", "error_json": '["models unavailable"]'}
        partial = sync.evidence(campaign, [], catalog_rows=[snapshot])
        previous = next(model for model in partial["catalogModels"] if model["model"] == baseline["id"])
        self.assertEqual(previous["kind"], "chat")
        self.assertEqual(previous["catalogState"], "present")
        complete = sync.evidence(campaign, [], catalog_rows=[dict(snapshot, state="succeeded")])
        previous = next(model for model in complete["catalogModels"] if model["model"] == baseline["id"])
        self.assertEqual(previous["catalogState"], "disappeared")
        self.assertEqual(len(complete["catalogModels"]), 10)

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
            if "command" in kwargs:
                return [dict(item) for item in connection.execute(kwargs["command"]).fetchall()]
            path = kwargs["sql_file"]
            paths.append(path)
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            sql = path.read_text()
            self.assertIn("AND request_hash=", sql)
            self.assertIn("AND response_hash=", sql)
            self.assertIn("AND campaign_id=(SELECT id", sql)
            self.assertNotIn("RETURNING", sql)
            connection.execute(sql)
            # Actual bulk import output is a summary, never UPDATE RETURNING rows.
            return [{"Total queries executed": 1, "Rows read": 2, "Rows written": 1}]
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
            self.assertEqual(len(json.loads(path.read_text())["cases"]), 63)

    def test_real_bulk_stdout_progress_and_summary_shape(self):
        summary = [{"results": [{"Total queries executed": 2, "Rows read": 4, "Rows written": 2, "Database size (MB)": 0.17}], "success": True}]
        output = "Uploading SQL file...\nProcessing import...\nImport completed.\n" + json.dumps(summary, indent=2) + "\n"
        with patch.object(sync.subprocess, "run") as run:
            run.return_value.returncode = 0
            run.return_value.stdout = output
            self.assertEqual(sync.run_wrangler(sql_file=Path("/tmp/example.sql")), summary[0]["results"])
        with self.assertRaises(sync.SyncError):
            sync.parse_wrangler_output(output + "unexpected trailing text")
        with self.assertRaises(sync.SyncError):
            sync.parse_wrangler_output('progress: [{"results":[],"success":true}]')

    def test_import_verifies_after_uncertain_mutation_without_resending(self):
        campaign, row, report = fixture()
        calls = []
        def execute(**kwargs):
            calls.append(kwargs)
            if "sql_file" in kwargs:
                raise sync.SyncError("Uncertain mutation CLI outcome")
            return [dict(row, independent_analysis_json=sync.encode(report["cases"][0]))]
        self.assertEqual(sync.import_analysis(report, campaign, [row], execute)["importedCases"], 1)
        self.assertEqual(sum("sql_file" in call for call in calls), 1)
        self.assertEqual(sum("command" in call for call in calls), 1)

    def test_failed_readback_never_replays_mutation(self):
        campaign, row, report = fixture()
        calls = []
        def execute(**kwargs):
            calls.append(kwargs)
            if "sql_file" in kwargs:
                return [{"Total queries executed": 1, "Rows written": 1}]
            raise sync.SyncError("Read unavailable")
        with self.assertRaisesRegex(sync.SyncError, "do not resubmit, export fresh evidence"):
            sync.import_analysis(report, campaign, [row], execute)
        self.assertEqual(sum("sql_file" in call for call in calls), 1)
        self.assertEqual(sum("command" in call for call in calls), 1)
        def wrong_json(**kwargs):
            if "sql_file" in kwargs:
                return [{"Rows written": 1}]
            return [dict(row, independent_analysis_json="{}")]
        with self.assertRaisesRegex(sync.SyncError, "matched 0/1"):
            sync.import_analysis(report, campaign, [row], wrong_json)

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
