# Step 33 — Production Compose acceptance

## Goal
Prevent a green application CI from hiding a broken or insecure production Compose merge.

## Added gate
CI now renders `compose.yaml + compose.production.yaml` with non-secret dummy production values and verifies:
- Compose merge is syntactically valid.
- `PUBLIC_ORIGIN` is HTTPS and matches `APP_DOMAIN`.
- `SECURE_COOKIES` remains true.
- Local HTTP origin does not leak into the production result.

## Why
Production configuration is security-sensitive code. It must be verified on every change rather than only documented.

## Next
After this gate passes, repository/deployment configuration is accepted. Provisioning a real host, DNS and secrets remains external.
