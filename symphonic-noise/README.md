# Symphonic Noise

A generative wall of orchestral-style sound for study or art. Chords drift
and crossfade forever from a fixed consonant scale — nothing loops, nothing
repeats the same way twice.

This is Phase 1: a single generative pad voice, play/stop, and volume. See
the project plan for what's next (more layered voices, macro controls for
density/brightness/tension, effects polish, reactive visuals, presets).

## Running it locally

This is a plain static PWA (no build step), but it must be served over
`http://` — not opened directly as a `file://` URL — because it registers a
service worker and uses an ES module script. From this folder:

```bash
npx serve .
# or
python3 -m http.server 8080
```

Then open the printed local URL in a browser and click **Begin** (audio
can't start until a user gesture, per browser autoplay policy).

## Third-party code

`lib/Tone.js` is vendored from [Tone.js](https://tonejs.github.io/) v14.8.49
(MIT licensed) so the app has no external CDN dependency and works fully
offline once installed.

## Deployment (GitHub Pages)

This folder is one app in the repo's shared app gallery — see the root
`README.md` and `apps.json` for how the overall site is deployed. Live at
(once the repo is renamed from `Beep` to `Site` — see the root README):

```
https://alexdeeley.github.io/Site/symphonic-noise/
```
