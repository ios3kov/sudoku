# Step 28 — Code/security review: realtime session + presence

## Findings
1. WebSocket authentication was checked only during connection setup. Revoking a device session prevented new HTTP requests but an already-open socket could continue receiving realtime events until disconnected.
2. Presence used one `presence:user:{id}` key. Closing any one tab/device deleted that key and could mark the user offline while another connection was still alive.

## Fix
- WebSocket retains the authenticated session ID and revalidates it against PostgreSQL on heartbeat and typing actions.
- Revoked/expired/inactive sessions are closed with 4401.
- Presence is now connection-scoped: `presence:user:{user_id}:{connection_id}`, so one disconnect cannot erase another connection's presence.
- Each connection refreshes/deletes only its own TTL key.

## Follow-up
Push presence checks must treat any live connection-scoped key as online; review/update that consumer before Step 28 is considered complete.
