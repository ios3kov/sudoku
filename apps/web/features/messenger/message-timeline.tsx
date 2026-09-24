"use client";

import { Fragment, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import { buildTimeline, countNewIncoming, dayLabel, type TimelineMessage } from "@sudoku/domain";

export interface MessageTimelineHandle { toLatest: () => void; toSequence: (sequence: number) => void; }

export function MessageTimeline<T extends TimelineMessage>({ items, currentUserId, childrenBefore, childrenAfter, renderMessage, onReadLatest, readSequence, knownReadSequence = 0, visibleCount = 120, ref }: {
  items: readonly T[];
  currentUserId: string;
  childrenBefore?: ReactNode;
  childrenAfter?: ReactNode;
  renderMessage: (message: T) => ReactNode;
  onReadLatest?: (sequence: number) => Promise<void>;
  /** Latest visible/decrypted sequence eligible to acknowledge. */
  readSequence?: number;
  /** Monotonic server-known watermark for the current user. */
  knownReadSequence?: number;
  visibleCount?: number;
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
  const [windowEnd, setWindowEnd] = useState<number | null>(null);
  const [jumpVersion, setJumpVersion] = useState(0);
  const pendingJump = useRef<number | null>(null);
  // Freeze the end of the rendered window while reading older history. A new
  // arrival must not evict the reader's anchor from a fixed-size tail slice.
  const renderedItems = useMemo(() => {
    const window = windowEnd === null ? items : items.filter((item) => item.sequence <= windowEnd);
    return window.slice(-visibleCount);
  }, [items, visibleCount, windowEnd]);
  const decorations = useMemo(() => buildTimeline(renderedItems), [renderedItems]);
  const newest = items.reduce((max, item) => Math.max(max, item.sequence), 0);
  const acknowledgedSequence = readSequence ?? newest;
  const knownServerRead = Number.isSafeInteger(knownReadSequence) && knownReadSequence > 0
    ? knownReadSequence
    : 0;

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
    setWindowEnd(null);
    // Keep history movement local: never scroll the page or the hidden Sudoku.
    restorePosition();
  }, [restorePosition]);
  const toSequence = useCallback((sequence: number) => {
    const index = items.findIndex((item) => item.sequence === sequence);
    if (index < 0) return;
    const end = items[Math.min(items.length - 1, index + Math.floor(visibleCount / 2))]!;
    pendingJump.current = sequence;
    setJumpVersion((value) => value + 1);
    pinned.current = false;
    setWindowEnd(end.sequence);
    setAway(true);
  }, [items, visibleCount]);
  useImperativeHandle(ref, () => ({ toLatest, toSequence }), [toLatest, toSequence]);

  useLayoutEffect(() => {
    if (previousSequence.current !== null && newest > previousSequence.current && !pinned.current) {
      const added = countNewIncoming(previousSequence.current, items, currentUserId);
      if (added > 0) setNewCount((count) => count + added);
    }
    if (items.length > 0) previousSequence.current = Math.max(previousSequence.current ?? 0, newest);
    const node = viewport.current;
    const target = pendingJump.current === null ? null
      : node?.querySelector<HTMLElement>(`[data-message-sequence="${pendingJump.current}"]`);
    if (node && target) {
      node.scrollTop += target.getBoundingClientRect().top - node.getBoundingClientRect().top - node.clientHeight / 2;
      pendingJump.current = null;
      pinned.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48;
      setAway(!pinned.current);
      rememberAnchor();
    } else {
      restorePosition();
    }
  }, [currentUserId, items, newest, renderedItems, restorePosition, rememberAnchor, jumpVersion]);

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
    if (
      !onReadLatest
      || away
      || !pinned.current
      || acknowledgedSequence <= Math.max(readSent.current, knownServerRead)
      || readInFlight.current
      || document.visibilityState !== "visible"
    ) return;
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
  }, [acknowledgedSequence, away, knownServerRead, onReadLatest, receiptVersion]);

  useEffect(() => {
    const retryReceipt = () => setReceiptVersion((value) => value + 1);
    window.addEventListener("online", retryReceipt);
    document.addEventListener("visibilitychange", retryReceipt);
    return () => {
      window.removeEventListener("online", retryReceipt);
      document.removeEventListener("visibilitychange", retryReceipt);
    };
  }, []);

  function handleScroll() {
    // Record user intent synchronously so a network update arriving before the
    // next animation frame cannot snap an already-scrolled history to the end.
    const node = viewport.current;
    if (!node) return;
    const wasPinned = pinned.current;
    pinned.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48;
    if (wasPinned && !pinned.current) setWindowEnd(newest);
    if (pinned.current) setWindowEnd(null);
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
          {renderedItems.map((message) => {
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
