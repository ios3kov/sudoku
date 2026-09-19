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

## Verification
CI now includes the web TypeScript/build job in addition to domain tests.

## Next
Publish FastAPI session/auth endpoints and connect the authenticated shell to real conversation history.
