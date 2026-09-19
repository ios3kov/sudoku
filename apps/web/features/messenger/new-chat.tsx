"use client";

import { useEffect, useState } from "react";
import { messengerApi } from "./api";
import type { Conversation } from "./types";

interface DirectoryUser {
  id: string;
  display_name: string;
  email: string;
}

type Mode = "direct" | "group";

export function NewChat({ onCreated, onCancel }: { onCreated: (conversation: Conversation) => void; onCancel: () => void }) {
  const [mode, setMode] = useState<Mode>("direct");
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<DirectoryUser[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [groupTitle, setGroupTitle] = useState("");
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const result = await messengerApi.searchUsers(query);
        if (!cancelled) setUsers(result);
      } catch {
        if (!cancelled) setError("Unable to load contacts");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);


  async function createDirect(user: DirectoryUser) {
    setError(null);
    setCreating(true);
    try {
      onCreated(await messengerApi.createDirect(user.id));
    } catch {
      setError("Unable to create chat");
    } finally {
      setCreating(false);
    }
  }

  async function createGroup() {
    const title = groupTitle.trim();
    if (!title || selected.size === 0) return;
    setError(null);
    setCreating(true);
    try {
      onCreated(await messengerApi.createGroup(title, [...selected]));
    } catch {
      setError("Unable to create group");
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
    <section className="new-chat-panel">
      <div className="new-chat-header"><strong>New chat</strong><button type="button" onClick={onCancel}>Close</button></div>
      <div className="chat-mode-tabs">
        <button className={mode === "direct" ? "active" : ""} type="button" onClick={() => switchMode("direct")}>Direct</button>
        <button className={mode === "group" ? "active" : ""} type="button" onClick={() => switchMode("group")}>Group</button>
      </div>
      {mode === "group" ? (
        <input className="group-title-input" value={groupTitle} onChange={(e) => setGroupTitle(e.target.value)} placeholder="Group name" maxLength={160} />
      ) : null}
      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search people" autoFocus />
      {error ? <p className="form-error">{error}</p> : null}
      {mode === "group" && selected.size > 0 ? <p className="selected-count">{selected.size} selected</p> : null}
      <div className="directory-list">
        {loading ? <p className="muted">Searching…</p> : users.map((user) => (
          <button
            type="button"
            key={user.id}
            className={`directory-item ${selected.has(user.id) ? "selected" : ""}`}
            disabled={creating}
            onClick={() => mode === "direct" ? void createDirect(user) : toggleUser(user.id)}
          >
            <span className="avatar">{user.display_name.slice(0, 1).toUpperCase()}</span>
            <span><strong>{user.display_name}</strong><small>{user.email}</small></span>
            {mode === "group" ? <span className="selection-mark">{selected.has(user.id) ? "✓" : ""}</span> : null}
          </button>
        ))}
      </div>
      {mode === "group" ? (
        <button className="create-group-button" type="button" disabled={!groupTitle.trim() || selected.size === 0 || creating} onClick={() => void createGroup()}>
          {creating ? "Creating…" : "Create group"}
        </button>
      ) : null}
    </section>
  );
}
