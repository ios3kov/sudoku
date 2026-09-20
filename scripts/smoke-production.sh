#!/usr/bin/env bash
set -Eeuo pipefail

APP_DOMAIN="${APP_DOMAIN:-${1:-}}"
if [[ -z "$APP_DOMAIN" ]]; then
  echo "Usage: APP_DOMAIN=chat.example.com $0 [chat.example.com]" >&2
  exit 2
fi
for command in curl getent grep awk mktemp; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "Required command not found: $command" >&2
    exit 1
  }
done

origin="https://${APP_DOMAIN}"
assets_origin="https://assets.${APP_DOMAIN}"
app_headers="$(mktemp)"
asset_headers="$(mktemp)"
trap 'rm -f "$app_headers" "$asset_headers"' EXIT

retry_curl() {
  local attempts="${1:-30}"
  shift
  local n
  for ((n=1; n<=attempts; n++)); do
    if curl --silent --show-error --connect-timeout 5 --max-time 15 "$@"; then
      return 0
    fi
    sleep 2
  done
  return 1
}

require_header() {
  local file="$1"
  local header="$2"
  grep -qi "^${header}:" "$file" || {
    echo "Missing required response header: $header" >&2
    exit 1
  }
}

assert_no_server_header() {
  local file="$1"
  if grep -qi '^server:' "$file"; then
    echo "Server header should be removed at the public edge" >&2
    exit 1
  fi
}

echo "[smoke] DNS"
getent ahosts "$APP_DOMAIN" >/dev/null
getent ahosts "assets.$APP_DOMAIN" >/dev/null

echo "[smoke] HTTPS application"
retry_curl 30 --fail --output /dev/null --dump-header "$app_headers" "$origin/"
for header in \
  strict-transport-security \
  content-security-policy \
  x-content-type-options \
  x-frame-options \
  referrer-policy \
  cross-origin-opener-policy \
  cross-origin-resource-policy \
  permissions-policy; do
  require_header "$app_headers" "$header"
done
assert_no_server_header "$app_headers"
csp="$(grep -i '^content-security-policy:' "$app_headers" | head -n 1 | tr -d '\r')"
if [[ "$csp" != *"https://assets.$APP_DOMAIN"* || "$csp" != *"wss://$APP_DOMAIN"* ]]; then
  echo "CSP connect-src does not include the expected asset and secure WebSocket origins" >&2
  exit 1
fi

echo "[smoke] API readiness"
retry_curl 30 --fail --output /dev/null "$origin/v1/health/ready"

echo "[smoke] asset TLS endpoint"
asset_code="$(curl --silent --show-error --connect-timeout 5 --max-time 15 --dump-header "$asset_headers" --output /dev/null --write-out '%{http_code}' "$assets_origin/" || true)"
if [[ "$asset_code" == "000" || -z "$asset_code" ]]; then
  echo "Asset endpoint is not reachable over verified TLS" >&2
  exit 1
fi
for header in strict-transport-security x-content-type-options x-frame-options referrer-policy cross-origin-resource-policy; do
  require_header "$asset_headers" "$header"
done
assert_no_server_header "$asset_headers"

echo "[smoke] HTTP redirects"
for url in "http://${APP_DOMAIN}/" "http://assets.${APP_DOMAIN}/"; do
  response="$(curl --silent --show-error --connect-timeout 5 --max-time 15 --head --write-out $'\n%{http_code}' "$url")"
  code="${response##*$'\n'}"
  headers="${response%$'\n'*}"
  location="$(printf '%s\n' "$headers" | awk 'BEGIN{IGNORECASE=1} /^location:/ {gsub(/\r/, ""); print $2; exit}')"
  [[ "$code" =~ ^30[1278]$ && "$location" == https://* ]] || {
    echo "Expected HTTPS redirect from $url, got status=$code location=${location:-none}" >&2
    exit 1
  }
done

echo "[smoke] live edge checks passed for $APP_DOMAIN"
