"use client";

import { useState } from "react";
import { messengerApi } from "./api";
import type { CurrentUser } from "./types";

export function ProfilePanel({
  user,
  onUpdated,
  onClose,
}: {
  user: CurrentUser;
  onUpdated: (user: CurrentUser) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(user.display_name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const normalized = value.trim();
  const changed = normalized !== user.display_name;
  const valid = normalized.length >= 1 && normalized.length <= 120;

  async function save() {
    if (!valid || !changed || busy) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const next = await messengerApi.updateDisplayName(normalized);
      onUpdated(next);
      setValue(next.display_name);
      setSaved(true);
    } catch (reason) {
      const detail = reason instanceof Error ? reason.message : "";
      setError(detail && !detail.startsWith("HTTP ") ? detail : "Unable to update display name.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-panel" role="dialog" aria-label="Profile">
      <div className="settings-header">
        <div>
          <strong>Profile</strong>
          <span>Your public Messenger name.</span>
        </div>
        <button type="button" onClick={onClose}>Close</button>
      </div>
      <div className="auth-form">
        <label>Display name
          <input
            type="text"
            autoComplete="name"
            maxLength={120}
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setSaved(false);
            }}
          />
        </label>
        <button className="primary-button" type="button" disabled={!valid || !changed || busy} onClick={() => void save()}>
          {busy ? "Saving…" : "Save name"}
        </button>
        <p className="device-access-help">Phone remains your private login/contact identity.</p>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        {saved ? <p role="status">Display name updated.</p> : null}
      </div>
    </section>
  );
}
