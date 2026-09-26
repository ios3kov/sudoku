"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { messengerApi } from "./api";
import { NATIVE_CONTACTS_READY_EVENT, nativeContactsAvailable, nativeFullContactsAvailable, readAllNativeContacts, selectNativeContacts } from "./native-contact-access";
import { canonicalizePhone, initialPhoneCountry, PhoneInput } from "./phone-input";

type PickerContact = { name?: string[]; tel?: string[] };
type ContactsManagerLike = {
  getProperties: () => Promise<string[]>;
  select: (properties: string[], options?: { multiple?: boolean }) => Promise<PickerContact[]>;
};

function normalizePhone(value: string): string {
  const locale = typeof navigator === "undefined" ? "en-ME" : navigator.language;
  return canonicalizePhone(value, initialPhoneCountry(locale));
}

export function ContactAccess({ onSynced }: { onSynced: () => void }) {
  const [manual, setManual] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const contactsRef = useRef<ContactsManagerLike | null>(null);
  const [pickerAvailable, setPickerAvailable] = useState(false);
  const [nativePickerAvailable, setNativePickerAvailable] = useState(false);
  const [nativeFullAvailable, setNativeFullAvailable] = useState(false);
  const [showFullExplanation, setShowFullExplanation] = useState(false);

  useEffect(() => {
    function refreshNativeAvailability() {
      setNativePickerAvailable(nativeContactsAvailable());
      setNativeFullAvailable(nativeFullContactsAvailable());
    }

    refreshNativeAvailability();
    window.addEventListener(NATIVE_CONTACTS_READY_EVENT, refreshNativeAvailability);

    let cancelled = false;
    const manager = (navigator as Navigator & { contacts?: ContactsManagerLike }).contacts ?? null;
    contactsRef.current = manager;
    if (manager) {
      void manager.getProperties()
        .then((properties) => {
          if (!cancelled) setPickerAvailable(properties.includes("tel"));
        })
        .catch(() => {
          if (!cancelled) setPickerAvailable(false);
        });
    }
    return () => {
      cancelled = true;
      contactsRef.current = null;
      window.removeEventListener(NATIVE_CONTACTS_READY_EVENT, refreshNativeAvailability);
    };
  }, []);

  async function syncPhones(phones: string[]) {
    const normalized = [...new Set(phones.map(normalizePhone).filter(Boolean))];
    if (normalized.length === 0) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const matched = await messengerApi.syncContacts(normalized);
      setNotice(`${matched.length} registered contact${matched.length === 1 ? "" : "s"} available.`);
      onSynced();
    } catch {
      setError("Unable to sync contacts.");
    } finally {
      setBusy(false);
    }
  }

  async function chooseContacts() {
    if (busy) return;
    const contacts = contactsRef.current;
    if (!nativePickerAvailable && !contacts) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      // Keep the picker call directly in the user click handler. Browser Contact
      // Picker requires transient activation; the native bridge also presents
      // its system picker immediately rather than silently reading contacts.
      const selected = nativePickerAvailable
        ? await selectNativeContacts()
        : await contacts!.select(["tel"], { multiple: true });
      const phones = selected.flatMap((item) => item.tel ?? []);
      const normalized = [...new Set(phones.map(normalizePhone).filter(Boolean))];
      if (normalized.length === 0) {
        setNotice("No phone numbers selected.");
        return;
      }
      const matched = await messengerApi.syncContacts(normalized);
      setNotice(`${matched.length} registered contact${matched.length === 1 ? "" : "s"} available.`);
      onSynced();
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      setError("Unable to access selected contacts.");
    } finally {
      setBusy(false);
    }
  }

  async function syncAllContacts() {
    if (busy || !nativeFullAvailable) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const contacts = await readAllNativeContacts();
      const phones = contacts.flatMap((item) => item.tel ?? []);
      const normalized = [...new Set(phones.map(normalizePhone).filter(Boolean))];
      if (normalized.length === 0) {
        setNotice("No phone numbers found in Contacts.");
        return;
      }
      const matched = await messengerApi.syncContacts(normalized, true);
      setNotice(`${matched.length} registered contact${matched.length === 1 ? "" : "s"} available.`);
      setShowFullExplanation(false);
      onSynced();
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      setError("Full Contacts access was not granted. You can still choose contacts or add a number manually.");
      setShowFullExplanation(false);
    } finally {
      setBusy(false);
    }
  }

  function submitManual(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = manual.trim();
    if (!value) return;
    void syncPhones([value]).then(() => setManual(""));
  }

  return (
    <section className="contact-access" aria-label="Phone contacts">
      <div className="contact-access-actions">
        {nativePickerAvailable || pickerAvailable ? (
          <button type="button" disabled={busy} onClick={() => void chooseContacts()}>
            {busy ? "Syncing…" : "Choose contacts"}
          </button>
        ) : null}
        {nativeFullAvailable ? (
          <button
            type="button"
            className="contact-full-access-button"
            disabled={busy}
            onClick={() => {
              setError(null);
              setNotice(null);
              setShowFullExplanation(true);
            }}
          >
            Allow all contacts
          </button>
        ) : null}
        <form onSubmit={submitManual} className="contact-manual-form">
          <PhoneInput
            value={manual}
            onChange={setManual}
            label="Add contact by phone"
            disabled={busy}
          />
          <button type="submit" disabled={busy || !manual.trim()}>Add</button>
        </form>
      </div>
      {showFullExplanation ? (
        <div className="contact-full-access-explanation" role="dialog" aria-label="Allow all contacts">
          <strong>Find people already using Sudoku Messenger</strong>
          <p>
            We’ll read names and phone numbers on this iPhone and send only phone numbers for matching registered users.
            Unmatched address-book entries are not stored as contacts on the server.
          </p>
          <div>
            <button type="button" className="primary-button" disabled={busy} onClick={() => void syncAllContacts()}>
              {busy ? "Syncing…" : "Continue"}
            </button>
            <button type="button" className="secondary-button" disabled={busy} onClick={() => setShowFullExplanation(false)}>
              Not now
            </button>
          </div>
        </div>
      ) : null}
      <p className="muted contact-access-help">
        {nativePickerAvailable
          ? "Choose contacts with the iPhone system picker. Only selected phone numbers are shared with the app."
          : pickerAvailable
            ? "Only phone numbers you explicitly choose are shared with the app."
            : "This browser cannot open the system phone book. Add a contact number manually."}
      </p>
      {notice ? <p role="status">{notice}</p> : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </section>
  );
}
