# Step 44 — WebCrypto BufferSource compatibility

## Finding
The first full E2EE web typecheck failed because `value.buffer.slice(...)` is typed as `ArrayBuffer | SharedArrayBuffer`, while WebCrypto `subtle.encrypt()` requires a compatible `BufferSource`.

## Fix
Copy protocol-state bytes into a fresh owned `Uint8Array` before passing them to WebCrypto. This guarantees ordinary owned memory and avoids SharedArrayBuffer typing/aliasing ambiguity.

## Verification
Re-run:
- API integration;
- domain tests;
- web typecheck;
- web production build;
- production compose validation.
