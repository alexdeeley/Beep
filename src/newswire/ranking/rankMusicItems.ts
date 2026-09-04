import type { UnpostedMusicItemRow } from "../db/musicItemsRepo.js";
import type { FactLabel } from "../types.js";

export interface RankedMusicItem {
  item: UnpostedMusicItemRow;
  /** A structural confidence/notability score (0-1), used only to gate quiet-hours caution - never to reorder the FIFO queue. */
  importanceScore: number;
}

const FACT_LABEL_ADJUSTMENT: Record<FactLabel, number> = {
  FACT: 0.2,
  ANALYSIS: 0.05,
  BACKGROUND: 0,
  PREDICTION: -0.1,
  UNCONFIRMED: -0.15,
};

function scoreItem(item: UnpostedMusicItemRow): number {
  const base = item.item_type === "release" ? 0.6 : 0.45;
  const factAdjustment = FACT_LABEL_ADJUSTMENT[item.fact_label] ?? 0;
  const domains: string[] = JSON.parse(item.source_domains_json || "[]");
  // The verification gate already requires >=2 corroborating domains; extra corroboration beyond that is a mild extra signal of how widely reported this is, capped so it never dominates.
  const corroborationBonus = Math.min(Math.max(domains.length - 2, 0), 3) * 0.05;
  return Math.max(0, Math.min(1, base + factAdjustment + corroborationBonus));
}

/**
 * Orders this cycle's candidate pool FIFO (oldest-discovered-first, as
 * getUnpostedMusicItems already returns it) and caps it to a maximum.
 * Deliberately NOT importance-ordered - an item discovered three days ago
 * should never be starved indefinitely behind a stream of newer, flashier
 * items. importanceScore still feeds the quiet-hours policy so an
 * unusually well-corroborated release can justify posting during a slow
 * window, but it never changes queue order.
 */
export function rankMusicItems(items: UnpostedMusicItemRow[], max: number): RankedMusicItem[] {
  return items.slice(0, max).map((item) => ({ item, importanceScore: scoreItem(item) }));
}
