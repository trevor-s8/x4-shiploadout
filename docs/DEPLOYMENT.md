# Deployment Guide

The app is a fully static site (HTML + JS + one 300 KB JSON). Anything that serves files can host it; there is no backend, database, or server cost anywhere in this guide.

## Option A — GitHub Pages (recommended, free, already wired up)

1. Create a GitHub repository and push this folder:
   ```bash
   git init && git add -A && git commit -m "X4 Loadout Planner"
   git branch -M main
   git remote add origin https://github.com/<you>/<repo>.git
   git push -u origin main
   ```
2. In the repo: **Settings → Pages → Source: GitHub Actions**.
3. Done. The included `.github/workflows/deploy.yml` builds and deploys on every push to `main`. Your site: `https://<you>.github.io/<repo>/`.

The Vite config uses `base: './'`, so the app works on any subpath without changes. Share links, saved builds, and role overrides all work — they're client-side.

**Custom domain (optional):** buy a domain (~$10/yr), add it under Settings → Pages, create the CNAME record at your registrar. GitHub provisions HTTPS automatically.

## Option B — Cloudflare Pages (free, best for higher traffic)

Unmetered bandwidth on the free tier, global CDN, and slightly faster cold loads than GitHub Pages.

1. Push the repo to GitHub (as above).
2. Cloudflare dashboard → Workers & Pages → Create → Pages → connect the repo.
3. Build settings: framework **Vite**, build command `npm run build`, output directory `dist`.
4. Every push deploys; pull requests get preview URLs automatically (nice for testing role-weight changes with your community).

## Option C — Netlify / Vercel (free tiers)

Same flow as Cloudflare: connect repo, build command `npm run build`, publish directory `dist`. Free tiers cap bandwidth (Netlify 100 GB/mo, Vercel 100 GB/mo) — far more than a small community will use (~0.1 MB gzipped per first visit).

## Option D — Drag-and-drop / no-git hosting

Run `npm run build` locally, then upload the `dist/` folder contents to: Netlify Drop (drag the folder onto app.netlify.com/drop), itch.io (as an HTML project, if your community lives there), or any shared web host / VPS you already have (copy `dist/` to the web root; no server config needed beyond serving static files).

## Updating after a game patch

When Egosoft ships 9.1/10.0 and Mistralys/x4-core publishes a matching release:

```bash
git -C ../x4-core pull          # or clone the tagged release
npm run data                    # regenerate public/data/gamedata.json
npx tsx scripts/smoke.ts        # sanity: expected picks still expected
git commit -am "Data: game vX.Y" && git push   # auto-deploys
```

If x4-core lags behind a patch, check its releases page first — its changelog states the exact game version each release was extracted from. Don't mix versions.

## Operational notes

- **Bandwidth math:** first visit ≈ 90 KB gzipped (app + data), cached afterward. Even 10,000 visits/month ≈ 1 GB — free everywhere above.
- **No analytics/telemetry included.** If you want visit counts, Cloudflare's free Web Analytics is a one-line script and cookie-free.
- **Community builds:** share links encode the entire build in the URL — pin good ones in your Discord. No accounts or storage needed.
- **Forks:** MIT-licensed data source; keep the footer attribution to Mistralys/x4-core and Egosoft.
