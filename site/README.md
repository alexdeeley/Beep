# deeley.org on Cloudflare

The main site is plain files in the repository root. This folder deploys
them to Cloudflare as a static-assets Worker on the route `deeley.org/*`,
so pages come straight from Cloudflare's edge instead of being fetched
from GitHub Pages on every visit (which had been stalling).

- `build.mjs` copies the root into `dist/`, skipping sources, tooling and
  the apps that live on their own subdomains (`draw`, `duel`, `soliteam`,
  `gallery`). Anything else dropped in the root is published, as before.
- `wrangler.jsonc` serves `dist/` on `deeley.org/*`. It is a route, not a
  custom domain, so the DNS record is untouched: delete the route in the
  Cloudflare dashboard and the site falls back to GitHub Pages at once.
- `.github/workflows/deploy-site.yml` deploys on every push to `main`
  (and by hand from the Actions tab). GitHub Pages keeps publishing too,
  as the fallback.

Locally: `npm install`, then `npm run dev` for a preview or `npm run
deploy` with a Cloudflare token in `CLOUDFLARE_API_TOKEN`.
