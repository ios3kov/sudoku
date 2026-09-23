"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { acceptUnlock, accessEpoch, forgetUnlock } from "./device-access";
import {
  NATIVE_BIOMETRICS_READY_EVENT,
  biometricLabel,
  getNativeBiometricAvailability,
  isNativeBiometricCancellation,
  nativeBiometricsAvailable,
  signNativeBiometricPayload,
  type NativeBiometricKind,
} from "./native-biometric-access";

export function DevicePinUnlock({ onUnlocked, onSignedOut, onHide }: {
  onUnlocked: () => void; onSignedOut: () => void; onHide: () => void;
}) {
  const [mode, setMode] = useState<"pin" | "password">("pin");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricKind, setBiometricKind] = useState<NativeBiometricKind>("none");
  const alive = useRef(false);

  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();

    const refreshNativeBiometrics = () => {
      if (!nativeBiometricsAvailable()) {
        if (alive.current) {
          setBiometricAvailable(false);
          setBiometricKind("none");
        }
        return;
      }
      void getNativeBiometricAvailability()
        .then((status) => {
          if (!alive.current) return;
          setBiometricAvailable(status.available);
          setBiometricKind(status.kind);
        })
        .catch(() => {
          if (!alive.current) return;
          setBiometricAvailable(false);
          setBiometricKind("none");
        });
    };

    refreshNativeBiometrics();
    window.addEventListener(
      NATIVE_BIOMETRICS_READY_EVENT,
      refreshNativeBiometrics,
    );

    void fetch("/v1/auth/device-access", {
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (r) => {
        if (!alive.current) return;
        if (r.status === 401) { onSignedOut(); return; }
        if (!r.ok) return;
        const result = await r.json();
        if (!alive.current) return;
        setBiometricEnabled(Boolean(result.biometric_enabled));
        if (!result.pin_enabled) { onUnlocked(); return; }
        if (result.password_required) {
          setMode("password"); setValue("");
          setError("PIN attempts exhausted. Use your account password.");
        }
      }).catch(() => undefined);

    return () => {
      alive.current = false;
      controller.abort();
      window.removeEventListener(
        NATIVE_BIOMETRICS_READY_EVENT,
        refreshNativeBiometrics,
      );
    };
  }, [onUnlocked, onSignedOut]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(null);
    const started = accessEpoch();
    const credential = value;
    setValue("");
    try {
      const response = await fetch(
        `/v1/auth/device-access/${mode === "pin" ? "unlock" : "password"}`,
        {
          method: "POST", credentials: "include", cache: "no-store",
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
          setError("PIN attempts exhausted. Use your account password.");
        } else {
          setError(
            response.status === 429
              ? "Too many attempts. Try later."
              : mode === "pin" ? "Incorrect PIN" : "Incorrect password",
          );
        }
        return;
      }
      const result = await response.json();
      if (alive.current && acceptUnlock(result.unlock_token, started)) {
        onUnlocked();
      }
    } catch {
      if (alive.current) {
        setError("Network unavailable. Unlock requires a connection.");
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  async function unlockWithBiometrics() {
    if (busy || mode !== "pin" || !biometricEnabled || !biometricAvailable) return;
    setBusy(true); setError(null);
    const started = accessEpoch();
    const label = biometricLabel(biometricKind);

    try {
      const challengeResponse = await fetch(
        "/v1/auth/device-access/biometric/challenge",
        {
          method: "POST",
          credentials: "include",
          cache: "no-store",
        },
      );
      if (!alive.current || started !== accessEpoch()) return;
      if (challengeResponse.status === 401) {
        forgetUnlock(); onSignedOut(); return;
      }
      if (challengeResponse.headers.get("X-PIN-Password-Required") === "true") {
        setMode("password");
        setError("PIN attempts exhausted. Use your account password.");
        return;
      }
      if (challengeResponse.status === 409) {
        setBiometricEnabled(false);
        setError(`${label} needs to be enabled again from Devices.`);
        return;
      }
      if (!challengeResponse.ok) {
        setError(`Unable to start ${label}. Use your PIN.`);
        return;
      }

      const challenge = await challengeResponse.json() as {
        challenge: string;
        payload: string;
      };
      const signature = await signNativeBiometricPayload(challenge.payload);
      if (!alive.current || started !== accessEpoch()) return;

      const response = await fetch(
        "/v1/auth/device-access/biometric/unlock",
        {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            challenge: challenge.challenge,
            signature_b64: signature,
          }),
        },
      );
      if (!alive.current || started !== accessEpoch()) return;
      if (response.status === 401) {
        forgetUnlock(); onSignedOut(); return;
      }
      if (response.headers.get("X-PIN-Password-Required") === "true") {
        setMode("password");
        setError("PIN attempts exhausted. Use your account password.");
        return;
      }
      if (!response.ok) {
        setError(`${label} unlock failed. Use your PIN.`);
        return;
      }

      const result = await response.json();
      if (alive.current && acceptUnlock(result.unlock_token, started)) {
        onUnlocked();
      }
    } catch (reason) {
      if (!alive.current || isNativeBiometricCancellation(reason)) return;
      setError(`${label} is unavailable. Use your PIN.`);
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  async function signOut() {
    if (busy) return;
    setBusy(true); setError(null);
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

  const nativeLabel = biometricLabel(biometricKind);

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
      {mode === "pin" && biometricEnabled && biometricAvailable ? (
        <button
          type="button"
          className="primary-button"
          disabled={busy}
          onClick={() => void unlockWithBiometrics()}
        >
          {busy ? "Checking…" : `Unlock with ${nativeLabel}`}
        </button>
      ) : null}
      <form className="auth-form" onSubmit={submit}>
        <label>{mode === "pin" ? "Device PIN" : "Account password"}
          <input
            key={mode}
            name={mode}
            type="password"
            inputMode={mode === "pin" ? "numeric" : "text"}
            autoComplete={mode === "pin" ? "off" : "current-password"}
            required
            pattern={mode === "pin" ? "[0-9]{4}" : undefined}
            minLength={mode === "pin" ? 4 : 1}
            maxLength={mode === "pin" ? 4 : 1024}
            className={mode === "pin" ? "device-pin-input" : undefined}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={busy}
          />
        </label>
        <button type="submit" className="secondary-button" disabled={busy}>
          {busy ? "Checking…" : mode === "pin" ? "Use PIN" : "Unlock"}
        </button>
      </form>
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
