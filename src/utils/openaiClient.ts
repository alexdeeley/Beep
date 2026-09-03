import OpenAI from "openai";
import type { AppConfig } from "../config/index.js";

export function makeOpenAIClient(config: AppConfig): OpenAI | null {
  if (!config.openaiApiKey) return null;
  return new OpenAI({ apiKey: config.openaiApiKey });
}

export class MissingApiKeyError extends Error {
  constructor(stage: string) {
    super(`OPENAI_API_KEY is not set; cannot run the "${stage}" stage against a live model.`);
    this.name = "MissingApiKeyError";
  }
}

/**
 * Ask the model for strict JSON and parse it. We use response_format
 * json_object plus an explicit instruction to return only JSON, and we
 * retry once on parse failure with a stricter reminder, since even
 * JSON-mode models occasionally wrap output in prose.
 */
export async function requestJson<T>(
  client: OpenAI,
  opts: {
    model: string;
    system: string;
    user: string;
    temperature?: number;
    maxOutputTokens?: number;
  }
): Promise<T> {
  const attempt = async (extra?: string): Promise<T> => {
    const completion = await client.chat.completions.create({
      model: opts.model,
      temperature: opts.temperature ?? 0.4,
      max_tokens: opts.maxOutputTokens ?? 4096,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: extra ? `${opts.user}\n\n${extra}` : opts.user },
      ],
    });
    const text = completion.choices[0]?.message?.content ?? "";
    return JSON.parse(text) as T;
  };

  try {
    return await attempt();
  } catch (err) {
    return await attempt(
      "IMPORTANT: Your previous response could not be parsed as JSON. Return ONLY a single valid JSON object, no markdown fences, no commentary."
    );
  }
}

export interface WebSearchCitation {
  url: string;
  title: string;
}

export interface WebSearchUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface WebSearchJsonResult<T> {
  data: T;
  /**
   * URL citation annotations from the response. VERIFIED EMPIRICALLY:
   * these are only populated when the model's final output is plain
   * text - the Responses API does not attach citation annotations to
   * strict `json_schema` output (there's nowhere in a JSON value for a
   * character-offset annotation to live). requestJsonWithWebSearch
   * always uses json_schema, so this will normally be empty; callers
   * that need real source URLs out of a structured call MUST ask for
   * them as explicit schema fields (e.g. a `sources: [{url, title}]`
   * array) rather than relying on this. Kept for completeness /
   * possible future non-strict use, not because it's expected to fire.
   */
  citations: WebSearchCitation[];
  /** Count of web_search_call tool invocations the model actually performed. */
  searchCount: number;
  /** Search queries the model actually issued, when the SDK exposes them (see extractSearchQueries). */
  searchQueries: string[];
  usage: WebSearchUsage;
}

export interface WebSearchTextResult {
  text: string;
  /** Populated: plain-text output does carry url_citation annotations - see WebSearchJsonResult.citations for why json mode differs. */
  citations: WebSearchCitation[];
  searchCount: number;
  searchQueries: string[];
  usage: WebSearchUsage;
}

const WEB_SEARCH_TOOL_TYPE = "web_search_preview" as const;

function extractCitations(response: import("openai").OpenAI.Responses.Response): WebSearchCitation[] {
  const citations: WebSearchCitation[] = [];
  for (const item of response.output) {
    if (item.type !== "message") continue;
    for (const part of item.content) {
      if (part.type !== "output_text") continue;
      for (const annotation of part.annotations) {
        if (annotation.type === "url_citation") {
          citations.push({ url: annotation.url, title: annotation.title });
        }
      }
    }
  }
  return citations;
}

function countWebSearchCalls(response: import("openai").OpenAI.Responses.Response): number {
  return response.output.filter((item) => item.type === "web_search_call").length;
}

/**
 * Extracts the actual search query strings the model issued. The
 * installed SDK's TypeScript types (openai@4.104.0) do not declare an
 * `action` field on ResponseFunctionWebSearch, but the live API does
 * return one (`{ action: { type: "search", query, queries } }`) -
 * verified directly against a real response. Read defensively via an
 * unknown cast since this is undocumented-in-types API behavior that
 * could change without a type error to warn us.
 */
function extractSearchQueries(response: import("openai").OpenAI.Responses.Response): string[] {
  const queries: string[] = [];
  for (const item of response.output) {
    if (item.type !== "web_search_call") continue;
    const action = (item as unknown as { action?: { query?: string; queries?: string[] } }).action;
    if (action?.query) queries.push(action.query);
    else if (Array.isArray(action?.queries)) queries.push(...action.queries);
  }
  return queries;
}

function extractUsage(response: import("openai").OpenAI.Responses.Response): WebSearchUsage {
  const usage = response.usage;
  return {
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    totalTokens: usage?.total_tokens ?? 0,
  };
}

const NO_SEARCH_RETRY_REMINDER =
  "IMPORTANT: Your previous response did not include any web_search tool call. You MUST actually call the web search tool at least once and base your answer only on what it returns - do not answer from memory. Current information changes; your training data is not sufficient here.";

