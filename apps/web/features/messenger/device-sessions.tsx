"use client";

import { useEffect, useState } from "react";
import { messengerApi } from "./api";
import { DeviceAccessSettings } from "./device-access-settings";
import type { DeviceSession } from "./types";

type PushState = "idle" | "enabling" | "enabled" | "error";

export function DeviceSessions({
  onClose,
  onCurrentRevoked,
  onPhoneUpdated,
  isAdmin = false,
  onOpenInvite,
  onEnablePush,
  pushState = "idle",
  onSignOut,
  signingOut = false,
}: {
  onClose: () => void;
  onCurrentRevoked: () => void;
  onPhoneUpdated?: (phone: string) => void;
  isAdmin?: boolean;
  onOpenInvite?: () => void;
  onEnablePush?: () => void;
  pushState?: PushState;
  onSignOut?: () => void;
  signingOut?: boolean;
}) {
  const [sessions, setSessions] = useState<DeviceSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setSessions(await messengerApi.sessions());
    } catch {
      setError("Unable to load devices");
    } finally {
      setLoading(false);
    }
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, []);

  async function revoke(session: DeviceSession) {
    setBusyId(session.id);
    setError(null);
    try {
      await messengerApi.revokeSession(session.id);
      if (session.current) {
        onCurrentRevoked();
        return;
      }
      await load();
    } catch {
      setError("Unable to revoke session");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="settings-panel settings-hub" role="dialog" aria-label="Devices and sessions">
      <div className="settings-header">
        <div><strong>Settings</strong><span>Account, security and devices</span></div>
        <button type="button" onClick={onClose}>Close</button>
      </div>

      <DeviceAccessSettings onPhoneUpdated={onPhoneUpdated} />

      <section className="settings-section-card" aria-label="Signed-in devices">
        <div className="settings-section-heading">
          <h3>Devices</h3>
          <p>Signed-in sessions for this account.</p>
        </div>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        {loading ? <p className="muted">Loading…</p> : (
          <div className="settings-list">
            {sessions.map((session) => (
              <div className="settings-row" key={session.id}>
                <div>
                  <strong>{session.device_name}</strong>
                  <small>{session.current ? "This device" : `Expires ${new Date(session.expires_at).toLocaleDateString()}`}</small>
                </div>
                <button type="button" disabled={busyId === session.id} onClick={() => void revoke(session)}>
                  {session.current ? "Sign out" : "Revoke"}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="settings-section-card settings-actions-card" aria-label="App settings">
        <div className="settings-section-heading">
          <h3>Messenger</h3>
          <p>Invites, notifications and account actions.</p>
        </div>
        {isAdmin && onOpenInvite ? (
          <button type="button" className="settings-action-row" onClick={onOpenInvite}>
            <span><strong>Invite member</strong><small>Admin only</small></span>
            <span aria-hidden="true">›</span>
          </button>
        ) : null}
        {onEnablePush ? (
          <button
            type="button"
            className="settings-action-row"
            onClick={onEnablePush}
            disabled={pushState === "enabling" || pushState === "enabled"}
          >
            <span>
              <strong>Notifications</strong>
              <small>
                {pushState === "enabled"
                  ? "Enabled"
                  : pushState === "enabling"
                    ? "Enabling…"
                    : pushState === "error"
                      ? "Tap to retry"
                      : "Enable masked notifications"}
              </small>
            </span>
            <span aria-hidden="true">›</span>
          </button>
        ) : null}
        {onSignOut ? (
          <button
            type="button"
            className="settings-action-row is-destructive"
            onClick={onSignOut}
            disabled={signingOut}
          >
            <span><strong>{signingOut ? "Signing out…" : "Sign out"}</strong><small>End this session</small></span>
            <span aria-hidden="true">›</span>
          </button>
        ) : null}
      </section>
    </section>
  );
}
