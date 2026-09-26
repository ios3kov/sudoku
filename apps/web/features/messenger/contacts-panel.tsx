"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { messengerApi } from "./api";
import { conversationInitials } from "./chat-utils";
import { ContactAccess } from "./contact-access";
import {
  loadAuthorizedAddressBook,
  localNameForPhone,
  phoneQueryMatches,
  searchLocalAddressBook,
  type LocalAddressBookContact,
} from "./local-contact-directory";
import { NATIVE_CONTACTS_READY_EVENT } from "./native-contact-access";
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
  const [localContacts, setLocalContacts] = useState<LocalAddressBookContact[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
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

  const loadLocal = useCallback(async () => {
    try {
      const { contacts: next } = await loadAuthorizedAddressBook();
      setLocalContacts(next);
    } catch {
      setLocalContacts([]);
    }
  }, []);

  useEffect(() => {
    void load();
    void loadLocal();
    const refresh = () => { void loadLocal(); };
    window.addEventListener(NATIVE_CONTACTS_READY_EVENT, refresh);
    return () => window.removeEventListener(NATIVE_CONTACTS_READY_EVENT, refresh);
  }, [load, loadLocal]);

  const visibleContacts = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    const digits = query.replace(/\D/g, "");
    if (!term) return contacts;
    return contacts.filter((contact) => {
      const localName = localNameForPhone(localContacts, contact.phone_e164) ?? "";
      return contact.display_name.toLocaleLowerCase().includes(term)
        || localName.toLocaleLowerCase().includes(term)
        || (digits && phoneQueryMatches(contact.phone_e164, query));
    });
  }, [contacts, localContacts, query]);

  const nonUsers = useMemo(() => {
    const registeredPhones = new Set(contacts.map((item) => item.phone_e164));
    const source = query.trim()
      ? searchLocalAddressBook(localContacts, query)
      : localContacts;
    return source
      .map((contact) => ({
        ...contact,
        phones: contact.phones.filter((phone) => !registeredPhones.has(phone)),
      }))
      .filter((contact) => contact.phones.length > 0);
  }, [contacts, localContacts, query]);

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

      <ContactAccess onSynced={() => {
        void load();
        void loadLocal();
      }} />

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
      ) : visibleContacts.length === 0 ? (
        <div className="empty-conversations compact">
          <p>{query ? "No matching registered contacts." : "No registered contacts yet."}</p>
        </div>
      ) : (
        <>
          <div className="contact-section-label">On Sudoku</div>
          <div className="contact-list">
            {visibleContacts.map((contact) => {
              const localName = localNameForPhone(localContacts, contact.phone_e164);
              return (
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
                      <small>{localName && localName !== contact.display_name ? localName : contact.phone_e164}</small>
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
              );
            })}
          </div>
        </>
      )}

      {nonUsers.length > 0 ? (
        <>
          <div className="contact-section-label secondary">Not on Sudoku</div>
          <div className="contact-list local-only-list">
            {nonUsers.slice(0, 50).map((contact) => (
              <div className="contact-row local-only" key={`${contact.name}|${contact.phones[0]}`}>
                <span className="avatar minimal-avatar">{conversationInitials(contact.name || "?")}</span>
                <span className="contact-copy">
                  <strong>{contact.name || "Contact"}</strong>
                  <small>{contact.phones[0]}</small>
                </span>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}
