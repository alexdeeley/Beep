// The AI adapter. One job for now: turn a topic ("Beatles albums") into a
// draft list of items with context (year, who made it, popularity, genres,
// the media type's attributes) for a person to review before anything
// enters the catalog.
//
// Rules (docs/PROVIDERS.md): the provider is optional and replaceable; the
// key is a Worker secret, never in the client or the repo; everything it
// returns is a draft labelled as AI-gathered and unverified until a person
// has looked at it; core functions never depend on it.

import Anthropic from '@anthropic-ai/sdk';
import type { ListTemplate } from '../domain/list-templates.ts';
import { templateAttributes } from '../domain/list-templates.ts';

export interface DraftRequest {
  topic: string;
  template: ListTemplate | null;     // null = let the gatherer choose from `templates`
  templates: ListTemplate[];
  count: number;
  guidance: string;                  // extra wishes from the person, may be ''
}

// What the gatherer returns, before normalization (services/lists.ts cleans it).
export interface RawItem {
  name: string;
  year: number | null;
  description: string;
  why: string;                       // one line: why it belongs on this list
  popularity: number | null;         // 0-100 estimate
  uncertain: boolean;                // the gatherer is not sure of the facts
  aliases: string[];
  attributes: { key: string; value: string }[];
}
export interface RawDraft { template: string; title: string; description: string; caveats: string[]; items: RawItem[] }

export interface AiProvider { id: string; model: string; draftList(req: DraftRequest): Promise<RawDraft> }

export class AiUnavailable extends Error { status = 503; }
export class AiRefused extends Error { status = 422; }

// ── The JSON schema the model must fill ──
export function draftSchema(templateIds: string[]): Record<string, unknown> {
  return {
    type: 'object', additionalProperties: false,
    required: ['template', 'title', 'description', 'caveats', 'items'],
    properties: {
      template: { type: 'string', enum: templateIds, description: 'which list template fits the topic' },
      title: { type: 'string', description: 'a short title for the list' },
      description: { type: 'string', description: 'one or two sentences on what the list covers and how it is ordered' },
      caveats: { type: 'array', items: { type: 'string' }, description: 'anything the reviewer should check or know, e.g. ambiguity in the topic' },
      items: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          required: ['name', 'year', 'description', 'why', 'popularity', 'uncertain', 'aliases', 'attributes'],
          properties: {
            name: { type: 'string' },
            year: { type: ['integer', 'null'], description: 'year of release / publication / birth as the template says; null if unknown' },
            description: { type: 'string', description: 'one or two factual sentences' },
            why: { type: 'string', description: 'one line on why it belongs on this list and what makes it notable' },
            popularity: { type: ['integer', 'null'], description: '0-100 estimate of how widely known it is compared with other items of its kind' },
            uncertain: { type: 'boolean', description: 'true if you are not confident the facts are right' },
            aliases: { type: 'array', items: { type: 'string' }, description: 'other names it goes by, if any' },
            attributes: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['key', 'value'], properties: { key: { type: 'string' }, value: { type: 'string' } } }, description: 'template attributes as key/value text; lists comma-separated; leave out what you do not know' },
          },
        },
      },
    },
  };
}

export function draftPrompt(req: DraftRequest): { system: string; user: string } {
  const templates = req.template ? [req.template] : req.templates;
  const tdesc = templates.map((t) => `- ${t.id}: ${t.label} (items become type "${t.type}"). Gather: ${t.gather}. Attribute keys: ${templateAttributes(t).map((a) => `${a.key} (${a.label}${a.kind === 'list' ? ', comma-separated' : a.kind === 'number' || a.kind === 'year' ? ', a number' : ''})`).join(', ')}.`).join('\n');
  const system = `You gather items for lists in a personal cultural catalog. Given a topic, you return the items that belong on that list, each with real context: the year, who made it, a 0-100 popularity estimate, genres, and the attributes the chosen template asks for.

Templates:
${tdesc}

Rules:
- Only include things that really exist and really belong to the topic. Leave out anything you cannot place; never invent an item to fill the count.
- Be precise with names (official titles, usual spelling) and years. Mark an item uncertain when you are not sure of its facts rather than guessing confidently.
- Order the items the way a knowledgeable fan would expect for this topic (chronological for a discography or filmography, by prominence for a "best of" style topic). Say the order in the description.
- "popularity" compares each item with others of its kind in general awareness, not quality.
- Keep descriptions short and factual; put opinion only in "why".
- Fill "creator" with the artist, director, author, developer or studio as the template suggests; leave an attribute out rather than filling it with a guess.
- Respect the requested number of items as a maximum.`;
  const user = `Topic: ${req.topic}\nUp to ${req.count} items.${req.template ? `\nUse the "${req.template.id}" template.` : '\nChoose the template that fits the topic.'}${req.guidance ? `\nFrom the person building the list: ${req.guidance}` : ''}`;
  return { system, user };
}

