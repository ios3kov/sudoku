"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { acceptUnlock, accessEpoch, forgetUnlock } from "./device-access";

export function DevicePinUnlock({ onUnlocked, onSignedOut, onHide }: {
  onUnlocked: () => void; onSignedOut: () => void; onHide: () => void;
}) {
  const [mode, setMode] = useState<"pin" | "password">("pin");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    void fetch("/v1/auth/device-access", { credentials: "include", cache: "no-store", signal: controller.signal })
      .then(async (r) => {
        if (!alive.current) return;
        if (r.status === 401) { onSignedOut(); return; }
        if (!r.ok) return;
        const result = await r.json();
        if (!alive.current) return;
        if (!result.pin_enabled) { onUnlocked(); return; }
        if (result.password_required) {
          setMode("password"); setValue(""); setError("PIN attempts exhausted. Use your account password.");
        }
      }).catch(() => undefined);
    return () => { alive.current = false; controller.abort(); };
  }, [onUnlocked, onSignedOut]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(null);
    const started = accessEpoch();
    const credential = value;
    setValue("");
    try {
      const response = await fetch(`/v1/auth/device-access/${mode === "pin" ? "unlock" : "password"}`, {
        method: "POST", credentials: "include", cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(mode === "pin" ? { pin: credential } : { password: credential }),
      });
      if (!alive.current || started !== accessEpoch()) return;
      if (response.status === 401) { forgetUnlock(); onSignedOut(); return; }
      if (response.status === 409) { onUnlocked(); return; }
      if (!response.ok) {
        if (response.headers.get("X-PIN-Password-Required") === "true") {
          setMode("password"); setError("PIN attempts exhausted. Use your account password.");
        } else setError(response.status === 429 ? "Too many attempts. Try later." : mode === "pin" ? "Incorrect PIN" : "Incorrect password");
        return;
      }
      const result = await response.json();
      if (alive.current && acceptUnlock(result.unlock_token, started)) onUnlocked();
    } catch { if (alive.current) setError("Network unavailable. Unlock requires a connection."); }
    finally { if (alive.current) setBusy(false); }
  }

  async function signOut() {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch("/v1/auth/logout", { method: "POST", credentials: "include" });
      if (!response.ok && response.status !== 401) throw new Error("Sign out failed");
      forgetUnlock();
      if (alive.current) onSignedOut();
    } catch { if (alive.current) setError("Unable to sign out. Check your connection."); }
    finally { if (alive.current) setBusy(false); }
  }

  return <main className="page" aria-label="Private area locked">
    <section className="messenger-lock auth-card">
      <div className="private-header"><h2>Unlock</h2><button type="button" onClick={onHide}>Hide</button></div>
      <p className="device-access-help">{mode === "pin" ? "Enter your four-digit device PIN." : "Use your account password. Your chats and device identity are kept."}</p>
      <form className="auth-form" onSubmit={submit}>
        <label>{mode === "pin" ? "Device PIN" : "Account password"}
          <input key={mode} name={mode} type="password" inputMode={mode === "pin" ? "numeric" : "text"}
            autoComplete={mode === "pin" ? "off" : "current-password"} required
            pattern={mode === "pin" ? "[0-9]{4}" : undefined} minLength={mode === "pin" ? 4 : 1}
            maxLength={mode === "pin" ? 4 : 1024} className={mode === "pin" ? "device-pin-input" : undefined}
            value={value} onChange={(e) => setValue(e.target.value)} disabled={busy} />
        </label>
        <button type="submit" className="primary-button" disabled={busy}>{busy ? "Checking…" : "Unlock"}</button>
      </form>
      {error && <p className="form-error" role="alert">{error}</p>}
      {mode === "pin" && <button type="button" className="secondary-button" disabled={busy}
        onClick={() => { setValue(""); setError(null); setMode("password"); }}>Use account password</button>}
      <button type="button" className="text-button" disabled={busy} onClick={() => void signOut()}>Sign out</button>
    </section>
  </main>;
}
