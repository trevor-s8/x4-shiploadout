import type { Derived } from './types';

export const fmt = {
  n(v: number, d = 0): string {
    if (!isFinite(v)) return '—';
    return v.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: 0 });
  },
  speed: (v: number) => (isFinite(v) ? `${fmt.n(v)} m/s` : '—'),
  time(v: number): string {
    if (!isFinite(v)) return '—';
    if (v >= 90) { const m = Math.floor(v / 60); return `${m}m ${Math.round(v - m * 60)}s`; }
    return `${fmt.n(v, 1)} s`;
  },
  dist: (v: number) => (v >= 1000 ? `${fmt.n(v / 1000, 1)} km` : `${fmt.n(v)} m`),
  big(v: number): string {
    if (!isFinite(v)) return '—';
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)} M`;
    if (v >= 10_000) return `${(v / 1000).toFixed(1)} k`;
    return fmt.n(v);
  },
};

export interface StatRow {
  key: keyof Derived;
  label: string;
  format: (v: number) => string;
  tip: string;
  lowerBetter?: boolean;
}

export interface StatSection { title: string; rows: StatRow[] }

export const STAT_SECTIONS: StatSection[] = [
  {
    title: 'Mobility',
    rows: [
      { key: 'topSpeed', label: 'Top speed', format: fmt.speed, tip: 'Σ engine thrust ÷ ship forward drag' },
      { key: 'boostSpeed', label: 'Boost speed', format: fmt.speed, tip: 'Top speed × engine boost multiplier' },
      { key: 'travelSpeed', label: 'Travel speed', format: fmt.speed, tip: 'Top speed × engine travel multiplier' },
      { key: 'travelEngage', label: 'Travel drive engage', format: fmt.time, tip: 'Charge time before the travel drive kicks in. Lower is better — some engines (e.g. Boron) engage almost instantly.', lowerBetter: true },
      { key: 'travelFull', label: 'Time to full travel speed', format: fmt.time, tip: 'Engage charge + acceleration ramp until the engine reaches full travel speed. Lower is better.', lowerBetter: true },
      { key: 'cross100', label: '100 km sprint', format: fmt.time, tip: 'Modeled door-to-door time to cover 100 km starting at cruise speed (charge + ramp + travel). Lower is better — the single best number for comparing engines on long hauls.', lowerBetter: true },
      { key: 'cross50', label: '50 km hop', format: fmt.time, tip: 'Modeled time for a typical station-to-station run (stations sit 30-70 km apart). Lower is better.', lowerBetter: true },
      { key: 'travelDist', label: 'Travel spool distance', format: fmt.dist, tip: 'Distance covered from hitting travel until reaching full travel speed. Lower is better — a short spool lets you use travel drive in knife-range gaps.', lowerBetter: true },
      { key: 'accel', label: 'Acceleration*', format: v => `${fmt.n(v, 1)}`, tip: 'Relative index: thrust ÷ mass × ship accel factor. 9.0 jerk physics modeled as an index, not measured.' },
      { key: 'turn', label: 'Agility*', format: v => fmt.n(v, 1), tip: 'Relative index from rotational drag & inertia (engine-independent; thruster stats are a known dataset gap)' },
      { key: 'boostDur', label: 'Boost duration', format: fmt.time, tip: 'Seconds of boost per full charge' },
    ],
  },
  {
    title: 'Defense',
    rows: [
      { key: 'shieldCap', label: 'Main shield pool', format: fmt.big, tip: 'Σ capacity of ship-size shield generators — the pool that protects the hull. Smaller generators on L/XL hulls shield surface parts instead (see Surface shields).' },
      { key: 'shieldRate', label: 'Shield regen', format: v => `${fmt.big(v)}/s`, tip: 'Σ recharge rate. 9.0 interrupts regen under fire — delay matters more than older metas assumed.' },
      { key: 'shieldDelay', label: 'Recharge delay', format: fmt.time, tip: 'Delay before shield regen starts after taking damage. Lower is better — 9.0 interrupts regen under fire, so this matters more than it used to.', lowerBetter: true },
      { key: 'hull', label: 'Hull', format: fmt.big, tip: 'Ship hull points' },
      { key: 'surfaceShields', label: 'Surface shields', format: fmt.big, tip: 'Σ capacity of component shields protecting turrets/engines on L/XL hulls — separate from the main pool, but they keep your guns alive.' },
      { key: 'ehp', label: 'Effective HP', format: fmt.big, tip: 'Hull + main shield pool' },
      { key: 'ehp60', label: 'EHP (60 s fight)', format: fmt.big, tip: 'Hull + shields + 60 s of uninterrupted regen' },
    ],
  },
  {
    title: 'Offense',
    rows: [
      { key: 'burstDPS', label: 'Weapon burst DPS', format: fmt.big, tip: 'Σ main-gun damage × shots/s (beams counted as damage/s)' },
      { key: 'sustainedDPS', label: 'Weapon sustained DPS', format: fmt.big, tip: 'Main-gun burst × heat duty cycle' },
      { key: 'totalSustained', label: 'Total sustained DPS', format: fmt.big, tip: 'Main guns + all combat turrets, heat-limited — the whole ship\'s continuous output' },
      { key: 'alpha', label: 'Volley damage', format: fmt.big, tip: 'Damage of one full trigger pull from every main gun — the alpha-strike number that decides capital slugfests' },
      { key: 'range', label: 'Max weapon range', format: fmt.dist, tip: 'Projectile speed × lifetime (beams excluded — dataset beam ranges are unreliable)' },
      { key: 'projSpeed', label: 'Projectile speed', format: fmt.speed, tip: 'Count-weighted average across mounted projectile guns. 9.0 AI dodges more — faster shots land more.' },
      { key: 'turretDPS', label: 'Turret burst DPS', format: fmt.big, tip: 'Σ combat turret DPS' },
      { key: 'turretSustained', label: 'Turret sustained DPS', format: fmt.big, tip: 'Turret burst × heat duty cycle' },
      { key: 'turretTrack', label: 'Turret tracking', format: v => `${fmt.n(v)}°/s`, tip: 'Average turret rotation speed — key anti-fighter stat in 9.0' },
      { key: 'miningDPS', label: 'Mining output', format: fmt.big, tip: 'Σ mining laser damage/s' },
      { key: 'missileDPS', label: 'Missile DPS ≈', format: fmt.big, tip: 'From supplemental missile data (representative missile per launcher); assumes ammo keeps flowing — ship missile storage limits real fights.' },
      { key: 'missileCapacity', label: 'Missile storage', format: fmt.n, tip: 'Ship missile magazine' },
    ],
  },
  {
    title: 'Utility',
    rows: [
      { key: 'cargo', label: 'Cargo', format: v => `${fmt.big(v)} m³`, tip: 'Cargo bay capacity' },
      { key: 'people', label: 'Crew', format: fmt.n, tip: 'Crew capacity' },
      { key: 'dockCap', label: 'Docking', format: fmt.n, tip: 'Total dock slots' },
      { key: 'cms', label: 'Countermeasures', format: fmt.n, tip: 'Countermeasure capacity' },
    ],
  },
];

export const SIZE_LABEL: Record<string, string> = { s: 'S', m: 'M', l: 'L', xl: 'XL' };
export const RACE_LABEL: Record<string, string> = {
  argon: 'Argon', teladi: 'Teladi', paranid: 'Paranid', split: 'Split', terran: 'Terran',
  boron: 'Boron', generic: 'Generic', unknown: 'Generic', xenon: 'Xenon', khaak: "Kha'ak",
  pirate: 'Pirate', yaki: 'Yaki', atf: 'ATF',
};

export const CLASS_LABEL: Record<string, string> = {
  fighter: 'Fighter', heavyfighter: 'Heavy Fighter', scout: 'Scout', corvette: 'Corvette',
  frigate: 'Frigate', gunboat: 'Gunboat', destroyer: 'Destroyer',
  battleship: 'Battleship', carrier: 'Carrier', resupplier: 'Resupplier',
  freighter: 'Freighter', transporter: 'Transporter', courier: 'Courier',
  miner: 'Miner', largeminer: 'Large Miner', builder: 'Builder',
  scavenger: 'Scavenger', envoy: 'Envoy', tug: 'Tug',
  expeditionary: 'Expeditionary', compactor: 'Compactor',
};

/** Logical class grouping for the ship browser filter (item: cleaner class list). */
export const CLASS_GROUPS: [string, string[]][] = [
  ['Combat — S/M', ['scout', 'fighter', 'heavyfighter', 'corvette', 'gunboat', 'frigate', 'expeditionary']],
  ['Combat — Capital', ['destroyer', 'battleship', 'carrier', 'resupplier']],
  ['Trade', ['courier', 'transporter', 'freighter', 'envoy']],
  ['Mining & Salvage', ['miner', 'largeminer', 'scavenger', 'tug', 'compactor']],
  ['Construction', ['builder']],
];

/**
 * Ships that exist in the game files but aren't ones the player can actually own and fly
 * in vanilla X4.
 *
 * Xenon — the vanilla-capturable set is exactly: F, B, PE, SE (can be forced to bail, then
 * claimed) and H (boardable, very high difficulty). The classic-generation hulls (N, M, P,
 * T, S) never bail, and K / I cannot be boarded — dedicated mods ("Capturable Xenon SM",
 * "Capturable Xenon XL") exist precisely to add those capture paths. The M0 (Timelines) is
 * a story set-piece superweapon with no capture path at all.
 *
 * Kha'ak — none are player-flyable in vanilla. Capture mods exist, and even those note the
 * ships have no airlocks or cockpit spawn point, so the player can never physically enter
 * one; there is no vanilla bail/boarding path for any Kha'ak hull, Ravager and Obliterator
 * included.
 *
 * Revisit this list if a future patch/DLC changes what's actually flyable.
 */
export const UNPLAYABLE_SHIP_IDS = new Set<string>([
  // Xenon — classic generation, no bail mechanic
  'ship_xen_s_fighter_01_a',      // N
  'ship_xen_s_fighter_02_a',      // M
  'ship_xen_s_scout_01_a',        // T
  'ship_xen_m_fighter_01_a',      // P
  'ship_xen_m_miner_01_a',        // S
  // Xenon — capitals, not boardable in vanilla (unlike the H)
  'ship_xen_xl_destroyer_01_a',   // K
  'ship_xen_xl_carrier_01_a',     // I
  'ship_xen_xl_mothership_01',    // M0 — Timelines story/superweapon set-piece
  // Kha'ak — entire faction is non-flyable in vanilla (no airlocks/cockpit)
  'ship_kha_s_fighter_01_a',      // Protector
  'ship_kha_s_fighter_02_a',      // Forager
  'ship_kha_m_fighter_01_a',      // Queen's Guard
  'ship_kha_m_fighter_02_a',      // Hive Guard
  'ship_kha_l_destroyer_01_a',    // Ravager
  'ship_kha_xl_battleship_01_a',  // Obliterator
]);

