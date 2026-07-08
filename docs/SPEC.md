# X4: Foundations 9.0 Loadout Planner — Coding Agent Build Specification

## 1. Project overview

Build a static, client-side web application for planning ship loadouts in **X4: Foundations, game version 9.0** ("Empire Update"). The app works like a classic video-game loadout tool: the user picks a ship, sees its equipment slots, fills them with modules, and watches derived stats update live. On top of that, the app is **opinionated**: every ship ships with curated, role-based **prebuilt builds** (e.g., "Sniper Platform," "Close Brawler," "Travel Courier") that the user can apply with one click and then tweak manually.

Design goals, in priority order:

1. **Goal-oriented, not stat-encyclopedic.** Users express intent ("I want this destroyer to snipe from range") via role presets; the tool translates intent into module choices. Raw stats remain fully visible for users who want them.
2. **Accurate 9.0 data.** All stats come from extracted game data (source below), including the new 9.0 jerk-based flight physics fields.
3. **Full coverage.** Every ship class S/M/L/XL and every role: combat, trade/logistics, mining, exploration, carriers, auxiliaries.
4. **Comparison-first analysis.** Side-by-side loadout comparison with derived stats (real top speed, travel spool time, effective HP, DPS, etc.).
5. **No artificial constraints.** No budget or DLC gating — show everything (a DLC *badge* for provenance is fine; a *filter* is not required).

Reference for overall product feel (clean, data-driven, static SPA): https://suurflieg.github.io/x4-production-planner/ — match its level of polish, not its visual identity.

---

## 2. Data source and pipeline

### 2.1 Primary source: Mistralys/x4-core

Repository: `https://github.com/Mistralys/x4-core` (MIT license — safe to vendor the data with attribution).

Use the **v1.4.0 release or later**. The v1.4.0 changelog states: "Game Update v9 … Game version v9.0.0.0 … Updated all game data files." Do **not** use main-branch snapshots older than this release.

Relevant files under `data/`:

| File | Count (v1.4.0) | Contents |
|---|---|---|
| `ships.json` | 256 ships | hull, mass, drag (fwd/rev/horiz/vert/pitch/yaw/roll), inertia, 24 jerk-physics fields (`jerkForwardAccel`, `jerkTravelAccel`, `jerkBoostRatio`, …), `accFactor*`, crew (`people`), `storageMissile`, `cargoCapacity`, `cargoType`, `classID`, `slots` (counts per hardpoint type), `equipment` (per-hardpoint size/count/tags incl. turret groups, docks, countermeasures), `usedBy`, `builderFactionIDs`, `variants` |
| `engines.json` | 129 engines | `thrustForward`, `thrustReverse`, boost model (`boostThrust` multiplier, `boostDuration`, `boostRecharge`, `boostAcceleration`, `boostAttack`, `boostRelease`, `boostCoast`), travel model (`travelCharge`, `travelThrust` multiplier, `travelAttack`, `travelRelease`), `decelerationCurve`, `hullMax`, `size`, `mk`, `makerRaces` |
| `shields.json` | 107 shields | `rechargeMax` (capacity), `rechargeRate`, `rechargeDelay`, `hullMax`, `hullIntegrated`, `shieldType`, `size`, `mk`, `makerRaces` |
| `weapons.json` | 257 items | main guns, turrets (`turret_shortrange/midrange/longrange`), missile launchers (`missile_dumbfire/guided`), torpedoes, bombs, mining and repair weapons. Fields: `damageValue`, `repairValue`, `reloadRate`, `heatPerShot`, `heatOverheat`, `heatCoolrate`, `heatCooldelay`, `heatReenable`, `bulletSpeed`, `bulletRange`, `bulletLifetime`, `bulletAmount`, `bulletBarrelamount`, `bulletTimediff`, `bulletAngle`, `bulletMaxhits`, `bulletRicochet`, `rotationSpeed`, `rotationAcceleration`, `ammoValue`, `ammoReload`, `weaponSystem`, `weaponCategory`, `bulletClass` |
| `factions.json`, `wares.json`, `lang-044-en_EN.json` | — | faction labels, ware groups/tags, English strings |

