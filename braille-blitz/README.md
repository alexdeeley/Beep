# Braille Blitz

A mobile-first game for learning to read Braille letters and numbers, live at
**https://braille.deeley.org**. One big six-dot cell, three enormous answer
buttons, instant feedback, and statistics that remember what you find hard.
Pure black and white, bold Helvetica, no decoration, built for low vision.

## How it is put together

Everything is static: no server, no account. Progress lives in the browser's
local storage, and the service worker keeps the whole game available offline
after the first visit.

| File | What it does |
|---|---|
| `public/js/braille.js` | The data: cells for a-z, the number sign (dots 3-4-5-6), the digit-to-letter reuse (1-9, 0 = a-j), Unicode helpers, dot labels for screen readers. |
| `public/js/game.js` | The rules: which character to ask, which wrong answers to offer, the growing letters pool, review queues, milestones, one answer per question. |
| `public/js/stats.js` | Memory: totals, streaks, time, per-character accuracy, recent answers, and the mastery rule. |
| `public/js/audio.js` | Settings, synthesised sounds (Web Audio), vibration (Vibration API, where it exists), speech for Practice by Touch. |
| `public/js/a11y.js` | The live region, keyboard handling, reduced-motion check, focus management. |
| `public/js/app.js` | Presentation: screens, SVG cells, answer buttons, feedback, statistics and settings pages. |
| `public/sw.js` | Offline cache of the app shell. |

### Modes

- **Letters.** Starts with a-f. Three more letters unlock each time every letter so far has been seen twice with at least 75% accuracy over the group. Missed letters come up more often; mastered ones less.
- **Numbers.** Every digit is shown as the number sign followed by its cell, because that is how literary Braille writes numbers: digits have no cells of their own, they reuse a-j. **Numbers in context** (advanced) asks for two- and three-digit numbers after a single number sign, with near-miss answers.
- **Mixed Practice.** Letters and numbers together; every prompt says which it wants. Wrong answers get more lookalike as recent accuracy rises.
- **Review Mistakes.** Only characters that have been missed and are not yet mastered, until they are.
- **Practice by Touch.** The game names a character (and reads it aloud if speech is on); the player picks its cell from three.

### Mastery

A character is mastered after at least 5 correct answers in total and at least
9 of its last 10 attempts right (`MASTERY` in `stats.js`). The statistics
screen states this rule in plain words. The "path" on the home screen is
derived from the same numbers and never locks anything.

### Accessibility

- Black background, white text, yellow accent; raised dots are large solid discs, empty positions small hollow rings, so shape and size carry the meaning, not colour.
- Every tap target is at least 64 CSS pixels; answer buttons are 96px or taller.
- Each cell is described to screen readers by its raised dots ("cell with dots 1, 3 and 5 raised"), never by its answer. Results are announced through a live region.
- Keyboard: 1/2/3 pick an answer, a letter or digit key picks a matching answer, arrows move, Enter picks, P pauses, Escape goes back.
- `prefers-reduced-motion` turns off the few transitions there are.
- Sound and vibration are never the only signal: every result is also text and colour. Vibration is shown as unavailable on browsers without the Vibration API (iOS Safari), rather than promised.

## Running and testing

```sh
npm install
npm test            # Node tests: the Braille tables against the Unicode reference, stats, game rules
npm run test:browser   # Playwright: plays every mode on phone, tablet and desktop sizes (screenshots in dev/shots)
npm run dev         # local preview with wrangler
```

## Deploying to braille.deeley.org

The site is a Cloudflare static-assets Worker (`wrangler.jsonc`) with a custom
domain. Either:

- **GitHub Actions:** run the *Deploy Cloudflare Workers* workflow with the
  `braille-blitz` option (it needs the `CLOUDFLARE_API` and
  `CLOUDFLARE_ACCOUNT_ID` repository secrets, like the other apps), or
- **By hand:** with a Cloudflare API token in `CLOUDFLARE_API_TOKEN`, run
  `npm run deploy` in this folder. Wrangler creates the `braille.deeley.org`
  DNS record and certificate on the first deploy.

After a change to the files in `public/`, bump `VERSION` in `public/sw.js` so
browsers that cached the old build pick up the new one.
