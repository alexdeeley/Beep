import { z } from "zod";
import { requestJson } from "../../utils/openaiClient.js";
import {
  getEventsForStory,
  getOpenStories,
  insertStory,
  insertStoryEvent,
  touchStory,
  type StoryRow,
} from "../db/storiesRepo.js";
import { insertSource } from "../db/sourcesRepo.js";
import { insertRunCandidate } from "../db/researchRunsRepo.js";
import { insertCorrection } from "../db/postsRepo.js";
import { filterNewFacts } from "./dedupTest.js";
import { detectCorrections } from "../corrections/detectCorrections.js";
import type { NewsRunContext } from "../runContext.js";
import type { StoryMemoryDecision, VerifiedCluster } from "../types.js";

function slugify(headline: string): string {
  return headline
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80);
}

async function uniqueSlug(ctx: NewsRunContext, headline: string): Promise<string> {
  const { getStoryBySlug } = await import("../db/storiesRepo.js");
  const base = slugify(headline) || "story";
  let candidate = base;
  let n = 2;
  while (getStoryBySlug(ctx.db, candidate)) {
    candidate = `${base}-${n}`;
    n++;
  }
  return candidate;
}

const matchResultSchema = z.object({
  matchedStoryId: z.number().int().nullable(),
  reasoning: z.string(),
});

const MATCH_SYSTEM_PROMPT = [
  "You track ongoing news stories over time for a wire service. Given a newly verified story candidate and a list of currently open",
  "stories on the same topic, decide whether the candidate is a NEW EVENT within one of those existing stories (the same underlying",
  "situation continuing to develop - e.g. a 10am announcement and a 1pm regulatory response are the same story), or a genuinely NEW,",
  "unrelated story. Only match an existing story if the candidate is clearly about the same underlying situation, entity, or sequence",
  'of events - do not match just because the topic or general subject area is similar. Respond with ONLY {"matchedStoryId": <id or null>, "reasoning": "..."}.',
].join(" ");

export interface StoryMemoryOutcome {
  decision: StoryMemoryDecision;
  /** IDs of story_events actually inserted this run (empty for no_material_change). */
  newEventIds: number[];
  /** The verified facts actually persisted this run, aligned 1:1 with newEventIds - what ranking/writing should work from. */
  newEventFacts: import("../types.js").VerifiedFact[];
}

