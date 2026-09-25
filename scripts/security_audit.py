#!/usr/bin/env python3
"""Read-only, stdlib-only security gate for the Sudoku repository.

This complements dependency audits and tests. It scans source/configuration plus,
optionally, reachable git history. It is intentionally conservative: findings are
review prompts, not a claim that an exploit exists.
"""
from __future__ import annotations

import argparse
import ast
import json
import re
import subprocess
import sys
from dataclasses import asdict, dataclass
from pathlib import Path

RANK = {"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4}
SKIP = {".git", "node_modules", ".next", "dist", "build", ".venv", "venv", "__pycache__", "coverage", "target", "generated", "test-results"}
TEXT = {".py", ".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".json", ".yml", ".yaml", ".toml", ".ini", ".cfg", ".sh", ".sql", ".md", ".txt", ".html", ".css", ".xml", ".plist", ".swift", ".rs", ".env"}
MAX_FILE = 2_000_000
SELF_SCAN_IGNORE = {"scripts/security_audit.py", "tests/ops/test_security_audit.py"}
REQUEST_ASYNC_SURFACES = {
    "apps/api/app/e2ee.py",
    "apps/api/app/realtime.py",
}

SECRET_PATTERNS = [
    ("anthropic", re.compile(r"\bsk-ant-[A-Za-z0-9_-]{20,}\b")),
    ("openai", re.compile(r"\bsk-(?!ant-)[A-Za-z0-9_-]{20,}\b")),
    ("github", re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b")),
    ("aws", re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b")),
    ("stripe-live", re.compile(r"\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b")),
    ("slack", re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{10,}\b")),
    ("telegram", re.compile(r"\b\d{8,10}:[A-Za-z0-9_-]{35}\b")),
    ("private-key", re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----")),
]
GENERIC_SECRET = re.compile(r"(?i)\b(api[_-]?key|client[_-]?secret|secret|password|token)\b\s*[:=]\s*[\"']([^\"'\s]{16,})[\"']")
PUBLIC_ENV_SECRET = re.compile(r"\b(?:NEXT_PUBLIC_|VITE_|REACT_APP_)[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PRIVATE|API_KEY)[A-Z0-9_]*\b")
PLACEHOLDER = re.compile(r"(?i)(example|replace|dummy|fake|sample|test|changeme|generate|placeholder|not-a-real|ci-|sudoku-ci|<[^>]+>)")

PUBLIC_ROUTES = {
    ("GET", "/v1/health"),
    ("GET", "/v1/health/ready"),
    ("POST", "/v1/auth/login"),
    ("POST", "/v1/invites/accept"),
}
SESSION_CONTEXT_ALLOWED = {
    "apps/api/app/routes/device_access.py",
    "apps/api/app/realtime.py",
    "apps/api/app/deps.py",
}


@dataclass(frozen=True)
class Finding:
    rule: str
    severity: str
    path: str
    line: int | None
    problem: str
    fix: str


class Audit:
    def __init__(self, root: Path):
        self.root = root.resolve()
        self.findings: list[Finding] = []
        self.routes: list[dict] = []

    def add(self, rule: str, severity: str, path: str, line: int | None, problem: str, fix: str) -> None:
        self.findings.append(Finding(rule, severity, path, line, problem, fix))

    def files(self):
        for path in self.root.rglob("*"):
            if any(part in SKIP for part in path.parts) or path.is_symlink() or not path.is_file():
                continue
            if not (path.name.startswith(".env") or path.suffix.lower() in TEXT):
                continue
            try:
                rel = path.relative_to(self.root).as_posix()
                if rel in SELF_SCAN_IGNORE:
                    continue
                resolved = path.resolve()
                if not resolved.is_relative_to(self.root) or path.stat().st_size > MAX_FILE:
                    continue
                yield path, path.read_text(encoding="utf-8", errors="ignore")
            except OSError:
                continue

    def rel(self, path: Path) -> str:
        return path.relative_to(self.root).as_posix()

    def run(self, history: bool = False) -> list[Finding]:
        self.check_secrets()
        self.check_env_tracking()
        self.check_python()
        self.check_browser_native()
        self.check_workflows()
        self.check_runtime()
        self.check_invariants()
        if history:
            self.check_history()
        unique = {(f.rule, f.severity, f.path, f.line, f.problem): f for f in self.findings}
        self.findings = sorted(unique.values(), key=lambda f: (RANK[f.severity], f.path, f.line or 0, f.rule))
        return self.findings

    def check_secrets(self) -> None:
        for path, text in self.files():
            rel = self.rel(path)
            for kind, regex in SECRET_PATTERNS:
                for match in regex.finditer(text):
                    if PLACEHOLDER.search(match.group(0)):
                        continue
                    self.add("secret-current", "critical", rel, text.count("\n", 0, match.start()) + 1,
                             f"Possible {kind} credential is present in the current tree; value suppressed.",
                             "Rotate it immediately, remove it from source and scan git history.")
            for match in GENERIC_SECRET.finditer(text):
                if PLACEHOLDER.search(match.group(2)):
                    continue
                self.add("generic-secret-current", "high", rel, text.count("\n", 0, match.start()) + 1,
                         f"Hard-coded value assigned to secret-like name {match.group(1)}.",
                         "Move it to secret storage/environment and rotate if real.")
            for match in PUBLIC_ENV_SECRET.finditer(text):
                self.add("public-env-secret", "critical", rel, text.count("\n", 0, match.start()) + 1,
                         f"Browser-public environment variable {match.group(0)} looks secret.",
                         "Keep credentials server-side; public frontend env prefixes expose values.")

    def git(self, *args: str, timeout: int = 60):
        if not (self.root / ".git").exists():
            return None
        try:
            return subprocess.run(
                ["git", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "-C", str(self.root), *args],
                capture_output=True, text=True, timeout=timeout, check=False,
            )
        except (OSError, subprocess.TimeoutExpired):
            return None

    def check_env_tracking(self) -> None:
        result = self.git("ls-files")
        if result is None:
            return
        for rel in result.stdout.splitlines():
            name = Path(rel).name
            if name.startswith(".env") and not name.endswith((".example", ".sample", ".template")):
                self.add("tracked-env", "critical", rel, None, "A real .env-style file is tracked by git.",
                         "Remove it from git and rotate every contained credential.")
        path = self.root / ".gitignore"
        text = path.read_text(errors="ignore") if path.exists() else ""
        if ".env" not in text:
            self.add("env-gitignore", "medium", ".gitignore", None, ".env is not clearly ignored.",
                     "Ignore .env and environment-specific secret files.")

    @staticmethod
    def call_name(call: ast.Call) -> str:
        parts = []
        current = call.func
        while isinstance(current, ast.Attribute):
            parts.append(current.attr)
            current = current.value
        if isinstance(current, ast.Name):
            parts.append(current.id)
        return ".".join(reversed(parts))

    @staticmethod
    def router_prefix(tree: ast.Module) -> str:
        for node in tree.body:
            if not isinstance(node, ast.Assign):
                continue
            if not any(isinstance(target, ast.Name) and target.id == "router" for target in node.targets):
                continue
            if not isinstance(node.value, ast.Call) or not Audit.call_name(node.value).endswith("APIRouter"):
                continue
            for keyword in node.value.keywords:
                if keyword.arg == "prefix" and isinstance(keyword.value, ast.Constant) and isinstance(keyword.value.value, str):
                    return keyword.value.value
        return ""

    def route_decorators(self, node, prefix: str):
        out = []
        for decorator in node.decorator_list:
            if not isinstance(decorator, ast.Call) or not isinstance(decorator.func, ast.Attribute) or not decorator.args:
                continue
            method = decorator.func.attr.upper()
            if method not in {"GET", "POST", "PUT", "PATCH", "DELETE", "WEBSOCKET"}:
                continue
            arg = decorator.args[0]
            if not isinstance(arg, ast.Constant) or not isinstance(arg.value, str):
                continue
            raw = arg.value
            route = f"{prefix.rstrip('/')}{raw}" if prefix and raw.startswith("/") else raw
            out.append((method, route))
        return out

    def check_python(self) -> None:
        for path, text in self.files():
            if path.suffix != ".py":
                continue
            rel = self.rel(path)
            try:
                tree = ast.parse(text, filename=rel)
            except SyntaxError as exc:
                self.add("python-parse", "info", rel, exc.lineno, "Audit could not parse this Python file.", "Ensure compile checks cover it.")
                continue
            prefix = self.router_prefix(tree)
            parents = {}
            for parent in ast.walk(tree):
                for child in ast.iter_child_nodes(parent):
                    parents[child] = parent

            for call in [node for node in ast.walk(tree) if isinstance(node, ast.Call)]:
                name = self.call_name(call)
                if name in {"eval", "exec", "os.system"}:
                    self.add("dangerous-python-exec", "high", rel, call.lineno, f"Dangerous execution primitive {name}() is used.",
                             "Replace with explicit parsing or a non-shell process call.")
                if name in {"pickle.load", "pickle.loads"}:
                    self.add("unsafe-deserialization", "high", rel, call.lineno, f"{name}() can execute hostile serialized data.",
                             "Use a non-executable serialization format for untrusted data.")
                if name.startswith("subprocess."):
                    for keyword in call.keywords:
                        if keyword.arg == "shell" and isinstance(keyword.value, ast.Constant) and keyword.value.value is True:
                            self.add("subprocess-shell", "high", rel, call.lineno, "subprocess uses shell=True.",
                                     "Use an argument list with shell=False.")

            for fn in [node for node in ast.walk(tree) if isinstance(node, (ast.AsyncFunctionDef, ast.FunctionDef))]:
                source = ast.get_source_segment(text, fn) or ""
                for method, route in self.route_decorators(fn, prefix):
                    self.routes.append({"method": method, "path": route, "name": fn.name, "file": rel, "line": fn.lineno})
                    has_auth = "Depends(get_auth_context)" in source or "Depends(get_session_context)" in source
                    if route.startswith("/v1") and (method, route) not in PUBLIC_ROUTES and method != "WEBSOCKET" and not has_auth:
                        self.add("route-auth", "high", rel, fn.lineno, f"{method} {route} has no visible auth dependency.",
                                 "Require server-side authentication or explicitly document the public route.")

                request_async_surface = rel.startswith("apps/api/app/routes/") or rel in REQUEST_ASYNC_SURFACES
                if isinstance(fn, ast.AsyncFunctionDef) and request_async_surface:
                    for call in [node for node in ast.walk(fn) if isinstance(node, ast.Call)]:
                        name = self.call_name(call)
                        if name not in {"verify_password", "hash_password", "hash_device_pin", "verify_device_pin"}:
                            continue
                        parent = parents.get(call)
                        offloaded = False
                        while parent is not None and parent is not fn:
                            if isinstance(parent, ast.Call) and self.call_name(parent).endswith("run_in_threadpool"):
                                offloaded = True
                                break
                            parent = parents.get(parent)
                        if not offloaded:
                            self.add("blocking-password-hash", "high", rel, call.lineno,
                                     f"Memory-hard password operation {name}() runs directly in async code.",
                                     "Run Argon2 work in a thread pool and keep abuse limits in front of it.")

            if rel not in SESSION_CONTEXT_ALLOWED and "Depends(get_session_context)" in text:
                line = next((i for i, value in enumerate(text.splitlines(), 1) if "Depends(get_session_context)" in value), None)
                self.add("pin-gate-bypass", "high", rel, line,
                         "Raw session authentication is used outside the approved device-access boundary.",
                         "Use get_auth_context so configured PIN/biometric gating cannot be bypassed.")

            if rel.endswith("routes/auth.py") and "verify_password(user.password_hash" in text and "DUMMY_PASSWORD_HASH" not in text:
                line = next((i for i, value in enumerate(text.splitlines(), 1) if "verify_password(user.password_hash" in value), None)
                self.add("login-timing-enumeration", "high", rel, line,
                         "Login appears to skip Argon2 when an account is missing, creating a timing discrepancy.",
                         "Verify a fixed dummy Argon2 hash for missing/inactive accounts and return the same error.")

    def check_browser_native(self) -> None:
        rules = [
            (re.compile(r"\bdangerouslySetInnerHTML\b"), "dom-xss-sink", "medium", "React dangerouslySetInnerHTML is present.", "Avoid raw HTML or sanitize through a reviewed policy."),
            (re.compile(r"\b(?:eval|Function)\s*\("), "browser-code-exec", "high", "Dynamic JavaScript execution is present.", "Avoid eval/Function and parse data explicitly."),
            (re.compile(r"\bdocument\.write\s*\("), "document-write", "medium", "document.write() is present.", "Use framework/DOM rendering."),
            (re.compile(r"(?:localStorage|sessionStorage)\.setItem\([^\n]*(?:token|secret|password|session)", re.I), "browser-secret-storage", "high", "Secret-like state is written to Web Storage.", "Keep bearer credentials in HttpOnly cookies or protected native storage."),
            (re.compile(r"postMessage\([^\n]*[\"']\*[\"']"), "postmessage-wildcard", "medium", "postMessage uses wildcard target origin.", "Use an exact trusted target origin."),
        ]
        for path, text in self.files():
            rel = self.rel(path)
            if rel.startswith("apps/web/") and "/tests/" not in rel and path.suffix.lower() in {".js", ".jsx", ".mjs", ".ts", ".tsx"}:
                for regex, rule, severity, problem, fix in rules:
                    for match in regex.finditer(text):
                        self.add(rule, severity, rel, text.count("\n", 0, match.start()) + 1, problem, fix)
            if rel.endswith("Info.plist") and re.search(r"<key>NSAllowsArbitraryLoads</key>\s*<true\s*/>", text):
                self.add("ios-ats-disabled", "critical", rel, None, "iOS App Transport Security is globally disabled.",
                         "Remove NSAllowsArbitraryLoads or use narrowly scoped exceptions.")

    def check_workflows(self) -> None:
        folder = self.root / ".github" / "workflows"
        if not folder.exists():
            self.add("ci-missing", "medium", ".github/workflows", None, "No CI workflows exist.", "Run security/test gates on every PR.")
            return
        for path in sorted(list(folder.glob("*.yml")) + list(folder.glob("*.yaml"))):
            text = path.read_text(errors="ignore")
            rel = self.rel(path)
            if re.search(r"(?m)^\s*pull_request_target\s*:", text):
                self.add("pull-request-target", "high", rel, None, "pull_request_target runs in a privileged base-repo context.",
                         "Prefer pull_request unless the privileged design is explicitly hardened.")
            if not re.search(r"(?m)^permissions\s*:", text):
                self.add("actions-permissions", "medium", rel, None, "Workflow does not declare a GITHUB_TOKEN permission floor.",
                         "Add top-level permissions: contents: read and elevate only per job when necessary.")
            for line_no, line in enumerate(text.splitlines(), 1):
                match = re.search(r"\buses:\s*([^\s#]+)", line)
                if not match:
                    continue
                target = match.group(1)
                if target.startswith("./"):
                    continue
                ref = target.rsplit("@", 1)[1] if "@" in target else ""
                if not re.fullmatch(r"[0-9a-fA-F]{40}", ref):
                    self.add("unpinned-action", "medium", rel, line_no, f"GitHub Action {target} is not pinned to a full commit SHA.",
                             "Pin actions to reviewed immutable SHAs; Dependabot can maintain them.")

    def check_runtime(self) -> None:
        prod = self.root / "compose.production.yaml"
        if not prod.exists():
            self.add("prod-compose-missing", "high", "compose.production.yaml", None, "Production Compose overlay is missing.", "Version production isolation/hardening.")
        else:
            text = prod.read_text(errors="ignore")
            checks = [
                (r"(?m)^\s*privileged:\s*true\s*$", "compose-privileged", "critical", "Production service is privileged."),
                (r"(?m)^\s*network_mode:\s*host\s*$", "compose-host-network", "high", "Production service uses host networking."),
                (r"/var/run/docker\.sock", "compose-docker-sock", "critical", "Docker socket is mounted in production."),
                (r"image:\s*[^\s]+:latest(?:\s|$)", "compose-latest", "medium", "Production image uses mutable :latest."),
                (r"(?m)^\s*-\s*[\"']?(?:5432|6379|9000):(?:5432|6379|9000)", "compose-data-port", "high", "Data-service port is published by production."),
            ]
            for regex, rule, severity, problem in checks:
                match = re.search(regex, text)
                if match:
                    self.add(rule, severity, "compose.production.yaml", text.count("\n", 0, match.start()) + 1, problem, "Keep data services internal and containers least-privileged.")
            for marker in ('SECURE_COOKIES: "true"', 'REQUIRE_E2EE_NEW_CONVERSATIONS: "true"', "no-new-privileges:true"):
                if marker not in text:
                    self.add("production-security-gate", "high", "compose.production.yaml", None, f"Required production marker is missing: {marker}", "Restore the invariant and keep it under CI.")

        caddy = self.root / "infra/caddy/Caddyfile.production"
        if caddy.exists():
            text = caddy.read_text(errors="ignore")
            for header in ("Strict-Transport-Security", "Content-Security-Policy", "X-Content-Type-Options", "Referrer-Policy"):
                if header not in text:
                    self.add("security-header", "medium", self.rel(caddy), None, f"Production edge is missing {header}.", "Add it at the TLS edge.")
            match = re.search(r"script-src[^\n]*'unsafe-inline'", text)
            if match:
                self.add("csp-unsafe-inline", "medium", self.rel(caddy), text.count("\n", 0, match.start()) + 1,
                         "CSP permits inline JavaScript with unsafe-inline.",
                         "Move toward nonce/hash-based strict CSP after validating Next.js hydration.")
        for rel in ("infra/minio/cors.xml", "infra/minio/cors.template.xml"):
            path = self.root / rel
            if not path.exists():
                continue
            text = path.read_text(errors="ignore")
            if re.search(r"<AllowedOrigin>\s*\*\s*</AllowedOrigin>", text):
                self.add("cors-wildcard-origin", "high", rel, None, "Object storage CORS allows every origin.", "Restrict it to the application origin.")
            if re.search(r"<AllowedHeader>\s*\*\s*</AllowedHeader>", text):
                self.add("cors-wildcard-header", "low", rel, None, "Object storage accepts any CORS request header from its allowed origin.", "Reduce to required upload headers after compatibility verification.")

    def check_invariants(self) -> None:
        expected = {
            "apps/api/app/middleware.py": ["SameOriginMutationMiddleware", "Cache-Control", "no-store"],
            "apps/api/app/schemas.py": ["MAX_E2EE_MESSAGE_BYTES", "class E2eeEnvelopeRequest", 'kind: Literal["application"]'],
            "apps/api/app/deps.py": ["Session.revoked_at.is_(None)", "Session.expires_at > now", "pin_allows"],
            "apps/api/app/routes/messaging.py": ["E2EE conversation requires ciphertext envelope and forbids plaintext body", "ciphertext-only assets"],
            "apps/api/app/realtime.py": ['websocket.headers.get("origin")', "EXPECTED_ORIGIN", "MAX_CLIENT_FRAME_CHARS"],
            "apps/api/app/observability.py": ["_redact_sensitive", "Request/message bodies are never logged"],
            "apps/web/public/sw.js": ['url.pathname.startsWith("/v1/")', "const isStatic"],
            "apps/web/features/messenger/crypto/browser-state-store.ts": ['{ name: "AES-GCM", length: 256 }, false', "crypto.subtle.encrypt", "crypto.subtle.decrypt"],
            "ios/Sudoku/Sudoku/SudokuViewController.swift": ["limitsNavigationsToAppBoundDomains = true", "isAllowedExternalURL", "message.frameInfo.isMainFrame", "trustedHost"],
            "ios/Sudoku/Sudoku/BiometricBridge.swift": ["message.frameInfo.isMainFrame", "isAllowedSignedPayload", 'sourceURL.host == "sudoku.moscow"'],
        }
        for rel, markers in expected.items():
            path = self.root / rel
            if not path.exists():
                self.add("security-invariant-file", "high", rel, None, "Security-critical file is missing.", "Review architecture before accepting removal.")
                continue
            text = path.read_text(errors="ignore")
            for marker in markers:
                if marker not in text:
                    self.add("security-invariant", "high", rel, None, f"Expected protection marker is missing: {marker}", "Verify whether the protection moved or regressed, then deliberately update this gate.")

    def check_history(self) -> None:
        if not (self.root / ".git").exists():
            self.add("history-unavailable", "info", ".git", None, "Git history unavailable; history secret scan skipped.", "Use fetch-depth 0 in CI.")
            return
        cmd = ["git", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "-C", str(self.root),
               "log", "--all", "--format=@@COMMIT@@%H", "-p", "--no-ext-diff", "--no-textconv", "--no-renames"]
        try:
            proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, errors="ignore")
        except OSError:
            self.add("history-unavailable", "info", ".git", None, "Could not start git history scan.", "Run in a normal git clone.")
            return
        commit, file_path = "unknown", "unknown"
        seen = set()
        assert proc.stdout is not None
        for raw in proc.stdout:
            line = raw.rstrip("\n")
            if line.startswith("@@COMMIT@@"):
                commit = line[12:24]
                continue
            if line.startswith("+++ b/"):
                file_path = line[6:]
                continue
            if not line.startswith(("+", "-")) or line.startswith(("+++", "---")):
                continue
            if file_path in SELF_SCAN_IGNORE:
                continue
            payload = line[1:]
            for kind, regex in SECRET_PATTERNS:
                if regex.search(payload) and not PLACEHOLDER.search(payload):
                    key = (kind, commit, file_path)
                    if key not in seen:
                        seen.add(key)
                        self.add("secret-history", "critical", f"git:{commit}:{file_path}", None,
                                 f"Possible {kind} credential appears in reachable git history; value suppressed.",
                                 "Rotate it even if deleted from current files; consider history rewrite where appropriate.")
            generic = GENERIC_SECRET.search(payload)
            if generic and not PLACEHOLDER.search(generic.group(2)):
                key = ("generic", commit, file_path)
                if key not in seen:
                    seen.add(key)
                    self.add("generic-secret-history", "high", f"git:{commit}:{file_path}", None,
                             "Secret-like assignment appears in reachable git history.",
                             "Review and rotate if real; deleting only the current copy is insufficient.")
        try:
            proc.wait(timeout=120)
        except subprocess.TimeoutExpired:
            proc.kill()
            self.add("history-timeout", "info", ".git", None, "Git history scan timed out.", "Run a dedicated mature secret scanner as an additional gate.")


def write_reports(findings: list[Finding], routes: list[dict], markdown: Path, json_path: Path) -> None:
    counts = {severity: sum(f.severity == severity for f in findings) for severity in RANK}
    lines = ["# Security audit", "", "Read-only static/configuration scan. This is not a penetration test.", "",
             "## Summary", "", " | ".join(f"{severity}: {counts[severity]}" for severity in RANK), ""]
    if findings:
        lines += ["## Findings", ""]
        for finding in findings:
            where = f"{finding.path}:{finding.line}" if finding.line else finding.path
            lines += [f"### {finding.severity.upper()} - {finding.rule}", f"- Where: {where}",
                      f"- Problem: {finding.problem}", f"- Fix: {finding.fix}", ""]
    else:
        lines += ["No findings from implemented rules. This does not prove the application is secure.", ""]
    lines += ["## FastAPI route inventory", "", "| Method | Route | Handler | Source |", "|---|---|---|---|"]
    for route in sorted(routes, key=lambda item: (item["path"], item["method"], item["file"])):
        lines.append(f"| {route['method']} | {route['path']} | {route['name']} | {route['file']}:{route['line']} |")
    markdown.write_text("\n".join(lines) + "\n", encoding="utf-8")
    json_path.write_text(json.dumps({"counts": counts, "findings": [asdict(f) for f in findings], "routes": routes}, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("path", nargs="?", default=".")
    parser.add_argument("--history", action="store_true")
    parser.add_argument("--report", default="security-audit-report.md")
    parser.add_argument("--json", default="security-audit-report.json")
    parser.add_argument("--fail-on", choices=list(RANK), default="high")
    args = parser.parse_args()
    root = Path(args.path).resolve()
    if not root.is_dir():
        print(f"Not a directory: {root}", file=sys.stderr)
        return 2
    audit = Audit(root)
    findings = audit.run(history=args.history)
    write_reports(findings, audit.routes, Path(args.report), Path(args.json))
    counts = {severity: sum(f.severity == severity for f in findings) for severity in RANK}
    print("security-audit: " + ", ".join(f"{severity}={counts[severity]}" for severity in RANK))
    threshold = RANK[args.fail_on]
    return 1 if any(RANK[f.severity] <= threshold for f in findings) else 0


if __name__ == "__main__":
    raise SystemExit(main())
