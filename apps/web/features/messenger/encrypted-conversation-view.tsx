"use client";

import { MAX_AUTO_SEND_RETRY_ATTEMPTS, sendFailureKind, sendRetryDelayMs, type ProjectedEncryptedMessage } from "@sudoku/domain";
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
import type { RealtimeClient } from "./realtime";
import type { Conversation, CurrentUser, RealtimeEvent, VoiceAttachmentPresentation } from "./types";
import { uploadEncryptedAsset } from "./uploads";
import { NATIVE_MEDIA_READY_EVENT, nativeMediaAvailable, pickNativeAttachment } from "./native-media-access";
import { GroupSettings } from "./group-settings";
import { SecurityVerification } from "./security-verification";
import { ConversationHeader } from "./conversation-header";
import { useVoiceRecorder } from "./use-voice-recorder";
import { useTypingPresence } from "./use-typing-presence";
import { analyzeVoiceBlob } from "./voice-analysis";
import { VoiceDraftPreview } from "./voice-waveform";
import { useAutosizeTextarea } from "./use-autosize-textarea";
import { createRefreshQueue } from "./refresh-queue";
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

const INITIAL_VISIBLE_MESSAGES = 120;

function sendFailureForError(error: unknown): "transient" | "permanent" {
  if (error && typeof error === "object" && "status" in error) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599) {
      return sendFailureKind(status);
    }
  }
  return sendFailureKind(null);
}

