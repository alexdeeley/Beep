import { z } from "zod";
import { requestJson } from "../../utils/openaiClient.js";
import {
  getEntitiesForStory,
  getStoriesSharingEntities,
  insertRelationship,
  linkStoryEntity,
  upsertEntity,
} from "../db/entitiesRepo.js";
import { getStoryById, getStoryEventById } from "../db/storiesRepo.js";
import type { NewsRunContext } from "../runContext.js";
import type { RankedStoryEvent, StoryConnection } from "../types.js";
import { ENTITY_EXTRACTION_SCHEMA, ENTITY_EXTRACTION_SYSTEM_PROMPT } from "./prompts.js";

const entityExtractionResultSchema = z.object({
  entities: z.array(z.object({ name: z.string(), entityType: z.enum(["PERSON", "COMPANY", "COUNTRY", "ORGANIZATION", "EVENT", "LAW", "PRODUCT", "PLACE", "TECHNOLOGY"]) })),
  relationships: z.array(
    z.object({
      fromEntityName: z.string(),
      fromEntityType: z.enum(["PERSON", "COMPANY", "COUNTRY", "ORGANIZATION", "EVENT", "LAW", "PRODUCT", "PLACE", "TECHNOLOGY"]),
      toEntityName: z.string(),
      toEntityType: z.enum(["PERSON", "COMPANY", "COUNTRY", "ORGANIZATION", "EVENT", "LAW", "PRODUCT", "PLACE", "TECHNOLOGY"]),
      relationshipType: z.enum([
        "EMPLOYED_BY",
        "ACQUIRED",
        "REGULATES",
        "INVESTIGATES",
        "COMPETES_WITH",
        "AFFECTS",
        "LOCATED_IN",
        "RESPONDS_TO",
        "CONNECTED_TO",
      ]),
      evidenceQuote: z.string(),
    })
  ),
});

/**
 * Extracts named entities and grounded relationships from the facts
 * behind one ranked story event, and persists them - this is what feeds
 * getStoriesSharingEntities for connection-finding, and builds up the
 * long-term entity graph across runs. Evidence for every relationship is
 * tied to the specific story_event that was actually just written, never
 * invented independent of the text.
 */
async function requestEntityExtraction(
  ctx: NewsRunContext,
  factText: string
): Promise<z.infer<typeof entityExtractionResultSchema>> {
  const attempt = async (extra?: string) => {
    const raw = await requestJson<unknown>(ctx.openai, {
      model: ctx.config.news.discoveryModel,
      system: ENTITY_EXTRACTION_SYSTEM_PROMPT,
      user: extra ? `${factText}\n\n${extra}` : factText,
      temperature: 0.1,
      maxOutputTokens: 1024,
    });
    return entityExtractionResultSchema.parse(raw);
  };

  try {
    return await attempt();
  } catch (err) {
    const detail = err instanceof z.ZodError ? JSON.stringify(err.issues) : String(err);
    return await attempt(
      "IMPORTANT: Your previous response was rejected for not matching the required shape or enum values. Validation errors: " +
        detail +
        '. entityType must be EXACTLY one of PERSON, COMPANY, COUNTRY, ORGANIZATION, EVENT, LAW, PRODUCT, PLACE, TECHNOLOGY (use PLACE, not LOCATION or CITY). ' +
        "relationshipType must be EXACTLY one of EMPLOYED_BY, ACQUIRED, REGULATES, INVESTIGATES, COMPETES_WITH, AFFECTS, LOCATED_IN, RESPONDS_TO, CONNECTED_TO " +
        "(use CONNECTED_TO as a fallback, never invent a new relationship name like CANDIDATE_IN or RUNS_FOR)."
    );
  }
}

export async function extractEntitiesForStory(
  ctx: NewsRunContext,
  storyId: number,
  storyEventId: number,
  factText: string
): Promise<void> {
  let result: z.infer<typeof entityExtractionResultSchema>;
  try {
    result = await requestEntityExtraction(ctx, factText);
  } catch (err) {
    ctx.logger.warn("connections", "Entity extraction failed for a story event, skipping entity/relationship linking for it", {
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  const entityIdsByKey = new Map<string, number>();
  for (const e of result.entities) {
    const row = upsertEntity(ctx.db, e.name, e.entityType);
    entityIdsByKey.set(`${e.name}::${e.entityType}`, row.id);
    linkStoryEntity(ctx.db, storyId, row.id);
  }

  for (const rel of result.relationships) {
    const fromId = entityIdsByKey.get(`${rel.fromEntityName}::${rel.fromEntityType}`) ?? upsertEntity(ctx.db, rel.fromEntityName, rel.fromEntityType).id;
    const toId = entityIdsByKey.get(`${rel.toEntityName}::${rel.toEntityType}`) ?? upsertEntity(ctx.db, rel.toEntityName, rel.toEntityType).id;
    linkStoryEntity(ctx.db, storyId, fromId);
    linkStoryEntity(ctx.db, storyId, toId);
    insertRelationship(ctx.db, {
      fromEntityId: fromId,
      toEntityId: toId,
      relationshipType: rel.relationshipType,
      evidenceStoryEventId: storyEventId,
    });
  }
}

/**
 * Finds other open stories that share at least one entity with the
 * given story, and builds an evidence-based explanation from those
 * shared entities - never a connection invented without a grounded,
 * checkable link.
 */
export function findConnectionsForStory(ctx: NewsRunContext, storyId: number): StoryConnection[] {
  const sharing = getStoriesSharingEntities(ctx.db, storyId);
  const myEntities = new Set(getEntitiesForStory(ctx.db, storyId).map((e) => e.name));

  const connections: StoryConnection[] = [];
  for (const { story_id: relatedStoryId, shared_entities: sharedCount } of sharing) {
    if (relatedStoryId === storyId) continue;
    const relatedStory = getStoryById(ctx.db, relatedStoryId);
    if (!relatedStory) continue;
    const relatedEntities = getEntitiesForStory(ctx.db, relatedStoryId);
    const sharedNames = relatedEntities.filter((e) => myEntities.has(e.name)).map((e) => e.name);
    if (sharedNames.length === 0) continue;

    connections.push({
      storyId,
      relatedStoryId,
      sharedEntityNames: sharedNames,
      explanation: `Also involves ${sharedNames.join(", ")}, which also appear${sharedNames.length === 1 ? "s" : ""} in "${relatedStory.headline}" (shared entity count: ${sharedCount}).`,
    });
  }
  return connections;
}

/** Convenience: runs entity extraction for every ranked item, then finds connections for each. */
export async function buildConnections(ctx: NewsRunContext, ranked: RankedStoryEvent[]): Promise<Map<number, StoryConnection[]>> {
  const connectionsByStory = new Map<number, StoryConnection[]>();
  for (const item of ranked) {
    const story = getStoryById(ctx.db, item.storyId);
    if (!story) continue;
    const event = getStoryEventById(ctx.db, item.storyEventId);
    await extractEntitiesForStory(ctx, item.storyId, item.storyEventId, event?.summary ?? item.headline);
  }
  for (const item of ranked) {
    connectionsByStory.set(item.storyId, findConnectionsForStory(ctx, item.storyId));
  }
  return connectionsByStory;
}
