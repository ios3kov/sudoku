"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { acceptUnlock, accessEpoch, forgetUnlock } from "./device-access";
import { PinCodeField } from "./pin-code-field";

export function DevicePinUnlock({ onUnlocked, onSignedOut, onHide }: {
  onUnlocked: () => void; onSignedOut: () => void; onHide: () => void;
}) {
  const [mode, setMode] = useState<"pin" | "password">("pin");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(false);
  const requestInFlight = useRef(false);
  const pinInputRef = useRef<HTMLInputElement | null>(null);

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
        const result = await response.json();
        if (!alive.current) return;
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

  useEffect(() => {
    if (mode !== "pin" || busy) return;
    const frame = window.requestAnimationFrame(() => {
      const input = pinInputRef.current;
      if (input && document.activeElement !== input) input.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  });

  async function submitCredential(
    credentialMode: "pin" | "password",
    credential: string,
  ) {
    if (requestInFlight.current) return;

    requestInFlight.current = true;
    setBusy(true);
    setError(null);
    const started = accessEpoch();
    if (credentialMode === "pin") setValue("");

    try {
      const response = await fetch(
        `/v1/auth/device-access/${credentialMode === "pin" ? "unlock" : "password"}`,
        {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            credentialMode === "pin" ? { pin: credential } : { password: credential },
          ),
        },
      );
      if (!alive.current || started !== accessEpoch()) return;
      if (response.status === 401) { forgetUnlock(); onSignedOut(); return; }

      if (response.status === 409) {
        onUnlocked();
        return;
      }

      if (!response.ok) {
        if (response.headers.get("X-PIN-Password-Required") === "true") {
          setMode("password");
          setValue("");
          setError("PIN attempts exhausted. Use your account password.");
        } else {
          setError(
            response.status === 429
              ? "Too many attempts. Try later."
              : credentialMode === "pin" ? "Incorrect PIN" : "Incorrect password",
          );
        }
        return;
      }

      const result = await response.json();
      if (!alive.current) return;
      if (!acceptUnlock(result.unlock_token, started)) {
        setError(
          credentialMode === "pin"
            ? "Device state changed. Enter your PIN again."
            : "Device state changed. Try your password again.",
        );
        return;
      }
      onUnlocked();
    } catch {
      if (alive.current) {
        setError("Network unavailable. Unlock requires a connection.");
      }
    } finally {
      requestInFlight.current = false;
      if (alive.current) {
        setBusy(false);
        if (credentialMode === "pin") {
          window.requestAnimationFrame(() => pinInputRef.current?.focus());
        }
      }
    }
  }

  function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || mode !== "password") return;
    const credential = value;
    setValue("");
    void submitCredential("password", credential);
  }

  function updatePinValue(nextRaw: string) {
    if (busy || mode !== "pin") return;
    const next = nextRaw.replace(/\D/g, "").slice(0, 4);
    setValue(next);
    if (next.length === 4) {
      void submitCredential("pin", next);
    }
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
      if (!response.ok && response.status !== 401) {
        throw new Error("Sign out failed");
      }
      forgetUnlock();
      if (alive.current) onSignedOut();
    } catch {
      if (alive.current) setError("Unable to sign out. Check your connection.");
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  return <main className="page" aria-label="Private area locked">
    <section className="messenger-lock auth-card">
      <div className="private-header">
        <h2>Unlock</h2>
        <button type="button" onClick={onHide}>Hide</button>
      </div>
      <p className="device-access-help">
        {mode === "pin"
          ? "Enter your four-digit device PIN."
          : "Use your account password. Your chats and device identity are kept."}
      </p>
      {mode === "pin" ? (
        <div className="auth-form pin-auth-form">
          <PinCodeField
            ref={pinInputRef}
            label="Device PIN"
            value={value}
            onChange={updatePinValue}
            disabled={busy}
            autoFocus
            invalid={Boolean(error)}
          />
          <p className="device-access-help" aria-live="polite">
            {busy ? "Checking PIN…" : "Enter four digits to unlock."}
          </p>
        </div>
      ) : (
        <form className="auth-form" onSubmit={submitPassword}>
          <label>Account password
            <input
              key={mode}
              name="password"
              type="password"
              autoComplete="current-password"
              required
              minLength={1}
              maxLength={1024}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              disabled={busy}
              autoFocus
            />
          </label>
          <button type="submit" className="secondary-button" disabled={busy}>
            {busy ? "Checking…" : "Unlock"}
          </button>
        </form>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
      {mode === "pin" && <button
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
      </button>}
      <button
        type="button"
        className="text-button"
        disabled={busy}
        onClick={() => void signOut()}
      >
        Sign out
      </button>
    </section>
  </main>;
}
