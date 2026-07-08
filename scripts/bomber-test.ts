const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem:(k:string)=>store.get(k)??null, setItem:(k:string,v:string)=>store.set(k,v), removeItem:(k:string)=>store.delete(k) };
import { readFileSync } from 'fs';
import { evaluate } from '../src/engine/combat';
import { emptyLoadout, compatible } from '../src/engine/derive';
import { buildForRole } from '../src/engine/optimizer';
import { DEFAULT_ROLES, roleMap } from '../src/data/roles';
import type { GameData, Weapon } from '../src/types';
const data: GameData = JSON.parse(readFileSync('public/data/gamedata.json','utf8'));
const RM = roleMap(DEFAULT_ROLES);
// hand-build a torpedo bomber: Eclipse with torpedo launchers in its missile slots + brawler base
const ecl = data.ships.find(s=>s.name.startsWith('Eclipse Vanguard') && s.groups.some(g=>(g.accept??'').includes('missile')))!;
const base = buildForRole(ecl, RM['brawler'], data).loadout;
for (const g of ecl.groups) {
  if ((g.accept??'').includes('missile')) {
    const torp = (compatible(ecl,g,data) as Weapon[]).find(w=>w.name.includes('Torpedo'));
    if (torp) base[g.key]=torp.id;
  }
}
const A = { ship: ecl, loadout: base, count: 20, label: 'Eclipse torpedo bomber' };
const asg = data.ships.find(s=>s.name.includes('Asgard'))!;
const B = { ship: asg, loadout: buildForRole(asg, RM['capitalkiller'], data).loadout, count: 1, label: 'Asgard' };
for (const m of ['is','oos'] as const) {
  const r = evaluate(A,B,m,data);
  console.log(`[${m}] winner=${r.winner} dur=${Math.round(r.duration)}s losses=${r.lossesA}/${r.lossesB} bomberEffDPS=${Math.round(r.evalA.effDPS)} excluded=${r.evalA.excluded.length}`);
}
