# Architecture

## Goal

Build a private invite-only messenger presented as **Sudoku**.

The product now has two client surfaces:

- **Web/PWA** — the current Next.js client remains supported;
- **Native iOS** — a thin native host adds capabilities Safari/PWA cannot provide reliably, while reusing the same Sudoku/Messenger UI, backend and MLS protocol.

Normal launch is always a genuine Sudoku game. A deliberate hidden gesture reveals the private messenger, but concealment is never treated as an authorization boundary.

## System architecture

```mermaid
flowchart TB
    WEB[Next.js Web / PWA\nSudoku + Messenger]
    IOS[iOS Native Host\nSwift + WKWebView]
    WK[WKWebView\nSudoku + Messenger UI]
    BRIDGE[Native Capability Bridge\nContacts / Biometrics\nPrivacy / Photos / Files]

    API[FastAPI API]
    WS[WebSocket Gateway]
    AUTH[Auth / Sessions / Contact ACL]
    MSG[Messaging / MLS Transport]
    MEDIA[Encrypted Media Service]
    WORKER[Celery Workers]
    REDIS[(Redis)]
    PG[(PostgreSQL)]
    S3[(MinIO / S3-compatible Storage)]
    PUSH[Web Push / later APNs]

    WEB -->|HTTPS| API
    WEB <-->|WSS| WS

    IOS --> WK
    WK -->|narrow typed bridge| BRIDGE
    WK -->|HTTPS| API
    WK <-->|WSS| WS

    API --> AUTH
    API --> MSG
    API --> MEDIA
    AUTH --> PG
    MSG --> PG
    MSG --> REDIS
    WS --> REDIS
    MEDIA --> S3
    MSG --> WORKER
    WORKER --> PUSH
```

## Client boundaries

### Shared web application

The Next.js application owns:

- Sudoku game and hidden reveal interaction;
- phone/password login;
- device PIN;
- conversation UI;
- MLS state machine and ciphertext creation;
- encrypted attachment metadata/keys;
- contact sync API calls;
- message outbox/retry logic;
- browser/PWA fallbacks.

### Native iOS host

The native host is a **first-party Swift/UIKit capability layer**, not a second messaging implementation. It uses a persistent `WKWebView` for the existing production origin so Secure/HttpOnly cookies, relative API calls, IndexedDB MLS state and WebSocket behavior remain on the same origin.

Allowed native capabilities are intentionally narrow:

- explicit system contact selection;
- Face ID / Touch ID via LocalAuthentication;
- synchronous privacy cover when the app leaves the foreground;
- Photos picker;
- document picker;
- later, APNs registration.

The bridge must not expose:

- arbitrary filesystem access;
- arbitrary native method execution;
- unrestricted address-book dumps;
- plaintext message/attachment upload;
- arbitrary navigation outside approved application origins.

The initial native host intentionally has no third-party runtime SDK dependency. The Xcode project is generated reproducibly from `ios/Sudoku/project.yml` with XcodeGen, while runtime behavior stays in first-party Swift.

### Security ownership

- Server authorization remains authoritative for sessions, invites, contacts and membership.
- MLS remains authoritative for private message/group cryptography.
- Native biometrics do **not** create or extend a server session. When explicitly enabled, iOS releases the current four-digit device PIN from a `biometryCurrentSet` Keychain item only after Face ID / Touch ID succeeds; the web client then submits that PIN to the existing server `/v1/auth/device-access/unlock` endpoint and receives the normal RAM-only unlock capability.
- The biometric Keychain item is device-only, is cleared on explicit sign-out/PIN removal/biometric disable, and becomes unusable when the enrolled biometric set changes.
- Native Photos/Files pickers are selection-only. Selected bytes are converted into the same browser `File` abstraction and continue through the existing client-side E2EE attachment pipeline; native code has no plaintext object-store upload path.
- Sudoku concealment remains presentation privacy, not authentication.

## Identity and administration

Production is phone-first and invite-only.

- New accounts are phone-bound.
- Contact discovery exposes only registered, active, verified phone identities.
- Direct/group creation and direct sends are checked against the contact graph.
- There may be **at most one global administrator**.
- Only the singleton global administrator may create or revoke account invitations.
- Conversation-local `owner` roles do not grant global administration.

The singleton-admin invariant is enforced in the database as well as API authorization.

## Contacts architecture

The backend stores only matched relationships:

`owner_user_id -> contact_user_id`

It does not store the complete phone book or unmatched numbers.

Client behavior:

- iOS native: system picker returns only explicitly selected contacts;
- browsers with Contact Picker: same explicit-selection model;
- unsupported browsers/PWA: manual E.164 entry.

All three paths converge on the same `/v1/contacts/sync` API and therefore share the same authorization semantics.

## Native attachment architecture

The iOS host may source one explicitly selected local file through the system Photos or Files picker, but ownership of attachment security remains in the shared web client:

`system picker -> trusted native bridge -> browser File -> client-side encryption -> ciphertext upload`

The native host enforces the existing attachment size/MIME boundary before crossing the bridge. The shared encrypted conversation code performs the authoritative encryption, metadata construction and upload. Web/PWA retains its ordinary file-input fallback.

## Reliability defaults

- PostgreSQL is authoritative for users, sessions, memberships, messages, receipts, contact edges and audit history.
- Redis is ephemeral: presence, fan-out, rate limits and Celery coordination.
- Message creation uses `client_id` idempotency and a transactional outbox.
- Clients maintain a durable local outbox for reconnect/retry.
- Transient send failures may retry automatically; permanent failures must become explicit user-visible failed states.
- Assets are immutable ciphertext objects addressed by internal storage keys; signed URLs are generated on demand.

Target message state model for the native-quality pass:

`queued -> encrypting -> sending -> sent -> delivered/read`

with explicit `failed_transient` and `failed_permanent` states.

## Privacy lifecycle

- `SudokuShell` is always safe to display.
- `MessengerShell` requires both the hidden gesture and valid authenticated state.
- Web/PWA uses the existing synchronous privacy cover.
- Native iOS additionally owns an OS-level/app-window privacy cover so the app switcher never snapshots chat content.
- Returning after the configured background interval restores Sudoku before private content is shown.

## Deployment principle

The backend stays containerized and provider-portable:

- FastAPI;
- PostgreSQL;
- Redis;
- Celery;
- MinIO/S3-compatible storage;
- Caddy.

The iOS app is a separate release artifact. Server and iOS releases are versioned and verified independently but must declare compatibility with the same API/MLS contract.

## Observability

- FastAPI, SQLAlchemy, Redis and Celery emit OpenTelemetry telemetry.
- OTLP/HTTP export is enabled only when configured.
- Application logs are structured and correlate to active trace/span IDs.
- Chat/message bodies, credentials, session material and decrypted attachment data are not logged.
- Native iOS diagnostics must follow the same rule: no phone-book dump, message plaintext, MLS secrets or attachment plaintext in logs/crash metadata.
