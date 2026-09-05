/**
 * True if a verified fact's confirmed event date is recent enough to report as current news, rather
 * than a genuinely true but stale fact (confirmed live: a "new single" candidate turned out to have
 * actually released six months earlier - discovery/verification independently confirmed the release
 * really happened, just not that it was current). Only ever rejects on an "exact" confirmed date -
 * "approximate"/"unknown" confidence, or a missing/unparseable date, can't be judged reliably either
 * way, so those pass through rather than being blocked on an uncertain guess (same tradeoff
 * releaseDateFilter.ts's wasReleasedOn makes for the Friday roundup).
 */
export function isFreshEnough(
  eventTimeIso: string | null,
  eventTimeConfidence: "exact" | "approximate" | "unknown",
  now: Date,
  maxAgeDays: number
): boolean {
  if (eventTimeConfidence !== "exact" || !eventTimeIso) return true;
  const eventMs = Date.parse(eventTimeIso);
  if (!Number.isFinite(eventMs)) return true;
  const ageDays = (now.getTime() - eventMs) / (1000 * 60 * 60 * 24);
  return ageDays <= maxAgeDays;
}
