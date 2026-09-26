# Step 115 — PIN first-attempt reliability

Date: 2026-09-26  
Status: implementation candidate  
Issues: #111, reliability subset of #107  
Scope: four-digit device PIN unlock only

## Goal

Make one completed four-digit PIN entry produce exactly one verification request and either unlock immediately or reset cleanly for the next attempt. Remove the extra PIN Unlock button without starting the broader visual redesign from Wave 2.

## Previous risk

The PIN gate used a normal controlled form plus an explicit Unlock button. The client-side `busy` state was asynchronous, so separate submit events could enter before React committed the disabled state. The user also had to complete a second action after the fourth digit.

This made first-attempt behavior harder to reason about and did not meet the approved product contract.

## Implementation

### PIN mode

- accepts ASCII digits only;
- truncates at four digits;
- auto-submits immediately when digit four is entered;
- has no PIN Unlock button;
- uses a synchronous `requestInFlight` ref in addition to UI `busy` state, so two events cannot start two verification requests in the same render window;
- clears the four digits as soon as verification starts;
- wrong PIN leaves a concise error, keeps the existing server attempt policy, returns focus to the PIN field and is ready for immediate retry;
- successful response installs the RAM-only unlock capability through the existing epoch guard before session verification continues.

A server `409 Device PIN is not enabled` is not treated as PIN proof. It only asks the parent gate to re-check the authoritative session state, covering a concurrent PIN removal without inventing an unlock capability.

### Password recovery

Password recovery remains an explicit form submit. The PIN auto-submit change does not weaken password recovery, server rate limits, failed-attempt limits or unlock-token validation.

### Biometrics

This step does not remove the existing biometric path. Product removal remains separately tracked by #112 / Step 112 Wave 2 so reliability work stays reviewable and bounded.

## Browser regression

The existing role-parity PIN browser test now verifies:

- PIN field is focused after reveal/reload;
- no PIN Unlock button exists;
- one completed wrong PIN creates exactly one `/device-access/unlock` request;
- wrong PIN clears automatically;
- repeated wrong attempts remain usable until password recovery is required;
- a correct PIN auto-submits;
- the correct completed PIN creates exactly one unlock request;
- successful first-attempt unlock enters Messenger without a second click.

The account-password recovery branch still verifies the explicit password Unlock button.

## Security invariants

- PIN is never persisted;
- unlock capability remains RAM-only;
- epoch checks still reject stale results after a real lock/hide;
- server-side Argon2 verification, rate limits and five-attempt policy are unchanged;
- no offline unlock;
- no bypass if the session expired or was revoked.

## Remaining acceptance

- branch CI;
- merge + post-merge CI;
- physical iPhone: 20 consecutive relaunches with correct first-attempt unlock;
- wrong PIN -> automatic clear -> correct PIN without reload;
- Android/PWA parity check.

Production is unchanged.
