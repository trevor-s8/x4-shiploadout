import type { GameData, Ship, Loadout, Derived, Module } from '../types';
import { compatible, derive, emptyLoadout } from './derive';
import { type Role } from '../data/roles';

export type MissilePref = 'auto' | 'prefer' | 'avoid';

const STAT_LABEL: Partial<Record<keyof Derived, string>> = {
  topSpeed: 'top speed', boostSpeed: 'boost speed', travelSpeed: 'travel speed',
  accel: 'acceleration', turn: 'agility', projSpeed: 'projectile speed',
  burstDPS: 'burst DPS', sustainedDPS: 'sustained DPS', alpha: 'volley damage', range: 'range',
  turretDPS: 'turret DPS', turretSustained: 'turret sustained DPS', turretTrack: 'turret tracking',
  ehp: 'effective HP', ehp60: 'sustained EHP', hull: 'hull', shieldCap: 'shield capacity',
  shieldRate: 'shield regen', shieldDelay: 'recharge delay',
  cross100: '100 km sprint time', travelEngage: 'travel engage time', travelFull: 'travel spool time',
  travelDist: 'travel spool distance', totalSustained: 'total sustained DPS', surfaceShields: 'surface shields',
  cargo: 'cargo', miningDPS: 'mining output',
};

export interface BuildResult {
  loadout: Loadout;
  /** groupKey -> human explanation of why this module won */
  reasons: Record<string, string>;
  derived: Derived;
}

function num(v: number): string {
  if (!isFinite(v)) return '—';
  if (Math.abs(v) >= 10000) return `${(v / 1000).toFixed(1)}k`;
  return Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1);
}

/** Greedy per-slot-group optimization: engines first (they dominate mobility),
 *  then shields, weapons, turrets. Each candidate is scored by the weighted,
 *  min-max-normalized derived stats it produces for the whole ship. */
export function buildForRole(ship: Ship, role: Role, data: GameData, missiles: MissilePref = 'auto'): BuildResult {
  const order = { engine: 0, shield: 1, weapon: 2, turret: 3 } as const;
  const groups = [...ship.groups].sort((a, b) => order[a.kind] - order[b.kind]);
  const loadout = emptyLoadout(ship);
  const reasons: Record<string, string> = {};
  const inverted = new Set(role.inverted ?? []);
  const weights = Object.entries(role.weights) as [keyof Derived, number][];

  for (const g of groups) {
    let cands = compatible(ship, g, data);
    // Mixed combat/missile slots: missiles are ammo-limited burst tools, so 'auto' keeps them out of
    // sustained-fire roles unless the slot is missile-only; 'prefer'/'avoid' override per the user.
    if ((g.kind === 'weapon' || g.kind === 'turret') && cands.some(c => 'cat' in c && (c as { cat: string }).cat !== 'missile')) {
      const wantMissiles = missiles === 'prefer';
      const filtered = cands.filter(c => (((c as { cat: string }).cat === 'missile')) === wantMissiles);
      if (missiles !== 'auto' || !wantMissiles) cands = filtered.length ? filtered : cands;
    }
    if (cands.length === 0) { reasons[g.key] = 'No compatible modules in dataset (NPC-locked slot).'; continue; }
    if (cands.length === 1) {
      loadout[g.key] = cands[0].id;
      reasons[g.key] = 'Only compatible option for this hardpoint.';
      continue;
    }
    // derive per candidate
    const derivs = cands.map(c => {
      const l = { ...loadout, [g.key]: c.id };
      return derive(ship, l, data);
    });
    // min/max per weighted stat across candidates
    const score = (di: number): { total: number; contrib: [keyof Derived, number][] } => {
      let total = 0;
      const contrib: [keyof Derived, number][] = [];
      for (const [stat, w] of weights) {
        let min = Infinity, max = -Infinity;
        for (const d of derivs) {
          const v = d[stat] as number;
          if (isFinite(v)) { min = Math.min(min, v); max = Math.max(max, v); }
        }
        if (!isFinite(min) || max === min) continue;
        const raw = derivs[di][stat] as number;
        if (!isFinite(raw)) continue;
        let n = (raw - min) / (max - min);
        if (inverted.has(stat)) n = 1 - n;
        total += n * w;
        contrib.push([stat, n * w]);
      }
      return { total, contrib };
    };
    let best = 0, bestScore = -1, bestContrib: [keyof Derived, number][] = [];
    let worstScore = Infinity;
    for (let i = 0; i < cands.length; i++) {
      const { total, contrib } = score(i);
      worstScore = Math.min(worstScore, total);
      if (total > bestScore + 1e-9 || (Math.abs(total - bestScore) < 1e-9 && cands[i].id < cands[best].id)) {
        best = i; bestScore = total; bestContrib = contrib;
      }
    }
    if (bestScore - worstScore < 1e-6) {
      // role weights don't discriminate this slot — fall back to the sensible default
      const fallback = (m: (typeof cands)[number]): number => {
        if ('thrust' in m) return m.thrust;
        if ('cap' in m) return m.cap;
        const w = m as { sustained: number; cat: string; system: string };
        const catBonus = w.cat === 'combat' ? 1e9 : 0;                       // sustained-fire beats ammo-limited
        const guidedBonus = /guided|tracking/.test(w.system) ? 1e6 : 0;      // if missile, guided beats dumbfire
        return catBonus + guidedBonus + w.sustained;
      };
      best = 0;
      for (let i = 1; i < cands.length; i++) if (fallback(cands[i]) > fallback(cands[best])) best = i;
      bestContrib = [];
      reasons[g.key] = 'Role weights are indifferent here — defaulted to the strongest option for this slot type.';
      loadout[g.key] = cands[best].id;
      continue;
    }
    loadout[g.key] = cands[best].id;
    const top = bestContrib.sort((a, b) => b[1] - a[1]).slice(0, 2)
      .map(([stat]) => {
        const v = derivs[best][stat] as number;
        return `${STAT_LABEL[stat] ?? stat}: ${num(v)}`;
      });
    reasons[g.key] = top.length ? `Best ${role.name.toLowerCase()} pick — leads on ${top.join(', ')}.` : 'Best weighted pick for this role.';
  }
  return { loadout, reasons, derived: derive(ship, loadout, data) };
}

