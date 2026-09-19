# Step 29 — Code/security review: sensitive URL logging

## Finding
The application access middleware logs templated routes, but third-party HTTP client INFO logging can emit complete URLs. Invite acceptance carries the one-time invite secret in the path, so full-URL transport logs can disclose that secret. This was visible in earlier integration logs.

## Fix
- Normal production logging raises `httpx` and `httpcore` to WARNING.
- Application HTTP logs remain the normalized/templated middleware records.
- Existing structured-log redaction remains defense-in-depth for secret/token/password fields.

## Architectural follow-up
V2 should move invite acceptance secret from the URL path into the request body to reduce exposure in proxies/browser history independently of logging configuration.

## Next
Finish review, rerun full acceptance, and update final production-readiness status.