async function matchToOpenStory(ctx: NewsRunContext, cluster: VerifiedCluster, candidates: StoryRow[]): Promise<number | null> {
  if (candidates.length === 0) return null;

  const listing = candidates.map((s) => `id=${s.id}: ${s.headline} - ${s.summary}`).join("\n");
  const user = [
    `Candidate: ${cluster.headline}`,
    `Facts: ${cluster.facts.map((f) => f.claim).join(" | ")}`,
    "",
    "Currently open stories on this topic:",
    listing,
  ].join("\n");

  try {
    const raw = await requestJson<unknown>(ctx.openai, {
      model: ctx.config.news.discoveryModel,
      system: MATCH_SYSTEM_PROMPT,
      user,
      temperature: 0.1,
      maxOutputTokens: 512,
    });
    const parsed = matchResultSchema.parse(raw);
    if (parsed.matchedStoryId !== null && !candidates.some((c) => c.id === parsed.matchedStoryId)) {
      return null; // model hallucinated an id not in the candidate list - treat as no match
    }
    return parsed.matchedStoryId;
  } catch (err) {
    ctx.logger.warn("story-memory", "Story-matching call failed, treating candidate as a new story", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Decides whether a verified cluster is a brand-new story, a new
 * development in an already-open story, or nothing materially new at
 * all - and persists the outcome (new stories/story_events/sources rows)
 * so the story survives to the next hourly run. This is what lets the
 * pipeline post "regulators respond" three hours after "company announces"
 * as a continuation, not a disconnected headline.
 */
export async function updateStoryMemory(ctx: NewsRunContext, cluster: VerifiedCluster): Promise<StoryMemoryOutcome> {
  const openStories = getOpenStories(ctx.db).filter((s) => {
    try {
      const tags = JSON.parse(s.topic_tags) as string[];
      return tags.includes(cluster.topicKey);
    } catch {
      return false;
    }
  });

  const matchedStoryId = await matchToOpenStory(ctx, cluster, openStories);

  if (matchedStoryId === null) {
    const slug = await uniqueSlug(ctx, cluster.headline);
    const story = insertStory(ctx.db, {
      slug,
      headline: cluster.headline,
      summary: cluster.facts[0]?.claim ?? cluster.headline,
      topicTags: [cluster.topicKey],
      importanceScore: 0,
      createdInRunId: ctx.hourlyRunId,
    });

    const newEventIds: number[] = [];
    for (const fact of cluster.facts) {
      const event = insertStoryEvent(ctx.db, {
        storyId: story.id,
        summary: fact.claim,
        eventTime: fact.eventTimeIso,
        eventTimeConfidence: fact.eventTimeConfidence,
        articlePublishedAt: fact.articlePublishedAtIso,
        factLabel: fact.factLabel,
        isCorrection: false,
        correctsEventId: null,
        discoveredInRunId: ctx.hourlyRunId,
      });
      newEventIds.push(event.id);
      for (const source of fact.sources) {
        insertSource(ctx.db, {
          storyEventId: event.id,
          url: source.url,
          domain: source.domain,
          title: source.title,
          sourceTier: source.sourceTier,
          isPrimaryForEvent: source.isPrimary,
        });
      }
    }

    insertRunCandidate(ctx.db, {
      runId: ctx.hourlyRunId,
      stage: "story-memory",
      candidateSummary: cluster.headline,
      decision: "accepted",
      reason: "new story",
      storyId: story.id,
    });

    return {
      decision: { kind: "new_story", slug: story.slug, headline: story.headline, summary: story.summary },
      newEventIds,
      newEventFacts: cluster.facts,
    };
  }

  const existingEvents = getEventsForStory(ctx.db, matchedStoryId);
  const newFacts = filterNewFacts(existingEvents, cluster.facts);

  if (newFacts.length === 0) {
    insertRunCandidate(ctx.db, {
      runId: ctx.hourlyRunId,
      stage: "story-memory",
      candidateSummary: cluster.headline,
      decision: "rejected",
      reason: "no material change vs. existing story record",
      storyId: matchedStoryId,
    });
    return { decision: { kind: "no_material_change", storyId: matchedStoryId }, newEventIds: [], newEventFacts: [] };
  }

  const corrections = await detectCorrections(ctx, existingEvents, newFacts);
  const correctionByFactIndex = new Map(corrections.map((c) => [c.newFactIndex, c]));

  const newEventIds: number[] = [];
  for (let i = 0; i < newFacts.length; i++) {
    const fact = newFacts[i]!;
    const correction = correctionByFactIndex.get(i);
    const event = insertStoryEvent(ctx.db, {
      storyId: matchedStoryId,
      summary: fact.claim,
      eventTime: fact.eventTimeIso,
      eventTimeConfidence: fact.eventTimeConfidence,
      articlePublishedAt: fact.articlePublishedAtIso,
      factLabel: fact.factLabel,
      isCorrection: correction !== undefined,
      correctsEventId: correction?.correctsEventId ?? null,
      discoveredInRunId: ctx.hourlyRunId,
    });
    newEventIds.push(event.id);
    for (const source of fact.sources) {
      insertSource(ctx.db, {
        storyEventId: event.id,
        url: source.url,
        domain: source.domain,
        title: source.title,
        sourceTier: source.sourceTier,
        isPrimaryForEvent: source.isPrimary,
      });
    }
    if (correction) {
      insertCorrection(ctx.db, {
        originalStoryEventId: correction.correctsEventId,
        correctedStoryEventId: event.id,
        detectedInRunId: ctx.hourlyRunId,
        correctionPostId: null,
        explanation: correction.explanation,
      });
    }
  }

  touchStory(ctx.db, matchedStoryId, {});

  insertRunCandidate(ctx.db, {
    runId: ctx.hourlyRunId,
    stage: "story-memory",
    candidateSummary: cluster.headline,
    decision: "accepted",
    reason: `${newFacts.length} new event(s) on existing story`,
    storyId: matchedStoryId,
  });

  return { decision: { kind: "new_event", storyId: matchedStoryId }, newEventIds, newEventFacts: newFacts };
}
