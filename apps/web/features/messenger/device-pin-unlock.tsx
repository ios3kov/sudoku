"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { acceptUnlock, accessEpoch, forgetUnlock } from "./device-access";
import {
  NATIVE_BIOMETRICS_READY_EVENT,
  clearNativeBiometric,
  isNativeBiometricCancellation,
  nativeBiometricErrorCode,
  nativeBiometricAvailability,
  nativeBiometricsAvailable,
  signNativeBiometric,
} from "./native-biometric-access";

type AccessStatus = {
  pin_enabled: boolean;
  password_required: boolean;
  biometric_enabled: boolean;
};

export function DevicePinUnlock({ onUnlocked, onSignedOut, onHide }: {
  onUnlocked: () => void; onSignedOut: () => void; onHide: () => void;
}) {
  const [mode, setMode] = useState<"pin" | "password">("pin");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [biometricBusy, setBiometricBusy] = useState(false);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [biometricLabel, setBiometricLabel] = useState("Biometrics");
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(false);

  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();

    async function refreshNativeBiometrics() {
      if (!nativeBiometricsAvailable()) {
        if (alive.current) setBiometricAvailable(false);
        return;
      }
      try {
        const availability = await nativeBiometricAvailability();
        if (!alive.current) return;
        setBiometricAvailable(availability.available);
        setBiometricLabel(availability.label || "Biometrics");
      } catch {
        if (alive.current) setBiometricAvailable(false);
      }
    }

    function nativeReady() {
      void refreshNativeBiometrics();
    }

    window.addEventListener(NATIVE_BIOMETRICS_READY_EVENT, nativeReady);
    void refreshNativeBiometrics();
    void fetch("/v1/auth/device-access", { credentials: "include", cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!alive.current) return;
        if (response.status === 401) { onSignedOut(); return; }
        if (!response.ok) return;
        const result = await response.json() as AccessStatus;
        if (!alive.current) return;
        if (!result.pin_enabled) { onUnlocked(); return; }
        setBiometricEnabled(Boolean(result.biometric_enabled));
        if (result.password_required) {
          setMode("password"); setValue(""); setError("PIN attempts exhausted. Use your account password.");
        }
      }).catch(() => undefined);

    return () => {
      alive.current = false;
      controller.abort();
      window.removeEventListener(NATIVE_BIOMETRICS_READY_EVENT, nativeReady);
    };
  }, [onUnlocked, onSignedOut]);

  async function unlockWithBiometric() {
    if (busy || biometricBusy || !biometricEnabled || !biometricAvailable) return;
    setBiometricBusy(true);
    setError(null);
    const started = accessEpoch();

    try {
      const challengeResponse = await fetch("/v1/auth/device-access/biometric/challenge", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
      });
      if (!alive.current || started !== accessEpoch()) return;
      if (challengeResponse.status === 401) { forgetUnlock(); onSignedOut(); return; }
      if (challengeResponse.headers.get("X-PIN-Password-Required") === "true") {
        setMode("password");
        setValue("");
        setError("PIN attempts exhausted. Use your account password.");
        return;
      }
      if (challengeResponse.status === 409) {
        setBiometricEnabled(false);
        await clearNativeBiometric().catch(() => undefined);
        setError("Biometric unlock needs to be set up again. Use your PIN.");
        return;
      }
      if (!challengeResponse.ok) throw new Error("Unable to start biometric unlock");

      const challenge = await challengeResponse.json() as { challenge: string; payload: string };
      const signatureB64 = await signNativeBiometric(challenge.payload);
      if (!alive.current || started !== accessEpoch()) return;

      const response = await fetch("/v1/auth/device-access/biometric/unlock", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          challenge: challenge.challenge,
          signature_b64: signatureB64,
        }),
      });
      if (!alive.current || started !== accessEpoch()) return;
      if (response.status === 401) { forgetUnlock(); onSignedOut(); return; }
      if (response.headers.get("X-PIN-Password-Required") === "true") {
        setMode("password");
        setValue("");
        setError("PIN attempts exhausted. Use your account password.");
        return;
      }
      if (response.status === 409) {
        setError("Biometric check expired. Try again or use your PIN.");
        return;
      }
      if (!response.ok) {
        setError("Biometric unlock failed. Use your PIN.");
        return;
      }

      const result = await response.json() as { unlock_token?: unknown };
      if (alive.current && acceptUnlock(result.unlock_token, started)) onUnlocked();
    } catch (reason) {
      if (!alive.current || started !== accessEpoch()) return;
      if (isNativeBiometricCancellation(reason)) return;
      const code = nativeBiometricErrorCode(reason);
      if (code === "invalidated") {
        setBiometricEnabled(false);
        await clearNativeBiometric().catch(() => undefined);
        setError("Biometric enrollment changed. Unlock with PIN, then re-enable biometrics in Devices.");
      } else {
        setError("Biometric unlock is unavailable. Use your PIN.");
      }
    } finally {
      if (alive.current) setBiometricBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || biometricBusy) return;
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
        } else {
          setError(response.status === 429 ? "Too many attempts. Try later." : mode === "pin" ? "Incorrect PIN" : "Incorrect password");
        }
        return;
      }
      const result = await response.json();
      if (alive.current && acceptUnlock(result.unlock_token, started)) onUnlocked();
    } catch { if (alive.current) setError("Network unavailable. Unlock requires a connection."); }
    finally { if (alive.current) setBusy(false); }
  }

  async function signOut() {
    if (busy || biometricBusy) return;
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
      {mode === "pin" && biometricEnabled && biometricAvailable && (
        <button type="button" className="primary-button" disabled={busy || biometricBusy} onClick={() => void unlockWithBiometric()}>
          {biometricBusy ? "Checking…" : `Unlock with ${biometricLabel}`}
        </button>
      )}
      <form className="auth-form" onSubmit={submit}>
        <label>{mode === "pin" ? "Device PIN" : "Account password"}
          <input key={mode} name={mode} type="password" inputMode={mode === "pin" ? "numeric" : "text"}
            autoComplete={mode === "pin" ? "off" : "current-password"} required
            pattern={mode === "pin" ? "[0-9]{4}" : undefined} minLength={mode === "pin" ? 4 : 1}
            maxLength={mode === "pin" ? 4 : 1024} className={mode === "pin" ? "device-pin-input" : undefined}
            value={value} onChange={(e) => setValue(e.target.value)} disabled={busy || biometricBusy} />
        </label>
        <button type="submit" className="primary-button" disabled={busy || biometricBusy}>{busy ? "Checking…" : "Unlock"}</button>
      </form>
      {error && <p className="form-error" role="alert">{error}</p>}
      {mode === "pin" && <button type="button" className="secondary-button" disabled={busy || biometricBusy}
        onClick={() => { setValue(""); setError(null); setMode("password"); }}>Use account password</button>}
      <button type="button" className="text-button" disabled={busy || biometricBusy} onClick={() => void signOut()}>Sign out</button>
    </section>
  </main>;
}
