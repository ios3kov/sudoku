# Step 94 — accessibility, Dynamic Type and VoiceOver

Date: 2026-09-24.

## Scope and status

Repository implementation and automated regression pass for the messaging surface and native privacy cover. This step does **not** mark the Accessibility/Dynamic Type/VoiceOver checkbox or physical-iPhone acceptance complete. Real VoiceOver, native text-size changes, system pickers and device acceptance still require the manual matrix below.

## Research and reference patterns

Reviewed primary sources before implementation:

- [Apple, Get started with Dynamic Type (WWDC24)](https://developer.apple.com/videos/play/wwdc2024/10074/): use system-scaled text, allow wrapping, adapt layouts and inspect the largest accessibility categories.
- [WebKit, Using the System Font in Web Content](https://webkit.org/blog/3709/using-the-system-font-in-web-content/): choosing the system font family alone does not opt fixed pixel sizes into Dynamic Type. The native host therefore supplies a UIKit body-text scale explicitly.
- [WAI, Resize Text](https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html): retain content and functionality when enlarging text to 200%.
- [WAI, Modal Dialog Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/): keep focus inside the dialog, restore it on dismissal, and prefer the least destructive initial action for irreversible operations.
- [Element, accessible by design](https://blog.element.dev/element-is-accessible-by-design/): check screen-reader reading order, image descriptions and keyboard behavior as explicit product work.

These are behavioral references, not source-code imports. No Signal/Element GPL/AGPL implementation is copied. This is not a WCAG conformance certification.

## Implementation

- Remove the web viewport's zoom prohibition.
- Use relative text sizes in messenger styles, preserving the default scale while allowing browser preferences and the native text scale to enlarge text.
- The iOS host derives the root percentage from UIKit body `UIFontMetrics`. It updates the trusted main page after navigation and on content-size changes; no inbound message handler or content access is introduced.
- Let conversation headers/actions wrap. Keep long message words and receipt descriptions inside bubbles. Preserve 44-point/CSS-pixel control targets and scrollable text input.
- Recalculate the composer when the viewport or native text scale changes, preserving the draft and bounding its height so history remains available.
- Expose message history as a named keyboard-focusable region. Do not turn the entire private history into a live region that would announce bulk history or receipt updates.
- Read details are real visually-hidden text, rather than an `aria-label` on a generic span; visible Sent/Read labels remain.
- Keep native modal action behavior; focus Cancel when entering deletion confirmation. Explicit action buttons remain the alternative to swipe/long press.
- Honor reduced motion across the messenger and show a consistent keyboard focus outline.
- Hide the WKWebView accessibility subtree synchronously while the native privacy cover is visible. The cover is modal to accessibility, scales its title and can shrink its decorative grid.

## Automated verification

`apps/web/tests/browser/accessibility.spec.ts` exercises the real encrypted conversation fixture:

- 200% and 300% text at a 320 CSS-pixel viewport, in-bounds controls, non-overflowing history and successful sending;
- keyboard history scrolling and accessible reader detail;
- deletion confirmation focus, Tab containment, Escape and opener restoration;
- reduced-motion behavior.

Run the existing UX, typing/read-state, voice and predeployment lifecycle suites too. Full CI includes web lint/typecheck/build/budget and browser acceptance; `ios-native` compiles the changed UIKit implementation.

The bundled conversation was also checked through the desktop app browser at 320px / 300%: history scroll width equals client width (320px); deletion confirmation focuses Cancel and Escape restores the action button. This is browser evidence, not physical-iPhone VoiceOver acceptance.

Local Playwright browser execution on the operator Mac is constrained by the Codex sandbox (Chromium MachPortRendezvous permission denied). GitHub CI is the browser execution gate. Local typecheck also requires the generated OpenMLS package; do not replace it with a stub to claim a passing production build.

## Manual acceptance — remains open

- [ ] Physical iPhone: default, XL, AX1 and AX5; change text size while chat is open and after background/resume, without losing draft or scroll context.
- [ ] VoiceOver: login, conversation list, direct/group history, sender/date/read details, reply/edit/delete, attachment picker, recording/preview/scrub/send and error/retry.
- [ ] Swipe reading order stays logical; visible actions work without long press; modal focus returns predictably.
- [ ] Background/privacy cover prevents reading underlying messages; resume restores the expected private/public surface and accessibility focus.
- [ ] Large text plus software keyboard, narrow portrait and landscape retain all essential controls; no clipped text or horizontal message scrolling.
- [ ] System Contacts/Photos/Files pickers, biometrics, Switch Control and external keyboard verified on device.
- [ ] Full contrast and app-wide screen-reader audit, including Sudoku reveal/access, completed before claiming an accessibility pass.

## Release boundary

Repository changes only. No production deployment, migrations, TestFlight or App Store action. Issue #63's accessibility and physical-device checkboxes stay unchecked until their own evidence is recorded.
