#!/usr/bin/env bash
set -Eeuo pipefail

ENV_FILE="${ENV_FILE:-.env.production}"
SKIP_DNS="${SKIP_DNS:-0}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ "$ENV_FILE" != /* ]]; then
  ENV_FILE="$(pwd)/$ENV_FILE"
fi
cd "$ROOT_DIR"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Production env file not found: $ENV_FILE" >&2
  exit 1
fi

for command in docker python3 getent stat; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "Required command not found: $command" >&2
    exit 1
  }
done

compose_version="$(docker compose version --short 2>/dev/null | sed 's/^v//')"
python3 - "$compose_version" <<'PYVERSION'
import sys

raw = sys.argv[1].split("-")[0]
try:
    current = tuple(int(part) for part in raw.split(".")[:3])
except ValueError as exc:
    raise SystemExit(f"Cannot parse Docker Compose version: {sys.argv[1]}") from exc
minimum = (2, 24, 4)
current += (0,) * (3 - len(current))
if current < minimum:
    raise SystemExit(f"Docker Compose >= 2.24.4 is required, got {sys.argv[1]}")
PYVERSION

mode="$(stat -c '%a' "$ENV_FILE")"
if (( 10#$mode % 100 > 0 )); then
  echo "$ENV_FILE must not be readable/writable by group or others (recommended mode 600), got $mode" >&2
  exit 1
fi

set -a
# The production env file is trusted operator input and intentionally uses shell-compatible KEY=VALUE syntax.
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

required=(
  APP_DOMAIN POSTGRES_PASSWORD MINIO_ROOT_USER MINIO_ROOT_PASSWORD
  S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY VAPID_PUBLIC_KEY VAPID_PRIVATE_KEY VAPID_SUBJECT
)
for name in "${required[@]}"; do
  value="${!name:-}"
  if [[ -z "$value" ]]; then
    echo "Missing required production variable: $name" >&2
    exit 1
  fi
  if [[ "$value" == *replace* || "$value" == *generate-a-long-random-secret* || "$value" == *example.com* ]]; then
    echo "Production variable still contains a placeholder: $name" >&2
    exit 1
  fi
done

if [[ ! "$POSTGRES_PASSWORD" =~ ^[A-Za-z0-9._~-]{32,}$ ]]; then
  echo "POSTGRES_PASSWORD must be >=32 URL-unreserved characters because it is embedded in DATABASE_URL. Use: openssl rand -hex 32" >&2
  exit 1
fi
if (( ${#MINIO_ROOT_PASSWORD} < 32 )); then
  echo "MINIO_ROOT_PASSWORD must be at least 32 characters" >&2
  exit 1
fi
if (( ${#S3_SECRET_ACCESS_KEY} < 32 )); then
  echo "S3_SECRET_ACCESS_KEY must be at least 32 characters" >&2
  exit 1
fi
if [[ "$S3_ACCESS_KEY_ID" == "$MINIO_ROOT_USER" ]]; then
  echo "S3_ACCESS_KEY_ID must be a dedicated application user, not the MinIO root user" >&2
  exit 1
fi
if [[ "${REQUIRE_E2EE_NEW_CONVERSATIONS:-true}" != "true" ]]; then
  echo "REQUIRE_E2EE_NEW_CONVERSATIONS must remain true in production" >&2
  exit 1
fi
if [[ "$VAPID_SUBJECT" != mailto:* && "$VAPID_SUBJECT" != https://* ]]; then
  echo "VAPID_SUBJECT must start with mailto: or https://" >&2
  exit 1
fi

python3 - <<'PYVALIDATE'
import base64
import os
import re

hostname = os.environ["APP_DOMAIN"]
if len(hostname) > 253 or hostname.endswith(".") or hostname.lower() in {"localhost", "localhost.localdomain"}:
    raise SystemExit("APP_DOMAIN must be a public hostname without scheme, path, or trailing dot")
labels = hostname.split(".")
if len(labels) < 2:
    raise SystemExit("APP_DOMAIN must contain at least two DNS labels")
label_re = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$")
if any(not label_re.fullmatch(label) for label in labels):
    raise SystemExit("APP_DOMAIN contains an invalid DNS label")

def decode(value: str) -> bytes:
    value += "=" * (-len(value) % 4)
    try:
        return base64.urlsafe_b64decode(value.encode("ascii"))
    except Exception as exc:
        raise SystemExit("VAPID keys must be base64url") from exc

private = decode(os.environ["VAPID_PRIVATE_KEY"])
public = decode(os.environ["VAPID_PUBLIC_KEY"])
if len(private) != 32:
    raise SystemExit(f"VAPID_PRIVATE_KEY must decode to 32 raw bytes, got {len(private)}")
if len(public) != 65 or public[0] != 4:
    raise SystemExit("VAPID_PUBLIC_KEY must be an uncompressed P-256 point (65 bytes, prefix 0x04)")
PYVALIDATE

compose=(docker compose --env-file "$ENV_FILE" -f compose.yaml -f compose.production.yaml)
compose_json="$(mktemp)"
trap 'rm -f "$compose_json"' EXIT
"${compose[@]}" config --format json > "$compose_json"
python3 - "$compose_json" <<'PYCOMPOSE'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    config = json.load(handle)
services = config["services"]
ports = {str(item["published"]) for item in services["caddy"].get("ports", [])}
if ports != {"80", "443"}:
    raise SystemExit(f"unexpected Caddy published ports: {sorted(ports)}")
for name in ("postgres", "redis", "minio", "minio-init", "api", "worker", "beat", "web"):
    if services[name].get("ports"):
        raise SystemExit(f"production service {name} unexpectedly publishes ports: {services[name]['ports']}")
PYCOMPOSE

if [[ "$SKIP_DNS" != "1" ]]; then
  getent ahosts "$APP_DOMAIN" >/dev/null || {
    echo "DNS does not resolve: $APP_DOMAIN" >&2
    exit 1
  }
  getent ahosts "assets.$APP_DOMAIN" >/dev/null || {
    echo "DNS does not resolve: assets.$APP_DOMAIN" >&2
    exit 1
  }
fi

echo "[preflight] production configuration passed"
