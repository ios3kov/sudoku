"use client";

import type { ReactNode } from "react";

export function ConversationHeader({
  title,
  subtitle,
  onBack,
  actions,
}: {
  title: string;
  subtitle: string;
  onBack: () => void;
  actions?: ReactNode;
}) {
  return (
    <header className="messenger-topbar minimal-chat-topbar">
      <div className="conversation-header-copy">
        <button
          className="back-button"
          type="button"
          onClick={onBack}
          aria-label="Back to conversations"
        >
          ‹
        </button>
        <div>
          <strong>{title}</strong>
          <span>{subtitle}</span>
        </div>
      </div>
      <div className="chat-header-actions">{actions}</div>
    </header>
  );
}