// ── Anthropic ──
export class AnthropicProvider implements AiProvider {
  id = 'anthropic';
  model: string;
  private client: Anthropic;
  constructor(apiKey: string, model = 'claude-opus-5-5') {
    this.client = new Anthropic({ apiKey, maxRetries: 2, timeout: 10 * 60 * 1000 });
    this.model = model;
  }

  async draftList(req: DraftRequest): Promise<RawDraft> {
    const { system, user } = draftPrompt(req);
    const ids = (req.template ? [req.template] : req.templates).map((t) => t.id);
    let message;
    try {
      // Streaming keeps the connection alive while a long list is written;
      // finalMessage() hands back the whole message. fallbacks: "default"
      // lets a policy decline retry on the model Anthropic recommends.
      const stream = this.client.beta.messages.stream({
        model: this.model,
        max_tokens: 32000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'medium', format: { type: 'json_schema', schema: draftSchema(ids) } },
        system,
        messages: [{ role: 'user', content: user }],
      });
      message = await stream.finalMessage();
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError) throw new AiUnavailable('the AI key was rejected: check the ANTHROPIC_API_KEY secret');
      if (e instanceof Anthropic.RateLimitError) throw new AiUnavailable('the AI service is rate-limited right now; try again in a minute');
      if (e instanceof Anthropic.APIError) throw new AiUnavailable(`the AI service returned an error (${e.status ?? 'network'}): ${e.message}`);
      throw new AiUnavailable(`could not reach the AI service: ${(e as Error).message}`);
    }
    if (message.stop_reason === 'refusal') throw new AiRefused(`the AI declined this topic${message.stop_details?.explanation ? `: ${message.stop_details.explanation}` : ''}`);
    if (message.stop_reason === 'max_tokens') throw new AiUnavailable('the list was too long to finish; ask for fewer items');
    const text = message.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('');
    try { return JSON.parse(text) as RawDraft; } catch { throw new AiUnavailable('the AI returned something that was not a list; try again'); }
  }
}

// ── A stand-in for tests and local development (RANKER_AI=fake) ──
// Deterministic, no network: a tiny built-in reference for a couple of
// topics, and a labelled placeholder list for anything else.
export class FakeProvider implements AiProvider {
  id = 'fake';
  model = 'fake-1';
  async draftList(req: DraftRequest): Promise<RawDraft> {
    const t = req.topic.toLowerCase();
    const template = req.template?.id ?? (/\bfilms?\b|\bmovies?\b/.test(t) ? 'films' : /\bbooks?\b|\bnovels?\b/.test(t) ? 'books' : 'albums');
    if (/beatles/.test(t) && template === 'albums') {
      const items: [string, number, string, number, string][] = [
        ['Please Please Me', 1963, 'Debut, recorded largely in one day at Abbey Road.', 72, 'Where it starts: beat-group energy and Merseyside covers.'],
        ['Rubber Soul', 1965, 'The turn towards the studio as an instrument.', 86, 'The first album conceived as a whole.'],
        ['Revolver', 1966, 'Tape loops, sitar, string octet.', 90, 'Pop as experiment.'],
        ["Sgt. Pepper's Lonely Hearts Club Band", 1967, 'The concept album that defined the summer of 1967.', 97, 'The most famous one.'],
        ['The Beatles', 1968, 'The double album, usually called the White Album.', 93, 'Thirty songs, four directions.'],
        ['Abbey Road', 1969, 'The last recorded; the medley on side two.', 96, 'The farewell, with the walk across the road.'],
      ];
      return { template, title: 'The Beatles: studio albums', description: 'The UK studio albums in order of release (a short fake sample).', caveats: ['This is the built-in fake provider; the real list has thirteen UK studio albums.'],
        items: items.map(([name, year, description, popularity, why]) => ({ name, year, description, why, popularity, uncertain: false, aliases: name === 'The Beatles' ? ['The White Album'] : [], attributes: [{ key: 'creator', value: 'The Beatles' }, { key: 'genres', value: 'rock, pop' }, { key: 'format', value: 'LP' }, ...(name === 'Abbey Road' ? [{ key: 'length_min', value: '47' }] : [])] })) };
    }
    const n = Math.min(req.count, 4);
    return { template, title: `${req.topic} (placeholder)`, description: 'A placeholder list from the fake provider: nothing here is real.', caveats: ['The fake provider does not know this topic; set ANTHROPIC_API_KEY for real lists.'],
      items: Array.from({ length: n }, (_, i) => ({ name: `${req.topic} item ${i + 1}`, year: 2000 + i, description: 'Placeholder entry.', why: 'Placeholder.', popularity: 50 - i * 10, uncertain: true, aliases: [], attributes: [{ key: 'creator', value: 'Unknown' }] })) };
  }
}

export function providerFromEnv(env: { ANTHROPIC_API_KEY?: string; AI_MODEL?: string; RANKER_AI?: string }): AiProvider | null {
  if (env.RANKER_AI === 'fake') return new FakeProvider();
  if (env.ANTHROPIC_API_KEY) return new AnthropicProvider(env.ANTHROPIC_API_KEY, env.AI_MODEL || undefined);
  return null;
}
