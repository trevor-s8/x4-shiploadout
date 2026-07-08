import { readFileSync } from 'fs';
import { derive, emptyLoadout, compatible, timeToCross } from '../src/engine/derive';
import { buildForRole, computeRoleFits } from '../src/engine/optimizer';
import { DEFAULT_ROLES, roleMap } from '../src/data/roles';
import type { GameData } from '../src/types';

const data: GameData = JSON.parse(readFileSync('public/data/gamedata.json', 'utf8'));
const RM = roleMap(DEFAULT_ROLES);
const ship = (name: string) => data.ships.find(s => s.name.includes(name))!;

// 1) prior checks still hold
const b1 = buildForRole(ship('Pulsar'), RM['interceptor'], data);
console.log('Pulsar interceptor engine:', b1.loadout['engine']);
const merc = data.ships.find(s => (s.class === 'transporter' || s.class === 'freighter') && s.size === 'm')!;
console.log(merc.name, 'courier engine:', buildForRole(merc, RM['courier'], data).loadout['engine']);

// 2) ITEM 12: Asgard Capital Hunter — turrets must NOT be alphabetical beams
const asgard = ship('Asgard');
const bk = buildForRole(asgard, RM['capitalkiller'], data);
for (const [k, v] of Object.entries(bk.loadout)) if (v) console.log('  Asgard CapHunter', k, '->', v);
console.log('  volley:', Math.round(bk.derived.alpha), 'totalSustained:', Math.round(bk.derived.totalSustained));

// what do L turret options look like, ranked by sustained?
const tg = asgard.groups.find(g => g.kind === 'turret' && g.size === 'l' && (g.accept ?? '').includes('combat'));
if (tg) {
  const opts = compatible(asgard, tg, data) as any[];
  opts.sort((a, b) => b.sustained - a.sustained);
  console.log('  top L turrets by sustained:', opts.slice(0, 4).map(o => `${o.name}=${Math.round(o.sustained)}`).join(' | '));
}

// 3) ITEM 5: Behemoth shield split — M shields must be surface, not main pool
const beh = ship('Behemoth');
const bt = buildForRole(beh, RM['tank'], data);
const dd = bt.derived;
console.log('Behemoth tank: mainShield', Math.round(dd.shieldCap), 'surface', Math.round(dd.surfaceShields), 'EHP', Math.round(dd.ehp));
if (dd.surfaceShields === 0) throw new Error('surface shields should be > 0 on Behemoth');

// 4) travelDist sanity: bigger travel mult & attack -> more distance
const g = beh.groups.find(x => x.kind === 'engine')!;
const engs = compatible(beh, g, data).slice(0, 3) as any[];
for (const e of engs) {
  const d2 = derive(beh, { ...emptyLoadout(beh), engine: e.id }, data);
  console.log('  travelDist', e.id, Math.round(d2.travelDist / 1000) + 'km', 'cross100', Math.round(d2.cross100) + 's');
}

// 5) full fits with new roles — no NaN, timing
const t0 = Date.now();
const fits = computeRoleFits(data, DEFAULT_ROLES);
let bad = 0; for (const a of fits.values()) for (const f of a) if (!isFinite(f.score)) bad++;
console.log(`fits: ${fits.size} ships, ${Date.now() - t0}ms, bad=${bad}`);
console.log('Asgard fits:', fits.get(asgard.id)!.slice(0, 4).map(f => `${f.roleId}:${f.score}`).join(' '));
console.log('cross monotonic:', timeToCross(1e5, 100, 3000, 10, 30) < timeToCross(1e5, 100, 3000, 60, 30));
