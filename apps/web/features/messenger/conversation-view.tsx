"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { messengerApi } from "./api";
import { enqueuePending, listPending, removePending } from "./outbox";
import type { RealtimeClient } from "./realtime";
import type { Conversation, CurrentUser, Message, PendingMessage, RealtimeEvent } from "./types";
import { uploadAsset } from "./uploads";
import { nativeMediaAvailable, pickNativeAttachment } from "./native-media-access";
import { ProtectedAttachment } from "./protected-attachment";
import { GroupSettings } from "./group-settings";
import { ConversationPreferences } from "./conversation-preferences";
import { MessageSearch } from "./message-search";
import { ConversationHeader } from "./conversation-header";
import { useVoiceRecorder } from "./use-voice-recorder";
import { useAutosizeTextarea } from "./use-autosize-textarea";
import { useConversationDraft } from "./conversation-drafts";
import { MessageActionSheet } from "./message-action-sheet";
import { MessageInteraction } from "./message-interaction";
import { MessageMeta } from "./message-meta";
import { MessageTimeline, type MessageTimelineHandle } from "./message-timeline";
import {
  conversationTitle,
  formatDuration,
  voiceFileExtension,
} from "./chat-utils";

export function ConversationView({
  conversation,
  user,
  realtime,
  realtimeEvent,
  reconnectTick,
  onBack,
  onHide,
  onConversationUpdated,
  onReadAcknowledged,
  onConversationLeft,
}: {
  conversation: Conversation;
  user: CurrentUser;
  realtime: RealtimeClient | null;
  realtimeEvent: RealtimeEvent | null;
  reconnectTick: number;
  onBack: () => void;
  onHide: () => void;
  onConversationUpdated: (conversation: Conversation) => void;
  onReadAcknowledged: (conversationId: string, sequence: number) => void;
  onConversationLeft: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [draft, setDraft, restoreDraft] = useConversationDraft(conversation.id);
  const [editBody, setEditBody] = useState("");
  const [hasEarlier, setHasEarlier] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [visibleCount, setVisibleCount] = useState(120);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());
  const [online, setOnline] = useState(true);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [actionMessageId, setActionMessageId] = useState<string | null>(null);
  const [showGroupSettings, setShowGroupSettings] = useState(false);
  const [showPreferences, setShowPreferences] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [highlightedSequence, setHighlightedSequence] = useState<number | null>(null);

  const typingTimer = useRef<number | null>(null);
  const remoteTypingTimers = useRef<Map<string, number>>(new Map());
  const timelineRef = useRef<MessageTimelineHandle>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const lastProcessedEventRef = useRef<RealtimeEvent | null>(null);
  const scrollTargetSequenceRef = useRef<number | null>(null);
  const highlightTimerRef = useRef<number | null>(null);

  const body = editingMessage ? editBody : draft;
  const setBody = (value: string) => editingMessage ? setEditBody(value) : setDraft(value);
  const messageById = useMemo(() => new Map(messages.map((message) => [message.id, message])), [messages]);
  const actionMessage = actionMessageId ? messageById.get(actionMessageId) : undefined;
  const timelineMessages = useMemo(() => messages.map((message) => ({
    ...message, senderId: message.sender_id, createdAt: message.created_at, deleted: Boolean(message.deleted_at),
  })), [messages]);
  const peerReads = conversation.members.filter((member) => member.id !== user.id).map((member) => member.last_read_sequence);
  useAutosizeTextarea(textareaRef, body);

  const lastSequence = useMemo(
    () => messages.reduce((max, message) => Math.max(max, message.sequence), 0),
    [messages],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setMessages([]);
    setReplyingTo(null);
    setEditingMessage(null);
    setActionMessageId(null);
    void Promise.all([
      messengerApi.messages(conversation.id, { limit: 50 }),
      listPending().catch(() => [] as PendingMessage[]),
    ])
      .then(([history, queued]) => {
        if (cancelled) return;
        setMessages(history);
        setHasEarlier(history.length === 50);
        setPending(queued.filter((item) => item.conversation_id === conversation.id));

      })
      .catch(() => {
        if (!cancelled) setError("Unable to load messages");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [conversation.id]);

  useEffect(() => {
    const sequence = scrollTargetSequenceRef.current;
    if (sequence === null) return;
    timelineRef.current?.toSequence(sequence);
    scrollTargetSequenceRef.current = null;
  }, [messages]);

  useEffect(() => {
    const syncOnline = () => setOnline(navigator.onLine);
    const typingTimers = remoteTypingTimers.current;
    syncOnline();
    window.addEventListener("online", syncOnline);
    window.addEventListener("offline", syncOnline);
    return () => {
      window.removeEventListener("online", syncOnline);
      window.removeEventListener("offline", syncOnline);
      for (const timer of typingTimers.values()) window.clearTimeout(timer);
      typingTimers.clear();
      if (typingTimer.current !== null) window.clearTimeout(typingTimer.current);
      if (highlightTimerRef.current !== null) window.clearTimeout(highlightTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!realtimeEvent || realtimeEvent === lastProcessedEventRef.current) return;
    lastProcessedEventRef.current = realtimeEvent;
    if (realtimeEvent.conversation_id !== conversation.id) return;

    if (realtimeEvent.type.startsWith("message.") && realtimeEvent.payload) {
      const message = realtimeEvent.payload as Message;
      setMessages((current) => mergeMessages(current, [message]));
      setPending((current) => current.filter((item) => item.client_id !== message.client_id));
      void removePending(message.client_id).catch(() => undefined);
      if (message.sequence > 0) {
        onConversationUpdated({
          ...conversation,
          latest_sequence: Math.max(conversation.latest_sequence, message.sequence),
        });
      }
      return;
    }

    if (realtimeEvent.type === "reaction.updated" && realtimeEvent.payload) {
      const payload = realtimeEvent.payload as { message_id?: string; user_id?: string; emoji?: string; active?: boolean };
      if (payload.message_id && payload.user_id && payload.emoji && typeof payload.active === "boolean") {
        setMessages((current) => applyReaction(current, payload.message_id!, payload.user_id!, payload.emoji!, payload.active!));
      }
      return;
    }

    if ((realtimeEvent.type === "typing.started" || realtimeEvent.type === "typing.stopped") && realtimeEvent.payload) {
      const senderId = String((realtimeEvent.payload as { user_id?: string }).user_id ?? "");
      if (!senderId || senderId === user.id) return;
      const existingTimer = remoteTypingTimers.current.get(senderId);
      if (existingTimer !== undefined) window.clearTimeout(existingTimer);
      if (realtimeEvent.type === "typing.stopped") {
        setTypingUsers((current) => {
          const next = new Set(current);
          next.delete(senderId);
          return next;
        });
        remoteTypingTimers.current.delete(senderId);
      } else {
        setTypingUsers((current) => new Set(current).add(senderId));
        const timer = window.setTimeout(() => {
          setTypingUsers((current) => {
            const next = new Set(current);
            next.delete(senderId);
            return next;
          });
          remoteTypingTimers.current.delete(senderId);
        }, 3000);
        remoteTypingTimers.current.set(senderId, timer);
      }
    }
  }, [realtimeEvent, conversation, onConversationUpdated, user.id]);

  useEffect(() => {
    if (reconnectTick > 0) void catchUp();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reconnectTick]);

  useEffect(() => {
    function handleOnline() {
      void flushOutbox();
    }
    window.addEventListener("online", handleOnline);
    void flushOutbox();
    return () => window.removeEventListener("online", handleOnline);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation.id]);

  async function catchUp() {
    try {
      const fresh = await messengerApi.messages(conversation.id, { after: lastSequence, limit: 100 });
      if (!fresh.length) return;
      setMessages((current) => mergeMessages(current, fresh));
      for (const message of fresh) await removePending(message.client_id).catch(() => undefined);
      setPending((current) => current.filter((item) => !fresh.some((message) => message.client_id === item.client_id)));
      const latest = fresh.at(-1)?.sequence ?? 0;
      if (latest > 0) {
        onConversationUpdated({
          ...conversation,
          latest_sequence: Math.max(conversation.latest_sequence, latest),
        });
      }
    } catch {
      // Next reconnect/online signal retries durable catch-up.
    }
  }

  async function flushOutbox() {
    if (!navigator.onLine) return;
    const queued = await listPending().catch(() => [] as PendingMessage[]);
    for (const item of queued.filter((entry) => entry.conversation_id === conversation.id)) {
      try {
        const sent = await messengerApi.sendMessage(
          item.conversation_id,
          item.client_id,
          item.body,
          "text",
          [],
          item.reply_to ?? null,
        );
        await removePending(item.client_id);
        setMessages((current) => mergeMessages(current, [sent]));
        setPending((current) => current.filter((candidate) => candidate.client_id !== item.client_id));
      } catch (sendError) {
        const status = (sendError as Error & { status?: number }).status;
        if (status && status >= 400 && status < 500) {
          await removePending(item.client_id).catch(() => undefined);
          setPending((current) => current.filter((candidate) => candidate.client_id !== item.client_id));
        }
        break;
      }
    }
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    const text = body.trim();
    if (!text) return;
    setError(null);

    if (editingMessage) {
      if (!navigator.onLine) {
        setError("Editing requires a connection");
        return;
      }
      try {
        const updated = await messengerApi.editMessage(editingMessage.id, text);
        setMessages((current) => mergeMessages(current, [updated]));
        setEditingMessage(null);
        setBody("");
      } catch {
        setError("Unable to edit message");
      }
      return;
    }

    timelineRef.current?.toLatest();
    setBody("");
    realtime?.sendTyping(conversation.id, false);
    const local: PendingMessage = {
      client_id: crypto.randomUUID(),
      conversation_id: conversation.id,
      body: text,
      created_at: Date.now(),
      reply_to: replyingTo?.id ?? null,
    };
    setReplyingTo(null);
    setPending((current) => [...current, local]);

    if (!navigator.onLine) {
      try {
        await enqueuePending(local);
      } catch {
        restoreDraft(text);
        setPending((current) => current.filter((item) => item.client_id !== local.client_id));
        setError("Offline queue unavailable on this device");
      }
      return;
    }

    try {
      const sent = await messengerApi.sendMessage(
        conversation.id,
        local.client_id,
        local.body,
        "text",
        [],
        local.reply_to,
      );
      setMessages((current) => mergeMessages(current, [sent]));
      setPending((current) => current.filter((item) => item.client_id !== local.client_id));
    } catch (sendError) {
      const status = (sendError as Error & { status?: number }).status;
      if (!status || status >= 500) {
        try {
          await enqueuePending(local);
        } catch {
          restoreDraft(text);
          setPending((current) => current.filter((item) => item.client_id !== local.client_id));
          setError("Message could not be queued");
        }
      } else {
        setPending((current) => current.filter((item) => item.client_id !== local.client_id));
        restoreDraft(text);
        setError("Message was rejected");
      }
    }
  }

  async function attachFile(file: File) {
    setError(null);
    if (!navigator.onLine) {
      setError("Attachments require a connection");
      return;
    }

    setUploadProgress(0);
    try {
      const asset = await uploadAsset(file, setUploadProgress);
      const type = asset.mime_type.startsWith("image/") ? "image" : "file";
      const sent = await messengerApi.sendMessage(conversation.id, crypto.randomUUID(), file.name, type, [asset.id]);
      setMessages((current) => mergeMessages(current, [sent]));
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Attachment failed");
    } finally {
      setUploadProgress(null);
    }
  }

  async function attach(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) await attachFile(file);
  }

  async function chooseAttachment() {
    if (!nativeMediaAvailable()) {
      fileInputRef.current?.click();
      return;
    }
    try {
      const file = await pickNativeAttachment();
      await attachFile(file);
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      setError(reason instanceof Error ? reason.message : "Unable to select attachment");
    }
  }

  function updateTyping(nextBody: string) {
    setBody(nextBody);
    if (editingMessage) return;
    realtime?.sendTyping(conversation.id, nextBody.trim().length > 0);
    if (typingTimer.current !== null) window.clearTimeout(typingTimer.current);
    typingTimer.current = window.setTimeout(() => realtime?.sendTyping(conversation.id, false), 1500);
  }

  function beginReply(message: Message) {
    setEditingMessage(null);
    setReplyingTo(message);
    setActionMessageId(null);
    textareaRef.current?.focus({ preventScroll: true });
  }

  function beginEdit(message: Message) {
    if (!message.body || message.type !== "text") return;
    setReplyingTo(null);
    setEditingMessage(message);
    setEditBody(message.body);
    setActionMessageId(null);
    textareaRef.current?.focus({ preventScroll: true });
  }

  async function removeMessage(message: Message) {
    setActionMessageId(null);
    if (!navigator.onLine) {
      setError("Deleting requires a connection");
      return;
    }
    try {
      await messengerApi.deleteMessage(message.id);
      setMessages((current) => current.map((item) => item.id === message.id ? { ...item, body: null, deleted_at: new Date().toISOString() } : item));
    } catch {
      setError("Unable to delete message");
    }
  }

  async function toggleHeart(message: Message) {
    if (!navigator.onLine) {
      setError("Reactions require a connection");
      return;
    }
    const active = message.reactions.some((reaction) => reaction.emoji === "❤️" && reaction.user_ids.includes(user.id));
    setMessages((current) => applyReaction(current, message.id, user.id, "❤️", !active));
    try {
      await messengerApi.toggleReaction(message.id, "❤️");
    } catch {
      setMessages((current) => applyReaction(current, message.id, user.id, "❤️", active));
      setError("Unable to update reaction");
    }
  }

  async function uploadVoice(chunks: Blob[], mimeType: string) {
    setUploadProgress(0);
    try {
      const extension = voiceFileExtension(mimeType);
      const file = new File(chunks, `voice-${Date.now()}.${extension}`, { type: mimeType });
      const asset = await uploadAsset(file, setUploadProgress);
      const sent = await messengerApi.sendMessage(
        conversation.id,
        crypto.randomUUID(),
        "Voice message",
        "voice",
        [asset.id],
      );
      setMessages((current) => mergeMessages(current, [sent]));
    } catch (voiceError) {
      setError(voiceError instanceof Error ? voiceError.message : "Voice note failed");
    } finally {
      setUploadProgress(null);
    }
  }

  const {recording, requesting: requestingMic, seconds: recordSeconds, toggle: toggleVoice} = useVoiceRecorder({onReady: uploadVoice, onError: setError});

  async function toggleRecording() {
    if (recording) { await toggleVoice(); return; }
    if (requestingMic || uploadProgress !== null) return;
    setError(null);
    if (!navigator.onLine) { setError("Voice notes require a connection"); return; }
    await toggleVoice();
  }

  async function jumpToSearchResult(target: Message) {
    setError(null);
    try {
      const [before, after] = await Promise.all([
        messengerApi.messages(conversation.id, { before: target.sequence + 1, limit: 25 }),
        messengerApi.messages(conversation.id, { after: target.sequence, limit: 25 }),
      ]);
      scrollTargetSequenceRef.current = target.sequence;
      setHighlightedSequence(target.sequence);
      setMessages(mergeMessages([], [...before, target, ...after]));
      setShowSearch(false);
      if (highlightTimerRef.current !== null) window.clearTimeout(highlightTimerRef.current);
      highlightTimerRef.current = window.setTimeout(() => setHighlightedSequence(null), 1800);
    } catch {
      setError("Unable to open search result");
    }
  }


  async function copyMessage(text: string) {
    try { await navigator.clipboard.writeText(text); }
    catch { setError("Unable to copy message"); }
  }

  async function markVisibleRead(sequence: number) {
    await messengerApi.markRead(conversation.id, sequence);
    onReadAcknowledged(conversation.id, sequence);
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
  return (
    <section className="chat-view">
      <ConversationHeader
        title={conversationTitle(conversation, user.id)}
        subtitle={online ? "connected" : "offline"}
        onBack={onBack}
        actions={
          <>
            <button type="button" className="hide-chat-button" onClick={() => { setShowSearch((value) => !value); setShowPreferences(false); setShowGroupSettings(false); }}>Find</button>
            {conversation.type === "group" ? <button type="button" className="hide-chat-button" onClick={() => { setShowGroupSettings((value) => !value); setShowSearch(false); setShowPreferences(false); }}>Group</button> : null}
            <button type="button" className="hide-chat-button" aria-label="Conversation settings" onClick={() => { setShowPreferences((value) => !value); setShowSearch(false); setShowGroupSettings(false); }}>•••</button>
            <button type="button" className="hide-chat-button" onClick={onHide}>Hide</button>
          </>
        }
      />

      {conversation.type === "group" && showGroupSettings ? (
        <GroupSettings
          conversation={conversation}
          user={user}
          onUpdated={onConversationUpdated}
          onLeft={onConversationLeft}
          onClose={() => setShowGroupSettings(false)}
        />
      ) : null}

      {showPreferences ? (
        <ConversationPreferences
          conversation={conversation}
          onUpdated={onConversationUpdated}
          onClose={() => setShowPreferences(false)}
        />
      ) : null}

      {showSearch ? (
        <MessageSearch
          conversationId={conversation.id}
          onSelect={(message) => void jumpToSearchResult(message)}
          onClose={() => setShowSearch(false)}
        />
      ) : null}

      <MessageTimeline
        ref={timelineRef}
        items={timelineMessages}
        visibleCount={visibleCount}
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
          </div>
        )}
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

      {replyingTo || editingMessage ? (
        <div className="composer-context">
          <span>{editingMessage ? "Editing message" : `Replying to ${previewMessage(replyingTo!)}`}</span>
          <button type="button" aria-label={editingMessage ? "Cancel edit" : "Cancel reply"} onClick={() => { setReplyingTo(null); setEditingMessage(null); if (editingMessage) setEditBody(""); }}>×</button>
        </div>
      ) : null}

      <form className="composer" onSubmit={send}>
        <input
          ref={fileInputRef}
          className="hidden-file-input"
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif,application/pdf,text/plain,audio/mpeg,audio/mp4,audio/webm,video/mp4,video/webm"
          onChange={(event) => void attach(event)}
        />
        <button
          type="button"
          className={`attach-button ${uploadProgress !== null ? "is-uploading" : ""}`}
          aria-label="Attach file"
          disabled={uploadProgress !== null || recording}
          onClick={() => void chooseAttachment()}
        >
          {uploadProgress === null ? "+" : `${uploadProgress}%`}
        </button>
        <textarea
          ref={textareaRef}
          aria-label="Message"
          value={body}
          onChange={(e) => updateTyping(e.target.value)}
          rows={1}
          maxLength={20000}
          placeholder={recording ? `Recording ${formatDuration(recordSeconds)}` : editingMessage ? "Edit message" : "Message"}
          disabled={recording}
        />
        <button type="button" className={`voice-button ${recording ? "recording" : ""}`} onClick={() => void toggleRecording()} aria-label={recording ? "Stop recording" : requestingMic ? "Requesting microphone" : "Record voice message"} disabled={!recording && (requestingMic || uploadProgress !== null)}>
          {recording ? "Stop" : requestingMic ? "…" : "Mic"}
        </button>
        <button type="submit" aria-label={editingMessage ? "Save" : "Send"} disabled={!body.trim() || recording}>{editingMessage ? "Save" : "Send"}</button>
      </form>
    </section>
  );
}

function MessageBubble({
  message,
  own,
  replyMessage,
  peerReads,
  senderName,
  onReply,
  onToggleActions,
}: {
  message: Message;
  own: boolean;
  replyMessage: Message | null;
  peerReads: readonly number[];
  senderName: string | null;
  onReply: () => void;
  onToggleActions: () => void;
}) {
  const deleted = Boolean(message.deleted_at);
  return (
    <div className={`message-row ${own ? "own" : ""}`}>
      <div className="message-bubble-wrap">
        <MessageInteraction disabled={deleted} onActions={onToggleActions} onReply={onReply}>
        <div className={`message-bubble ${deleted ? "deleted" : ""}`}>
          {senderName ? <strong className="message-sender">{senderName}</strong> : null}
          {replyMessage ? <div className="reply-preview">{previewMessage(replyMessage)}</div> : null}
          {deleted ? <p>Message deleted</p> : (
            <>
              {message.assets.map((asset) => <ProtectedAttachment key={asset.id} asset={asset} voice={message.type === "voice"} />)}
              {message.body && (message.type === "text" || message.assets.length === 0) ? <p>{message.body}</p> : null}
            </>
          )}
          {message.reactions.length > 0 ? (
            <div className="reaction-row">
              {message.reactions.map((reaction) => <span key={reaction.emoji}>{reaction.emoji} {reaction.user_ids.length}</span>)}
            </div>
          ) : null}
          <MessageMeta createdAt={message.created_at} sequence={message.sequence} own={own} peerReads={peerReads} edited={Boolean(message.edited_at)} />
        </div>
        </MessageInteraction>
        {!deleted ? <button className="message-more-button" type="button" onClick={onToggleActions} aria-label="Message actions" aria-haspopup="dialog">•••</button> : null}
      </div>
    </div>
  );
}

function applyReaction(messages: Message[], messageId: string, userId: string, emoji: string, active: boolean): Message[] {
  return messages.map((message) => {
    if (message.id !== messageId) return message;
    const reactions = message.reactions.map((reaction) => ({ ...reaction, user_ids: [...reaction.user_ids] }));
    const existing = reactions.find((reaction) => reaction.emoji === emoji);
    if (active) {
      if (existing) {
        if (!existing.user_ids.includes(userId)) existing.user_ids.push(userId);
      } else {
        reactions.push({ emoji, user_ids: [userId] });
      }
    } else if (existing) {
      existing.user_ids = existing.user_ids.filter((id) => id !== userId);
    }
    return { ...message, reactions: reactions.filter((reaction) => reaction.user_ids.length > 0) };
  });
}

function previewMessage(message: Message): string {
  if (message.deleted_at) return "Deleted message";
  if (message.type === "voice") return "Voice message";
  if (message.type === "image") return "Photo";
  if (message.type === "file") return message.assets[0]?.filename ?? "File";
  return (message.body ?? "Message").slice(0, 80);
}

function mergeMessages(current: Message[], incoming: Message[]): Message[] {
  const map = new Map<string, Message>();
  for (const message of current) map.set(message.id, message);
  for (const message of incoming) map.set(message.id, message);
  return [...map.values()].sort((a, b) => a.sequence - b.sequence);
}
