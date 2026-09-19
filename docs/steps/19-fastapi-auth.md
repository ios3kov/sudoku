# Step 19 — FastAPI invite-only authentication

## Goal
Restore the first server-side security boundary directly in the repository.

## Implemented
- FastAPI API workspace with async SQLAlchemy/PostgreSQL configuration.
- Users, opaque device sessions, and one-use invite models.
- Argon2 password hashing.
- Random session tokens; only SHA-256 token digests are persisted.
- Secure/HttpOnly/SameSite session cookie configuration.
- `GET /v1/me`, login/logout, admin invite creation, invite acceptance.
- Invite acceptance row-locks the invite and enforces expiry/email/one-use semantics.
- Unit tests cover password hashing and session-token digest behavior.

## Verification
- API dependency install, Python bytecode compilation and security tests passed in CI.
- Domain tests passed in CI.
- Web CI exposed a repository-tree regression: the Step 18 workspace fix was accidentally omitted while constructing Step 19. A corrective commit restores the domain declarations/build-before-web rule.
- `skipLibCheck` is enabled for third-party Next declarations because Next 16 currently references URLPattern globals not present in this TypeScript lib set; application source remains strict.

## Process correction
Every subsequent tree mutation must first read current `main` HEAD/tree and use that exact tree as `base_tree_sha`. Never reuse a pre-fix tree SHA.

## Next
Step 20: PostgreSQL migration/integration + session revocation + rate limiting.
