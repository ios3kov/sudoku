"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { messengerApi } from "./api";
import { AdminInvite } from "./admin-invite";
import { ConversationView, conversationTitle } from "./conversation-view";
import { NewChat } from "./new-chat";
import { clearPending } from "./outbox";
import { RealtimeClient } from "./realtime";
import { enableMaskedPush } from "./push";
import { DeviceSessions } from "./device-sessions";
import { OpenMlsProtocolAdapter } from "./crypto/openmls-adapter";
import type { Conversation, CurrentUser, RealtimeEvent } from "./types";

function sortConversations(items: Conversation[]): Conversation[] {
  return [...items].sort((a, b) => {
    if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
    return b.created_at.localeCompare(a.created_at);
  });
}

export function MessengerShell({ user, onHide, onLoggedOut }: { user: CurrentUser; onHide: () => void; onLoggedOut: () => void }) {
  const [loggingOut, setLoggingOut] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [latestEvent, setLatestEvent] = useState<RealtimeEvent | null>(null);
  const [reconnectTick, setReconnectTick] = useState(0);
  const [connectionState, setConnectionState] = useState<"online" | "reconnecting">("reconnecting");
  const [pushState, setPushState] = useState<"idle" | "enabling" | "enabled" | "error">("idle");
  const [showInvite, setShowInvite] = useState(false);
  const [showDevices, setShowDevices] = useState(false);
  const [e2eeState, setE2eeState] = useState<"initializing" | "ready" | "error">("initializing");
  const realtimeRef = useRef<RealtimeClient | null>(null);
  const e2eeRef = useRef<OpenMlsProtocolAdapter | null>(null);
  const conversationsRef = useRef<Conversation[]>([]);

  const loadConversations = useCallback(async () => {
    try {
      const next = await messengerApi.conversations();
      const sorted = sortConversations(next);
      conversationsRef.current = sorted;
      setConversations(sorted);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const sessions = await messengerApi.sessions();
        const current = sessions.find((session) => session.current);
        if (!current) throw new Error("Current device session is unavailable");

        const adapter = new OpenMlsProtocolAdapter({
          userId: user.id,
          deviceId: current.id,
        });
        await adapter.initialize();
        await adapter.ensureKeyPackagePool(10);

        if (cancelled) return;
        e2eeRef.current = adapter;
        setE2eeState("ready");

        const trackedConversationIds = new Set([
          ...adapter.trackedConversationIds(),
          ...conversationsRef.current
            .filter((conversation) => conversation.encryption_required)
            .map((conversation) => conversation.id),
        ]);
        for (const conversationId of trackedConversationIds) {
          await adapter.syncTransport(conversationId);
        }
      } catch {
        if (!cancelled) {
          e2eeRef.current = null;
          setE2eeState("error");
        }
      }
    })();

    return () => {
      cancelled = true;
      e2eeRef.current = null;
    };
  }, [user.id]);

  useEffect(() => {
    const realtime = new RealtimeClient({
      onOpen: () => {
        setConnectionState("online");
        setReconnectTick((value) => value + 1);
        const adapter = e2eeRef.current;
        if (adapter) {
          const trackedConversationIds = new Set([
            ...adapter.trackedConversationIds(),
            ...conversationsRef.current
              .filter((conversation) => conversation.encryption_required)
              .map((conversation) => conversation.id),
          ]);
          for (const conversationId of trackedConversationIds) {
            void adapter.syncTransport(conversationId).catch(() => {
              setE2eeState("error");
            });
          }
          void adapter.ensureKeyPackagePool(10).catch(() => {
            setE2eeState("error");
          });
        }
      },
      onClose: () => setConnectionState("reconnecting"),
      onEvent: (event) => {
        setLatestEvent(event);
        if (["conversation.created", "conversation.updated", "conversation.members_added", "conversation.member_role_updated", "conversation.member_removed"].includes(event.type)) void loadConversations();
        if (
          (event.type === "message.created" || event.type === "mls.control.created")
          && event.conversation_id
        ) {
          const adapter = e2eeRef.current;
          const currentConversationIsEncrypted = conversationsRef.current.some(
            (conversation) =>
              conversation.id === event.conversation_id
              && conversation.encryption_required,
          );
          const locallyTracked = adapter?.trackedConversationIds().includes(event.conversation_id) ?? false;
          if (
            adapter
            && (
              event.type === "mls.control.created"
              || currentConversationIsEncrypted
              || locallyTracked
            )
          ) {
            void adapter.syncTransport(event.conversation_id).catch(() => {
              setE2eeState("error");
            });
            if (event.type === "mls.control.created") {
              void adapter.ensureKeyPackagePool(10).catch(() => {
                setE2eeState("error");
              });
            }
          }
        }
        if (event.type === "conversation.member_removed" && event.conversation_id && (event.payload as { user_id?: string } | undefined)?.user_id === user.id) {
          setSelectedId((current) => current === event.conversation_id ? null : current);
        }
        if (event.type === "message.created" && event.conversation_id && event.payload) {
          const sequence = Number((event.payload as { sequence?: number }).sequence ?? 0);
          setConversations((current) => current.map((conversation) =>
            conversation.id === event.conversation_id
              ? { ...conversation, latest_sequence: Math.max(conversation.latest_sequence, sequence) }
              : conversation,
          ));
        }
      },
    });
    realtimeRef.current = realtime;
    realtime.start();
    return () => {
      realtime.stop();
      realtimeRef.current = null;
    };
  }, [loadConversations, user.id]);

  async function enablePush() {
    setPushState("enabling");
    try {
      await enableMaskedPush();
      setPushState("enabled");
    } catch {
      setPushState("error");
    }
  }

  async function logout() {
    setLoggingOut(true);
    try {
      const response = await fetch("/v1/auth/logout", { method: "POST", credentials: "include" });
      if (response.ok) {
        await e2eeRef.current?.clearLocalState().catch(() => undefined);
      }
      await clearPending().catch(() => undefined);
    } finally {
      setLoggingOut(false);
      onLoggedOut();
      onHide();
    }
  }

  function addConversation(conversation: Conversation) {
    setConversations((current) => {
      const without = current.filter((item) => item.id !== conversation.id);
      const next = sortConversations([conversation, ...without]);
      conversationsRef.current = next;
      return next;
    });
    setSelectedId(conversation.id);
    setCreating(false);
  }

  function updateConversation(next: Conversation) {
    setConversations((current) => {
      const updated = sortConversations(
        current.map((item) => item.id === next.id ? next : item),
      );
      conversationsRef.current = updated;
      return updated;
    });
  }

  const selected = conversations.find((conversation) => conversation.id === selectedId) ?? null;

  if (selected?.encryption_required) {
    return (
      <main className="messenger-page">
        <section className="messenger-shell">
          <header className="messenger-topbar">
            <div>
              <strong>{conversationTitle(selected, user.id)}</strong>
              <span>{e2eeState === "ready" ? "Secure chat ready" : e2eeState === "error" ? "Secure chat unavailable" : "Initializing secure chat…"}</span>
            </div>
            <button type="button" onClick={() => setSelectedId(null)}>Back</button>
          </header>
          <p className="muted center">
            Secure conversation rendering is locked until the encrypted history/composer wiring passes its production gate.
          </p>
        </section>
      </main>
    );
  }

  if (selected) {
    return (
      <main className="messenger-page">
        <section className="messenger-shell">
          <ConversationView
            conversation={selected}
            user={user}
            realtime={realtimeRef.current}
            realtimeEvent={latestEvent}
            reconnectTick={reconnectTick}
            onBack={() => setSelectedId(null)}
            onHide={onHide}
            onConversationUpdated={updateConversation}
            onConversationLeft={() => {
              setSelectedId(null);
              void loadConversations();
            }}
          />
        </section>
      </main>
    );
  }

  return (
    <main className="messenger-page">
      <section className="messenger-shell">
        <header className="messenger-topbar">
          <div>
            <strong>Messages</strong>
            <span>{user.display_name} · {connectionState}</span>
          </div>
          <button type="button" onClick={onHide}>Hide</button>
        </header>

        {creating ? (
          <NewChat onCreated={addConversation} onCancel={() => setCreating(false)} />
        ) : (
          <div className="conversation-list">
            <button className="new-chat-button" type="button" onClick={() => setCreating(true)}>New chat</button>
            {loading ? <p className="muted center">Loading…</p> : conversations.length === 0 ? (
              <div className="empty-conversations">
                <div className="empty-icon" aria-hidden="true">•••</div>
                <h2>No conversations yet</h2>
                <p>Start a private chat with an invited member.</p>
              </div>
            ) : conversations.map((conversation) => {
              const unread = Math.max(0, conversation.latest_sequence - conversation.last_read_sequence);
              return (
                <button key={conversation.id} type="button" className="conversation-item" onClick={() => setSelectedId(conversation.id)}>
                  <span className="avatar">{conversationTitle(conversation, user.id).slice(0, 1).toUpperCase()}</span>
                  <span className="conversation-copy">
                    <strong>{conversation.is_pinned ? "★ " : ""}{conversationTitle(conversation, user.id)}</strong>
                    <small>{[conversation.type === "group" ? "Group" : "Private chat", conversation.notifications_muted ? "Muted" : null].filter(Boolean).join(" · ")}</small>
                  </span>
                  {unread > 0 ? <span className="unread-badge">{unread > 99 ? "99+" : unread}</span> : null}
                </button>
              );
            })}
          </div>
        )}

        {user.is_admin && showInvite ? <AdminInvite onClose={() => setShowInvite(false)} /> : null}
        {showDevices ? <DeviceSessions
          onClose={() => setShowDevices(false)}
          onCurrentRevoked={() => {
            void (async () => {
              await e2eeRef.current?.clearLocalState().catch(() => undefined);
              await clearPending().catch(() => undefined);
              onLoggedOut();
              onHide();
            })();
          }}
        /> : null}

        <footer className="messenger-footer">
          {user.is_admin ? <button type="button" onClick={() => setShowInvite((value) => !value)}>Invite</button> : null}
          <button type="button" onClick={() => setShowDevices((value) => !value)}>Devices</button>
          <button type="button" onClick={() => void enablePush()} disabled={pushState === "enabling" || pushState === "enabled"}>
            {pushState === "enabled" ? "Notifications on" : pushState === "enabling" ? "Enabling…" : pushState === "error" ? "Retry notifications" : "Enable notifications"}
          </button>
          <button type="button" onClick={logout} disabled={loggingOut}>{loggingOut ? "Signing out…" : "Sign out"}</button>
        </footer>
      </section>
    </main>
  );
}
