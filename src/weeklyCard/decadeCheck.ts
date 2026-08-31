/**
 * Determines whether a given weekly run date is a "decade week" - the one
 * weekly card-draw run per decade that replaces the normal card+notebook
 * post with the special "LIFE IS BEAUTIFUL. GOODBYE." post. Deterministic
 * and testable via a --date override, the same pattern the daily pipeline
 * uses for its environment rotation: given a fixed anchor date, exactly
 * one Sunday every ten years falls within 7 days on/after that date's
 * anniversary, since weekly runs are spaced exactly 7 days apart.
 */
export function isDecadeWeek(isoDate: string, anchorDate: string): boolean {
  const run = new Date(`${isoDate}T00:00:00Z`);
  const anchor = new Date(`${anchorDate}T00:00:00Z`);
  if (Number.isNaN(run.getTime()) || Number.isNaN(anchor.getTime())) return false;

  const anchorMonth = anchor.getUTCMonth();
  const anchorDay = anchor.getUTCDate();
  const anchorYear = anchor.getUTCFullYear();

  // Most recent anniversary of the anchor's month/day on or before `run`.
  let anniversaryYear = run.getUTCFullYear();
  let anniversary = new Date(Date.UTC(anniversaryYear, anchorMonth, anchorDay));
  if (anniversary.getTime() > run.getTime()) {
    anniversaryYear -= 1;
    anniversary = new Date(Date.UTC(anniversaryYear, anchorMonth, anchorDay));
  }

  const yearsSince = anniversaryYear - anchorYear;
  if (yearsSince <= 0 || yearsSince % 10 !== 0) return false;

  const daysSinceAnniversary = Math.round((run.getTime() - anniversary.getTime()) / 86_400_000);
  return daysSinceAnniversary >= 0 && daysSinceAnniversary < 7;
}
