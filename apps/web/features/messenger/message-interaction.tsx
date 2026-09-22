"use client";

import { gestureIntent } from "@sudoku/domain";
import { useCallback, useEffect, useRef, type PointerEvent, type ReactNode } from "react";

const HOLD_MS = 450;
const REPLY_PX = 64;
const INTERACTIVE = "button,a,input,textarea,select,audio,video,[contenteditable],[data-no-message-gesture]";
type Gesture = { id: number; x: number; y: number; dx: number; intent: "pending" | "reply" };

export function MessageInteraction({ children, disabled = false, onActions, onReply }: {
  children: ReactNode;
  disabled?: boolean;
  onActions: () => void;
  onReply: () => void;
}) {
  const element = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const frame = useRef<number | null>(null);
  const suppressClick = useRef(false);

  const stopHold = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const reset = useCallback(() => {
    stopHold();
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    const node = element.current;
    const previous = gesture.current;
    gesture.current = null;
    if (node) {
      node.classList.remove("is-reply-dragging");
      node.style.transform = "";
      if (previous && node.hasPointerCapture(previous.id)) node.releasePointerCapture(previous.id);
    }
  }, [stopHold]);

  useEffect(() => {
    if (disabled) reset();
    function cancelOtherPointer(event: globalThis.PointerEvent) {
      if (gesture.current && event.pointerId !== gesture.current.id) reset();
    }
    window.addEventListener("pointerdown", cancelOtherPointer, true);
    return () => {
      window.removeEventListener("pointerdown", cancelOtherPointer, true);
      reset();
    };
  }, [disabled, reset]);

  function isInteractive(target: EventTarget | null): boolean {
    return target instanceof Element && Boolean(target.closest(INTERACTIVE));
  }

  function begin(event: PointerEvent<HTMLDivElement>) {
    if (!event.isPrimary || event.button !== 0) { reset(); return; }
    if (disabled || isInteractive(event.target)) return;
    reset();
    suppressClick.current = false;
    gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, dx: 0, intent: "pending" };
    timer.current = setTimeout(() => {
      if (!gesture.current || window.getSelection()?.toString()) return;
      suppressClick.current = true;
      reset();
      onActions();
    }, HOLD_MS);
  }

  function move(event: PointerEvent<HTMLDivElement>) {
    const current = gesture.current;
    if (!current || current.id !== event.pointerId) return;
    const dx = event.clientX - current.x;
    const dy = event.clientY - current.y;
    const intent = gestureIntent(dx, dy);
    if (intent !== "pending") stopHold();
    if (intent === "scroll") { reset(); return; }
    if (current.intent === "pending") {
      if (intent === "pending") return;
      current.intent = "reply";
      try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Synthetic test pointer. */ }
    }
    current.dx = Math.max(0, dx);
    suppressClick.current = true;
    event.preventDefault();
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      if (!element.current || !gesture.current) return;
      element.current.classList.add("is-reply-dragging");
      element.current.style.transform = `translate3d(${Math.min(96, gesture.current.dx)}px, 0, 0)`;
    });
  }

  function end(event: PointerEvent<HTMLDivElement>) {
    const current = gesture.current;
    if (!current || current.id !== event.pointerId) return;
    const dx = event.clientX - current.x;
    const dy = event.clientY - current.y;
    const shouldReply = !disabled && current.intent === "reply"
      && dx >= REPLY_PX && gestureIntent(dx, dy) === "reply";
    reset();
    if (shouldReply) { event.preventDefault(); onReply(); }
  }

  return (
    <div
      className="message-interaction"
      ref={element}
      onPointerDown={begin}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={reset}
      onLostPointerCapture={reset}
      onClickCapture={(event) => {
        if (suppressClick.current) {
          suppressClick.current = false;
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      onContextMenu={(event) => {
        if (disabled || isInteractive(event.target)) return;
        event.preventDefault();
        reset();
        onActions();
      }}
    >{children}</div>
  );
}
