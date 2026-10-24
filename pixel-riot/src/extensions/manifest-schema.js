// Plugin manifest schema + validator.
//
// manifest = {
//   id: 'acme.lissajous-effect',        // unique, lowercase, dotted namespace recommended
//   name: 'Lissajous Effect',
//   version: '1.0.0',                   // semver of the extension itself
//   description: '...',
//   type: 'effect',                     // one of EXTENSION_TYPES
//   apiVersion: '1.0.0',                // PIXEL RIOT API it was written against (major must match)
//   dependencies: ['core.effects'],     // plugin ids that must be active first (optional)
//   defaults: { speed: 1 },             // default config (optional)
//   configSchema: { speed: { type: 'number', min: 0, max: 4, default: 1, label: 'SPEED' } },
//   events: { subscribes: ['gesture:tap'], emits: [] },
//   capabilities: ['visual'],           // free-form tags: 'visual','audio','input','ui','storage',...
//   ui: { panel: 'acme.lissajous-panel' },          // optional UI contribution
//   performance: { cost: 'low' | 'medium' | 'high' } // optional
//   core: true                          // only for built-in packs
// }

import { API_VERSION } from '../config.js';

export const EXTENSION_TYPES = [
  'pack',            // a bundle of several kinds of registrations (built-ins use this)
  'effect', 'shape', 'pattern', 'palette',
  'sound', 'audio-mapping', 'gesture', 'interaction', 'energy',
  'preset', 'ui', 'renderer', 'system', 'performance', 'accessibility', 'experimental',
];

const SEMVER = /^\d+\.\d+\.\d+([-+][\w.-]+)?$/;
const ID = /^[a-z0-9][a-z0-9._-]*$/;

export function majorOf(v) { return Number(String(v).split('.')[0]); }

export function isApiCompatible(pluginApi, appApi = API_VERSION) {
  if (!SEMVER.test(String(pluginApi))) return false;
  const [pm, pn] = String(pluginApi).split('.').map(Number);
  const [am, an] = String(appApi).split('.').map(Number);
  return pm === am && pn <= an;   // same major; plugin must not require a newer minor
}

export function validateManifest(m) {
  const errors = [];
  if (!m || typeof m !== 'object') return ['manifest must be an object'];
  if (typeof m.id !== 'string' || !ID.test(m.id)) errors.push('id must be lowercase letters/digits/._-');
  if (typeof m.name !== 'string' || !m.name) errors.push('name is required');
  if (typeof m.version !== 'string' || !SEMVER.test(m.version)) errors.push('version must be semver (x.y.z)');
  if (typeof m.description !== 'string') errors.push('description is required');
  if (!EXTENSION_TYPES.includes(m.type)) errors.push(`type must be one of: ${EXTENSION_TYPES.join(', ')}`);
  if (typeof m.apiVersion !== 'string' || !SEMVER.test(m.apiVersion)) errors.push('apiVersion must be semver');
  else if (!isApiCompatible(m.apiVersion)) errors.push(`apiVersion ${m.apiVersion} is not compatible with app API ${API_VERSION}`);
  if (m.dependencies !== undefined && (!Array.isArray(m.dependencies) || m.dependencies.some((d) => typeof d !== 'string'))) errors.push('dependencies must be an array of plugin ids');
  if (m.defaults !== undefined && (typeof m.defaults !== 'object' || m.defaults === null)) errors.push('defaults must be an object');
  if (m.configSchema !== undefined) {
    if (typeof m.configSchema !== 'object' || m.configSchema === null) errors.push('configSchema must be an object');
    else for (const [k, s] of Object.entries(m.configSchema)) {
      if (!s || !['bool', 'number', 'enum', 'string'].includes(s.type)) errors.push(`configSchema.${k}.type must be bool|number|enum|string`);
      if (s && !('default' in s)) errors.push(`configSchema.${k}.default is required`);
    }
  }
  if (m.events !== undefined) {
    const e = m.events;
    if (typeof e !== 'object' || (e.subscribes && !Array.isArray(e.subscribes)) || (e.emits && !Array.isArray(e.emits))) errors.push('events must be { subscribes?: [], emits?: [] }');
  }
  if (m.capabilities !== undefined && !Array.isArray(m.capabilities)) errors.push('capabilities must be an array');
  if (m.performance !== undefined && !['low', 'medium', 'high'].includes(m.performance?.cost)) errors.push('performance.cost must be low|medium|high');
  return errors;
}
