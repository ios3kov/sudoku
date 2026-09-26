"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { messengerApi } from "./api";
import { NATIVE_CONTACTS_READY_EVENT, nativeContactsAvailable, selectNativeContacts } from "./native-contact-access";
import { PhoneInput } from "./phone-input";
import { countryFromLocale, toE164 } from "./phone-number";

type PickerContact = { name?: string[]; tel?: string[] };
type ContactsManagerLike = {
  getProperties: () => Promise<string[]>;
  select: (properties: string[], options?: { multiple?: boolean }) => Promise<PickerContact[]>;
};

export function ContactAccess({ onSynced }: { onSynced: () => void }) {
  const [manualDisplay, setManualDisplay] = useState("");
  const [manual, setManual] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const contactsRef = useRef<ContactsManagerLike | null>(null);
  const [pickerAvailable, setPickerAvailable] = useState(false);
  const [nativePickerAvailable, setNativePickerAvailable] = useState(false);

  useEffect(() => {
    function refreshNativeAvailability() {
      setNativePickerAvailable(nativeContactsAvailable());
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
    const defaultCountry = countryFromLocale(
      typeof navigator !== "undefined" ? navigator.language : undefined,
    );
    const normalized = [...new Set(
      phones
        .map((phone) => toE164(phone, defaultCountry))
        .filter((phone): phone is string => Boolean(phone)),
    )];
    if (normalized.length === 0) {
      setError("No valid phone numbers were selected.");
      return;
    }
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
      const defaultCountry = countryFromLocale(
        typeof navigator !== "undefined" ? navigator.language : undefined,
      );
      const normalized = [...new Set(
        phones
          .map((phone) => toE164(phone, defaultCountry))
          .filter((phone): phone is string => Boolean(phone)),
      )];
      if (normalized.length === 0) {
        setNotice("No valid phone numbers selected.");
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
    if (!manual) return;
    void syncPhones([manual]).then(() => {
      setManual("");
      setManualDisplay("");
    });
  }

  return (
    <section className="contact-access" aria-label="Phone contacts">
      <div className="contact-access-actions">
        {nativePickerAvailable || pickerAvailable ? (
          <button type="button" disabled={busy} onClick={() => void chooseContacts()}>
            {busy ? "Syncing…" : "Choose phone contacts"}
          </button>
        ) : null}
        <form onSubmit={submitManual}>
          <PhoneInput
            label="Add contact by phone"
            value={manualDisplay}
            disabled={busy}
            onValueChange={(canonical, display) => {
              setManualDisplay(display);
              setManual(canonical ?? "");
            }}
          />
          <button type="submit" disabled={busy || !manual}>Add contact</button>
        </form>
      </div>
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
