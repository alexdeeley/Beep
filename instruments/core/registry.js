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
import * as piano from "../modules/piano/index.js";
import * as accordion from "../modules/accordion/index.js";
import * as kit909 from "../modules/kit-909/index.js";
import * as kit808 from "../modules/kit-808/index.js";
import * as kit707 from "../modules/kit-707/index.js";
import * as acidChoke from "../modules/acid-choke/index.js";
import * as percOdd from "../modules/perc-odd/index.js";
import * as noiseWall from "../modules/noise-wall/index.js";
import * as formula from "../modules/formula/index.js";
import * as playground from "../modules/playground/index.js";
import * as boom808 from "../modules/boom-808/index.js";
import * as deepSynth from "../modules/deep-synth/index.js";
import * as pureTone from "../modules/pure-tone/index.js";
import * as pulseBass from "../modules/pulse-bass/index.js";
import * as realKit from "../modules/real-kit/index.js";

const REGISTRY = [
  drumMachine, acid303,
  elastic, shard, orbit, melt, choirZero, magnet, fold, rain,
  motor, hollow, scatter, depth, phaseGarden, staticNoise, mirror, bloom, crater,
  piano, kit909, kit808, kit707, acidChoke, percOdd, noiseWall,
  formula, playground, accordion, boom808, deepSynth, pureTone, pulseBass, realKit,
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