/**
 * Structured-output research request via the Responses API with the
 * built-in web search tool enabled, so the model retrieves current
 * information rather than relying on training-data memory. Returns the
 * parsed JSON plus the URL citations and usage the model actually
 * produced, for source-tier classification and audit logging.
 *
 * VERIFIED EMPIRICALLY (not merely a theoretical risk): attaching the
 * web_search tool does NOT guarantee the model actually calls it - in
 * testing, the model sometimes answered fluently and confidently from
 * stale training-data memory with zero tool calls (searchCount: 0),
 * producing a plausible-looking but months-stale "current news" item.
 * By default this function retries once with an explicit reminder if
 * searchCount comes back 0, and throws if it's still 0 after that -
 * callers should treat that as a hard stage failure, not silently
 * proceed with unresearched output. Pass requireSearch: false to opt
 * out (e.g. for a schema that legitimately doesn't need search every
 * time), but the default is intentionally strict for a news pipeline.
 *
 * Also note: URL citation annotations are NOT populated in this
 * strict-json_schema mode (see WebSearchJsonResult.citations) - if the
 * caller's schema needs real source URLs, it must ask for them as an
 * explicit field (e.g. `sources: [{url, title}]`) and treat that as
 * model-reported, independently re-checkable data, not as verified fact.
 *
 * The web-search tool type name (`web_search_preview`) is an OpenAI
 * SDK/API implementation detail that has changed before - re-verify
 * against node_modules/openai/resources/responses/responses.d.ts if this
 * ever starts failing with an "invalid tool type" error.
 */
export async function requestJsonWithWebSearch<T>(
  client: OpenAI,
  opts: {
    model: string;
    system: string;
    user: string;
    jsonSchemaName: string;
    jsonSchema: Record<string, unknown>;
    temperature?: number;
    maxOutputTokens?: number;
    requireSearch?: boolean;
  }
): Promise<WebSearchJsonResult<T>> {
  const requireSearch = opts.requireSearch ?? true;

  const call = async (extraInput?: string) =>
    client.responses.create({
      model: opts.model,
      temperature: opts.temperature ?? 0.3,
      max_output_tokens: opts.maxOutputTokens ?? 4096,
      tools: [{ type: WEB_SEARCH_TOOL_TYPE }],
      instructions: opts.system,
      input: extraInput ? `${opts.user}\n\n${extraInput}` : opts.user,
      text: {
        format: {
          type: "json_schema",
          name: opts.jsonSchemaName,
          schema: opts.jsonSchema,
          strict: true,
        },
      },
    });

  let response = await call();
  if (requireSearch && countWebSearchCalls(response) === 0) {
    response = await call(NO_SEARCH_RETRY_REMINDER);
    if (countWebSearchCalls(response) === 0) {
      throw new Error(
        "requestJsonWithWebSearch: model did not call the web_search tool even after an explicit retry reminder - refusing to trust its output as current information."
      );
    }
  }

  let data: T;
  try {
    data = JSON.parse(response.output_text) as T;
  } catch (err) {
    throw new Error(
      `requestJsonWithWebSearch: model output was not valid JSON despite json_schema format (${(err as Error).message}): ${response.output_text.slice(0, 500)}`
    );
  }

  return {
    data,
    citations: extractCitations(response),
    searchCount: countWebSearchCalls(response),
    searchQueries: extractSearchQueries(response),
    usage: extractUsage(response),
  };
}

/**
 * Plain-prose research request via the Responses API with web search
 * enabled - no structured schema, for the once-daily deep-research cycle
 * which wants broad context rather than one narrow structured shape.
 */
export async function requestTextWithWebSearch(
  client: OpenAI,
  opts: {
    model: string;
    system: string;
    user: string;
    temperature?: number;
    maxOutputTokens?: number;
  }
): Promise<WebSearchTextResult> {
  const response = await client.responses.create({
    model: opts.model,
    temperature: opts.temperature ?? 0.4,
    max_output_tokens: opts.maxOutputTokens ?? 8192,
    tools: [{ type: WEB_SEARCH_TOOL_TYPE }],
    instructions: opts.system,
    input: opts.user,
  });

  return {
    text: response.output_text,
    citations: extractCitations(response),
    searchCount: countWebSearchCalls(response),
    searchQueries: extractSearchQueries(response),
    usage: extractUsage(response),
  };
}

/** Vision-capable JSON request: same as requestJson but with an image attached. */
export async function requestJsonWithImage<T>(
  client: OpenAI,
  opts: {
    model: string;
    system: string;
    user: string;
    imageBase64: string;
    imageMime: string;
    temperature?: number;
    maxOutputTokens?: number;
  }
): Promise<T> {
  const completion = await client.chat.completions.create({
    model: opts.model,
    temperature: opts.temperature ?? 0.1,
    max_tokens: opts.maxOutputTokens ?? 2048,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: opts.system },
      {
        role: "user",
        content: [
          { type: "text", text: opts.user },
          {
            type: "image_url",
            image_url: { url: `data:${opts.imageMime};base64,${opts.imageBase64}` },
          },
        ],
      },
    ],
  });
  const text = completion.choices[0]?.message?.content ?? "";
  return JSON.parse(text) as T;
}
