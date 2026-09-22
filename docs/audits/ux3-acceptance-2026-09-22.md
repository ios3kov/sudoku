# UX3 acceptance follow-up — CI #284

Date: 2026-09-22
PR: #33 (`feat/messenger-ux3-final`)
Baseline head: `8b47f48353cf71fe61fb08d90e566f8e67c2b0d4`
Baseline tree: `8711a6aa1e16de3c41a01476b13ef424fd63b17e`

## Goal and scope

Close the existing UX3 release gate without adding product scope or changing
production behavior. A browser assertion for a successfully sent message must
identify a projected history body, not a draft, optimistic send or quoted text.
Keep duplicate detection, all crypto/reload/offline/recovery acceptance, current
timeouts and zero retries. No deployment or physical Step 70 verification here.

## Evidence / root cause

CI #284 (run `35660175729`, job `106533288434`) failed at
`e2ee-recovery.spec.ts:167`. Artifact `10666782686` preserves the trace: the
unscoped exact-text locator matched both the optimistic Sending paragraph and
the textarea holding the same text. This is a strict-mode selector error before
server-accepted history is asserted, not evidence of failed message encryption.

The trace, test and production markup agree: optimistic rows have `.pending`
and are outside the projected `[data-message-id]` wrappers. Final bodies are
paragraphs directly under message bubbles inside labelled Message history.
Playwright recommends narrowing locators rather than opting out of strictness:
https://playwright.dev/docs/locators#strictness

## Correction

The test-only `acceptedMessage` helper selects projected non-pending body
paragraphs inside Message history, intersected with the exact text locator.
It excludes composer text, pending sends, quotes and action previews, and does
not select `.first()` or hide duplicate accepted messages. All message-body
visibility checks in the MLS scenario and incoming-composition helper now use
this contract. No production source or workflow changes enter this PR update.

## Verification executed

- Red: helper using the original unscoped locator failed both pending/draft and
  quote/action-preview controls; duplicate detection control passed (2 fail/1 pass).
- Green: all 3 selector-contract browser regressions passed.
- Existing real-component browser scenarios: 8/8 passed; 11/11 with new controls.
- Domain: 24/24; refresh/receipt regressions: 10/10; UI contract: 7/7, 149 classes.
- Web TypeScript passed; ESLint: 0 errors, 17 existing warnings.
- Next production build and budget passed: 214,872 bytes total JS gzip,
  71,470-byte largest chunk, unchanged 2,709,987-byte WASM.

The local browser uses managed Chromium with setContent and actual component
fixtures; no browser policy was changed. The Node/WASM toolchain was restored
from repository artifacts. A combined check command reached its execution limit
during build; the separate build then completed successfully. Generated Next
config/type/build-info files are excluded. These checks do not replace the
full API/PostgreSQL/Redis/OpenMLS browser CI or physical-device acceptance.

## Review and completion rule

Reviewed against actual rendered markup, pending-to-projected overlap, quote
collisions, duplicates, and shared helper use. The patch is test/documentation
only and leaves the 1.0 feature boundary unchanged. Full CI must pass for this
exact fix before merge; record final PR and post-merge SHA/run evidence in PR #33.
Any further failing assertion reopens diagnosis, not a timeout increase or a
retry-only pass. Production and deferred Step 70 remain unchanged.
