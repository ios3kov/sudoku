"""Exercise production scripts with a fake Docker binary; never touch services."""
import hashlib
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


class MaintenanceScripts(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.cwd = Path(self.temp.name)
        self.backup = self.cwd / "snapshot"
        (self.backup / "objects").mkdir(parents=True)
        (self.backup / "postgres.dump").write_bytes(b"test-only dump")
        (self.backup / "manifest.txt").write_text("database=postgresql\nobject_store=minio\n")
        self.sums()
        (self.cwd / ".env.production").write_text("APP_DOMAIN=test.invalid\n")
        binary = self.cwd / "bin"
        binary.mkdir()
        docker = binary / "docker"
        docker.write_text("""#!/usr/bin/env python3
import os, sys
args = sys.argv[1:]
with open(os.environ['DOCKER_LOG'], 'a') as log:
    log.write(' '.join(args) + '\\n')
fail = os.environ.get('FAIL_STAGE', '')
if ((fail == 'database' and 'pg_restore' in args)
    or (fail == 'objects' and 'run' in args)
    or (fail == 'restart' and 'up' in args and 'api' in args)):
    sys.exit(42)
if 'pg_dump' in args: sys.stdout.write('test-only dump')
""")
        docker.chmod(0o755)
        self.env = {**os.environ, "PATH": f"{binary}:{os.environ['PATH']}", "DOCKER_LOG": str(self.cwd / "docker.log"), "RESTORE_CONFIRM": "YES"}

    def sums(self):
        files = sorted(p for p in self.backup.rglob("*") if p.is_file() and p.name != "SHA256SUMS")
        (self.backup / "SHA256SUMS").write_text("".join(f"{hashlib.sha256(p.read_bytes()).hexdigest()}  ./{p.relative_to(self.backup)}\n" for p in files))

    def run_script(self, name, fail=""):
        result = subprocess.run(["bash", str(ROOT / "scripts" / name), str(self.backup)], cwd=self.cwd, env={**self.env, "FAIL_STAGE": fail}, text=True, capture_output=True, timeout=10, check=False)
        log = (self.cwd / "docker.log").read_text() if (self.cwd / "docker.log").exists() else ""
        return result, log

    def test_database_restore_failure_stays_in_maintenance(self):
        result, log = self.run_script("restore-production.sh", "database")
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("up -d api worker beat web caddy", log)
        self.assertNotIn("[restore] complete", result.stdout)

    def test_object_restore_failure_stays_in_maintenance(self):
        result, log = self.run_script("restore-production.sh", "objects")
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("up -d api worker beat web caddy", log)

    def test_missing_objects_rejected_before_any_service_changes(self):
        (self.backup / "objects").rmdir()
        result, log = self.run_script("restore-production.sh")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(log, "")

    def test_extra_unverified_object_rejected_before_any_service_changes(self):
        (self.backup / "objects" / "unexpected").write_bytes(b"not in manifest")
        result, log = self.run_script("restore-production.sh")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(log, "")

    def test_successful_restore_resumes_only_after_data_and_objects(self):
        result, log = self.run_script("restore-production.sh")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertLess(log.index("pg_restore"), log.index("up -d api worker beat web caddy"))
        self.assertIn("[restore] complete", result.stdout)

    def test_restore_restart_failure_is_not_reported_as_success(self):
        result, _ = self.run_script("restore-production.sh", "restart")
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("[restore] complete", result.stdout)

    def test_backup_restart_failure_is_not_reported_as_success(self):
        result, _ = self.run_script("backup-production.sh", "restart")
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("[backup] complete:", result.stdout)

    def test_successful_backup_is_still_supported(self):
        result, _ = self.run_script("backup-production.sh")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("[backup] complete:", result.stdout)


class SmokeProduction(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.cwd = Path(self.temp.name)
        binary = self.cwd / "bin"
        binary.mkdir()
        getent = binary / "getent"
        getent.write_text("#!/usr/bin/env sh\nexit 0\n")
        getent.chmod(0o755)
        curl = binary / "curl"
        curl.write_text(r'''#!/usr/bin/env python3
import os
import pathlib
import sys

args = sys.argv[1:]
url = args[-1]
state_path = pathlib.Path(os.environ["FAKE_CURL_STATE"])

def value(flag):
    try:
        return args[args.index(flag) + 1]
    except ValueError:
        return None

def write_headers(path, lines):
    if path:
        pathlib.Path(path).write_text("\r\n".join(lines) + "\r\n\r\n")

if url == "https://sudoku.test/":
    count = int(state_path.read_text() or "0") if state_path.exists() else 0
    count += 1
    state_path.write_text(str(count))
    nonce = "fixed-nonce" if os.environ.get("FAKE_NONCE_MODE") == "static" else f"nonce-{count}"
    unsafe = " 'unsafe-inline'" if os.environ.get("FAKE_SCRIPT_UNSAFE_INLINE") == "1" else ""
    csp = (
        "default-src 'self'; "
        f"script-src 'self' 'nonce-{nonce}' 'strict-dynamic' 'wasm-unsafe-eval'{unsafe}; "
        "style-src 'self' 'unsafe-inline'; "
        "connect-src 'self' https://assets.sudoku.test wss://sudoku.test"
    )
    write_headers(value("--dump-header"), [
        "HTTP/2 200",
        "strict-transport-security: max-age=31536000",
        f"content-security-policy: {csp}",
        f"x-nonce: {nonce}",
        "x-content-type-options: nosniff",
        "x-frame-options: DENY",
        "referrer-policy: no-referrer",
        "cross-origin-opener-policy: same-origin",
        "cross-origin-resource-policy: same-origin",
        "permissions-policy: camera=()",
    ])
    sys.exit(0)

if url == "https://sudoku.test/v1/health/ready":
    sys.exit(0)

if url == "https://assets.sudoku.test/":
    write_headers(value("--dump-header"), [
        "HTTP/2 200",
        "strict-transport-security: max-age=31536000",
        "x-content-type-options: nosniff",
        "x-frame-options: DENY",
        "referrer-policy: no-referrer",
        "cross-origin-resource-policy: same-site",
    ])
    if "--write-out" in args:
        sys.stdout.write("200")
    sys.exit(0)

if url.startswith("http://"):
    target = url.replace("http://", "https://", 1)
    sys.stdout.write(f"HTTP/1.1 308 Permanent Redirect\r\nLocation: {target}\r\n\r\n308")
    sys.exit(0)

raise SystemExit(f"unexpected fake curl URL: {url}")
''')
        curl.chmod(0o755)
        self.env = {
            **os.environ,
            "PATH": f"{binary}:{os.environ['PATH']}",
            "FAKE_CURL_STATE": str(self.cwd / "curl-state"),
        }

    def run_smoke(self, **extra):
        return subprocess.run(
            ["bash", str(ROOT / "scripts" / "smoke-production.sh"), "sudoku.test"],
            cwd=self.cwd,
            env={**self.env, **extra},
            text=True,
            capture_output=True,
            timeout=10,
            check=False,
        )

    def test_smoke_accepts_rotating_nonce_csp(self):
        result = self.run_smoke()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("[smoke] live edge checks passed", result.stdout)

    def test_smoke_rejects_reused_nonce(self):
        result = self.run_smoke(FAKE_NONCE_MODE="static")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("nonce is missing or did not rotate", result.stderr)

    def test_smoke_rejects_script_unsafe_inline(self):
        result = self.run_smoke(FAKE_SCRIPT_UNSAFE_INLINE="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("script-src must not allow unsafe-inline", result.stderr)
