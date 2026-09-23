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
import {
  NATIVE_BIOMETRICS_READY_EVENT,
  biometricLabel,
  enrollNativeBiometricCredential,
  getNativeBiometricAvailability,
  nativeBiometricsAvailable,
  removeNativeBiometricCredential,
  type NativeBiometricKind,
} from "./native-biometric-access";
import "./device-access.css";

export function DeviceAccessSettings({ onPhoneUpdated }: { onPhoneUpdated?: (phone: string) => void }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [biometricBridgePresent, setBiometricBridgePresent] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricKind, setBiometricKind] = useState<NativeBiometricKind>("none");
  const [biometricPassword, setBiometricPassword] = useState("");
  const [biometricBusy, setBiometricBusy] = useState(false);
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

    const refreshNativeBiometrics = () => {
      const bridgePresent = nativeBiometricsAvailable();
      if (alive.current) setBiometricBridgePresent(bridgePresent);
      if (!bridgePresent) {
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

    void Promise.all([
      privateFetch("/v1/auth/device-access", {
        credentials: "include",
        cache: "no-store",
      }).then(async (r) => {
        if (!r.ok) throw new Error("Unable to load device access");
        return r.json();
      }),
      messengerApi.me(),
    ]).then(([settings, user]) => {
      if (alive.current) {
        const currentPhone = user.phone_e164 ?? "";
        setEnabled(Boolean(settings.pin_enabled));
        setBiometricEnabled(Boolean(settings.biometric_enabled));
        setPhone(currentPhone);
        setPhoneDraft(currentPhone);
        setRemember(Boolean(currentPhone) && savedPhone() === currentPhone);
      }
    }).catch(() => {
      if (alive.current) {
        setError("Unable to load device access. Close and reopen Devices to retry.");
      }
    });

    return () => {
      alive.current = false;
      window.removeEventListener(
        NATIVE_BIOMETRICS_READY_EVENT,
        refreshNativeBiometrics,
      );
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

  async function save(remove = false) {
    if (busy || enabled === null) return;
    setError(null); setNotice(null);
    if (!password) {
      setError("Enter your account password.");
      return;
    }
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

      // PIN replacement/removal invalidates the server-side biometric binding.
      // Remove the corresponding Secure Enclave key as well.
      await removeNativeBiometricCredential().catch(() => undefined);
      setBiometricEnabled(false);

      if (remove) forgetUnlock();
      else if (!acceptUnlock(result.unlock_token, started)) {
        throw new Error("Missing unlock capability");
      }

      setEnabled(!remove);
      setNotice(
        remove
          ? "Device PIN removed."
          : "Device PIN saved. It is required when you return to the private area.",
      );
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

  async function configureBiometric(remove = false) {
    if (
      biometricBusy
      || !biometricBridgePresent
      || enabled !== true
      || !biometricPassword
      || (!remove && !biometricAvailable)
    ) {
      if (!biometricPassword) setError("Enter your account password.");
      return;
    }

    const label = biometricLabel(biometricKind);
    setBiometricBusy(true);
    setError(null);
    setNotice(null);

    try {
      if (remove) {
        const response = await privateFetch(
          "/v1/auth/device-access/biometric",
          {
            method: "DELETE",
            credentials: "include",
            cache: "no-store",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ password: biometricPassword }),
          },
        );
        if (!response.ok) {
          setError(
            response.status === 403
              ? "Incorrect account password."
              : "Unable to disable biometric unlock.",
          );
          return;
        }

        await removeNativeBiometricCredential().catch(() => undefined);
        if (!alive.current) return;
        setBiometricEnabled(false);
        setNotice(`${label} unlock disabled.`);
        return;
      }

      const publicKey = await enrollNativeBiometricCredential();
      const response = await privateFetch(
        "/v1/auth/device-access/biometric",
        {
          method: "PUT",
          credentials: "include",
          cache: "no-store",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            password: biometricPassword,
            public_key_x963_b64: publicKey,
          }),
        },
      );
      if (!response.ok) {
        await removeNativeBiometricCredential().catch(() => undefined);
        setError(
          response.status === 403
            ? "Incorrect account password."
            : response.status === 409
              ? "Set a device PIN before enabling biometric unlock."
              : "Unable to enable biometric unlock.",
        );
        return;
      }

      if (!alive.current) return;
      setBiometricEnabled(true);
      setNotice(`${label} unlock enabled. Your PIN remains the fallback.`);
    } catch {
      if (alive.current) {
        setError(`${label} is unavailable on this device.`);
      }
    } finally {
      if (alive.current) {
        setBiometricBusy(false);
        setBiometricPassword("");
      }
    }
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void save();
  }

  const nativeLabel = biometricLabel(biometricKind);

  return <section className="device-access-panel" aria-label="Login and device PIN">
    <h3>Login and device PIN</h3>
    <p>PIN applies only to this device. Your account password is not saved.</p>

    <div className="auth-form">
      <label>Phone number
        <input
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="+382..."
          value={phoneDraft}
          onChange={(e) => setPhoneDraft(e.target.value)}
          disabled={phoneBusy}
        />
      </label>
      <label>Account password for phone change
        <input
          type="password"
          autoComplete="current-password"
          value={phonePassword}
          onChange={(e) => setPhonePassword(e.target.value)}
          disabled={phoneBusy}
        />
      </label>
      <button
        type="button"
        className="secondary-button"
        disabled={
          phoneBusy
          || !phoneDraft.trim()
          || !phonePassword
          || phoneDraft === phone
        }
        onClick={() => void savePhone()}
      >
        {phoneBusy ? "Saving phone…" : phone ? "Change phone" : "Set phone"}
      </button>
    </div>

    <label className="device-access-choice">
      <input
        type="checkbox"
        checked={remember}
        disabled={!phone}
        onChange={(e) => {
          const value = e.target.checked;
          if (rememberPhone(phone, value)) {
            setRemember(value);
            setError(null);
          } else {
            setError("This browser cannot save the phone number.");
          }
        }}
      />
      Remember phone on this device
    </label>

    <p>
      {enabled === null
        ? "Loading PIN settings…"
        : enabled
          ? "Device PIN is enabled."
          : "Device PIN is not enabled."}
    </p>

    <form className="auth-form" onSubmit={submit}>
      <label>Account password
        <input
          type="password"
          name="device-password"
          autoComplete="current-password"
          required
          maxLength={1024}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={busy || enabled === null}
        />
      </label>
      <label>New four-digit PIN
        <input
          type="password"
          name="new-pin"
          inputMode="numeric"
          autoComplete="off"
          required
          minLength={4}
          maxLength={4}
          pattern="[0-9]{4}"
          className="device-pin-input"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          disabled={busy || enabled === null}
        />
      </label>
      <label>Confirm PIN
        <input
          type="password"
          name="confirm-pin"
          inputMode="numeric"
          autoComplete="off"
          required
          minLength={4}
          maxLength={4}
          pattern="[0-9]{4}"
          className="device-pin-input"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          disabled={busy || enabled === null}
        />
      </label>
      <button
        type="submit"
        className="primary-button"
        disabled={busy || enabled === null}
      >
        {busy ? "Saving…" : enabled ? "Change PIN" : "Set PIN"}
      </button>
      {enabled && <button
        type="button"
        className="secondary-button"
        disabled={busy}
        onClick={() => void save(true)}
      >
        Remove PIN
      </button>}
    </form>

    <p className="device-access-help">
      Five incorrect PIN attempts require your account password. PIN unlock needs an internet connection.
    </p>

    {biometricBridgePresent ? (
      <div className="auth-form native-biometric-settings">
        <p>
          {enabled
            ? biometricEnabled
              ? biometricAvailable
                ? `${nativeLabel} unlock is enabled.`
                : "Biometric unlock is enabled but currently unavailable on this iPhone."
              : biometricAvailable
                ? `${nativeLabel} unlock is available.`
                : "Biometric unlock is unavailable on this iPhone."
            : `Set a device PIN before enabling ${nativeLabel}.`}
        </p>
        <label>Account password for {nativeLabel}
          <input
            type="password"
            name="biometric-password"
            autoComplete="current-password"
            maxLength={1024}
            value={biometricPassword}
            onChange={(e) => setBiometricPassword(e.target.value)}
            disabled={biometricBusy || enabled !== true}
          />
        </label>
        {biometricEnabled ? (
          <button
            type="button"
            className="secondary-button"
            disabled={
              biometricBusy
              || enabled !== true
              || !biometricPassword
            }
            onClick={() => void configureBiometric(true)}
          >
            {biometricBusy ? "Updating…" : `Disable ${nativeLabel}`}
          </button>
        ) : (
          <button
            type="button"
            className="primary-button"
            disabled={
              biometricBusy
              || enabled !== true
              || !biometricAvailable
              || !biometricPassword
            }
            onClick={() => void configureBiometric(false)}
          >
            {biometricBusy ? "Enabling…" : `Enable ${nativeLabel}`}
          </button>
        )}
        <p className="device-access-help">
          The private key stays in the iPhone Secure Enclave. The server stores only its public key.
        </p>
      </div>
    ) : null}

    {error && <p className="form-error" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
  </section>;
}
