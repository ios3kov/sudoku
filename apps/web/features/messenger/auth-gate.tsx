"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { MessengerShell } from "./messenger-shell";
import { MessengerRevealPreview } from "./messenger-reveal-preview";
import type { CurrentUser } from "./types";

type AuthView = "login" | "invite";

export function AuthGate({ onHide, active = true }: { onHide: () => void; active?: boolean }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<AuthView>("login");
  const [error, setError] = useState<string | null>(null);

  const checkSession = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/v1/me", { credentials: "include", cache: "no-store" });
      if (response.ok) {
        setUser((await response.json()) as CurrentUser);
      } else if (response.status === 401) {
        setUser(null);
      } else {
        setError("Unable to verify session");
      }
    } catch {
      setError("Network unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void checkSession();
  }, [checkSession]);

  if (loading) {
    return (
      <main className="page" aria-label="Private area">
        <section className="messenger-lock"><p>Checking…</p><button type="button" onClick={onHide}>Return to Sudoku</button></section>
      </main>
    );
  }

  if (user) {
    if (!active) return <MessengerRevealPreview user={user} />;
    return <MessengerShell user={user} onHide={onHide} onLoggedOut={() => setUser(null)} />;
  }

  return (
    <main className="page" aria-label="Private area locked">
      <section className="messenger-lock auth-card">
        <div className="private-header">
          <div>
            <h2>{view === "login" ? "Sign in" : "Join"}</h2>
            <p>{view === "login" ? "Private access" : "Invite-only access"}</p>
          </div>
          <button className="text-button" type="button" onClick={onHide}>Hide</button>
        </div>

        {view === "login" ? (
          <LoginForm onSuccess={setUser} onError={setError} />
        ) : (
          <InviteForm onSuccess={setUser} onError={setError} />
        )}

        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <button className="secondary-button" type="button" onClick={() => { setError(null); setView(view === "login" ? "invite" : "login"); }}>
          {view === "login" ? "Use an invite" : "I already have an account"}
        </button>
      </section>
    </main>
  );
}

function LoginForm({ onSuccess, onError }: { onSuccess: (user: CurrentUser) => void; onError: (message: string | null) => void }) {
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    onError(null);
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch("/v1/auth/login", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: data.get("email"),
          password: data.get("password"),
          device_name: "Sudoku web app",
        }),
      });
      if (!response.ok) {
        onError(response.status === 429 ? "Too many attempts. Try later." : "Invalid email or password");
        return;
      }
      onSuccess((await response.json()) as CurrentUser);
    } catch {
      onError("Network unavailable");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <label>Email<input name="email" type="email" autoComplete="username" required /></label>
      <label>Password<input name="password" type="password" autoComplete="current-password" required /></label>
      <button className="primary-button" type="submit" disabled={submitting}>{submitting ? "Signing in…" : "Sign in"}</button>
    </form>
  );
}

function InviteForm({ onSuccess, onError }: { onSuccess: (user: CurrentUser) => void; onError: (message: string | null) => void }) {
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    onError(null);
    const data = new FormData(event.currentTarget);
    const token = String(data.get("invite") ?? "").trim();
    try {
      const response = await fetch("/v1/invites/accept", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token,
          email: data.get("email"),
          display_name: data.get("display_name"),
          password: data.get("password"),
          device_name: "Sudoku web app",
        }),
      });
      if (!response.ok) {
        if (response.status === 403) onError("This invite is for a different email");
        else if (response.status === 409) onError("Account already exists");
        else if (response.status === 422) onError("Check the invite code, email, name, and password");
        else if (response.status === 429) onError("Too many attempts. Try later.");
        else onError("Invite is invalid or expired");
        return;
      }
      onSuccess((await response.json()) as CurrentUser);
    } catch {
      onError("Network unavailable");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <label>Invite code<input name="invite" autoCapitalize="none" autoCorrect="off" required /></label>
      <label>Name<input name="display_name" autoComplete="name" required maxLength={120} /></label>
      <label>Email<input name="email" type="email" autoComplete="username" required /></label>
      <label>Password<input name="password" type="password" autoComplete="new-password" minLength={12} required /></label>
      <button className="primary-button" type="submit" disabled={submitting}>{submitting ? "Joining…" : "Join"}</button>
    </form>
  );
}
