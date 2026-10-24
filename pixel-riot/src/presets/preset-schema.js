// Versioned instrument preset + composition formats, and their validators.
// Imported data is DATA ONLY: validators copy known fields with type checks, clamp numbers,
// drop unknown keys and never evaluate anything. Unknown registry ids are replaced with
// defaults and reported as warnings.

export const PRESET_FORMAT = 'pixel-riot-preset';
export const COMPOSITION_FORMAT = 'pixel-riot-composition';
export const PRESET_VERSION = 1;

export const DEFAULT_LOOK = { patternGain: 0.42, cellScale: 0.92, gap: 0.86, hueBias: 0, rotateCells: 0, symmetry: 'quad' };
export const SYMMETRIES = ['none', 'h', 'v', 'quad', 'radial4', 'radial8'];
export const SHAPE_MODES = ['uniform', 'band', 'hash', 'energy'];
export const BLENDS = ['mix', 'add', 'multiply', 'max', 'difference', 'xor'];

const num = (v, a, b, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(b, Math.max(a, n)) : d; };
const str = (v, d, max = 80) => (typeof v === 'string' && v.length ? v.slice(0, max) : d);
const plainParams = (o) => {
  const out = {};
  if (!o || typeof o !== 'object' || Array.isArray(o)) return out;
  for (const [k, v] of Object.entries(o).slice(0, 24)) {
    if (!/^[a-zA-Z][\w]{0,30}$/.test(k)) continue;
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'string' && v.length < 60) out[k] = v;
    else if (Array.isArray(v) && v.length <= 8 && v.every((x) => typeof x === 'number' && Number.isFinite(x))) out[k] = v.slice();
  }
  return out;
};

