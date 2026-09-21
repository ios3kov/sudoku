# Minimal Messenger redesign audit — 2026-09-21

## Scope

Rebuild the private messenger UI from the supplied `minimal-messenger` reference while preserving the existing production messenger, MLS/E2EE and operational behavior.

The supplied reference was used as the visual/interaction basis, especially:
- `src/App.tsx`;
- `src/components/Sidebar/ChatSidebar.tsx`;
- `src/components/Sidebar/ChatListItem.tsx`;
- `src/components/Chat/ChatArea.tsx`;
- `src/components/Chat/ChatHeader.tsx`;
- `src/components/Chat/MessageBubble.tsx`;
- `src/components/Chat/MessageInput.tsx`;
- `src/components/Profile/ProfileDrawer.tsx`;
- `src/components/Media/MediaLightbox.tsx`.

The reference mock store/data are **not** authoritative for production functionality. Existing server/auth/session/realtime/MLS/attachment behavior remains the source of truth.

## Why the Sudoku reveal was not smooth enough

The previous optimization kept `AuthGate` permanently mounted below Sudoku. For an already authenticated user that also mounted the full `MessengerShell` before the user unlocked it.

That means the hidden layer could initialize, while the Sudoku screen was being dragged:
- device-session discovery;
- OpenMLS WASM/provider initialization;
- durable transport synchronization;
- KeyPackage maintenance;
- realtime WebSocket startup;
- conversation recovery/reconciliation;
- the full messenger React tree.

On mobile Safari this work can contend with the compositor/main thread during the reveal. Backdrop filters and a large live scroll tree underneath the moving Sudoku surface add more paint/composition cost.

### Fix

The hidden layer now has two phases:
1. **Sudoku visible / dragging:** `MessengerRevealPreview` renders only a lightweight real-data conversation list. It may fetch `/v1/me` and `/v1/conversations`, but does not mount the MLS/realtime runtime.
2. **Unlock completed:** the real `MessengerShell` mounts after the Sudoku surface has finished moving out of the viewport.

This keeps the visible underlay representative of the real account while moving the cryptographic/runtime initialization off the critical drag path.

The preview also disables backdrop blur and uses CSS containment.

## What was ported from the supplied design

The production UI now adopts the reference's main visual system:
- mobile-first single-column messenger frame, max width 460 px;
- light Slate-style surfaces with one blue accent;
- compact top bars;
- rounded conversation rows;
- circular identity avatars/initials;
- minimal unread badges;
- lightweight conversation search;
- rounded message bubbles with asymmetric tails;
- blue outgoing bubbles;
- floating capsule-style composer;
- compact circular attachment/voice/send actions;
- slide-in settings/search drawers;
- desktop presentation as the same mobile frame centered in a quiet background rather than a separate desktop layout.

The reference uses `motion/react`, Tailwind and Lucide. Those dependencies were **not** added to the production app. The visual language and transitions were reproduced with the existing React stack and CSS so the redesign does not increase the dependency/security surface or add an animation runtime to the bundle.

## Existing functionality preserved

The redesign keeps the existing production behavior:
- invite-only authentication;
- revocable device sessions;
- masked Web Push;
- direct and group chats;
- E2EE-only new-conversation policy;
- OpenMLS/RFC 9420 state and transport recovery;
- message send/edit/delete/reply/reactions;
- read receipts;
- offline queue/retry;
- encrypted image/file/voice attachments;
- group membership/rekey flow;
- safety-number verification;
- conversation pin/mute preferences;
- message search;
- admin invites;
- privacy cover / return to Sudoku.

No API schema or cryptographic protocol is changed by this UI work.

## UX/UI audit

### Fixed
- private UI now follows the supplied visual hierarchy instead of generic utility styling;
- conversation list has a clear primary action and local search;
- list rows use consistent 68 px touch-friendly rhythm;
- message bubbles have stronger incoming/outgoing distinction without gradients;
- composer stays visually separate from history and respects safe-area bottom insets;
- login form uses the same radius/spacing system;
- text inputs remain 16 px, preserving the previous iOS no-auto-zoom fix;
- settings/search are overlays rather than layout-expanding blocks, reducing visual jumps;
- desktop keeps the same mobile product scale rather than stretching the private app.

### Deliberately not fabricated
The current production API does not expose the reference project's avatar URLs, phone numbers, bios, last-seen timestamps or a plaintext last-message preview for encrypted chats. The redesign therefore uses initials and factual conversation/security metadata rather than inventing profile information.

## Performance audit

### Critical path improvements
- heavy authenticated messenger runtime is deferred until unlock completion;
- no React state update is added to the Sudoku pointer-move path;
- no new `motion` runtime/dependency is added;
- reveal preview uses containment;
- reveal preview avoids backdrop blur during the moving transition;
- active chat content keeps the existing bounded-message strategy;
- image/file decryption remains lazy in the existing encrypted-attachment path.

### Remaining performance risks to profile
- preview and runtime both fetch conversations, creating one duplicate lightweight request on unlock;
- full OpenMLS startup is still expensive, but now occurs after the transition instead of during it;
- backdrop blur remains enabled in the active messenger top bar after unlock;
- large group/settings panels still share the main React tree.

These are acceptable for the current invite-only MVP if CI budgets and physical-device profiling remain green.

## Technical audit / refactor

Completed:
- extracted shared `ConversationHeader` used by plaintext and encrypted conversation views;
- isolated redesign rules into `messenger-redesign.css` instead of growing the global stylesheet further;
- isolated the pre-unlock visual layer in `MessengerRevealPreview`;
- kept the existing messenger state/network/crypto architecture instead of importing the mock Zustand store;
- did not import unused reference dependencies such as `@google/genai`, Express, Tailwind, Motion or Lucide.

This makes the supplied design a presentation layer over the production system rather than a replacement application.

## Automated acceptance added/extended

Browser acceptance now verifies:
- redesigned authenticated messenger shell is present after unlock;
- the runtime shell remains max 460 px wide;
- conversation search is present;
- the lightweight reveal preview is not left mounted after the runtime shell activates;
- existing Sudoku 50% unlock threshold behavior;
- stable viewport/input scale;
- existing MLS reload/offline/recovery acceptance.

The existing full CI remains the release gate for lint, types, build, browser E2E, performance budget, production Compose policy and real production-image builds.

## Stop criteria

Do not merge/deploy this redesign if any of the following occurs:
- MLS/browser acceptance regression;
- auth/invite/session flow regression;
- attachment/voice regression;
- mobile horizontal overflow;
- viewport scaling regression on iPhone;
- production bundle/performance budget regression;
- production Docker/Compose gate failure.

After automated CI passes, physical iPhone verification must cover:
- Sudoku reveal smoothness;
- login keyboard/focus;
- conversation list/search;
- opening/closing chats;
- text send/edit/reply/reaction;
- encrypted attachment and voice note;
- settings/search drawers;
- app background/privacy return.
