# Step 85 — Phone identity and phone-book contact graph

Date: 2026-09-23

## Goal

Move Messenger identity and discovery from email to phone numbers without weakening the existing password, device-session, PIN or E2EE model.

The user-facing model is:

1. sign in with an international phone number and account password;
2. optionally use the existing four-digit device PIN for later unlocks;
3. explicitly choose phone-book entries through the system Contact Picker when supported, or add a number manually as a web/PWA fallback;
4. see and start new conversations only with registered, verified phone identities that were synced into the user's contact graph.

Production deployment is outside this step.

## Identity migration

- `users.phone_e164` is unique and stores normalized international E.164 identity.
- `users.phone_verified_at` separates login usability from phone-book discovery trust.
- new invite-created accounts are phone-bound and verified;
- existing legacy accounts may temporarily authenticate by email only while they have no phone identity;
- after a legacy account sets a phone, email login is disabled for that account;
- a legacy account can immediately log in by the new phone, but other users cannot discover it until the phone is verified out-of-band;
- `python -m app.cli verify-phone --phone ...` records an audited admin verification after out-of-band confirmation;
- changing a phone invalidates inbound saved-contact edges so other users must resync the new number.

Email remains nullable migration/recovery metadata; it is no longer the Messenger discovery identity.

## Contact privacy

The server does not persist the user's complete address book. `POST /v1/contacts/sync` receives explicitly selected/imported phone numbers and persists only matched registered users as `owner_user_id -> contact_user_id` edges.

Unregistered phone numbers are not retained in `user_contacts`. Directory responses do not expose email addresses.

Phone contact matching returns only accounts with a verified phone identity.

Login rate-limit keys hash the account identifier before writing it to Redis.

## Server authorization

The contact graph is enforced on the API, not only hidden in the UI.

After an account has a phone identity:

- `GET /v1/users` returns only synced registered contacts;
- direct/group conversation creation requires all targets to be contacts;
- normal group additions require contacts;
- MLS/E2EE group additions require contacts;
- direct-message sending rechecks the current contact edge;
- removing/replacing a contact therefore blocks future direct sends even if an old direct conversation still exists.

Legacy accounts with no phone retain a temporary backend compatibility path only to support migration. The UI does not allow them to start new chats until they set a phone.

## Web/PWA contact access

Contact Picker is progressive enhancement:

- capability is detected after hydration;
- telephone-property support is checked before offering the picker;
- `contacts.select(["tel"], { multiple: true })` is invoked directly from the user click so transient user activation is preserved;
- only explicitly selected phone numbers are sent to contact sync;
- unsupported browsers receive a manual E.164 phone-entry fallback;
- a Contacts panel lists matched contacts and lets the user remove an allowlist edge.

This intentionally does not claim persistent browser access to the entire native address book.

## Verification

Exact feature head `fdd5658473438a8a6617672cbb01389c6015c775` passed:

- CI run `35844463475`: API integration, Ruff, Python tests, Rust/OpenMLS tests, dependency audits, web lint/typecheck/build, performance budget, browser E2E, production scripts, Compose validation and production image builds;
- device-access run `35844463463`;
- beat-runtime run `35844463482`;
- api-shutdown run `35844463467`.

Browser acceptance includes:

- phone login with the existing PIN flow;
- E2EE direct chat from the contact-first directory;
- system Contact Picker sync;
- manual phone fallback;
- Contacts panel add/remove;
- existing reload/PIN/E2EE recovery.

API tests cover contact-only discovery, blocked direct/group creation outside contacts, blocked direct sends after contact removal, legacy email-to-phone migration, phone-bound invites and invalidation of inbound contact edges after phone change.

## Release boundary

Do not deploy this feature directly from the draft branch.

Before production rollout:

1. take a fresh encrypted production backup;
2. run production preflight;
3. apply migration `0016_phone_contacts`;
4. migrate/verify the required existing accounts' phone identities out-of-band;
5. verify phone login, PIN unlock, contact sync, contact-only New Chat, E2EE messaging and removal blocking on the release candidate;
6. only then switch normal user entry to the phone-first release.

No production database, account, service or infrastructure mutation was performed by this step.