// registries: { palettes, patterns, shapes, interactions, effects, energyBehaviors } (Registry-like with has()).
export function validatePreset(input, registries, { fallbackId = 'custom' } = {}) {
  const errors = [], warnings = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, errors: ['preset must be an object'], warnings };
  if (input.format && input.format !== PRESET_FORMAT) errors.push(`unknown format "${input.format}"`);
  const version = input.version ?? PRESET_VERSION;
  if (!Number.isInteger(version) || version < 1) errors.push('version must be a positive integer');
  else if (version > PRESET_VERSION) errors.push(`preset version ${version} is newer than supported (${PRESET_VERSION})`);
  if (errors.length) return { ok: false, errors, warnings };

  const has = (reg, id) => typeof id === 'string' && reg?.has(id);
  const pick = (reg, id, def, what) => { if (has(reg, id)) return id; if (id != null) warnings.push(`unknown ${what} "${id}" -> "${def}"`); return def; };

  const p = {
    format: PRESET_FORMAT, version: PRESET_VERSION,
    id: str(input.id, fallbackId, 60).replace(/[^a-z0-9._-]/gi, '-').toLowerCase(),
    name: str(input.name, 'UNTITLED', 40),
    palette: pick(registries.palettes, input.palette, 'white-electric', 'palette'),
    pattern: {
      a: { id: pick(registries.patterns, input.pattern?.a?.id, 'checker', 'pattern'), params: plainParams(input.pattern?.a?.params) },
      b: input.pattern?.b && input.pattern.b.id ? { id: pick(registries.patterns, input.pattern.b.id, 'noise', 'pattern'), params: plainParams(input.pattern.b.params) } : null,
      blend: BLENDS.includes(input.pattern?.blend) ? input.pattern.blend : 'mix',
      mix: num(input.pattern?.mix, 0, 1, 0.5),
      speed: num(input.pattern?.speed, 0, 4, 1),
    },
    shapes: (Array.isArray(input.shapes) ? input.shapes : ['square']).filter((s) => { const ok = has(registries.shapes, s); if (!ok) warnings.push(`unknown shape "${s}" dropped`); return ok; }).slice(0, 8),
    shapeMode: SHAPE_MODES.includes(input.shapeMode) ? input.shapeMode : 'band',
    look: {
      patternGain: num(input.look?.patternGain, 0, 1.2, DEFAULT_LOOK.patternGain),
      cellScale: num(input.look?.cellScale, 0.2, 1.4, DEFAULT_LOOK.cellScale),
      gap: num(input.look?.gap, 0.3, 1, DEFAULT_LOOK.gap),
      hueBias: num(input.look?.hueBias, -1, 1, DEFAULT_LOOK.hueBias),
      rotateCells: num(input.look?.rotateCells, 0, 1, DEFAULT_LOOK.rotateCells),
      symmetry: SYMMETRIES.includes(input.look?.symmetry) ? input.look.symmetry : DEFAULT_LOOK.symmetry,
    },
    interaction: pick(registries.interactions, input.interaction, 'riot', 'interaction profile'),
    ambient: (Array.isArray(input.ambient) ? input.ambient : []).slice(0, 4)
      .filter((a) => { const ok = a && has(registries.effects, a.effect); if (!ok) warnings.push(`unknown ambient effect "${a?.effect}" dropped`); return ok; })
      .map((a) => ({ effect: a.effect, params: plainParams(a.params) })),
    energy: {
      behavior: pick(registries.energyBehaviors, input.energy?.behavior, 'diffuse', 'energy behavior'),
      decay: num(input.energy?.decay, 0.1, 8, 1.6),
      spread: num(input.energy?.spread, 0, 1, 0.18),
    },
    chain: {
      radius: num(input.chain?.radius, 1, 4, 1), delay: num(input.chain?.delay, 0.01, 0.5, 0.06),
      decay: num(input.chain?.decay, 0.3, 0.98, 0.82), maxDepth: num(input.chain?.maxDepth, 1, 24, 9) | 0,
      probability: num(input.chain?.probability, 0, 1, 0.55),
      bias: Array.isArray(input.chain?.bias) && input.chain.bias.length === 2 ? input.chain.bias.map((v) => num(v, -1, 1, 0)) : [0, 0],
      biasStrength: num(input.chain?.biasStrength, 0, 1, 0),
      symmetry: SYMMETRIES.includes(input.chain?.symmetry) ? input.chain.symmetry : 'none',
      colorInherit: num(input.chain?.colorInherit, 0, 1, 0.4), soundInherit: num(input.chain?.soundInherit, 0, 1, 0.35),
    },
    music: input.music && typeof input.music === 'object' ? {
      ...(input.music.tempo != null ? { tempo: num(input.music.tempo, 40, 220, 112) } : {}),
      ...(typeof input.music.scale === 'string' ? { scale: input.music.scale.slice(0, 30) } : {}),
      ...(input.music.root != null ? { root: num(input.music.root, 0, 11, 0) | 0 } : {}),
    } : {},
    trails: input.trails != null ? num(input.trails, 0, 0.92, 0.35) : null,
  };
  if (!p.shapes.length) p.shapes = ['square'];
  return { ok: true, errors, warnings, value: p };
}

export function validateComposition(input, registries, gridLimits = { maxCells: 128 * 400 }) {
  if (!input || typeof input !== 'object') return { ok: false, errors: ['composition must be an object'], warnings: [] };
  if (input.format !== COMPOSITION_FORMAT) return { ok: false, errors: [`not a ${COMPOSITION_FORMAT} file`], warnings: [] };
  if (!Number.isInteger(input.version) || input.version > PRESET_VERSION) return { ok: false, errors: [`unsupported composition version ${input.version}`], warnings: [] };
  const pr = validatePreset(input.preset, registries);
  if (!pr.ok) return pr;
  let art = null;
  const a = input.art;
  if (a) {
    const cols = a.cols | 0, rows = a.rows | 0;
    if (cols < 2 || rows < 2 || cols * rows > gridLimits.maxCells) return { ok: false, errors: ['art grid size out of range'], warnings: pr.warnings };
    for (const k of ['paint', 'shape', 'ink']) if (typeof a[k] !== 'string' || a[k].length > 2_000_000 || !/^[A-Za-z0-9+/=]*$/.test(a[k])) return { ok: false, errors: [`art.${k} must be base64`], warnings: pr.warnings };
    art = { cols, rows, paint: a.paint, shape: a.shape, ink: a.ink };
  }
  return { ok: true, errors: [], warnings: pr.warnings, value: { preset: pr.value, art } };
}
