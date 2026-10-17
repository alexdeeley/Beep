# Inkprint project backup format (version 1)

A backup is a UTF-8 JSON file, by default named `<Project-name>.inkprint-<YYYY-MM-DD>.json`.
It holds everything needed to keep editing a font: the settings and every
original pen stroke. It is **not** a font file; export the font separately.

```jsonc
{
  "format": "inkprint-project",      // always this string
  "formatVersion": 1,                 // files with a higher number are refused (made by a newer app)
  "exportedAt": "2026-10-17T09:30:00.000Z",
  "project": {
    "id": "6f1c…",                    // identifies the project; importing a backup whose id
                                      // already exists asks "replace" or "import as a copy"
    "name": "My Handwriting",         // shown in the project list
    "familyName": "My Handwriting",   // written into the font (max 63 characters)
    "designer": "Sam",
    "copyright": "Copyright (c) 2026 Sam. Drawn by hand with Inkprint.",
    "version": "1.000",
    "style": "natural",               // natural | print | cursive | block | experimental
    "groups": ["upper", "lower", "numbers", "punctuation"],   // upper | lower | numbers | punctuation | symbols | extended
    "customChars": "ŁłŠš",            // extra characters, in drawing order
    "metrics": { "capHeight": 700, "xHeight": 480, "ascender": 740, "descender": -240 },
    "stroke":  { "size": 46, "thinning": 0.45, "smoothing": 0.5, "streamline": 0.35 },
    "layout":  { "glyphScale": 1, "baselineShift": 0, "sidebearing": 50, "spaceWidth": 300, "tracking": 0 },
    "ghost":   { "visible": true, "opacity": 0.18, "scale": 1, "offsetY": 0 },
    "canvasTheme": "light",           // light | dark
    "showGuides": true,
    "exportFormat": "ttf",            // ttf | otf
    "lastChar": "g",
    "createdAt": 1792226400000,       // milliseconds since 1970
    "updatedAt": 1792230000000
  },
  "glyphs": [
    {
      "char": "A",
      "codePoint": "U+0041",          // informational; "char" is authoritative
      "status": "complete",           // empty | in-progress | complete | needs-revision
      "adjust": { "scale": 1, "offsetY": 0, "lsb": 0, "rsb": 0 },
      "updatedAt": 1792226500000,
      "strokes": [
        { "pen": false, "points": [312.4, 940.1, 0.5, 318.0, 920.7, 0.5] }
      ]
    }
  ]
}
```

## Coordinates

All metrics are in font units with 1000 units per em. Strokes are stored in
**canvas units**: the drawing canvas is 1000 wide and 1250 tall, y grows
downward, and the baseline is at canvas y = 950, so font y = 950 − canvas y.
`points` is a flat list of `x, y, pressure` triples (pressure 0–1). `pen` is
true when a stylus reported real pressure; otherwise pressure is simulated from
drawing speed.

## Non-destructive settings

`stroke`, `layout`, `metrics` and each glyph's `adjust` are parameters applied
when strokes are turned into outlines. The raw `strokes` are never rewritten,
so changing or resetting any setting is always reversible.

## Import rules

Unknown fields are ignored. Missing or out-of-range settings fall back to
defaults or are clamped. Strokes whose `points` are not a whole number of
finite triples are dropped. Duplicate characters keep the first entry.
