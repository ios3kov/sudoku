# Step 17 — Direct source import

## Goal
Retire damaged/self-extracting bootstrap mechanisms and publish application source as ordinary Git objects.

## Rule
No `bootstrap/*`, `bootstrap-v2/*`, multipart archives, or self-modifying import workflows are allowed in `main`. Source changes are represented directly as Git blobs/trees/commits.

## Changes
- Original damaged multipart bootstrap removed.
- A later `bootstrap-v2` staging commit was detected before Step 21 publication and removed without force-pushing.
- CI operates only on ordinary source files.

## Verification
Before each feature tree mutation, read current `main` HEAD/tree and use that exact tree as the base. Git ref updates must remain fast-forward only.
