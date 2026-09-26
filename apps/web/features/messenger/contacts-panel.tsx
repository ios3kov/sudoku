"use client";

import { useCallback, useEffect, useState } from "react";
import { messengerApi } from "./api";
import { conversationInitials } from "./chat-utils";
import { ContactAccess } from "./contact-access";
import type { ContactDirectoryItem } from "./types";

export function ContactsPanel({
  onClose,
  onOpenContact,
  chatEnabled,
}: {
  onClose: () => void;
  onOpenContact: (contact: ContactDirectoryItem) => Promise<void>;
  chatEnabled: boolean;
}) {
  const [contacts, setContacts] = useState<ContactDirectoryItem[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (term = "") => {
    setLoading(true);
    setError(null);
    try {
      setContacts(await messengerApi.contacts(term));
    } catch {
      setError("Unable to load contacts.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(query.trim()); }, query ? 180 : 0);
    return () => window.clearTimeout(timer);
  }, [load, query]);

  async function open(contact: ContactDirectoryItem) {
    if (!chatEnabled || openingId) return;
    setOpeningId(contact.id);
    setError(null);
    try {
      await onOpenContact(contact);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to open secure chat.");
    } finally {
      setOpeningId(null);
    }
  }

  async function remove(userId: string) {
    setBusyId(userId);
    setError(null);
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
    <section className="settings-panel contacts-panel" role="dialog" aria-label="Phone contacts">
      <div className="settings-header">
        <div><strong>Contacts</strong><span>People you can message securely</span></div>
        <button type="button" onClick={onClose}>Close</button>
      </div>

      <div className="contacts-search">
        <span aria-hidden="true">⌕</span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search contacts"
          aria-label="Search contacts"
        />
      </div>

      <ContactAccess onSynced={() => void load(query.trim())} />

      {error ? <p className="form-error" role="alert">{error}</p> : null}

      {loading ? (
        <div className="contact-list is-loading" aria-busy="true">
          {Array.from({ length: 4 }, (_, index) => (
            <div className="contact-row is-skeleton" key={index} aria-hidden="true">
              <span className="avatar minimal-avatar" />
              <span />
            </div>
          ))}
        </div>
      ) : contacts.length === 0 ? (
        <div className="empty-conversations compact">
          <p>{query ? "No matching registered contacts." : "No registered contacts yet."}</p>
        </div>
      ) : (
        <div className="contact-list">
          {contacts.map((contact) => (
            <div className="contact-row" key={contact.id}>
              <button
                type="button"
                className="contact-primary"
                disabled={!chatEnabled || openingId === contact.id}
                onClick={() => void open(contact)}
                aria-label={`Open chat with ${contact.display_name}`}
              >
                <span className="avatar minimal-avatar">{conversationInitials(contact.display_name)}</span>
                <span className="contact-copy">
                  <strong>{contact.display_name}</strong>
                  <small>{contact.phone_e164}</small>
                </span>
                <span className="minimal-row-chevron" aria-hidden="true">›</span>
              </button>
              <button
                type="button"
                className="contact-remove"
                aria-label={`Remove ${contact.display_name}`}
                disabled={busyId === contact.id || openingId === contact.id}
                onClick={() => void remove(contact.id)}
              >
                {busyId === contact.id ? "…" : "×"}
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
