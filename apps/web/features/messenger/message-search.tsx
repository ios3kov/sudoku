"use client";

import { FormEvent, useState } from "react";
import { messengerApi } from "./api";
import type { Message } from "./types";

export function MessageSearch({
  conversationId,
  onSelect,
  onClose,
}: {
  conversationId: string;
  onSelect: (message: Message) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const term = query.trim();
    if (term.length < 2) return;
    setLoading(true);
    setError(null);
    try {
      setResults(await messengerApi.searchMessages(conversationId, term));
      setSearched(true);
    } catch {
      setError("Unable to search messages");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="message-search-panel" role="dialog" aria-label="Search messages">
      <header className="settings-header">
        <div><strong>Find in chat</strong><span>Searches message text in this conversation.</span></div>
        <button type="button" onClick={onClose}>Done</button>
      </header>
      <form className="message-search-form" onSubmit={submit}>
        <input value={query} onChange={(event) => setQuery(event.target.value)} maxLength={120} placeholder="Search messages" autoFocus />
        <button type="submit" disabled={query.trim().length < 2 || loading}>{loading ? "…" : "Find"}</button>
      </form>
      {error ? <p className="form-error">{error}</p> : null}
      <div className="message-search-results">
        {searched && !loading && results.length === 0 ? <p className="muted center">No matches</p> : null}
        {results.map((message) => (
          <button type="button" key={message.id} onClick={() => onSelect(message)}>
            <span>{message.body ?? "Message"}</span>
            <small>{new Date(message.created_at).toLocaleString()}</small>
          </button>
        ))}
      </div>
    </section>
  );
}
