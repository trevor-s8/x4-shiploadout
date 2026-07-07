import type { GameData, Ship, Loadout, Weapon, Derived } from '../types';
import { derive } from './derive';

/**
 * Combat estimation with two modes reflecting X4's split personality:
 *
 * IN-SECTOR ("high attention", fully simulated):
 *  - projectiles are real: hit chance falls with target speed / projectile speed, scaled by target size
 *  - turrets must physically track: rotation speed vs the target's angular speed at engagement range
 *  - 9.0 stuns shield regen under sustained fire -> regen counted at 25% while being shot
 *  - attackers focus-fire one target at a time
 *
 * OUT-OF-SECTOR ("low attention", statistical):
 *  - turrets only fire ~30% of the time (community-verified constant) -> turret DPS x0.30
 *  - forward weapons hit at ~90% baseline; target SPEED is the dominant evasion stat
 *    (very fast ships approach untouchable), projectile speed and tracking are ignored
 *  - shield regen applies at full rate between ticks
 *  - damage spreads across up to 5 targets instead of focusing
 *
 * All constants below are heuristics fitted to community code-reading and testing,
 * not extracted game code. Treat outputs as directional estimates.
 */

export type CombatMode = 'is' | 'oos';

export interface SideSpec { ship: Ship; loadout: Loadout; count: number; label: string }

export interface WeaponGroupEval {
  name: string;
  mount: 'weapon' | 'turret';
  count: number;
  baseDPS: number;   // per-mount sustained
  hit: number;       // 0..1 vs this defender in this mode
  effDPS: number;    // count * baseDPS * hit * (mode fire-chance for turrets)
}

export interface SideEval {
  d: Derived;
  groups: WeaponGroupEval[];
  effDPS: number; // per ship — multiply by count for side total
  excluded: string[]; // weapons we can't model (missiles, flak/ion with no damage data)
}

export interface ModeResult {
  mode: CombatMode;
  winner: 'A' | 'B' | 'mutual' | 'stalemate';
  duration: number;
  lossesA: number; lossesB: number;
  survivorsA: number; survivorsB: number;
  firstKillByA: number | null; // seconds until A destroys its first B ship
  firstKillByB: number | null;
  ttkSingleAB: number | null;  // A's eff DPS vs one B ship's pool (no regen), classic TTK
  ttkSingleBA: number | null;
  evalA: SideEval; // A attacking B
  evalB: SideEval;
  rangeNote: 'A' | 'B' | null; // side that outranges the other by >30%
}

const SIZE_EVADE = { s: 1.0, m: 0.65, l: 0.3, xl: 0.15 } as const;
const OOS_SPEED_IMMUNE = 2000;  // m/s at which OOS hit chance approaches zero
const OOS_TURRET_FIRE = 0.30;   // LA turret fire chance
const OOS_BASE_HIT = 0.90;      // LA forward-weapon baseline
const IS_REGEN_UNDER_FIRE = 0.25;
const ENGAGE_RANGE_FACTOR = 0.6; // typical brawl distance as fraction of weapon range
const SIM_CAP = 3600;            // seconds
const DT_IS = 0.5;               // fully-simulated fights resolve continuously
const DT_OOS = 5;                // low-attention combat resolves in ~5 s attack rounds

function weaponsOf(spec: SideSpec, data: GameData): { w: Weapon; count: number }[] {
  const out: { w: Weapon; count: number }[] = [];
  for (const g of spec.ship.groups) {
    if (g.kind !== 'weapon' && g.kind !== 'turret') continue;
    const id = spec.loadout[g.key];
    if (!id) continue;
    const w = data.weapons.find(x => x.id === id);
    if (w) out.push({ w, count: g.count });
  }
  return out;
}

function hitChance(w: Weapon, defender: Derived, defSize: keyof typeof SIZE_EVADE, mode: CombatMode): number {
  const v = defender.topSpeed; // ships maneuver near cruise speed in a fight
  if (mode === 'oos') {
    const evade = Math.min(0.95, v / OOS_SPEED_IMMUNE) * (defSize === 's' ? 1 : defSize === 'm' ? 0.8 : 0.3);
    return OOS_BASE_HIT * (1 - evade);
  }
  // in-sector
  let base: number;
  if (w.beam) {
    base = 0.98; // beams land on anything they can point at
  } else {
    const evade = Math.min(0.92, Math.tanh(1.3 * v / Math.max(1, w.speed))) * SIZE_EVADE[defSize];
    base = 1 - evade;
  }
  if (w.mount === 'turret') {
    const range = Math.max(500, w.range || 2000) * ENGAGE_RANGE_FACTOR;
    const neededDegSec = (v / range) * 57.2958; // target angular speed at engagement range
    const tf = w.rot > 0 ? Math.pow(Math.min(1, w.rot / Math.max(1, neededDegSec)), 0.7) : 1;
    return base * Math.max(0.15, tf);
  }
  return base * 0.95; // pilot aim isn't perfect either
}

