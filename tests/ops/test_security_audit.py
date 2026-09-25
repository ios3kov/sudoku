import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("security_audit", ROOT / "scripts" / "security_audit.py")
security_audit = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
sys.modules[SPEC.name] = security_audit
SPEC.loader.exec_module(security_audit)


class SecurityAuditTests(unittest.TestCase):
    def write(self, root: Path, rel: str, content: str) -> None:
        path = root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")

    def rules(self, root: Path) -> set[str]:
        return {finding.rule for finding in security_audit.Audit(root).run(history=False)}

    def test_detects_current_secret_and_public_browser_secret(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.write(
                root,
                "app.ts",
                'const token = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijkl";\n'
                "const NEXT_PUBLIC_PRIVATE_TOKEN = process.env.X;\n",
            )
            rules = self.rules(root)
            self.assertIn("secret-current", rules)
            self.assertIn("public-env-secret", rules)

    def test_placeholders_do_not_trigger_generic_secret_rule(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.write(root, ".env.production.example", 'PASSWORD="generate-a-long-random-secret"\n')
            self.assertNotIn("generic-secret-current", self.rules(root))

    def test_async_argon2_and_login_timing_shortcut_are_detected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.write(
                root,
                "apps/api/app/routes/auth.py",
                '''
from fastapi import APIRouter
router = APIRouter(prefix="/v1")

@router.post("/auth/login")
async def login(user, payload):
    ok = bool(user and verify_password(user.password_hash, payload.password))
    return ok
''',
            )
            rules = self.rules(root)
            self.assertIn("blocking-password-hash", rules)
            self.assertIn("login-timing-enumeration", rules)

    def test_threadpool_password_verification_clears_argon2_rules(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.write(
                root,
                "apps/api/app/routes/auth.py",
                '''
from fastapi import APIRouter
router = APIRouter(prefix="/v1")
DUMMY_PASSWORD_HASH = "not-a-secret"

@router.post("/auth/login")
async def login(user, payload):
    candidate = user.password_hash if user else DUMMY_PASSWORD_HASH
    return await run_in_threadpool(verify_password, candidate, payload.password)
''',
            )
            rules = self.rules(root)
            self.assertNotIn("blocking-password-hash", rules)
            self.assertNotIn("login-timing-enumeration", rules)

    def test_router_prefix_is_included_in_inventory(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.write(
                root,
                "apps/api/app/routes/example.py",
                '''
from fastapi import APIRouter, Depends
router = APIRouter(prefix="/v1")

@router.get("/private")
async def private(auth=Depends(get_auth_context)):
    return {}
''',
            )
            audit = security_audit.Audit(root)
            audit.run(history=False)
            self.assertTrue(any(route["path"] == "/v1/private" for route in audit.routes))

    def test_flags_conversation_member_contact_disclosure(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.write(
                root,
                "apps/api/app/routes/messaging_support.py",
                """
def members(user):
    return ConversationMemberResponse(
        id=user.id,
        display_name=user.display_name,
        phone_e164=user.phone_e164,
        role="member",
        last_read_sequence=0,
    )
""",
            )
            self.assertIn("conversation-member-pii", self.rules(root))

    def test_workflow_flags_mutable_action_and_missing_permissions(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.write(
                root,
                ".github/workflows/ci.yml",
                "name: ci\non: [push]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n",
            )
            rules = self.rules(root)
            self.assertIn("unpinned-action", rules)
            self.assertIn("actions-permissions", rules)


if __name__ == "__main__":
    unittest.main()
