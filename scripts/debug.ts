import { readFileSync } from 'fs';
import { derive, compatible, emptyLoadout } from '../src/engine/derive';
import { buildForRole } from '../src/engine/optimizer';
import { DEFAULT_ROLES, roleMap } from '../src/data/roles';
import type { GameData, Weapon } from '../src/types';

const data: GameData = JSON.parse(readFileSync('public/data/gamedata.json', 'utf8'));
const asgard = data.ships.find(s => s.name.includes('Asgard'))!;
const RM = roleMap(DEFAULT_ROLES);

// replicate greedy state right before the L-turret decision: engine+shields+weapons chosen
const b = buildForRole(asgard, RM['capitalkiller'], data);
const tg = asgard.groups.find(g => g.kind === 'turret' && g.size === 'l')!;
console.log('group:', JSON.stringify(tg));
const partial = { ...b.loadout };
const cands = compatible(asgard, tg, data) as Weapon[];
console.log('candidates:', cands.length);
for (const c of cands) {
  const dd = derive(asgard, { ...partial, [tg.key]: c.id }, data);
  console.log(
    c.id.padEnd(38), 'sus/ea', String(Math.round(c.sustained)).padStart(6),
    '| ship totalSus', Math.round(dd.totalSustained), '| turretSus', Math.round(dd.turretSustained),
    '| cat', c.cat, 'beam', c.beam,
  );
}
