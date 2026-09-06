/**
 * How much more slack an "approximate"-confidence date gets over maxAgeDays before being rejected as
 * stale - confirmed live: a writer-path "news" item about a July 2023 tour/album announcement posted
 * in September 2026 (3+ years stale) because its date came back "approximate" rather than "exact", and
 * the original version of this function let ANY non-exact date through unconditionally. An approximate
 * date genuinely can't support the same tight bar as an exact one (the fuzziness itself might just mean
 * "sometime in the last couple weeks"), so this is deliberately generous rather than reusing maxAgeDays
 * outright - but a date this many days old, even loosely dated, is not a judgment call anymore.
 */
const APPROXIMATE_CONFIDENCE_AGE_MULTIPLIER = 3;

/**
 * True if a verified fact's confirmed event date is recent enough to report as current news, rather
 * than a genuinely true but stale fact (confirmed live: a "new single" candidate turned out to have
 * actually released six months earlier - discovery/verification independently confirmed the release
 * really happened, just not that it was current). Rejects an "exact" confirmed date older than
 * maxAgeDays, or an "approximate" one older than maxAgeDays * APPROXIMATE_CONFIDENCE_AGE_MULTIPLIER.
 * "unknown" confidence, or a missing/unparseable date, can't be judged at all, so those pass through
 * rather than being blocked on no information (same tradeoff releaseDateFilter.ts's wasReleasedOn
 * makes for the Friday roundup).
 */
export function isFreshEnough(
  eventTimeIso: string | null,
  eventTimeConfidence: "exact" | "approximate" | "unknown",
  now: Date,
  maxAgeDays: number
): boolean {
  if (eventTimeConfidence === "unknown" || !eventTimeIso) return true;
  const eventMs = Date.parse(eventTimeIso);
  if (!Number.isFinite(eventMs)) return true;
  const ageDays = (now.getTime() - eventMs) / (1000 * 60 * 60 * 24);
  const effectiveMaxAgeDays = eventTimeConfidence === "exact" ? maxAgeDays : maxAgeDays * APPROXIMATE_CONFIDENCE_AGE_MULTIPLIER;
  return ageDays <= effectiveMaxAgeDays;
}
