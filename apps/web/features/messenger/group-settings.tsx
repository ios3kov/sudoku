"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { messengerApi } from "./api";
import type { Conversation, CurrentUser } from "./types";

interface DirectoryUser { id: string; display_name: string; email: string; }

export function GroupSettings({
  conversation,
  user,
  onUpdated,
  onLeft,
  onClose,
}: {
  conversation: Conversation;
  user: CurrentUser;
  onUpdated: (conversation: Conversation) => void;
  onLeft: () => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(conversation.title ?? "");
  const [query, setQuery] = useState("");
  const [directory, setDirectory] = useState<DirectoryUser[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const me = conversation.members.find((member) => member.id === user.id);
  const isOwner = me?.role === "owner";
  const ownerCount = useMemo(() => conversation.members.filter((member) => member.role === "owner").length, [conversation.members]);

  useEffect(() => {
    setTitle(conversation.title ?? "");
  }, [conversation.title]);

  useEffect(() => {
    if (!isOwner || !query.trim()) {
      setDirectory([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const results = await messengerApi.searchUsers(query);
        const existing = new Set(conversation.members.map((member) => member.id));
        if (!cancelled) setDirectory(results.filter((item) => !existing.has(item.id)));
      } catch {
        if (!cancelled) setError("Unable to search people");
      }
    }, 180);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [conversation.members, isOwner, query]);

  async function rename(event: FormEvent) {
    event.preventDefault();
    const next = title.trim();
    if (!next || next === conversation.title) return;
    setBusy(true); setError(null);
    try { onUpdated(await messengerApi.updateGroup(conversation.id, next)); }
    catch { setError("Unable to rename group"); }
    finally { setBusy(false); }
  }

  async function add(userId: string) {
    setBusy(true); setError(null);
    try {
      const updated = await messengerApi.addGroupMembers(conversation.id, [userId]);
      onUpdated(updated); setQuery(""); setDirectory([]);
    } catch { setError("Unable to add member"); }
    finally { setBusy(false); }
  }

  async function setRole(userId: string, role: "owner" | "member") {
    setBusy(true); setError(null);
    try { onUpdated(await messengerApi.setGroupMemberRole(conversation.id, userId, role)); }
    catch { setError(role === "owner" ? "Unable to make owner" : "Group must keep at least one owner"); }
    finally { setBusy(false); }
  }

  async function remove(userId: string) {
    setBusy(true); setError(null);
    try {
      await messengerApi.removeGroupMember(conversation.id, userId);
      if (userId === user.id) { onLeft(); return; }
      const next = { ...conversation, members: conversation.members.filter((member) => member.id !== userId) };
      onUpdated(next);
    } catch { setError(userId === user.id ? "Transfer ownership before leaving" : "Unable to remove member"); }
    finally { setBusy(false); }
  }

  return (
    <section className="group-settings" aria-label="Group settings">
      <div className="settings-header"><div><strong>Group</strong><span>{conversation.members.length} members</span></div><button type="button" onClick={onClose}>Close</button></div>
      {error ? <p className="form-error">{error}</p> : null}
      {isOwner ? (
        <form className="group-rename" onSubmit={rename}>
          <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} aria-label="Group name" />
          <button type="submit" disabled={busy || !title.trim()}>Save</button>
        </form>
      ) : null}
      <div className="settings-list">
        {conversation.members.map((member) => (
          <div className="settings-row group-member-row" key={member.id}>
            <div><strong>{member.display_name}{member.id === user.id ? " · you" : ""}</strong><small>{member.role}</small></div>
            <div className="member-actions">
              {isOwner && member.id !== user.id ? (
                <button type="button" disabled={busy} onClick={() => void setRole(member.id, member.role === "owner" ? "member" : "owner")}>{member.role === "owner" ? "Make member" : "Make owner"}</button>
              ) : null}
              {(member.id === user.id || (isOwner && member.role !== "owner")) ? (
                <button type="button" disabled={busy || (member.id === user.id && member.role === "owner" && ownerCount <= 1)} onClick={() => void remove(member.id)}>{member.id === user.id ? "Leave" : "Remove"}</button>
              ) : null}
            </div>
          </div>
        ))}
      </div>
      {isOwner ? (
        <div className="member-search">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Add people" />
          {directory.map((item) => <button type="button" key={item.id} disabled={busy} onClick={() => void add(item.id)}><span>{item.display_name}</span><small>{item.email}</small></button>)}
        </div>
      ) : null}
    </section>
  );
}
