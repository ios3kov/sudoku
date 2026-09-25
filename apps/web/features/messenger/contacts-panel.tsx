"use client";

import { useCallback, useEffect, useState } from "react";
import { messengerApi } from "./api";
import { ContactAccess } from "./contact-access";
import type { ContactDirectoryItem } from "./types";

export function ContactsPanel({
  onClose,
  onOpenChat,
}: {
  onClose: () => void;
  onOpenChat: (userId: string) => Promise<void>;
}) {
  const [contacts, setContacts] = useState<ContactDirectoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      setContacts(await messengerApi.contacts());
    } catch {
      setError("Unable to load contacts.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Load remote contacts on mount; this also shares the explicit refresh loading state.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  async function openChat(userId: string) {
    setOpeningId(userId);
    setError(null);
    try {
      await onOpenChat(userId);
    } catch {
      setError("Unable to open secure chat.");
    } finally {
      setOpeningId(null);
    }
  }

  async function remove(userId: string) {
    setBusyId(userId); setError(null);
    try {
      await messengerApi.removeContact(userId);
      setContacts((current) => current.filter((item) => item.id !== userId));
    } catch {
      setError("Unable to remove contact.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="settings-panel" role="dialog" aria-label="Phone contacts">
      <div className="settings-header">
        <div><strong>Contacts</strong><span>Only synced phone contacts can start new chats.</span></div>
        <button type="button" onClick={onClose}>Close</button>
      </div>
      <ContactAccess onSynced={() => void load()} />
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {loading ? <p className="muted">Loading contacts…</p> : (
        <div className="settings-list">
          {contacts.length === 0 ? <p className="muted">No registered contacts yet.</p> : contacts.map((contact) => (
            <div className="settings-row" key={contact.id}>
              <button
                type="button"
                aria-label={`Open chat with ${contact.display_name}`}
                disabled={busyId === contact.id || openingId !== null}
                onClick={() => void openChat(contact.id)}
              >
                <strong>{contact.display_name}</strong><small>{contact.phone_e164}</small>
              </button>
              <button
                type="button"
                disabled={busyId === contact.id || openingId !== null}
                onClick={() => void remove(contact.id)}
              >
                {busyId === contact.id ? "Removing…" : "Remove"}
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
