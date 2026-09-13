import contextlib
import importlib.util
import io
import json
from pathlib import Path
import stat
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('index_agent', Path(__file__).resolve().parents[1] / 'api/examples/index_agent.py')
agent = importlib.util.module_from_spec(spec)
spec.loader.exec_module(agent)


class AgentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.args = SimpleNamespace(request=root/'request.json', state=root/'state.json', output=root/'result.json', max_wait_seconds=60)
        self.body = {'mandate': {'title': 'User choice'}, 'relevance_cutoff': 70}
        self.args.request.write_text(json.dumps(self.body))
        self.calls = []
        self.owner = 'owner-a'
        self.status = 'completed'
        self.lost = False

    def call(self, path, body=None, request_id=None):
        self.calls.append((path, body, request_id))
        if path == '/v1/account':
            return {'walletAddress': self.owner, 'corbanuApi': {'availableMicrousd': '10000000'}}
        if path == '/v2/indexes/previews':
            if self.lost:
                self.lost = False
                raise OSError('Response lost after server accepted the request')
            return {'id': 'saved-id', 'status': 'queued'}
        if path.endswith('/result'):
            return {'payload': {'request': self.body, 'construction': {'weights': []}}}
        return {'id': 'saved-id', 'status': self.status, 'progress': {'scored': 1, 'total': 1}, 'preview_sha256': 'a'*64}

    def run_example(self):
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            return agent.run(self.args, self.call)

    def test_lost_start_response_reuses_identity_and_completed_resume_never_posts(self):
        self.lost = True
        with self.assertRaises(OSError): self.run_example()
        self.assertTrue(self.args.state.exists())
        self.assertEqual(self.run_example(), 0)
        starts = [c for c in self.calls if c[0] == '/v2/indexes/previews']
        self.assertEqual(starts[0], starts[1])
        self.calls.clear()
        self.assertEqual(self.run_example(), 0)
        self.assertFalse(any(c[1] is not None for c in self.calls))
        for path in [self.args.state, self.args.output]:
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
        self.assertEqual(json.loads(self.args.output.read_text())['payload']['request'], self.body)

    def test_changed_account_or_request_cannot_restart_a_saved_index(self):
        self.run_example()
        self.owner = 'owner-b'
        self.calls.clear()
        with self.assertRaisesRegex(ValueError, 'different Corbanu account'): self.run_example()
        self.assertEqual(len(self.calls), 1)
        self.owner = 'owner-a'
        self.body['relevance_cutoff'] = 20
        self.args.request.write_text(json.dumps(self.body))
        with self.assertRaisesRegex(ValueError, 'Request changed'): self.run_example()

    def test_diagnostic_result_is_saved_but_does_not_report_success(self):
        self.status = 'needs_data'
        self.assertEqual(self.run_example(), 2)
        self.assertTrue(self.args.output.exists())

    def test_wait_limit_keeps_preview_for_resume(self):
        self.status = 'running'
        self.args.max_wait_seconds = 0
        with self.assertRaises(TimeoutError): self.run_example()
        self.assertEqual(json.loads(self.args.state.read_text())['preview_id'], 'saved-id')
        self.status = 'completed'
        self.calls.clear()
        self.assertEqual(self.run_example(), 0)
        self.assertFalse(any(c[1] is not None for c in self.calls))

    def test_http_uses_only_corbanu_bearer_auth_without_browser_headers(self):
        class Opener:
            def open(inner, req, timeout):
                self.assertEqual(req.full_url, 'https://api.corbanu.com/v1/account')
                self.assertEqual(req.get_header('Authorization'), 'Bearer synthetic-corbanu-key')
                self.assertIsNone(req.get_header('Origin'))
                self.assertIsNone(req.get_header('Cookie'))
                return io.BytesIO(b'{"walletAddress":"owner-a","corbanuApi":{}}')
        with patch.dict(agent.os.environ, {'CORBANU_API_KEY': 'synthetic-corbanu-key'}), patch.object(agent, 'build_opener', return_value=Opener()):
            self.assertEqual(agent.api('/v1/account')['walletAddress'], 'owner-a')


if __name__ == '__main__':
    unittest.main()
