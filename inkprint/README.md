# INKPRINT

**YOUR HANDWRITING. YOUR FONT.**

Draw each character once on a big canvas, watch your typeface come together,
and download it as a real, installable **TrueType (.ttf)** or **OpenType
(.otf)** font. Everything (drawing, outline processing, font generation and
validation) runs in the browser. There is no server, no account, and your
handwriting never leaves the device.

Live at **https://inkprint.deeley.org** (once deployed, see below).

## Run it

Node 20+.

```sh
cd inkprint
npm install
npm run dev          # http://localhost:5173  (add --host to try it on a phone on your network)
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server with hot reload |
| `npm run build` | Type-check, then build the static site into `dist/` |
| `npm run preview` | Serve the production build (service worker / offline included) |
| `npm test` | Unit tests: glyph processing, TTF/OTF writing and validation, backups, quality check |
| `npm run test:browser` | Build, then a full acceptance run in Chromium (see below) |
| `npm run typecheck` | TypeScript only |
| `npm run reference-glyphs` | Rebuild the ghost templates from a reference font (see below) |
| `npm run deploy` | Build and deploy to Cloudflare (needs a Cloudflare token) |

`dist/` is a plain static site: it can be served from any static host
(paths are relative, routing is in the URL hash).

## Deploy

The repository deploys it as a static-assets Cloudflare Worker on
`inkprint.deeley.org`: **Actions → Deploy Cloudflare Workers → Run workflow →
inkprint**. The job type-checks, runs the unit tests, builds and deploys, then
checks the domain answers. It uses the same `CLOUDFLARE_API` /
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository secrets as the
other apps. Locally: `npx wrangler login && npm run deploy`.

## How it works

```
pointer events ─▶ strokes (raw points + pressure, canvas units)          stored as-is, never rewritten
                    │  perfect-freehand: pen settings → filled outline per stroke
                    ▼
               polygon-clipping union (nonzero) → non-overlapping polygons
                    │  flip to font units (y up, baseline 0), glyph scale, baseline shift
                    │  Ramer–Douglas–Peucker simplify (0.9 units), round, orient
                    │  smooth: gentle vertices → quadratic off-curve points, corners stay sharp
                    ▼
               contours ─▶ layout: ink starts at the left sidebearing,
                    │      advance = ink width + both sidebearings + tracking
                    ▼
               FontModel ─▶ writeTTF (glyf/loca, hand-written)  ─▶ validate ─▶ FontFace.load ─▶ download
                         └▶ writeOTF (CFF, via opentype.js)       ─┘