Equipment↔ship compatibility is derivable: each ship's `equipment` entries carry `size` + `tags`; each module carries `size` and (via `wares.json`) tags. Match on size and tag intersection (e.g., ships whose weapon hardpoint is tagged `arg_destroyer_01` accept only the Behemoth main battery family; `standard`-tagged slots accept faction-generic modules of matching size).

### 2.2 Known gaps in x4-core and how to handle them

1. **Damage is flattened to a single `damageValue`.** Raw game data splits bullet damage into `value` / `shield` / `hull` (+ repair). Anti-shield weapons (Ion Blaster family) and hull-biased weapons are misrepresented by a single number.
   - *Mitigation:* add a supplemental table `data/supplemental/damage-splits.json` keyed by `bulletClass` for weapons where shield/hull damage differ from `damageValue`. Populate from the game's `assets/props/WeaponSystems/**/*bullet*.xml` macros (see §2.3), or ship an initial hand-curated table for the known split-damage families (ion, plasma, proton barrage, etc.) with a `TODO: verify` flag surfaced in the UI as an asterisk.
2. **Thrusters are not extracted** (they exist in `wares.json` as ~18 wares but have no stats file). Thrusters drive strafe and contribute to pitch/yaw response.
   - *Mitigation:* same supplemental approach: `data/supplemental/thrusters.json` with `thrustStrafe`, `thrustPitch`, `thrustYaw`, `thrustRoll` per thruster macro, parsed from `assets/props/Engines/*thruster*` macros. Until populated, compute turn rates from ship drag/inertia only and label them "engine-independent estimate."
