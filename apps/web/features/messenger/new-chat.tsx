"use client";

import { useEffect, useState } from "react";
import { messengerApi } from "./api";
import { ContactAccess } from "./contact-access";
import type { Conversation } from "./types";
import type { OpenMlsProtocolAdapter } from "./crypto/openmls-adapter";

interface DirectoryUser {
  id: string;
  display_name: string;
  phone_e164: string;
}

type Mode = "direct" | "group";

export function NewChat({
  onCreated,
  onCancel,
  adapter,
}: {
  onCreated: (conversation: Conversation) => void;
  onCancel: () => void;
  adapter: OpenMlsProtocolAdapter | null;
}) {
  const [mode, setMode] = useState<Mode>("direct");
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<DirectoryUser[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [groupTitle, setGroupTitle] = useState("");
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const term = query.trim();
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await messengerApi.searchUsers(term);
        if (!cancelled) setUsers(result);
      } catch {
        if (!cancelled) {
          setUsers([]);
          setError("Unable to load contacts");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, term ? 220 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);


  async function createDirect(user: DirectoryUser) {
    setError(null);
    setCreating(true);
    let pending: Conversation | null = null;
    try {
      if (!adapter) throw new Error("Secure messaging is not ready");
      pending = await messengerApi.createDirect(user.id, true);
      onCreated(await adapter.bootstrapConversation(pending));
    } catch (error) {
      if (pending) {
        onCreated(pending);
      } else {
        setError(error instanceof Error ? error.message : "Unable to create secure chat");
      }
    } finally {
      setCreating(false);
    }
  }

  async function createGroup() {
    const title = groupTitle.trim();
    if (!title || selected.size === 0) return;
    setError(null);
    setCreating(true);
    let pending: Conversation | null = null;
    try {
      if (!adapter) throw new Error("Secure messaging is not ready");
      pending = await messengerApi.createGroup(title, [...selected], true);
      onCreated(await adapter.bootstrapConversation(pending));
    } catch (error) {
      if (pending) {
        onCreated(pending);
      } else {
        setError(error instanceof Error ? error.message : "Unable to create secure group");
      }
    } finally {
      setCreating(false);
    }
  }

  function toggleUser(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function switchMode(next: Mode) {
    setMode(next);
    setSelected(new Set());
    setGroupTitle("");
    setError(null);
  }

  return (
    <section className="new-chat-panel" role="dialog" aria-label="Create secure chat">
      <div className="new-chat-header"><strong>New chat</strong><button type="button" onClick={onCancel}>Close</button></div>
      <div className="chat-mode-tabs">
        <button
          className={mode === "direct" ? "active" : ""}
          type="button"
          aria-pressed={mode === "direct"}
          onClick={() => switchMode("direct")}
        >
          Direct
        </button>
        <button
          className={mode === "group" ? "active" : ""}
          type="button"
          aria-pressed={mode === "group"}
          onClick={() => switchMode("group")}
        >
          Group
        </button>
      </div>
      {mode === "group" ? (
        <input className="group-title-input" value={groupTitle} onChange={(e) => setGroupTitle(e.target.value)} placeholder="Group name" maxLength={160} />
      ) : null}
      <ContactAccess onSynced={() => setQuery((current) => current + " ")} />
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search people"
        aria-label="Search people"
        type="search"
        autoCapitalize="none"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        autoFocus
      />
      {error ? <p className="form-error">{error}</p> : null}
      {mode === "group" && selected.size > 0 ? <p className="selected-count">{selected.size} selected</p> : null}
      <div className="directory-list" aria-busy={loading}>
        {loading ? (
          <p className="muted">Loading contacts…</p>
        ) : users.length === 0 && !error ? (
          <p className="muted new-chat-hint">No registered phone contacts yet.</p>
        ) : users.map((user) => (
          <button
            type="button"
            key={user.id}
            className={`directory-item ${selected.has(user.id) ? "selected" : ""}`}
            disabled={creating || !adapter}
            aria-pressed={mode === "group" ? selected.has(user.id) : undefined}
            onClick={() => mode === "direct" ? void createDirect(user) : toggleUser(user.id)}
          >
            <span className="avatar">{user.display_name.slice(0, 1).toUpperCase()}</span>
            <span><strong>{user.display_name}</strong><small>{user.phone_e164}</small></span>
            {mode === "group" ? <span className="selection-mark">{selected.has(user.id) ? "✓" : ""}</span> : null}
          </button>
        ))}
      </div>
      {mode === "group" ? (
        <button className="create-group-button" type="button" disabled={!groupTitle.trim() || selected.size === 0 || creating || !adapter} onClick={() => void createGroup()}>
          {creating ? "Creating…" : "Create group"}
        </button>
      ) : null}
    </section>
  );
}
