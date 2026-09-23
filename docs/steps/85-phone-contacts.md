# Step 85 — Phone identity and phone-book contacts

Date: 2026-09-23.

## Goal

Move messenger identity from email-first login to phone-first login and restrict discovery/new messaging to users selected from the account owner's phone contacts.

Production deployment is explicitly out of scope for this step.

## Identity model

- New messenger login UI uses an international E.164 phone number plus the existing account password.
- PIN remains an optional device-local quick unlock after password login.
- New invite-based accounts are phone-bound and receive a verified phone identity.
- Existing legacy accounts may still use email only while `phone_e164` is unset.
- After a legacy account sets a phone number, email login is disabled for that account.
- A self-migrated phone can log in immediately, but contact discovery remains disabled for that identity until an administrator performs out-of-band verification.
- `python -m app.cli verify-phone --phone '<e164>'` marks an existing migrated number verified and creates an audit event.
- Changing a phone number clears verification and deletes incoming contact edges so other users must resync the new number.

## Contact privacy and authorization

The server stores only matched registered-user edges:

`owner_user_id -> contact_user_id`

It does not persist the user's full address book or unmatched phone numbers.

Contact matching only returns active accounts with verified phone identities. New direct chats, new groups, legacy group additions, MLS group additions, and direct-message sends are checked against the server-side contact graph after an account has a phone identity.

Removing a contact prevents new direct-message sends to that user until the contact is synced again. Existing conversation history is not deleted.

Login rate-limit keys hash the account identifier before writing Redis keys.

## Web/PWA contact access

The web client uses progressive enhancement:

- when `navigator.contacts` exposes telephone selection, the user can explicitly choose phone contacts;
- Contact Picker is invoked directly from the user click to preserve transient user activation;
- when the API is unavailable, the UI provides manual E.164 contact entry;
- a Contacts panel lists matched registered contacts and allows removal.

The client never assumes persistent or background access to the device address book.

## Database

Migration: `0016_phone_contacts`.

It:

- adds nullable `users.phone_e164`;
- adds nullable `users.phone_verified_at`;
- makes legacy `users.email` nullable;
- adds optional invite phone binding;
- renames login-attempt `email_hash` to `identifier_hash`;
- creates `user_contacts`.

The migration is forward-compatible with legacy accounts. Do not downgrade production automatically.

## Verification

Reviewed code head:

`fdd5658473438a8a6617672cbb01389c6015c775`

Exact-head workflows:

- CI `35844463475` — success
- device-access `35844463463` — success
- beat-runtime `35844463482` — success
- api-shutdown `35844463467` — success

The CI gate passed API integration, migration, lint, typecheck, production build, performance, Browser E2E, production Compose validation and production image builds.

Browser coverage includes phone login, PIN/reload regression, Contact Picker flow, manual phone fallback, Contacts removal and the existing E2EE recovery scenario.

## Release boundary

Before production:

1. create a fresh consistent backup;
2. verify rollback/forward-fix procedure for `0016_phone_contacts`;
3. deploy migration and phone-aware API/web as one release;
4. migrate existing accounts by assigning phone identities;
5. perform out-of-band phone verification for legacy accounts before expecting them to appear in other users' contact discovery;
6. run live smoke plus member/admin phone login, PIN unlock, Contact Picker/manual fallback, contact removal and E2EE send tests.

No production command, migration, restart or secret change was executed in this step.
