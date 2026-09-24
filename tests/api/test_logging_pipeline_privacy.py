import json
import os
import subprocess
import sys
import unittest


class LoggingPipelinePrivacyTests(unittest.TestCase):
    def test_configured_structured_and_standard_logs_redact_exceptions_and_nested_secrets(self):
        # Logging setup mutates process globals; isolate it from the API suite.
        script = '''
import logging
import structlog
from app.observability import configure_structured_logging
configure_structured_logging("audit")
details = {"pin": "PRIVATE_PIN", "nested": [{"access_token": "PRIVATE_TOKEN", "safe": "visible"}]}
structlog.get_logger("audit").info("audit.fields", details=details)
structlog.get_logger("audit").info("audit.count %s %s", 1, 2)
assert details["pin"] == "PRIVATE_PIN"
try:
    raise ValueError("PRIVATE_EXCEPTION")
except ValueError:
    structlog.get_logger("audit").exception("audit.failed")
    logging.getLogger("audit.standard").exception("operation failed")
'''
        env = {**os.environ, "DATABASE_URL": "sqlite://", "REDIS_URL": "redis://localhost",
               "PUBLIC_ORIGIN": "http://test", "S3_BUCKET": "audit"}
        result = subprocess.run([sys.executable, "-c", script], env=env, capture_output=True,
                                text=True, check=True, timeout=30)
        self.assertNotIn("PRIVATE_", result.stdout + result.stderr)
        entries = [json.loads(line) for line in result.stdout.splitlines()]
        fields = next(item for item in entries if item.get("event") == "audit.fields")
        self.assertEqual(fields["details"]["nested"][0]["safe"], "visible")
        self.assertEqual(sum(item.get("error_type") == "ValueError" for item in entries), 2)
        self.assertTrue(any(item.get("event") == "audit.count 1 2" for item in entries))
