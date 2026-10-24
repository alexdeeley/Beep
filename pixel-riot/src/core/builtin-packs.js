// Core packs: the built-in shapes, palettes, patterns, energy behaviours, gesture
// recognizers, interaction profiles, presets and the Canvas 2D renderer are registered
// through the SAME plugin mechanism extensions use. (Effects and audio have their own
// pack modules next to their code.)

import { API_VERSION } from '../config.js';
import { BUILTIN_SHAPES } from '../rendering/shape-registry.js';
import { BUILTIN_PALETTES } from '../color/palettes.js';
import { BUILTIN_PATTERNS } from '../patterns/builtins.js';
import { BUILTIN_ENERGY_BEHAVIORS } from '../grid/energy-field.js';
import { BUILTIN_RECOGNIZERS } from '../input/recognizers.js';
import { BUILTIN_PROFILES } from '../interaction/profiles.js';
import { BUILTIN_PRESETS } from '../presets/builtins.js';
import { createCanvasRenderer } from '../rendering/canvas-renderer.js';

const pack = (id, name, description, register, extra = {}) => ({
  manifest: { id, name, version: '1.0.0', type: 'pack', core: true, apiVersion: API_VERSION, description, ...extra },
  register,
});

export const CORE_PACKS = [
  pack('core.shapes', 'Core Shapes', `${BUILTIN_SHAPES.length} shapes`, (api) => BUILTIN_SHAPES.forEach((s) => api.shapes.register(s))),
  pack('core.palettes', 'Core Palettes', `${BUILTIN_PALETTES.length} palettes`, (api) => BUILTIN_PALETTES.forEach((p) => api.palettes.register(p))),
  pack('core.patterns', 'Core Patterns', `${BUILTIN_PATTERNS.length} patterns`, (api) => BUILTIN_PATTERNS.forEach((p) => api.patterns.register(p))),
  pack('core.energy', 'Core Energy Behaviours', `${BUILTIN_ENERGY_BEHAVIORS.length} behaviours`, (api) => BUILTIN_ENERGY_BEHAVIORS.forEach((b) => api.energy.behaviors.register(b))),
  pack('core.gestures', 'Core Gestures', 'press, tap/double/rhythm, drag/swipe/reverse/circle, hold, multitouch', (api) => BUILTIN_RECOGNIZERS.forEach((r) => api.input.recognizers.register(r))),
  pack('core.renderers', 'Canvas 2D Renderer', 'default renderer', (api) => api.renderers.register(createCanvasRenderer())),
  pack('core.interactions', 'Core Interaction Profiles', `${BUILTIN_PROFILES.length} profiles`, (api) => BUILTIN_PROFILES.forEach((p) => api.interactions.register(p)), { dependencies: ['core.effects', 'core.audio'] }),
  pack('core.presets', 'Core Presets', `${BUILTIN_PRESETS.length} presets`, (api) => BUILTIN_PRESETS.forEach((p) => api.presets.register(p)),
    { dependencies: ['core.shapes', 'core.palettes', 'core.patterns', 'core.energy', 'core.interactions', 'core.effects'] }),
];
