# Step 02 — Foundation + Sudoku Shell

## Goal

Create a repository-ready foundation and implement the public-facing PWA shell without pretending the messenger backend exists.

## Implemented

- Workspace structure for web, API, domain, and docs.
- Dependency-free Sudoku rules engine.
- Fixed high-quality 9x9 puzzle with known solution.
- Notes/candidate support in domain layer.
- Secret gesture state machine with time, distance, direction, and horizontal-drift constraints.
- Next.js App Router PWA manifest.
- Service-worker registration and generic Sudoku notification handler.
- Client shell that always launches in Sudoku mode.
- Background privacy policy: messenger surface is hidden after 30 seconds away.

## Files

- `packages/domain/src/sudoku.ts`
- `packages/domain/src/secret-gesture.ts`
- `packages/domain/tests/*.test.ts`
- `apps/web/app/*`
- `apps/web/features/sudoku/*`
- `apps/web/features/secret-unlock/*`
- `apps/web/public/sw.js`

## Verification

See `docs/PROGRESS.md` for executed checks and limitations.

## Next step

Invite-only authentication and revocable device sessions.
