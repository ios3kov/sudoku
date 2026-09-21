"use client";

import { useState } from "react";
import { messengerApi } from "./api";
import type { Conversation } from "./types";

export function ConversationPreferences({
  conversation,
  onUpdated,
  onClose,
}: {
  conversation: Conversation;
  onUpdated: (conversation: Conversation) => void;
  onClose: () => void;
}) {
  const [saving, setSaving] = useState<"pin" | "mute" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function update(kind: "pin" | "mute") {
    setSaving(kind);
    setError(null);
    try {
      const next = await messengerApi.updateConversationPreferences(
        conversation.id,
        kind === "pin"
          ? { is_pinned: !conversation.is_pinned }
          : { notifications_muted: !conversation.notifications_muted },
      );
      onUpdated(next);
    } catch {
      setError("Unable to update conversation settings");
    } finally {
      setSaving(null);
    }
  }

  return (
    <section className="conversation-tools" role="dialog" aria-label="Conversation settings">
      <header className="settings-header">
        <div>
          <strong>Conversation</strong>
          <span>Only your account sees these preferences.</span>
        </div>
        <button type="button" onClick={onClose}>Done</button>
      </header>
      <div className="settings-list">
        <button className="preference-row" type="button" disabled={saving !== null} onClick={() => void update("pin")}>
          <span><strong>{conversation.is_pinned ? "Unpin chat" : "Pin chat"}</strong><small>Keep it at the top of your list</small></span>
          <span aria-hidden="true">{conversation.is_pinned ? "On" : "Off"}</span>
        </button>
        <button className="preference-row" type="button" disabled={saving !== null} onClick={() => void update("mute")}>
          <span><strong>{conversation.notifications_muted ? "Unmute notifications" : "Mute notifications"}</strong><small>Stops server push for this conversation</small></span>
          <span aria-hidden="true">{conversation.notifications_muted ? "On" : "Off"}</span>
        </button>
      </div>
      {error ? <p className="form-error">{error}</p> : null}
    </section>
  );
}
