"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { messengerApi } from "./api";
import { acceptUnlock, accessEpoch, forgetUnlock, privateFetch, rememberPhone, savedPhone } from "./device-access";
import {
  NATIVE_BIOMETRICS_READY_EVENT,
  clearNativeBiometric,
  enrollNativeBiometric,
  isNativeBiometricCancellation,
  nativeBiometricAvailability,
  nativeBiometricsAvailable,
} from "./native-biometric-access";
import "./device-access.css";

type AccessSettings = {
  pin_enabled: boolean;
  password_required: boolean;
  biometric_enabled: boolean;
};

export function DeviceAccessSettings({ onPhoneUpdated }: { onPhoneUpdated?: (phone: string) => void }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricLabel, setBiometricLabel] = useState("Biometrics");
  const [biometricBusy, setBiometricBusy] = useState(false);
  const [biometricPassword, setBiometricPassword] = useState("");
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

    void Promise.all([
      privateFetch("/v1/auth/device-access", { credentials: "include", cache: "no-store" }).then(async (r) => {
        if (!r.ok) throw new Error("Unable to load device access");
        return r.json() as Promise<AccessSettings>;
      }),
      messengerApi.me(),
    ]).then(([settings, user]) => {
      if (alive.current) {
        const currentPhone = user.phone_e164 ?? "";
        setEnabled(settings.pin_enabled);
        setBiometricEnabled(Boolean(settings.biometric_enabled));
        setPhone(currentPhone);
        setPhoneDraft(currentPhone);
        setRemember(Boolean(currentPhone) && savedPhone() === currentPhone);
      }
    }).catch(() => {
      if (alive.current) setError("Unable to load device access. Close and reopen Devices to retry.");
    });

    return () => {
      alive.current = false;
      window.removeEventListener(NATIVE_BIOMETRICS_READY_EVENT, nativeReady);
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
    if (busy || biometricBusy || enabled === null) return;
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
        method: "PUT",
        credentials: "include",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password, pin: remove ? null : pin }),
      });
      if (!alive.current || started !== accessEpoch()) return;
      if (!response.ok) {
        setError(response.status === 429 ? "Too many attempts. Try later." : response.status === 401 ? "Session expired. Sign in again." : "Unable to save PIN. Check your account password.");
        return;
      }
      const result = await response.json() as { unlock_token?: unknown };
      if (!alive.current || started !== accessEpoch()) return;

      // Server-side PIN changes always remove the enrolled biometric public key.
      // Clear the corresponding Secure Enclave key as well.
      await clearNativeBiometric().catch(() => undefined);
      setBiometricEnabled(false);

      if (remove) forgetUnlock();
      else if (!acceptUnlock(result.unlock_token, started)) throw new Error("Missing unlock capability");
      setEnabled(!remove);
      setNotice(remove
        ? "Device PIN and biometric unlock removed."
        : "Device PIN saved. Re-enable biometric unlock below if you want it.");
    } catch {
      if (alive.current) setError("Unable to save PIN. Check your connection.");
    } finally {
      if (alive.current) { setBusy(false); setPassword(""); setPin(""); setConfirm(""); }
    }
  }

  async function enableBiometric() {
    if (biometricBusy || busy || !enabled || !biometricAvailable) return;
    if (!biometricPassword) { setError("Enter your account password for biometric setup."); return; }
    setBiometricBusy(true); setError(null); setNotice(null);
    try {
      const publicKeyX963B64 = await enrollNativeBiometric();
      const response = await privateFetch("/v1/auth/device-access/biometric", {
        method: "PUT",
        credentials: "include",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ public_key_x963_b64: publicKeyX963B64, password: biometricPassword }),
      });
      if (!response.ok) {
        await clearNativeBiometric().catch(() => undefined);
        throw new Error("Unable to register biometric key");
      }
      if (!alive.current) return;
      setBiometricEnabled(true);
      setNotice(`${biometricLabel} unlock enabled for this iPhone.`);
    } catch (reason) {
      if (!alive.current || isNativeBiometricCancellation(reason)) return;
      setError(`Unable to enable ${biometricLabel}. Use the device PIN instead.`);
    } finally {
      if (alive.current) { setBiometricBusy(false); setBiometricPassword(""); }
    }
  }

  async function disableBiometric() {
    if (biometricBusy || busy || !biometricEnabled) return;
    if (!biometricPassword) { setError("Enter your account password for biometric changes."); return; }
    setBiometricBusy(true); setError(null); setNotice(null);
    try {
      const response = await privateFetch("/v1/auth/device-access/biometric", {
        method: "DELETE",
        credentials: "include",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: biometricPassword }),
      });
      if (!response.ok && response.status !== 404) throw new Error("Unable to disable biometric unlock");
      await clearNativeBiometric().catch(() => undefined);
      if (!alive.current) return;
      setBiometricEnabled(false);
      setNotice("Biometric unlock disabled.");
    } catch {
      if (alive.current) setError("Unable to disable biometric unlock.");
    } finally {
      if (alive.current) { setBiometricBusy(false); setBiometricPassword(""); }
    }
  }

  function submit(e: FormEvent<HTMLFormElement>) { e.preventDefault(); void save(); }

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
    <form className="auth-form" onSubmit={submit}>
      <label>Account password<input type="password" name="device-password" autoComplete="current-password" required maxLength={1024}
        value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy || biometricBusy || enabled === null} /></label>
      <label>New four-digit PIN<input type="password" name="new-pin" inputMode="numeric" autoComplete="off" required minLength={4} maxLength={4} pattern="[0-9]{4}" className="device-pin-input"
        value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))} disabled={busy || biometricBusy || enabled === null} /></label>
      <label>Confirm PIN<input type="password" name="confirm-pin" inputMode="numeric" autoComplete="off" required minLength={4} maxLength={4} pattern="[0-9]{4}" className="device-pin-input"
        value={confirm} onChange={(e) => setConfirm(e.target.value.replace(/\D/g, "").slice(0, 4))} disabled={busy || biometricBusy || enabled === null} /></label>
      <button type="submit" className="primary-button" disabled={busy || biometricBusy || enabled === null}>{busy ? "Saving…" : enabled ? "Change PIN" : "Set PIN"}</button>
      {enabled && <button type="button" className="secondary-button" disabled={busy || biometricBusy} onClick={() => void save(true)}>Remove PIN</button>}
    </form>

    {enabled && (biometricAvailable || biometricEnabled) && (
      <div className="device-access-actions">
        <label>Account password for biometric changes
          <input type="password" autoComplete="current-password" maxLength={1024}
            value={biometricPassword} onChange={(e) => setBiometricPassword(e.target.value)}
            disabled={busy || biometricBusy} />
        </label>
        <p className="device-access-help">
          {biometricEnabled
            ? biometricAvailable
              ? `${biometricLabel} can unlock this session. PIN and account password remain available.`
              : "Biometric unlock is registered for this session but is currently unavailable on this iPhone."
            : `Use ${biometricLabel} for quick unlock on this iPhone. The private key never leaves the Secure Enclave.`}
        </p>
        {biometricEnabled ? (
          <>
            {biometricAvailable && (
              <button type="button" className="secondary-button" disabled={busy || biometricBusy} onClick={() => void enableBiometric()}>
                {biometricBusy ? "Updating…" : `Re-enroll ${biometricLabel}`}
              </button>
            )}
            <button type="button" className="secondary-button" disabled={busy || biometricBusy} onClick={() => void disableBiometric()}>
              {biometricBusy ? "Updating…" : "Disable biometric unlock"}
            </button>
          </>
        ) : (
          <button type="button" className="secondary-button" disabled={busy || biometricBusy} onClick={() => void enableBiometric()}>
            {biometricBusy ? "Setting up…" : `Enable ${biometricLabel}`}
          </button>
        )}
      </div>
    )}

    <p className="device-access-help">Five incorrect PIN attempts require your account password. PIN and biometric unlock need an internet connection.</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
  </section>;
}
