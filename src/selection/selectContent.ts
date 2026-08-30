import type { AppConfig } from "../config/index.js";
import type { RunLogger } from "../utils/logger.js";
import { anniversaryMilestone, yearsSince } from "../utils/dateUtils.js";
import { enforceHeadlineLimit, enforceDescriptionLimit } from "../utils/textLimits.js";
import type { Category, SelectedContent, SelectedFact, ThemeName, VerifiedFact } from "../utils/types.js";

const THEMES: ThemeName[] = ["classic_gold", "deep_navy", "museum_burgundy"];
const INCIDENT_CATEGORIES: Category[] = ["strange_incident"];
const IMPORTANCE_WEIGHT: Record<VerifiedFact["historicalImportance"], number> = {
  low: 1,
  medium: 2,
  high: 3,
};

/**
 * Stage 3: pure ranking/selection logic - no LLM calls. Only
 * `verificationStatus === "verified"` facts are eligible; "needs_review"
 * and "rejected" facts never reach the graphic. If too few strong items
 * exist, the section shrinks rather than being padded with weak
 * material.
 */
export function selectContent(
  config: AppConfig,
  logger: RunLogger,
  currentYear: number,
  displayDate: string,
  monthDay: string,
  verified: VerifiedFact[]
): SelectedContent {
  const eligible = verified.filter((f) => f.verificationStatus === "verified");
  logger.info("selection", `${eligible.length}/${verified.length} verified facts are eligible for selection`);

  const scored: SelectedFact[] = eligible.map((f) => scoreFact(f, currentYear));

  const births = topN(
    scored.filter((f) => f.kind === "birth"),
    config.selection.maxBirths,
    dedupeByPerson()
  );
  const deaths = topN(
    scored.filter((f) => f.kind === "death"),
    config.selection.maxDeaths,
    dedupeByPerson()
  );
  const incidents = topN(
    scored.filter((f) => f.kind === "event" && INCIDENT_CATEGORIES.includes(f.category)),
    config.selection.maxIncidents,
    dedupeByHeadline()
  );
  const usedIds = new Set([...births, ...deaths, ...incidents].map((f) => f.id));
  // Research sometimes generates two separate candidates for the same
  // underlying fact under different "kind"s (e.g. a person's death filed
  // both as kind:"death" and as a generic kind:"event" with an identical
  // headline). Those get different candidate ids, so the id-based
  // exclusion above misses them. Cross-check by person+year fingerprint
  // too, since the same person having the same-year fact appear twice is
  // almost always this duplication bug, not two genuinely distinct facts.
  const usedFingerprints = new Set([...births, ...deaths, ...incidents].map(factFingerprint));
  const majorEvents = selectMajorEvents(
    scored.filter(
      (f) =>
        f.kind === "event" &&
        !INCIDENT_CATEGORIES.includes(f.category) &&
        !usedIds.has(f.id) &&
        !usedFingerprints.has(factFingerprint(f))
    ),
    config.selection.maxMajorEvents
  );

  warnIfBelowMinimum(logger, "majorEvents", majorEvents.length, config.selection.minMajorEvents);
  warnIfBelowMinimum(logger, "births", births.length, config.selection.minBirths);
  warnIfBelowMinimum(logger, "deaths", deaths.length, config.selection.minDeaths);
  warnIfBelowMinimum(logger, "incidents", incidents.length, config.selection.minIncidents);

  const theme = pickTheme(config, monthDay);

  // Selection above ranks by importance/relevance score to decide WHICH
  // facts make the cut; display order is separate and always
  // chronological (earliest year first) within each section, since a
  // history timeline reading out of date order is confusing.
  return {
    date: `${currentYear}-${monthDay}`,
    monthDay,
    displayDate,
    subtitle: "Historic events • famous births • notable deaths • unforgettable incidents",
    majorEvents: chronological(majorEvents),
    births: chronological(births),
    deaths: chronological(deaths),
    incidents: chronological(incidents),
    sourceCreditLine: config.brand.sourceCreditLine,
    theme,
  };
}

function chronological(facts: SelectedFact[]): SelectedFact[] {
  return [...facts].sort((a, b) => a.year - b.year);
}

