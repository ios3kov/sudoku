"use client";

import type { ProjectedEncryptedMessage } from "@sudoku/domain";
import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { messengerApi } from "./api";
import type { OpenMlsProtocolAdapter } from "./crypto/openmls-adapter";
import type { Conversation, CurrentUser, RealtimeEvent } from "./types";
import { conversationTitle } from "./conversation-view";

export function EncryptedConversationView({
  conversation,
  user,
  adapter,
  realtimeEvent,
  reconnectTick,
  onBack,
  onHide,
}: {
  conversation: Conversation;
  user: CurrentUser;
  adapter: OpenMlsProtocolAdapter;
  realtimeEvent: RealtimeEvent | null;
  reconnectTick: number;
  onBack: () => void;
  onHide: () => void;
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
  const bottomRef = useRef<HTMLDivElement | null>(null);
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
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, queuedCount]);

  const replyingTo = useMemo(
    () => messages.find((message) => message.id === replyingToId) ?? null,
    [messages, replyingToId],
  );
  const editing = useMemo(
    () => messages.find((message) => message.id === editingId) ?? null,
    [messages, editingId],
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
          <button className="back-button" type="button" onClick={onBack}>←</button>
          <div>
            <strong>{conversationTitle(conversation, user.id)}</strong>
            <span>End-to-end encrypted</span>
          </div>
        </div>
        <button type="button" onClick={onHide}>Hide</button>
      </header>

      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {queuedCount > 0 ? (
        <p className="muted center">
          {queuedCount} encrypted update{queuedCount === 1 ? "" : "s"} queued
        </p>
      ) : null}

      <div className="message-list">
        {loading ? <p className="muted center">Decrypting…</p> : messages.length === 0 ? (
          <div className="empty-conversations">
            <div className="empty-icon" aria-hidden="true">•••</div>
            <h2>No encrypted messages yet</h2>
            <p>Messages are decrypted only on this device.</p>
          </div>
        ) : messages.map((message) => {
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
                      {message.assetIds.length > 0 ? (
                        <small>Encrypted attachment · {message.assetIds.length}</small>
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
        <div ref={bottomRef} />
      </div>

      {replyingTo ? (
        <div className="reply-compose-preview">
          <span>Replying to {encryptedPreview(replyingTo)}</span>
          <button type="button" onClick={() => setReplyingToId(null)}>×</button>
        </div>
      ) : null}
      {editing ? (
        <div className="reply-compose-preview">
          <span>Editing encrypted message</span>
          <button type="button" onClick={() => {
            setEditingId(null);
            setBody("");
          }}>×</button>
        </div>
      ) : null}

      <form className="composer" onSubmit={submit}>
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={1}
          maxLength={20000}
          placeholder={editing ? "Edit encrypted message" : "Message"}
          disabled={busy || syncBlocked}
        />
        <button type="submit" disabled={!body.trim() || busy || syncBlocked}>
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
