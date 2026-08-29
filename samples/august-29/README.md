# Sample output: August 29

This is checked-in sample output from the bundled test fixture, generated with:

```bash
npm run daily -- --date 2026-08-29 --dry-run --fixture
```

- `infographic.png` — the final 1080×1350 rendered graphic (default `classic_gold` theme)
- `caption.txt` — the generated Instagram caption
- `selected.json` — the final, fully-sourced selected content that produced the graphic
- `qa.json` — the automated QA report for this render (status: PASS)
- `run.json` — the stage-by-stage run summary

Per the project spec, this fixture data (`tests/fixtures/aug29/`) is a
**test fixture only** — hand-assembled to exercise the pipeline end-to-end
without requiring an OpenAI API key. It is never used by the production
daily pipeline, which always performs live research and independent
verification for the actual current date. See `README.md` §4 for how to
reproduce this run yourself.
