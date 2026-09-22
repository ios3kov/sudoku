"""Verify exact process selection and pidfd signalling without real signals."""
import importlib.util
import signal
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[2] / "scripts/legacy-api-signal.py"
SPEC = importlib.util.spec_from_file_location("legacy_api_signal", SOURCE)
legacy = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = legacy
SPEC.loader.exec_module(legacy)


class LegacySignal(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.proc = Path(temp.name)
        self.process(1, 0, ("/bin/sh", "-c", legacy.LEGACY_COMMAND))
        self.process(8, 1, ("/usr/local/bin/python", "/usr/local/bin/uvicorn") + legacy.UVICORN_ARGS)

    def process(self, pid, parent, args, started=500):
        directory = self.proc / str(pid)
        directory.mkdir(exist_ok=True)
        (directory / "cmdline").write_bytes(b"\0".join(arg.encode() for arg in args) + b"\0")
        fields = ["S", str(parent)] + ["0"] * 17 + [str(started)]
        (directory / "stat").write_text(f"{pid} (name with ) spaces) " + " ".join(fields))

    def test_exact_child(self):
        self.assertEqual(legacy.inspect_target(self.proc), legacy.Target(8, 500))

    def test_unexpected_pid_one_rejected(self):
        self.process(1, 0, ("/sbin/init",))
        with self.assertRaisesRegex(RuntimeError, "PID 1"):
            legacy.inspect_target(self.proc)

    def test_server_port_and_module_must_match(self):
        self.process(8, 1, ("/usr/local/bin/uvicorn", "other:app"))
        with self.assertRaisesRegex(RuntimeError, "exactly one"):
            legacy.inspect_target(self.proc)

    def test_nonchild_not_selected(self):
        self.process(8, 2, ("/usr/local/bin/python", "/usr/local/bin/uvicorn") + legacy.UVICORN_ARGS)
        with self.assertRaises(RuntimeError):
            legacy.inspect_target(self.proc)

    def test_multiple_matches_fail_closed(self):
        self.process(9, 1, ("/usr/local/bin/uvicorn",) + legacy.UVICORN_ARGS)
        with self.assertRaises(RuntimeError):
            legacy.inspect_target(self.proc)

    def test_pidfd_sigterm_only(self):
        with patch.object(legacy.os, "pidfd_open", return_value=99) as opened, \
             patch.object(legacy.signal, "pidfd_send_signal") as sent, \
             patch.object(legacy.os, "close") as closed:
            legacy.terminate(self.proc)
        opened.assert_called_once_with(8, 0)
        sent.assert_called_once_with(99, signal.SIGTERM)
        closed.assert_called_once_with(99)

    def test_reused_pid_or_new_server_not_signalled(self):
        with patch.object(legacy, "inspect_target", side_effect=[legacy.Target(8, 500), legacy.Target(8, 600)]), \
             patch.object(legacy.os, "pidfd_open", return_value=99), \
             patch.object(legacy.signal, "pidfd_send_signal") as sent, \
             patch.object(legacy.os, "close") as closed, \
             self.assertRaises(RuntimeError):
            legacy.terminate(self.proc)
        sent.assert_not_called()
        closed.assert_called_once_with(99)

    def test_missing_process_before_pidfd_is_not_ignored(self):
        with patch.object(legacy.os, "pidfd_open", side_effect=ProcessLookupError), \
             patch.object(legacy.signal, "pidfd_send_signal") as sent, \
             self.assertRaises(ProcessLookupError):
            legacy.terminate(self.proc)
        sent.assert_not_called()


if __name__ == "__main__":
    unittest.main()
