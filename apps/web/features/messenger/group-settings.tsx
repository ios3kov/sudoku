"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { messengerApi } from "./api";
import { ContactAccess } from "./contact-access";
import type { Conversation, CurrentUser } from "./types";
import type { OpenMlsProtocolAdapter } from "./crypto/openmls-adapter";

interface DirectoryUser { id: string; display_name: string; phone_e164: string; }

export function GroupSettings({
  conversation,
  user,
  onUpdated,
  onLeft,
  onClose,
  adapter = null,
}: {
  conversation: Conversation;
  user: CurrentUser;
  onUpdated: (conversation: Conversation) => void;
  onLeft: () => void;
  onClose: () => void;
  adapter?: OpenMlsProtocolAdapter | null;
}) {
  const [title, setTitle] = useState(conversation.title ?? "");
  const [query, setQuery] = useState("");
  const [directory, setDirectory] = useState<DirectoryUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const me = conversation.members.find((member) => member.id === user.id);
  const isOwner = me?.role === "owner";
  const ownerCount = useMemo(() => conversation.members.filter((member) => member.role === "owner").length, [conversation.members]);

  useEffect(() => {
    setTitle(conversation.title ?? "");
  }, [conversation.title]);

  useEffect(() => {
    const term = query.trim();
    if (!isOwner) {
      setDirectory([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setSearching(true);
      setError(null);
      try {
        const results = await messengerApi.searchUsers(term);
        const existing = new Set(conversation.members.map((member) => member.id));
        if (!cancelled) setDirectory(results.filter((item) => !existing.has(item.id)));
      } catch {
        if (!cancelled) {
          setDirectory([]);
          setError("Unable to search people");
        }
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, term ? 220 : 0);
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
      if (conversation.encryption_required) {
        if (!adapter) throw new Error("Secure messaging is unavailable");
        const change = await messengerApi.prepareMlsMemberAdd(conversation.id, userId);
        await adapter.applyMembershipAdd(conversation, userId, change.id);
        await messengerApi.finalizeMlsMembershipChange(change.id);
        const refreshed = (await messengerApi.conversations()).find(
          (item) => item.id === conversation.id,
        );
        if (!refreshed) throw new Error("Updated secure group is unavailable");
        onUpdated(refreshed);
      } else {
        onUpdated(await messengerApi.addGroupMembers(conversation.id, [userId]));
      }
      setQuery(""); setDirectory([]);
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : "Unable to add member");
    }
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
      if (conversation.encryption_required) {
        if (!adapter) throw new Error("Secure messaging is unavailable");
        const change = await messengerApi.prepareMlsMemberRemove(conversation.id, userId);
        await adapter.applyMembershipRemove(conversation, userId, change.id);
        await messengerApi.finalizeMlsMembershipChange(change.id);
      } else {
        await messengerApi.removeGroupMember(conversation.id, userId);
      }
      if (userId === user.id) { onLeft(); return; }
      const refreshed = (await messengerApi.conversations()).find(
        (item) => item.id === conversation.id,
      );
      if (refreshed) onUpdated(refreshed);
      else onUpdated({
        ...conversation,
        members: conversation.members.filter((member) => member.id !== userId),
      });
    } catch (removeError) {
      setError(
        removeError instanceof Error
          ? removeError.message
          : (userId === user.id ? "Transfer ownership before leaving" : "Unable to remove member"),
      );
    }
    finally { setBusy(false); }
  }

  return (
    <section className="group-settings" role="dialog" aria-label="Group settings">
      <div className="settings-header"><div><strong>Group</strong><span>{conversation.members.length} members</span></div><button type="button" onClick={onClose}>Close</button></div>
      {error ? <p className="form-error">{error}</p> : null}
      {isOwner ? (
        <form className="group-rename" onSubmit={rename}>
          <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} aria-label="Group name" />
          <button type="submit" disabled={busy || !title.trim() || title.trim() === conversation.title}>Save</button>
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
        <div className="member-search" aria-busy={searching}>
          <ContactAccess onSynced={() => setQuery((current) => current + " ")} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Add people"
            aria-label="Add people"
            type="search"
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
          />
          {searching ? <p className="muted member-search-hint">Loading contacts…</p> : null}
          {!searching && directory.length === 0 && !error ? <p className="muted member-search-hint">No new registered contacts found.</p> : null}
          {directory.map((item) => <button type="button" key={item.id} disabled={busy} onClick={() => void add(item.id)}><span>{item.display_name}</span><small>{item.phone_e164}</small></button>)}
        </div>
      ) : null}
    </section>
  );
}
