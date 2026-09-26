"use client";

import { useState } from "react";
import { messengerApi } from "./api";
import type { CurrentUser } from "./types";

export function DisplayNameOnboarding({
  user,
  onComplete,
  onHide,
}: {
  user: CurrentUser;
  onComplete: (user: CurrentUser) => void;
  onHide: () => void;
}) {
  const [value, setValue] = useState(user.profile_setup_completed ? user.display_name : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const normalized = value.trim();
  const valid = normalized.length >= 1 && normalized.length <= 120
    && [...normalized].some((char) => char.trim() && char.isWellFormed?.() !== false);

  async function save() {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      onComplete(await messengerApi.updateDisplayName(normalized));
    } catch (reason) {
      const detail = reason instanceof Error ? reason.message : "";
      setError(detail && !detail.startsWith("HTTP ") ? detail : "Unable to save your display name.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page" aria-label="Display name setup">
      <section className="messenger-lock auth-card profile-onboarding-card">
        <div className="private-header">
          <div>
            <h2>How should people see you?</h2>
            <p>Messenger profile</p>
          </div>
          <button className="text-button" type="button" disabled={busy} onClick={onHide}>Hide</button>
        </div>

        <label className="profile-name-field">
          Display name
          <input
            type="text"
            autoComplete="name"
            maxLength={120}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="Your name or nickname"
            disabled={busy}
            autoFocus
          />
        </label>

        <div className="profile-name-preview" aria-label="Display name preview">
          <span className="avatar">{(normalized || "?").slice(0, 1).toUpperCase()}</span>
          <div>
            <small>Preview</small>
            <strong>{normalized || "Your name"}</strong>
          </div>
        </div>

        <p className="device-access-help">
          This is what people see in Messenger. Your phone number remains your login and contact identity.
        </p>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <button className="primary-button" type="button" disabled={!valid || busy} onClick={() => void save()}>
          {busy ? "Saving…" : "Continue"}
        </button>
      </section>
    </main>
  );
}
