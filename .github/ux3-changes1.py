[
{'path':'apps/web/app/layout.tsx','base':'c184792c84a93c33a63a25d7903c951c62e0cb8cfea738b1b03996ed8c805304','sha256':'5fba0ed8e0986fa5adbc5a977b0365349edf546ad289d6a52c00eb537df18634','edits':[(5,5,'import "../features/messenger/messenger-ux3.css";\n')]},
{'path':'apps/web/features/messenger/conversation-view.tsx','base':'9209416d9375e7cf1a7fdf6559bf948783b2c346e8a9aeae4096df4b63916b7e','sha256':'4f2b00f08f959ea5aa3b67fc76167d07b7f4232d55ba3ba4031b2ef5de738329','edits':[
(13,13,r'''import { useConversationDraft } from "./conversation-drafts";
import { MessageActionSheet } from "./message-action-sheet";
import { MessageInteraction } from "./message-interaction";
import { MessageMeta } from "./message-meta";
import { MessageTimeline, type MessageTimelineHandle } from "./message-timeline";
'''),
(46,47,r'''  const [draft, setDraft, restoreDraft] = useConversationDraft(conversation.id);
  const [editBody, setEditBody] = useState("");
  const [hasEarlier, setHasEarlier] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [visibleCount, setVisibleCount] = useState(120);
'''),
(64,65,'  const timelineRef = useRef<MessageTimelineHandle>(null);\n'),
(76,76,r'''  const body = editingMessage ? editBody : draft;
  const setBody = (value: string) => editingMessage ? setEditBody(value) : setDraft(value);
  const messageById = useMemo(() => new Map(messages.map((message) => [message.id, message])), [messages]);
  const actionMessage = actionMessageId ? messageById.get(actionMessageId) : undefined;
  const timelineMessages = useMemo(() => messages.slice(-visibleCount).map((message) => ({
    ...message, senderId: message.sender_id, createdAt: message.created_at, deleted: Boolean(message.deleted_at),
  })), [messages, visibleCount]);
  const peerReads = conversation.members.filter((member) => member.id !== user.id).map((member) => member.last_read_sequence);
'''),
(98,98,'        setHasEarlier(history.length === 50);\n'),(99,101,'\n'),
(114,124,r'''    const sequence = scrollTargetSequenceRef.current;
    if (sequence === null) return;
    timelineRef.current?.toSequence(sequence);
    scrollTargetSequenceRef.current = null;
  }, [messages]);
'''),
(153,154,''),(157,158,''),(238,239,''),(242,243,''),
(299,299,'    timelineRef.current?.toLatest();\n'),
(315,315,r'''        restoreDraft(text);
        setPending((current) => current.filter((item) => item.client_id !== local.client_id));
'''),
(337,337,r'''          restoreDraft(text);
          setPending((current) => current.filter((item) => item.client_id !== local.client_id));
'''),
(341,341,'        restoreDraft(text);\n'),
(381,382,'    textareaRef.current?.focus({ preventScroll: true });\n'),
(388,389,'    setEditBody(message.body);\n'),
(390,391,'    textareaRef.current?.focus({ preventScroll: true });\n'),
(530,531,''),
(542,542,r'''
  async function copyMessage(text: string) {
    try { await navigator.clipboard.writeText(text); }
    catch { setError("Unable to copy message"); }
  }

  async function markVisibleRead(sequence: number) {
    await messengerApi.markRead(conversation.id, sequence);
    if (sequence > conversation.last_read_sequence) onConversationUpdated({ ...conversation, last_read_sequence: sequence });
  }

  async function loadEarlier() {
    if (loadingEarlier) return;
    if (messages.length > visibleCount) { setVisibleCount((count) => count + 120); return; }
    const before = messages[0]?.sequence;
    if (!before || !hasEarlier) return;
    setLoadingEarlier(true);
    try {
      const earlier = await messengerApi.messages(conversation.id, { before, limit: 50 });
      setHasEarlier(earlier.length === 50);
      setVisibleCount((count) => count + earlier.length);
      setMessages((current) => mergeMessages(current, earlier));
    } catch { setError("Unable to load earlier messages"); }
    finally { setLoadingEarlier(false); }
  }
'''),
(584,592,r'''      <MessageTimeline
        ref={timelineRef}
        items={timelineMessages}
        currentUserId={user.id}
        onReadLatest={markVisibleRead}
        childrenBefore={<>
          {loading ? <p className="muted center">Loading…</p> : null}
          {error ? <p className="form-error center" role="alert">{error}</p> : null}
          {!loading && !error && messages.length === 0 && pending.length === 0 ? (
            <div className="empty-conversations compact chat-empty-state"><div className="empty-icon" aria-hidden="true">•••</div><h2>No messages yet</h2><p>Send the first message when you are ready.</p></div>
          ) : null}
          {hasEarlier || messages.length > visibleCount ? <button className="load-earlier-button" type="button" disabled={loadingEarlier} onClick={() => void loadEarlier()}>{loadingEarlier ? "Loading earlier…" : "Show earlier messages"}</button> : null}
        </>}
        renderMessage={(message) => (
          <div className={`message-stack ${message.sender_id === user.id ? "own" : ""} ${highlightedSequence === message.sequence ? "search-hit" : ""}`}>
            <MessageBubble
              message={message}
              own={message.sender_id === user.id}
              replyMessage={message.reply_to ? messageById.get(message.reply_to) ?? null : null}
              peerReads={peerReads}
              senderName={conversation.type === "group" && message.sender_id !== user.id ? conversation.members.find((member) => member.id === message.sender_id)?.display_name ?? "Member" : null}
              onReply={() => beginReply(message)}
              onToggleActions={() => setActionMessageId(message.id)}
            />
'''),
(593,629,r'''        )}
        childrenAfter={<>
          {pending.map((message) => <div className="message-row own" key={message.client_id}><div className="message-bubble pending"><p>{message.body}</p><small>{online ? "Sending…" : "Queued"}</small></div></div>)}
          {typingUsers.size > 0 ? <div className="typing-indicator">typing…</div> : null}
        </>}
      />
      {actionMessage && !actionMessage.deleted_at ? <MessageActionSheet
        preview={previewMessage(actionMessage)}
        onClose={() => setActionMessageId(null)}
        actions={[
          ...(actionMessage.body ? [{ id: "copy", label: "Copy", run: () => { void copyMessage(actionMessage.body!); } }] : []),
          { id: "reply", label: "Reply", run: () => beginReply(actionMessage) },
          { id: "heart", label: "❤️", run: () => { void toggleHeart(actionMessage); } },
          ...(actionMessage.sender_id === user.id && actionMessage.type === "text" ? [{ id: "edit", label: "Edit", run: () => beginEdit(actionMessage) }] : []),
          ...(actionMessage.sender_id === user.id ? [{ id: "delete", label: "Delete", destructive: true, run: () => { void removeMessage(actionMessage); } }] : []),
        ]}
      /> : null}
'''),
(656,656,'          aria-label="Message"\n'),
(676,677,'  peerReads,\n  senderName,\n  onReply,\n'),
(682,683,'  peerReads: readonly number[];\n  senderName: string | null;\n  onReply: () => void;\n'),
(689,689,'        <MessageInteraction disabled={deleted} onActions={onToggleActions} onReply={onReply}>\n'),
(690,690,'          {senderName ? <strong className="message-sender">{senderName}</strong> : null}\n'),
(716,721,'          <MessageMeta createdAt={message.created_at} sequence={message.sequence} own={own} peerReads={peerReads} edited={Boolean(message.edited_at)} />\n'),
(722,723,r'''        </MessageInteraction>
        {!deleted ? <button className="message-more-button" type="button" onClick={onToggleActions} aria-label="Message actions" aria-haspopup="dialog">•••</button> : null}
'''),
(754,763,'')
]},
{'path':'apps/web/features/messenger/types.ts','base':'af75d5f1f95802c8b1f56b35ea01e0e35f2b1b4303292d54744a53bb1983fcf3','sha256':'730b5c175cd9071b7d4c1cc8273fe464c8031e552b904ae40642a651af23ff00','edits':[(188,188,'      created_at?: string;\n')]},
{'path':'apps/web/tests/browser/e2ee-recovery.spec.ts','base':'9f36ade7140adca242bb68a9db4ba8b22d8e2183e97d7441ab0fda3766a35d48','sha256':'35dddb9ff930c47c0af2f54730e49a001b936a898cfe52bf7e8c37b18c085bd4','edits':[(165,165,r'''    // UX3 must preserve actual encrypted history and drafts, not only fixture UI.
    await expect(owner.locator(".message-date-separator")).toHaveCount(1);
    await composer.fill("unsent secure draft");
    await owner.getByRole("button", { name: "Back to conversations" }).click();
    await openConversation(owner, "Browser Peer");
    await expect(composer).toHaveValue("unsent secure draft");
    await owner.getByRole("button", { name: "Encrypted message actions" }).last().click();
    await expect(owner.getByRole("dialog", { name: "Message actions", exact: true })).toBeVisible();
    await owner.keyboard.press("Escape");
    await expect(owner.getByRole("dialog")).toHaveCount(0);
    await composer.fill("");

'''),(178,178,'    await expect(peer.locator(".message-date-separator")).toHaveCount(1);\n')]}
]
