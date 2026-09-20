# API Surface

Base path: `/v1`.

All private endpoints use the Secure/HttpOnly server session cookie. Browser mutations are same-origin protected; WebSocket connections additionally require the exact configured `PUBLIC_ORIGIN`.

## Auth and invites

```http
POST   /auth/login
POST   /auth/logout
POST   /auth/refresh
GET    /me
GET    /sessions
DELETE /sessions/{session_id}

POST   /invites                  # admin only
DELETE /invites/{invite_id}      # admin only
POST   /invites/accept            # token is JSON body field; never place invite secrets in URLs
```

Create invite:

```json
{
  "email": "person@example.com",
  "expires_hours": 168,
  "max_uses": 1
}
```

The response contains the raw invite `token` exactly once. Only its digest is persisted.

Login:

```json
{
  "email": "person@example.com",
  "password": "...",
  "device_name": "iPhone"
}
```

## User directory

```http
GET /users?q=alex
```

Only authenticated active users are returned; result count is capped and the endpoint is rate-limited.

## Conversations

```http
GET    /conversations
POST   /conversations
PATCH  /conversations/{conversation_id}                       # group owner
POST   /conversations/{conversation_id}/members               # group owner
PATCH  /conversations/{conversation_id}/members/{user_id}     # group owner role change
DELETE /conversations/{conversation_id}/members/{user_id}     # owner remove / self leave
PATCH  /conversations/{conversation_id}/preferences
GET    /conversations/{conversation_id}/search?q=...&limit=30
```

Create direct:

```json
{
  "type": "direct",
  "title": null,
  "member_ids": ["<other-user-uuid>"]
}
```

Create group:

```json
{
  "type": "group",
  "title": "Family",
  "member_ids": ["<user-uuid>", "<user-uuid>"]
}
```

Groups are capped at 100 members. Roles are `owner` and `member`; the final owner cannot be demoted or removed. Direct-chat membership is not mutable through group endpoints.

Conversation preferences are per-member. `is_pinned` changes only that user's ordering; `notifications_muted` suppresses server Web Push for that user/conversation while leaving durable messages and realtime delivery intact. Message search is membership-gated, rate-limited, text-only in the MVP, and excludes deleted messages.

## Messages

```http
GET    /conversations/{conversation_id}/messages?before=...&after=...&limit=50
POST   /conversations/{conversation_id}/messages
PATCH  /messages/{message_id}
DELETE /messages/{message_id}
POST   /messages/{message_id}/reactions
POST   /conversations/{conversation_id}/read
```

Create message:

```json
{
  "client_id": "0195e7d6-3c46-7c9d-9d33-3a8c8e59b9c2",
  "type": "text",
  "body": "Hello",
  "reply_to": null,
  "asset_ids": []
}
```

Supported MVP types: `text`, `image`, `file`, `voice`.

`(sender_id, client_id)` is unique for idempotent retry. Each conversation assigns a monotonically increasing `sequence` under a DB row lock.

## Assets

```http
POST /assets/upload-intents
POST /assets/{asset_id}/complete
GET  /assets/{asset_id}
GET  /assets/{asset_id}/content
```

`upload-intents` receives filename, MIME, size and SHA-256. The browser uploads directly to a short-lived signed PUT URL. `complete` re-reads the object server-side, verifies size/digest/signature and only then marks the asset attachable.

`/content` is a stable authorization-gated application URL that redirects to a short-lived signed object URL.

## Push

```http
GET    /push/public-key
POST   /push/subscriptions
DELETE /push/subscriptions/{subscription_id}
```

Push endpoints must match the configured trusted push-service hostname allowlist. Display payloads intentionally contain only generic Sudoku text.

## WebSocket

```text
/v1/ws
```

Server event envelope:

```json
{
  "event_id": "...",
  "type": "message.created",
  "conversation_id": "...",
  "payload": {}
}
```

Event classes currently emitted:

- `conversation.created`
- `conversation.updated`
- `conversation.members_added`
- `conversation.member_role_updated`
- `conversation.member_removed`
- `message.created`
- `message.updated`
- `message.deleted`
- `reaction.updated`
- `receipt.updated`
- `typing.started`
- `typing.stopped`

Client commands:

```json
{"type":"ping"}
{"type":"typing.started","conversation_id":"..."}
{"type":"typing.stopped","conversation_id":"..."}
```

Redis is fan-out only. After reconnect the client requests durable messages from PostgreSQL using `after=<last-sequence>`.


## MLS E2EE delivery service

```http
PUT    /e2ee/devices/{device_id}
DELETE /e2ee/devices/{device_id}
PUT    /e2ee/devices/{device_id}/key-packages
DELETE /e2ee/devices/{device_id}/key-packages
GET    /e2ee/users/{user_id}/devices
POST   /e2ee/users/{user_id}/devices/{device_id}/key-package/claim

POST   /e2ee/conversations/{conversation_id}/control-events
POST   /e2ee/conversations/{conversation_id}/control-batches
GET    /e2ee/conversations/{conversation_id}/devices/{device_id}/control-events?after=0
POST   /e2ee/control-events/{event_id}/ack
```

An MLS device is registered once with an immutable public identity key. Changing that key requires a new device id. Private identity keys never reach the API.

KeyPackages are opaque public MLS bytes. Claimed packages remain as consumed tombstones so they cannot be registered and used again.

MLS control events carry opaque serialized `commit` or `welcome` bytes. Recipient device pairs are snapshotted at event creation. Fetching an assigned control event therefore does not depend on the recipient still being a current server-side conversation member; this is required for delivery of removal commits.

Realtime fan-out contains only control-event id/kind/sequence metadata. The MLS bytes remain durable in PostgreSQL and are fetched through the authenticated device-specific endpoint.


### Atomic MLS control batch

Membership changes that need both Commit and Welcome use `control-batches`. The request contains one sender device and 1–10 control events, each with its own stable client id and recipient-device snapshot.

The whole batch is one database transaction. A retry with the same client ids/content returns the existing events; a partial or changed retry returns 409. This lets the browser persist a prepared MLS PendingCommit, retry network delivery safely after a crash, and merge the local pending epoch only after the durable batch is accepted.

## E2EE attachments

```http
POST /assets/e2ee-upload-intents
POST /assets/{asset_id}/complete
GET  /assets/{asset_id}/content
```

The E2EE upload-intent endpoint accepts only ciphertext byte length and ciphertext SHA-256. It never accepts the original filename or MIME type.

Server/object-store metadata is forced to `encrypted.bin` and `application/octet-stream`. The original filename, MIME type, attachment key, nonce and plaintext integrity metadata are carried only inside the MLS application payload.

Encrypted conversations reject ordinary assets; legacy conversations reject `e2ee_ciphertext` assets.
