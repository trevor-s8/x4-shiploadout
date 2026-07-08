const store = new Map<string,string>();
(globalThis as any).localStorage = { getItem:(k:string)=>store.get(k)??null, setItem:(k:string,v:string)=>store.set(k,v), removeItem:(k:string)=>store.delete(k) };
import { readFileSync } from 'fs';
import { computeRoleFits, buildForRole } from '../src/engine/optimizer';
import { DEFAULT_ROLES, roleMap } from '../src/data/roles';
import type { GameData } from '../src/types';
const data: GameData = JSON.parse(readFileSync('public/data/gamedata.json','utf8'));
const RM = roleMap(DEFAULT_ROLES);
const fits = computeRoleFits(data, DEFAULT_ROLES);
const ship = (n: string) => data.ships.find(s => s.name.startsWith(n))!;
const chips = (n: string) => (fits.get(ship(n).id) ?? []).filter(f=>f.score>=40).map(f=>`${f.roleId}:${f.score}`).join(' ') || '(none)';
console.log('Dolphin:', chips('Dolphin'));
console.log('Hyperion:', chips('Hyperion'));
console.log('Mercury Vanguard:', chips('Mercury Vanguard'));
// carrier leaderboard
const carriers = data.ships.filter(s=>s.class==='carrier');
const cscore = (s:any)=>fits.get(s.id)?.find((f:any)=>f.roleId==='carrier')?.score ?? -1;
console.log('Carriers ranked:', carriers.map(s=>`${s.name}:${cscore(s)}`).sort((a,b)=>Number(b.split(':')[1])-Number(a.split(':')[1])).join(' | '));
// Asgard capital hunter turrets
const asg = ship('Asgard');
const bk = buildForRole(asg, RM['capitalkiller'], data);
console.log('Asgard L turret:', bk.loadout['turret_l_combat+missile'], '| M turret:', bk.loadout['turret_m_combat+missile']);
// Ares sniper: mass driver must beat boson lance
const ares = ship('Ares');
const sn = buildForRole(ares, RM['sniper'], data);
console.log('Ares sniper guns:', Object.entries(sn.loadout).filter(([k,v])=>k.startsWith('weapon')&&v).map(([,v])=>v).join(', '));
// antifighter destroyer: expect flak/pulse/tracking-capable combat turrets, not dumbfire
const beh = ship('Behemoth');
const af = buildForRole(beh, RM['antifighter'], data);
console.log('Behemoth antifighter M turret:', af.loadout['turret_m_combat+missile']);
console.log('Behemoth antifighter w/ prefer-missiles:', buildForRole(beh, RM['antifighter'], data, 'prefer').loadout['turret_m_combat+missile']);
// new roles validation
const chim = data.ships.find(s=>s.name.startsWith('Chimera'))!;
const bm = buildForRole(chim, RM['bomber'], data, 'prefer');
console.log('Chimera bomber:', Object.entries(bm.loadout).filter(([k,v])=>k.startsWith('weapon')&&v).map(([,v])=>v).join(', '));
const cobra = data.ships.find(s=>s.name.startsWith('Cobra'))!;
console.log('Cobra boarding fits:', (fits.get(cobra.id)??[]).slice(0,3).map(f=>`${f.roleId}:${f.score}`).join(' '));
