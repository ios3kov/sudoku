"""Local control-flow simulations only; not real Docker or database acceptance."""
import hashlib
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
BASE = '1e404b2c25d4c2582b42ab8e774a60ddde5a2f4b'
TARGET = 'cb8eca6f80aec5febf1e86de13a43e831fdbfc35'
APPS = ('api', 'worker', 'beat', 'web')
FAKE = r'''#!/usr/bin/python3 -S
import json, os, re, sys
from pathlib import Path
root=Path(os.environ['FAKE_ROOT']); args=sys.argv[1:]; mode=os.environ.get('MODE','')
with (root/'calls.jsonl').open('a') as out: out.write(json.dumps([Path(sys.argv[0]).name,*args])+'\n')
s=json.loads((root/'state.json').read_text())
def save(): (root/'state.json').write_text(json.dumps(s))
def svc(ref):
    for k,v in s['containers'].items():
        if ref in (v['id'],f'sudoku-{k}-1'): return k
    raise RuntimeError('unexpected container '+ref)
def all_stopped(): return all(s['containers'][k]['status']=='exited' for k in ('api','worker','beat','web','caddy'))
program=Path(sys.argv[0]).name
if program=='git':
    if args[0]=='rev-parse': print(s['head'])
    elif args[:2]==['status','--porcelain']:
        if mode=='dirty': print(' M compose.yaml')
    elif args[0]=='checkout': s['head']=args[-1];save()
    elif args[0]=='show': print(Path(os.environ['SIGNAL_SOURCE']).read_text(),end='')
    sys.exit(0)
if program=='curl': print('500' if mode=='endpoint' else '401',end='');sys.exit(0)
if program=='sleep':sys.exit(0)
if args[0]=='inspect':
    row=s['containers'][svc(args[-1])]; fmt=args[args.index('-f')+1]
    values={'{{.Id}}':row['id'],'{{.Image}}':row['image'],
    '{{.Id}} {{.Image}}':row['id']+' '+row['image'],
    '{{.State.Status}}':row['status'],'{{.State.ExitCode}}':str(row.get('exit',0)),
    '{{.State.OOMKilled}}':'true' if row.get('oom') else 'false',
    '{{.State.Health.Status}}':'healthy',
    '{{.State.Status}} {{.State.Health.Status}}':row['status']+' healthy',
    '{{.State.Status}} {{.RestartCount}}':row['status']+' '+str(row.get('restarts',0)),
    '{{.State.Status}} {{.State.StartedAt}} {{.RestartCount}}':row['status']+' '+row['started']+' '+str(row.get('restarts',0)),
    '{{.HostConfig.RestartPolicy.Name}} {{.HostConfig.RestartPolicy.MaximumRetryCount}}':row['policy']+' 0',
    '{{index .Config.Labels "com.docker.compose.project"}} {{index .Config.Labels "com.docker.compose.service"}}':'sudoku '+svc(args[-1])}
    print(values[fmt]);sys.exit(0)
if args[:2]==['image','inspect']:
    ref=args[-1]
    # Historical MinIO server image must never be resolved.
    assert ref not in ('sudoku-minio',s['containers']['minio']['image'])
    if mode=='missing-api-image' and ref==s['containers']['api']['image']:sys.exit(42)
    fmt=args[args.index('-f')+1]
    if 'version' in fmt: print('RELEASE.2025-08-13T08-35-41Z')
    else:
        value=s['images'].get(ref,ref)
        assert value.startswith('sha256:'); print(value)
    sys.exit(0)
if args[:2]==['image','tag']:
    s['images'][args[-1]]=s['images'].get(args[-2],args[-2]);save();sys.exit(0)
if args[0] in ('stop','start','update'):
    k=svc(args[-1]); assert k not in ('postgres','redis','minio')
    row=s['containers'][k]
    if args[0]=='stop':
        assert k!='api';row['status']='exited'
        if mode=='forced-worker' and k=='worker':row['exit']=137
    elif args[0]=='start':
        # Any starting of a legacy API after migration-attempt is forbidden.
        assert not (k=='api' and s['migration_attempted'] and row['id']==s['original_api'])
        row['status']='running'
    else:
        assert k=='api';row['policy']=args[1].split('=')[1]
    save();sys.exit(0)
if args[0]=='exec':
    if 'psql' in args: print(s['schema']);sys.exit(0)
    if 'pg_dump' in args:
        assert all_stopped()
        if mode=='dump':sys.exit(42)
        print('synthetic dump');sys.exit(0)
    if 'pg_restore' in args:
        assert '-l' in args and sys.stdin.read();sys.exit(0)
    if '--check' in args or '--terminate' in args:
        assert 'pidfd_send_signal' in sys.stdin.read()
        if '--check' in args:
            if mode=='wrong-process':sys.exit(42)
            print('LEGACY_API_TARGET_OK pid=8')
        else:
            assert s['containers']['api']['policy']=='no'
            if mode=='signal':sys.exit(42)
            s['containers']['api']['status']='exited'
            s['containers']['api']['exit']=143;save();print('LEGACY_API_TERM_SENT pid=8')
        sys.exit(0)
    if 'python' in args: assert s['migration_attempted'];print('API_EXEC_OK');sys.exit(0)
if args[0]=='logs':
    k=svc(args[-1])
    if k=='api':
        if mode!='no-shutdown-markers':print('Application shutdown complete\nFinished server process')
    if k=='worker':print('Task app.tasks.outbox.dispatch_outbox_batch[x] succeeded: 0')
    if k=='beat' and mode=='beat-error':print('ERROR regression')
    sys.exit(0)
if args[0]=='compose':
    if 'build' in args:
        assert args[-4:]==['api','worker','beat','web']
        assert not s['migration_attempted']
        if mode=='build':sys.exit(42)
        for i,k in enumerate(('api','worker','beat','web')):s['images']['sudoku-'+k]='sha256:'+f'{500+i:064x}'
        save();sys.exit(0)
    if 'config' in args:
        configs=[]
        for i,v in enumerate(args):
            if v=='-f' and args[i+1].endswith(('mc.yaml','target-images.yaml')):
                lines=Path(args[i+1]).read_text().splitlines(); services={}; current=None
                for line in lines:
                    match=re.fullmatch(r'  ([a-z-]+):',line)
                    if match: current=match.group(1);services[current]={}
                    elif line.startswith('    image: '): services[current]['image']=json.loads(line.split(': ',1)[1])
                    elif line=='    pull_policy: never': services[current]['pull_policy']='never'
                    elif line.startswith('    build: '): assert line=='    build: !reset null'
                configs.append({'services':services})
        print(json.dumps(configs[-1]));sys.exit(0)
    if 'run' in args:
        assert '--no-deps' in args and '--rm' in args and args[args.index('--pull')+1]=='never'
        if 'alembic' in args:
            assert all_stopped();s['migration_attempted']=True;save()
            if mode=='migration':sys.exit(42)
            s['schema']='0015_session_pins';save();sys.exit(0)
        assert 'minio-init' in args
        if 'mc mirror' in args[-1]:
            assert all_stopped()
            if mode=='mirror':sys.exit(42)
            target=args[args.index('-v')+1].removesuffix(':/backup')
            (Path(target)/'object.bin').write_bytes(b'ciphertext fixture')
        sys.exit(0)
    if 'up' in args:
        assert '--no-deps' in args and '--no-build' in args and args[args.index('--pull')+1]=='never'
        assert s['schema']=='0015_session_pins'
        selected=args[args.index('--wait-timeout')+2:]
        assert set(selected)<=set(('api','worker','beat','web'))
        if mode=='up-api' and selected==['api']:sys.exit(42)
        for k in selected:
            row=s['containers'][k];row['image']=s['images']['sudoku-'+k]
            row['id']=f'{1000+list(s["containers"]).index(k):064x}'
            row['status']='running';row['policy']='unless-stopped';row['started']='new'
            if mode=='restart' and k=='beat':row['restarts']=1
        if mode=='infra-drift':s['containers']['minio']['started']='unexpected'
        save();sys.exit(0)
    if 'ps' in args:sys.exit(0)
raise RuntimeError('unexpected command '+str(args))
'''

