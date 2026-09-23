"use client";

import { FormEvent, useState } from "react";
import { messengerApi } from "./api";

type PickerContact = { name?: string[]; tel?: string[] };
type ContactsManagerLike = {
  select: (properties: string[], options?: { multiple?: boolean }) => Promise<PickerContact[]>;
};

function normalizePhone(value: string): string {
  return value.replace(/[\s().-]+/g, "");
}

export function ContactAccess({ onSynced }: { onSynced: () => void }) {
  const [manual, setManual] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const contacts = typeof navigator === "undefined"
    ? undefined
    : (navigator as Navigator & { contacts?: ContactsManagerLike }).contacts;
  const pickerAvailable = Boolean(contacts);

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
    if (!contacts || busy) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      // Call select() directly from the click handler: Contact Picker requires
      // transient user activation and must not be delayed behind another await.
      const selected = await contacts.select(["tel"], { multiple: true });
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

  function submitManual(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = manual.trim();
    if (!value) return;
    void syncPhones([value]).then(() => setManual(""));
  }

  return (
    <section className="contact-access" aria-label="Phone contacts">
      <div className="contact-access-actions">
        {pickerAvailable ? (
          <button type="button" disabled={busy} onClick={() => void chooseContacts()}>
            {busy ? "Syncing…" : "Choose phone contacts"}
          </button>
        ) : null}
        <form onSubmit={submitManual}>
          <input
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="+382..."
            aria-label="Add contact by phone"
            value={manual}
            onChange={(event) => setManual(event.target.value)}
            disabled={busy}
          />
          <button type="submit" disabled={busy || !manual.trim()}>Add contact</button>
        </form>
      </div>
      <p className="muted contact-access-help">
        {pickerAvailable
          ? "Only phone numbers you explicitly choose are shared with the app."
          : "This browser cannot open the system phone book. Add a contact number manually."}
      </p>
      {notice ? <p role="status">{notice}</p> : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </section>
  );
}
