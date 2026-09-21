"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { messengerApi } from "./api";
import { enqueuePending, listPending, removePending } from "./outbox";
import type { RealtimeClient } from "./realtime";
import type { Conversation, CurrentUser, Message, PendingMessage, RealtimeEvent } from "./types";
import { uploadAsset } from "./uploads";
import { GroupSettings } from "./group-settings";
import { ConversationPreferences } from "./conversation-preferences";
import { MessageSearch } from "./message-search";
import { ConversationHeader } from "./conversation-header";
import { useAutosizeTextarea } from "./use-autosize-textarea";
import {
  MAX_VOICE_SECONDS,
  conversationTitle,
  findSupportedVoiceMime,
  formatBytes,
  formatDuration,
  normalizeVoiceMime,
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
  onConversationLeft: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());
  const [online, setOnline] = useState(true);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [actionMessageId, setActionMessageId] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [showGroupSettings, setShowGroupSettings] = useState(false);
  const [showPreferences, setShowPreferences] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [highlightedSequence, setHighlightedSequence] = useState<number | null>(null);

  const typingTimer = useRef<number | null>(null);
  const remoteTypingTimers = useRef<Map<string, number>>(new Map());
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<number | null>(null);
  const recordStopTimerRef = useRef<number | null>(null);
  const lastProcessedEventRef = useRef<RealtimeEvent | null>(null);
  const scrollTargetSequenceRef = useRef<number | null>(null);
  const highlightTimerRef = useRef<number | null>(null);

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
        setPending(queued.filter((item) => item.conversation_id === conversation.id));
        const latest = history.at(-1)?.sequence ?? 0;
        if (latest > 0) void messengerApi.markRead(conversation.id, latest).catch(() => undefined);
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
    const targetSequence = scrollTargetSequenceRef.current;
    if (targetSequence !== null) {
      requestAnimationFrame(() => {
        document.querySelector<HTMLElement>(`[data-message-sequence="${targetSequence}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      scrollTargetSequenceRef.current = null;
      return;
    }
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, pending]);

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
      stopRecorderResources(true);
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
        void messengerApi.markRead(conversation.id, message.sequence).catch(() => undefined);
        onConversationUpdated({
          ...conversation,
          latest_sequence: Math.max(conversation.latest_sequence, message.sequence),
          last_read_sequence: Math.max(conversation.last_read_sequence, message.sequence),
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

    if (realtimeEvent.type === "receipt.updated" && realtimeEvent.payload) {
      const payload = realtimeEvent.payload as { user_id?: string; last_read_sequence?: number };
      if (payload.user_id && typeof payload.last_read_sequence === "number") {
        const nextConversation = {
          ...conversation,
          members: conversation.members.map((member) =>
            member.id === payload.user_id
              ? { ...member, last_read_sequence: Math.max(member.last_read_sequence, payload.last_read_sequence!) }
              : member,
          ),
        };
        onConversationUpdated(nextConversation);
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
        void messengerApi.markRead(conversation.id, latest).catch(() => undefined);
        onConversationUpdated({
          ...conversation,
          latest_sequence: Math.max(conversation.latest_sequence, latest),
          last_read_sequence: latest,
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
          setError("Message could not be queued");
        }
      } else {
        setPending((current) => current.filter((item) => item.client_id !== local.client_id));
        setError("Message was rejected");
      }
    }
  }

  async function attach(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
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
    textareaRef.current?.focus();
  }

  function beginEdit(message: Message) {
    if (!message.body || message.type !== "text") return;
    setReplyingTo(null);
    setEditingMessage(message);
    setBody(message.body);
    setActionMessageId(null);
    window.setTimeout(() => textareaRef.current?.focus(), 0);
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

  async function toggleRecording() {
    if (recording) {
      mediaRecorderRef.current?.stop();
      return;
    }
    setError(null);
    if (!navigator.onLine) {
      setError("Voice notes require a connection");
      return;
    }
    if (!("MediaRecorder" in window) || !navigator.mediaDevices?.getUserMedia) {
      setError("Voice recording is not supported on this device");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const supportedMime = findSupportedVoiceMime();
      const recorder = supportedMime ? new MediaRecorder(stream, { mimeType: supportedMime }) : new MediaRecorder(stream);
      const baseMime = normalizeVoiceMime(recorder.mimeType || supportedMime || "");
      if (!baseMime || !["audio/mp4", "audio/webm"].includes(baseMime)) {
        stream.getTracks().forEach((track) => track.stop());
        setError("This browser records an unsupported audio format");
        return;
      }

      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      recordChunksRef.current = [];
      setRecordSeconds(0);
      setRecording(true);

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordChunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        setError("Voice recording failed");
        stopRecorderResources(true);
        setRecording(false);
      };
      recorder.onstop = () => {
        const chunks = [...recordChunksRef.current];
        const mime = baseMime;
        stopRecorderResources();
        setRecording(false);
        if (!chunks.length) return;
        void uploadVoice(chunks, mime);
      };
      recorder.start(250);
      recordTimerRef.current = window.setInterval(() => setRecordSeconds((seconds) => seconds + 1), 1000);
      recordStopTimerRef.current = window.setTimeout(() => recorder.stop(), MAX_VOICE_SECONDS * 1000);
    } catch {
      setError("Microphone permission is required for voice notes");
      stopRecorderResources();
      setRecording(false);
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

  function stopRecorderResources(discard = false) {
    const recorder = mediaRecorderRef.current;
    if (discard && recorder && recorder.state !== "inactive") {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.onerror = null;
      recorder.stop();
    }
    if (recordTimerRef.current !== null) window.clearInterval(recordTimerRef.current);
    if (recordStopTimerRef.current !== null) window.clearTimeout(recordStopTimerRef.current);
    recordTimerRef.current = null;
    recordStopTimerRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    mediaRecorderRef.current = null;
    recordChunksRef.current = [];
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
      void messengerApi.markRead(conversation.id, target.sequence).catch(() => undefined);
      onConversationUpdated({
        ...conversation,
        last_read_sequence: Math.max(conversation.last_read_sequence, target.sequence),
      });
      if (highlightTimerRef.current !== null) window.clearTimeout(highlightTimerRef.current);
      highlightTimerRef.current = window.setTimeout(() => setHighlightedSequence(null), 1800);
    } catch {
      setError("Unable to open search result");
    }
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

      <div className="message-list" aria-live="polite">
        {loading ? <p className="muted center">Loading…</p> : null}
        {error ? <p className="form-error center">{error}</p> : null}
        {!loading && !error && messages.length === 0 && pending.length === 0 ? (
          <div className="empty-conversations compact chat-empty-state">
            <div className="empty-icon" aria-hidden="true">•••</div>
            <h2>No messages yet</h2>
            <p>Send the first message when you are ready.</p>
          </div>
        ) : null}
        {messages.map((message) => {
          const replyMessage = message.reply_to ? messages.find((candidate) => candidate.id === message.reply_to) ?? null : null;
          const actionsOpen = actionMessageId === message.id;
          return (
            <div
              className={`message-stack ${message.sender_id === user.id ? "own" : ""} ${highlightedSequence === message.sequence ? "search-hit" : ""}`}
              data-message-sequence={message.sequence}
              key={message.id}
            >
              <MessageBubble
                message={message}
                own={message.sender_id === user.id}
                replyMessage={replyMessage}
                readLabel={message.sender_id === user.id ? readReceiptLabel(conversation, user.id, message.sequence) : null}
                onToggleActions={() => setActionMessageId(actionsOpen ? null : message.id)}
              />
              {actionsOpen && !message.deleted_at ? (
                <div className="message-actions">
                  <button type="button" onClick={() => beginReply(message)}>Reply</button>
                  <button type="button" onClick={() => void toggleHeart(message)}>❤️</button>
                  {message.sender_id === user.id && message.type === "text" ? <button type="button" onClick={() => beginEdit(message)}>Edit</button> : null}
                  {message.sender_id === user.id ? <button type="button" onClick={() => void removeMessage(message)}>Delete</button> : null}
                </div>
              ) : null}
            </div>
          );
        })}
        {pending.map((message) => (
          <div className="message-row own" key={message.client_id}>
            <div className="message-bubble pending"><p>{message.body}</p><small>Sending…</small></div>
          </div>
        ))}
        {typingUsers.size > 0 ? <div className="typing-indicator">typing…</div> : null}
        <div ref={bottomRef} />
      </div>

      {replyingTo || editingMessage ? (
        <div className="composer-context">
          <span>{editingMessage ? "Editing message" : `Replying to ${previewMessage(replyingTo!)}`}</span>
          <button type="button" onClick={() => { setReplyingTo(null); setEditingMessage(null); if (editingMessage) setBody(""); }}>×</button>
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
          onClick={() => fileInputRef.current?.click()}
        >
          {uploadProgress === null ? "+" : `${uploadProgress}%`}
        </button>
        <textarea
          ref={textareaRef}
          value={body}
          onChange={(e) => updateTyping(e.target.value)}
          rows={1}
          maxLength={20000}
          placeholder={recording ? `Recording ${formatDuration(recordSeconds)}` : editingMessage ? "Edit message" : "Message"}
          disabled={recording}
        />
        <button type="button" className={`voice-button ${recording ? "recording" : ""}`} onClick={() => void toggleRecording()} disabled={uploadProgress !== null}>
          {recording ? "Stop" : "Mic"}
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
  readLabel,
  onToggleActions,
}: {
  message: Message;
  own: boolean;
  replyMessage: Message | null;
  readLabel: string | null;
  onToggleActions: () => void;
}) {
  const deleted = Boolean(message.deleted_at);
  return (
    <div className={`message-row ${own ? "own" : ""}`}>
      <div className="message-bubble-wrap">
        <div className={`message-bubble ${deleted ? "deleted" : ""}`}>
          {replyMessage ? <div className="reply-preview">{previewMessage(replyMessage)}</div> : null}
          {deleted ? <p>Message deleted</p> : (
            <>
              {message.assets.map((asset) => asset.mime_type.startsWith("image/") ? (
                <a className="image-attachment" href={asset.content_url} target="_blank" rel="noreferrer" key={asset.id}>
                  <img src={asset.content_url} alt={asset.filename} loading="lazy" />
                </a>
              ) : message.type === "voice" && asset.mime_type.startsWith("audio/") ? (
                <div className="voice-attachment" key={asset.id}>
                  <audio controls preload="metadata" src={asset.content_url} />
                </div>
              ) : (
                <a className="file-attachment" href={asset.content_url} target="_blank" rel="noreferrer" key={asset.id}>
                  <span>File</span>
                  <strong>{asset.filename}</strong>
                  <small>{formatBytes(asset.size_bytes)}</small>
                </a>
              ))}
              {message.body && (message.type === "text" || message.assets.length === 0) ? <p>{message.body}</p> : null}
            </>
          )}
          {message.reactions.length > 0 ? (
            <div className="reaction-row">
              {message.reactions.map((reaction) => <span key={reaction.emoji}>{reaction.emoji} {reaction.user_ids.length}</span>)}
            </div>
          ) : null}
          <small className="message-time">
            {new Date(message.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            {message.edited_at ? " · edited" : ""}
            {readLabel ? ` · ${readLabel}` : ""}
          </small>
        </div>
        {!deleted ? <button className="message-more-button" type="button" onClick={onToggleActions} aria-label="Message actions">•••</button> : null}
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

function readReceiptLabel(conversation: Conversation, currentUserId: string, sequence: number): string | null {
  const others = conversation.members.filter((member) => member.id !== currentUserId);
  if (!others.length) return null;
  const readCount = others.filter((member) => member.last_read_sequence >= sequence).length;
  if (readCount === 0) return null;
  if (conversation.type === "direct") return "Read";
  return `${readCount} read`;
}

function mergeMessages(current: Message[], incoming: Message[]): Message[] {
  const map = new Map<string, Message>();
  for (const message of current) map.set(message.id, message);
  for (const message of incoming) map.set(message.id, message);
  return [...map.values()].sort((a, b) => a.sequence - b.sequence);
}
