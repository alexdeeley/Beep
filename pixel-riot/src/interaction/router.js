// Interaction router: the configurable bridge between gestures and everything else.
//
// The gesture engine only DESCRIBES input. The router looks up the active INTERACTION
// PROFILE (data, not code) and performs its actions: spawn effects, play/sustain/release
// sounds, inject energy, set tempo, emit events. Changing what a tap does means editing a
// profile, never the gesture engine.
//
// Interaction profile contract (API 1.x) — plain JSON-compatible data:
//   {
//     id, name, description?,
//     include?: ['core.base'],          // merge rules from other profiles (after own rules)
//     global?: true,                    // always-on rule set merged into EVERY active profile
//     cycle?: true,                     // offered by the EFFECT button / EFFECT SET chooser
//     rules: [{
//       on: 'tap',                       // gesture type ('tap', 'drag', 'hold:charge'...) or any
//                                        // full bus event name containing ':' that is not a gesture
//                                        // (e.g. 'chain:stage'); gesture names win if both exist
//       when?: {                         // all conditions must hold
//         minSpeed?, maxSpeed?, minPointers?, maxPointers?, pointerType?,
//         region?: { x0, y0, x1, y1 },   // normalized rectangle
//         fields?: { scale: [min, max] } // any numeric/boolean event field range
//         chance?: 0..1
//       },
//       throttle?: seconds,              // per pointer (or per gesture group for multi events)
//       do: [ Action ]
//     }]
//   }
// Actions:
//   { effect: 'id', params?: {...}, key?: 'gesture' | 'group' | 'pointer' | string }
//   { sound: 'id', map?: 'mapping-id', gain?: 0..1 }                    one-shot
//   { sound: 'id', map?, sustain: true, key?: 'gesture' }               start or update a held voice
//   { release: 'gesture' | key, seconds?: 0.35 }                         release held voices
//   { energy: amount, radius?: cells }
//   { tempo: 'rhythm' }                                                  set tempo from a rhythm event (musical mode)
//   { emit: 'custom:event' }
// Param values that are strings beginning with '$' read from the event: '$level', '$scale'.

import { Registry, need } from '../core/registry.js';

export function validateProfile(d) {
  const e = [];
  need.arr(d, 'rules', e);
  if (Array.isArray(d.rules)) d.rules.forEach((r, k) => {
    if (!r || typeof r.on !== 'string') e.push(`rules[${k}].on must be a string`);
    if (!Array.isArray(r?.do)) e.push(`rules[${k}].do must be an array`);
  });
  if (d.include && !Array.isArray(d.include)) e.push('include must be an array');
  return e;
}

export class InteractionRouter {
  constructor({ events, effects, audio, energy, clock, settings, onError }) {
    this.events = events; this.effects = effects; this.audio = audio; this.energy = energy; this.clock = clock; this.settings = settings;
    this.onError = onError || ((err) => events.emit('app:error', { error: err, source: 'interaction router' }));
    this.registry = new Registry('interactions', { events, validate: validateProfile });
    this.activeId = null;
    this._compiled = null;      // Map<eventType, rule[]>
    this._throttle = new Map();
    this.enabled = true;
    this.actionsRun = 0;
    this._offs = [];
    events.on('registry:changed', (e) => { if (e.registry === 'interactions') this._compiled = null; });
  }

  attach() {
    this._offs.push(this.events.on('gesture:*', (ev, type) => this.handle(type.slice(8), ev)));
    this._offs.push(this.events.on('chain:stage', (ev) => this.handle('chain:stage', ev)));
    this._offs.push(this.events.on('effect:discharge', (ev) => this.handle('effect:discharge', ev)));
  }
  detach() { for (const off of this._offs) off(); this._offs = []; }

  setProfile(id) {
    if (!this.registry.has(id)) return false;
    this.activeId = id; this._compiled = null;
    this.events.emit('interaction:changed', { id });
    return true;
  }

