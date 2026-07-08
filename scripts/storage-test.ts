// localStorage shim for node
const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => store.set(k, v),
  removeItem: (k: string) => store.delete(k),
};
import { readFileSync } from 'fs';
import { saveBuild, loadBuilds, importFile } from '../src/storage';
import { loadOverrides } from '../src/data/roles';
import type { GameData } from '../src/types';

const data: GameData = JSON.parse(readFileSync('public/data/gamedata.json', 'utf8'));
const pulsar = data.ships.find(s => s.name.includes('Pulsar'))!;

// save two builds
const b1 = saveBuild({ name: 'Pulsar Interceptor', shipId: pulsar.id, loadout: { engine: 'engine_spl_s_combat_01_mk4' }, roleId: 'interceptor' });
saveBuild({ name: 'Custom thing', shipId: pulsar.id, loadout: { engine: null }, roleId: null });
console.log('saved:', loadBuilds().length);

// simulate a full backup file and re-import (ids collide -> should re-id, add 2)
const backup = { kind: 'x4lp-backup', version: 1, exportedAt: '', gameVersion: '9.0.0.0',
  builds: loadBuilds(), roleOverrides: { interceptor: { weights: { topSpeed: 0.5 }, inverted: [] }, bogusrole: { weights: {}, inverted: [] } } };
const r1 = importFile(JSON.stringify(backup), data, new Set(['interceptor', 'brawler']));
console.log('backup import:', JSON.stringify(r1), '| builds now', loadBuilds().length, '| override applied:', !!loadOverrides()['interceptor'], '| bogus skipped:', !('bogusrole' in loadOverrides()));

// single build file with unknown ship -> skipped
const bad = { kind: 'x4lp-build', version: 1, exportedAt: '', gameVersion: '', build: { ...b1, shipId: 'ship_fake_zz' } };
console.log('bad ship import:', JSON.stringify(importFile(JSON.stringify(bad), data, new Set())));

// single role file
const rf = { kind: 'x4lp-role', version: 1, exportedAt: '', gameVersion: '', roleId: 'brawler', name: 'Brawler', override: { weights: { ehp: 1 }, inverted: [] } };
console.log('role import:', JSON.stringify(importFile(JSON.stringify(rf), data, new Set(['brawler']))), '| brawler override:', !!loadOverrides()['brawler']);

// garbage
console.log('garbage:', JSON.stringify(importFile('not json{', data, new Set())));
console.log('wrong kind:', JSON.stringify(importFile('{"kind":"other"}', data, new Set())));
