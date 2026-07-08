# X4 Loadout Planner — User Guide

A goal-oriented loadout planner for X4: Foundations 9.0. You tell it what you want a ship to *do*; it tells you what to bolt on — then gets out of your way while you tweak.

## The four pages

**Ships** — browse all 256 hulls. Filter by size (S/M/L/XL), class, faction, or search by name. The dropdown on the right sorts by role fit: pick "Best: Capital Hunter" to rank every ship by how well its best possible loadout does that job. Each card shows the ship's top role chips (hover one for what the role means; the number is explained below).

**Compare** — up to four builds side by side. Add builds from the fitting screen with **+ Compare**. Best value in each row glows teal; the "% of best" toggle shows relative gaps. You can compare two different builds of the *same* ship — sniper Behemoth vs brawler Behemoth is a legitimate matchup.

**Combat** — the loadout evaluator: pit two builds against each other with ship-count multipliers (20 bombers vs 1 Asgard), toggle between in-sector and out-of-sector estimation, and read time-to-kill, first-kill times, and each side's per-weapon hit/evasion table.

**Roles** — what each preset means in actual play, and the editor for changing how presets think (see "Editing roles" below).

**Saved** — your local build library, plus import/export (see "Saving & moving your data").

## Fitting a ship

Click any ship to open the fitting screen.

- **Left: slot rack**, grouped Engines / Weapons / Turrets / Shields the way the in-game ship configurator does. Click a slot group to load its options. Engine slots gang-fill (X4 ships run one engine type); turret groups fill as a set.
- **Middle: module picker.** Search, filter by maker race, and sort by the stats that matter for that slot type (thrust, travel ×, engage time for engines; capacity/regen/delay for shields; sustained DPS, range, shot speed, tracking for guns). Every module shows a labeled stat grid so you can scan down a column.
- **Right: the readout.** Hover any module to preview it — changed stats show `current → new`, green when the swap helps, red when it hurts, teal-neutral when you're filling an empty slot (having engines at all is not a downgrade). Click to commit. Hover any stat label for its exact formula; the **↓** glyph marks stats where lower is better.

**Role presets:** the dropdown (or the score chips under the ship name) applies a generated build for that role. Every slot shows a one-line reason for its pick. Change any slot afterward — the slot turns amber with a "modified" flag and a **↺ reset** button, so you always know where you've deviated from the recipe and can undo one slot without redoing the build.

**Share:** copies a URL that reproduces your exact build for anyone with the app open.

## The combat evaluator

X4 resolves fights two completely different ways, so the evaluator models both:

- **In-sector (high attention):** projectiles are real. Hit chance drops with the defender's speed relative to projectile speed, scaled by hull size; beams almost always connect; turrets must physically track the target; shield regen runs at 25% under fire (9.0's regen stun); attackers focus-fire.
- **Out-of-sector (low attention):** statistical rounds every ~5 s. Turrets fire only ~30% of the time (why turret-heavy ships underperform OOS), forward guns hit ~90% baseline reduced by raw target speed (very fast ships approach untouchable), regen applies in full, and damage spreads across up to 5 targets.

The per-weapon tables answer "what evades what": each of the attacker's weapon groups shows its hit % against *this specific defender* in the selected mode — the inverse is the defender's evasion against that weapon type. Both modes compute on every change; the inactive one shows as a one-line summary so IS/OOS disagreements (there will be many) are always visible.

**Honesty box:** missiles/torpedoes and flak/ion damage are modeled only once the supplemental data files are filled (see the README — until then they're excluded and flagged, so bomber alpha strikes are underestimated). Still never modeled: positioning, kiting, crew skill, drones, or surface-element sniping. Constants come from community code-reading, not extracted game logic. Use it to rank options, not to promise outcomes.

## Saving & moving your data (offline only)

Nothing you do in this app touches a server. Builds and role tunings live in your browser's local storage, and move between devices as plain JSON files:

- **Save** (fitting screen) stores the current build in your library on the Saved page, where you can reopen, export, or delete it.
- **⤓ Export** (fitting screen) downloads the current loadout as a single-build file — no need to save first. Hand it to a friend; they import it on their Saved page.
- **⤓ Export** (any role card on the Roles page) downloads that role's tuning as a file.
- **Export everything** (Saved page) bundles every saved build plus all custom role tunings into one backup file.
- **Import file…** (Saved page) accepts any of the three file types and merges: builds are added (never overwritten), role tunings apply to the matching role. Items that don't fit your data — a ship id from a different game version, an unknown role — are skipped and counted, not silently mangled.

Clearing your browser's site data erases the library, so export a backup occasionally if your builds matter to you.

## What the role-fit numbers mean

"Capital Hunter **61**" means: give this ship its best possible Capital Hunter loadout, and it ranks in the 61st percentile of ships *of its size class* attempting that role. 100 = best in class, 40 and below = fighting the hull (those chips are hidden). Scores are relative within S, M, L, XL separately — a fighter's 83 and a destroyer's 61 aren't comparable.

## Editing roles (the deep end)

Roles aren't shopping lists — they're weighted priorities over derived stats. The Roles page shows each role's weights as sliders. Drag them, toggle **↓** (score a stat as lower-is-better), remove stats, or add any stat in the app. **Save & rescore** recalculates all 256 ships' role-fit scores with your weights and makes future preset applications use them. Changes live in your browser's storage only; **Reset to default** restores stock tuning per role.

Example: think Capital Hunter should favor range over volley weight (kite, don't slug)? Raise Range, lower Volley damage, save — the Meson Stream will start beating the Plasma Shard.

## Reading the stats honestly

- **100 km sprint** is the single best engine-comparison number for haulers: modeled door-to-door time including travel-drive charge, ramp, and cruise.
- **Main shield pool vs Surface shields:** on L/XL hulls, M-size generators shield turrets and engines, not the hull. EHP counts only the main pool.
- **Sustained DPS** is heat- and magazine-cycle-limited; **Volley damage** is one full trigger pull from every main gun — the alpha number that decides capital slugfests.
- Stats marked **\*** are modeled indices or dataset gaps, not extracted values: acceleration/agility (9.0 jerk physics isn't publicly documented; thruster stats aren't extracted), missile DPS (ammo stats missing), and flak/ion weapon DPS (AoE and split damage aren't in the dataset — shown as "n/a" rather than a fake zero).

Game data: extracted from X4 v9.0.0.0 via [Mistralys/x4-core](https://github.com/Mistralys/x4-core) (MIT). Unofficial fan tool; X4 is © Egosoft.
