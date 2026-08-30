import type { DecorativeAsset, SelectedContent, SelectedFact } from "../utils/types.js";

/**
 * Deterministic HTML component builders. This is the ONLY place that
 * turns verified factual data into pixels-of-text — no image-generation
 * model ever typesets a date, name, or headline. Every dynamic string
 * is HTML-escaped before insertion.
 */

export function escapeHtml(input: string | number | null | undefined): string {
  if (input === null || input === undefined) return "";
  return String(input)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function motifFor(assets: DecorativeAsset[], usedFor: DecorativeAsset["usedFor"]): DecorativeAsset | undefined {
  return assets.find((a) => a.usedFor === usedFor);
}

function motifHtml(asset: DecorativeAsset | undefined): string {
  if (!asset) return "";
  return `<div class="motif"><img src="file://${asset.filePath}" alt="" /></div>`;
}

function headerHtml(selected: SelectedContent, assets: DecorativeAsset[]): string {
  return `
  <header class="header">
    <div class="eyebrow">On This Day</div>
    <h1 class="headline-date">${escapeHtml(selected.displayDate)}</h1>
    <p class="subtitle">${escapeHtml(selected.subtitle)}</p>
    ${motifHtml(motifFor(assets, "header"))}
    <div class="divider"></div>
  </header>`;
}

function sectionHeaderHtml(index: string, title: string): string {
  return `
    <div class="section-header">
      <span class="index">${escapeHtml(index)}</span>
      <span class="title">${escapeHtml(title)}</span>
      <span class="rule"></span>
    </div>`;
}

function eventMeta(f: SelectedFact): string {
  const parts: string[] = [];
  if (f.location) parts.push(f.location);
  if (f.anniversaryYears) parts.push(`${f.anniversaryYears}th anniversary`);
  return parts.join(" · ");
}

function timelineEventHtml(f: SelectedFact): string {
  const meta = eventMeta(f);
  return `
      <div class="event-card">
        <div class="year">${escapeHtml(f.year)}</div>
        <div class="stem"></div>
        <div class="body">
          <div class="event-headline">${escapeHtml(f.headline)}</div>
          <div class="event-desc">${escapeHtml(f.description)}</div>
          ${meta ? `<div class="event-meta">${escapeHtml(meta)}</div>` : ""}
        </div>
      </div>`;
}

function majorEventsSectionHtml(selected: SelectedContent): string {
  if (selected.majorEvents.length === 0) return "";
  return `
  <section class="section">
    ${sectionHeaderHtml("I", "Major Events")}
    <div class="timeline">
      ${selected.majorEvents.map(timelineEventHtml).join("\n")}
    </div>
  </section>`;
}

function personCardHtml(f: SelectedFact, deathAge?: number): string {
  const name = f.people[0] ?? f.headline;
  const detail = f.location ?? "";
  return `
      <div class="person-card">
        <span class="p-year">${escapeHtml(f.year)}</span>
        <div>
          <div class="p-name">${escapeHtml(name)}</div>
          ${detail ? `<div class="p-detail">${escapeHtml(detail)}</div>` : ""}
        </div>
      </div>`;
}

function birthsSectionHtml(selected: SelectedContent): string {
  if (selected.births.length === 0) return "";
  return `
  <section class="section">
    ${sectionHeaderHtml("II", "Born On This Day")}
    <div class="people-grid">
      ${selected.births.map((f) => personCardHtml(f)).join("\n")}
    </div>
  </section>`;
}

function deathsSectionHtml(selected: SelectedContent): string {
  if (selected.deaths.length === 0) return "";
  return `
  <section class="section">
    ${sectionHeaderHtml("III", "Notable Deaths")}
    <div class="people-grid">
      ${selected.deaths.map((f) => personCardHtml(f)).join("\n")}
    </div>
  </section>`;
}

function incidentCardHtml(f: SelectedFact): string {
  return `
      <div class="incident-card">
        <span class="i-year">${escapeHtml(f.year)}</span>
        <div class="i-headline">${escapeHtml(f.headline)}</div>
        <div class="i-desc">${escapeHtml(f.description)}</div>
      </div>`;
}

function incidentsSectionHtml(selected: SelectedContent, assets: DecorativeAsset[]): string {
  if (selected.incidents.length === 0) return "";
  return `
  <section class="section">
    ${sectionHeaderHtml("IV", "Strange & Memorable")}
    ${motifHtml(motifFor(assets, "incidents"))}
    <div class="timeline">
      ${selected.incidents.map(incidentCardHtml).join("\n")}
    </div>
  </section>`;
}

function sourceFooterHtml(selected: SelectedContent): string {
  return `
  <footer class="footer">
    <div class="divider"></div>
    <div class="brand">On This Day</div>
    <p class="credit">${escapeHtml(selected.sourceCreditLine)}</p>
  </footer>`;
}

export interface RenderDocumentOptions {
  pageWidth: number;
  pageHeight: number;
  cssHref: string;
  debugOutline?: boolean;
}

export function buildInfographicHtml(
  selected: SelectedContent,
  assets: DecorativeAsset[],
  opts: RenderDocumentOptions
): string {
  const body = [
    headerHtml(selected, assets),
    majorEventsSectionHtml(selected),
    birthsSectionHtml(selected),
    deathsSectionHtml(selected),
    incidentsSectionHtml(selected, assets),
    sourceFooterHtml(selected),
  ]
    .filter(Boolean)
    .join("\n");

  return `<!doctype html>
<html data-theme="${escapeHtml(selected.theme)}">
<head>
<meta charset="utf-8" />
<link rel="stylesheet" href="${opts.cssHref}" />
<style>:root{--page-w:${opts.pageWidth}px;--page-h:${opts.pageHeight}px;}</style>
</head>
<body>
  <div class="canvas${opts.debugOutline ? " qa-debug" : ""}">
    <div class="viewport">
      <div class="content" id="content-root">
        ${body}
      </div>
    </div>
  </div>
</body>
</html>`;
}
