import type { GameData, Ship, SlotGroup, Loadout, Derived, Engine, Shield, Weapon, Module } from '../types';

/** Build the regex that matches ship-locked weapons for a special hardpoint token.
 *  e.g. 'arg_destroyer_01' matches 'weapon_arg_l_destroyer_01_mk1'. */
function tokenRegex(tok: string): RegExp {
  const t = tok.startsWith('ship_') ? tok.slice(5) : tok;
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const i = t.indexOf('_');
  const pats = [esc(t)];
  if (i > 0) pats.push(`${esc(t.slice(0, i))}_(?:s|m|l|xl)_${esc(t.slice(i + 1))}`);
  return new RegExp(pats.join('|'));
}

const tokenCache = new Map<string, RegExp>();

/** Modules named after a specific hull are locked to that hull (Astrid yacht engine, Erlking guns…). */
const LOCK_RE = /_(destroyer|battleship|flagship|expeditionary|xperimental|yacht|tugboat|corvette)_\d/;
const NPC_RACES = new Set(['xenon', 'khaak']);
const shipRaceTag = (ship: Ship) => (ship.id.includes('_xen_') ? 'xenon' : ship.id.includes('_kha_') ? 'khaak' : null);

function mountable(ship: Ship, modId: string, modRace: string): boolean {
  if (LOCK_RE.test(modId)) {
    const core = ship.id.replace(/^ship_/, '');
    const sizeless = core.replace(/_(?:s|m|l|xl)_/, '_');
    if (!modId.includes(core) && !modId.includes(sizeless)) return false;
  }
  const npc = shipRaceTag(ship);
  if (NPC_RACES.has(modRace) && modRace !== npc) return false; // Xenon/Kha'ak tech stays on Xenon/Kha'ak hulls
  return true;
}

/** All modules that can be mounted in a given slot group of a given ship. */
export function compatible(ship: Ship, group: SlotGroup, data: GameData): Module[] {
  if (group.kind === 'engine') return data.engines.filter(e => e.size === group.size && mountable(ship, e.id, e.race));
  if (group.kind === 'shield') return data.shields.filter(s => s.size === group.size && mountable(ship, s.id, s.race));
  const accept = group.accept ?? 'combat';
  const mount = group.kind; // 'weapon' | 'turret'
  if (accept.startsWith('special:')) {
    const tok = accept.slice(8);
    let re = tokenCache.get(tok);
    if (!re) { re = tokenRegex(tok); tokenCache.set(tok, re); }
    return data.weapons.filter(w => w.mount === mount && w.size === group.size && re!.test(w.id));
  }
  const cats = new Set(accept.split('+'));
  return data.weapons.filter(w => {
    if (w.mount !== mount || w.size !== group.size) return false;
    if (LOCK_RE.test(w.id)) return false; // ship-locked weapons never appear in generic slots
    if (!mountable(ship, w.id, w.race)) return false;
    return cats.has(w.cat);
  });
}

function selected<T extends Module>(ship: Ship, loadout: Loadout, data: GameData, kind: SlotGroup['kind']): { mod: T; count: number }[] {
  const out: { mod: T; count: number }[] = [];
  for (const g of ship.groups) {
    if (g.kind !== kind) continue;
    const id = loadout[g.key];
    if (!id) continue;
    const pool: readonly Module[] = kind === 'engine' ? data.engines : kind === 'shield' ? data.shields : data.weapons;
    const mod = pool.find(m => m.id === id) as T | undefined;
    if (mod) out.push({ mod, count: g.count });
  }
  return out;
}

/** Estimated time (s) to cover `dist` meters starting from cruise, engaging travel drive immediately. */
export function timeToCross(dist: number, v0: number, vT: number, charge: number, attack: number): number {
  if (v0 <= 0) return Infinity;
  if (vT <= v0) return dist / v0;
  const d1 = v0 * charge;
  if (dist <= d1) return dist / v0;
  const dRamp = ((v0 + vT) / 2) * attack;
  if (dist <= d1 + dRamp) {
    // x(t) = v0 t + (vT - v0) t^2 / (2 * attack) = dist - d1  -> quadratic in t
    const a = (vT - v0) / (2 * attack);
    const t = (-v0 + Math.sqrt(v0 * v0 + 4 * a * (dist - d1))) / (2 * a);
    return charge + t;
  }
  return charge + attack + (dist - d1 - dRamp) / vT;
}

