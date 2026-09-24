"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeClient } from "./realtime";
import type { ConversationMember, RealtimeEvent } from "./types";
import { typingPresenceLabel } from "./typing-presence";

const LOCAL_STOP_DELAY_MS = 1_500;
const LOCAL_REFRESH_MS = 2_000;
const REMOTE_EXPIRY_MS = 3_500;

function eventSenderId(event: RealtimeEvent): string | null {
  if (!event.payload || typeof event.payload !== "object") return null;
  const payload = event.payload as { user_id?: unknown; sender_id?: unknown; sender_user_id?: unknown };
  for (const value of [payload.user_id, payload.sender_id, payload.sender_user_id]) {
    if (typeof value === "string" && value) return value;
  }
  return null;
}

export function useTypingPresence({
  conversationId,
  currentUserId,
  members,
  realtime,
  realtimeEvent,
}: {
  conversationId: string;
  currentUserId: string;
  members: readonly ConversationMember[];
  realtime: RealtimeClient | null;
  realtimeEvent: RealtimeEvent | null;
}) {
  const [remoteTypingIds, setRemoteTypingIds] = useState<string[]>([]);
  const localActiveRef = useRef(false);
  const localStopTimerRef = useRef<number | null>(null);
  const localRefreshTimerRef = useRef<number | null>(null);
  const remoteTimersRef = useRef(new Map<string, number>());
  const realtimeRef = useRef(realtime);
  useEffect(() => { realtimeRef.current = realtime; }, [realtime]);

  const clearLocalTimers = useCallback(() => {
    if (localStopTimerRef.current !== null) window.clearTimeout(localStopTimerRef.current);
    if (localRefreshTimerRef.current !== null) window.clearInterval(localRefreshTimerRef.current);
    localStopTimerRef.current = null;
    localRefreshTimerRef.current = null;
  }, []);

  const stopLocalTyping = useCallback(() => {
    clearLocalTimers();
    if (!localActiveRef.current) return;
    localActiveRef.current = false;
    realtimeRef.current?.sendTyping(conversationId, false);
  }, [clearLocalTimers, conversationId]);

  const ensureRefresh = useCallback(() => {
    if (localRefreshTimerRef.current !== null) return;
    localRefreshTimerRef.current = window.setInterval(() => {
      if (!localActiveRef.current || document.visibilityState !== "visible") return;
      realtimeRef.current?.sendTyping(conversationId, true);
    }, LOCAL_REFRESH_MS);
  }, [conversationId]);

  const updateLocalTyping = useCallback((text: string, suppressed = false) => {
    if (suppressed || !text.trim()) {
      stopLocalTyping();
      return;
    }

    if (!localActiveRef.current) {
      localActiveRef.current = true;
      realtimeRef.current?.sendTyping(conversationId, true);
      ensureRefresh();
    }

    if (localStopTimerRef.current !== null) window.clearTimeout(localStopTimerRef.current);
    localStopTimerRef.current = window.setTimeout(stopLocalTyping, LOCAL_STOP_DELAY_MS);
  }, [conversationId, ensureRefresh, stopLocalTyping]);

  const removeRemote = useCallback((senderId: string) => {
    const timer = remoteTimersRef.current.get(senderId);
    if (timer !== undefined) window.clearTimeout(timer);
    remoteTimersRef.current.delete(senderId);
    setRemoteTypingIds((current) => current.filter((id) => id !== senderId));
  }, []);

  useEffect(() => {
    if (!realtimeEvent || realtimeEvent.conversation_id !== conversationId) return;
    const senderId = eventSenderId(realtimeEvent);
    if (!senderId || senderId === currentUserId) return;

    if (realtimeEvent.type === "typing.stopped") {
      removeRemote(senderId);
      return;
    }

    if (realtimeEvent.type === "typing.started") {
      const existing = remoteTimersRef.current.get(senderId);
      if (existing !== undefined) window.clearTimeout(existing);
      setRemoteTypingIds((current) => current.includes(senderId) ? current : [...current, senderId]);
      const timer = window.setTimeout(() => removeRemote(senderId), REMOTE_EXPIRY_MS);
      remoteTimersRef.current.set(senderId, timer);
      return;
    }

    if (realtimeEvent.type === "message.created") {
      removeRemote(senderId);
    }
  }, [conversationId, currentUserId, realtimeEvent, removeRemote]);

  useEffect(() => {
    const stopWhenHidden = () => {
      if (document.visibilityState === "hidden") stopLocalTyping();
    };
    const stopOnPageHide = () => stopLocalTyping();
    document.addEventListener("visibilitychange", stopWhenHidden);
    window.addEventListener("pagehide", stopOnPageHide);
    return () => {
      document.removeEventListener("visibilitychange", stopWhenHidden);
      window.removeEventListener("pagehide", stopOnPageHide);
    };
  }, [stopLocalTyping]);

  useEffect(() => () => {
    stopLocalTyping();
    for (const timer of remoteTimersRef.current.values()) window.clearTimeout(timer);
    remoteTimersRef.current.clear();
  }, [stopLocalTyping]);

  const typingNames = useMemo(() => {
    const names = new Map(members.map((member) => [member.id, member.display_name]));
    return remoteTypingIds.map((id) => names.get(id) ?? "Someone");
  }, [members, remoteTypingIds]);

  return {
    typingLabel: typingPresenceLabel(typingNames),
    updateLocalTyping,
    stopLocalTyping,
  };
}
