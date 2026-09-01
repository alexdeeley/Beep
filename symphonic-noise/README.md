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

`.github/workflows/deploy-symphonic-noise.yml` publishes this folder to
GitHub Pages automatically on every push to `main` that touches
`symphonic-noise/`, and can also be run manually from the Actions tab.

**One-time setup** (repo owner, done once in the GitHub UI — GitHub does
not allow a workflow's token to create a Pages site via API, so this genuinely
can't be automated): go to **Settings → Pages** and set **Source** to
**GitHub Actions**. After that, every push to `main` redeploys automatically.

Once enabled, the app is live at:

```
https://alexdeeley.github.io/Beep/
```

(GitHub Pages serves this at the repo's Pages URL because the workflow
uploads the `symphonic-noise/` folder itself as the site root — every path
in `index.html`, `manifest.json`, and `sw.js` is relative, so it works
whether the site is served from a root domain or a `/Beep/` subpath.)