export function derive(ship: Ship, loadout: Loadout, data: GameData): Derived {
  const engines = selected<Engine>(ship, loadout, data, 'engine');
  const shields = selected<Shield>(ship, loadout, data, 'shield');
  const guns = selected<Weapon>(ship, loadout, data, 'weapon');
  const turrets = selected<Weapon>(ship, loadout, data, 'turret');

  const thrust = engines.reduce((a, e) => a + e.mod.thrust * e.count, 0);
  const eng = engines[0]?.mod;
  const topSpeed = thrust / ship.dragFwd;
  const boostSpeed = topSpeed * (eng?.boostMult ?? 0);
  const travelSpeed = topSpeed * (eng?.travelMult ?? 0);
  const travelEngage = eng?.travelCharge ?? 0;
  const travelFull = (eng?.travelCharge ?? 0) + (eng?.travelAttack ?? 0);
  const cross100 = eng ? timeToCross(100_000, topSpeed, travelSpeed, eng.travelCharge, eng.travelAttack) : Infinity;
  const cross50 = eng ? timeToCross(50_000, topSpeed, travelSpeed, eng.travelCharge, eng.travelAttack) : Infinity;
  // distance covered from initiating travel until full travel speed (charge at cruise + linear ramp)
  const travelDist = eng ? topSpeed * eng.travelCharge + ((topSpeed + travelSpeed) / 2) * eng.travelAttack : Infinity;
  const accel = ship.mass > 0 ? (thrust / ship.mass) * ship.accFwd : 0;
  const turn = 1000 / (((ship.dragPitch + ship.dragYaw) / 2) * Math.max(1, (ship.inertiaPitch + ship.inertiaYaw) / 2) / 100);

  // On L/XL hulls, smaller shield generators protect surface elements (turrets/engines),
  // not the main hull pool — only ship-size-matching generators feed the main shield.
  const mainShields = shields.filter(s => s.mod.size === ship.size);
  const effMain = mainShields.length ? mainShields : shields; // fallback: hull with no size-matching slots
  const effSurf = mainShields.length ? shields.filter(s => s.mod.size !== ship.size) : [];
  const shieldCap = effMain.reduce((a, s) => a + s.mod.cap * s.count, 0);
  const shieldRate = effMain.reduce((a, s) => a + s.mod.rate * s.count, 0);
  const shieldDelay = effMain.reduce((a, s) => Math.max(a, s.mod.delay), 0);
  const surfaceShields = effSurf.reduce((a, s) => a + s.mod.cap * s.count, 0);

  const sumW = (ws: { mod: Weapon; count: number }[], f: (w: Weapon) => number) =>
    ws.reduce((a, w) => a + f(w.mod) * w.count, 0);
  const nonMissileGuns = guns.filter(g => g.mod.cat !== 'missile');
  const burstDPS = sumW(nonMissileGuns.filter(g => g.mod.cat === 'combat'), w => w.burst);
  const sustainedDPS = sumW(nonMissileGuns.filter(g => g.mod.cat === 'combat'), w => w.sustained);
  // Mining lasers/drills model their output in `damage` (continuous-beam yield), not
  // burst/sustained like combat weapons — those fields are always 0 for cat: 'mining'
  // entries in this dataset, so summing them silently produced a zero mining output.
  const miningDPS = sumW(guns.filter(g => g.mod.cat === 'mining'), w => w.damage) +
    sumW(turrets.filter(t => t.mod.cat === 'mining'), w => w.damage);
  // supplemental-sourced missile output; ammo-limited in real fights, so kept out of totalSustained
  const missileDPS = sumW(guns.filter(g => g.mod.cat === 'missile'), w => w.sustained) +
    sumW(turrets.filter(t => t.mod.cat === 'missile'), w => w.sustained);
  // volley damage: one full trigger pull from every main gun (burst/rate = damage per shot incl. multi-projectile)
  const alpha = nonMissileGuns.reduce((a, g) => {
    if (g.mod.beam) return a;
    const perShot = g.mod.rate > 0 ? g.mod.burst / g.mod.rate : g.mod.damage;
    return a + perShot * g.count;
  }, 0);
  const ranges = nonMissileGuns.filter(g => !g.mod.beam).map(g => g.mod.range);
  const range = ranges.length ? Math.max(...ranges) : 0;
  const speeds = nonMissileGuns.filter(g => !g.mod.beam && g.mod.speed > 0);
  const projSpeed = speeds.length
    ? speeds.reduce((a, g) => a + g.mod.speed * g.count, 0) / speeds.reduce((a, g) => a + g.count, 0)
    : 0;
  const hasBeam = nonMissileGuns.some(g => g.mod.beam) || turrets.some(t => t.mod.beam);

  const combatTurrets = turrets.filter(t => t.mod.cat === 'combat');
  const turretDPS = sumW(combatTurrets, w => w.burst);
  const turretSustained = sumW(combatTurrets, w => w.sustained);
  const trackable = combatTurrets.filter(t => t.mod.rot > 0);
  const turretTrack = trackable.length
    ? trackable.reduce((a, t) => a + t.mod.rot * t.count, 0) / trackable.reduce((a, t) => a + t.count, 0)
    : 0;

  const missileCapacity = ship.missiles;
  // hangar capacity when known; visible dock points otherwise; NaN (= unknown, skip in scoring)
  // when the extraction has neither — absent data must not read as "zero capacity"
  const docksSum = Object.values(ship.docks).reduce((a, b) => a + b, 0);
  const dockCap = ship.hangar ?? (docksSum > 0 ? docksSum : NaN);

  const totalSustained = sustainedDPS + turretSustained;

  return {
    topSpeed, boostSpeed, travelSpeed, accel, turn,
    travelEngage, travelFull, travelDist, cross100, cross50,
    boostDur: eng?.boostDur ?? 0, boostRech: eng?.boostRech ?? 0,
    shieldCap, shieldRate, shieldDelay, surfaceShields,
    ehp: ship.hull + shieldCap, ehp60: ship.hull + shieldCap + shieldRate * 60, hull: ship.hull,
    burstDPS, sustainedDPS, totalSustained, alpha, range, projSpeed, hasBeam,
    turretDPS, turretSustained, turretTrack, miningDPS, missileDPS, missileCapacity,
    cargo: ship.cargo, people: ship.people, dockCap, cms: ship.cms,
  };
}

export function emptyLoadout(ship: Ship): Loadout {
  const l: Loadout = {};
  for (const g of ship.groups) l[g.key] = null;
  return l;
}
