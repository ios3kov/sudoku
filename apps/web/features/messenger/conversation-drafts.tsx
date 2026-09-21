"use client";

import { SessionDrafts } from "@sudoku/domain";
import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";

function createDraftStore() {
  const drafts = new SessionDrafts();
  const listeners = new Set<() => void>();
  let active = true;
  return {
    get: (id: string) => active ? drafts.get(id) : "",
    set(id: string, value: string) {
      if (!active) return;
      drafts.set(id, value);
      // An insertion can also evict another draft from the bounded store.
      listeners.forEach((notify) => notify());
    },
    subscribe(notify: () => void) {
      listeners.add(notify);
      return () => { listeners.delete(notify); };
    },
    activate() { active = true; },
    dispose() { active = false; drafts.clear(); },
  };
}

const DraftContext = createContext<ReturnType<typeof createDraftStore> | null>(null);

/** One mounted authenticated private surface owns these drafts, never storage. */
export function ConversationDraftProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createDraftStore);
  useEffect(() => {
    store.activate();
    return () => store.dispose();
  }, [store]);
  return <DraftContext value={store}>{children}</DraftContext>;
}

export function useConversationDraft(id: string): readonly [string, (value: string) => void, (value: string) => void] {
  const store = useContext(DraftContext);
  if (!store) throw new Error("Conversation drafts require an authenticated private surface");
  const snapshot = useCallback(() => store.get(id), [id, store]);
  const value = useSyncExternalStore(store.subscribe, snapshot, () => "");
  const set = useCallback((next: string) => store.set(id, next), [id, store]);
  const restore = useCallback((previous: string) => {
    // A failed send must never overwrite a newer draft typed while awaiting it.
    if (!store.get(id)) store.set(id, previous);
  }, [id, store]);
  return [value, set, restore] as const;
}
