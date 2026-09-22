"""Fake-Docker control-flow tests. No live database, Docker or production use."""
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BASE = "1e404b2c25d4c2582b42ab8e774a60ddde5a2f4b"
FAKE_DOCKER = r'''#!/usr/bin/python3 -S
import json, os, sys
from pathlib import Path
args=sys.argv[1:]
root=Path(os.environ['FAKE_ROOT'])
mode=os.environ.get('MODE', '')
with (root/'calls.jsonl').open('a') as log:
    log.write(json.dumps(args)+'\n')
state=json.loads((root/'state.json').read_text())
mc='sha256:'+'e'*64

def save():
    (root/'state.json').write_text(json.dumps(state))

def service(ref):
    if ref.startswith('sudoku-') and ref.endswith('-1'):
        return ref[7:-2]
    for name,data in state.items():
        if ref == data['id']: return name
    sys.exit(77)

if args[0]=='inspect':
    fmt=args[args.index('-f')+1]
    s=service(args[-1]); row=state[s]
    values={
        '{{.Id}}':row['id'], '{{.Image}}':row['image'],
        '{{.Id}} {{.Image}}': row['id']+' '+row['image'],
        '{{.State.Status}}':row['status'],
        '{{.State.ExitCode}}':str(row.get('exit',0)),
        '{{.State.OOMKilled}}':str(row.get('oom',False)).lower(),
        '{{.State.Health.Status}}':'healthy',
        '{{.State.Status}} {{.State.Health.Status}}':row['status']+' healthy',
        '{{.State.Status}} {{.State.StartedAt}} {{.RestartCount}}':row['status']+' '+row['started']+' 0',
        '{{index .Config.Labels "com.docker.compose.project"}} {{index .Config.Labels "com.docker.compose.service"}}':'sudoku '+s,
        '{{.HostConfig.RestartPolicy.Name}} {{.HostConfig.RestartPolicy.MaximumRetryCount}}':row['policy']+' 0',
    }
    print(values[fmt]); sys.exit(0)
if args[:2]==['image','inspect']:
    if args[-1] not in ('sudoku-minio-init',mc): sys.exit(78)
    if mode=='missing-helper':sys.exit(42)
    print(mc if args[args.index('-f')+1]=='{{.Id}}' else 'RELEASE.2025-08-13T08-35-41Z')
    sys.exit(0)
if args[0]=='update':
    s=service(args[-1]); assert s=='api'
    assert args[1] in ('--restart=no','--restart=unless-stopped')
    if mode=='policy-failure' and args[1]=='--restart=unless-stopped':sys.exit(42)
    state[s]['policy']=args[1].split('=')[1];save();sys.exit(0)
if args[0] in ('stop','start'):
    s=service(args[-1])
    assert s not in ('minio','postgres','redis'), 'infrastructure mutation'
    assert not (s=='api' and args[0]=='stop'), 'legacy API must never be force-stopped'
    if mode=='start-failure' and args[0]=='start' and s=='api':sys.exit(42)
    if mode=='partial-stop' and args[0]=='stop' and s=='worker':sys.exit(42)
    state[s]['status']='exited' if args[0]=='stop' else 'running'
    if mode=='forced-stop' and args[0]=='stop' and s=='worker':state[s]['exit']=137
    save();print(state[s]['id']);sys.exit(0)
if args[0]=='exec':
    if 'python' in args:
        assert 'pidfd_send_signal' in sys.stdin.read()
        assert service(args[2])=='api' and args[1]=='-i'
        if '--check' in args:
            if mode=='wrong-process':sys.exit(42)
            print('LEGACY_API_TARGET_OK pid=8')
        else:
            assert '--terminate' in args
            assert state['api']['policy']=='no'
            assert all(state[s]['status']=='exited' for s in ('caddy','web','worker','beat'))
            if mode=='signal-failure':sys.exit(42)
            if mode!='signal-timeout':
                state['api']['status']='exited'
                state['api']['exit']=137 if mode=='forced-api' else 143
                state['api']['oom']=mode=='oom-api'
                save()
            print('LEGACY_API_TERM_SENT pid=8')
    elif 'psql' in args:
        print('different' if mode=='wrong-revision' else '0014_mls_device_rekey')
    elif 'pg_dump' in args:
        assert all(state[s]['status']=='exited' for s in ('caddy','api','web','worker','beat'))
        assert state['api']['policy']=='no'
        if mode=='dump-failure':sys.exit(42)
        if mode!='empty-dump':print('synthetic dump, not PostgreSQL')
    elif 'pg_restore' in args:
        assert sys.stdin.read()
        if mode=='restore-list-failure':sys.exit(42)
    else:sys.exit(79)
    sys.exit(0)
if args[0]=='logs':
    if mode!='no-shutdown-logs':
        print('Application shutdown complete.\nFinished server process [8]')
    sys.exit(0)
if args[0]=='compose':
    if 'config' in args:
        print(json.dumps({'services':{'minio-init':{'image':mc,'pull_policy':'never'}}}));sys.exit(0)
    assert 'run' in args and '--no-deps' in args and '--rm' in args
    assert args[args.index('--pull')+1]=='never'
    assert '--no-build' not in args
    assert '--entrypoint' in args and args[-2]=='-c'
    command=args[-1]
    if 'mc stat' in command:
        if mode=='helper-preflight-failure':sys.exit(42)
    else:
        assert 'mc mirror --overwrite "local/$S3_BUCKET" /backup' in command
        assert all(state[s]['status']=='exited' for s in ('caddy','api','web','worker','beat'))
        if mode=='mirror-failure':sys.exit(42)
        target=args[args.index('-v')+1].removesuffix(':/backup')
        (Path(target)/'example.bin').write_bytes(b'encrypted test object')
        if mode=='infra-restart':state['minio']['started']='changed';save()
        if mode=='writer-resumed':state['worker']['status']='running';save()
    sys.exit(0)
sys.exit(80)
'''


