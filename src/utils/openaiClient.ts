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
