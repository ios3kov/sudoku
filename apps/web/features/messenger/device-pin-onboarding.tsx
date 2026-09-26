"use client";

import { useState } from "react";
import { PinCellsInput } from "./pin-cells-input";
import { SudokuEscapeButton } from "./sudoku-escape-button";

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

  async function savePin(nextConfirm: string) {
    if (busy || !/^[0-9]{4}$/.test(pin) || !/^[0-9]{4}$/.test(nextConfirm)) return;
    if (pin !== nextConfirm) {
      setConfirm("");
      setError("PINs do not match. Try again.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await onSetPin(pin);
      setPin("");
      setConfirm("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save PIN. Try again.");
      setConfirm("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page pin-screen" aria-label="Quick PIN setup">
      <section className="messenger-lock auth-card pin-card device-pin-onboarding">
        {stage === "offer" ? (
          <>
            <div className="pin-card-heading">
              <span className="pin-card-kicker">SUDOKU.MOSCOW</span>
              <h2>Quick unlock</h2>
              <p>Set a four-digit PIN for this device. Your account password remains the recovery method.</p>
            </div>
            <div className="device-access-actions">
              <button className="primary-button" type="button" onClick={() => setStage("create")}>
                Set PIN
              </button>
              <button className="secondary-button" type="button" onClick={onSkip}>
                Not now
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="pin-card-heading">
              <span className="pin-card-kicker">{stage === "create" ? "STEP 1 OF 2" : "STEP 2 OF 2"}</span>
              <h2>{stage === "create" ? "Create PIN" : "Confirm PIN"}</h2>
              <p>{stage === "create" ? "Choose four digits." : "Enter the same four digits again."}</p>
            </div>

            <div className="pin-entry-stack">
              <PinCellsInput
                value={stage === "create" ? pin : confirm}
                onChange={(next) => {
                  setError(null);
                  if (stage === "create") {
                    setPin(next);
                    if (next.length === 4) {
                      window.setTimeout(() => {
                        setConfirm("");
                        setStage("confirm");
                      }, 120);
                    }
                    return;
                  }
                  setConfirm(next);
                  if (next.length === 4) void savePin(next);
                }}
                disabled={busy}
                autoFocus
                label={stage === "create" ? "Four-digit PIN" : "Confirm PIN"}
                hasError={Boolean(error)}
              />
              <p className="pin-entry-hint">
                {busy ? "Saving…" : stage === "create" ? "Continues automatically" : "Saves automatically after digit 4"}
              </p>
            </div>

            {error ? <p className="form-error pin-error" role="alert">{error}</p> : null}

            <button
              className="text-button pin-back-button"
              type="button"
              disabled={busy}
              onClick={() => {
                setError(null);
                if (stage === "confirm") {
                  setConfirm("");
                  setStage("create");
                } else {
                  setPin("");
                  setStage("offer");
                }
              }}
            >
              Back
            </button>
          </>
        )}
      </section>
      <SudokuEscapeButton onHide={onHide} />
    </main>
  );
}
