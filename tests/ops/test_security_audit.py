import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("security_audit", ROOT / "scripts" / "security-audit.py")
audit = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
sys.modules[SPEC.name] = audit
SPEC.loader.exec_module(audit)


def ids(findings):
    return {item.id for item in findings}


def test_secret_placeholders_are_not_reported():
    out = []
    audit.check_secrets(
        ROOT,
        {".env.production.example": "API_KEY=replace-with-a-long-example-value\n"},
        out,
        history=False,
    )
    assert "secret.generic" not in ids(out)


def test_live_secret_shape_is_reported():
    out = []
    audit.check_secrets(
        ROOT,
        {"app.py": 'OPENAI_KEY="sk-' + ("A" * 32) + '"\n'},
        out,
        history=False,
    )
    assert "secret.openai" in ids(out)


def test_prefixed_private_route_requires_auth():
    out = []
    source = '''
from fastapi import APIRouter
router = APIRouter(prefix="/v1/private")

@router.get("/data")
async def data():
    return {}
'''
    audit.check_routes({"apps/api/app/routes/private.py": source}, out)
    assert "route.auth" in ids(out)


def test_sensitive_mutation_without_rate_limit_is_reported():
    out = []
    source = '''
from fastapi import APIRouter, Depends
router = APIRouter(prefix="/v1/auth")

@router.post("/unlock")
async def unlock(auth = Depends(get_session_context)):
    return {}
'''
    audit.check_routes({"apps/api/app/routes/unlock.py": source}, out)
    assert "route.rate-limit" in ids(out)


def test_remembered_phone_storage_is_not_treated_as_crypto_secret():
    out = []
    source = """
const PHONE_KEY = "sudoku.remembered-phone.v1";
export function rememberPhone(phone: string) {
  localStorage.setItem(PHONE_KEY, phone);
}
"""
    audit.check_sinks({"apps/web/features/messenger/device-access.ts": source}, out)
    assert "client.crypto-webstorage" not in ids(out)


def test_shared_rate_limit_helper_counts_as_route_guard():
    out = []
    source = """
from fastapi import APIRouter, Depends
router = APIRouter(prefix="/v1/auth/device-access")

async def check_password():
    await enforce_login_rate_limit("ip", "user")

@router.post("/password")
async def password_unlock(auth = Depends(get_session_context)):
    await check_password()
    return {}
"""
    audit.check_routes({"apps/api/app/routes/device_access.py": source}, out)
    assert "route.rate-limit" not in ids(out)


def test_special_security_config_files_are_scanned(tmp_path):
    (tmp_path / ".gitignore").write_text(".env\n.env.*\n", encoding="utf-8")
    caddy = tmp_path / "Caddyfile.production"
    caddy.write_text('header { Strict-Transport-Security "max-age=1" }\n', encoding="utf-8")
    scanned = dict(audit.files(tmp_path))
    assert ".gitignore" in scanned
    assert "Caddyfile.production" in scanned


def test_known_synthetic_credentials_are_placeholders():
    assert audit.is_placeholder("ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijkl")
    assert audit.is_placeholder("local-sudoku-password")
    assert not audit.is_placeholder("production-secret-value-without-test-markers")


def test_ci_supply_chain_checks():
    out = []
    workflow = """
name: ci
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
"""
    audit.check_ci_workflows({".github/workflows/ci.yml": workflow}, out)
    assert "ci.permissions" in ids(out)
    assert "ci.mutable-action-ref" in ids(out)


def test_dependency_lock_checks():
    out = []
    audit.check_dependency_reproducibility(
        {
            "apps/api/pyproject.toml": "[project]\ndependencies=[]\n",
            "package.json": "{}",
            "package-lock.json": "{}",
            "packages/mls-wasm/Cargo.toml": "[package]\nname='x'\n",
            "packages/mls-wasm/Cargo.lock": "",
        },
        out,
    )
    assert "supply.python-unlocked" in ids(out)
    assert "supply.node-unlocked" not in ids(out)
    assert "supply.rust-unlocked" not in ids(out)


def test_generated_requirements_lock_is_scanned(tmp_path):
    (tmp_path / "requirements.lock").write_text("fastapi==0.1.0\n")
    assert "requirements.lock" in dict(audit.files(tmp_path))


def test_nonce_csp_proxy_is_accepted_with_reviewed_inline_style_exception():
    out = []
    audit.check_invariants(
        {
            "compose.production.yaml": """
REQUIRE_E2EE_NEW_CONVERSATIONS: "true"
CSP_ASSET_ORIGIN: https://assets.sudoku.test
CSP_WEBSOCKET_ORIGIN: wss://sudoku.test
CSP_UPGRADE_INSECURE_REQUESTS: "true"
""",
            "infra/caddy/Caddyfile.production": """
Strict-Transport-Security
X-Content-Type-Options
X-Frame-Options
Referrer-Policy
""",
            "apps/web/proxy.ts": """
crypto.randomUUID()
const csp = `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'`
requestHeaders.set("x-nonce", nonce)
response.headers.set("Content-Security-Policy", contentSecurityPolicy)
""",
        },
        out,
    )
    found = ids(out)
    assert "invariant.csp-missing" not in found
    assert "invariant.csp-nonce" not in found
    assert "invariant.csp-unsafe-inline" not in found
    assert "invariant.csp-edge-override" not in found
    assert "invariant.csp-prod-origin" not in found


def test_unsafe_inline_script_csp_is_reported():
    out = []
    audit.check_invariants(
        {
            "compose.production.yaml": """
REQUIRE_E2EE_NEW_CONVERSATIONS: "true"
CSP_ASSET_ORIGIN: https://assets.sudoku.test
CSP_WEBSOCKET_ORIGIN: wss://sudoku.test
CSP_UPGRADE_INSECURE_REQUESTS: "true"
""",
            "infra/caddy/Caddyfile.production": """
Strict-Transport-Security
X-Content-Type-Options
X-Frame-Options
Referrer-Policy
""",
            "apps/web/proxy.ts": """
crypto.randomUUID()
const csp = `script-src 'self' 'nonce-${nonce}' 'unsafe-inline'`
requestHeaders.set("x-nonce", nonce)
response.headers.set("Content-Security-Policy", contentSecurityPolicy)
""",
        },
        out,
    )
    assert "invariant.csp-unsafe-inline" in ids(out)
