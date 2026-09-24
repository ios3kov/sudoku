import { useMemo } from "react";
import { deliveryLabel } from "@sudoku/domain";

export function MessageMeta({ createdAt, sequence, own, peerReads, peerNames = [], edited = false }: {
  createdAt?: string | null;
  sequence: number;
  own: boolean;
  peerReads: readonly number[];
  peerNames?: readonly string[];
  edited?: boolean;
}) {
  // Metadata re-renders with the composer/receipts. ICU formatting is expensive
  // on mobile; unchanged timestamps must not be formatted on every keystroke.
  const time = useMemo(() => {
    if (!createdAt || !Number.isFinite(Date.parse(createdAt))) return null;
    return new Date(createdAt).toLocaleTimeString([], {hour: "2-digit", minute: "2-digit"});
  }, [createdAt]);
  const delivery = deliveryLabel(sequence, peerReads);
  const readerNames = peerReads.flatMap((watermark, index) =>
    watermark >= sequence && peerNames[index] ? [peerNames[index]!] : []
  );
  const deliveryDetail =
    readerNames.length > 0
      ? `Read by ${readerNames.join(", ")}`
      : delivery === "Sent" ? "Sent to server" : delivery;
  return (
    <small className="message-time">
      {time ? <time dateTime={createdAt!}>{time}</time> : null}
      {edited ? <span>{time ? " · " : ""}edited</span> : null}
      {own ? <span className="message-delivery" title={deliveryDetail}>{time || edited ? " · " : ""}<span aria-hidden="true">{delivery}</span><span className="sr-only">{deliveryDetail}</span></span> : null}
    </small>
  );
}
