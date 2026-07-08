const store = new Map<string,string>();
(globalThis as any).localStorage = { getItem:(k:string)=>store.get(k)??null, setItem:(k:string,v:string)=>store.set(k,v), removeItem:(k:string)=>store.delete(k) };
import { readFileSync } from 'fs';
import { compatible } from '../src/engine/derive';
import type { GameData, Weapon } from '../src/types';
const data: GameData = JSON.parse(readFileSync('public/data/gamedata.json','utf8'));
const ecl = data.ships.find(s=>s.name==='Eclipse Vanguard')!;
for (const g of ecl.groups) {
  if (g.kind!=='weapon') continue;
  const c = compatible(ecl,g,data) as Weapon[];
  console.log(g.key, g.accept, '->', c.length, 'options:', c.slice(0,4).map(w=>`${w.name} sus=${w.sustained}`));
}
