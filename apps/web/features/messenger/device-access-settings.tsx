"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { messengerApi } from "./api";
import {
  acceptUnlock,
  accessEpoch,
  forgetUnlock,
  privateFetch,
  rememberPhone,
  savedPhone,
} from "./device-access";
import { PinCellsInput } from "./pin-cells-input";
import "./device-access.css";

export function DeviceAccessSettings({ onPhoneUpdated }: { onPhoneUpdated?: (phone: string) => void }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [phone, setPhone] = useState("");
  const [phoneDraft, setPhoneDraft] = useState("");
  const [phonePassword, setPhonePassword] = useState("");
  const [phoneBusy, setPhoneBusy] = useState(false);
  const [remember, setRemember] = useState(false);
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const alive = useRef(false);

  useEffect(() => {
    alive.current = true;

    void Promise.all([
      privateFetch("/v1/auth/device-access", {
        credentials: "include",
        cache: "no-store",
      }).then(async (response) => {
        if (!response.ok) throw new Error("Unable to load device access");
        return response.json() as Promise<{ pin_enabled?: boolean }>;
      }),
      messengerApi.me(),
    ]).then(([settings, user]) => {
      if (!alive.current) return;
      const currentPhone = user.phone_e164 ?? "";
      setEnabled(Boolean(settings.pin_enabled));
      setPhone(currentPhone);
      setPhoneDraft(currentPhone);
      setRemember(Boolean(currentPhone) && savedPhone() === currentPhone);
    }).catch(() => {
      if (alive.current) setError("Unable to load device access. Close and reopen Settings to retry.");
    });

    return () => { alive.current = false; };
  }, []);

  async function savePhone() {
    if (phoneBusy || !phoneDraft.trim() || !phonePassword) return;
    setPhoneBusy(true);
    setError(null);
    setNotice(null);
    try {
      const user = await messengerApi.updatePhone(phoneDraft, phonePassword);
      const next = user.phone_e164 ?? "";
      if (!alive.current) return;
      setPhone(next);
      setPhoneDraft(next);
      if (next) onPhoneUpdated?.(next);
      if (remember && next) rememberPhone(next, true);
      setNotice(user.phone_verified
        ? "Phone number updated."
        : "Phone number updated. Contact discovery activates after verification.");
    } catch (reason) {
      if (!alive.current) return;
      const status = (reason as Error & { status?: number }).status;
      setError(
        status === 409
          ? "Phone number is already in use."
          : status === 403
            ? "Incorrect account password."
            : "Unable to update phone number.",
      );
    } finally {
      if (alive.current) {
        setPhoneBusy(false);
        setPhonePassword("");
      }
    }
  }

  async function savePin(remove = false) {
    if (busy || enabled === null) return;
    setError(null);
    setNotice(null);

    if (!password) {
      setError("Enter your account password.");
      return;
    }
    if (!remove && (!/^[0-9]{4}$/.test(pin) || pin !== confirm)) {
      setError("Enter the same four-digit PIN twice.");
      return;
    }

    setBusy(true);
    const started = accessEpoch();
    try {
      const response = await privateFetch("/v1/auth/device-access", {
        method: "PUT",
        credentials: "include",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password, pin: remove ? null : pin }),
      });
      if (!alive.current || started !== accessEpoch()) return;
      if (!response.ok) {
        setError(
          response.status === 429
            ? "Too many attempts. Try later."
            : response.status === 401
              ? "Session expired. Sign in again."
              : "Unable to save PIN. Check your account password.",
        );
        return;
      }

      const result = await response.json() as { unlock_token?: unknown };
      if (!alive.current || started !== accessEpoch()) return;
      if (remove) {
        forgetUnlock();
      } else if (!acceptUnlock(result.unlock_token, started)) {
        throw new Error("Missing unlock capability");
      }

      setEnabled(!remove);
      setNotice(remove ? "Device PIN removed." : "Device PIN saved.");
    } catch {
      if (alive.current) setError("Unable to save PIN. Check your connection.");
    } finally {
      if (alive.current) {
        setBusy(false);
        setPassword("");
        setPin("");
        setConfirm("");
      }
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void savePin();
  }

  return (
    <section className="device-access-panel" aria-label="Login and device PIN">
      <div className="settings-section-heading">
        <h3>Account & device</h3>
        <p>Phone login and four-digit quick unlock.</p>
      </div>

      <div className="auth-form settings-form-card">
        <label>Phone number
          <input
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="+382..."
            value={phoneDraft}
            onChange={(event) => setPhoneDraft(event.target.value)}
            disabled={phoneBusy}
          />
        </label>
        <label>Account password for phone change
          <input
            type="password"
            autoComplete="current-password"
            value={phonePassword}
            onChange={(event) => setPhonePassword(event.target.value)}
            disabled={phoneBusy}
          />
        </label>
        <button
          type="button"
          className="secondary-button"
          disabled={phoneBusy || !phoneDraft.trim() || !phonePassword || phoneDraft === phone}
          onClick={() => void savePhone()}
        >
          {phoneBusy ? "Saving…" : phone ? "Change phone" : "Set phone"}
        </button>
      </div>

      <label className="device-access-choice">
        <input
          type="checkbox"
          checked={remember}
          disabled={!phone}
          onChange={(event) => {
            const next = event.target.checked;
            if (rememberPhone(phone, next)) {
              setRemember(next);
              setError(null);
            } else {
              setError("This browser cannot save the phone number.");
            }
          }}
        />
        Remember phone on this device
      </label>

      <form className="auth-form settings-form-card" onSubmit={submit}>
        <div className="settings-section-heading compact">
          <h3>{enabled ? "Change device PIN" : "Set device PIN"}</h3>
          <p>{enabled ? "PIN is enabled on this device." : "PIN is not enabled yet."}</p>
        </div>
        <label>Account password
          <input
            type="password"
            name="device-password"
            autoComplete="current-password"
            required
            maxLength={1024}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={busy || enabled === null}
          />
        </label>
        <PinCellsInput
          value={pin}
          onChange={setPin}
          label="New four-digit PIN"
          disabled={busy || enabled === null}
        />
        <PinCellsInput
          value={confirm}
          onChange={setConfirm}
          label="Confirm PIN"
          disabled={busy || enabled === null}
          hasError={Boolean(error && pin.length === 4 && confirm.length === 4)}
        />
        <button type="submit" className="primary-button" disabled={busy || enabled === null}>
          {busy ? "Saving…" : enabled ? "Change PIN" : "Set PIN"}
        </button>
        {enabled ? (
          <button type="button" className="secondary-button" disabled={busy} onClick={() => void savePin(true)}>
            Remove PIN
          </button>
        ) : null}
      </form>

      <p className="device-access-help">
        Five incorrect PIN attempts require your account password. PIN unlock needs an internet connection.
      </p>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {notice ? <p className="settings-notice" role="status">{notice}</p> : null}
    </section>
  );
}
