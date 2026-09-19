# Step 34 — E2EE production gate and protocol specification

## Goal
Make infrastructure trust unnecessary for message and attachment confidentiality.

## Research result
- Signal's official libsignal implements Signal Protocol/Double Ratchet and exposes TypeScript APIs, but Signal documents external use as unsupported and the TypeScript distribution is not a drop-in browser/WebCrypto library.
- MLS (RFC 9420) is the IETF standard for asynchronous group key establishment with forward secrecy and post-compromise security.

## Decision
Do not rush a home-grown browser ratchet. First freeze the E2EE data/API boundary, then validate a browser-compatible audited protocol implementation and its license/build model.

## Implemented in this step
- E2EE threat model and acceptance criteria.
- Direct/group protocol direction.
- Ciphertext-only server and attachment requirements.
- Production deployment marked blocked until E2EE gates pass.
- Existing server-side plaintext search explicitly marked incompatible with E2EE.

## Next
Step 35: change database/API schema to encryption-required envelopes + public device/prekey material, while keeping production disabled. Then implement client protocol adapter behind tests.
