import { deliveryLabel } from "@sudoku/domain";

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
