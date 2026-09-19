# Data Model

## `users`

- `id uuid pk`
- `email varchar(320) unique`
- `display_name varchar(120)`
- `password_hash varchar(512)`
- `status varchar(32)`
- `is_admin boolean`
- `created_at timestamptz`
- `last_seen_at timestamptz null`

## `sessions`

- `id uuid pk`
- `user_id uuid fk users`
- `token_hash bytea(32) unique`
- `device_name varchar(160)`
- `created_at timestamptz`
- `expires_at timestamptz`
- `revoked_at timestamptz null`

## `invites`

- `id uuid pk`
- `token_hash bytea(32) unique`
- `email varchar(320) null`
- `created_by uuid fk users null`
- `expires_at timestamptz`
- `max_uses int`
- `uses int`
- `revoked_at timestamptz null`
- `created_at timestamptz`

## `conversations`

- `id uuid pk`
- `type varchar(16)` (`direct`, `group`)
- `title varchar(160) null`
- `direct_key varchar(80) unique null`
- `created_by uuid fk users`
- `next_sequence bigint`
- `next_crypto_sequence bigint`
- `encryption_required boolean`
- `created_at timestamptz`

`direct_key` is a canonical pair key and direct-chat creation is additionally serialized with a PostgreSQL advisory transaction lock.

## `conversation_members`

- `conversation_id uuid fk conversations`
- `user_id uuid fk users`
- `role varchar(24)`
- `joined_at timestamptz`
- `last_read_sequence bigint`
- `is_pinned boolean`
- `notifications_muted boolean`
- primary key `(conversation_id, user_id)`

Read state uses a monotonic per-conversation member watermark; there is no per-message receipt table in the MVP.

## `messages`

- `id uuid pk`
- `conversation_id uuid fk conversations`
- `sender_id uuid fk users`
- `client_id uuid`
- `sequence bigint`
- `type varchar(24)`
- `body_text text null`
- `body_ciphertext bytea null` (reserved for proven E2EE protocol integration)
- `encryption_version int`
- `reply_to uuid fk messages null`
- `created_at timestamptz`
- `edited_at timestamptz null`
- `deleted_at timestamptz null`
- unique `(sender_id, client_id)`
- unique `(conversation_id, sequence)`

## `message_reactions`

- `message_id uuid fk messages`
- `user_id uuid fk users`
- `emoji varchar(32)`
- `created_at timestamptz`
- primary key `(message_id, user_id, emoji)`

## `assets`

- `id uuid pk`
- `owner_id uuid fk users`
- `storage_key varchar(1024) unique`
- `filename varchar(255)`
- `mime_type varchar(160)`
- `size_bytes bigint`
- `sha256 bytea(32)`
- `e2ee_ciphertext boolean`
- `status varchar(24)` (`pending`, `ready`, `rejected`)
- `created_at timestamptz`
- `ready_at timestamptz null`

## `message_assets`

- `message_id uuid fk messages`
- `asset_id uuid fk assets`
- `position int`
- primary key `(message_id, asset_id)`

## `push_subscriptions`

- `id uuid pk`
- `user_id uuid fk users`
- `endpoint text unique`
- `p256dh text`
- `auth text`
- `device_name varchar(160)`
- `created_at timestamptz`
- `revoked_at timestamptz null`

## `outbox_events`

- `id uuid pk`
- `event_type varchar(80)`
- `aggregate_type varchar(40)`
- `aggregate_id uuid`
- `conversation_id uuid fk conversations null`
- `payload jsonb`
- `created_at timestamptz`
- `published_at timestamptz null`

## `audit_events`

- `id uuid pk`
- `actor_user_id uuid fk users null`
- `event_type varchar(80)`
- `target_type varchar(80)`
- `target_id uuid null`
- `created_at timestamptz`

Message bodies are deliberately not stored in audit records.

## `login_attempts`

Stores a SHA-256 email audit hash, success flag and timestamp; it does not store the submitted password.


## `mls_devices`

- `id uuid pk`
- `user_id uuid fk users`
- `device_id uuid`
- `identity_public_key bytea(32) unique`
- `created_at timestamptz`
- `revoked_at timestamptz null`
- unique `(user_id, device_id)`

This is the durable MLS device identity registry. Private signing keys are client-only.

## `mls_key_packages`

- `id uuid pk`
- `user_id uuid fk users`
- `device_id uuid`
- `package_ref bytea(32) unique`
- `key_package bytea`
- `created_at timestamptz`
- `claimed_at timestamptz null`

## `mls_control_events`

- `id uuid pk`
- `conversation_id uuid fk conversations`
- `sender_user_id uuid fk users`
- `sender_device_id uuid`
- `client_id uuid`
- `sequence bigint`
- `kind varchar(16)` (`commit`, `welcome`)
- `payload bytea`
- `created_at timestamptz`
- unique `(sender_user_id, sender_device_id, client_id)`
- unique `(conversation_id, sequence)`

The payload is opaque MLS wire data. The server stores and routes it but does not parse private MLS state.

## `mls_control_recipients`

- `event_id uuid fk mls_control_events`
- `user_id uuid fk users`
- `device_id uuid`
- `acked_at timestamptz null`
- primary key `(event_id, user_id, device_id)`

Recipient rows are a creation-time delivery snapshot, so an already-issued removal commit is still retrievable after the corresponding server membership row is removed.

For `e2ee_ciphertext=true`, `filename` and `mime_type` are intentionally generic server metadata. Original attachment metadata and decryption material are never stored in the asset row.
