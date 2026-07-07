const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) };
import { readFileSync } from 'fs';
import { evaluate } from '../src/engine/combat';
import { buildForRole } from '../src/engine/optimizer';
import { DEFAULT_ROLES, roleMap } from '../src/data/roles';
import type { GameData } from '../src/types';

const data: GameData = JSON.parse(readFileSync('public/data/gamedata.json', 'utf8'));
const RM = roleMap(DEFAULT_ROLES);
const S = (name: string, role: string, count: number) => {
  const ship = data.ships.find(s => s.name.includes(name))!;
  return { ship, loadout: buildForRole(ship, RM[role], data).loadout, count, label: `${ship.name} ${role}` };
};

const show = (tag: string, a: any, b: any) => {
  for (const m of ['is', 'oos'] as const) {
    const r = evaluate(a, b, m, data);
    console.log(`${tag} [${m}] winner=${r.winner} dur=${Math.round(r.duration)}s losses=${r.lossesA}/${r.lossesB} effDPS A=${Math.round(r.evalA.effDPS)} B=${Math.round(r.evalB.effDPS)} ttkA1v1=${r.ttkSingleAB?.toFixed(0)}s`);
  }
};

// 1) mirror match sanity
show('Behemoth mirror 1v1', S('Behemoth', 'capitalkiller', 1), S('Behemoth', 'capitalkiller', 1));
// 2) bombers vs capital: 20 heavy fighters vs 1 Asgard
show('20 Eclipse vs Asgard', S('Eclipse', 'brawler', 20), S('Asgard', 'capitalkiller', 1));
// 3) fast interceptor vs destroyer turrets: IS should favor fighter evasion; OOS speed evasion
show('5 Pulsar vs Behemoth', S('Pulsar', 'interceptor', 5), S('Behemoth', 'capitalkiller', 1));
// 4) turret-reliant ship OOS penalty: check effDPS drop between modes for a carrier
const carrier = S('Raptor', 'carrier', 1); const kA = S('Behemoth', 'capitalkiller', 1);
const is1 = evaluate(carrier, kA, 'is', data), oos1 = evaluate(carrier, kA, 'oos', data);
console.log('Raptor turret DPS IS vs OOS:', Math.round(is1.evalA.effDPS), 'vs', Math.round(oos1.evalA.effDPS), '(expect big OOS drop)');
// 5) hit table sample: what evades what
const r = evaluate(S('Behemoth', 'capitalkiller', 1), S('Pulsar', 'interceptor', 1), 'is', data);
for (const g of r.evalA.groups) console.log('  Behemoth', g.name, 'hit', Math.round(g.hit * 100) + '%', 'vs Pulsar');