export interface RoleFit { roleId: string; score: number; loadout: Loadout }

/** For every ship: generate its best build per applicable role, then normalize
 *  weighted scores within the ship's size class -> 0..100 role-fit scores. */
export function computeRoleFits(data: GameData, roles: Role[]): Map<string, RoleFit[]> {
  // pass 1: best-build derived stats per (ship, role)
  const cells: { ship: Ship; role: Role; d: Derived; loadout: Loadout }[] = [];
  for (const ship of data.ships) {
    for (const role of roles) {
      if (role.appliesTo && !role.appliesTo(ship)) continue;
      const b = buildForRole(ship, role, data, role.missilePref ?? 'auto');
      cells.push({ ship, role, d: b.derived, loadout: b.loadout });
    }
  }
  // pass 2: normalize per (size class, role)
  const fits = new Map<string, RoleFit[]>();
  for (const role of roles) {
    const sizePools: (string | null)[] = role.poolAll ? [null] : ['s', 'm', 'l', 'xl'];
    for (const size of sizePools) {
      const pool = cells.filter(c => c.role.id === role.id && (size === null || c.ship.size === size));
      if (!pool.length) continue;
      const stats = Object.keys(role.weights) as (keyof Derived)[];
      // rank-based normalization per stat: robust to outliers, spreads mid-field ships
      const ranks = new Map<keyof Derived, Map<number, number>>();
      for (const s of stats) {
        const vals = [...new Set(pool.map(c => c.d[s] as number).filter(isFinite))].sort((a, b) => a - b);
        const m = new Map<number, number>();
        vals.forEach((v, i) => m.set(v, vals.length > 1 ? i / (vals.length - 1) : 1));
        ranks.set(s, m);
      }
      const inverted = new Set(role.inverted ?? []);
      for (const c of pool) {
        let total = 0, wsum = 0;
        for (const s of stats) {
          const w = role.weights[s]!;
          const v = c.d[s] as number;
          const n0 = ranks.get(s)!.get(v);
          if (n0 === undefined) continue; // unknown data: exclude the stat, don't punish the ship
          wsum += w;
          total += (inverted.has(s) ? 1 - n0 : n0) * w;
        }
        const score = Math.round((total / (wsum || 1)) * 100);
        const arr = fits.get(c.ship.id) ?? [];
        arr.push({ roleId: role.id, score, loadout: c.loadout });
        fits.set(c.ship.id, arr);
      }
    }
  }
  for (const arr of fits.values()) arr.sort((a, b) => b.score - a.score);
  return fits;
}