class Rollout(unittest.TestCase):

    def run_case(self, mode=''):
        with tempfile.TemporaryDirectory() as temp:
            home = Path(temp)
            repo = home / 'sudoku'
            repo.mkdir()
            (repo / 'scripts').mkdir()
            (repo / '.env.production').write_text('APP_DOMAIN=sudoku.moscow\n')
            (repo / 'scripts/preflight-production.sh').write_text('echo preflight-ok\n')
            (repo / 'scripts/smoke-production.sh').write_text('[[ "${MODE:-}" != smoke ]] || exit 1\necho smoke-ok\n')
            names = ('postgres', 'redis', 'minio', 'api', 'worker', 'beat', 'web', 'caddy')
            rows = {k: {'id': f'{i + 1:064x}', 'image': 'sha256:' + f'{i + 100:064x}', 'status': 'running', 'started': 'old', 'policy': 'unless-stopped'} for i, k in enumerate(names)}
            state = {'head': BASE, 'schema': '0014_mls_device_rekey', 'containers': rows, 'migration_attempted': False, 'original_api': rows['api']['id'], 'images': {'sudoku-minio-init': 'sha256:' + 'e' * 64}}
            (home / 'state.json').write_text(json.dumps(state))
            prior = home / 'sudoku-release-records/pin-backup-prior'
            backup = prior / 'backup'
            (backup / 'objects').mkdir(parents=True)
            (backup / 'postgres.dump').write_text('synthetic prior dump')
            (backup / 'manifest.txt').write_text(f'git_commit={BASE}\nmethod=quiesced-current-objects\nrestore_tested=false\n')
            (backup / 'SHA256SUMS').write_text(''.join((f'{hashlib.sha256(f.read_bytes()).hexdigest()}  ./{f.name}\n' for f in sorted(backup.iterdir()) if f.is_file())))
            (prior / 'result.txt').write_text(f'checkout={BASE}\nbackup={backup}\n')
            (prior / 'containers.tsv').write_text(''.join((f"{k}\t{v['id']}\t{v['image']}\n" for k, v in rows.items())))
            if mode == 'bad-backup':
                (backup / 'postgres.dump').write_text('damaged')
            if mode == 'identity':
                state['containers']['api']['id'] = 'f' * 64
                (home / 'state.json').write_text(json.dumps(state))
            binary = home / 'bin'
            binary.mkdir()
            for name in ('docker', 'git', 'sleep', 'curl'):
                p = binary / name
                p.write_text(FAKE)
                p.chmod(493)
            (binary / 'python3').write_text('#!/bin/sh\nexec /usr/bin/python3 -S "$@"\n')
            (binary / 'python3').chmod(493)
            env = {**os.environ, 'HOME': str(home), 'FAKE_ROOT': str(home), 'MODE': mode, 'SIGNAL_SOURCE': str(ROOT / 'scripts/legacy-api-signal.py'), 'PATH': f'{binary}:' + os.environ['PATH']}
            result = subprocess.run(['bash', str(ROOT / 'scripts/deploy-pin-application-only.sh'), str(prior)], cwd=repo, env=env, capture_output=True, text=True, timeout=30, check=False)
            calls = [json.loads(x) for x in (home / 'calls.jsonl').read_text().splitlines()] if (home / 'calls.jsonl').exists() else []
            final = json.loads((home / 'state.json').read_text())
            for c in calls:
                if c[0] == 'docker':
                    self.assertNotIn(c[1], ('rm', 'kill', 'prune', 'pull', 'commit'))
                    if c[1] == 'compose':
                        self.assertFalse(any((x in c for x in ('down', 'restart', '--remove-orphans'))))
            return (result, calls, final)

    def test_success_preserves_infrastructure_and_pins_before_exposure(self):
        result, _, state = self.run_case()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('PIN_DEPLOY_OK ' + TARGET, result.stdout)
        self.assertEqual(state['schema'], '0015_session_pins')
        for k in ('postgres', 'redis', 'minio'):
            self.assertEqual(state['containers'][k]['started'], 'old')
        self.assertEqual(state['containers']['caddy']['status'], 'running')

    def test_preflight_failures_do_not_stop_application(self):
        for mode in ('bad-backup', 'identity', 'dirty', 'missing-api-image', 'wrong-process'):
            with self.subTest(mode=mode):
                result, calls, state = self.run_case(mode)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(any((c[0] == 'docker' and c[1] in ('stop', 'start', 'update') for c in calls)))
                self.assertFalse(state['migration_attempted'])

    def test_before_migration_failure_recovers_old_containers(self):
        for mode in ('build', 'forced-worker', 'signal', 'no-shutdown-markers', 'dump', 'mirror'):
            with self.subTest(mode=mode):
                result, _, state = self.run_case(mode)
                self.assertNotEqual(result.returncode, 0, result.stdout)
                self.assertNotIn('PIN_DEPLOY_OK', result.stdout)
                self.assertFalse(state['migration_attempted'])
                self.assertEqual(state['head'], BASE)
                self.assertTrue(all((v['status'] == 'running' for v in state['containers'].values())))
                self.assertEqual(state['containers']['api']['policy'], 'unless-stopped')

    def test_after_migration_never_reopens_old_api_or_public_edge(self):
        for mode in ('migration', 'up-api', 'infra-drift', 'restart', 'beat-error', 'smoke', 'endpoint'):
            with self.subTest(mode=mode):
                result, _, state = self.run_case(mode)
                self.assertNotEqual(result.returncode, 0)
                self.assertTrue(state['migration_attempted'])
                self.assertNotIn('PIN_DEPLOY_OK', result.stdout)
                self.assertEqual(state['containers']['caddy']['status'], 'exited')
                self.assertEqual(state['head'], TARGET)
if __name__ == '__main__':
    unittest.main()
