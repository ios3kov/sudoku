[
{'path':'apps/web/features/messenger/auth-gate.tsx','base':'02b9255d940dacc4a1768654fda944a8dceff32f7229aa291802289e1b2d7578','sha256':'49cb1e92a6cc5df30bddeb107510edc79fb402bc25a0894f2d298da1df378b13','edits':[(5,5,'import { ConversationDraftProvider } from "./conversation-drafts";\n'),(47,48,'    return <ConversationDraftProvider key={user.id}><MessengerShell user={user} onHide={onHide} onLoggedOut={() => setUser(null)} /></ConversationDraftProvider>;\n')]},
{'path':'apps/web/features/messenger/crypto/protocol-adapter.ts','base':'2fd3c67f00f90a5e56e32abccf29b0387f335877520641f80bcc32b2ca12cd7e','sha256':'f6790ad46a13f9ba5a79529e57d7ae0a280012bd38571d28d0f8fd7b2cf32b5d','edits':[(38,38,'  createdAt?: string;\n')]},
{'path':'apps/web/features/messenger/encrypted-conversation-view.tsx','base':'35985ad0a67421766092dc439a0be4c8a6e6051451d5f3667a977023bc46cd67','sha256':'7a0dfb102e6a921e8f0ee161a521edd40181a33683d6a569826f7b3f1f6c7132','edits':[
(21,21,r'''import { useConversationDraft } from "./conversation-drafts";
import { MessageActionSheet } from "./message-action-sheet";
import { MessageInteraction } from "./message-interaction";
import { MessageMeta } from "./message-meta";
import { MessageTimeline, type MessageTimelineHandle } from "./message-timeline";
'''),
(54,55,r'''  const [draft, setDraft] = useConversationDraft(conversation.id);
  const [editBody, setEditBody] = useState("");
  const [sendingText, setSendingText] = useState<string | null>(null);
  const [queuedMessages, setQueuedMessages] = useState<ReturnType<OpenMlsProtocolAdapter["pendingApplicationMessages"]>>([]);
  const [readSequence, setReadSequence] = useState(0);
'''),
(69,72,'  const timelineRef = useRef<MessageTimelineHandle>(null);\n'),
(82,82,r'''  const body = editingId ? editBody : draft;
  const setBody = (value: string) => editingId ? setEditBody(value) : setDraft(value);
  const messageById = useMemo(() => new Map(messages.map((message) => [message.id, message])), [messages]);
  const actionMessage = actionMessageId ? messageById.get(actionMessageId) : undefined;
  const peerReads = conversation.members.filter((member) => member.id !== user.id).map((member) => member.last_read_sequence);
'''),
(92,92,'        setReadSequence(projection.latestSequence);\n        setQueuedMessages(adapter.pendingApplicationMessages(conversation.id));\n'),
(97,105,'        setError((current) => current === "Secure sync is blocked" || current === "Encrypted message queued for retry" ? null : current);\n'),
(109,109,'        setQueuedMessages(adapter.pendingApplicationMessages(conversation.id));\n'),
(124,125,'  }, [adapter, conversation.id]);\n'),
(129,130,'    setEditBody("");\n'),
(169,184,''),
(198,200,'    () => messageById.get(replyingToId ?? "") ?? null,\n    [messageById, replyingToId],\n'),
(202,204,'    () => messageById.get(editingId ?? "") ?? null,\n    [messageById, editingId],\n'),
(216,216,'    timelineRef.current?.toLatest();\n    if (!editing) setSendingText(text);\n    const clientId = crypto.randomUUID();\n'),
(228,229,'        }, clientId);\n'),
(230,231,'      if (editing) setEditBody(""); else setDraft("");\n      setSendingText(null);\n'),
(237,238,'      const pendingMessages = adapter.pendingApplicationMessages(conversation.id);\n      setQueuedMessages(pendingMessages);\n      if (!editing && pendingMessages.some((message) => message.id === clientId)) {\n'),
(245,245,'      setSendingText(null);\n'),
(428,429,'        setEditBody("");\n'),
(444,445,'    setEditBody(message.body ?? "");\n'),
(446,447,'    textareaRef.current?.focus({ preventScroll: true });\n'),
(449,449,r'''
  function beginReply(message: ProjectedEncryptedMessage) {
    if (busy || syncBlocked || recording || message.deleted) return;
    setReplyingToId(message.id);
    setEditingId(null);
    setActionMessageId(null);
    textareaRef.current?.focus({ preventScroll: true });
  }

  async function copyMessage(text: string) {
    try { await navigator.clipboard.writeText(text); }
    catch { setError("Unable to copy message"); }
  }

  async function markVisibleRead(sequence: number) {
    await messengerApi.markRead(conversation.id, sequence);
    if (sequence > conversation.last_read_sequence) {
      onConversationUpdated({ ...conversation, last_read_sequence: sequence });
    }
  }
'''),
(496,502,r'''      <MessageTimeline
        ref={timelineRef}
        items={visibleMessages}
        currentUserId={user.id}
        readSequence={readSequence}
        onReadLatest={markVisibleRead}
        childrenBefore={loading ? <p className="muted center">Decrypting…</p> : messages.length === 0 ? (
'''),
(507,519,r'''        ) : messages.length > visibleCount ? (
          <button className="load-earlier-button" type="button" onClick={() => setVisibleCount((count) => count + INITIAL_VISIBLE_MESSAGES)}>Show earlier messages</button>
        ) : null}
        renderMessage={(message) => {
'''),
(520,527,'          const reply = message.replyTo ? messageById.get(message.replyTo) : undefined;\n'),
(528,529,'            <div className={`message-row ${own ? "own" : ""}`}>\n'),
(530,583,r'''                <MessageInteraction disabled={busy || syncBlocked || recording || message.deleted} onActions={() => setActionMessageId(message.id)} onReply={() => beginReply(message)}>
                  <div className={`message-bubble ${message.deleted ? "deleted" : ""}`}>
                    {conversation.type === "group" && !own ? <strong className="message-sender">{conversation.members.find((member) => member.id === message.senderId)?.display_name ?? "Member"}</strong> : null}
                    {reply ? <div className="reply-preview">{encryptedPreview(reply)}</div> : null}
                    {message.deleted ? <p>Message deleted</p> : (
                      <>
                        {message.body ? <p>{message.body}</p> : null}
                        {message.attachments.length > 0 ? (
                          <div className="encrypted-attachments">
                            {message.attachments.map((raw, index) => {
                              const metadata = isEncryptedAttachmentMetadata(raw) ? raw : null;
                              if (!metadata || metadata.assetId !== message.assetIds[index] || !["image", "file", "voice"].includes(message.messageType)) {
                                return <div className="file-attachment" key={`invalid-${index}`}><strong>Encrypted attachment unavailable</strong></div>;
                              }
                              return <EncryptedAttachment key={metadata.assetId} metadata={metadata} messageType={message.messageType as "image" | "file" | "voice"} />;
                            })}
                          </div>
                        ) : null}
                      </>
'''),
(584,589,r'''                    {message.reactions.length > 0 ? <div className="reaction-row">{message.reactions.map((reaction) => <span key={reaction.emoji}>{reaction.emoji} {reaction.userIds.length}</span>)}</div> : null}
                    <MessageMeta createdAt={message.createdAt} sequence={message.sequence} own={own} peerReads={peerReads} edited={message.edited} />
                  </div>
                </MessageInteraction>
                {!message.deleted ? <button className="message-more-button" type="button" aria-label="Encrypted message actions" aria-haspopup="dialog" onClick={() => setActionMessageId(message.id)}>•••</button> : null}
'''),
(590,616,''),
(617,623,r'''          );
        }}
        childrenAfter={<>
          {queuedMessages.map((message) => <div className="message-row own" key={message.id}><div className="message-bubble pending"><p>{message.body ?? (message.messageType === "voice" ? "Voice message" : "Attachment")}</p><small>Queued</small></div></div>)}
          {sendingText ? <div className="message-row own"><div className="message-bubble pending"><p>{sendingText}</p><small role="status">Sending…</small></div></div> : null}
        </>}
      />
      {actionMessage && !actionMessage.deleted ? <MessageActionSheet
        preview={encryptedPreview(actionMessage)}
        onClose={() => setActionMessageId(null)}
        actions={[
          ...(actionMessage.body ? [{ id: "copy", label: "Copy", run: () => { void copyMessage(actionMessage.body!); } }] : []),
          { id: "reply", label: "Reply", disabled: busy || syncBlocked || recording, run: () => beginReply(actionMessage) },
          ...(actionMessage.senderId === user.id && actionMessage.messageType === "text" ? [{ id: "edit", label: "Edit", disabled: busy || syncBlocked || recording, run: () => beginEdit(actionMessage) }] : []),
          { id: "👍", label: "👍", disabled: busy || syncBlocked, run: () => { void toggleReaction(actionMessage, "👍"); } },
          { id: "❤️", label: "❤️", disabled: busy || syncBlocked, run: () => { void toggleReaction(actionMessage, "❤️"); } },
          { id: "😂", label: "😂", disabled: busy || syncBlocked, run: () => { void toggleReaction(actionMessage, "😂"); } },
          ...(actionMessage.senderId === user.id ? [{ id: "delete", label: "Delete", destructive: true, disabled: busy || syncBlocked, run: () => { void deleteMessage(actionMessage); } }] : []),
        ]}
      /> : null}
'''),
(635,636,'            setEditBody("");\n'),
(659,659,'          aria-label="Message"\n'),
(694,710,'')
]},
{'path':'docs/PROGRESS.md','base':'3554d4b86bfea7ef78e21eaaa1ef61dbfc7a53de5d5d30932154c19c12364a85','sha256':'0a799f1f87632eea247db56c557c4a69c992ebd47f50159874ff40b30c7e01ba','edits':[(3,4,r'''Messenger UX 3.0 is under implementation on `feat/messenger-ux3`, based on merged
PR #30 (`ff97e0f4ed476cd33be095a8814f90936849805a`). Scope: date/grouped history,
long-press actions, swipe-to-reply, jump-to-latest/new arrivals, evidence-based
status labels and RAM-only per-conversation drafts.
'''),(5,6,r'''Specification, acceptance tickets, implementation decisions and verification are
tracked in `docs/audits/messenger-ux3-2026-09-21.md`. Main and production are not
changed by this branch. Physical Step 70 remains explicitly deferred; no new
production smoke/deployment result is inferred from CI.
''')]},
{'path':'docs/audits/messenger-ux3-2026-09-21.md','base':None,'sha256':'96337fee03a886384ce2fa217cdb524fcd36aa4bc99cb2816fc63c3a3727400f','edits':[(0,0,r'''# Messenger UX 3.0 — specification and verification log

## Scope and invariants

Continue from PR #30 / `ff97e0f4ed476cd33be095a8814f90936849805a`.
Keep the Minimal Messenger visual system and the 50% Sudoku reveal unchanged.
No new dependency, database migration, MLS wire-payload change, or weakened authorization.
Step 70 physical-device, restore, reboot and PWA checks remain deferred by the user.

## Acceptance tickets

1. Consecutive messages from one sender group within five minutes and one local day. Dates come from actual server metadata. Never infer timestamps from sequence numbers or current time. Legacy encrypted journals with no timestamp remain undated.
2. Long press opens an accessible action sheet. The existing actions button and desktop context menu remain available. Vertical scroll, media controls, multitouch and cancellation must not trigger reply or actions.
3. Rightward swipe of at least 64 px starts reply; shorter/cancelled/vertical gestures return without action. Touch movement changes compositor transform only, not React state on every move.
4. Reading older messages does not snap the user to the bottom. A latest-message button counts actual incoming messages, not sequence gaps, edits or one's own sends. Loading earlier history and media resize preserve the visible anchor.
5. Sent means server-accepted; Read is shown only from read receipts. No invented Delivered state. Sending and queued states must remain distinct.
6. Draft text survives chat-list/chat switches, isolated per conversation and account. RAM only, bounded, and cleared when the private surface closes or account signs out. Edit text never overwrites an existing unsent draft. Page refresh persistence is intentionally not promised.

## Architecture

- `packages/domain/src/messenger-ux.ts`: pure timeline/delivery/gesture/draft rules.
- Shared React presentation: timeline, gesture surface and native dialog action sheet.
- Draft provider scoped to the mounted authenticated private surface.
- Additive optional `created_at` transport metadata copied into the already encrypted local journal; no message payload or cursor-ordering change.
- Existing network, crypto, upload and membership controllers stay authoritative.

## Risks / decisions

- Server time is display metadata, not authenticated sender time or ordering authority.
- Existing persisted encrypted records cannot acquire timestamps without a separate backfill; this release does not reread/decrypt old MLS events.
- Action sheets must close before focusing the composer within the same user interaction.
- Rendering and gesture tests cannot certify physical iPhone frame pacing.
- Temporary source/toolchain export workflow is development-only and removed from the final PR diff.

## Verification so far

- TDD: new UX unit suite initially failed for the missing module; implementation passed nine tests.
- TDD: optional timestamp test failed with `undefined` before projection support was added.
- Full local domain suite rerun after timestamp support (see final verification below).

## Final verification

Pending implementation, browser interaction tests, lint, typecheck, production build and full CI. No production deployment performed.

## Local verification before CI
- Domain suite: 23 passed (10 UX3 tests; existing projection/privacy/Sudoku regressions retained).
- UI class contract: 149 classes; 7 contract regression tests passed.
- Actual pinned web TypeScript and Next production build passed.
- ESLint: 0 errors, 18 warnings; warnings are not silently treated as a clean audit.
- Python compileall passed for API, migrations and integration tests.
- Production bundle: 214,395 bytes gzip total JS, largest chunk 71,470; WASM unchanged at 2,709,987 bytes.
- Local Chromium navigation is disabled by the environment's administrator policy.
  That policy was not changed. Browser assertions run in GitHub Actions instead;
  no physical-iPhone smoothness claim is based on local desktop measurements.
- Added five presentation browser scenarios and extended the existing real MLS
  scenario with timestamp persistence, action sheet and draft navigation checks.
- Server transport timestamp is asserted against the original accepted message
  timestamp in the existing API transport integration test.
- Browser/real-service acceptance and production container build: pending CI.
''')]},
{'path':'tests/api/test_mls_transport.py','base':'970e5d90eee345d8aa74aa607be8984d0522f54abe5ddf50db8c907efe214dfa','sha256':'d3a8e8112ea2f801aac4cba8b025c3f35ee0eb465e3d05b1786e2d152c10ee4b','edits':[(4,4,'from datetime import datetime\n'),(557,557,r'''        # Additive display metadata must be the accepted server timestamp,
        # not a locally invented arrival time or an MLS cursor-derived date.
        assert datetime.fromisoformat(items[1]["created_at"]) == datetime.fromisoformat(first.json()["created_at"])
        assert datetime.fromisoformat(items[3]["created_at"]) == datetime.fromisoformat(second.json()["created_at"])
''')]}
]
