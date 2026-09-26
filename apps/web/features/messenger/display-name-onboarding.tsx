"use client";

import { useState } from "react";
import { messengerApi } from "./api";
import { SudokuEscapeButton } from "./sudoku-escape-button";
import type { CurrentUser } from "./types";

export const profileConfirmedKey = (userId: string) =>
  `sudoku.profile-name-confirmed.v1:${userId}`;

export function DisplayNameOnboarding({
  user,
  onDone,
  onHide,
}: {
  user: CurrentUser;
  onDone: (user: CurrentUser) => void;
  onHide: () => void;
}) {
  const [value, setValue] = useState(user.display_name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const next = value.trim();
    if (!next || busy) return;
    setBusy(true);
    setError(null);
    try {
      const updated = next === user.display_name
        ? user
        : await messengerApi.updateDisplayName(next);
      try {
        localStorage.setItem(profileConfirmedKey(updated.id), "1");
      } catch {
        // The preference is convenience only; account data remains server-side.
      }
      onDone(updated);
    } catch {
      setError("Unable to save your display name. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const preview = value.trim() || "Your name";

  return (
    <main className="page profile-onboarding-screen" aria-label="Display name setup">
      <section className="messenger-lock auth-card profile-onboarding-card">
        <div className="pin-card-heading">
          <span className="pin-card-kicker">YOUR PROFILE</span>
          <h2>How should people see you?</h2>
          <p>This is your Messenger name. Your phone number stays your login identity.</p>
        </div>

        <div className="profile-preview" aria-label="Display name preview">
          <span className="avatar minimal-avatar">{preview.slice(0, 1).toUpperCase()}</span>
          <span>
            <strong>{preview}</strong>
            <small>Sudoku Messenger</small>
          </span>
        </div>

        <label className="profile-name-field">
          <span>Display name</span>
          <input
            type="text"
            autoComplete="name"
            maxLength={120}
            value={value}
            autoFocus
            onChange={(event) => {
              setValue(event.target.value);
              setError(null);
            }}
            disabled={busy}
          />
        </label>

        {error ? <p className="form-error" role="alert">{error}</p> : null}

        <button
          type="button"
          className="primary-button"
          disabled={busy || !value.trim()}
          onClick={() => void save()}
        >
          {busy ? "Saving…" : "Continue"}
        </button>
      </section>
      <SudokuEscapeButton onHide={onHide} />
    </main>
  );
}
