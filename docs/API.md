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
POST   /invites/{token}/accept
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
