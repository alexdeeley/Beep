import { createHash } from "node:crypto";

/** Normalizes text before hashing so trivial whitespace differences don't defeat the exact-repost guard. */
export function normalizePostText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

export function contentHash(text: string): string {
  return createHash("sha256").update(normalizePostText(text)).digest("hex");
}