export function EncryptedConversationView({
  conversation,
  user,
  adapter,
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
  adapter: OpenMlsProtocolAdapter;
  realtime: RealtimeClient | null;
  realtimeEvent: RealtimeEvent | null;
  reconnectTick: number;
  onBack: () => void;
  onHide: () => void;
  onConversationUpdated: (conversation: Conversation) => void;
  onReadAcknowledged: (conversationId: string, sequence: number) => void;
  onConversationLeft: () => void;
}) {
  const [messages, setMessages] = useState<ProjectedEncryptedMessage[]>([]);
  const [draft, setDraft] = useConversationDraft(conversation.id);
  const [editBody, setEditBody] = useState("");
  const [sendingPreview, setSendingPreview] = useState<{ id: string; body: string; phase: "encrypting" | "sending" } | null>(null);
  const [queuedMessages, setQueuedMessages] = useState<ReturnType<OpenMlsProtocolAdapter["pendingApplicationMessages"]>>([]);
  const [failedQueuedIds, setFailedQueuedIds] = useState<string[]>([]);
  const [autoRetryQueuedId, setAutoRetryQueuedId] = useState<string | null>(null);
  const [retryingQueuedId, setRetryingQueuedId] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);
  const [readSequence, setReadSequence] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncBlocked, setSyncBlocked] = useState(true);
  const [queuedCount, setQueuedCount] = useState(0);
  const [replyingToId, setReplyingToId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [actionMessageId, setActionMessageId] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [voiceDraft, setVoiceDraft] = useState<{
    blob: Blob;
    mimeType: string;
    presentation: VoiceAttachmentPresentation;
  } | null>(null);
  const [voiceDraftPreparing, setVoiceDraftPreparing] = useState(false);
  const [showGroupSettings, setShowGroupSettings] = useState(false);
  const [showSecurity, setShowSecurity] = useState(false);
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_MESSAGES);
  const [nativeAttachmentPicker, setNativeAttachmentPicker] = useState(false);
  const timelineRef = useRef<MessageTimelineHandle>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const lastEventRef = useRef<RealtimeEvent | null>(null);
  const retryTimerRef = useRef<{ clientId: string; timer: number } | null>(null);
  const retryAttemptsRef = useRef(new Map<string, number>());
  const voiceSendInFlightRef = useRef(false);
  const voicePreparationGenerationRef = useRef(0);
  const queueRefresh = useMemo(() => createRefreshQueue(), []);

  const body = editingId ? editBody : draft;
  const setBody = (value: string) => editingId ? setEditBody(value) : setDraft(value);
  const messageById = useMemo(() => new Map(messages.map((message) => [message.id, message])), [messages]);
  const actionMessage = actionMessageId ? messageById.get(actionMessageId) : undefined;
  const peerMembers = conversation.members.filter((member) => member.id !== user.id);
  const peerReads = peerMembers.map((member) => member.last_read_sequence);
  const peerNames = peerMembers.map((member) => member.display_name);
  const typing = useTypingPresence({
    conversationId: conversation.id,
    currentUserId: user.id,
    members: conversation.members,
    realtime,
    realtimeEvent,
  });
  useAutosizeTextarea(textareaRef, body);

  const refreshProjection = useCallback((): Promise<void> => {
    return queueRefresh(async () => {
      try {
        await adapter.syncTransport(conversation.id);
        const projection = adapter.projectConversation(conversation.id);
        const pendingMessages = adapter.pendingApplicationMessages(conversation.id);
        setMessages(projection.messages);
        setReadSequence(projection.latestSequence);
        setQueuedMessages(pendingMessages);
        setFailedQueuedIds((current) =>
          current.filter((id) => pendingMessages.some((message) => message.id === id))
        );
        setSyncBlocked(false);
        setQueuedCount(adapter.pendingApplicationCount(conversation.id));
        if (projection.rejectedEventIds.length > 0) {
          setError("Some encrypted updates were rejected");
        } else {
          setError((current) => current === "Secure sync is blocked" ? null : current);
        }
      } catch {
        const pendingMessages = adapter.pendingApplicationMessages(conversation.id);
        setSyncBlocked(true);
        setError("Secure sync is blocked");
        setQueuedCount(adapter.pendingApplicationCount(conversation.id));
        setQueuedMessages(pendingMessages);
        setFailedQueuedIds((current) =>
          current.filter((id) => pendingMessages.some((message) => message.id === id))
        );
      } finally {
        setLoading(false);
      }
    });
  }, [adapter, conversation.id, queueRefresh]);

  const scheduleAutoRetry = useCallback((clientId: string) => {
    if (
      !navigator.onLine
      || failedQueuedIds.includes(clientId)
      || retryingQueuedId !== null
      || retryTimerRef.current !== null
    ) {
      return;
    }

    const attempt = (retryAttemptsRef.current.get(clientId) ?? 0) + 1;
    if (attempt > MAX_AUTO_SEND_RETRY_ATTEMPTS) {
      retryAttemptsRef.current.delete(clientId);
      setAutoRetryQueuedId(null);
      setFailedQueuedIds((current) => [...new Set([...current, clientId])]);
      return;
    }

    retryAttemptsRef.current.set(clientId, attempt);
    setAutoRetryQueuedId(clientId);
    const timer = window.setTimeout(() => {
      retryTimerRef.current = null;
      setAutoRetryQueuedId((current) => current === clientId ? null : current);
      if (!navigator.onLine) {
        if (attempt <= 1) retryAttemptsRef.current.delete(clientId);
        else retryAttemptsRef.current.set(clientId, attempt - 1);
        return;
      }
      setRetryingQueuedId(clientId);

      void adapter.retryPendingApplicationSend(clientId)
        .then(async () => {
          retryAttemptsRef.current.delete(clientId);
          setFailedQueuedIds((current) => current.filter((id) => id !== clientId));
          await refreshProjection();
        })
        .catch((retryError) => {
          const pendingMessages = adapter.pendingApplicationMessages(conversation.id);
          setQueuedMessages(pendingMessages);
          setQueuedCount(adapter.pendingApplicationCount(conversation.id));

          const next = pendingMessages[0];
          if (!next) {
            retryAttemptsRef.current.delete(clientId);
            return;
          }

          if (sendFailureForError(retryError) === "permanent") {
            retryAttemptsRef.current.delete(clientId);
            retryAttemptsRef.current.delete(next.id);
            setFailedQueuedIds((current) => [...new Set([...current, next.id])]);
            return;
          }

          if (next.id !== clientId) {
            retryAttemptsRef.current.delete(clientId);
          }
          setRetryTick((value) => value + 1);
        })
        .finally(() => {
          setRetryingQueuedId((current) => current === clientId ? null : current);
        });
    }, sendRetryDelayMs(attempt));

    retryTimerRef.current = { clientId, timer };
  }, [adapter, conversation.id, failedQueuedIds, refreshProjection, retryingQueuedId]);

  useEffect(() => {
    const first = queuedMessages[0];
    if (
      !first
      || !navigator.onLine
      || failedQueuedIds.includes(first.id)
      || retryingQueuedId !== null
      || autoRetryQueuedId !== null
      || retryTimerRef.current !== null
    ) {
      return;
    }
    scheduleAutoRetry(first.id);
  }, [
    autoRetryQueuedId,
    failedQueuedIds,
    queuedMessages,
    retryTick,
    retryingQueuedId,
    scheduleAutoRetry,
  ]);

  useEffect(() => () => {
    if (retryTimerRef.current) {
      window.clearTimeout(retryTimerRef.current.timer);
      retryTimerRef.current = null;
    }
    retryAttemptsRef.current.clear();
    voicePreparationGenerationRef.current += 1;
  }, []);

  // MessengerShell keys this view by conversation identity. Updates within
  // that conversation should sync history, never reset an active draft/edit.
  useEffect(() => {
    void refreshProjection();
  }, [conversation.latest_sequence, refreshProjection]);

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
    const refreshNativeMedia = () => setNativeAttachmentPicker(nativeMediaAvailable());
    refreshNativeMedia();
    window.addEventListener(NATIVE_MEDIA_READY_EVENT, refreshNativeMedia);
    return () => window.removeEventListener(NATIVE_MEDIA_READY_EVENT, refreshNativeMedia);
  }, []);

  useEffect(() => {
    if (!syncBlocked || loading || queuedMessages.length > 0) return;
    const timer = window.setInterval(() => {
      if (navigator.onLine) void refreshProjection();
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [loading, queuedMessages.length, refreshProjection, syncBlocked]);


  const replyingTo = useMemo(
    () => messageById.get(replyingToId ?? "") ?? null,
    [messageById, replyingToId],
  );
  const editing = useMemo(
    () => messageById.get(editingId ?? "") ?? null,
    [messageById, editingId],
  );

  function classifyPendingFailure(clientId: string, sendError: unknown) {
    if (!navigator.onLine) {
      setFailedQueuedIds((current) => current.filter((id) => id !== clientId));
      return;
    }
    if (sendFailureForError(sendError) === "permanent") {
      retryAttemptsRef.current.delete(clientId);
      setFailedQueuedIds((current) => [...new Set([...current, clientId])]);
      return;
    }
    setFailedQueuedIds((current) => current.filter((id) => id !== clientId));
    setRetryTick((value) => value + 1);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = body.trim();
    if (!text || busy || syncBlocked) return;
    setBusy(true);
    setError(null);
    timelineRef.current?.toLatest();
    typing.stopLocalTyping();
    const clientId = crypto.randomUUID();
    if (!editing) {
      setSendingPreview({ id: clientId, body: text, phase: "encrypting" });
    }

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
        }, clientId, () => {
          setSendingPreview((current) =>
            current?.id === clientId ? { ...current, phase: "sending" } : current
          );
        });
      }
      if (editing) setEditBody(""); else setDraft("");
      setSendingPreview(null);
      setEditingId(null);
      setReplyingToId(null);
      await refreshProjection();
    } catch (sendError) {
      const pendingMessages = adapter.pendingApplicationMessages(conversation.id);
      setQueuedCount(adapter.pendingApplicationCount(conversation.id));
      setQueuedMessages(pendingMessages);
      if (!editing && pendingMessages.some((message) => message.id === clientId)) {
        setBody("");
        setReplyingToId(null);
        const blocked = pendingMessages[0];
        if (blocked) classifyPendingFailure(blocked.id, sendError);
        setError(null);
      } else {
        setError("Unable to send encrypted update");
      }
    } finally {
      setSendingPreview(null);
      setBusy(false);
    }
  }

  async function retryQueuedMessage(clientId: string) {
    if (!navigator.onLine) {
      setError("Retry requires a connection");
      return;
    }
    setError(null);
    setRetryingQueuedId(clientId);
    setFailedQueuedIds((current) => current.filter((id) => id !== clientId));
    try {
      await adapter.retryPendingApplicationSend(clientId);
      retryAttemptsRef.current.delete(clientId);
      await refreshProjection();
    } catch (retryError) {
      const pendingMessages = adapter.pendingApplicationMessages(conversation.id);
      setQueuedMessages(pendingMessages);
      setQueuedCount(adapter.pendingApplicationCount(conversation.id));
      const next = pendingMessages[0];
      if (next) {
        classifyPendingFailure(next.id, retryError);
        setError(sendFailureForError(retryError) === "permanent" ? "Encrypted message retry failed" : null);
      }
    } finally {
      setRetryingQueuedId(null);
    }
  }

  async function removeQueuedMessage(clientId: string) {
    setError(null);
    if (retryTimerRef.current?.clientId === clientId) {
      window.clearTimeout(retryTimerRef.current.timer);
      retryTimerRef.current = null;
      setAutoRetryQueuedId(null);
    }
    retryAttemptsRef.current.delete(clientId);
    try {
      await adapter.discardPendingApplicationSend(clientId);
      const pendingMessages = adapter.pendingApplicationMessages(conversation.id);
      setQueuedMessages(pendingMessages);
      setQueuedCount(adapter.pendingApplicationCount(conversation.id));
      setFailedQueuedIds((current) => current.filter((id) => id !== clientId));
      setRetryTick((value) => value + 1);
      if (navigator.onLine) await refreshProjection();
    } catch {
      setError("Unable to remove queued encrypted message");
    }
  }


  async function attachFile(file: File) {
    if (busy || syncBlocked) return;
    setError(null);
    if (!navigator.onLine) {
      setError("Encrypted attachments require a connection");
      return;
    }

    setBusy(true);
    setUploadProgress(0);
    let clientId: string | null = null;
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
      }, undefined, (preparedClientId) => {
        clientId = preparedClientId;
      });
      setReplyingToId(null);
      await refreshProjection();
    } catch (uploadError) {
      const pendingMessages = adapter.pendingApplicationMessages(conversation.id);
      setQueuedMessages(pendingMessages);
      setQueuedCount(adapter.pendingApplicationCount(conversation.id));
      const queuedClientId = clientId;
      if (
        queuedClientId
        && pendingMessages.some((message) => message.id === queuedClientId)
      ) {
        const blocked = pendingMessages[0];
        if (blocked) classifyPendingFailure(blocked.id, uploadError);
        setError(null);
      } else {
        setError(
          uploadError instanceof Error
            ? uploadError.message
            : "Encrypted attachment failed",
        );
      }
    } finally {
      setUploadProgress(null);
      setBusy(false);
    }
  }

  async function attach(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) await attachFile(file);
  }

  async function chooseAttachment() {
    if (!nativeAttachmentPicker) {
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

  async function prepareVoiceDraft(
    chunks: Blob[],
    mimeType: string,
    fallbackDurationMs: number,
  ) {
    const generation = ++voicePreparationGenerationRef.current;
    setVoiceDraftPreparing(true);
    try {
      const blob = new Blob(chunks, { type: mimeType });
      if (blob.size < 1) throw new Error("Voice recording is empty");
      const presentation = await analyzeVoiceBlob(blob, fallbackDurationMs);
      if (voicePreparationGenerationRef.current !== generation) return;
      setVoiceDraft({ blob, mimeType, presentation });
    } finally {
      if (voicePreparationGenerationRef.current === generation) {
        setVoiceDraftPreparing(false);
      }
    }
  }

  function deleteVoiceDraft() {
    if (busy || voiceSendInFlightRef.current) return;
    setVoiceDraft(null);
    setError(syncBlocked ? "Secure sync is blocked" : null);
  }

  async function sendVoiceDraft() {
    const current = voiceDraft;
    if (!current || busy || voiceSendInFlightRef.current) return;
    if (syncBlocked) {
      setError("Voice note was not sent: Secure sync is blocked");
      return;
    }
    if (!navigator.onLine) {
      setError("Encrypted voice notes require a connection");
      return;
    }

    voiceSendInFlightRef.current = true;
    setBusy(true);
    setError(null);
    setUploadProgress(0);
    let clientId: string | null = null;
    try {
      const extension = voiceFileExtension(current.mimeType);
      const file = new File([current.blob], `voice-message.${extension}`, {
        type: current.mimeType,
      });
      const uploaded = await uploadEncryptedAsset(file, setUploadProgress);
      const metadata = {
        ...uploaded.metadata,
        voice: current.presentation,
      };
      await adapter.sendMessageDurably({
        conversationId: conversation.id,
        messageType: "voice",
        body: null,
        replyTo: replyingTo?.id ?? null,
        assetIds: [uploaded.asset.id],
        attachments: [metadata],
      }, undefined, (preparedClientId) => {
        clientId = preparedClientId;
      });
      setVoiceDraft(null);
      setReplyingToId(null);
      await refreshProjection();
    } catch (voiceError) {
      const pendingMessages = adapter.pendingApplicationMessages(conversation.id);
      setQueuedMessages(pendingMessages);
      setQueuedCount(adapter.pendingApplicationCount(conversation.id));
      const queuedClientId = clientId;
      if (
        queuedClientId
        && pendingMessages.some((message) => message.id === queuedClientId)
      ) {
        setVoiceDraft(null);
        const blocked = pendingMessages[0];
        if (blocked) classifyPendingFailure(blocked.id, voiceError);
        setError(null);
      } else {
        setError(
          voiceError instanceof Error
            ? voiceError.message
            : "Encrypted voice note failed",
        );
      }
    } finally {
      voiceSendInFlightRef.current = false;
      setUploadProgress(null);
      setBusy(false);
    }
  }

  const {
    recording,
    requesting: requestingMic,
    seconds: recordSeconds,
    toggle: toggleVoice,
  } = useVoiceRecorder({ onReady: prepareVoiceDraft, onError: setError });

  async function toggleRecording() {
    // Stop is always available, even when secure authoring becomes blocked.
    if (recording) { await toggleVoice(); return; }
    if (busy || syncBlocked || requestingMic || voiceDraftPreparing || voiceDraft) return;
    typing.stopLocalTyping();
    setError(null);
    if (!navigator.onLine) { setError("Encrypted voice notes require a connection"); return; }
    await toggleVoice();
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
        setEditBody("");
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
    if (syncBlocked || voiceDraftPreparing || voiceDraft || message.senderId !== user.id || message.deleted) return;
    typing.stopLocalTyping();
    setEditingId(message.id);
    setReplyingToId(null);
    setEditBody(message.body ?? "");
    setActionMessageId(null);
    textareaRef.current?.focus({ preventScroll: true });
  }


  function beginReply(message: ProjectedEncryptedMessage) {
    if (busy || syncBlocked || recording || voiceDraftPreparing || voiceDraft || message.deleted) return;
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
    onReadAcknowledged(conversation.id, sequence);
  }
  return (
    <section className="conversation-view">
      <ConversationHeader
        title={conversationTitle(conversation, user.id)}
        subtitle="End-to-end encrypted"
        onBack={() => { typing.stopLocalTyping(); onBack(); }}
        actions={
          <>
            {conversation.type === "group" ? (
              <button type="button" onClick={() => setShowGroupSettings((value) => !value)}>
                Group
              </button>
            ) : null}
            <button type="button" onClick={() => setShowSecurity((value) => !value)}>
              Verify
            </button>
            <button type="button" onClick={() => { typing.stopLocalTyping(); onHide(); }}>Hide</button>
          </>
        }
      />

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

      <MessageTimeline
        ref={timelineRef}
        items={messages}
        visibleCount={visibleCount}
        currentUserId={user.id}
        readSequence={readSequence}
        onReadLatest={markVisibleRead}
        childrenBefore={loading ? <p className="muted center">Decrypting…</p> : messages.length === 0 ? (
          <div className="empty-conversations">
            <div className="empty-icon" aria-hidden="true">•••</div>
            <h2>No encrypted messages yet</h2>
            <p>Messages are decrypted only on this device.</p>
          </div>
        ) : messages.length > visibleCount ? (
          <button className="load-earlier-button" type="button" onClick={() => setVisibleCount((count) => count + INITIAL_VISIBLE_MESSAGES)}>Show earlier messages</button>
        ) : null}
        renderMessage={(message) => {
          const own = message.senderId === user.id;
          const reply = message.replyTo ? messageById.get(message.replyTo) : undefined;
          return (
            <div className={`message-row ${own ? "own" : ""}`}>
              <div className="message-bubble-wrap">
                <MessageInteraction disabled={busy || syncBlocked || recording || voiceDraftPreparing || voiceDraft !== null || message.deleted} onActions={() => setActionMessageId(message.id)} onReply={() => beginReply(message)}>
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
                    )}
                    {message.reactions.length > 0 ? <div className="reaction-row">{message.reactions.map((reaction) => <span key={reaction.emoji}>{reaction.emoji} {reaction.userIds.length}</span>)}</div> : null}
                    <MessageMeta createdAt={message.createdAt} sequence={message.sequence} own={own} peerReads={peerReads} peerNames={peerNames} edited={message.edited} />
                  </div>
                </MessageInteraction>
                {!message.deleted ? <button className="message-more-button" type="button" aria-label="Encrypted message actions" aria-haspopup="dialog" onClick={() => setActionMessageId(message.id)}>•••</button> : null}
              </div>
            </div>
          );
        }}
        childrenAfter={<>
          {queuedMessages.map((message) => {
            const failed = failedQueuedIds.includes(message.id);
            const retrying = retryingQueuedId === message.id;
            const autoRetrying = autoRetryQueuedId === message.id;
            return (
              <div className="message-row own" key={message.id}>
                <div className={`message-bubble pending ${failed ? "failed" : ""}`}>
                  <p>{message.body ?? (message.messageType === "voice" ? "Voice message" : "Attachment")}</p>
                  <small role={failed ? "alert" : "status"}>{retrying ? "Sending…" : failed ? "Failed" : autoRetrying ? "Retrying…" : "Queued"}</small>
                  <div className="pending-message-actions">
                    {failed ? (
                      <button
                        type="button"
                        aria-label="Retry failed message"
                        disabled={retrying}
                        onClick={() => void retryQueuedMessage(message.id)}
                      >
                        Retry
                      </button>
                    ) : null}
                    <button
                      type="button"
                      aria-label="Remove queued message"
                      disabled={retryingQueuedId !== null}
                      onClick={() => void removeQueuedMessage(message.id)}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
          <div
            className={`typing-indicator ${typing.typingLabel ? "is-active" : ""}`}
            aria-live="polite"
            aria-atomic="true"
          >
            {typing.typingLabel ?? "\u00a0"}
          </div>
          {sendingPreview ? (
            <div className="message-row own">
              <div className="message-bubble pending">
                <p>{sendingPreview.body}</p>
                <small role="status">{sendingPreview.phase === "encrypting" ? "Encrypting…" : "Sending…"}</small>
              </div>
            </div>
          ) : null}
        </>}
      />
      {actionMessage && !actionMessage.deleted ? <MessageActionSheet
        preview={encryptedPreview(actionMessage)}
        onClose={() => setActionMessageId(null)}
        actions={[
          ...(actionMessage.body ? [{ id: "copy", label: "Copy", run: () => { void copyMessage(actionMessage.body!); } }] : []),
          { id: "reply", label: "Reply", disabled: busy || syncBlocked || recording || voiceDraftPreparing || voiceDraft !== null, run: () => beginReply(actionMessage) },
          ...(actionMessage.senderId === user.id && actionMessage.messageType === "text" ? [{ id: "edit", label: "Edit", disabled: busy || syncBlocked || recording || voiceDraftPreparing || voiceDraft !== null, run: () => beginEdit(actionMessage) }] : []),
          { id: "👍", label: "👍", disabled: busy || syncBlocked, run: () => { void toggleReaction(actionMessage, "👍"); } },
          { id: "❤️", label: "❤️", disabled: busy || syncBlocked, run: () => { void toggleReaction(actionMessage, "❤️"); } },
          { id: "😂", label: "😂", disabled: busy || syncBlocked, run: () => { void toggleReaction(actionMessage, "😂"); } },
          ...(actionMessage.senderId === user.id ? [{ id: "delete", label: "Delete", destructive: true, disabled: busy || syncBlocked, run: () => { void deleteMessage(actionMessage); } }] : []),
        ]}
      /> : null}

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
            setEditBody("");
          }}>×</button>
        </div>
      ) : null}

      {voiceDraftPreparing ? (
        <div className="voice-draft-preparing" role="status">Preparing voice…</div>
      ) : voiceDraft ? (
        <VoiceDraftPreview
          blob={voiceDraft.blob}
          presentation={voiceDraft.presentation}
          busy={busy}
          sendDisabled={syncBlocked}
          uploadProgress={uploadProgress}
          onDelete={deleteVoiceDraft}
          onSend={() => void sendVoiceDraft()}
        />
      ) : (
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
                  className={`attach-button ${uploadProgress !== null ? "is-uploading" : ""}`}
                  aria-label="Attach encrypted file"
                  disabled={busy || syncBlocked || recording || uploadProgress !== null}
                  onClick={() => void chooseAttachment()}
                >
                  {uploadProgress === null ? "+" : `${uploadProgress}%`}
                </button>
                <textarea
                  ref={textareaRef}
                  aria-label="Message"
                  value={body}
                  onChange={(event) => {
                    const next = event.target.value;
                    setBody(next);
                    typing.updateLocalTyping(next, Boolean(editing));
                  }}
                  rows={1}
                  maxLength={20000}
                  placeholder={recording ? `Recording ${formatDuration(recordSeconds)}` : editing ? "Edit encrypted message" : "Message"}
                  disabled={busy || syncBlocked || recording}
                />
                <button
                  type="button"
                  className={`voice-button ${recording ? "recording" : ""}`}
                  onClick={() => void toggleRecording()}
                  aria-label={recording ? "Stop recording" : requestingMic ? "Requesting microphone" : "Record voice message"}
                  disabled={!recording && (busy || syncBlocked || requestingMic || uploadProgress !== null)}
                >
                  {recording ? "Stop" : requestingMic ? "…" : "Mic"}
                </button>
                <button
                  type="submit"
                  aria-label={editing ? "Save" : "Send"}
                  disabled={!body.trim() || busy || syncBlocked || recording || uploadProgress !== null}
                >
                  {busy ? "…" : editing ? "Save" : "Send"}
                </button>
              </form>
      )}
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

