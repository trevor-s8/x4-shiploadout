# X4 Loadout Planner

**An opinionated, goal-oriented ship loadout planner for X4: Foundations 9.0.**

Tell it what you want a ship to *do* — hunt capitals, screen fighters, haul wares across the map — and it generates the loadout, explains every pick, and lets you tweak from there. Covers all 256 ships, fighters through XL logistics, using real extracted 9.0 game data.

**Live demo:** `https://<you>.github.io/<repo>/` *(enable GitHub Pages — see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md))*

## Features

- **Role presets, not stat homework** — 11 playstyle-based roles (Interceptor, Capital Hunter, Sector Trader, Fleet Anchor…) generate a full build for any hull, with a one-line "why" per slot. Deviate from a preset and the slot flags amber with one-click reset.
- **Live fitting** — classic loadout-tool UX: hover any module to preview `current → new` across every derived stat before committing.
- **Honest derived stats** — real top/boost/travel speed from thrust ÷ drag, travel-drive engage/spool/distance, a modeled *100 km sprint* time, heat- and magazine-limited sustained DPS, volley damage, main-pool vs surface shields, and more. Every stat label has an instant tooltip with its formula; modeled indices and dataset gaps are marked, never faked.
- **Role-fit scoring** — every ship scored 0–100 per role against its size class, so the browser can answer "show me the best M-class anti-fighter escorts."
- **Comparison** — up to 4 builds side by side, including two builds of the same ship.
- **Fully customizable brain** — the Roles page exposes every preset's stat weights as sliders. Reweight, invert, add or remove stats, and rescore the whole fleet with *your* doctrine.
- **Shareable builds** — the entire loadout encodes into the URL. No accounts, no backend, no tracking.

## Quick start

```bash
npm install
npm run dev        # develop at localhost:5173
npm run build      # production build -> dist/
```

No Node? Just serve the prebuilt `dist/` folder: `python -m http.server 8080 --directory dist`.

## Documentation

| Doc | What's in it |
|---|---|
| [docs/USER-GUIDE.md](docs/USER-GUIDE.md) | Using the app: fitting, presets, comparing, editing roles, reading stats |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Hosting on GitHub Pages / Cloudflare / Netlify, updating data after game patches |
| [docs/SPEC.md](docs/SPEC.md) | Original design spec: data pipeline, scoring design, validation checklist |

## How it works

**Data:** `scripts/transform_data.py` converts [Mistralys/x4-core](https://github.com/Mistralys/x4-core) (MIT, extracted from game v9.0.0.0) into a single ~27 KB-gzipped `gamedata.json`: 256 ships with real hardpoints and 9.0 jerk-physics fields, 129 engines with full boost/travel models, 107 shields, 252 weapons with magazine-cycle-aware DPS.

**Recommendations:** roles are weighted objectives over derived stats (`src/data/roles.ts`). A greedy optimizer (`src/engine/optimizer.ts`) tries every compatible module per slot and keeps what best serves the weights — so builds are generated, explainable, and stay correct when the dataset updates. Compatibility honors ship-locked gear (Asgard main battery, Astrid engine), Xenon/Kha'ak tech separation, and dedicated missile slots.

**Stack:** React 18 + TypeScript + Vite, zero runtime dependencies beyond React, static hosting anywhere.

## Known dataset gaps & the supplemental system

x4-core's extractor reads only the plain `damage@value` attribute, so flak/ion/distortion damage (stored as explosion or shield/hull-split attributes) and missile projectile stats are absent — shown honestly as "n/a" in-app. **The fix is wired and waiting for values:** fill `data/supplemental/damage-overrides.json` (60 weapon entries) and `data/supplemental/missiles.json` (25 launcher entries), each pre-listed with the weapon name and a per-weapon source URL, then run `npm run data` — it reports fill progress and every filled value flows automatically into DPS stats, role scoring, and the combat evaluator (values display with a ≈ marker). Sources, best first: your own install via XRCatTool (raw values, exact version match), hand-copied v9.0 values from roguey.co.uk (his raw per-shot numbers are fine; his *derived* DPS is self-admittedly shaky — and note his robots.txt disallows automated scraping, so copying is a by-hand job), or an upstream PR teaching x4-core the missing attributes. Remaining gaps: thruster stats (agility is a drag/inertia index), beam ranges, and acceleration (modeled index pending in-game validation of 9.0's undocumented jerk physics).

**Open validation question — beam-cycle weapons:** our extraction treats beam `damageValue` as damage/s (TER M Meson turret ≈ 940 DPS), while Roguey's v9.0 table models beam fire/pause cycles (same turret ≈ 81 DPS) — an 11× disagreement that only an in-game test resolves. Until then, treat Meson/beam turret DPS (and Capital Hunter picks that depend on it) as the least-trusted numbers in the app.

## Validating & contributing

`npx tsx scripts/smoke.ts` checks the optimizer against community-expected picks (Split combat engines win Interceptor, travel engines win Courier, magazine turrets beat alphabetical beams…). The highest-value contributions: in-game speed/DPS spot checks against the ship configurator (target ±1%), supplemental damage-split data, and role-weight tuning PRs with reasoning.

## Attribution

Game data © [Egosoft](https://www.egosoft.com/); extracted via Mistralys/x4-core (MIT). Unofficial fan project, not affiliated with Egosoft.
