import json
import re
import subprocess
from importlib import metadata
from pathlib import Path

FORBIDDEN = re.compile(r"(^|[^A-Z])(AGPL|GPL|SSPL|BUSL)(-|$)", re.I)


def check(label: str, rows: list[tuple[str, str | None]]) -> None:
    forbidden = []
    unknown = []
    for name, license_value in rows:
        value = (license_value or "").strip()
        if not value or value.upper() in {"UNKNOWN", "NOASSERTION"}:
            unknown.append(name)
        elif FORBIDDEN.search(value):
            forbidden.append((name, value))
    print(json.dumps({
        "ecosystem": label,
        "packages": len(rows),
        "unknown_license": len(unknown),
        "forbidden": forbidden,
    }, sort_keys=True))
    if forbidden:
        raise SystemExit(f"{label}: forbidden release license detected: {forbidden}")


lock = json.loads(Path("package-lock.json").read_text())
npm_rows = []
for path, item in lock.get("packages", {}).items():
    if not path or "node_modules/" not in path:
        continue
    npm_rows.append((item.get("name") or path.rsplit("node_modules/", 1)[-1], item.get("license")))
check("npm-lock", npm_rows)

cargo = json.loads(subprocess.check_output([
    "cargo", "metadata", "--manifest-path", "packages/mls-wasm/Cargo.toml",
    "--locked", "--format-version", "1",
], text=True))
check("cargo-lock", [(item["name"], item.get("license")) for item in cargo["packages"]])

python_rows = []
for dist in metadata.distributions():
    name = dist.metadata.get("Name") or "unknown"
    expression = dist.metadata.get("License-Expression")
    legacy = dist.metadata.get("License")
    python_rows.append((name, expression or legacy))
check("python-environment", python_rows)
