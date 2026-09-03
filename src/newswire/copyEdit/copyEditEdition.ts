import { z } from "zod";
import { requestJson } from "../../utils/openaiClient.js";
import { findBannedPhrases, hasEmoji, hasHashtag, hasRhetoricalQuestion } from "../writing/bannedPhrases.js";
import type { NewsRunContext } from "../runContext.js";
import type { CopyEditIssue, CopyEditResult, DraftEdition, DraftPost } from "../types.js";
import { buildCopyEditSystemPrompt, COPY_EDIT_JSON_SCHEMA } from "./prompts.js";

const copyEditResultSchema = z.object({ posts: z.array(z.string()) });

function findIssues(posts: DraftPost[], focus: NewsRunContext["editorialFocus"]): CopyEditIssue[] {
  const issues: CopyEditIssue[] = [];
  posts.forEach((post, postIndex) => {
    for (const match of findBannedPhrases(post.text)) {
      issues.push({ postIndex, phrase: match.phrase, reason: "generic filler phrase" });
    }
    if (!focus.voice.allowHashtagsInline && hasHashtag(post.text)) {
      issues.push({ postIndex, phrase: "#hashtag", reason: "hashtags disabled by voice config" });
    }
    if (!focus.voice.allowEmoji && hasEmoji(post.text)) {
      issues.push({ postIndex, phrase: "emoji", reason: "emoji disabled by voice config" });
    }
    if (!focus.voice.allowRhetoricalQuestions && hasRhetoricalQuestion(post.text)) {
      issues.push({ postIndex, phrase: "rhetorical question", reason: "rhetorical questions disabled by voice config" });
    }
  });
  return issues;
}

/**
 * Structural style check (bannedPhrases.ts + voice-config rules) against
 * the draft edition, with a single LLM revision pass for any posts that
 * violate it - one pass only, since this is a backstop for what the
 * writer's own instructions should already have avoided, not a place to
 * spend unbounded retries.
 */
export async function copyEditEdition(ctx: NewsRunContext, edition: DraftEdition): Promise<CopyEditResult> {
  if (edition === null) return { edition: null, issuesFixed: [] };

  const issues = findIssues(edition.posts, ctx.editorialFocus);
  if (issues.length === 0) {
    ctx.logger.info("copy-edit", "No style violations found");
    return { edition, issuesFixed: [] };
  }

  ctx.logger.info("copy-edit", `Found ${issues.length} style violation(s), requesting a revision pass`, { issues });

  const flaggedIndexes = [...new Set(issues.map((i) => i.postIndex))];
  const user = [
    "Draft posts:",
    ...edition.posts.map((p, i) => `[${i}]: ${p.text}`),
    "",
    "Violations found:",
    ...issues.map((i) => `- post [${i.postIndex}]: "${i.phrase}" (${i.reason})`),
  ].join("\n");

  try {
    const raw = await requestJson<unknown>(ctx.openai, {
      model: ctx.config.news.copyEditModel,
      system: buildCopyEditSystemPrompt(),
      user,
      temperature: 0.3,
      maxOutputTokens: 2048,
    });
    const parsed = copyEditResultSchema.parse(raw);

    if (parsed.posts.length !== edition.posts.length) {
      throw new Error(`copy-edit returned ${parsed.posts.length} posts, expected ${edition.posts.length}`);
    }

    const revisedPosts: DraftPost[] = edition.posts.map((p, i) => ({ ...p, text: parsed.posts[i] ?? p.text }));
    return {
      edition: { posts: revisedPosts },
      issuesFixed: issues.filter((i) => flaggedIndexes.includes(i.postIndex)),
    };
  } catch (err) {
    ctx.logger.warn("copy-edit", "Revision pass failed; publishing the original draft as-is despite flagged style issues", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { edition, issuesFixed: [] };
  }
}
