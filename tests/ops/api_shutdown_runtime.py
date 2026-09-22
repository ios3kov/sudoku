"""Real Uvicorn/process-boundary regression in disposable non-root containers.

Uses the production API image and exact Compose launch argv, but a synthetic ASGI
application and migration command. Not a live database or production test.
"""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import uuid

ROOT = Path(__file__).resolve().parents[2]
APP = '''
async def app(scope, receive, send):
    if scope['type'] == 'lifespan':
        while True:
            event = await receive()
            if event['type'] == 'lifespan.startup':
                await send({'type': 'lifespan.startup.complete'})
            elif event['type'] == 'lifespan.shutdown':
                print('SYNTHETIC_LIFESPAN_CLEAN', flush=True)
                await send({'type': 'lifespan.shutdown.complete'})
                return
    else:
        await send({'type': 'http.response.start', 'status': 200, 'headers': []})
        await send({'type': 'http.response.body', 'body': b'ok'})
'''


def docker(*args, check=True, input=None):
    return subprocess.run(['docker', *args], input=input, capture_output=True,
                          text=True, check=check, timeout=90)


def field(name, template):
    return docker('inspect', '-f', template, name).stdout.strip()


def ready(name):
    for _ in range(60):
        if docker('exec', name, 'python', '-c',
                  "import urllib.request; assert urllib.request.urlopen('http://127.0.0.1:8000/',timeout=1).read()==b'ok'",
                  check=False).returncode == 0:
            return
        time.sleep(.25)
    raise AssertionError('synthetic Uvicorn did not become ready')


def clean_exit(name):
    for _ in range(60):
        if field(name, '{{.State.Status}}') == 'exited':
            break
        time.sleep(.25)
    assert field(name, '{{.State.Status}}') == 'exited'
    assert field(name, '{{.State.ExitCode}}') in ('0', '143')
    assert field(name, '{{.State.OOMKilled}}') == 'false'
    logs = docker('logs', name)
    combined = logs.stdout + logs.stderr
    for marker in ('SYNTHETIC_MIGRATION_OK', 'SYNTHETIC_LIFESPAN_CLEAN',
                   'Application shutdown complete', 'Finished server process'):
        assert marker in combined, marker


def main(image):
    commands = [json.loads(line.split('command:', 1)[1].strip())
                for line in (ROOT / 'compose.yaml').read_text().splitlines()
                if 'command:' in line and 'alembic upgrade head' in line]
    assert len(commands) == 1
    fixed = commands[0]
    assert fixed[:2] == ['/bin/sh', '-c']
    assert 'alembic upgrade head && exec uvicorn ' in fixed[2], 'missing exec regression'
    legacy = [*fixed[:2], fixed[2].replace('&& exec uvicorn ', '&& uvicorn ', 1)]
    helper = (ROOT / 'scripts/legacy-api-signal.py').read_text()
    assert field(image, '{{.Config.User}}') == 'sudoku'
    with tempfile.TemporaryDirectory(prefix='sudoku-signal-fixture-') as tmp:
        fixture = Path(tmp)
        (fixture / 'app').mkdir(mode=0o755)
        (fixture / 'app/__init__.py').write_text('')
        (fixture / 'app/main.py').write_text(APP)
        (fixture / 'alembic').write_text('#!/bin/sh\nset -eu\n[ "$*" = "upgrade head" ]\necho SYNTHETIC_MIGRATION_OK\n')
        (fixture / 'alembic').chmod(0o755)
        for case in ('legacy-forced', 'legacy-addressed', 'fixed-exec'):
            name = f'sudoku-signal-test-{uuid.uuid4().hex}'
            try:
                command = fixed if case == 'fixed-exec' else legacy
                docker('run', '-d', '--name', name, '--network', 'none',
                       '--mount', f'type=bind,src={fixture / "app"},dst=/srv/api/app,readonly',
                       '--mount', f'type=bind,src={fixture / "alembic"},dst=/usr/local/bin/alembic,readonly',
                       image, *command)
                ready(name)
                original_id = field(name, '{{.Id}}')
                if case == 'legacy-forced':
                    docker('stop', '--time', '2', name)
                    assert field(name, '{{.State.ExitCode}}') == '137'
                    logs = docker('logs', name)
                    assert 'SYNTHETIC_LIFESPAN_CLEAN' not in logs.stdout + logs.stderr
                elif case == 'legacy-addressed':
                    check = docker('exec', '-i', name, 'python', '-', '--check', input=helper)
                    assert 'LEGACY_API_TARGET_OK' in check.stdout
                    docker('update', '--restart=unless-stopped', name)
                    docker('update', '--restart=no', name)
                    sent = docker('exec', '-i', name, 'python', '-', '--terminate', input=helper)
                    assert 'LEGACY_API_TERM_SENT' in sent.stdout
                    clean_exit(name)
                    docker('start', name)
                    docker('update', '--restart=unless-stopped', name)
                    ready(name)
                    assert field(name, '{{.Id}}') == original_id
                    assert field(name, '{{.HostConfig.RestartPolicy.Name}}') == 'unless-stopped'
                else:
                    pid_one = docker('exec', name, 'python', '-c',
                                     "from pathlib import Path;print(Path('/proc/1/cmdline').read_bytes().replace(b'\\0',b' '))").stdout
                    assert 'uvicorn' in pid_one and '/bin/sh' not in pid_one
                    docker('stop', '--time', '10', name)
                    clean_exit(name)
                print(f'PASS {case}', flush=True)
            finally:
                docker('rm', '-f', name, check=False)
    print('API_SHUTDOWN_RUNTIME_OK', flush=True)


if __name__ == '__main__':
    main(sys.argv[1])
