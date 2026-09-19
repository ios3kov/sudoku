# Step 17 — Direct source import

## Goal

Retire the damaged multipart bootstrap mechanism and publish application source as ordinary Git objects.

## Changes

- Disabled and removed the self-extracting bootstrap workflow.
- Removed `bootstrap/*` payloads from the target tree.
- Source files are committed directly, so Git object integrity is the only transport layer.
- CI is triggered only after normal source files exist in `main`.

## Verification

Repository tree is inspected after the commit to ensure no bootstrap payload remains.
