"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { messengerApi } from "./api";
import { acceptUnlock, accessEpoch, forgetUnlock, privateFetch, rememberPhone, savedPhone } from "./device-access";
import {
  NATIVE_BIOMETRIC_READY_EVENT,
  clearNativeBiometricPin,
  enrollNativeBiometricPin,
  nativeBiometricLabel,
  nativeBiometricStatus,
  type NativeBiometricStatus,
} from "./native-biometric-access";
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
  const [biometric, setBiometric] = useState<NativeBiometricStatus | null>(null);
  const [enableBiometric, setEnableBiometric] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const alive = useRef(false);

  async function refreshBiometric() {
    try {
      const status = await nativeBiometricStatus();
      if (!alive.current) return;
      setBiometric(status);
      setEnableBiometric(status.enrolled);
    } catch {
      if (alive.current) {
        setBiometric(null);
        setEnableBiometric(false);
      }
    }
  }

  useEffect(() => {
    alive.current = true;

    const ready = () => { void refreshBiometric(); };
    window.addEventListener(NATIVE_BIOMETRIC_READY_EVENT, ready);

    void Promise.all([
      privateFetch("/v1/auth/device-access", { credentials: "include", cache: "no-store" }).then(async (r) => {
        if (!r.ok) throw new Error("Unable to load device access");
        return r.json();
      }),
      messengerApi.me(),
      nativeBiometricStatus(),
    ]).then(async ([settings, user, biometricStatus]) => {
      if (!alive.current) return;
      const currentPhone = user.phone_e164 ?? "";
      setEnabled(settings.pin_enabled);
      setPhone(currentPhone);
      setPhoneDraft(currentPhone);
      setRemember(Boolean(currentPhone) && savedPhone() === currentPhone);

      if (!settings.pin_enabled && biometricStatus.enrolled) {
        await clearNativeBiometricPin().catch(() => undefined);
        if (!alive.current) return;
        setBiometric({ ...biometricStatus, enrolled: false });
        setEnableBiometric(false);
      } else {
        setBiometric(biometricStatus);
        setEnableBiometric(biometricStatus.enrolled);
      }
    }).catch(() => {
      if (alive.current) setError("Unable to load device access. Close and reopen Devices to retry.");
    });

    return () => {
      alive.current = false;
      window.removeEventListener(NATIVE_BIOMETRIC_READY_EVENT, ready);
    };
  }, []);

  async function savePhone() {
    if (phoneBusy || !phoneDraft.trim() || !phonePassword) return;
    setPhoneBusy(true); setError(null); setNotice(null);
    try {
      const user = await messengerApi.updatePhone(phoneDraft, phonePassword);
      const next = user.phone_e164 ?? "";
      if (!alive.current) return;
      setPhone(next);
      setPhoneDraft(next);
      if (next) onPhoneUpdated?.(next);
      if (remember && next) rememberPhone(next, true);
      setNotice(user.phone_verified
        ? "Phone number updated and verified."
        : "Phone number updated. Contact discovery will activate after admin verification.");
    } catch (reason) {
      if (!alive.current) return;
      const status = (reason as Error & { status?: number }).status;
      setError(status === 409 ? "Phone number is already in use." : status === 403 ? "Incorrect account password." : "Unable to update phone number.");
    } finally {
      if (alive.current) { setPhoneBusy(false); setPhonePassword(""); }
    }
  }

  async function save(remove = false) {
    if (busy || enabled === null) return;
    setError(null); setNotice(null);
    if (!password) { setError("Enter your account password."); return; }
    if (!remove && (!/^[0-9]{4}$/.test(pin) || pin !== confirm)) {
      setError("Enter and confirm the same four-digit PIN.");
      return;
    }

    setBusy(true);
    const started = accessEpoch();
    try {
      const response = await privateFetch("/v1/auth/device-access", {
        method: "PUT", credentials: "include", cache: "no-store", headers: { "content-type": "application/json" },
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

      const result = await response.json();
      if (!alive.current || started !== accessEpoch()) return;

      let biometricFailed = false;
      try {
        if (remove || !enableBiometric) await clearNativeBiometricPin();
        else if (biometric?.available) await enrollNativeBiometricPin(pin);
      } catch {
        biometricFailed = true;
      }

      if (remove) {
        forgetUnlock();
      } else if (!acceptUnlock(result.unlock_token, started)) {
        throw new Error("Missing unlock capability");
      }

      setEnabled(!remove);
      await refreshBiometric();

      if (remove) {
        setNotice("Device PIN and biometric quick unlock removed.");
      } else if (biometricFailed) {
        setNotice("Device PIN saved, but biometric quick unlock could not be updated.");
      } else if (enableBiometric && biometric?.available) {
        setNotice(`Device PIN saved. ${nativeBiometricLabel(biometric.type)} quick unlock is enabled.`);
      } else {
        setNotice("Device PIN saved. It is required when you return to the private area.");
      }
    } catch {
      if (alive.current) setError("Unable to save PIN. Check your connection.");
    } finally {
      if (alive.current) {
        setBusy(false); setPassword(""); setPin(""); setConfirm("");
      }
    }
  }

  async function disableBiometric() {
    if (busy) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      await clearNativeBiometricPin();
      await refreshBiometric();
      if (alive.current) setNotice("Biometric quick unlock disabled. Device PIN still works.");
    } catch {
      if (alive.current) setError("Unable to disable biometric quick unlock.");
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  function submit(e: FormEvent<HTMLFormElement>) { e.preventDefault(); void save(); }

  const biometricLabel = nativeBiometricLabel(biometric?.type ?? "unknown");

  return <section className="device-access-panel" aria-label="Login and device PIN">
    <h3>Login and device PIN</h3>
    <p>PIN applies only to this device. Your account password is not saved.</p>
    <div className="auth-form">
      <label>Phone number<input type="tel" inputMode="tel" autoComplete="tel" placeholder="+382..."
        value={phoneDraft} onChange={(e) => setPhoneDraft(e.target.value)} disabled={phoneBusy} /></label>
      <label>Account password for phone change<input type="password" autoComplete="current-password"
        value={phonePassword} onChange={(e) => setPhonePassword(e.target.value)} disabled={phoneBusy} /></label>
      <button type="button" className="secondary-button" disabled={phoneBusy || !phoneDraft.trim() || !phonePassword || phoneDraft === phone}
        onClick={() => void savePhone()}>{phoneBusy ? "Saving phone…" : phone ? "Change phone" : "Set phone"}</button>
    </div>

    <label className="device-access-choice"><input type="checkbox" checked={remember} disabled={!phone}
      onChange={(e) => {
        const value = e.target.checked;
        if (rememberPhone(phone, value)) { setRemember(value); setError(null); }
        else setError("This browser cannot save the phone number.");
      }} />Remember phone on this device</label>

    <p>{enabled === null ? "Loading PIN settings…" : enabled ? "Device PIN is enabled." : "Device PIN is not enabled."}</p>

    {biometric?.available ? (
      <div className="device-access-biometric">
        <label className="device-access-choice">
          <input
            type="checkbox"
            checked={enableBiometric}
            onChange={(event) => setEnableBiometric(event.target.checked)}
            disabled={busy || enabled === null}
          />
          Use {biometricLabel} when saving the PIN below
        </label>
        {biometric.enrolled ? (
          <button type="button" className="secondary-button" disabled={busy} onClick={() => void disableBiometric()}>
            Disable {biometricLabel}
          </button>
        ) : null}
      </div>
    ) : null}

    <form className="auth-form" onSubmit={submit}>
      <label>Account password<input type="password" name="device-password" autoComplete="current-password" required maxLength={1024}
        value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy || enabled === null} /></label>
      <label>New four-digit PIN<input type="password" name="new-pin" inputMode="numeric" autoComplete="off" required minLength={4} maxLength={4} pattern="[0-9]{4}" className="device-pin-input"
        value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))} disabled={busy || enabled === null} /></label>
      <label>Confirm PIN<input type="password" name="confirm-pin" inputMode="numeric" autoComplete="off" required minLength={4} maxLength={4} pattern="[0-9]{4}" className="device-pin-input"
        value={confirm} onChange={(e) => setConfirm(e.target.value.replace(/\D/g, "").slice(0, 4))} disabled={busy || enabled === null} /></label>
      <button type="submit" className="primary-button" disabled={busy || enabled === null}>{busy ? "Saving…" : enabled ? "Change PIN" : "Set PIN"}</button>
      {enabled && <button type="button" className="secondary-button" disabled={busy} onClick={() => void save(true)}>Remove PIN</button>}
    </form>

    <p className="device-access-help">
      Five incorrect PIN attempts require your account password. PIN and biometric unlock both need an internet connection to unlock the server session.
    </p>
    {error && <p className="form-error" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
  </section>;
}
