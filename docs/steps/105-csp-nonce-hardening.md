# Step 105 — CSP nonce hardening

Date: 2026-09-25

## Scope

This step hardens the web Content Security Policy for the Sudoku/PWA shell without performing a production deployment.

Implemented scope:

- Added a Next.js `proxy.ts` that generates a per-response script nonce.
- Sets `Content-Security-Policy` and `x-nonce` on both request and response headers so Next.js can apply nonce-based script execution.
- Made the home page dynamically rendered so nonce extraction is available for the application shell.
- Removed the static Caddy `script-src 'unsafe-inline'` policy and lets the web layer own the dynamic CSP.
- Kept the existing `style-src 'unsafe-inline'` exception as an explicit remaining exception for current CSS/runtime style behavior.
- Added explicit application, asset and WebSocket origins for browser CSP use.
- Bumped the service-worker shell cache to force clients off the old cached shell.

## Repository result

Base before this step:

- `0c970b48242c98ce87c43b5c3764268ed704ba8a`

PR:

- `#92` — `web: harden CSP with per-response script nonces`
- Branch: `csp-nonce-hardening-20260925`
- PR head SHA: `cb77631578fe4a3a01123ced14a109ce50334083`

Merge result:

- Merged into `main` as `5906900860ece4e57388ceb4815df0c4ec232d5c`
- Production was not deployed.
- No server restart, migration or live configuration change was performed by this step.

## Automated verification

PR head `cb77631578fe4a3a01123ced14a109ce50334083` passed:

- `ci`
- `device-access`
- `beat-runtime`
- `api-shutdown`

The post-merge `main` push workflows for `5906900860ece4e57388ceb4815df0c4ec232d5c` started after merge. At the time of this note:

- `device-access` passed.
- `beat-runtime` passed.
- `api-shutdown` passed.
- Main `ci` was still running through the remaining infrastructure/image tail.

## Still required before release

This step does not close the release gate. The following remain required:

- Manual authorized acceptance under the new CSP: login, PIN, MLS init, WebSocket reconnect, direct/group messages and media upload/download.
- Physical iPhone acceptance.
- Full restore drill using an aligned database/object backup pair in an isolated environment.
- Production preflight: backup, rollback plan, environment/secrets check, Compose/Caddy check and smoke plan.
- Separate explicit approval for production deploy.

## Notes

The security improvement is specifically about replacing inline script allowance with a dynamic nonce model for application pages. It does not claim that style CSP is final, and it does not prove native-device behavior or production runtime behavior until the manual gates above are completed.


## Automated CSP regression

The follow-up browser regression `apps/web/tests/browser/csp-nonce.spec.ts` validates the runtime CSP contract directly:

- HTML responses contain a `script-src` nonce plus `strict-dynamic` and `wasm-unsafe-eval`.
- `script-src` does not contain `'unsafe-inline'`.
- Next.js document scripts carry the response nonce.
- A noncedless inline script injected into the HTML response before parsing is blocked by the real application CSP.
- Separate HTML responses receive different nonces.

This regression covers the browser-visible nonce contract. It does not replace physical Safari/iPhone acceptance or production-origin smoke testing.