class ExistingBackup(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        (self.root / "bin").mkdir()
        (self.root / "scripts").mkdir()
        (self.root / ".env.production").write_text("APP_DOMAIN=sudoku.moscow\n")
        (self.root / "scripts/preflight-production.sh").write_text("echo preflight-ok\n")
        (self.root / "scripts/smoke-production.sh").write_text(
            '[[ "${MODE:-}" != smoke-failure ]] || exit 1\necho smoke-ok\n'
        )
        binaries = {
            "docker": FAKE_DOCKER,
            "git": f'#!/bin/sh\nif [ "$1" = rev-parse ]; then echo {BASE}; fi\n',
            "sleep": "#!/bin/sh\nexit 0\n",
            "python3": '#!/bin/sh\nexec /usr/bin/python3 -S "$@"\n',
        }
        for name, source in binaries.items():
            target = self.root / "bin" / name
            target.write_text(source)
            target.chmod(0o755)
        names = ["postgres", "redis", "minio", "api", "worker", "beat", "web", "caddy"]
        state = {s: {"id": f"{i+1:064x}", "image": "sha256:" + f"{i+101:064x}",
                     "status": "running", "started": "original", "policy": "unless-stopped"} for i, s in enumerate(names)}
        (self.root / "state.json").write_text(json.dumps(state))
        self.env = {**os.environ, "HOME": str(self.root), "PATH": f"{self.root / 'bin'}:{os.environ['PATH']}",
                    "FAKE_ROOT": str(self.root)}

    def run_script(self, mode=""):
        result = subprocess.run(["bash", str(ROOT / "scripts/backup-existing-production.sh")],
                                cwd=self.root, env={**self.env, "MODE": mode},
                                capture_output=True, text=True, timeout=15, check=False)
        log = self.root / "calls.jsonl"
        calls = [json.loads(line) for line in log.read_text().splitlines()] if log.exists() else []
        return result, calls, json.loads((self.root / "state.json").read_text())

    def assert_no_recreate(self, calls):
        for args in calls:
            self.assertNotIn(args[0], ("rm", "build", "pull", "commit", "kill"))
            self.assertFalse(args[:2] == ["image", "tag"])
            if args[0] == "compose":
                self.assertFalse(any(value in args for value in ("up", "down", "build", "create", "restart")))

    def test_missing_original_minio_image_does_not_block_quiesced_backup(self):
        result, calls, state = self.run_script()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("BACKUP_EXISTING_OK", result.stdout)
        self.assertIn("API_GRACEFUL_STOP_OK", result.stdout)
        self.assertIn("PIN_NOT_DEPLOYED", result.stdout)
        self.assertTrue(all(row["status"] == "running" for row in state.values()))
        self.assertEqual(state["api"]["policy"], "unless-stopped")
        self.assert_no_recreate(calls)
        record, = (self.root / "sudoku-release-records").glob("pin-backup-*")
        backup = record / "backup"
        self.assertTrue((backup / "objects/example.bin").is_file())
        verify = subprocess.run(["sha256sum", "--status", "-c", "SHA256SUMS"], cwd=backup, check=False)
        self.assertEqual(verify.returncode, 0)
        self.assertIn("restore_tested=false", (backup / "manifest.txt").read_text())
        self.assertEqual(record.stat().st_mode & 0o777, 0o700)

    def test_preflight_failures_never_stop_services(self):
        for mode in ("missing-helper", "helper-preflight-failure", "wrong-revision", "wrong-process"):
            with self.subTest(mode=mode):
                result, calls, state = self.run_script(mode)
                self.assertNotEqual(result.returncode, 0)
                self.assertNotIn("BACKUP_EXISTING_OK", result.stdout)
                self.assertFalse(any(c[0] in ("start", "stop", "update") for c in calls))
                self.assertTrue(all(row["status"] == "running" for row in state.values()))
                self.assert_no_recreate(calls)

    def test_stop_and_copy_failures_restore_same_containers_and_policy(self):
        modes = ("dump-failure", "empty-dump", "restore-list-failure", "mirror-failure",
                 "partial-stop", "forced-stop", "writer-resumed", "signal-failure",
                 "signal-timeout", "forced-api", "oom-api", "no-shutdown-logs")
        for mode in modes:
            with self.subTest(mode=mode):
                # Reset between failure scenarios, including log, directories and exit flags.
                self.setUp()
                result, calls, state = self.run_script(mode)
                self.assertNotEqual(result.returncode, 0, result.stdout)
                self.assertNotIn("BACKUP_EXISTING_OK", result.stdout)
                self.assertTrue(all(row["status"] == "running" for row in state.values()), result.stderr)
                self.assertEqual(state["api"]["policy"], "unless-stopped")
                self.assert_no_recreate(calls)
                self.assertFalse(list((self.root / "sudoku-release-records").glob("*/backup/manifest.txt")))
                if mode in ("signal-failure", "signal-timeout", "forced-api", "oom-api", "no-shutdown-logs"):
                    self.assertFalse(any("pg_dump" in c for c in calls))

    def test_changed_infrastructure_or_failed_recovery_keeps_edge_closed(self):
        for mode in ("infra-restart", "start-failure", "smoke-failure", "policy-failure"):
            with self.subTest(mode=mode):
                self.setUp()
                result, calls, state = self.run_script(mode)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(state["caddy"]["status"], "exited")
                self.assertIn("RECOVERY_REQUIRED", result.stderr)
                self.assertNotIn("BACKUP_EXISTING_OK", result.stdout)
                if mode != "policy-failure":
                    self.assertEqual(state["api"]["policy"], "unless-stopped")
                self.assert_no_recreate(calls)


if __name__ == "__main__":
    unittest.main()
