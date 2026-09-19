# Step 12 — Group and Device Management

## Goal

Close two MVP gaps that make a private messenger operationally incomplete: lifecycle management for group membership and revocable user-visible device sessions.

## Implemented

### Groups

- Group rename endpoint and mobile UI.
- Owner-only member additions.
- Owner promotion/demotion.
- Owner removal of ordinary members.
- Any member may leave a group.
- The final owner cannot be demoted/removed/leave; ownership must be transferred first.
- Groups are capped at 100 members.
- Group mutations are serialized with the conversation row lock.
- All group mutations are rate-limited and written to the audit log.
- Realtime events added for rename, member add, role update and member removal.
- Removed members are included as explicit outbox recipients for the removal event, so they receive a durable notification even though their membership row has already been deleted.
- Reserved outbox routing metadata is stripped before the event reaches clients.

### Device sessions

- Mobile Devices panel lists active sessions.
- Other sessions can be revoked remotely.
- Revoking the current session clears the session cookie immediately and returns to Sudoku.
- Session listing/revocation are rate-limited.

## Permission model

- Direct-chat membership is immutable through these endpoints.
- Group metadata/member administration requires `conversation_members.role = owner`.
- Global app administrators do not implicitly bypass conversation membership rules.
- Server-side authorization remains authoritative; UI visibility is not relied on for permissions.

## Verification

- Python source and integration-test source compile successfully.
- TS/TSX parser passes for 27 source files.
- Dependency-free domain tests pass 7/7.
- Integration harness now covers group owner permissions, ownership transfer prerequisite and current-session revocation, but cannot be executed in this environment until PostgreSQL/Redis/S3 and all Python dependencies are available.

## Review fixes during this step

- Blank/whitespace-only group titles are rejected after trimming.
- Group/device panels are overlays rather than extra CSS grid rows, avoiding broken mobile layout.
- Current-session revocation also clears the offline pending-message queue client-side.

## Next step

Add message search + conversation mute/pin controls and finish privacy/session polish, then run the complete real-service integration and production web build in a network-enabled runner.
