# Step 04 — Web Auth Gate

## Goal

Connect the hidden gesture to real session verification instead of exposing messenger content directly.

## Implemented

- Hidden gesture opens `AuthGate`.
- `AuthGate` immediately checks `/v1/me` with same-origin credentials.
- Valid session opens `MessengerShell`.
- Missing session shows a login form.
- Invite-only registration is available from the same concealed surface using an invite code.
- Logout revokes the server session and returns to Sudoku.
- App background privacy timer continues to force the visible surface back to Sudoku after 30 seconds.
- Browser credentials are never stored in localStorage.

## UX rule

Push notification clicks still open `/` and therefore show Sudoku first. A notification never deep-links directly into the private surface.

## Verification

The TypeScript source is structurally reviewed. Full Next.js typecheck/build requires project dependencies, which cannot be downloaded in the current execution environment.

## Next step

Implement conversations, messages, durable outbox events, realtime WebSocket delivery, and offline client sending.
