[
{'path':'apps/api/app/e2ee.py','base':'1c089fbbce60f7e2eb14db6f243db567eaaf295b1994553c427b0b0b77d2e345','sha256':'b9a9e95a4ceaf4b647781439f57845fdbdf159eab344ac0a4e338d26ba2b8be0','edits':[(1367,1367,'                    "created_at": message.created_at.isoformat(),\n')]},
{'path':'apps/web/features/messenger/crypto/openmls-adapter.ts','base':'1a9eb3e42dfeabe1585d64f787d5e655b6490c53915c66f9bb1c01fe2968a7df','sha256':'ea29fcf358f94996322d09046a3d220945d9bd17172a3d75c50d15078d64ebac','edits':[(875,875,r'''  pendingApplicationMessages(conversationId: string): Array<{ id: string; body: string | null; messageType: "text" | "image" | "file" | "voice" }> {
    this.assertReady();
    return this.localState!.pendingApplicationSends.flatMap((item) =>
      item.conversationId === conversationId && item.event.kind === "message"
        ? [{ id: item.clientId, body: item.event.body, messageType: item.event.messageType }]
        : [],
    );
  }

'''),(906,906,'          ...(record.createdAt ? { createdAt: record.createdAt } : {}),\n'),(1104,1104,'        if (!existing.createdAt && item.created_at) existing.createdAt = item.created_at;\n'),(1131,1131,'        ...(item.created_at ? { createdAt: item.created_at } : {}),\n'),(1587,1587,'            createdAt: response.created_at,\n')]},
{'path':'apps/web/features/messenger/message-action-sheet.tsx','base':None,'sha256':'80767789767f27ebf24ea4785f068e4bde6114c62761ec73f3e2a80f609a299b','edits':[(0,0,r'''"use client";

import { useEffect, useRef, useState } from "react";

export interface MessageAction {
  id: string;
  label: string;
  run: () => void;
  disabled?: boolean;
  destructive?: boolean;
}

/** Native modal supplies focus containment, inert background and Escape support. */
export function MessageActionSheet({ preview, actions, onClose }: {
  preview: string;
  actions: MessageAction[];
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  function choose(action: MessageAction) {
    if (action.disabled) return;
    if (action.destructive && confirmId !== action.id) {
      setConfirmId(action.id);
      return;
    }
    // Close synchronously, then run Reply/Edit in the same trusted tap so iOS
    // can focus the composer and show its keyboard without a delayed timer.
    dialogRef.current?.close();
    onClose();
    action.run();
  }

  const confirmation = actions.find((action) => action.id === confirmId);
  return (
    <dialog
      ref={dialogRef}
      className="message-action-sheet"
      aria-label={confirmation ? "Confirm message deletion" : "Message actions"}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClose={onClose}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div className="message-action-content">
        <p className="message-action-preview">{confirmation ? "Delete this message?" : preview}</p>
        {confirmation ? (
          <button type="button" className="is-destructive" disabled={confirmation.disabled} onClick={() => choose(confirmation)}>Delete message</button>
        ) : actions.map((action) => (
          <button
            key={action.id}
            type="button"
            className={action.destructive ? "is-destructive" : ""}
            disabled={action.disabled}
            onClick={() => choose(action)}
          >{action.label}</button>
        ))}
        <button type="button" className="message-action-cancel" onClick={onClose}>Cancel</button>
      </div>
    </dialog>
  );
}
''')]},
{'path':'apps/web/features/messenger/message-meta.tsx','base':None,'sha256':'bbd3379ab94d268bd3794d25af52b4f1b3eb1981f6ac707e1a3afc23dae3717f','edits':[(0,0,r'''import { deliveryLabel } from "@sudoku/domain";

export function MessageMeta({ createdAt, sequence, own, peerReads, edited = false }: {
  createdAt?: string | null;
  sequence: number;
  own: boolean;
  peerReads: readonly number[];
  edited?: boolean;
}) {
  const time = createdAt && Number.isFinite(Date.parse(createdAt)) ? new Date(createdAt) : null;
  return (
    <small className="message-time">
      {time ? <time dateTime={createdAt!}>{time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time> : null}
      {edited ? <span>{time ? " · " : ""}edited</span> : null}
      {own ? <span className="message-delivery">{time || edited ? " · " : ""}{deliveryLabel(sequence, peerReads)}</span> : null}
    </small>
  );
}
''')]},
{'path':'apps/web/features/messenger/message-timeline.tsx','base':None,'sha256':'b38ac5899cfd32958dc2b8a502c5d00449673938be5590a5bf34b432650bbc2d','edits':[(0,0,r'''"use client";

import { Fragment, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import { buildTimeline, countNewIncoming, dayLabel, type TimelineMessage } from "@sudoku/domain";

export interface MessageTimelineHandle { toLatest: () => void; toSequence: (sequence: number) => void; }

export function MessageTimeline<T extends TimelineMessage>({ items, currentUserId, childrenBefore, childrenAfter, renderMessage, onReadLatest, readSequence, ref }: {
  items: readonly T[];
  currentUserId: string;
  childrenBefore?: ReactNode;
  childrenAfter?: ReactNode;
  renderMessage: (message: T) => ReactNode;
  onReadLatest?: (sequence: number) => Promise<void>;
  readSequence?: number;
  ref?: Ref<MessageTimelineHandle>;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const anchor = useRef<{ id: string; offset: number } | null>(null);
  const previousSequence = useRef<number | null>(null);
  const readSent = useRef(0);
  const readInFlight = useRef(false);
  const scrollFrame = useRef<number | null>(null);
  const [away, setAway] = useState(false);
  const [receiptVersion, setReceiptVersion] = useState(0);
  const [newCount, setNewCount] = useState(0);
  const decorations = useMemo(() => buildTimeline(items), [items]);
  const newest = items.reduce((max, item) => Math.max(max, item.sequence), 0);
  const acknowledgedSequence = readSequence ?? newest;

  const rememberAnchor = useCallback(() => {
    const node = viewport.current;
    if (!node) return;
    const top = node.getBoundingClientRect().top;
    for (const item of node.querySelectorAll<HTMLElement>("[data-message-id]")) {
      const bounds = item.getBoundingClientRect();
      if (bounds.bottom > top + 1) {
        anchor.current = { id: item.dataset.messageId!, offset: bounds.top - top };
        return;
      }
    }
    anchor.current = null;
  }, []);

  const restorePosition = useCallback(() => {
    const node = viewport.current;
    if (!node) return;
    if (pinned.current) {
      node.scrollTop = node.scrollHeight;
    } else if (anchor.current) {
      const item = node.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(anchor.current.id)}"]`);
      if (item) {
        const delta = item.getBoundingClientRect().top - node.getBoundingClientRect().top - anchor.current.offset;
        node.scrollTop += delta;
      }
    }
    rememberAnchor();
  }, [rememberAnchor]);

  const toLatest = useCallback(() => {
    pinned.current = true;
    setAway(false);
    setNewCount(0);
    // Keep history movement local: never scroll the page or the hidden Sudoku.
    restorePosition();
  }, [restorePosition]);
  const toSequence = useCallback((sequence: number) => {
    const node = viewport.current;
    const item = node?.querySelector<HTMLElement>(`[data-message-sequence="${sequence}"]`);
    if (!node || !item) return;
    pinned.current = false;
    node.scrollTop += item.getBoundingClientRect().top - node.getBoundingClientRect().top - node.clientHeight / 2;
    setAway(node.scrollHeight - node.scrollTop - node.clientHeight >= 48);
    rememberAnchor();
  }, [rememberAnchor]);
  useImperativeHandle(ref, () => ({ toLatest, toSequence }), [toLatest, toSequence]);

  useLayoutEffect(() => {
    if (previousSequence.current !== null && newest > previousSequence.current && !pinned.current) {
      const added = countNewIncoming(previousSequence.current, items, currentUserId);
      if (added > 0) setNewCount((count) => count + added);
    }
    if (items.length > 0) previousSequence.current = Math.max(previousSequence.current ?? 0, newest);
    restorePosition();
  }, [currentUserId, items, newest, restorePosition]);

  useEffect(() => {
    // Media decoding, composer growth and keyboard resizing can change the
    // available viewport without adding messages. Preserve the same anchor.
    const observer = new ResizeObserver(restorePosition);
    if (viewport.current) observer.observe(viewport.current);
    if (content.current) observer.observe(content.current);
    return () => {
      observer.disconnect();
      if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current);
    };
  }, [restorePosition]);

  useEffect(() => {
    if (!onReadLatest || away || !pinned.current || acknowledgedSequence <= readSent.current || readInFlight.current
      || document.visibilityState !== "visible") return;
    readInFlight.current = true;
    let acknowledged = false;
    void onReadLatest(acknowledgedSequence).then(() => {
      acknowledged = true;
      readSent.current = Math.max(readSent.current, acknowledgedSequence);
    }).catch(() => {
      // A later scroll/update retries the receipt. Never invent a successful read.
    }).finally(() => {
      readInFlight.current = false;
      // A newer visible message may have arrived while the previous receipt
      // was in flight. Drain that newer watermark only after success.
      if (acknowledged) setReceiptVersion((version) => version + 1);
    });
  }, [acknowledgedSequence, away, onReadLatest, receiptVersion]);

  function handleScroll() {
    // Record user intent synchronously so a network update arriving before the
    // next animation frame cannot snap an already-scrolled history to the end.
    const node = viewport.current;
    if (!node) return;
    pinned.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48;
    rememberAnchor();
    if (scrollFrame.current !== null) return;
    scrollFrame.current = requestAnimationFrame(() => {
      scrollFrame.current = null;
      setAway(!pinned.current);
      if (pinned.current) setNewCount(0);
    });
  }

  return (
    <div className="timeline-frame">
      <div className="message-list" ref={viewport} onScroll={handleScroll} aria-label="Message history">
        <div className="timeline-content" ref={content}>
          {childrenBefore}
          {items.map((message) => {
            const decoration = decorations.get(message.id)!;
            const label = dayLabel(decoration.date);
            return (
              <Fragment key={message.id}>
                {label ? <div className="message-date-separator"><time dateTime={decoration.date!}>{label}</time></div> : null}
                <div
                  data-message-id={message.id}
                  data-message-sequence={message.sequence}
                  className={`timeline-item ${decoration.groupStart ? "group-start" : "grouped"} ${decoration.groupEnd ? "group-end" : "group-continues"}`}
                >{renderMessage(message)}</div>
              </Fragment>
            );
          })}
          {childrenAfter}
        </div>
      </div>
      {away ? (
        <button type="button" className="jump-to-latest" onClick={toLatest} aria-label={newCount ? `${newCount} new messages. Jump to latest` : "Jump to latest"}>
          <span aria-hidden="true">↓</span>
          {newCount ? <span className="new-message-count" aria-live="polite">{newCount > 99 ? "99+" : newCount}</span> : null}
        </button>
      ) : null}
    </div>
  );
}
''')]},
{'path':'packages/domain/src/messenger-ux.ts','base':None,'sha256':'474cb99b1480eb0fe4e5377763e7460f321321ebcca0c717188e8b6fb30ab493','edits':[(0,0,r'''/** Presentation rules only. Transport sequence, not the wall clock, orders messages. */
export interface TimelineMessage {
  id: string;
  senderId: string;
  sequence: number;
  createdAt?: string | null;
  deleted?: boolean;
}
export interface TimelineDecoration {
  groupStart: boolean;
  groupEnd: boolean;
  date: string | null;
}
function validTime(value?: string | null): number | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}
function dayKey(time: number): string {
  const date = new Date(time);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}
function sameGroup(left: TimelineMessage | undefined, right: TimelineMessage | undefined): boolean {
  if (!left || !right || left.deleted || right.deleted || left.senderId !== right.senderId) return false;
  const a = validTime(left.createdAt);
  const b = validTime(right.createdAt);
  return a !== null && b !== null && b >= a && b - a <= 5 * 60_000 && dayKey(a) === dayKey(b);
}
export function buildTimeline(items: readonly TimelineMessage[]): Map<string, TimelineDecoration> {
  const result = new Map<string, TimelineDecoration>();
  for (let index = 0; index < items.length; index += 1) {
    const current = items[index]!;
    const previous = items[index - 1];
    const time = validTime(current.createdAt);
    const previousTime = validTime(previous?.createdAt);
    result.set(current.id, {
      groupStart: !sameGroup(previous, current),
      groupEnd: !sameGroup(current, items[index + 1]),
      date: time !== null && (previousTime === null || dayKey(time) !== dayKey(previousTime))
        ? current.createdAt! : null,
    });
  }
  return result;
}
export function dayLabel(value?: string | null, now = new Date()): string | null {
  const time = validTime(value);
  if (time === null) return null;
  if (dayKey(time) === dayKey(now.getTime())) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (dayKey(time) === dayKey(yesterday.getTime())) return 'Yesterday';
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(time);
}
export function deliveryLabel(sequence: number, peerReads: readonly number[]): string {
  if (sequence <= 0) return 'Sending';
  const read = peerReads.filter((value) => value >= sequence).length;
  if (read === 0) return 'Sent';
  if (read === peerReads.length) return 'Read';
  return `Read by ${read} of ${peerReads.length}`;
}
export function gestureIntent(dx: number, dy: number): 'pending' | 'scroll' | 'reply' {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 12) return 'pending';
  return dx >= 12 && dx > Math.abs(dy) * 1.5 ? 'reply' : 'scroll';
}
export function countNewIncoming(previousSequence: number, messages: readonly TimelineMessage[], ownId: string): number {
  return messages.reduce((count, message) => count + Number(message.sequence > previousSequence && message.senderId !== ownId), 0);
}
/** RAM only. Owned by one mounted private account surface; never serialised. */
export class SessionDrafts {
  private readonly entries = new Map<string, string>();
  constructor(private readonly limit = 64) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error('Invalid draft capacity');
  }
  get(id: string): string {
    const value = this.entries.get(id) ?? '';
    if (value) { this.entries.delete(id); this.entries.set(id, value); }
    return value;
  }
  set(id: string, value: string): void {
    this.entries.delete(id);
    if (!value) return;
    this.entries.set(id, value.slice(0, 20000));
    while (this.entries.size > this.limit) this.entries.delete(this.entries.keys().next().value!);
  }
  clear(): void { this.entries.clear(); }
}
''')]}
]
