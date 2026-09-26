"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { messengerApi } from "./api";
import { applyReadReceipt } from "./conversation-receipts";
import { AdminInvite } from "./admin-invite";
import { ConversationView } from "./conversation-view";
import { EncryptedConversationView } from "./encrypted-conversation-view";
import { conversationInitials, conversationTitle } from "./chat-utils";
import { NewChat } from "./new-chat";
import { clearPending } from "./outbox";
import { concealRevokedSession } from "./conceal-revoked-session";
import { RealtimeClient } from "./realtime";
import { enableMaskedPush } from "./push";
import { DeviceSessions } from "./device-sessions";
import { ContactsPanel } from "./contacts-panel";
import { OpenMlsProtocolAdapter } from "./crypto/openmls-adapter";
import type { Conversation, CurrentUser, RealtimeEvent } from "./types";

function sortConversations(items: Conversation[]): Conversation[] {
  return [...items].sort((a, b) => {
    if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
    return b.created_at.localeCompare(a.created_at);
  });
}

export function MessengerShell({ user, onHide, onLoggedOut, onUserUpdated }: { user: CurrentUser; onHide: () => void; onLoggedOut: () => void; onUserUpdated: (user: CurrentUser) => void }) {
  const [loggingOut, setLoggingOut] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationQuery, setConversationQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [conversationLoadError, setConversationLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [latestEvent, setLatestEvent] = useState<RealtimeEvent | null>(null);
  const [reconnectTick, setReconnectTick] = useState(0);
  const [connectionState, setConnectionState] = useState<"online" | "reconnecting">("reconnecting");
  const [pushState, setPushState] = useState<"idle" | "enabling" | "enabled" | "error">("idle");
  const [showInvite, setShowInvite] = useState(false);
  const [showDevices, setShowDevices] = useState(false);
  const [showContacts, setShowContacts] = useState(false);
  const [secureSetupBusy, setSecureSetupBusy] = useState(false);
  const [secureSetupError, setSecureSetupError] = useState<string | null>(null);
  const [deviceRekeyError, setDeviceRekeyError] = useState<string | null>(null);
  const [e2eeState, setE2eeState] = useState<"initializing" | "ready" | "error">("initializing");
  const [realtimeClient, setRealtimeClient] = useState<RealtimeClient | null>(null);
  const [e2eeAdapter, setE2eeAdapter] = useState<OpenMlsProtocolAdapter | null>(null);
  const realtimeRef = useRef<RealtimeClient | null>(null);
  const e2eeRef = useRef<OpenMlsProtocolAdapter | null>(null);
  const conversationsRef = useRef<Conversation[]>([]);
  const concealCallbacks = useRef({onHide, onLoggedOut});
  useEffect(() => { concealCallbacks.current = {onHide, onLoggedOut}; }, [onHide, onLoggedOut]);
  const revokeLocalSession = useCallback(() => {
    realtimeRef.current?.stop();
    const adapter = e2eeRef.current;
    e2eeRef.current = null;
    void concealRevokedSession({
      conceal: () => {
        concealCallbacks.current.onLoggedOut();
        concealCallbacks.current.onHide();
      },
      clearProtocol: async () => { await adapter?.clearLocalState(); },
      clearOutbox: clearPending,
    });
  }, []);

  const loadConversations = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    setConversationLoadError(null);
    try {
      const next = await messengerApi.conversations();
      const sorted = sortConversations(next);
      conversationsRef.current = sorted;
      setConversations(sorted);
    } catch {
      setConversationLoadError("Unable to load conversations");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Synchronize with the remote conversation list, preserving the initial loading state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadConversations(true);
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
    let adapter: OpenMlsProtocolAdapter | null = null;

    // pagehide can destroy the document before React cleanup finishes. Retire
    // the adapter synchronously so an old page cannot write MLS state after a
    // reloaded page has already rehydrated the same device state.
    const retireAdapter = () => { adapter?.retire(); };
    const retireWhenHidden = () => {
      if (document.visibilityState === "hidden") retireAdapter();
    };
    window.addEventListener("pagehide", retireAdapter);
    document.addEventListener("visibilitychange", retireWhenHidden);

    void (async () => {
      try {
        const sessions = await messengerApi.sessions();
        if (cancelled) return;
        const current = sessions.find((session) => session.current);
        if (!current) throw new Error("Current device session is unavailable");

        const currentAdapter = new OpenMlsProtocolAdapter({
          userId: user.id,
          deviceId: current.id,
        });
        adapter = currentAdapter;
        await currentAdapter.initialize();

        if (cancelled) { currentAdapter.retire(); return; }
        e2eeRef.current = currentAdapter;
        setE2eeAdapter(currentAdapter);
        setE2eeState("ready");

        const latestConversations = sortConversations(
          await messengerApi.conversations(),
        );
        if (cancelled) { currentAdapter.retire(); return; }
        conversationsRef.current = latestConversations;
        setConversations(latestConversations);

        const encryptedConversations = latestConversations.filter(
          (conversation) => conversation.encryption_required && conversation.e2ee_ready,
        );
        for (const conversation of encryptedConversations) {
          if (cancelled) return;
          // Unified transport is authoritative for recovery. It includes both
          // MLS control events and application messages in one durable order,
          // so a Welcome must never be consumed first through the legacy
          // control-only feed and then replayed from transport sequence 0.
          await currentAdapter.syncTransport(conversation.id);
          if (currentAdapter.trackedConversationIds().includes(conversation.id)) {
            await reconcileDeviceChange(currentAdapter, conversation.id);
            await currentAdapter.syncTransport(conversation.id);
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
      adapter?.retire();
      window.removeEventListener("pagehide", retireAdapter);
      document.removeEventListener("visibilitychange", retireWhenHidden);
      e2eeRef.current = null;
    };
  }, [reconcileDeviceChange, user.id]);

  const acknowledgeRead = useCallback((conversationId: string, sequence: number, readerId = user.id) => {
    setConversations((current) => {
      const next = current.map((item) => item.id === conversationId
        ? applyReadReceipt(item, user.id, readerId, sequence) : item);
      conversationsRef.current = next;
      return next;
    });
  }, [user.id]);

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

        revokeLocalSession();
      },
      onEvent: (event) => {
        setLatestEvent(event);
        if (event.type === "receipt.updated" && event.conversation_id && event.payload) {
          const receipt = event.payload as { user_id?: unknown; last_read_sequence?: unknown };
          if (typeof receipt.user_id === "string" && typeof receipt.last_read_sequence === "number") {
            acknowledgeRead(event.conversation_id, receipt.last_read_sequence, receipt.user_id);
          }
        }
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
  }, [acknowledgeRead, loadConversations, reconcileDeviceChange, revokeLocalSession, user.id]);

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

  function openNewChat() {
    if (!user.phone_e164) {
      setCreating(false);
      setShowInvite(false);
      setShowContacts(false);
      setShowDevices(true);
      return;
    }
    setShowInvite(false);
    setShowDevices(false);
    setShowContacts(false);
    setCreating(true);
  }

  function toggleInvite() {
    setCreating(false);
    setShowDevices(false);
    setShowContacts(false);
    setShowInvite((value) => !value);
  }

  function toggleDevices() {
    setCreating(false);
    setShowInvite(false);
    setShowContacts(false);
    setShowDevices((value) => !value);
  }

  function toggleContacts() {
    setCreating(false);
    setShowInvite(false);
    setShowDevices(false);
    setShowContacts((value) => !value);
  }

  async function openContactChat(contact: { id: string; display_name: string }) {
    const existing = conversationsRef.current.find(
      (conversation) =>
        conversation.type === "direct"
        && conversation.members.some((member) => member.id === contact.id),
    );

    if (existing) {
      setCreating(false);
      setShowInvite(false);
      setShowDevices(false);
      setShowContacts(false);
      setSelectedId(existing.id);
      return;
    }

    const adapter = e2eeRef.current;
    if (!adapter || e2eeState !== "ready") {
      throw new Error("Secure messaging is still preparing on this device.");
    }

    let conversation = await messengerApi.createDirect(contact.id, true);
    if (!conversation.e2ee_ready) {
      try {
        conversation = await adapter.bootstrapConversation(conversation);
      } catch {
        // The server-side direct conversation is durable/idempotent. Open its
        // secure-setup state instead of making the contact tap a no-op.
      }
    }

    addConversation(conversation);
    setShowContacts(false);
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

  const visibleConversations = conversations.filter((conversation) =>
    conversationTitle(conversation, user.id)
      .toLocaleLowerCase()
      .includes(conversationQuery.trim().toLocaleLowerCase()),
  );
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
          <section className="messenger-shell minimal-messenger-frame messenger-runtime-shell">
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
          <section className="messenger-shell minimal-messenger-frame messenger-runtime-shell">
            <EncryptedConversationView
              key={selected.id}
              conversation={selected}
              user={user}
              adapter={e2eeAdapter}
              realtime={realtimeClient}
              realtimeEvent={latestEvent}
              reconnectTick={reconnectTick}
              onBack={() => setSelectedId(null)}
              onHide={onHide}
              onConversationUpdated={updateConversation}
              onReadAcknowledged={acknowledgeRead}
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
        <section className="messenger-shell minimal-messenger-frame messenger-runtime-shell">
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
        <section className="messenger-shell minimal-messenger-frame messenger-runtime-shell">
          <ConversationView
            key={selected.id}
            conversation={selected}
            user={user}
            realtime={realtimeClient}
            realtimeEvent={latestEvent}
            reconnectTick={reconnectTick}
            onBack={() => setSelectedId(null)}
            onHide={onHide}
            onConversationUpdated={updateConversation}
              onReadAcknowledged={acknowledgeRead}
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
      <section className="messenger-shell minimal-messenger-frame messenger-runtime-shell">
        <header className="messenger-topbar minimal-list-topbar">
          <div className="minimal-list-heading">
            <strong>Messages</strong>
            <span>{user.display_name} · {connectionState === "online" ? "online" : "reconnecting"}</span>
          </div>
          <button className="minimal-header-action" type="button" disabled={e2eeState !== "ready"} onClick={openNewChat} aria-label={e2eeState !== "ready" ? "Preparing secure messaging" : user.phone_e164 ? "New secure chat" : "Set phone number to start chats"}>＋</button>
        </header>

        {creating ? (
          <NewChat
            onCreated={addConversation}
            onCancel={() => setCreating(false)}
            adapter={e2eeState === "ready" ? e2eeAdapter : null}
          />
        ) : (
          <>
            <div className="minimal-conversation-search">
              <span aria-hidden="true">⌕</span>
              <input
                type="search"
                value={conversationQuery}
                onChange={(event) => setConversationQuery(event.target.value)}
                placeholder="Search conversations"
                aria-label="Search conversations"
              />
            </div>
            {!user.phone_e164 ? (
              <div className="messenger-inline-status is-warning" role="status">
                <span>Add a phone number before starting new conversations.</span>
                <button type="button" onClick={toggleDevices}>Set phone</button>
              </div>
            ) : null}
            {conversationLoadError ? (
              <div className="messenger-inline-status is-error" role="alert">
                <span>{conversationLoadError}</span>
                <button type="button" onClick={() => void loadConversations(true)}>Retry</button>
              </div>
            ) : null}
            {e2eeState === "error" ? (
              <div className="messenger-inline-status is-warning" role="status">
                <span>Secure messaging needs a restart.</span>
                <button type="button" onClick={() => window.location.reload()}>Reload</button>
              </div>
            ) : null}
            <div className="conversation-list minimal-chat-list" aria-busy={loading}>
            <button
              className="new-chat-button minimal-new-chat-button"
              type="button"
              disabled={e2eeState !== "ready" || !user.phone_e164}
              onClick={openNewChat}
            >
              {e2eeState === "initializing" ? "Preparing secure messaging…" : !user.phone_e164 ? "Set phone to start a chat" : "New secure chat"}
            </button>
            {loading ? (
              Array.from({ length: 5 }, (_, index) => (
                <div className="conversation-item minimal-chat-item is-skeleton" key={index} aria-hidden="true">
                  <span className="avatar minimal-avatar" />
                  <span className="conversation-copy"><strong /><small /></span>
                </div>
              ))
            ) : conversations.length === 0 && !conversationLoadError ? (
              <div className="empty-conversations">
                <div className="empty-icon" aria-hidden="true">•••</div>
                <h2>No conversations yet</h2>
                <p>Start a private chat with an invited member.</p>
              </div>
            ) : visibleConversations.length === 0 ? (
              <div className="empty-conversations compact">
                <p>No matching conversations.</p>
              </div>
            ) : visibleConversations.map((conversation) => {
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
          </>
        )}

        {user.is_admin && showInvite ? <AdminInvite onClose={() => setShowInvite(false)} /> : null}
        {showDevices ? <DeviceSessions
          onClose={() => setShowDevices(false)}
          onCurrentRevoked={revokeLocalSession}
          onPhoneUpdated={(phone) => onUserUpdated({ ...user, phone_e164: phone })}
        /> : null}
        {showContacts ? <ContactsPanel
          onClose={() => setShowContacts(false)}
          onOpenChat={openContactChat}
        /> : null}

        <footer className="messenger-footer minimal-messenger-footer">
          {user.is_admin ? <button type="button" onClick={toggleInvite}>Invite</button> : null}
          <button type="button" onClick={toggleContacts}>Contacts</button>
          <button type="button" onClick={toggleDevices}>Devices</button>
          <button type="button" onClick={() => void enablePush()} disabled={pushState === "enabling" || pushState === "enabled"}>
            {pushState === "enabled" ? "Notifications on" : pushState === "enabling" ? "Enabling…" : pushState === "error" ? "Retry notifications" : "Enable notifications"}
          </button>
          <button type="button" onClick={logout} disabled={loggingOut}>{loggingOut ? "Signing out…" : "Sign out"}</button>
        </footer>
      </section>
    </main>
  );
}
