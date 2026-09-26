"use client";

import { useEffect, useMemo, useState } from "react";
import { messengerApi } from "./api";
import {
  NATIVE_CONTACTS_READY_EVENT,
  nativeContactsAuthorization,
  nativeContactsAvailable,
  nativeFullContactsAvailable,
  requestAllNativeContacts,
  selectNativeContacts,
  type NativeContactsAuthorization,
} from "./native-contact-access";
import {
  normalizeNativeContacts,
  searchLocalContacts,
  type LocalContactSuggestion,
} from "./local-contact-search";
import {
  PHONE_COUNTRIES,
  countryFromLocale,
  formatPhone,
  toE164,
} from "./phone-number";

export function AdminInvite({ onClose }: { onClose: () => void }) {
  const defaultCountry = useMemo(
    () => countryFromLocale(typeof navigator !== "undefined" ? navigator.language : undefined),
    [],
  );
  const [countryCode, setCountryCode] = useState(defaultCountry);
  const [query, setQuery] = useState("");
  const [contacts, setContacts] = useState<LocalContactSuggestion[]>([]);
  const [selected, setSelected] = useState<LocalContactSuggestion | null>(null);
  const [nativePicker, setNativePicker] = useState(false);
  const [fullContacts, setFullContacts] = useState(false);
  const [fullStatus, setFullStatus] = useState<NativeContactsAuthorization | null>(null);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      const picker = nativeContactsAvailable();
      const full = nativeFullContactsAvailable();
      if (cancelled) return;
      setNativePicker(picker);
      setFullContacts(full);

      if (!full) {
        setFullStatus(null);
        setContacts([]);
        return;
      }

      try {
        const status = await nativeContactsAuthorization();
        if (cancelled) return;
        setFullStatus(status);
      } catch {
        if (!cancelled) setFullStatus(null);
      }
    }

    void refresh();
    window.addEventListener(NATIVE_CONTACTS_READY_EVENT, refresh);
    return () => {
      cancelled = true;
      window.removeEventListener(NATIVE_CONTACTS_READY_EVENT, refresh);
    };
  }, [countryCode]);

  const suggestions = useMemo(
    () => searchLocalContacts(contacts, query, countryCode),
    [contacts, countryCode, query],
  );
  const manualPhone = toE164(query, countryCode);
  const manualAlreadySuggested = manualPhone
    ? suggestions.some((contact) => contact.phone === manualPhone)
    : false;

  async function allowOrRefreshFullContacts() {
    if (!fullContacts || loadingContacts) return;
    setLoadingContacts(true);
    setError(null);
    try {
      const raw = await requestAllNativeContacts();
      const status = await nativeContactsAuthorization().catch(() => null);
      if (status) setFullStatus(status);
      setContacts(normalizeNativeContacts(raw, countryCode));
    } catch {
      const status = await nativeContactsAuthorization().catch(() => null);
      if (status) setFullStatus(status);
      setError(
        status === "denied" || status === "restricted"
          ? "Full Contacts access is off. Use Choose contact or type a phone number."
          : "Unable to load Contacts.",
      );
    } finally {
      setLoadingContacts(false);
    }
  }

  async function chooseContact() {
    if (!nativePicker || loadingContacts) return;
    setLoadingContacts(true);
    setError(null);
    try {
      const raw = await selectNativeContacts();
      const normalized = normalizeNativeContacts(raw, countryCode);
      const first = normalized[0];
      if (first) {
        setSelected(first);
        setQuery(first.name);
      }
    } catch (reason) {
      if (!(reason instanceof DOMException && reason.name === "AbortError")) {
        setError("Unable to choose contact.");
      }
    } finally {
      setLoadingContacts(false);
    }
  }

  async function createInvite() {
    if (!selected || submitting) return;
    setSubmitting(true);
    setError(null);
    setToken(null);
    try {
      const invite = await messengerApi.createInvite(selected.phone);
      setToken(invite.token);
      setExpiresAt(invite.expires_at);
    } catch (requestError) {
      const status = (requestError as Error & { status?: number }).status;
      setError(status === 429 ? "Too many invites. Try later." : "Unable to create invite");
    } finally {
      setSubmitting(false);
    }
  }

  async function copyToken() {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Copy failed. Select the code manually.");
    }
  }

  return (
    <section className="admin-invite-panel" role="dialog" aria-label="Create invite">
      <div className="admin-invite-header">
        <div><strong>Invite member</strong><span>Admin only</span></div>
        <button type="button" onClick={onClose}>Close</button>
      </div>

      {!token ? (
        <div className="invite-contact-flow">
          <div className="invite-contact-actions">
            {nativePicker ? (
              <button type="button" disabled={loadingContacts} onClick={() => void chooseContact()}>
                {loadingContacts ? "Loading…" : "Choose contact"}
              </button>
            ) : null}
            {fullContacts && fullStatus !== "denied" && fullStatus !== "restricted" ? (
              <button type="button" disabled={loadingContacts} onClick={() => void allowOrRefreshFullContacts()}>
                {loadingContacts
                  ? "Loading…"
                  : fullStatus === "granted" || fullStatus === "limited"
                    ? contacts.length > 0 ? "Refresh contacts" : "Load contacts"
                    : "Allow all contacts"}
              </button>
            ) : null}
          </div>

          {fullContacts && (fullStatus === "denied" || fullStatus === "restricted") ? (
            <p className="muted">Full Contacts access is off. Picker and manual number entry still work.</p>
          ) : null}

          <label className="invite-search-field">
            Search contact or phone
            <span className="invite-search-control">
              <select
                aria-label="Invite phone country"
                value={countryCode}
                onChange={(event) => {
                  setCountryCode(event.target.value);
                  setSelected(null);
                }}
              >
                {PHONE_COUNTRIES.map((country) => (
                  <option key={country.code} value={country.code}>
                    {country.code} +{country.dial}
                  </option>
                ))}
              </select>
              <input
                type="search"
                value={query}
                autoComplete="off"
                placeholder="Name or phone number"
                onChange={(event) => {
                  setQuery(event.target.value);
                  setSelected(null);
                  setError(null);
                }}
              />
            </span>
          </label>

          {query.trim() && !selected ? (
            <div className="invite-suggestions" role="listbox" aria-label="Contact suggestions">
              {suggestions.map((contact) => (
                <button
                  type="button"
                  role="option"
                  aria-selected="false"
                  key={contact.phone}
                  onClick={() => {
                    setSelected(contact);
                    setQuery(contact.name);
                  }}
                >
                  <span className="avatar">{contact.name.slice(0, 1).toUpperCase()}</span>
                  <span>
                    <strong>{contact.name}</strong>
                    <small>{contact.formattedPhone}</small>
                  </span>
                </button>
              ))}
              {manualPhone && !manualAlreadySuggested ? (
                <button
                  type="button"
                  role="option"
                  aria-selected="false"
                  onClick={() => {
                    setSelected({
                      name: "Phone number",
                      phone: manualPhone,
                      formattedPhone: formatPhone(manualPhone, countryCode),
                    });
                  }}
                >
                  <span className="avatar">#</span>
                  <span>
                    <strong>Invite this number</strong>
                    <small>{formatPhone(manualPhone, countryCode)}</small>
                  </span>
                </button>
              ) : null}
              {suggestions.length === 0 && !manualPhone ? (
                <p className="muted">No matching contact. Keep typing a phone number for manual invite.</p>
              ) : null}
            </div>
          ) : null}

          {selected ? (
            <div className="invite-selected-contact" aria-label="Selected invite contact">
              <span className="avatar">{selected.name.slice(0, 1).toUpperCase()}</span>
              <span>
                <small>Selected</small>
                <strong>{selected.name}</strong>
                <span>{selected.formattedPhone}</span>
              </span>
              <button
                type="button"
                aria-label="Clear selected contact"
                onClick={() => {
                  setSelected(null);
                  setQuery("");
                }}
              >
                ×
              </button>
            </div>
          ) : null}

          <p className="muted">One use · expires in 7 days. Only the selected phone number is sent to the server.</p>
          <button
            className="primary-button"
            type="button"
            disabled={!selected || submitting}
            onClick={() => void createInvite()}
          >
            {submitting ? "Creating…" : "Create invite"}
          </button>
        </div>
      ) : (
        <div className="invite-result">
          <p>Share this code privately. It is shown only now.</p>
          <code>{token}</code>
          <button className="primary-button" type="button" onClick={() => void copyToken()}>{copied ? "Copied" : "Copy code"}</button>
          {expiresAt ? <small>Expires {new Date(expiresAt).toLocaleString()}</small> : null}
        </div>
      )}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </section>
  );
}
