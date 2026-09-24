export function typingPresenceLabel(names: readonly string[]): string | null {
  const clean = names.map((name) => name.trim()).filter(Boolean);
  if (clean.length === 0) return null;
  if (clean.length === 1) return `${clean[0]} is typing…`;
  if (clean.length === 2) return `${clean[0]} and ${clean[1]} are typing…`;
  return `${clean.length} people are typing…`;
}
