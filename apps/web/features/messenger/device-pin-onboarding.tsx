"use client";

import { useRef, useState } from "react";
import { PinCodeField } from "./pin-code-field";

type Stage = "offer" | "create" | "confirm";

export function DevicePinOnboarding({
  onSetPin,
  onSkip,
  onHide,
}: {
  onSetPin: (pin: string) => Promise<void>;
  onSkip: () => void;
  onHide: () => void;
}) {
  const [stage, setStage] = useState<Stage>("offer");
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmSubmitting = useRef(false);

  function updatePin(next: string) {
    if (busy) return;
    setError(null);
    setPin(next);
    if (next.length === 4) {
      setConfirm("");
      setStage("confirm");
    }
  }

  function updateConfirm(next: string) {
    if (busy || confirmSubmitting.current) return;
    setError(null);
    setConfirm(next);
    if (next.length !== 4) return;

    if (next !== pin) {
      setError("PINs do not match. Try again.");
      setConfirm("");
      return;
    }

    confirmSubmitting.current = true;
    setBusy(true);
    void onSetPin(pin)
      .then(() => {
        setPin("");
        setConfirm("");
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : "Unable to save PIN. Try again.");
        setConfirm("");
      })
      .finally(() => {
        confirmSubmitting.current = false;
        setBusy(false);
      });
  }

  const title = stage === "offer"
    ? "Quick sign-in"
    : stage === "create"
      ? "Create PIN"
      : "Confirm PIN";

  return (
    <main className="page" aria-label="Quick PIN setup">
      <section className="messenger-lock auth-card device-pin-onboarding">
        <div className="private-header">
          <div>
            <h2>{title}</h2>
            <p>This device only</p>
          </div>
          <button className="text-button" type="button" disabled={busy} onClick={onHide}>Hide</button>
        </div>

        {stage === "offer" ? (
          <>
            <p className="device-access-prompt">Use PIN for quick sign-in on this device?</p>
            <p className="device-access-help">Your account password remains available for recovery.</p>
            <div className="device-access-actions">
              <button className="primary-button" type="button" onClick={() => setStage("create")}>Set PIN</button>
              <button className="secondary-button" type="button" onClick={onSkip}>Not now</button>
            </div>
          </>
        ) : (
          <div className="auth-form pin-auth-form">
            {stage === "create" ? (
              <PinCodeField
                key="create-pin"
                label="Four-digit PIN"
                value={pin}
                onChange={updatePin}
                disabled={busy}
                autoFocus
                invalid={Boolean(error)}
              />
            ) : (
              <PinCodeField
                key="confirm-pin"
                label="Confirm PIN"
                value={confirm}
                onChange={updateConfirm}
                disabled={busy}
                autoFocus
                invalid={Boolean(error)}
              />
            )}
            <p className="device-access-help">
              {stage === "create"
                ? "Choose four digits. Confirmation opens automatically."
                : busy
                  ? "Saving PIN…"
                  : "Re-enter the same four digits."}
            </p>
            {error ? <p className="form-error" role="alert">{error}</p> : null}
            {stage === "confirm" ? (
              <button
                className="text-button"
                type="button"
                disabled={busy}
                onClick={() => {
                  setError(null);
                  setConfirm("");
                  setPin("");
                  setStage("create");
                }}
              >
                Choose a different PIN
              </button>
            ) : null}
            <button className="secondary-button" type="button" disabled={busy} onClick={onSkip}>Not now</button>
          </div>
        )}
      </section>
    </main>
  );
}
