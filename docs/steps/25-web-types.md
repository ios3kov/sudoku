# Step 25 — WebCrypto and workspace type hardening

## Finding
Full API integration and domain tests are green. Web typecheck then exposed:
- WebCrypto/Push `BufferSource` incompatibilities caused by modern generic `Uint8Array<ArrayBufferLike>` typings.
- `@sudoku/domain` exported raw TypeScript source without a declaration artifact that the web workspace could resolve reliably.

## Fix
- Binary data passed to browser crypto/push APIs is normalized to owned `ArrayBuffer` values.
- Domain build emits declarations and package exports point to `dist/index.js` + `dist/index.d.ts`.
- CI explicitly builds domain declarations before web typecheck.

## Verification
Acceptance must pass API integration, domain tests, domain declaration build, web typecheck and Next production build.
