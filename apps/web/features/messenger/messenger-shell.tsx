"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { messengerApi } from "./api";
import { AdminInvite } from "./admin-invite";
import { ConversationView } from "./conversation-view";
import { EncryptedConversationView } from "./encrypted-conversation-view";
import { conversationTitle } from "./chat-utils";
import { NewChat } from "./new-chat";
import { clearPending } from "./outbox";
import { RealtimeClient } from "./realtime";
import { enableMaskedPush } from "./push";
import { DeviceSessions } from "./device-sessions";
import { OpenMlsProtocolAdapter } from "./crypto/openmls-adapter";
import type { Conversation, CurrentUser, RealtimeEvent } from "./types";

function conversationInitials(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.slice(0, 1).toUpperCase())
    .join("") || "•";
}

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
  const [secureSetupBusy, setSecureSetupBusy] = useState(false);
  const [secureSetupError, setSecureSetupError] = useState<string | null>(null);
  const [deviceRekeyError, setDeviceRekeyError] = useState<string | null>(null);
  const [e2eeState, setE2eeState] = useState<"initializing" | "ready" | "error">("initializing");
  const [realtimeClient, setRealtimeClient] = useState<RealtimeClient | null>(null);
  const [e2eeAdapter, setE2eeAdapter] = useState<OpenMlsProtocolAdapter | null>(null);
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

  const reconcileDeviceChange = useCallback(async (
    adapter: OpenMlsProtocolAdapter,
    conversationId: string,
  ) => {
    if (!adapter.trackedConversationIds().includes(conversationId)) return false;
    const conversation = conversationsRef.current.find(
      (item) =>
        item.id === conversationId
        && item.encryption_required
        && item.e2ee_ready,
    );
    if (!conversation) return false;

    try {
      const changed = await adapter.reconcilePendingDeviceChange(conversation);
      if (changed) {
        setDeviceRekeyError(null);
        await loadConversations();
      }
      return changed;
    } catch (error) {
      setDeviceRekeyError(
        error instanceof Error ? error.message : "Secure device rekey is blocked",
      );
      return false;
    }
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

        if (cancelled) return;
        e2eeRef.current = adapter;
        setE2eeAdapter(adapter);
        setE2eeState("ready");

        const latestConversations = sortConversations(
          await messengerApi.conversations(),
        );
        if (cancelled) return;
        conversationsRef.current = latestConversations;
        setConversations(latestConversations);

        const encryptedConversations = latestConversations.filter(
          (conversation) => conversation.encryption_required && conversation.e2ee_ready,
        );
        for (const conversation of encryptedConversations) {
          // Unified transport is authoritative for recovery. It includes both
          // MLS control events and application messages in one durable order,
          // so a Welcome must never be consumed first through the legacy
          // control-only feed and then replayed from transport sequence 0.
          await adapter.syncTransport(conversation.id);
          if (adapter.trackedConversationIds().includes(conversation.id)) {
            await reconcileDeviceChange(adapter, conversation.id);
            await adapter.syncTransport(conversation.id);
          }
        }
      } catch {
        if (!cancelled) {
          e2eeRef.current = null;
          setE2eeAdapter(null);
          setE2eeState("error");
        }
      }
    })();

    return () => {
      cancelled = true;
      e2eeRef.current = null;
    };
  }, [reconcileDeviceChange, user.id]);

  useEffect(() => {
    const realtime = new RealtimeClient({
      onOpen: () => {
        setConnectionState("online");
        setReconnectTick((value) => value + 1);
        const adapter = e2eeRef.current;
        if (adapter) {
          const encryptedConversations = conversationsRef.current.filter(
            (conversation) => conversation.encryption_required && conversation.e2ee_ready,
          );
          for (const conversation of encryptedConversations) {
            void (async () => {
              await adapter.syncTransport(conversation.id);
              if (adapter.trackedConversationIds().includes(conversation.id)) {
                await reconcileDeviceChange(adapter, conversation.id);
                await adapter.syncTransport(conversation.id);
              }
            })().catch(() => {
              setE2eeState("error");
            });
          }
          void adapter.ensureKeyPackagePool(10).catch(() => {
            setE2eeState("error");
          });
        }
      },
      onClose: (event) => {
        setConnectionState("reconnecting");
        if (event.code !== 4401) return;

        realtime.stop();
        void (async () => {
          await e2eeRef.current?.clearLocalState().catch(() => undefined);
          await clearPending().catch(() => undefined);
          e2eeRef.current = null;
          onLoggedOut();
          onHide();
        })();
      },
      onEvent: (event) => {
        setLatestEvent(event);
        if (["conversation.created", "conversation.updated", "conversation.members_added", "conversation.member_role_updated", "conversation.member_removed"].includes(event.type)) void loadConversations();
        if (
          (
            event.type === "message.created"
            || event.type === "mls.control.created"
            || event.type === "mls.device.rekeyed"
          )
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
            if (event.type === "mls.device.rekeyed") {
              void reconcileDeviceChange(adapter, event.conversation_id);
            }
          }
        }
        if (
          event.type === "mls.device.changed"
          && event.conversation_id
          && e2eeRef.current
        ) {
          void reconcileDeviceChange(
            e2eeRef.current,
            event.conversation_id,
          );
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
    setRealtimeClient(realtime);
    realtime.start();
    return () => {
      realtime.stop();
      realtimeRef.current = null;
      setRealtimeClient(null);
    };
  }, [loadConversations, reconcileDeviceChange, user.id]);

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
    const selectedTracked =
      e2eeAdapter?.trackedConversationIds().includes(selected.id) ?? false;
    if (
      !selected.e2ee_ready
      && selected.created_by === user.id
      && e2eeState === "ready"
      && e2eeAdapter
    ) {
      return (
        <main className="messenger-page">
          <section className="messenger-shell minimal-messenger-frame">
            <header className="messenger-topbar minimal-chat-topbar">
              <div>
                <strong>{conversationTitle(selected, user.id)}</strong>
                <span>Secure setup pending</span>
              </div>
              <button type="button" onClick={() => setSelectedId(null)}>Back</button>
            </header>
            <div className="empty-conversations">
              <h2>Finish secure setup</h2>
              <p>{secureSetupError ?? "All participant devices must join the MLS group before activation."}</p>
              <button
                type="button"
                disabled={secureSetupBusy}
                onClick={() => {
                  const adapter = e2eeAdapter;
                  if (!adapter) return;
                  setSecureSetupBusy(true);
                  setSecureSetupError(null);
                  void adapter.bootstrapConversation(selected)
                    .then((ready) => updateConversation(ready))
                    .catch((error: unknown) => {
                      setSecureSetupError(
                        error instanceof Error ? error.message : "Unable to finish secure setup",
                      );
                    })
                    .finally(() => setSecureSetupBusy(false));
                }}
              >
                {secureSetupBusy ? "Finishing…" : "Resume secure setup"}
              </button>
            </div>
          </section>
        </main>
      );
    }

    if (
      selected.e2ee_ready
      && e2eeState === "ready"
      && e2eeAdapter
      && selectedTracked
    ) {
      return (
        <main className="messenger-page">
          <section className="messenger-shell minimal-messenger-frame">
            <EncryptedConversationView
              conversation={selected}
              user={user}
              adapter={e2eeAdapter}
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
        <section className="messenger-shell minimal-messenger-frame">
          <header className="messenger-topbar minimal-chat-topbar">
            <div>
              <strong>{conversationTitle(selected, user.id)}</strong>
              <span>{e2eeState === "error" ? "Secure chat unavailable" : "Initializing secure chat…"}</span>
            </div>
            <button type="button" onClick={() => setSelectedId(null)}>Back</button>
          </header>
          <p className="muted center">
            {deviceRekeyError
              ?? (
                selected.e2ee_ready && !selectedTracked
                  ? "This device is waiting to be added to the secure conversation."
                  : "This encrypted conversation is unavailable until the local MLS state is ready."
              )}
          </p>
        </section>
      </main>
    );
  }

  if (selected) {
    return (
      <main className="messenger-page">
        <section className="messenger-shell minimal-messenger-frame">
          <ConversationView
            conversation={selected}
            user={user}
            realtime={realtimeClient}
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
      <section className="messenger-shell minimal-messenger-frame">
        <header className="messenger-topbar minimal-list-topbar">
          <div className="minimal-list-heading">
            <strong>Messages</strong>
            <span>{user.display_name} · {connectionState === "online" ? "online" : "reconnecting"}</span>
          </div>
          <button className="minimal-header-action" type="button" onClick={() => setCreating(true)} aria-label="New secure chat">＋</button>
        </header>

        {creating ? (
          <NewChat
            onCreated={addConversation}
            onCancel={() => setCreating(false)}
            adapter={e2eeState === "ready" ? e2eeAdapter : null}
          />
        ) : (
          <div className="conversation-list minimal-chat-list">
            <button
              className="new-chat-button minimal-new-chat-button"
              type="button"
              disabled={e2eeState !== "ready"}
              onClick={() => setCreating(true)}
            >
              {e2eeState === "initializing" ? "Preparing secure messaging…" : "New secure chat"}
            </button>
            {loading ? <p className="muted center">Loading…</p> : conversations.length === 0 ? (
              <div className="empty-conversations">
                <div className="empty-icon" aria-hidden="true">•••</div>
                <h2>No conversations yet</h2>
                <p>Start a private chat with an invited member.</p>
              </div>
            ) : conversations.map((conversation) => {
              const unread = Math.max(0, conversation.latest_sequence - conversation.last_read_sequence);
              return (
                <button key={conversation.id} type="button" className="conversation-item minimal-chat-item" onClick={() => setSelectedId(conversation.id)}>
                  <span className="avatar minimal-avatar">{conversationInitials(conversationTitle(conversation, user.id))}</span>
                  <span className="conversation-copy">
                    <strong>{conversation.is_pinned ? "★ " : ""}{conversationTitle(conversation, user.id)}</strong>
                    <small>{[
                      conversation.type === "group" ? conversation.members.length + " members" : "Private chat",
                      conversation.encryption_required ? "Encrypted" : null,
                      conversation.notifications_muted ? "Muted" : null,
                    ].filter(Boolean).join(" · ")}</small>
                  </span>
                  {unread > 0
                    ? <span className="unread-badge">{unread > 99 ? "99+" : unread}</span>
                    : <span className="minimal-row-chevron" aria-hidden="true">›</span>}
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

        <footer className="messenger-footer minimal-messenger-footer">
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
