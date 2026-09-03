const ENTITY_TYPES = ["PERSON", "COMPANY", "COUNTRY", "ORGANIZATION", "EVENT", "LAW", "PRODUCT", "PLACE", "TECHNOLOGY"] as const;
const RELATIONSHIP_TYPES = [
  "EMPLOYED_BY",
  "ACQUIRED",
  "REGULATES",
  "INVESTIGATES",
  "COMPETES_WITH",
  "AFFECTS",
  "LOCATED_IN",
  "RESPONDS_TO",
  "CONNECTED_TO",
] as const;

export const ENTITY_EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    entities: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          entityType: { type: "string", enum: ENTITY_TYPES as unknown as string[] },
        },
        required: ["name", "entityType"],
        additionalProperties: false,
      },
    },
    relationships: {
      type: "array",
      items: {
        type: "object",
        properties: {
          fromEntityName: { type: "string" },
          fromEntityType: { type: "string", enum: ENTITY_TYPES as unknown as string[] },
          toEntityName: { type: "string" },
          toEntityType: { type: "string", enum: ENTITY_TYPES as unknown as string[] },
          relationshipType: { type: "string", enum: RELATIONSHIP_TYPES as unknown as string[] },
          evidenceQuote: { type: "string" },
        },
        required: ["fromEntityName", "fromEntityType", "toEntityName", "toEntityType", "relationshipType", "evidenceQuote"],
        additionalProperties: false,
      },
    },
  },
  required: ["entities", "relationships"],
  additionalProperties: false,
} as const;

export const ENTITY_EXTRACTION_SYSTEM_PROMPT = [
  "Extract the named entities and relationships between them from the given news facts.",
  "Only extract a relationship when the given text directly states or clearly implies it - never infer a connection that isn't",
  "actually grounded in the text. evidenceQuote must be a short quote or close paraphrase from the input text that supports the",
  "relationship - if you can't point to supporting text, don't report the relationship.",
  "Use CONNECTED_TO only as a fallback when a real relationship exists but none of the other types fit.",
  "Keep entity names in their most recognizable canonical form (e.g. 'Elon Musk' not 'the billionaire').",
  "entityType has EXACTLY 9 valid values and NO 'other'/'misc' catch-all: PERSON, COMPANY, COUNTRY, ORGANIZATION, EVENT, LAW,",
  "PRODUCT, PLACE, TECHNOLOGY. If something genuinely doesn't fit any of these nine (e.g. a generic role, a vague concept,",
  "an abstract idea), do not invent a new category for it - simply leave it out of the entities list entirely rather than",
  "using an invalid type.",
  "Respond with ONLY a JSON object of this exact shape (entities are OBJECTS, never bare strings):",
  '{"entities":[{"name":"Acme Corp","entityType":"COMPANY"}],"relationships":[{"fromEntityName":"Acme Corp","fromEntityType":"COMPANY","toEntityName":"FTC","toEntityType":"ORGANIZATION","relationshipType":"INVESTIGATES","evidenceQuote":"..."}]}.',
  "If there are no entities or no relationships, use empty arrays for them - never omit the keys.",
].join(" ");
