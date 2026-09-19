// The one place that knows every instrument exists. Adding instrument #3
// (or #20) means adding one import and one entry here - nothing else in
// the app (library, workspace, panel, mixer) ever names an instrument by
// id in conditional logic. That's the whole point: the workspace talks to
// the shared instrument contract, not to "the drum machine" or "the 303"
// specifically.
import * as drumMachine from "../modules/drum-machine/index.js";
import * as acid303 from "../modules/acid303/index.js";
import * as elastic from "../modules/elastic/index.js";
import * as shard from "../modules/shard/index.js";
import * as orbit from "../modules/orbit/index.js";
import * as wire from "../modules/wire/index.js";
import * as melt from "../modules/melt/index.js";
import * as choirZero from "../modules/choir-zero/index.js";
import * as magnet from "../modules/magnet/index.js";
import * as fold from "../modules/fold/index.js";
import * as rain from "../modules/rain/index.js";
import * as motor from "../modules/motor/index.js";
import * as hollow from "../modules/hollow/index.js";
import * as scatter from "../modules/scatter/index.js";
import * as depth from "../modules/depth/index.js";
import * as phaseGarden from "../modules/phase-garden/index.js";
import * as staticNoise from "../modules/static/index.js";
import * as mirror from "../modules/mirror/index.js";
import * as bloom from "../modules/bloom/index.js";
import * as crater from "../modules/crater/index.js";

const REGISTRY = [
  drumMachine, acid303,
  elastic, shard, orbit, wire, melt, choirZero, magnet, fold, rain,
  motor, hollow, scatter, depth, phaseGarden, staticNoise, mirror, bloom, crater,
];

// Required manifest fields every module must export (documented, not
// enforced at runtime - a missing field just shows up blank in the UI
// rather than crashing the registry for every other instrument).
//   id, name, shortName, description, category, tags, version, icon,
//   supportsSequencer, supportsLivePlay, supportsEffects, supportsTempo,
//   polyphony, defaultWidth, defaultHeight, minimumWidth, minimumHeight

export function listInstruments() {
  return REGISTRY.map((m) => m.manifest);
}

export function getManifest(id) {
  return REGISTRY.find((m) => m.manifest.id === id)?.manifest ?? null;
}

export function listCategories() {
  return [...new Set(REGISTRY.map((m) => m.manifest.category))];
}

// ctx: the shared AudioContext (see core/audio-engine.js). Returns a fresh
// instance implementing the shared instrument contract:
//   mount(container) / unmount()
//   start() / stop()               -- sequencer playback, synced to the
//                                      shared transport; no-op for
//                                      live-only instruments
//   getAudioOutput()               -- AudioNode to route into the mixer
//   setEffectAmount(kind, amount)  -- kind: 'distortion' | 'delay' | 'reverb'
//   serialize() / restore(state)   -- plain JSON, no audio nodes
//   dispose()
export function createInstance(id, ctx) {
  const entry = REGISTRY.find((m) => m.manifest.id === id);
  if (!entry) throw new Error(`Unknown instrument id: ${id}`);
  return entry.create(ctx);
}
