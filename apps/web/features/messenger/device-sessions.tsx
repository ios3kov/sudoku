"use client";

import { useEffect, useState } from "react";
import { messengerApi } from "./api";
import { DeviceAccessSettings } from "./device-access-settings";
import type { DeviceSession } from "./types";

export function DeviceSessions({ onClose, onCurrentRevoked, onPhoneUpdated }: { onClose: () => void; onCurrentRevoked: () => void; onPhoneUpdated?: (phone: string) => void }) {
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
    <section className="settings-panel" role="dialog" aria-label="Devices and sessions">
      <div className="settings-header"><div><strong>Devices</strong><span>Signed-in sessions</span></div><button type="button" onClick={onClose}>Close</button></div>
      <DeviceAccessSettings onPhoneUpdated={onPhoneUpdated} />
      {error ? <p className="form-error">{error}</p> : null}
      {loading ? <p className="muted">Loading…</p> : (
        <div className="settings-list">
          {sessions.map((session) => (
            <div className="settings-row" key={session.id}>
              <div><strong>{session.device_name}</strong><small>{session.current ? "This device" : `Expires ${new Date(session.expires_at).toLocaleDateString()}`}</small></div>
              <button type="button" disabled={busyId === session.id} onClick={() => void revoke(session)}>{session.current ? "Sign out" : "Revoke"}</button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
