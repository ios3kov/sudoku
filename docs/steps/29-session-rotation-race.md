# Step 29 — Code/security review: session rotation race

## Finding
`/auth/refresh` relied on authentication performed before entering the endpoint. Two concurrent refresh requests carrying the same valid cookie could both pass that dependency before either committed revocation, allowing multiple replacement sessions to be minted.

## Fix
- Refresh locks the current session row with `SELECT ... FOR UPDATE`.
- Revoked/expired state is rechecked while holding the row lock.
- Only the first concurrent request may revoke and rotate the session.
- A later concurrent request observes the revoked row, clears the stale cookie and returns 401.

## Effect
Session rotation is now single-use under concurrency instead of allowing refresh fan-out.

## Next
Finish storage/logging review, update progress, and require a full green acceptance run after Steps 26–29.
