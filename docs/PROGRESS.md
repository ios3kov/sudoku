# Progress

## Current milestone

Direct-source recovery of the MVP after the damaged bootstrap transport was retired.

## Repository truth

The earlier Step 01–16 documents describe the designed/local MVP snapshot. They are retained as design history, but repository completion is now tracked separately below so documentation never claims code that is not actually present in `main`.

### Step 17 — Direct source import

- Damaged multipart bootstrap mechanism removed.
- `bootstrap/*` removed from `main`.
- CI is now a normal source-code workflow.
- Domain Sudoku + secret-gesture source and tests are committed directly.

### Step 18 — Web PWA + auth gate

- Next.js web workspace committed directly.
- PWA metadata/manifest presents only Sudoku.
- Real 9x9 Sudoku board is wired to the domain parser.
- Hidden `5 -> upward swipe` gesture opens only an authentication gate.
- `GET /v1/me` is required before the private surface renders.
- Login credentials are sent to the API and are not persisted in browser storage.
- 30-second background privacy return to Sudoku is present.

## Verification

- Domain CI workflow is active on `main`.
- Step 18 extends CI to web typecheck + production build.
- FastAPI/auth/message implementation from the earlier local snapshot is **not yet considered restored in repository truth** until its source is committed directly and CI covers it.

## Next step

Step 19: commit FastAPI PostgreSQL-backed invite-only auth/session endpoints, migrations, and API tests; then connect the authenticated web shell to conversations/messages.
