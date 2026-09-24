"use client";

import { useCallback, useEffect, useState } from "react";
import type { OpenMlsProtocolAdapter } from "./crypto/openmls-adapter";
import type { Conversation, CurrentUser } from "./types";

interface VerificationRow {
  userId: string;
  displayName: string;
  deviceId: string;
  safetyNumber: string;
  verified: boolean;
}

export function SecurityVerification({
  conversation,
  user,
  adapter,
  onClose,
}: {
  conversation: Conversation;
  user: CurrentUser;
  adapter: OpenMlsProtocolAdapter;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<VerificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next: VerificationRow[] = [];
      for (const member of conversation.members) {
        if (member.id === user.id) continue;
        const details = await adapter.peerVerificationDetails(
          conversation.id,
          member.id,
        );
        for (const detail of details) {
          next.push({
            userId: member.id,
            displayName: member.display_name,
            deviceId: detail.deviceId,
            safetyNumber: detail.safetyNumber,
            verified: detail.verified,
          });
        }
      }
      setRows(next);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load device verification",
      );
    } finally {
      setLoading(false);
    }
  }, [adapter, conversation.id, conversation.members, user.id]);

  useEffect(() => {
    // Fetch external device identities when group membership changes; this is not derived render state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function verify(row: VerificationRow) {
    const key = row.userId + ":" + row.deviceId;
    setBusyKey(key);
    setError(null);
    try {
      await adapter.markPeerIdentityVerified(row.userId, row.deviceId);
      setRows((current) => current.map((item) =>
        item.userId === row.userId && item.deviceId === row.deviceId
          ? { ...item, verified: true }
          : item
      ));
    } catch {
      setError("Unable to mark this device as verified");
    } finally {
      setBusyKey(null);
    }
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      setError("Unable to copy safety number");
    }
  }

  return (
    <section className="group-settings" role="dialog" aria-label="Security verification">
      <div className="settings-header">
        <div>
          <strong>Verify devices</strong>
          <span>Compare the number through another trusted channel.</span>
        </div>
        <button type="button" onClick={onClose}>Close</button>
      </div>
      {error ? <p className="form-error">{error}</p> : null}
      {loading ? <p className="muted">Loading secure devices…</p> : null}
      {!loading && rows.length === 0 ? (
        <p className="muted">No peer device identity is available on this device yet.</p>
      ) : null}
      <div className="settings-list">
        {rows.map((row) => {
          const key = row.userId + ":" + row.deviceId;
          return (
            <div className="settings-row" key={key}>
              <div>
                <strong>{row.displayName}</strong>
                <small>Device {row.deviceId.slice(0, 8)}…</small>
                <code>{row.safetyNumber}</code>
              </div>
              <div className="member-actions">
                <button type="button" onClick={() => void copy(row.safetyNumber)}>
                  Copy
                </button>
                <button
                  type="button"
                  disabled={row.verified || busyKey === key}
                  onClick={() => void verify(row)}
                >
                  {row.verified ? "Verified" : busyKey === key ? "Saving…" : "Mark verified"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
