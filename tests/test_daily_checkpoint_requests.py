"""Bounded identical GET recovery, with no transport retries or secret output."""
import subprocess
import sys
import unittest
from unittest import mock

import daily_resume_checkpoint as cp


class CheckpointRequestTests(unittest.TestCase):
    def run_requests(self, programs, *, seconds=10):
        original = subprocess.Popen
        calls = []
        pending = iter(programs)
        def start(command, **kwargs):
            calls.append(command)
            return original([sys.executable, '-c', next(pending)], **kwargs)
        self.calls = calls
        with mock.patch.object(cp.subprocess, 'Popen', side_effect=start), \
             mock.patch.object(cp.time, 'sleep') as sleep:
            self.sleep = sleep
            return cp.GitHub('owner/repo', seconds=seconds).read('repos/owner/repo/actions/artifacts/1/zip', 100)

    def failure(self, status):
        return f'import sys; sys.stdout.write("partial"); sys.stderr.write("gh: unavailable (HTTP {status})\\n"); sys.exit(1)'

    def test_explicit_server_responses_retry_identical_get_and_discard_partial_bytes(self):
        result = self.run_requests([self.failure(502), self.failure(503), 'import sys; sys.stdout.buffer.write(b"PK\\x03\\x04")'])
        self.assertEqual(result, b'PK\x03\x04')
        self.assertEqual(len(self.calls), 3)
        self.assertTrue(all(call == self.calls[0] for call in self.calls))
        self.assertEqual(self.sleep.call_args_list, [mock.call(1), mock.call(2)])

    def test_server_retries_are_bounded_and_keep_status(self):
        with self.assertRaises(cp.CheckpointRequestError) as caught:
            self.run_requests([self.failure(500)] * 3)
        self.assertEqual(caught.exception.status, 500)
        self.assertEqual(len(self.calls), 3)

    def test_permission_missing_rate_limit_and_transport_failures_never_retry(self):
        for status in (401, 403, 404, 429):
            with self.subTest(status=status), self.assertRaises(cp.CheckpointRequestError) as caught:
                self.run_requests([self.failure(status)])
            self.assertEqual(caught.exception.status, status)
            self.assertEqual(len(self.calls), 1)
        private = 'https://example.invalid/?signature=private-fixture'
        program = f'import sys; sys.stderr.write({("TLS handshake timeout " + private)!r}); sys.exit(1)'
        with self.assertRaises(cp.CheckpointRequestError) as caught:
            self.run_requests([program])
        self.assertIsNone(caught.exception.status)
        self.assertNotIn(private, str(caught.exception))
        self.assertEqual(len(self.calls), 1)

    def test_large_stderr_is_drained_without_deadlock_and_never_exposed(self):
        program = 'import sys; sys.stderr.write("x"*200000+"\\ngh: unavailable (HTTP 404)\\n"); sys.exit(1)'
        with self.assertRaises(cp.CheckpointRequestError) as caught:
            self.run_requests([program])
        self.assertEqual(caught.exception.status, 404)
        self.assertLess(len(str(caught.exception)), 150)

    def test_retry_wait_cannot_extend_total_discovery_deadline(self):
        client = cp.GitHub('owner/repo', seconds=.01)
        with mock.patch.object(client, '_read_once', side_effect=cp.CheckpointRequestError(504)) as request, \
             mock.patch.object(cp.time, 'sleep') as sleep:
            with self.assertRaisesRegex(TimeoutError, 'deadline exhausted'):
                client.read('fixture', 100)
        self.assertEqual(request.call_count, 1)
        sleep.assert_not_called()


if __name__ == '__main__':
    unittest.main()
