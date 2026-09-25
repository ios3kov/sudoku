"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

export function GameDialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  return <dialog ref={ref} className="sudoku-dialog" aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => { if (event.target === event.currentTarget) {
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
    } }}>
    <header className="dialog-heading"><h2 id={titleId}>{title}</h2><button aria-label="Close" onClick={onClose}>×</button></header>
    {children}
  </dialog>;
}

export function GameIcon({ name }: { name: "play" | "timer" | "undo" | "erase" | "notes" | "award" | "menu" | "pause" }) {
  const paths = {
    play: "m8 5 11 7-11 7Z",
    timer: "M9 2h6M12 6a8 8 0 1 0 0 16 8 8 0 0 0 0-16m0 4v4l3-3M18 5l2 2",
    undo: "M3 10V4m0 6h6M3 10a9 9 0 1 1 1 8",
    erase: "m15 3 6 6-12 12H5l-3-3L15 3ZM8 12l6 6M9 21h13",
    notes: "m16 3 5 5-12 12-6 1 1-6L16 3ZM13 6l5 5",
    award: "M12 3a6 6 0 1 0 0 12 6 6 0 0 0 0-12M8 14l-1 8 5-3 5 3-1-8",
    menu: "M4 6h16M4 12h16M4 18h16",
    pause: "M8 5v14M16 5v14",
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]} /></svg>;
}
