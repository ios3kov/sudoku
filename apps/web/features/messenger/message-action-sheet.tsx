"use client";

import { useEffect, useId, useRef, useState } from "react";

export interface MessageAction {
  id: string;
  label: string;
  run: () => void;
  disabled?: boolean;
  destructive?: boolean;
}

/** Native modality supplies an inert background; Tab wraps within the actions. */
export function MessageActionSheet({ preview, actions, onClose, title = "Message actions" }: {
  title?: string;
  preview: string;
  actions: MessageAction[];
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const previewId = useId();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  function close() {
    // Close before unmount so native focus restoration still has a live dialog.
    dialogRef.current?.close();
    onClose();
  }

  useEffect(() => {
    if (confirmId) dialogRef.current?.querySelector<HTMLButtonElement>(".message-action-cancel")?.focus();
  }, [confirmId]);

  function choose(action: MessageAction) {
    if (action.disabled) return;
    if (action.destructive && confirmId !== action.id) {
      setConfirmId(action.id);
      return;
    }
    // Close synchronously, then run Reply/Edit in the same trusted tap so iOS
    // can focus the composer and show its keyboard without a delayed timer.
    close();
    action.run();
  }

  const confirmation = actions.find((action) => action.id === confirmId);
  return (
    <dialog
      ref={dialogRef}
      className="message-action-sheet"
      aria-label={confirmation ? "Confirm message deletion" : title}
      aria-describedby={previewId}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
        const first = buttons[0];
        const last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault(); last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault(); first?.focus();
        }
      }}
      onCancel={(event) => { event.preventDefault(); close(); }}
      onClose={onClose}
      onClick={(event) => { if (event.target === event.currentTarget) close(); }}
    >
      <div className="message-action-content">
        <p id={previewId} className="message-action-preview">{confirmation ? "Delete this message?" : preview}</p>
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
        <button type="button" className="message-action-cancel" onClick={close}>Cancel</button>
      </div>
    </dialog>
  );
}
