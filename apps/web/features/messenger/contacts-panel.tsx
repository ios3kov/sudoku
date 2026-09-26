"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { messengerApi } from "./api";
import { ContactAccess } from "./contact-access";
import type { ContactDirectoryItem } from "./types";

export function ContactsPanel({
  onClose,
  onOpenChat,
  conversationPeerIds = [],
  onCreateGroup,
}: {
  onClose: () => void;
  onOpenChat: (contact: ContactDirectoryItem) => Promise<void>;
  conversationPeerIds?: string[];
  onCreateGroup?: () => void;
}) {
  const [contacts, setContacts] = useState<ContactDirectoryItem[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setContacts(await messengerApi.contacts());
    } catch {
      setError("Unable to load contacts.");
    } finally {
      setLoading(false);
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const peerIds = useMemo(() => new Set(conversationPeerIds), [conversationPeerIds]);
  const filtered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    if (!term) return contacts;
    const digits = term.replace(/\D/g, "");
    return contacts.filter((contact) =>
      contact.display_name.toLocaleLowerCase().includes(term)
      || contact.phone_e164.toLocaleLowerCase().includes(term)
      || (digits && contact.phone_e164.replace(/\D/g, "").includes(digits))
    );
  }, [contacts, query]);

  async function openChat(contact: ContactDirectoryItem) {
    if (busyId || removingId) return;
    setBusyId(contact.id);
    setError(null);
    try {
      await onOpenChat(contact);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to open chat.");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(userId: string) {
    if (busyId || removingId) return;
    setRemovingId(userId);
    setError(null);
    try {
      await messengerApi.removeContact(userId);
      setContacts((current) => current.filter((item) => item.id !== userId));
    } catch {
      setError("Unable to remove contact.");
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <section className="settings-panel contacts-primary-panel" role="dialog" aria-label="Phone contacts">
      <div className="settings-header">
        <div>
          <strong>Contacts</strong>
          <span>Search a registered contact and tap once to chat.</span>
        </div>
        <button type="button" onClick={onClose}>Close</button>
      </div>

      <ContactAccess onSynced={() => void load()} />

      <div className="contacts-primary-search">
        <span aria-hidden="true">⌕</span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search contacts"
          aria-label="Search contacts"
          autoComplete="off"
          autoFocus
        />
      </div>

      {onCreateGroup ? (
        <button className="secondary-button contacts-group-action" type="button" onClick={onCreateGroup}>
          Create group
        </button>
      ) : null}

      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {loading ? <p className="muted">Loading contacts…</p> : (
        <div className="settings-list contacts-primary-list">
          {contacts.length === 0 ? (
            <p className="muted">No registered contacts yet. Add one above to start a private chat.</p>
          ) : filtered.length === 0 ? (
            <p className="muted">No matching contacts.</p>
          ) : filtered.map((contact) => {
            const hasChat = peerIds.has(contact.id);
            return (
              <div className="settings-row contact-chat-row" key={contact.id}>
                <button
                  type="button"
                  className="contact-chat-action"
                  disabled={Boolean(busyId || removingId)}
                  onClick={() => void openChat(contact)}
                  aria-label={`Open secure chat with ${contact.display_name}`}
                >
                  <span className="avatar">{contact.display_name.slice(0, 1).toUpperCase()}</span>
                  <span>
                    <strong>{contact.display_name}</strong>
                    <small>{contact.phone_e164}</small>
                    <small className={hasChat ? "contact-status is-active" : "contact-status"}>
                      {hasChat ? "Chat exists" : "Tap to start chat"}
                    </small>
                  </span>
                  <span aria-hidden="true">›</span>
                </button>
                <button
                  type="button"
                  className="text-button"
                  disabled={Boolean(busyId || removingId)}
                  onClick={() => void remove(contact.id)}
                >
                  {removingId === contact.id ? "Removing…" : "Remove"}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
