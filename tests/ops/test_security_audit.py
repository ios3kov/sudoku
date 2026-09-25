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
