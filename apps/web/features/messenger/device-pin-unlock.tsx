"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { acceptUnlock, accessEpoch, forgetUnlock } from "./device-access";
import { PinCellsInput } from "./pin-cells-input";
import { SudokuEscapeButton } from "./sudoku-escape-button";

export function DevicePinUnlock({ onUnlocked, onSignedOut, onHide }: {
  onUnlocked: () => void; onSignedOut: () => void; onHide: () => void;
}) {
  const [mode, setMode] = useState<"pin" | "password">("pin");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(false);
  const busyRef = useRef(false);
  const interactionStarted = useRef(false);

  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();

    void fetch("/v1/auth/device-access", {
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!alive.current) return;
        if (response.status === 401) { onSignedOut(); return; }
        if (!response.ok) return;
        const result = await response.json() as {
          pin_enabled?: boolean;
          password_required?: boolean;
        };
        if (!alive.current || interactionStarted.current) return;
        if (!result.pin_enabled) { onUnlocked(); return; }
        if (result.password_required) {
          setMode("password");
          setValue("");
          setError("PIN attempts exhausted. Use your account password.");
        }
      })
      .catch(() => undefined);

    return () => {
      alive.current = false;
      controller.abort();
    };
  }, [onUnlocked, onSignedOut]);

  async function submitCredential(credential: string) {
    if (busyRef.current) return;
    if (mode === "pin" && !/^[0-9]{4}$/.test(credential)) return;
    if (mode === "password" && !credential) return;

    interactionStarted.current = true;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const started = accessEpoch();

    const resetPinForRetry = () => {
      if (mode !== "pin" || !alive.current) return;
      setValue("");
    };

    try {
      const response = await fetch(
        `/v1/auth/device-access/${mode === "pin" ? "unlock" : "password"}`,
        {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            mode === "pin" ? { pin: credential } : { password: credential },
          ),
        },
      );
      if (!alive.current || started !== accessEpoch()) return;
      if (response.status === 401) { forgetUnlock(); onSignedOut(); return; }
      if (response.status === 409) { onUnlocked(); return; }
      if (!response.ok) {
        if (response.headers.get("X-PIN-Password-Required") === "true") {
          setMode("password");
          setValue("");
          setError("PIN attempts exhausted. Use your account password.");
        } else {
          setError(
            response.status === 429
              ? "Too many attempts. Try later."
              : mode === "pin"
                ? "Incorrect PIN"
                : "Incorrect password",
          );
          resetPinForRetry();
        }
        return;
      }

      const result = await response.json() as { unlock_token?: unknown };
      if (alive.current && acceptUnlock(result.unlock_token, started)) {
        onUnlocked();
      } else {
        resetPinForRetry();
      }
    } catch {
      if (alive.current) {
        setError("Network unavailable. Unlock requires a connection.");
        resetPinForRetry();
      }
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(false);
    }
  }

  function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitCredential(value);
  }

  async function signOut() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/v1/auth/logout", {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok && response.status !== 401) throw new Error("Sign out failed");
      forgetUnlock();
      if (alive.current) onSignedOut();
    } catch {
      if (alive.current) setError("Unable to sign out. Check your connection.");
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  return (
    <main className="page pin-screen" aria-label="Private area locked">
      <section className="messenger-lock auth-card pin-card">
        <div className="pin-card-heading">
          <span className="pin-card-kicker">SUDOKU.MOSCOW</span>
          <h2>{mode === "pin" ? "Enter PIN" : "Account password"}</h2>
          <p>
            {mode === "pin"
              ? "Enter the four-digit PIN for this device."
              : "Use your account password to unlock this device."}
          </p>
        </div>

        {mode === "pin" ? (
          <div className="pin-entry-stack">
            <PinCellsInput
              value={value}
              onChange={(next) => {
                setValue(next);
                setError(null);
                if (next.length === 4 && !busyRef.current) void submitCredential(next);
              }}
              disabled={busy}
              autoFocus
              label="Device PIN"
              hasError={Boolean(error)}
            />
            <p className="pin-entry-hint">{busy ? "Checking…" : "Unlocks automatically after digit 4"}</p>
          </div>
        ) : (
          <form className="auth-form pin-password-form" onSubmit={submitPassword}>
            <label>Account password
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={value}
                onChange={(event) => setValue(event.target.value)}
                disabled={busy}
                autoFocus
              />
            </label>
            <button type="submit" className="primary-button" disabled={busy || !value}>
              {busy ? "Checking…" : "Continue"}
            </button>
          </form>
        )}

        {error ? <p className="form-error pin-error" role="alert">{error}</p> : null}

        <div className="pin-secondary-actions">
          {mode === "pin" ? (
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => {
                setValue("");
                setError(null);
                setMode("password");
              }}
            >
              Use account password
            </button>
          ) : (
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => {
                setValue("");
                setError(null);
                setMode("pin");
              }}
            >
              Use PIN
            </button>
          )}
          <button type="button" className="text-button" disabled={busy} onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </section>
      <SudokuEscapeButton onHide={onHide} />
    </main>
  );
}
