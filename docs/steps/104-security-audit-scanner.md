# Step 104 — deterministic security audit scanner

Started 2026-09-25 on branch `security/audit-scanner-2026-09-25`.

## Goal

Add a reusable read-only security gate inspired by lightweight vibe-code scanners, but adapted to Sudoku Messenger's actual architecture. It complements, rather than replaces, human review, API/browser tests, dependency audits and physical-device acceptance.

## Scope

The scanner currently checks:

- high-confidence secret patterns in the working tree;
- tracked `.env` files and secret-like values remaining in Git history;
- FastAPI route-level authentication and sensitive-route rate limiting;
- exact-origin WebSocket/mutation boundaries;
- browser-side paid API calls and public secret-like env names;
- crypto/security code touching `localStorage` or `sessionStorage`;
- dangerous Python execution/deserialization sinks;
- production invariants for E2EE, secure cookies, CSPRNG/Argon2, log redaction and core HTTP security headers;
- relaxed CSP patterns such as `unsafe-inline` as review-level findings.

Existing CI continues to own dependency-specific checks through `pip-audit`, `npm audit` and `cargo audit`.

## Design constraints

- Read-only against the project under audit.
- Standard-library Python only.
- Secrets are masked in reports.
- Git is invoked with hooks and fsmonitor disabled.
- No network scanning or exploit generation.
- Markdown and JSON reports are emitted for humans and CI.
- Exit code 2 means critical/high findings; exit code 1 means medium-only findings; 0 is clean. CI blocks on exit code 2 and retains medium findings as review evidence.
- A clean deterministic scan is not a security guarantee.

## Verification

Added `tests/ops/test_security_audit.py` covering placeholder suppression, high-confidence secret detection, prefixed FastAPI route auth detection and sensitive-route rate-limit detection.

CI now lints the scanner, executes its focused tests, fetches repository history and runs the scanner before the existing dependency audits and integration suites.

## Audit status

The first full repository run must be reviewed manually before findings are considered valid. Regex/AST findings are evidence for inspection, not automatic proof of a vulnerability. Confirmed issues are recorded in the release audit register with reproduction, severity, fix and verification.

No production deployment is authorized by this step.