  _compile() {
    const map = new Map();
    const seen = new Set();
    const add = (id) => {
      if (seen.has(id)) return; seen.add(id);
      const p = this.registry.get(id); if (!p) return;
      for (const r of p.rules) { if (!map.has(r.on)) map.set(r.on, []); map.get(r.on).push(r); }
      for (const inc of p.include || []) add(inc);
    };
    if (this.activeId) add(this.activeId);
    for (const p of this.registry.list()) if (p.global) add(p.id);
    this._compiled = map;
    return map;
  }

  _match(rule, ev) {
    const w = rule.when; if (!w) return true;
    const sp = ev.speed ?? 0;
    if (w.minSpeed != null && sp < w.minSpeed) return false;
    if (w.maxSpeed != null && sp > w.maxSpeed) return false;
    const n = ev.activePointerCount ?? 1;
    if (w.minPointers != null && n < w.minPointers) return false;
    if (w.maxPointers != null && n > w.maxPointers) return false;
    if (w.pointerType && ev.pointerType !== w.pointerType) return false;
    if (w.region) { const r = w.region; if (ev.x < r.x0 || ev.x > r.x1 || ev.y < r.y0 || ev.y > r.y1) return false; }
    if (w.fields) for (const [k, [a, b]] of Object.entries(w.fields)) { const v = +ev[k]; if (!(v >= a && v <= b)) return false; }
    if (w.chance != null && Math.random() > w.chance) return false;
    return true;
  }

  _key(kind, ev) {
    if (kind === 'gesture') return `g${ev.gestureId}`;
    if (kind === 'group') return `grp${ev.groupId}`;
    if (kind === 'pointer') return `p${ev.pointerId}`;
    return kind;
  }

  _bind(params, ev) {
    if (!params) return {};
    const out = {};
    for (const [k, v] of Object.entries(params)) out[k] = typeof v === 'string' && v[0] === '$' ? ev[v.slice(1)] : v;
    return out;
  }

  handle(type, ev) {
    if (!this.enabled) return;
    const map = this._compiled || this._compile();
    const rules = map.get(type);
    if (!rules) return;
    for (const rule of rules) {
      if (!this._match(rule, ev)) continue;
      if (rule.throttle) {
        const tk = rule.on + '|' + (ev.pointerId >= 0 ? ev.pointerId : ev.groupId ?? 'g') + '|' + rules.indexOf(rule);
        const last = this._throttle.get(tk) ?? -1e9;
        if (this.clock.time - last < rule.throttle) continue;
        this._throttle.set(tk, this.clock.time);
        if (this._throttle.size > 500) this._throttle.clear();
      }
      for (const a of rule.do) {
        try { this._run(a, ev); this.actionsRun++; }
        catch (err) { this.onError(err, a); }
      }
    }
  }

  _run(a, ev) {
    if (a.effect) {
      const key = a.key ? this._key(a.key, ev) : null;
      this.effects.spawn(a.effect, this._bind(a.params, ev), { event: ev, key, x: ev.x, y: ev.y });
    } else if (a.release) {
      this.audio.release(this._key(a.release, ev), a.seconds ?? 0.35);
    } else if (a.sound) {
      const m = this.audio.map(a.map || 'position-pitch', ev);
      if (a.gain != null) m.gain = (m.gain ?? 0.5) * a.gain;
      if (a.sustain) this.audio.sustain(a.sound, m, this._key(a.key || 'gesture', ev));
      else this.audio.play(a.sound, m);
    } else if (a.energy != null) {
      this.energy.inject(ev.fx ?? ev.x * this.energy.grid.cols, ev.fy ?? ev.y * this.energy.grid.rows, a.energy, a.radius ?? 1.5);
    } else if (a.tempo === 'rhythm') {
      if (ev.bpm && this.settings.get('music.enabled')) this.settings.set('music.tempo', ev.bpm);
    } else if (a.emit) {
      this.events.emit(a.emit, ev);
    }
  }
}
