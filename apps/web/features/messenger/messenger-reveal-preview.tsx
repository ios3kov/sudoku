"use client";

import { useEffect, useState } from "react";
import { messengerApi } from "./api";
import { conversationTitle } from "./chat-utils";
import type { Conversation, CurrentUser } from "./types";

function initials(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.slice(0, 1).toUpperCase())
    .join("") || "•";
}

export function MessengerRevealPreview({ user }: { user: CurrentUser }) {
  const [conversations, setConversations] = useState<Conversation[]>([]);

  useEffect(() => {
    let cancelled = false;
    void messengerApi.conversations()
      .then((items) => {
        if (cancelled) return;
        setConversations(
          [...items]
            .sort((a, b) => {
              if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
              return b.created_at.localeCompare(a.created_at);
            })
            .slice(0, 7),
        );
      })
      .catch(() => {
        // The preview is deliberately best-effort. The authenticated shell
        // performs the authoritative load after unlock.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="messenger-page messenger-reveal-preview" aria-hidden="true">
      <section className="messenger-shell minimal-messenger-frame">
        <header className="messenger-topbar minimal-list-topbar">
          <div className="minimal-list-heading">
            <strong>Messages</strong>
            <span>{user.display_name}</span>
          </div>
          <span className="minimal-header-action" aria-hidden="true">＋</span>
        </header>

        <div className="conversation-list minimal-chat-list">
          {conversations.length > 0 ? conversations.map((conversation) => {
            const title = conversationTitle(conversation, user.id);
            const unread = Math.max(
              0,
              conversation.latest_sequence - conversation.last_read_sequence,
            );
            return (
              <div className="conversation-item minimal-chat-item" key={conversation.id}>
                <span className="avatar minimal-avatar">{initials(title)}</span>
                <span className="conversation-copy">
                  <strong>{title}</strong>
                  <small>
                    {conversation.type === "group"
                      ? conversation.members.length + " members"
                      : conversation.encryption_required
                        ? "End-to-end encrypted"
                        : "Private chat"}
                  </small>
                </span>
                {unread > 0 ? (
                  <span className="unread-badge">{unread > 99 ? "99+" : unread}</span>
                ) : (
                  <span className="minimal-row-chevron" aria-hidden="true">›</span>
                )}
              </div>
            );
          }) : (
            Array.from({ length: 5 }, (_, index) => (
              <div className="conversation-item minimal-chat-item is-skeleton" key={index}>
                <span className="avatar minimal-avatar" />
                <span className="conversation-copy">
                  <strong />
                  <small />
                </span>
              </div>
            ))
          )}
        </div>
      </section>
    </main>
  );
}
