# Step 18 — Web PWA + auth gate

## Goal
Publish the first real browser vertical slice after replacing the damaged bootstrap import.

## Implemented
- Next.js PWA metadata/manifest branded only as Sudoku.
- Real 9x9 Sudoku board using the domain puzzle parser.
- Hidden entry remains tap a visible 5 followed by a constrained upward swipe.
- Hidden surface checks `GET /v1/me`; concealment does not grant authorization.
- Login posts only to the server and stores no credentials in browser storage.
- Backgrounding for 30 seconds restores the Sudoku surface.

## CI finding and fix
The first web CI exposed that the workspace domain package had no declaration/export surface for the web TypeScript compiler, and Next 16's URLPattern declarations were missing. The domain package now emits declarations/exports, CI builds it before web checks, and URLPattern typings are installed explicitly.

## Verification
Step is complete only after the rerun passes domain tests, web typecheck and Next production build.

## Next
Publish FastAPI session/auth endpoints and connect the authenticated shell to real conversation history.
