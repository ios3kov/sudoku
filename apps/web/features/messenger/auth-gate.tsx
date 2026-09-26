"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { MessengerShell } from "./messenger-shell";
import { MessengerRevealPreview } from "./messenger-reveal-preview";
import { ConversationDraftProvider } from "./conversation-drafts";
import { DevicePinUnlock } from "./device-pin-unlock";
import { DevicePinOnboarding } from "./device-pin-onboarding";
import { DisplayNameOnboarding, profileConfirmedKey } from "./display-name-onboarding";
import { PhoneInput } from "./phone-input";
import { DEVICE_LOCK_EVENT, acceptUnlock, accessEpoch, forgetUnlock, lockDevice, privateFetch, rememberPhone, savedPhone } from "./device-access";
import type { CurrentUser } from "./types";
import { rememberMessengerEntry } from "../sudoku/startup-preference";
import "./device-access.css";

type AuthView = "login" | "invite";

export function AuthGate({ onHide, active = true }: { onHide: () => void; active?: boolean }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [pinRequired, setPinRequired] = useState(false);
  const [pendingLogin, setPendingLogin] = useState<CurrentUser | null>(null);
  const [pendingProfile, setPendingProfile] = useState<CurrentUser | null>(null);
  const [view, setView] = useState<AuthView>("login");
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(false);
  const requestId = useRef(0);
  const hideRef = useRef(onHide);
  const loginPasswordRef = useRef<string | null>(null);
  useEffect(() => { hideRef.current = onHide; }, [onHide]);

  const signedOut = useCallback(() => {
    loginPasswordRef.current = null;
    setPendingLogin(null);
    setPendingProfile(null);
    forgetUnlock(); setUser(null); setPinRequired(false); setError(null); setLoading(false);
  }, []);
  const hide = useCallback(() => { lockDevice(); hideRef.current(); }, []);

  const finishIdentitySetup = useCallback((current: CurrentUser) => {
    loginPasswordRef.current = null;
    setPendingLogin(null);
    let confirmed = false;
    try {
      confirmed = localStorage.getItem(profileConfirmedKey(current.id)) === "1";
    } catch {
      confirmed = false;
    }
    if (confirmed) {
      setUser(current);
    } else {
      setPendingProfile(current);
    }
  }, []);

  const completePendingLogin = useCallback(() => {
    if (!pendingLogin) return;
    finishIdentitySetup(pendingLogin);
  }, [finishIdentitySetup, pendingLogin]);

  const configurePendingPin = useCallback(async (pin: string) => {
    const password = loginPasswordRef.current;
    if (!pendingLogin || !password) throw new Error("Sign in again to set a PIN.");
    const started = accessEpoch();
    const response = await privateFetch("/v1/auth/device-access", {
      method: "PUT",
      credentials: "include",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password, pin }),
    });
    if (!response.ok) {
      if (response.status === 401) throw new Error("Session expired. Sign in again.");
      if (response.status === 429) throw new Error("Too many attempts. Try later.");
      throw new Error("Unable to save PIN. Try again.");
    }
    const result = await response.json() as { unlock_token?: unknown };
    if (!acceptUnlock(result.unlock_token, started)) {
      throw new Error("Device state changed. Try again.");
    }
    finishIdentitySetup(pendingLogin);
  }, [finishIdentitySetup, pendingLogin]);

  const checkSession = useCallback(async () => {
    const id = ++requestId.current;
    const started = accessEpoch();
    setLoading(true); setError(null);
    try {
      const response = await privateFetch("/v1/me", { credentials: "include", cache: "no-store" });
      if (!alive.current || id !== requestId.current) return;
      if (response.status === 423) { setUser(null); setPinRequired(true); return; }
      if (started !== accessEpoch()) return;
      if (response.ok) {
        const current = await response.json() as CurrentUser;
        if (alive.current && id === requestId.current && started === accessEpoch()) { setUser(current); setPinRequired(false); }
      } else if (response.status === 401) {
        signedOut();
      } else setError("Unable to verify session");
    } catch {
      if (alive.current && id === requestId.current && started === accessEpoch()) setError("Network unavailable");
    } finally { if (alive.current && id === requestId.current) setLoading(false); }
  }, [signedOut]);

  useEffect(() => {
    alive.current = true;
    const locked = () => { requestId.current += 1; setUser(null); setPinRequired(true); setLoading(false); setError(null); };
    const background = () => { if (document.visibilityState === "hidden") hide(); };
    window.addEventListener(DEVICE_LOCK_EVENT, locked);
    window.addEventListener("pagehide", hide);
    document.addEventListener("visibilitychange", background);
    // Session verification performs asynchronous I/O; initial/loading and lock states must remain synchronous.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void checkSession();
    return () => {
      loginPasswordRef.current = null;
      alive.current = false; requestId.current += 1; lockDevice();
      window.removeEventListener(DEVICE_LOCK_EVENT, locked);
      window.removeEventListener("pagehide", hide);
      document.removeEventListener("visibilitychange", background);
    };
  }, [checkSession, hide]);

  useEffect(() => {
    // AuthGate also lives beneath the game as a reveal preview. A background
    // session check or PIN onboarding is not a successful messenger entry.
    if (active && user && !loading && !pinRequired && !pendingLogin && !pendingProfile) rememberMessengerEntry();
  }, [active, user, loading, pinRequired, pendingLogin, pendingProfile]);

  if (loading) return <main className="page" aria-label="Private area">
    <section className="messenger-lock"><p>Checking…</p><button type="button" onClick={hide}>Return to Sudoku</button></section>
  </main>;

  if (pinRequired) return <DevicePinUnlock onUnlocked={checkSession} onSignedOut={signedOut} onHide={hide} />;

  if (pendingLogin) return <DevicePinOnboarding
    onSetPin={configurePendingPin}
    onSkip={completePendingLogin}
    onHide={() => { completePendingLogin(); hide(); }}
  />;

  if (pendingProfile) return <DisplayNameOnboarding
    user={pendingProfile}
    onDone={(updated) => {
      setPendingProfile(null);
      setUser(updated);
    }}
    onHide={hide}
  />;

  if (user) {
    if (!active) return <MessengerRevealPreview user={user} />;
    return <ConversationDraftProvider key={user.id}><MessengerShell user={user} onHide={hide} onLoggedOut={signedOut} onUserUpdated={setUser} /></ConversationDraftProvider>;
  }

  return <main className="page" aria-label="Private area locked">
    <section className="messenger-lock auth-card">
      <div className="private-header"><div><h2>{view === "login" ? "Sign in" : "Join"}</h2><p>{view === "login" ? "Private access" : "Invite-only access"}</p></div>
        <button className="text-button" type="button" onClick={hide}>Hide</button></div>
      {view === "login" ? <LoginForm onSuccess={(current, password) => {
        loginPasswordRef.current = password;
        setPendingLogin(current);
      }} onError={setError} /> : <InviteForm onSuccess={(current, password) => {
        loginPasswordRef.current = password;
        setPendingLogin(current);
      }} onError={setError} />}
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="secondary-button" type="button" onClick={() => { setError(null); setView(view === "login" ? "invite" : "login"); }}>
        {view === "login" ? "Use an invite" : "I already have an account"}
      </button>
    </section>
  </main>;
}

