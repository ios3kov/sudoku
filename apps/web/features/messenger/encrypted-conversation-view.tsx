"use client";

import type { ProjectedEncryptedMessage } from "@sudoku/domain";
import {
  ChangeEvent,
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { messengerApi } from "./api";
import { EncryptedAttachment, isEncryptedAttachmentMetadata } from "./encrypted-attachment";
import type { OpenMlsProtocolAdapter } from "./crypto/openmls-adapter";
import type { Conversation, CurrentUser, RealtimeEvent } from "./types";
import { uploadEncryptedAsset } from "./uploads";
import { GroupSettings } from "./group-settings";
import { SecurityVerification } from "./security-verification";
import {
  MAX_VOICE_SECONDS,
  conversationTitle,
  findSupportedVoiceMime,
  formatDuration,
  normalizeVoiceMime,
  voiceFileExtension,
} from "./chat-utils";

const INITIAL_VISIBLE_MESSAGES = 120;

export function EncryptedConversationView({
  conversation,
  user,
  adapter,
  realtimeEvent,
  reconnectTick,
  onBack,
  onHide,
  onConversationUpdated,
  onConversationLeft,
}: {
  conversation: Conversation;
  user: CurrentUser;
  adapter: OpenMlsProtocolAdapter;
  realtimeEvent: RealtimeEvent | null;
  reconnectTick: number;
  onBack: () => void;
  onHide: () => void;
  onConversationUpdated: (conversation: Conversation) => void;
  onConversationLeft: () => void;
}) {
  const [messages, setMessages] = useState<ProjectedEncryptedMessage[]>([]);
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncBlocked, setSyncBlocked] = useState(true);
  const [queuedCount, setQueuedCount] = useState(0);
  const [replyingToId, setReplyingToId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [actionMessageId, setActionMessageId] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [showGroupSettings, setShowGroupSettings] = useState(false);
  const [showSecurity, setShowSecurity] = useState(false);
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_MESSAGES);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<number | null>(null);
  const recordStopTimerRef = useRef<number | null>(null);
  const lastEventRef = useRef<RealtimeEvent | null>(null);

  const refreshProjection = useCallback(async () => {
    try {
      await adapter.syncTransport(conversation.id);
      const projection = adapter.projectConversation(conversation.id);
      setMessages(projection.messages);
      setSyncBlocked(false);
      setQueuedCount(adapter.pendingApplicationCount(conversation.id));
      if (projection.rejectedEventIds.length > 0) {
        setError("Some encrypted updates were rejected");
      }
      const latest = Math.max(
        conversation.latest_sequence,
        ...projection.messages.map((message) => message.sequence),
        0,
      );
      if (latest > 0) {
        await messengerApi.markRead(conversation.id, latest).catch(() => undefined);
      }
    } catch {
      setSyncBlocked(true);
      setError("Secure sync is blocked");
      setQueuedCount(adapter.pendingApplicationCount(conversation.id));
    } finally {
      setLoading(false);
    }
  }, [adapter, conversation.id, conversation.latest_sequence]);

  useEffect(() => {
    setLoading(true);
    setMessages([]);
    setBody("");
    setReplyingToId(null);
    setEditingId(null);
    setActionMessageId(null);
    setVisibleCount(INITIAL_VISIBLE_MESSAGES);
    setError(null);
    setSyncBlocked(true);
    void refreshProjection();
  }, [conversation.id, refreshProjection]);

  useEffect(() => {
    if (reconnectTick > 0) void refreshProjection();
  }, [reconnectTick, refreshProjection]);

  useEffect(() => {
    if (!realtimeEvent || realtimeEvent === lastEventRef.current) return;
    lastEventRef.current = realtimeEvent;
    if (realtimeEvent.conversation_id !== conversation.id) return;
    if (
      realtimeEvent.type === "message.created"
      || realtimeEvent.type === "mls.control.created"
    ) {
      void refreshProjection();
    }
  }, [conversation.id, realtimeEvent, refreshProjection]);

  useEffect(() => {
    const handleOnline = () => void refreshProjection();
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [refreshProjection]);

  useEffect(() => {
    if (!stickToBottomRef.current) return;
    bottomRef.current?.scrollIntoView({
      behavior: messages.length > INITIAL_VISIBLE_MESSAGES ? "smooth" : "auto",
      block: "end",
    });
  }, [messages, queuedCount]);

  const handleMessageScroll = useCallback(() => {
    const node = messageListRef.current;
    if (!node) return;
    const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 96;
  }, []);

  useEffect(() => () => {
    if (recordTimerRef.current !== null) window.clearInterval(recordTimerRef.current);
    if (recordStopTimerRef.current !== null) window.clearTimeout(recordStopTimerRef.current);
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.onerror = null;
      recorder.stop();
    }
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const replyingTo = useMemo(
    () => messages.find((message) => message.id === replyingToId) ?? null,
    [messages, replyingToId],
  );
  const editing = useMemo(
    () => messages.find((message) => message.id === editingId) ?? null,
    [messages, editingId],
  );
  const visibleMessages = useMemo(
    () => messages.slice(Math.max(0, messages.length - visibleCount)),
    [messages, visibleCount],
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = body.trim();
    if (!text || busy || syncBlocked) return;
    setBusy(true);
    setError(null);

    try {
      if (editing) {
        await adapter.sendEditDurably(conversation.id, editing.id, text);
      } else {
        await adapter.sendMessageDurably({
          conversationId: conversation.id,
          messageType: "text",
          body: text,
          replyTo: replyingTo?.id ?? null,
          assetIds: [],
          attachments: [],
        });
      }
      setBody("");
      setEditingId(null);
      setReplyingToId(null);
      await refreshProjection();
    } catch {
      const pending = adapter.pendingApplicationCount(conversation.id);
      setQueuedCount(pending);
      if (pending > 0 && !editing) {
        setBody("");
        setReplyingToId(null);
        setError("Encrypted message queued for retry");
      } else {
        setError("Unable to send encrypted update");
      }
    } finally {
      setBusy(false);
    }
  }


  async function attach(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || busy || syncBlocked) return;
    setError(null);
    if (!navigator.onLine) {
      setError("Encrypted attachments require a connection");
      return;
    }

    setBusy(true);
    setUploadProgress(0);
    try {
      const uploaded = await uploadEncryptedAsset(file, setUploadProgress);
      const messageType = file.type.startsWith("image/") ? "image" : "file";
      await adapter.sendMessageDurably({
        conversationId: conversation.id,
        messageType,
        body: null,
        replyTo: replyingTo?.id ?? null,
        assetIds: [uploaded.asset.id],
        attachments: [uploaded.metadata],
      });
      setReplyingToId(null);
      await refreshProjection();
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "Encrypted attachment failed",
      );
      setQueuedCount(adapter.pendingApplicationCount(conversation.id));
    } finally {
      setUploadProgress(null);
      setBusy(false);
    }
  }

  async function toggleRecording() {
    if (recording) {
      mediaRecorderRef.current?.stop();
      return;
    }
    if (busy || syncBlocked) return;
    setError(null);
    if (!navigator.onLine) {
      setError("Encrypted voice notes require a connection");
      return;
    }
    if (!("MediaRecorder" in window) || !navigator.mediaDevices?.getUserMedia) {
      setError("Voice recording is not supported on this device");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const supportedMime = findSupportedVoiceMime();
      const recorder = supportedMime
        ? new MediaRecorder(stream, { mimeType: supportedMime })
        : new MediaRecorder(stream);
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
        stopRecorderResources();
        setRecording(false);
      };
      recorder.onstop = () => {
        const chunks = [...recordChunksRef.current];
        stopRecorderResources();
        setRecording(false);
        if (chunks.length > 0) void uploadVoice(chunks, baseMime);
      };
      recorder.start(250);
      recordTimerRef.current = window.setInterval(
        () => setRecordSeconds((seconds) => seconds + 1),
        1000,
      );
      recordStopTimerRef.current = window.setTimeout(
        () => recorder.stop(),
        MAX_VOICE_SECONDS * 1000,
      );
    } catch {
      stopRecorderResources();
      setRecording(false);
      setError("Microphone permission is required for voice notes");
    }
  }

  async function uploadVoice(chunks: Blob[], mimeType: string) {
    setBusy(true);
    setUploadProgress(0);
    try {
      const extension = voiceFileExtension(mimeType);
      const file = new File(chunks, `voice-${Date.now()}.${extension}`, {
        type: mimeType,
      });
      const uploaded = await uploadEncryptedAsset(file, setUploadProgress);
      await adapter.sendMessageDurably({
        conversationId: conversation.id,
        messageType: "voice",
        body: null,
        replyTo: replyingTo?.id ?? null,
        assetIds: [uploaded.asset.id],
        attachments: [uploaded.metadata],
      });
      setReplyingToId(null);
      await refreshProjection();
    } catch (voiceError) {
      setError(
        voiceError instanceof Error
          ? voiceError.message
          : "Encrypted voice note failed",
      );
      setQueuedCount(adapter.pendingApplicationCount(conversation.id));
    } finally {
      setUploadProgress(null);
      setBusy(false);
    }
  }

  function stopRecorderResources() {
    if (recordTimerRef.current !== null) window.clearInterval(recordTimerRef.current);
    if (recordStopTimerRef.current !== null) window.clearTimeout(recordStopTimerRef.current);
    recordTimerRef.current = null;
    recordStopTimerRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    mediaRecorderRef.current = null;
  }


  async function toggleReaction(message: ProjectedEncryptedMessage, emoji: string) {
    if (busy || syncBlocked || message.deleted) return;
    setBusy(true);
    setError(null);
    try {
      const active = message.reactions.some(
        (reaction) =>
          reaction.emoji === emoji && reaction.userIds.includes(user.id),
      );
      await adapter.sendReactionDurably(
        conversation.id,
        message.id,
        emoji,
        !active,
      );
      await refreshProjection();
    } catch {
      setError("Unable to update encrypted reaction");
    } finally {
      setBusy(false);
      setActionMessageId(null);
    }
  }

  async function deleteMessage(message: ProjectedEncryptedMessage) {
    if (busy || syncBlocked || message.deleted || message.senderId !== user.id) return;
    setBusy(true);
    setError(null);
    try {
      await adapter.sendDeleteDurably(conversation.id, message.id);
      if (editingId === message.id) {
        setEditingId(null);
        setBody("");
      }
      if (replyingToId === message.id) setReplyingToId(null);
      await refreshProjection();
    } catch {
      setError("Unable to delete encrypted message");
    } finally {
      setBusy(false);
      setActionMessageId(null);
    }
  }

  function beginEdit(message: ProjectedEncryptedMessage) {
    if (syncBlocked || message.senderId !== user.id || message.deleted) return;
    setEditingId(message.id);
    setReplyingToId(null);
    setBody(message.body ?? "");
    setActionMessageId(null);
  }

  return (
    <section className="conversation-view">
      <header className="messenger-topbar">
        <div className="conversation-header-copy">
          <button className="back-button" type="button" onClick={onBack} aria-label="Back to conversations">←</button>
          <div>
            <strong>{conversationTitle(conversation, user.id)}</strong>
            <span>End-to-end encrypted</span>
          </div>
        </div>
        <div>
          {conversation.type === "group" ? (
            <button type="button" onClick={() => setShowGroupSettings((value) => !value)}>
              Group
            </button>
          ) : null}
          <button type="button" onClick={() => setShowSecurity((value) => !value)}>
            Verify
          </button>
          <button type="button" onClick={onHide}>Hide</button>
        </div>
      </header>

      {showGroupSettings ? (
        <GroupSettings
          conversation={conversation}
          user={user}
          adapter={adapter}
          onUpdated={onConversationUpdated}
          onLeft={onConversationLeft}
          onClose={() => setShowGroupSettings(false)}
        />
      ) : null}
      {showSecurity ? (
        <SecurityVerification
          conversation={conversation}
          user={user}
          adapter={adapter}
          onClose={() => setShowSecurity(false)}
        />
      ) : null}

      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {queuedCount > 0 ? (
        <p className="muted center">
          {queuedCount} encrypted update{queuedCount === 1 ? "" : "s"} queued
        </p>
      ) : null}

      <div
        className="message-list"
        ref={messageListRef}
        onScroll={handleMessageScroll}
      >
        {loading ? <p className="muted center">Decrypting…</p> : messages.length === 0 ? (
          <div className="empty-conversations">
            <div className="empty-icon" aria-hidden="true">•••</div>
            <h2>No encrypted messages yet</h2>
            <p>Messages are decrypted only on this device.</p>
          </div>
        ) : (
          <>
            {messages.length > visibleCount ? (
              <button
                className="load-earlier-button"
                type="button"
                onClick={() => setVisibleCount((count) => count + INITIAL_VISIBLE_MESSAGES)}
              >
                Show earlier messages
              </button>
            ) : null}
            {visibleMessages.map((message) => {
          const own = message.senderId === user.id;
          const reply = message.replyTo
            ? messages.find((candidate) => candidate.id === message.replyTo) ?? null
            : null;
          const readLabel = own
            ? encryptedReadReceipt(conversation, user.id, message.sequence)
            : null;

          return (
            <div key={message.id} className={`message-row ${own ? "own" : ""}`}>
              <div className="message-bubble-wrap">
                <div className={`message-bubble ${message.deleted ? "deleted" : ""}`}>
                  {reply ? <div className="reply-preview">{encryptedPreview(reply)}</div> : null}
                  {message.deleted ? <p>Message deleted</p> : (
                    <>
                      {message.body ? <p>{message.body}</p> : null}
                      {message.attachments.length > 0 ? (
                        <div className="encrypted-attachments">
                          {message.attachments.map((raw, index) => {
                            const metadata = isEncryptedAttachmentMetadata(raw) ? raw : null;
                            if (
                              !metadata
                              || metadata.assetId !== message.assetIds[index]
                              || !["image", "file", "voice"].includes(message.messageType)
                            ) {
                              return (
                                <div className="file-attachment" key={`invalid-${index}`}>
                                  <strong>Encrypted attachment unavailable</strong>
                                </div>
                              );
                            }
                            return (
                              <EncryptedAttachment
                                key={metadata.assetId}
                                metadata={metadata}
                                messageType={message.messageType as "image" | "file" | "voice"}
                              />
                            );
                          })}
                        </div>
                      ) : null}
                    </>
                  )}
                  {message.reactions.length > 0 ? (
                    <div className="reaction-row">
                      {message.reactions.map((reaction) => (
                        <span key={reaction.emoji}>
                          {reaction.emoji} {reaction.userIds.length}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <small className="message-time">
                    #{message.sequence}
                    {message.edited ? " · edited" : ""}
                    {readLabel ? ` · ${readLabel}` : ""}
                  </small>
                </div>
                {!message.deleted ? (
                  <button
                    className="message-more-button"
                    type="button"
                    onClick={() => setActionMessageId((current) =>
                      current === message.id ? null : message.id
                    )}
                    aria-label="Encrypted message actions"
                  >
                    •••
                  </button>
                ) : null}
              </div>

              {actionMessageId === message.id && !message.deleted ? (
                <div className="message-actions">
                  <button type="button" onClick={() => {
                    setReplyingToId(message.id);
                    setEditingId(null);
                    setActionMessageId(null);
                  }}>Reply</button>
                  {own ? (
                    <button type="button" onClick={() => beginEdit(message)}>Edit</button>
                  ) : null}
                  {["👍", "❤️", "😂"].map((emoji) => (
                    <button
                      type="button"
                      key={emoji}
                      onClick={() => void toggleReaction(message, emoji)}
                    >
                      {emoji}
                    </button>
                  ))}
                  {own ? (
                    <button type="button" onClick={() => void deleteMessage(message)}>Delete</button>
                  ) : null}
                </div>
              ) : null}
            </div>
              );
            })}
          </>
        )}
        <div ref={bottomRef} />
      </div>

      {replyingTo ? (
        <div className="reply-compose-preview">
          <span>Replying to {encryptedPreview(replyingTo)}</span>
          <button type="button" onClick={() => setReplyingToId(null)} aria-label="Cancel reply">×</button>
        </div>
      ) : null}
      {editing ? (
        <div className="reply-compose-preview">
          <span>Editing encrypted message</span>
          <button type="button" aria-label="Cancel edit" onClick={() => {
            setEditingId(null);
            setBody("");
          }}>×</button>
        </div>
      ) : null}

      <form className="composer" onSubmit={submit}>
        <input
          ref={fileInputRef}
          className="hidden-file-input"
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif,application/pdf,text/plain,audio/mpeg,audio/mp4,audio/webm,video/mp4,video/webm"
          onChange={(event) => void attach(event)}
        />
        <button
          type="button"
          className="attach-button"
          aria-label="Attach encrypted file"
          disabled={busy || syncBlocked || recording || uploadProgress !== null}
          onClick={() => fileInputRef.current?.click()}
        >
          {uploadProgress === null ? "+" : `${uploadProgress}%`}
        </button>
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={1}
          maxLength={20000}
          placeholder={recording ? `Recording ${formatDuration(recordSeconds)}` : editing ? "Edit encrypted message" : "Message"}
          disabled={busy || syncBlocked || recording}
        />
        <button
          type="button"
          className={`voice-button ${recording ? "recording" : ""}`}
          onClick={() => void toggleRecording()}
          disabled={busy || syncBlocked || uploadProgress !== null}
        >
          {recording ? "Stop" : "Mic"}
        </button>
        <button type="submit" disabled={!body.trim() || busy || syncBlocked || recording || uploadProgress !== null}>
          {busy ? "…" : editing ? "Save" : "Send"}
        </button>
      </form>
    </section>
  );
}

function encryptedPreview(message: ProjectedEncryptedMessage): string {
  if (message.deleted) return "Deleted message";
  if (message.messageType === "voice") return "Voice message";
  if (message.messageType === "image") return "Photo";
  if (message.messageType === "file") return "Encrypted file";
  return (message.body ?? "Message").slice(0, 80);
}

function encryptedReadReceipt(
  conversation: Conversation,
  currentUserId: string,
  sequence: number,
): string | null {
  const others = conversation.members.filter((member) => member.id !== currentUserId);
  if (!others.length) return null;
  const readCount = others.filter(
    (member) => member.last_read_sequence >= sequence,
  ).length;
  if (readCount === 0) return null;
  if (conversation.type === "direct") return "Read";
  return `${readCount} read`;
}


function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}
