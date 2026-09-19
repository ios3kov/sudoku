# Step 54 — Ciphertext-only E2EE attachments

## Server boundary
Encrypted attachments use a dedicated `/v1/assets/e2ee-upload-intents` endpoint.

The endpoint accepts only ciphertext size and ciphertext SHA-256. Original filename and MIME are never submitted.

Server/object-store metadata is forced to:
- filename: `encrypted.bin`;
- MIME: `application/octet-stream`;
- `e2ee_ciphertext=true`.

Completion verifies ciphertext length and digest but intentionally does not MIME-sniff random ciphertext.

## Conversation policy
E2EE conversations reject all ordinary assets and accept only ready `e2ee_ciphertext` assets.

Legacy conversations reject ciphertext assets and keep their existing MIME/signature checks.

## Integration test
The API test uploads arbitrary bytes that have no valid file signature, verifies the ciphertext asset, attaches it to an E2EE message, then proves a normal plaintext asset is rejected by the same encrypted conversation.

## Next
Add browser AES-256-GCM encrypt/decrypt utilities. Attachment key, nonce, original name/MIME and plaintext integrity metadata will travel only inside the MLS application payload.

## Browser encryption

`uploadEncryptedAsset()` generates a fresh 256-bit attachment key and 96-bit nonce per file, encrypts the complete file with AES-GCM, hashes both plaintext and ciphertext, and uploads only the ciphertext blob.

The returned MLS-only metadata contains:
- asset id;
- AES key + nonce;
- original filename + MIME;
- plaintext size + SHA-256;
- ciphertext SHA-256.

`downloadEncryptedAsset()` re-checks ciphertext SHA-256, authenticates/decrypts AES-GCM, then re-checks plaintext size/SHA-256 before reconstructing the local File object.

The OpenMLS application payload schema now carries this metadata under `attachments`; the server message row receives only the opaque MLS envelope plus routing asset ids.

## Status

The cryptographic/upload primitives are implemented, but the existing composer/history UI is not switched to them yet. Production remains blocked until UI wiring and browser retry tests pass.
