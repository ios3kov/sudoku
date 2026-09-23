# Step 86 — Final interactive-control audit

Date: 2026-09-23

## Goal

Close the remaining button/control QA debt on the current phone/contact mainline, not on the obsolete pre-phone UI.

PR #46 is superseded by PR #49. PR #49 ports the earlier control harness to the current types and phone/contact UX, adds the new controls, and keeps the audit as test-only coverage.

No production deployment was performed in this step.

## Coverage

### Sudoku

Verified in browser acceptance:

- selectable board cells;
- keypad digits 1–9, including normal gameplay use of digit 5;
- Erase;
- Notes on/off;
- Clear selection;
- Reset;
- hidden messenger reveal gesture below/above threshold;
- incomplete reveal return;
- keyboard focus order on the private login surface.

### Authentication and device access

Verified:

- phone Sign in;
- remembered phone checkbox;
- Use an invite / I already have an account navigation;
- Join submit/error path;
- Hide;
- first-login Set PIN;
- Not now;
- Save PIN;
- PIN Unlock error path;
- successful PIN unlock;
- Use account password fallback;
- Devices open/close;
- phone Change action in device settings;
- Change PIN;
- Remove PIN;
- remote-session Revoke;
- current-session Sign out;
- main messenger Sign out;
- Notifications permission failure -> Retry notifications.

### Invite and contact controls

Verified:

- admin Invite open/close;
- phone-bound Create invite;
- Copy code;
- Contacts open/close;
- system Contact Picker path;
- manual Add contact fallback;
- Remove contact;
- contact-only New Chat directory.

### Conversation list and creation

Verified:

- New secure chat;
- Direct / Group mode switch;
- contact selection;
- direct chat creation;
- group title + Create group;
- conversation selection/back navigation;
- draft restoration across conversation switches;
- Hide and account-change concealment behavior.

### Conversation tools

Verified:

- Find;
- search submit;
- search result selection;
- Done;
- conversation settings open behavior;
- Pin / Unpin;
- Mute / Unmute;
- Group settings;
- group rename Save;
- Make owner / Make member;
- add member;
- Remove member;
- Leave;
- Verify devices;
- Copy safety number;
- Mark verified;
- close controls.

### Message controls

Existing browser suites plus the final audit verify:

- Send;
- Reply;
- Edit;
- cancel edit/reply;
- Delete and delete confirmation;
- action-sheet Cancel/Escape/focus return;
- long-press and swipe-reply gestures;
- Show earlier messages / timeline jump behavior;
- message/media controls do not accidentally open action sheets.

### Attachments and voice

Verified:

- encrypted Attach file opens the file picker;
- encrypted image decrypt/download button;
- encrypted file decrypt/download button;
- encrypted voice Load;
- encrypted attachment Retry;
- PIN-protected legacy attachment Open;
- microphone start/stop;
- duplicate microphone activation prevention;
- microphone failure cleanup;
- recording failure cleanup;
- hide-during-recording cleanup;
- successful voice upload/send exactly once.

## Verification evidence

PR #49 exact reviewed head:

- `fca76a9b54c6c965fe68050d7d1c9cbb723a1479`
- CI `35858047355` — success
- device-access `35858047426` — success
- beat-runtime `35858047382` — success
- api-shutdown `35858047293` — success

The CI gate passed API integration, Python/Rust/npm audits, OpenMLS tests, web lint/typecheck/build, performance budget, pre-deployment lifecycle/storage regressions, Browser E2E, production operations validation, Compose validation and production image builds.

PR #49 was squash-merged as:

- `e47c4088a026f1100aed4d9d5526d82635bdb356`

Exact post-merge push-to-main verification also passed:

- CI `35859529252` — success
- device-access `35859529261` — success
- beat-runtime `35859529116` — success
- api-shutdown `35859529199` — success

PR #46 was closed without merge as superseded by #49.

## Result

The known interactive-control QA debt for the current web/PWA implementation is closed and the corresponding regression coverage is now on `main`.

This does not replace the separate release/operations acceptance items: physical iOS/Android installed-PWA testing, real two-device encrypted flows, host reboot persistence, controlled restore drill and production rollout remain separate release gates.
