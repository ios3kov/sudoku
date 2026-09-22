"""Isolated Docker regression for the real non-root beat command and persistent state.

Use only synthetic settings; create/clean uniquely named containers, network and
volume. No production endpoints, host ports, real messages or worker are used.
"""

import json
import subprocess
import sys
import time
import uuid
from pathlib import Path

STATE_DIR = "/var/lib/sudoku-beat"
SCHEDULE = f"{STATE_DIR}/celerybeat-schedule"
OUTBOX = "dispatch-outbox-every-second"
CLEANUP = "cleanup-orphan-assets-every-six-hours"
TASK = "app.tasks.outbox.dispatch_outbox_batch"


def docker(*args: str, check: bool = True, timeout: int = 60) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["docker", *args], capture_output=True, text=True, check=check, timeout=timeout,
    )


def validate_config(config: dict) -> list[str]:
    beat = config["services"]["beat"]
    command = beat["command"]
    assert command == [
        "celery", "-A", "app.worker:celery_app", "beat", "--loglevel=INFO",
        f"--schedule={SCHEDULE}",
    ], "beat must use the explicit persistent schedule path"
    mounts = [v for v in beat.get("volumes", []) if v["target"] == STATE_DIR]
    assert len(mounts) == 1 and mounts[0]["type"] == "volume"
    assert mounts[0]["source"] == "beat-data" and not mounts[0].get("read_only", False)
    assert not mounts[0].get("volume", {}).get("nocopy", False), "fresh volume must inherit image ownership"
    assert "beat-data" in config["volumes"]
    assert not beat.get("user"), "do not override the image non-root user"
    assert "ALL" in beat["cap_drop"]
    assert "no-new-privileges:true" in beat["security_opt"]
    return command


def main(config_path: str, image: str) -> None:
    config = json.loads(Path(config_path).read_text(encoding="utf-8"))
    command = validate_config(config)
    image_config = json.loads(docker("image", "inspect", image).stdout)[0]["Config"]
    assert image_config["User"] == "sudoku"
    assert image_config["WorkingDir"] == "/srv/api"

    prefix = f"sudoku-beat-test-{uuid.uuid4().hex[:12]}"
    redis_name, beat_name, old_name = (f"{prefix}-{suffix}" for suffix in ("redis", "beat", "old"))
    network, volume = f"{prefix}-net", f"{prefix}-state"
    # No settings are copied from the operator's environment or Compose secrets.
    settings = [
        "-e", "DATABASE_URL=postgresql+asyncpg://test:test@unreachable.invalid/test",
        "-e", "PUBLIC_ORIGIN=https://sudoku.test", "-e", "S3_BUCKET=sudoku-test",
    ]
    security = ["--cap-drop=ALL", "--security-opt=no-new-privileges:true"]
    mount = ["--mount", f"type=volume,source={volume},target={STATE_DIR}"]
    redis_env = ["-e", f"REDIS_URL=redis://{redis_name}:6379/0"]

    def queue_size() -> int:
        return int(docker("exec", redis_name, "redis-cli", "--raw", "LLEN", "celery").stdout.strip())

    def inspect_beat() -> dict:
        return json.loads(docker("inspect", beat_name).stdout)[0]

    def read_schedule() -> dict:
        # Read only after graceful shutdown: never open the scheduler DB concurrently.
        code = (
            "import json,shelve; "
            f"db=shelve.open({SCHEDULE!r},flag='r'); "
            "print(json.dumps({k:{'count':v.total_run_count,'last':v.last_run_at.isoformat()} "
            "for k,v in db['entries'].items()})); db.close()"
        )
        return json.loads(docker(
            "run", "--rm", "--network=none", *security, *mount,
            image, "python", "-c", code,
        ).stdout)

    try:
        # Negative control: the old foreground command must reproduce the live bug.
        old = docker(
            "run", "--name", old_name, "--network=none", *security, *settings,
            "-e", "REDIS_URL=redis://127.0.0.1:6379/0", image, *command[:-1], check=False, timeout=30,
        )
        assert old.returncode != 0 and "PermissionError" in old.stdout + old.stderr
        assert "celerybeat-schedule" in old.stdout + old.stderr
        print("PASS negative control: default schedule path denied for non-root", flush=True)

        docker("network", "create", "--internal", network)
        docker("volume", "create", volume)
        docker(
            "run", "-d", "--name", redis_name, "--network", network,
            config["services"]["redis"]["image"], "redis-server", "--save", "", "--appendonly", "no",
        )
        deadline = time.monotonic() + 30
        while docker("exec", redis_name, "redis-cli", "ping", check=False).stdout.strip() != "PONG":
            if time.monotonic() > deadline:
                raise AssertionError("isolated Redis did not become ready")
            time.sleep(1)

        previous = None
        for cycle in (1, 2):
            before = queue_size()
            docker(
                "run", "-d", "--name", beat_name, "--network", network,
                *security, *mount, *settings, *redis_env, image, *command,
            )
            deadline = time.monotonic() + 30
            while queue_size() < before + 3:
                info = inspect_beat()
                assert info["State"]["Running"] and info["RestartCount"] == 0, "beat exited or restarted"
                if time.monotonic() > deadline:
                    raise AssertionError("beat did not publish three periodic jobs to isolated Redis")
                time.sleep(1)

            message = json.loads(docker(
                "exec", redis_name, "redis-cli", "--raw", "LINDEX", "celery", "0",
            ).stdout)
            assert message["headers"]["task"] == TASK
            docker("exec", beat_name, "python", "-c", (
                "import os,pathlib,stat; "
                f"p=pathlib.Path({STATE_DIR!r}); s=p.stat(); "
                "assert os.geteuid()!=0 and s.st_uid==os.geteuid(); "
                "assert stat.S_IMODE(s.st_mode)==0o700; "
                "assert os.access(p,os.W_OK); assert not os.access('/srv/api',os.W_OK)"
            ))
            docker("stop", "--time", "15", beat_name)
            info = inspect_beat()
            assert info["State"]["ExitCode"] == 0 and info["RestartCount"] == 0
            state = read_schedule()
            assert state[OUTBOX]["count"] >= 3
            if previous is not None:
                assert state[OUTBOX]["count"] > previous[OUTBOX]["count"], "outbox schedule was reset"
                assert state[CLEANUP] == previous[CLEANUP], "long-period schedule was reset on recreation"
            previous = state
            docker("rm", beat_name)
            print(f"PASS cycle {cycle}: non-root publish, graceful stop and persisted schedule", flush=True)
        print("PASS beat runtime: fresh volume and recreated container; production not contacted", flush=True)
    except BaseException:
        for name in (old_name, beat_name, redis_name):
            logs = docker("logs", "--tail", "80", name, check=False)
            print(logs.stdout + logs.stderr, file=sys.stderr)
        raise
    finally:
        # Named test resources only. Never docker prune / compose down on a real stack.
        for name in (old_name, beat_name, redis_name):
            docker("rm", "-f", name, check=False)
        docker("volume", "rm", volume, check=False)
        docker("network", "rm", network, check=False)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("Usage: python tests/ops/beat_runtime.py COMPOSE_JSON BUILT_API_IMAGE")
    main(sys.argv[1], sys.argv[2])
