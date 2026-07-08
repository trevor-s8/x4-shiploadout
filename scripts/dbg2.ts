const store = new Map<string,string>();
(globalThis as any).localStorage = { getItem:(k:string)=>store.get(k)??null, setItem:(k:string,v:string)=>store.set(k,v), removeItem:(k:string)=>store.delete(k) };
import { readFileSync } from 'fs';
import { derive, compatible, emptyLoadout } from '../src/engine/derive';
import { buildForRole } from '../src/engine/optimizer';
import { DEFAULT_ROLES, roleMap } from '../src/data/roles';
import type { GameData, Weapon } from '../src/types';
const data: GameData = JSON.parse(readFileSync('public/data/gamedata.json','utf8'));
const asg = data.ships.find(s=>s.name.includes('Asgard'))!;
const RM = roleMap(DEFAULT_ROLES);
// rebuild greedy state before the L-turret pick: run build, then rescore that group manually
const b = buildForRole(asg, RM['capitalkiller'], data);
const g = asg.groups.find(x=>x.kind==='turret' && x.size==='l')!;
const partial: any = { ...b.loadout, [g.key]: null };
const cands = compatible(asg, g, data) as Weapon[];
for (const c of cands) {
  const d = derive(asg, { ...partial, [g.key]: c.id }, data);
  console.log(c.name.padEnd(34), 'cat', c.cat.padEnd(7), 'sus', String(Math.round(c.sustained)).padStart(5),
    '| totalSus', Math.round(d.totalSustained), '| turretSus', Math.round(d.turretSustained));
}
console.log('\nreasons:');
for (const [k, r] of Object.entries(b.reasons)) if (k.includes('turret')) console.log(' ', k, '->', b.loadout[k], '|', r);