function evalSide(att: SideSpec, def: SideSpec, mode: CombatMode, data: GameData, attD: Derived, defD: Derived): SideEval {
  const groups: WeaponGroupEval[] = [];
  const excluded: string[] = [];
  for (const { w, count } of weaponsOf(att, data)) {
    if (w.cat === 'missile' && w.sustained <= 0) { excluded.push(`${w.name} ×${count} (missile ammo stats missing — fill data/supplemental/missiles.json)`); continue; }
    if (w.noDmg) { excluded.push(`${w.name} ×${count} (AoE/ion damage not in dataset)`); continue; }
    const hit = hitChance(w, defD, def.ship.size, mode);
    const fire = mode === 'oos' && w.mount === 'turret' ? OOS_TURRET_FIRE : 1;
    groups.push({ name: w.name, mount: w.mount, count, baseDPS: w.sustained, hit, effDPS: w.sustained * count * hit * fire });
  }
  return { d: attD, groups, effDPS: groups.reduce((a, g) => a + g.effDPS, 0), excluded };
}

export function evaluate(a: SideSpec, b: SideSpec, mode: CombatMode, data: GameData): ModeResult {
  const dA = derive(a.ship, a.loadout, data);
  const dB = derive(b.ship, b.loadout, data);
  const evalA = evalSide(a, b, mode, data, dA, dB);
  const evalB = evalSide(b, a, mode, data, dB, dA);

  // classic single-target TTK (pool / effective DPS, regen ignored) for quick reading
  const pool = (d: Derived) => d.hull + d.shieldCap;

  // time-stepped fleet sim
  interface Unit { sh: number; hull: number; hit: boolean }
  const mk = (d: Derived, n: number): Unit[] => Array.from({ length: n }, () => ({ sh: d.shieldCap, hull: d.hull, hit: false }));
  const A = mk(dA, a.count), B = mk(dB, b.count);
  const DT = mode === 'oos' ? DT_OOS : DT_IS;
  let firstKillByA: number | null = null, firstKillByB: number | null = null;
  let t = 0;

  const applyDamage = (units: Unit[], totalDps: number) => {
    const alive = units.filter(u => u.hull > 0);
    if (!alive.length || totalDps <= 0) return;
    // OOS spreads across up to 5 targets; IS focus-fires the first
    const targets = mode === 'oos' ? alive.slice(0, Math.min(5, alive.length)) : [alive[0]];
    const per = (totalDps * DT) / targets.length;
    for (const u of targets) {
      u.hit = true;
      let dmg = per;
      if (u.sh > 0) {
        const absorbed = Math.min(u.sh, dmg);
        u.sh -= absorbed; dmg -= absorbed;
      }
      u.hull -= dmg;
    }
  };
  const regen = (units: Unit[], d: Derived) => {
    for (const u of units) {
      if (u.hull <= 0) continue;
      const mod = u.hit ? (mode === 'is' ? IS_REGEN_UNDER_FIRE : 1) : 1;
      u.sh = Math.min(d.shieldCap, u.sh + d.shieldRate * mod * DT);
      u.hit = false;
    }
  };
  const aliveCount = (u: Unit[]) => u.reduce((n, x) => n + (x.hull > 0 ? 1 : 0), 0);

  while (t < SIM_CAP) {
    const aAlive = aliveCount(A), bAlive = aliveCount(B);
    if (aAlive === 0 || bAlive === 0) break;
    // evalSide output is per ship — total side damage scales with living ships
    applyDamage(B, evalA.effDPS * aAlive);
    applyDamage(A, evalB.effDPS * bAlive);
    regen(A, dA); regen(B, dB);
    t += DT;
    if (firstKillByA === null && aliveCount(B) < b.count) firstKillByA = t;
    if (firstKillByB === null && aliveCount(A) < a.count) firstKillByB = t;
  }

  const survA = aliveCount(A), survB = aliveCount(B);
  const winner: ModeResult['winner'] =
    survA > 0 && survB === 0 ? 'A' : survB > 0 && survA === 0 ? 'B' : survA === 0 && survB === 0 ? 'mutual' : 'stalemate';
  const rangeNote = dA.range > dB.range * 1.3 ? 'A' : dB.range > dA.range * 1.3 ? 'B' : null;

  return {
    mode, winner, duration: t,
    lossesA: a.count - survA, lossesB: b.count - survB,
    survivorsA: survA, survivorsB: survB,
    firstKillByA, firstKillByB,
    // one attacker ship's effective DPS (evalSide is per-ship) into one defender's raw pool
    ttkSingleAB: evalA.effDPS > 0 ? pool(dB) / evalA.effDPS : null,
    ttkSingleBA: evalB.effDPS > 0 ? pool(dA) / evalB.effDPS : null,
    evalA, evalB, rangeNote,
  };
}
