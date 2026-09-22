"""Target only the verified legacy Sudoku Uvicorn child, inside its container."""
import argparse
import os
from pathlib import Path
import signal
import sys
from dataclasses import dataclass

UVICORN_ARGS = (
    "app.main:app", "--host", "0.0.0.0", "--port", "8000",
    "--proxy-headers", "--forwarded-allow-ips=*",
)
LEGACY_COMMAND = "alembic upgrade head && uvicorn " + " ".join(UVICORN_ARGS)


@dataclass(frozen=True)
class Target:
    pid: int
    started: int


def command(path: Path) -> tuple[str, ...]:
    return tuple(part.decode("utf-8") for part in (path / "cmdline").read_bytes().split(b"\0") if part)


def identity(path: Path) -> tuple[int, int]:
    # comm may contain whitespace or ')'; fields after the last ')' start at state.
    fields = (path / "stat").read_text().rsplit(")", 1)[1].split()
    return int(fields[1]), int(fields[19])  # ppid, starttime


def inspect_target(proc: Path = Path("/proc")) -> Target:
    if command(proc / "1") != ("/bin/sh", "-c", LEGACY_COMMAND):
        raise RuntimeError("unexpected PID 1; refusing to signal")
    matches = []
    for path in proc.iterdir():
        if not path.name.isdigit() or int(path.name) <= 1:
            continue
        try:
            args = command(path)
            parent, started = identity(path)
        except (FileNotFoundError, ProcessLookupError):
            continue
        # Match the complete server invocation, never a substring or host PID.
        prefixes = (("/usr/local/bin/uvicorn",),
                    ("/usr/local/bin/python", "/usr/local/bin/uvicorn"),
                    ("/usr/local/bin/python3", "/usr/local/bin/uvicorn"),
                    ("/usr/local/bin/python3.13", "/usr/local/bin/uvicorn"))
        if parent == 1 and any(args == prefix + UVICORN_ARGS for prefix in prefixes):
            matches.append(Target(int(path.name), started))
    if len(matches) != 1:
        raise RuntimeError("expected exactly one direct Uvicorn child; refusing to signal")
    return matches[0]


def terminate(proc: Path = Path("/proc")) -> Target:
    target = inspect_target(proc)
    fd = os.pidfd_open(target.pid, 0)
    try:
        # A pidfd avoids delivering SIGTERM to a reused numeric PID.
        if inspect_target(proc) != target:
            raise RuntimeError("server identity changed; refusing to signal")
        signal.pidfd_send_signal(fd, signal.SIGTERM)
    finally:
        os.close(fd)
    return target


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true")
    mode.add_argument("--terminate", action="store_true")
    args = parser.parse_args()
    if not hasattr(os, "pidfd_open") or not hasattr(signal, "pidfd_send_signal"):
        raise RuntimeError("pidfd support is required; refusing to use an unguarded PID")
    target = terminate() if args.terminate else inspect_target()
    print(f"LEGACY_API_{'TERM_SENT' if args.terminate else 'TARGET_OK'} pid={target.pid}", flush=True)


if __name__ == "__main__":
    try:
        main()
    except (OSError, RuntimeError, ValueError, UnicodeError, IndexError) as exc:
        print(f"STOP: legacy API signal guard: {exc}", file=sys.stderr)
        raise SystemExit(1) from None
