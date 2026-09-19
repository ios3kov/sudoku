# Step 65 — Encrypted attachment type-guard fix

## Finding
The encrypted attachment runtime validator accepted a `Record<string, unknown>` parameter but declared a type predicate for `EncryptedAttachmentMetadata`. TypeScript correctly rejected the predicate because the metadata interface has no string index signature.

## Fix
The validator now accepts `unknown`, first proves the value is a non-null object, then inspects a local `Record<string, unknown>` view field-by-field.

## Security
The runtime validation remains fail-closed. No metadata field is trusted before type/range/format checks.

## Verification
Required: web typecheck, Next production build, OpenMLS browser build and full CI.
