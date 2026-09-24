/** Presentation rules only. Transport sequence, not the wall clock, orders messages. */
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


export type SendFailureKind = "transient" | "permanent";
export const MAX_AUTO_SEND_RETRY_ATTEMPTS = 5;

export function sendFailureKind(status: number | null): SendFailureKind {
  if (status === null) return "transient";
  if (!Number.isInteger(status) || status < 100 || status > 599) {
    throw new Error("Invalid HTTP status");
  }
  if (status === 408 || status === 409 || status === 425 || status === 429 || status >= 500) {
    return "transient";
  }
  return "permanent";
}

export function sendRetryDelayMs(attempt: number): number {
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new Error("Invalid retry attempt");
  }
  return Math.min(1000 * 2 ** (attempt - 1), 16000);
}
