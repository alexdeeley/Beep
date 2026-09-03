import { getStoryById, getStoryBySlug, touchStory } from "../db/storiesRepo.js";
import type { NewsRunContext } from "../runContext.js";
import type { RankedStoryEvent, StoryMemoryDecision, VerifiedCluster, VerifiedFact } from "../types.js";
import { computeImportanceScore } from "./importanceScore.js";

export interface RankableItem {
  cluster: VerifiedCluster;
  decision: StoryMemoryDecision;
  newEventIds: number[];
  /** The facts actually persisted for this item (filtered for continuations) - what scoring and writing should work from, not cluster.facts. */
  newEventFacts: VerifiedFact[];
}

function eventAgeHours(facts: VerifiedFact[], now: Date): number | null {
  const times = facts.map((f) => f.eventTimeIso).filter((t): t is string => t !== null);
  if (times.length === 0) return null;
  const earliest = Math.min(...times.map((t) => new Date(t).getTime()));
  if (Number.isNaN(earliest)) return null;
  return Math.max(0, (now.getTime() - earliest) / 3_600_000);
}

/**
 * Scores every item that has new material (skips no_material_change
 * items - there's nothing new to rank), persists the score onto its
 * story row, and returns them sorted most-important-first for the
 * connections/writing stages to work through.
 */
export function rankStories(ctx: NewsRunContext, items: RankableItem[]): RankedStoryEvent[] {
  const ranked: RankedStoryEvent[] = [];

  for (const item of items) {
    if (item.decision.kind === "no_material_change" || item.newEventIds.length === 0) continue;

    const topic = ctx.editorialFocus.priorityTopics.find((t) => t.key === item.cluster.topicKey);
    const topicWeight = topic?.weight ?? 0.5;
    const watchListMatch = ctx.editorialFocus.watch.some((w) =>
      `${item.cluster.headline} ${item.newEventFacts.map((f) => f.claim).join(" ")}`.toLowerCase().includes(w.name.toLowerCase())
    );

    const isContinuation = item.decision.kind === "new_event";
    const storyId = item.decision.kind === "new_event" ? item.decision.storyId : null;
    const parentStoryImportance = storyId !== null ? (getStoryById(ctx.db, storyId)?.importance_score ?? null) : null;

    const distinctSourceDomains = new Set(item.newEventFacts.flatMap((f) => f.sources.map((s) => s.domain.toLowerCase()))).size;

    const score = computeImportanceScore({
      topicWeight,
      sourceTiers: item.newEventFacts.flatMap((f) => f.sources.map((s) => s.sourceTier)),
      factLabels: item.newEventFacts.map((f) => f.factLabel),
      isContinuation,
      parentStoryImportance,
      watchListMatch,
      eventAgeHours: eventAgeHours(item.newEventFacts, ctx.now),
      distinctSourceDomains,
    });

    const resolvedStoryId =
      item.decision.kind === "new_story" ? getStoryIdBySlugOrThrow(ctx, item.decision.slug) : item.decision.storyId;

    touchStory(ctx.db, resolvedStoryId, { importance_score: score });

    ranked.push({
      storyId: resolvedStoryId,
      storyEventId: item.newEventIds[item.newEventIds.length - 1]!,
      headline: item.cluster.headline,
      importanceScore: score,
      topicKey: item.cluster.topicKey,
      isNewStory: item.decision.kind === "new_story",
      facts: item.newEventFacts,
    });
  }

  ranked.sort((a, b) => b.importanceScore - a.importanceScore);
  ctx.logger.info("ranking", `Ranked ${ranked.length} item(s) with new material`, {
    scores: ranked.map((r) => ({ headline: r.headline, score: Number(r.importanceScore.toFixed(3)) })),
  });
  return ranked;
}

function getStoryIdBySlugOrThrow(ctx: NewsRunContext, slug: string): number {
  const story = getStoryBySlug(ctx.db, slug);
  if (!story) throw new Error(`rankStories: no story found for slug "${slug}" - it should have just been created`);
  return story.id;
}
