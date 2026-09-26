"use client";

import { FormEvent, useState } from "react";
import { messengerApi } from "./api";
import { PhoneInput } from "./phone-input";

export function AdminInvite({ onClose }: { onClose: () => void }) {
  const [token, setToken] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [phone, setPhone] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setToken(null);
     if (!phone) {
      setSubmitting(false);
      setError("Phone number is required");
      return;
    }
    try {
      const invite = await messengerApi.createInvite(phone);
      setToken(invite.token);
      setExpiresAt(invite.expires_at);
    } catch (requestError) {
      const status = (requestError as Error & { status?: number }).status;
      setError(status === 429 ? "Too many invites. Try later." : "Unable to create invite");
    } finally {
      setSubmitting(false);
    }
  }

  async function copyToken() {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Copy failed. Select the code manually.");
    }
  }

  return (
    <section className="admin-invite-panel" role="dialog" aria-label="Create invite">
      <div className="admin-invite-header">
        <div><strong>Invite member</strong><span>Admin only</span></div>
        <button type="button" onClick={onClose}>Close</button>
      </div>
      {!token ? (
        <form className="auth-form" onSubmit={submit}>
          <PhoneInput value={phone} onChange={setPhone} required />
          <p className="muted">One use · expires in 7 days.</p>
          <button className="primary-button" type="submit" disabled={submitting}>{submitting ? "Creating…" : "Create invite"}</button>
        </form>
      ) : (
        <div className="invite-result">
          <p>Share this code privately. It is shown only now.</p>
          <code>{token}</code>
          <button className="primary-button" type="button" onClick={() => void copyToken()}>{copied ? "Copied" : "Copy code"}</button>
          {expiresAt ? <small>Expires {new Date(expiresAt).toLocaleString()}</small> : null}
        </div>
      )}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </section>
  );
}
