"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  NATIVE_BIOMETRIC_READY_EVENT,
  nativeBiometricLabel,
  nativeBiometricStatus,
  type NativeBiometricStatus,
} from "./native-biometric-access";

export function DevicePinOnboarding({
  onSetPin,
  onSkip,
  onHide,
}: {
  onSetPin: (pin: string, enableBiometric: boolean) => Promise<void>;
  onSkip: () => void;
  onHide: () => void;
}) {
  const [stage, setStage] = useState<"offer" | "pin">("offer");
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [biometric, setBiometric] = useState<NativeBiometricStatus | null>(null);
  const [enableBiometric, setEnableBiometric] = useState(false);

  useEffect(() => {
    let alive = true;
    const refresh = () => {
      void nativeBiometricStatus()
        .then((status) => {
          if (!alive) return;
          setBiometric(status);
          if (!status.available) setEnableBiometric(false);
        })
        .catch(() => {
          if (alive) {
            setBiometric(null);
            setEnableBiometric(false);
          }
        });
    };
    refresh();
    window.addEventListener(NATIVE_BIOMETRIC_READY_EVENT, refresh);
    return () => {
      alive = false;
      window.removeEventListener(NATIVE_BIOMETRIC_READY_EVENT, refresh);
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError(null);
    if (!/^[0-9]{4}$/.test(pin) || pin !== confirm) {
      setError("Enter and confirm the same four-digit PIN.");
      return;
    }

    setBusy(true);
    try {
      await onSetPin(pin, enableBiometric);
      setPin("");
      setConfirm("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save PIN. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const biometricLabel = nativeBiometricLabel(biometric?.type ?? "unknown");

  return (
    <main className="page" aria-label="Quick PIN setup">
      <section className="messenger-lock auth-card device-pin-onboarding">
        <div className="private-header">
          <div>
            <h2>{stage === "offer" ? "Quick sign-in" : "Set device PIN"}</h2>
            <p>This device only</p>
          </div>
          <button className="text-button" type="button" disabled={busy} onClick={onHide}>Hide</button>
        </div>

        {stage === "offer" ? (
          <>
            <p className="device-access-prompt">Use PIN for quick sign-in on this device?</p>
            <p className="device-access-help">Your account password remains available for recovery.</p>
            <div className="device-access-actions">
              <button className="primary-button" type="button" onClick={() => setStage("pin")}>Set PIN</button>
              <button className="secondary-button" type="button" onClick={onSkip}>Not now</button>
            </div>
          </>
        ) : (
          <form className="auth-form" onSubmit={submit}>
            <label>Four-digit PIN
              <input
                name="new-device-pin"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                pattern="[0-9]{4}"
                minLength={4}
                maxLength={4}
                required
                className="device-pin-input"
                value={pin}
                onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 4))}
                disabled={busy}
                autoFocus
              />
            </label>
            <label>Confirm PIN
              <input
                name="confirm-device-pin"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                pattern="[0-9]{4}"
                minLength={4}
                maxLength={4}
                required
                className="device-pin-input"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value.replace(/\D/g, "").slice(0, 4))}
                disabled={busy}
              />
            </label>
            {biometric?.available ? (
              <label className="device-access-choice">
                <input
                  type="checkbox"
                  checked={enableBiometric}
                  onChange={(event) => setEnableBiometric(event.target.checked)}
                  disabled={busy}
                />
                Use {biometricLabel} for quick unlock
              </label>
            ) : null}
            <p className="device-access-help">
              Five incorrect PIN attempts require your account password.
              {biometric?.available ? ` ${biometricLabel} stays on this iPhone and never replaces your account password.` : ""}
            </p>
            {error ? <p className="form-error" role="alert">{error}</p> : null}
            <button className="primary-button" type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save PIN"}
            </button>
            <button className="secondary-button" type="button" disabled={busy} onClick={onSkip}>Not now</button>
          </form>
        )}
      </section>
    </main>
  );
}