3. **Missile ammo stats are missing** (launchers reference `bulletClass` missile macros, but missile damage/speed/range/agility aren't in the dump).
   - *Mitigation:* `data/supplemental/missiles.json` keyed by missile macro. Until populated, show launcher ammo capacity/reload and mark missile DPS "requires ammo data."
4. **No prices.** Irrelevant — the app has no budget constraints. Do not build cost features.

The app must run fully with gaps unpopulated (graceful "data pending" badges), and automatically use supplemental data when present.

### 2.3 If the user supplies a raw game dump (optional enhancement path)

The user can extract raw XML with **XRCatTool** ("X Tools" in the Steam tools library) by unpacking `01.cat…NN.cat` plus each DLC's catalogs. Files that matter: `libraries/wares.xml`, `assets/props/Engines/macros/*.xml`, `assets/props/SurfaceElements/macros/*.xml` (shields), `assets/props/WeaponSystems/**/macros/*.xml` (weapons + bullets + missiles), `assets/units/size_*/macros/*.xml` (ships). Write the supplemental extractor as a standalone Node script `scripts/extract-supplemental.mjs` that takes `--x4-root <unpacked dir>` and emits the three supplemental JSON files. Keep it optional; never make the build depend on game files.

### 2.4 Build-time transform

Do **not** ship x4-core JSON verbatim. Add a build step `scripts/transform-data.mjs` that:

- Joins ships + equipment + wares + English labels into one normalized `public/data/gamedata.json` (or code-split per category if >2 MB gzipped).
- Precomputes each module's per-slot compatibility tags and each ship's accepted-module lists (ID arrays), so the client never does tag matching at runtime.
- Precomputes per-ship invariants (e.g., `dragForward`, slot layouts) but leaves loadout-dependent math to the client.
- Embeds `gameVersion: "9.0.0.0"`, `sourceCommit`, and `extractedAt` metadata shown in the app footer.
- Validates against a JSON Schema and fails the build on missing fields — this is the guard against silently-breaking upstream updates.

---

## 3. Derived-stat engine (the math)

Implement as a pure, unit-tested TypeScript module `src/engine/derive.ts`. Inputs: ship record + loadout (map of slot → module). Outputs: the stat block below. All formulas must be validated against the in-game Encyclopedia/ship-config screen for a sample of ships (see §8).

**Mobility**

- Forward speed: `speed = Σ(engine.thrustForward) / ship.dragForward` (m/s).
- Boost speed: `speed × engine.boostThrust` (boost multiplies thrust). Also surface `boostDuration`, `boostRecharge`, and spool (`boostAttack`/`boostRelease`).
- Travel speed: `speed × engine.travelThrust`.
- **Travel spool time** (a headline stat per the user's core example): `travelCharge + travelAttack` shown as "time to full travel speed," with `travelCharge` alone shown as "time to engage." This is exactly the "instant travel vs. better acceleration" tradeoff — e.g., ARG all-round L: charge 18 s, attack 91 s; other families differ dramatically. Also compute **time-to-cross-X-km** (default 100 km, user adjustable): integrate charge → ramp (assume linear ramp over `travelAttack`) → cruise. This single number makes engine tradeoffs directly comparable for logistics.
- Acceleration: base `Σthrust / mass`, modulated by 9.0 jerk fields. The exact 9.0 jerk integration isn't publicly documented; present acceleration as a **relative index** computed as `(Σthrust / mass) × accFactorForward` and expose `jerkForwardAccel`/`jerkTravelAccel` as "responsiveness" sub-stats (higher = snappier ramp). Label the index as modeled, not measured, until validated in-game.
- Turn rates: `pitch/yaw ≈ k × thrusterThrust / (drag_axis × inertia_axis)` when thruster data exists; otherwise a drag/inertia-only relative index. Strafe likewise.

**Defense**

- Shield capacity: Σ`rechargeMax` across filled shield slots; regen: Σ`rechargeRate`; delay: max(`rechargeDelay`).
- **Effective HP**: `hull + shieldCapacity`, plus a sustained-fight variant `hull + shield + rechargeRate × T` (T = 60 s default).
- Note in tooltips: 9.0 interrupts shield regen under sustained fire, so recharge delay weighs heavier than pre-9.0 metas assumed.

**Offense** (compute separately for main guns, turrets by group, and missiles)

- Burst DPS per weapon: for projectile weapons, `damageValue × bulletAmount × bulletBarrelamount × reloadRate` (validate whether `reloadRate` is shots/s or s/shot against in-game figures during §8 validation; the transform should normalize to shots/s). For beams (`reloadRate = 0`, continuous), treat `damageValue` as damage/s.
- Sustained DPS: burst × heat duty cycle, `duty = min(1, heatCoolrate / (heatPerShot × fireRate))` with overheat lockout (`heatReenable`) modeled; weapons with no heat have duty 1.
- Shield-DPS / Hull-DPS variants when supplemental damage splits exist.
- Range (`bulletSpeed × bulletLifetime`, or `bulletRange`), projectile speed, and turret tracking (`rotationSpeed`) — surfaced prominently because 9.0's smarter evasive AI makes projectile speed/tracking matter more than raw DPS against small targets.
- Aggregate: total forward DPS (main guns), total turret DPS with per-arc breakdown if `equipment` tags allow, anti-fighter score (see §4).

**Utility**: cargo capacity/type, crew, missile/countermeasure storage, docking capacity, drone capacity if present.

Every derived stat gets a tooltip explaining the formula and its inputs — this is part of the "opinionated but transparent" identity.

---

## 4. Role presets and prebuilt builds

### 4.1 Architecture: data-driven scoring, not hardcoded builds

Roles are defined declaratively in `src/data/roles.ts` as weighted objectives over derived stats. A generic optimizer applies a role to any ship: for each slot, score every compatible module by the weighted delta it produces in the ship's derived stats, pick the best, and iterate (greedy per-slot is sufficient; slots are nearly independent in X4 — engines are the only all-or-nothing group since ships use one engine type across all engine slots; shields on multi-slot ships may mix but default to uniform).

This means prebuilt builds are **generated, reproducible, and automatically correct after data updates** — no hand-maintained build lists. Hand overrides are still possible via `src/data/build-overrides.ts` for cases where community meta disagrees with the scorer.

### 4.2 Role definitions (initial set with weight guidance)

Weights are relative (normalize per role). Tune during §8 validation; these encode 9.0-era community consensus:

| Role | Primary weights | Secondary | Notes |
|---|---|---|---|
| **Interceptor / Fast Attack** | top speed .30, boost speed .20, projectile speed .15 | accel/responsiveness .15, burst DPS .10, turn .10 | Split combat engines typical winner; 9.0 AI dodges → projectile speed matters |
| **Close Brawler / Heavy Fighter** | sustained DPS .30, effective HP .25 | shield regen .15, turn .15, speed .15 | shotgun/short-range weapons score via DPS at <2 km band |
| **Sniper Platform** | weapon range .35, alpha damage .25 | projectile speed .15, travel spool .10, speed .15 | plasma/railgun-family mains; L destroyers: main battery range dominates |
| **Anti-Fighter Escort** | turret tracking .25, turret sustained DPS .25, projectile speed .20 | shield regen .15, speed .15 | flak/bolt turrets; tracking weighted up due to 9.0 evasion AI |
| **Capital Killer** | hull-DPS vs large .35 (fallback: sustained DPS), alpha .20 | range .15, effective HP .20, speed .10 | torpedoes/plasma; needs damage-split data for full fidelity |
| **Tank / Line Holder** | effective HP .35, shield regen .25 | sustained DPS .20, recharge delay (lower better) .10, hull .10 | TEL/TER shields typical |
| **Travel Courier / Trader** | time-to-cross-100 km .40, cargo .30 | travel engage time .15, top speed .15 | the engine-tradeoff showcase role; per-distance toggle |
| **Local Hauler** | cargo .40, top speed .25, accel .20 | travel spool .15 | short-hop station logistics; travel drive barely matters |
| **Miner** | cargo .35, mining DPS .20, top speed .20 | turret anti-fighter .15, effective HP .10 | |
| **Explorer / Scout** | travel speed .30, time-to-engage travel .25, boost .15 | top speed .15, effective HP .15 | instant-spool engines win here even with worse cruise |
| **Carrier / Fleet Ops** | dock capacity display, turret coverage .30, effective HP .30, turret tracking .20 | speed .20 | applies to L/XL only |

### 4.3 Per-ship build surfacing

On a ship's page, show its **top 3–5 role builds ranked by role-fit score** — how well the ship's best build for a role scores against the best-in-class ship for that role (normalize 0–100). This directly implements the user's requirement that "some ships might do both offense and defense well, or sniper platform vs up close": a Behemoth shows *Sniper Platform 92 / Line Holder 74 / Capital Killer 71*, while an Eclipse shows *Brawler 88 / Interceptor 61*. Roles below a fit threshold (e.g., 40) collapse under "other roles." Each applied build lists a one-line **why** per chosen module generated from the scorer's top contributing stat (e.g., "SPL Combat Mk3: +34% top speed, best-in-slot projectile alignment window"), satisfying transparency without a wizard.

---

## 5. UI specification

Single-page app, three primary views. Typical-loadout-tool interaction model throughout: click slot → picker opens → stats update live with green/red deltas.

### 5.1 Ship Browser (home)

- Filterable, sortable grid/table of all 256 ships: filters for size (S/M/L/XL), class (`classID`: fighter, corvette, frigate, destroyer, carrier, freighter, miner, builder, auxiliary…), faction (`builderFactionIDs`), and **role-fit** ("show me good sniper platforms" — sorts by precomputed role-fit score).
- Each card: ship name, class/size/faction badges, thumbnail (optional, see §7), top 3 role-fit chips, and 3 headline stats (stock-build speed, effective HP, DPS).

### 5.2 Fitting Screen (core view)

- **Left:** slot rack grouped by hardpoint type (Engines ×3, Shields L ×3 + M ×9, Turrets, Main Weapons, Thruster, Software placeholder). Engine slots gang-select (one engine type fills all). Turret groups fill by group with an "individual" override toggle.
- **Center:** module picker with size/faction/mk filters and per-module stat mini-cards; sort by any stat or by "role score" for the active role.
- **Right:** live derived-stat panel (all §3 stats, grouped Mobility / Defense / Offense / Utility), each with delta-vs-previous and delta-vs-stock, formula tooltips, and the raw-stat table behind a "Raw data" expander (satisfies "raw stats" requirement).
- **Top bar:** role preset dropdown (applies generated build; user then tweaks freely — edits never snap back), reset-to-stock, copy-share-URL, "add to comparison."
- Loadout state serialized into the URL (compact base64 of ship ID + module IDs) and localStorage for saved builds. No backend.

### 5.3 Comparison View

- 2–4 columns of (ship + loadout) side by side; add from fitting screen or pick saved builds.
- Rows = derived stats with best-in-row highlighting; toggle absolute vs %-of-best; sparkline-style bars for scannability.
- Supports comparing two different loadouts of the *same* ship (sniper Behemoth vs brawler Behemoth) — treat builds, not ships, as the comparison unit.

### 5.4 Visual design direction

Follow a deliberate identity, not a dashboard template: dark, instrument-panel aesthetic grounded in X4's ship-computer UI language (near-black blue-greys, one signature accent drawn from the game's HUD teal/amber family, monospaced or semi-mono numerals for stat columns, a characterful display face for ship names). One signature element: the live stat panel styled as a ship readout with animated delta ticks. Keep everything else quiet and disciplined; responsive to mobile; visible keyboard focus; respect reduced-motion. Avoid generic AI-design defaults (cream + serif + terracotta, or black + acid green).

---

## 6. Tech stack

- **React 18 + TypeScript + Vite**, deployed to **GitHub Pages** via Actions (mirrors the reference production planner's approach; zero backend).
- State: Zustand (small, URL-serializable). Routing: react-router with hash routing for Pages compatibility.
- Styling: Tailwind or CSS modules — agent's choice, but implement the §5.4 token system either way.
- Data: static JSON under `public/data/`, fetched once, cached in memory; all scoring/derivation client-side and memoized.
- Tests: Vitest for `derive.ts` and the role scorer (golden-file tests against hand-verified in-game numbers).
- Repo layout: `scripts/` (transform + optional extractor), `src/engine/`, `src/data/` (roles, overrides), `src/views/`, `public/data/`.

## 7. Explicit non-goals / deferrals

- No budget/cost features, no DLC gating (badges only), no crew-skill or ware-consumable modeling in v1, no ship 3D/thumbnails required for v1 (nice-to-have via game-asset extraction later), no fleet-level planning in v1 (comparison view covers the near-term need), no mod support.

## 8. Validation checklist (required before "done")

1. For ≥10 ships spanning S/M/L/XL and ≥4 factions, compare computed forward/boost/travel speed against the in-game ship configurator — must match within 1% (resolves the `reloadRate` unit question and thrust/drag formula in one pass).
2. Verify travel spool numbers qualitatively: engine families known for instant engage (short `travelCharge`) vs strong cruise ramp must rank as the community expects.
3. DPS spot-check ≥6 weapons (one beam, one projectile main, one flak turret, one L plasma turret, one missile launcher, one mining laser) against in-game encyclopedia DPS.
4. Role scorer sanity: Split combat engines should win Interceptor on most S hulls; TEL/TER shields should win Tank; a courier role on an M freighter must not pick a combat engine with terrible travel stats.
5. Bundle size < 3 MB gzipped; first meaningful paint < 2 s on mid-range mobile; all views usable at 380 px width.
6. Footer displays game version 9.0.0.0 + data source commit + MIT attribution to Mistralys/x4-core.
