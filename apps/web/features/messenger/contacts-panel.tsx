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
  onOpenChat: (contact: ContactDirectoryItem) => Promise<void>;
}) {
  const [contacts, setContacts] = useState<ContactDirectoryItem[]>([]);
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

  // Load remote contacts on mount; this also shares the explicit refresh loading state.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

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
    <section className="settings-panel" role="dialog" aria-label="Phone contacts">
      <div className="settings-header">
        <div>
          <strong>Contacts</strong>
          <span>Tap a registered contact to open a secure chat.</span>
        </div>
        <button type="button" onClick={onClose}>Close</button>
      </div>
      <ContactAccess onSynced={() => void load()} />
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {loading ? <p className="muted">Loading contacts…</p> : (
        <div className="settings-list">
          {contacts.length === 0 ? <p className="muted">No registered contacts yet.</p> : contacts.map((contact) => (
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
          ))}
        </div>
      )}
    </section>
  );
}
