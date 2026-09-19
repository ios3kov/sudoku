# Step 27 — Code/security review: strict mutation Origin

## Finding
The browser-only PWA uses ambient HttpOnly cookies. Mutation middleware rejected a wrong Origin but allowed a missing Origin, unnecessarily weakening the CSRF boundary for POST/PUT/PATCH/DELETE.

## Fix
- Browser mutation requests now require the exact configured public Origin.
- Missing and mismatched Origin both return 403.
- Integration coverage asserts both cases.
- WebSocket already required exact Origin and remains unchanged.

## Scope
This product is intentionally browser/PWA-only. If a non-browser API client is added later, it should use a separate explicit authentication mechanism rather than weakening cookie-origin checks.

## Next
Continue review of realtime recipient authorization, session lifecycle, storage access and sensitive logging.
