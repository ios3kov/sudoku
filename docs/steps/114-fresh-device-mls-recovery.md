# Step 114 — Fresh-device MLS recovery

Date: 2026-09-26  
Status: implementation candidate  
Issue: #108  
Scope: Messenger OpenMLS lifecycle and new-device recovery

## Problem

A device can legitimately have an authenticated server session while its browser/WKWebView has no usable local OpenMLS state. Existing encrypted conversations then appeared as a generic global failure:

`Secure messaging needs a restart. [Reload]`

Reload is not a valid universal recovery. A genuinely new session/device must be added to existing MLS groups through the durable device-add choreography. A same-session device that lost its local private MLS identity cannot recreate the old key and must establish a new authenticated session/device identity.

## Root causes

1. Messenger initialization treated any transport failure for any existing encrypted conversation as a fatal adapter failure.
2. Existing encrypted conversations with no local tracked group were not represented as a normal new-device pending state.
3. Pending new devices relied mainly on realtime wakeups instead of also polling their durable assigned transport for Welcome.
4. The shell permanently retired its OpenMLS adapter on ordinary `visibilitychange:hidden`, even when the document was only backgrounded or entering the app switcher.
5. API client errors discarded FastAPI's safe `detail` field, so the UI could not distinguish a lost local identity from a transient initialization failure.

## Implementation

### New-device pending state

After adapter initialization, every ready encrypted conversation is synchronized independently.

- tracked conversation -> normal transport recovery + pending device reconciliation;
- untracked conversation -> remains a valid pending secure-device setup;
- if a device-add transition targets the current device, transport errors do not collapse the entire adapter into the generic global error;
- the UI stays usable and shows `Preparing secure messaging on this device`;
- new conversations remain available while old encrypted conversations wait for their Welcome.

The client polls pending encrypted conversations every four seconds in addition to realtime/reconnect wakeups. Once Welcome arrives, the adapter joins the group, refreshes the tracked-conversation set and the pending banner clears automatically.

### Same-session local-state loss

The API helper now preserves safe FastAPI error details.

Known non-reloadable local-state failures are presented as:

`This device lost its secure local state. Sign in again to register it as a new secure device.`

This includes:

- server identity conflict for the same session/device id;
- revoked current MLS device;
- missing/invalid protocol wrapping key;
- invalid serialized local MLS state.

The action is `Sign in again`, not Reload. Logout/relogin creates a new authenticated session/device id; no plaintext fallback or invented key recovery is attempted.

Other initialization failures use an in-place `Retry` action that rebuilds the adapter lifecycle without reloading the whole application.

### Background and BFCache lifecycle

Ordinary backgrounding no longer retires the MLS adapter.

- `visibility:hidden`: keep the adapter alive while the document is frozen;
- `pagehide persisted=true`: keep the adapter alive for BFCache restore;
- real page departure / unmount: retire synchronously to block stale writers.

This preserves the existing single-writer safety without poisoning a live background/foreground session.

## Browser regression coverage

The E2EE recovery suite now covers:

1. BFCache pagehide/pageshow before secure-conversation creation; the same adapter must remain usable.
2. A new authenticated session/device joining an existing encrypted direct conversation:
   - new KeyPackages schedule device-add;
   - existing authorized device reconciles the durable change;
   - new device polls transport, consumes Welcome and becomes tracked;
   - post-rekey encrypted traffic is readable by the new device;
   - no generic restart banner.
3. Deleting the local crypto database while retaining the same authenticated session:
   - reload/reveal does not show `Reload`;
   - UI explains local secure-state loss;
   - `Sign in again` is offered.

## Security boundaries

- no plaintext fallback;
- no historical-key reconstruction is invented;
- a new device gains only the MLS state delivered through the existing authenticated device-add transition;
- corrupt/missing private state is never replaced under the same server device identity;
- device-add remains authorized and finalized by the existing server choreography.

## Remaining acceptance

- branch CI;
- merge + post-merge CI;
- physical iPhone reinstall/login with an existing encrypted conversation;
- two-device physical verification that the old authorized device can complete the rekey;
- confirm expected historical-message limitations on a truly fresh device.

Production is unchanged.

## Same-user sibling-device delivery fix

The fresh-device Browser E2E exposed an additional protocol provenance bug after device-add itself succeeded.

Message transport events previously exposed only `sender_user_id`. The browser adapter therefore treated every message from the same account as a local echo, even when it was authored by another device of that same user. On a newly added device, a post-rekey message from the user's established device could therefore fail with the local-journal guard instead of decrypting normally.

The fix adds migration `0019_transport_sender_device` and records the authenticated session/device id on new message transport events. The transport API now exposes `sender_device_id`.

Browser behavior is now:

- same user + same device -> must already exist in the local durable journal; a missing entry remains fail-closed;
- same user + different device -> normal incoming MLS application message and decrypt normally;
- historical transport rows without device provenance remain conservative/fail-closed for same-user events.

API regression verifies message transport exposes the sender device. The fresh-device Browser E2E verifies that a sibling device of the same account can send after rekey and the newly added device can decrypt the message.

The E2E fixture also uses dedicated users `6/7` so it cannot create MLS membership changes that contaminate later PIN/Contacts browser scenarios.
