import { useMemo } from "react";
import { deliveryLabel } from "@sudoku/domain";

export function MessageMeta({ createdAt, sequence, own, peerReads, edited = false }: {
  createdAt?: string | null;
  sequence: number;
  own: boolean;
  peerReads: readonly number[];
  edited?: boolean;
}) {
  // Metadata re-renders with the composer/receipts. ICU formatting is expensive
  // on mobile; unchanged timestamps must not be formatted on every keystroke.
  const time = useMemo(() => {
    if (!createdAt || !Number.isFinite(Date.parse(createdAt))) return null;
    return new Date(createdAt).toLocaleTimeString([], {hour: "2-digit", minute: "2-digit"});
  }, [createdAt]);
  return (
    <small className="message-time">
      {time ? <time dateTime={createdAt!}>{time}</time> : null}
      {edited ? <span>{time ? " · " : ""}edited</span> : null}
      {own ? <span className="message-delivery">{time || edited ? " · " : ""}{deliveryLabel(sequence, peerReads)}</span> : null}
    </small>
  );
}