```

* **Coordinates.** The canvas is 1000 × 1250 units with the baseline 950 units
  down, so one canvas unit is one font unit (1000 units per em). The canvas can
  be any size on screen; drawings keep their geometry.
* **Natural widths.** Advance widths come from each glyph's own ink, so an I
  is narrower than an M. Heights are never forced onto the guides: the guides
  and ghost help you stay consistent, and the quality check (Preview → Quality
  check) points out letters that stray from the rest of your own hand.
* **Non-destructive.** Pen weight, smoothing, scale, baseline, spacing and
  per-glyph fit are parameters. The original strokes are kept, and processed
  outlines are cached with a key of the settings that made them.
* **Metrics.** Cap height, x-height, ascender and descender are configurable;
  ascender/descender/line gap are derived so the line height is 1.2 em and
  `usWinAscent/Descent` cover the tallest and deepest glyph, so nothing clips
  on Windows.

### The font files

| Format | Writer | Outlines | Notes |
| --- | --- | --- | --- |
| `.ttf` (default) | `src/modules/font-generation/ttf-writer.ts` | TrueType quadratic (`glyf`) | Tables: `OS/2` v4, `cmap` (formats 4 and 12), `glyf`, `head`, `hhea`, `hmtx`, `loca`, `maxp`, `name`, `post` v3. Checksums and `checkSumAdjustment` computed. |
| `.otf` | [opentype.js](https://github.com/opentypejs/opentype.js) 1.3.4 | CFF (cubic) | opentype.js converts the quadratic segments to cubics. |

**Why a hand-written TTF writer?** opentype.js, the usual browser font
library, can only *write* CFF-flavoured OpenType: it cannot produce `glyf`
outlines. Renaming its output `.ttf` would be a lie, so Inkprint writes TrueType
itself, following the OpenType specification table by table (about 350
lines). Its outlines are quadratic, exactly what Inkprint's smoothing produces,
so nothing is approximated.

Fonts are named `<FamilyName>-Regular.ttf` / `.otf` (spaces removed). The
`name` table carries the family, subfamily (Regular), full name, PostScript
name, unique ID, version, designer, copyright and a description, with Windows
(Unicode) records always and Macintosh records when every name is ASCII.
`fsType` is 0 (installable). Space and no-break space share a spacing glyph;
`.notdef` is the usual empty box.

### Validation (before any download is offered)

1. **Container check** (`font-validation/validate.ts`): table directory order
   and bounds, 4-byte alignment, every table checksum, the whole-file checksum
   adjustment, `head` magic and units per em, required tables, `loca` order.
2. **Read-back**: the bytes are parsed with opentype.js; the outline format,
   family name, space mapping, and every drawn character (mapped, non-empty,
   positive advance) are checked.
3. **The browser's own font engine**: the font is loaded with `FontFace`
   (OTS in Chrome and Firefox, Core Text in Safari). Previews and the export
   specimen use this loaded font, so what you see is the file you get.

The download button stays disabled until all three pass; problems are listed
in plain language. The unit tests also parse every table, and during
development the output was checked with fontTools (`TTFont`, decompile and
recompile every table) and rendered with FreeType.

### Ghost templates

`src/data/reference-glyphs.json` holds outlines from **Inter Regular**
(SIL Open Font License 1.1, by Rasmus Andersson), scaled to cap height 700.
They are only drawn faintly behind the canvas, loaded as a separate chunk, and
never copied into anyone's font. Characters without a reference outline use
the system font as their ghost. Rebuild with
`npm run reference-glyphs -- path/to/Inter-Regular.otf`.

### Persistence

IndexedDB (`inkprint` database): `projects` keyed by id, `glyphs` keyed by
`[projectId, char]`. Changes are written about 350 ms after they happen and
immediately when the page is hidden or closed. The app asks the browser to keep
the storage persistent. Backups are JSON, documented in
[docs/PROJECT_FORMAT.md](docs/PROJECT_FORMAT.md).

### Offline

After the first visit a small service worker (`public/sw.js`, production
builds only) serves the app shell, so the app opens and works offline; fonts
are generated locally anyway.

## Project layout

```
src/
  app/                 App shell, hash router, project context, live-font hook, display prefs
  screens/             Welcome, Setup, Studio, Review, Preview, Export, Settings, Projects, Done
  components/          DrawingCanvas, GhostTemplate, CanvasGuides, CharacterNavigation,
                       CharacterProgress, CharacterGrid, ContextStrip, FontPreview,
                       FontSettings, ExportPanel, ProjectManager, WordSample, ui
  modules/
    drawing/           pointer capture (touch, pen pressure, palm rejection, coalesced events)
    glyph-processing/  stroke outlines, union, simplify, orient, smooth, layout
    font-generation/   font model, TTF writer, OTF writer, binary helpers
    font-validation/   container + read-back checks, browser FontFace load
    storage/           IndexedDB, project store (debounced saves, undo/redo), project factory
    project-import-export/  backups, downloads/share, PNG specimen
    quality/           consistency check
  data/                character sets, reference glyphs (ghosts)
  types/               project, glyph and font-metric types
tests/                 Vitest unit tests (+ fixtures that "write" letters by tracing the ghosts)
dev/browser-test.mjs   Playwright acceptance test
```

## Tests

`npm test` runs in Node. `npm run test:browser` builds and drives Chromium
through the acceptance list: an emulated iPhone draws a capital A by touch
(checking the page does not scroll), a pen with varying pressure draws B,
undo / redo / clear / undo-clear, BACK and NEXT without losing work, a browser
refresh, then an iPad session draws A–Z, a–z, 0–9 and punctuation, checks the
review grid, confirms the preview is set in the generated font and marks
missing characters, downloads the .ttf and parses it back, downloads the .otf,
and backs up → deletes → restores the project (and re-imports it as a copy).
Screenshots go to `dev/shots/`. If Playwright's bundled browser is missing,
point it at one: `CHROMIUM_PATH=/path/to/chrome npm run test:browser`.

## Limitations

* **Separate letters only.** Cursive handwriting is drawn letter by letter;
  there are no contextual alternates or joining (no `GSUB`), so letters sit
  side by side rather than connecting.
* **No kerning** (`GPOS`/`kern`): spacing comes from each glyph's sidebearings,
  adjustable per character under *Fit & spacing*.
* **No hinting.** Outlines are unhinted, which is normal for handwriting fonts;
  they render well at screen sizes on modern systems.
* **One style per project.** Each project makes a single Regular font. Make a
  copy of a project (Projects → Duplicate) for a bold or alternate version.
* **iPhone and iPad** cannot install a font straight from Safari; the export
  screen explains the font-installer-app route. Desktop systems install the
  file directly.
* Data lives in one browser's storage. Clearing site data deletes it, so the
  app nudges you to download a backup.