/** Identifies "the same underlying fact" across kinds: same primary person (or headline, if no person) in the same year. */
function factFingerprint(f: { people: string[]; headline: string; year: number }): string {
  const key = (f.people[0] ?? f.headline).trim().toLowerCase();
  return `${key}|${f.year}`;
}

function scoreFact(f: VerifiedFact, currentYear: number): SelectedFact {
  const years = yearsSince(f.year, currentYear);
  const milestone = anniversaryMilestone(years);
  const authoritativeCount = f.sources.filter((s) => s.authoritative).length;

  let score = 0;
  score += IMPORTANCE_WEIGHT[f.historicalImportance] * 2;
  score += f.verificationConfidence * 2;
  score += Math.min(authoritativeCount, 2) * 0.4;
  score += f.primarySource ? 0.5 : 0;
  score += f.people.length > 0 ? 0.2 : 0;
  if (milestone) {
    score += milestone >= 100 ? 1.5 : milestone >= 50 ? 1 : 0.5;
  }

  return {
    ...f,
    headline: enforceHeadlineLimit(f.headline),
    description: enforceDescriptionLimit(f.description),
    selectionScore: Math.round(score * 100) / 100,
    anniversaryYears: milestone,
  };
}

/**
 * Greedy top-N selection with a soft per-category cap so the graphic
 * doesn't end up dominated by a single war, country, or decade when
 * stronger, more varied material exists.
 */
function selectMajorEvents(facts: SelectedFact[], max: number): SelectedFact[] {
  const sorted = [...facts].sort((a, b) => b.selectionScore - a.selectionScore);
  const perCategoryCap = Math.max(2, Math.ceil(max * 0.45));
  const categoryCounts = new Map<Category, number>();
  const decadesUsed = new Set<number>();
  const seenHeadlines = new Set<string>();

  const selected: SelectedFact[] = [];
  const deferred: SelectedFact[] = [];

  for (const f of sorted) {
    if (selected.length >= max) break;
    const key = f.headline.trim().toLowerCase();
    if (seenHeadlines.has(key)) continue;
    const count = categoryCounts.get(f.category) ?? 0;
    if (count >= perCategoryCap) {
      deferred.push(f);
      continue;
    }
    selected.push(f);
    seenHeadlines.add(key);
    categoryCounts.set(f.category, count + 1);
    decadesUsed.add(Math.floor(f.year / 10) * 10);
  }

  // Backfill with deferred (over-cap) items only if we still have room,
  // so a strong day never falls short of `max` purely due to the cap.
  for (const f of deferred) {
    if (selected.length >= max) break;
    const key = f.headline.trim().toLowerCase();
    if (seenHeadlines.has(key)) continue;
    selected.push(f);
    seenHeadlines.add(key);
  }

  return selected;
}

function topN(facts: SelectedFact[], max: number, dedupe: (f: SelectedFact, seen: Set<string>) => boolean): SelectedFact[] {
  const sorted = [...facts].sort((a, b) => b.selectionScore - a.selectionScore);
  const seen = new Set<string>();
  const out: SelectedFact[] = [];
  for (const f of sorted) {
    if (out.length >= max) break;
    if (!dedupe(f, seen)) continue;
    out.push(f);
  }
  return out;
}

function dedupeByPerson() {
  return (f: SelectedFact, seen: Set<string>): boolean => {
    const key = (f.people[0] ?? f.headline).trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };
}

function dedupeByHeadline() {
  return (f: SelectedFact, seen: Set<string>): boolean => {
    const key = f.headline.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };
}

function pickTheme(config: AppConfig, monthDay: string): ThemeName {
  if (!config.brand.rotateThemes) return config.brand.theme;
  const [m, d] = monthDay.split("-").map((n) => Number.parseInt(n, 10));
  const dayOfYearApprox = (m ?? 1) * 31 + (d ?? 1);
  return THEMES[dayOfYearApprox % THEMES.length]!;
}

function warnIfBelowMinimum(logger: RunLogger, name: string, actual: number, min: number): void {
  if (actual < min) {
    logger.warn("selection", `${name} has only ${actual} verified item(s), below configured minimum ${min}`);
  }
}