function LoginForm({ onSuccess, onError }: { onSuccess: (user: CurrentUser, password: string) => void; onError: (message: string | null) => void }) {
  const [submitting, setSubmitting] = useState(false);
  const [phone, setPhone] = useState(savedPhone);
  const [remember, setRemember] = useState(() => Boolean(savedPhone()));
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true); onError(null);
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password") ?? "");
    const started = accessEpoch();
    try {
      const response = await fetch("/v1/auth/login", {
        method: "POST", credentials: "include", headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone, password, device_name: "Sudoku web app" }),
      });
      if (!alive.current || started !== accessEpoch()) return;
      if (!response.ok) { onError(response.status === 429 ? "Too many attempts. Try later." : "Invalid phone number or password"); return; }
      const current = await response.json() as CurrentUser;
      if (!alive.current || started !== accessEpoch()) return;
      rememberPhone(current.phone_e164 ?? phone, remember);
      forgetUnlock(); onSuccess(current, password);
    } catch { if (alive.current) onError("Network unavailable"); }
    finally { if (alive.current) setSubmitting(false); }
  }

  return <form className="auth-form" onSubmit={submit}>
    <PhoneInput value={phone} onChange={setPhone} required />
    <label>Password<input name="password" type="password" autoComplete="current-password" required /></label>
    <label className="device-access-choice"><input type="checkbox" checked={remember} onChange={(e) => {
      const checked = e.target.checked; setRemember(checked);
      if (!checked && !rememberPhone("", false)) onError("Unable to forget saved phone. Clear this site's storage in your browser settings.");
    }} />Remember phone on this device</label>
    <button className="primary-button" type="submit" disabled={submitting}>{submitting ? "Signing in…" : "Sign in"}</button>
  </form>;
}

function InviteForm({ onSuccess, onError }: { onSuccess: (user: CurrentUser, password: string) => void; onError: (message: string | null) => void }) {
  const [submitting, setSubmitting] = useState(false);
  const [phone, setPhone] = useState("");
  const alive = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true); onError(null);
    const data = new FormData(event.currentTarget);
    const token = String(data.get("invite") ?? "").trim();
    const password = String(data.get("password") ?? "");
    const started = accessEpoch();
    try {
      const response = await fetch("/v1/invites/accept", {
        method: "POST", credentials: "include", headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, phone, display_name: data.get("display_name"), password, device_name: "Sudoku web app" }),
      });
      if (!alive.current || started !== accessEpoch()) return;
      if (!response.ok) {
        if (response.status === 403) onError("This invite is for a different phone number");
        else if (response.status === 409) onError("Account already exists");
        else if (response.status === 422) onError("Check the invite code, phone number, name, and password");
        else if (response.status === 429) onError("Too many attempts. Try later.");
        else onError("Invite is invalid or expired");
        return;
      }
      const current = await response.json() as CurrentUser;
      if (alive.current && started === accessEpoch()) { forgetUnlock(); onSuccess(current, password); }
    } catch { if (alive.current) onError("Network unavailable"); }
    finally { if (alive.current) setSubmitting(false); }
  }

  return <form className="auth-form" onSubmit={submit}>
    <label>Invite code<input name="invite" autoCapitalize="none" autoCorrect="off" required /></label>
    <label>Name<input name="display_name" autoComplete="name" required maxLength={120} /></label>
    <PhoneInput value={phone} onChange={setPhone} required />
    <label>Password<input name="password" type="password" autoComplete="new-password" minLength={12} required /></label>
    <button className="primary-button" type="submit" disabled={submitting}>{submitting ? "Joining…" : "Join"}</button>
  </form>;
}
