"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { MessengerShell } from "./messenger-shell";
import { MessengerRevealPreview } from "./messenger-reveal-preview";
import { ConversationDraftProvider } from "./conversation-drafts";
import { DevicePinUnlock } from "./device-pin-unlock";
import { DevicePinOnboarding } from "./device-pin-onboarding";
import { DEVICE_LOCK_EVENT, acceptUnlock, accessEpoch, forgetUnlock, lockDevice, privateFetch, rememberEmail, savedEmail } from "./device-access";
import type { CurrentUser } from "./types";
import "./device-access.css";

type AuthView = "login" | "invite";

export function AuthGate({ onHide, active = true }: { onHide: () => void; active?: boolean }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [pinRequired, setPinRequired] = useState(false);
  const [pendingLogin, setPendingLogin] = useState<CurrentUser | null>(null);
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
    forgetUnlock(); setUser(null); setPinRequired(false); setError(null); setLoading(false);
  }, []);
  const hide = useCallback(() => { lockDevice(); hideRef.current(); }, []);

  const completePendingLogin = useCallback(() => {
    if (!pendingLogin) return;
    loginPasswordRef.current = null;
    setPendingLogin(null);
    setUser(pendingLogin);
  }, [pendingLogin]);

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
    loginPasswordRef.current = null;
    setPendingLogin(null);
    setUser(pendingLogin);
  }, [pendingLogin]);

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
    void checkSession();
    return () => {
      alive.current = false; requestId.current += 1; lockDevice();
      window.removeEventListener(DEVICE_LOCK_EVENT, locked);
      window.removeEventListener("pagehide", hide);
      document.removeEventListener("visibilitychange", background);
    };
  }, [checkSession, hide]);

  if (loading) return <main className="page" aria-label="Private area">
    <section className="messenger-lock"><p>Checking…</p><button type="button" onClick={hide}>Return to Sudoku</button></section>
  </main>;

  if (pinRequired) return <DevicePinUnlock onUnlocked={checkSession} onSignedOut={signedOut} onHide={hide} />;

  if (pendingLogin) return <DevicePinOnboarding
    onSetPin={configurePendingPin}
    onSkip={completePendingLogin}
    onHide={() => { completePendingLogin(); hide(); }}
  />;

  if (user) {
    if (!active) return <MessengerRevealPreview user={user} />;
    return <ConversationDraftProvider key={user.id}><MessengerShell user={user} onHide={hide} onLoggedOut={signedOut} /></ConversationDraftProvider>;
  }

  return <main className="page" aria-label="Private area locked">
    <section className="messenger-lock auth-card">
      <div className="private-header"><div><h2>{view === "login" ? "Sign in" : "Join"}</h2><p>{view === "login" ? "Private access" : "Invite-only access"}</p></div>
        <button className="text-button" type="button" onClick={hide}>Hide</button></div>
      {view === "login" ? <LoginForm onSuccess={(current, password) => {
        loginPasswordRef.current = password;
        setPendingLogin(current);
      }} onError={setError} /> : <InviteForm onSuccess={setUser} onError={setError} />}
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="secondary-button" type="button" onClick={() => { setError(null); setView(view === "login" ? "invite" : "login"); }}>
        {view === "login" ? "Use an invite" : "I already have an account"}
      </button>
    </section>
  </main>;
}

function LoginForm({ onSuccess, onError }: { onSuccess: (user: CurrentUser, password: string) => void; onError: (message: string | null) => void }) {
  const [submitting, setSubmitting] = useState(false);
  const [email, setEmail] = useState("");
  const [remember, setRemember] = useState(false);
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    const stored = savedEmail(); setEmail(stored); setRemember(Boolean(stored));
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
        body: JSON.stringify({ email, password, device_name: "Sudoku web app" }),
      });
      if (!alive.current || started !== accessEpoch()) return;
      if (!response.ok) { onError(response.status === 429 ? "Too many attempts. Try later." : "Invalid email or password"); return; }
      const current = await response.json() as CurrentUser;
      if (!alive.current || started !== accessEpoch()) return;
      rememberEmail(current.email, remember);
      forgetUnlock(); onSuccess(current, password);
    } catch { if (alive.current) onError("Network unavailable"); }
    finally { if (alive.current) setSubmitting(false); }
  }

  return <form className="auth-form" onSubmit={submit}>
    <label>Email<input name="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
    <label>Password<input name="password" type="password" autoComplete="current-password" required /></label>
    <label className="device-access-choice"><input type="checkbox" checked={remember} onChange={(e) => {
      const checked = e.target.checked; setRemember(checked);
      if (!checked && !rememberEmail("", false)) onError("Unable to forget saved email. Clear this site's storage in your browser settings.");
    }} />Remember email on this device</label>
    <button className="primary-button" type="submit" disabled={submitting}>{submitting ? "Signing in…" : "Sign in"}</button>
  </form>;
}

function InviteForm({ onSuccess, onError }: { onSuccess: (user: CurrentUser) => void; onError: (message: string | null) => void }) {
  const [submitting, setSubmitting] = useState(false);
  const alive = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true); onError(null);
    const data = new FormData(event.currentTarget);
    const token = String(data.get("invite") ?? "").trim();
    const started = accessEpoch();
    try {
      const response = await fetch("/v1/invites/accept", {
        method: "POST", credentials: "include", headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, email: data.get("email"), display_name: data.get("display_name"), password: data.get("password"), device_name: "Sudoku web app" }),
      });
      if (!alive.current || started !== accessEpoch()) return;
      if (!response.ok) {
        if (response.status === 403) onError("This invite is for a different email");
        else if (response.status === 409) onError("Account already exists");
        else if (response.status === 422) onError("Check the invite code, email, name, and password");
        else if (response.status === 429) onError("Too many attempts. Try later.");
        else onError("Invite is invalid or expired");
        return;
      }
      const current = await response.json() as CurrentUser;
      if (alive.current && started === accessEpoch()) { forgetUnlock(); onSuccess(current); }
    } catch { if (alive.current) onError("Network unavailable"); }
    finally { if (alive.current) setSubmitting(false); }
  }

  return <form className="auth-form" onSubmit={submit}>
    <label>Invite code<input name="invite" autoCapitalize="none" autoCorrect="off" required /></label>
    <label>Name<input name="display_name" autoComplete="name" required maxLength={120} /></label>
    <label>Email<input name="email" type="email" autoComplete="username" required /></label>
    <label>Password<input name="password" type="password" autoComplete="new-password" minLength={12} required /></label>
    <button className="primary-button" type="submit" disabled={submitting}>{submitting ? "Joining…" : "Join"}</button>
  </form>;
}
