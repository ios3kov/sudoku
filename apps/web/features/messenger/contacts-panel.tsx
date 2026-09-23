"use client";

import { useCallback, useEffect, useState } from "react";
import { messengerApi } from "./api";
import { ContactAccess } from "./contact-access";
import type { ContactDirectoryItem } from "./types";

export function ContactsPanel({ onClose }: { onClose: () => void }) {
  const [contacts, setContacts] = useState<ContactDirectoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
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

  useEffect(() => { void load(); }, [load]);

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
              <div><strong>{contact.display_name}</strong><small>{contact.phone_e164}</small></div>
              <button type="button" disabled={busyId === contact.id} onClick={() => void remove(contact.id)}>
                {busyId === contact.id ? "Removing…" : "Remove"}
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
