import { useEffect, useMemo, useState } from 'react';
import type { GameData, Ship, Loadout, Derived, Weapon } from '../types';
import type { RoleFit } from '../engine/optimizer';
import { roleMap, type Role } from '../data/roles';
import { SIZE_LABEL, CLASS_LABEL, CLASS_GROUPS, UNPLAYABLE_SHIP_IDS, fmt } from '../format';
import { compatible, derive, emptyLoadout } from '../engine/derive';

const SIZES = ['s', 'm', 'l', 'xl'] as const;
/** Sentinel value for the faction dropdown's "Playable" entry — filters out the ships that
 *  exist in the data but aren't flyable by the player in vanilla (all Kha'ak, plus the Xenon
 *  hulls with no capture path). See UNPLAYABLE_SHIP_IDS in format.ts for the sourced list. */
const PLAYABLE_FILTER = '__playable__';

interface StatSort {
  id: string; label: string; get: (s: Ship, ctx: SortCtx) => number; fmt: (v: number) => string; tip?: string;
  /** Which slot kind's equipped module(s) actually drive this number — shown on hover so
   *  "(best build)" isn't a black box. Omitted for raw hull stats that aren't module-driven. */
  driverKind?: 'engine' | 'weapon' | 'turret' | 'shield';
}
interface SortCtx {
  bestDerived: Map<string, Derived>; bestMiningDerived: Map<string, Derived>;
  bestLoadouts: Map<string, Loadout>; bestMiningLoadouts: Map<string, Loadout>; data: GameData;
}

/** Resolves the equipped module name(s) of a given slot kind in a loadout, for the "assumes
 *  this module" hover text on best-build stat sorts. Multiple distinct modules (e.g. two
 *  different weapon hardpoints picking different guns) are joined, deduped. */
function driverModuleNames(loadout: Loadout, ship: Ship, kind: 'engine' | 'weapon' | 'turret' | 'shield', data: GameData): string {
  const pools: Record<string, { id: string; name: string }[]> = {
    engine: data.engines, shield: data.shields, weapon: data.weapons, turret: data.weapons,
  };
  const byId = new Map(pools[kind].map(m => [m.id, m.name]));
  const names = new Set<string>();
  for (const g of ship.groups) {
    if (g.kind !== kind) continue;
    const modId = loadout[g.key];
    const name = modId && byId.get(modId);
    if (name) names.add(name);
  }
  return [...names].join(', ') || '—';
}

/** Best-effort "what's the strongest build this hull could carry" loadout, used only for
 *  browse-time sorting (no role weighting yet — that needs a chosen role). Greedy per slot:
 *  engines/shields pick the highest raw stat; weapons/turrets prefer combat-capable modules
 *  and pick the highest sustained DPS, falling back to mining/missile output on slots that
 *  only accept those. This mirrors the ad-hoc "best engine" logic the browser already used
 *  for top/travel speed, generalized to every derived stat via the real derive() engine. */
function bestEffortLoadout(ship: Ship, data: GameData): Loadout {
  const loadout = emptyLoadout(ship);
  for (const g of ship.groups) {
    const cands = compatible(ship, g, data);
    if (!cands.length) continue;
    if (g.kind === 'engine') {
      loadout[g.key] = cands.reduce((a, b) => ('thrust' in b && 'thrust' in a && b.thrust > a.thrust ? b : a)).id;
    } else if (g.kind === 'shield') {
      loadout[g.key] = cands.reduce((a, b) => ('cap' in b && 'cap' in a && b.cap > a.cap ? b : a)).id;
    } else {
      const ws = cands as Weapon[];
      const combat = ws.filter(w => w.cat === 'combat');
      const pool = combat.length ? combat : ws;
      loadout[g.key] = pool.reduce((a, b) => (b.sustained > a.sustained ? b : a)).id;
    }
  }
  return loadout;
}

/** Same idea as bestEffortLoadout, but for slots that accept mining gear, prefers the
 *  mining module over combat — used only for the mining-focused stat sorts, since a
 *  general "best fit" loadout should default to combat (mining is the minority use case
 *  for most combat+mining hardpoints on non-dedicated-miner hulls). */
function bestMiningLoadout(ship: Ship, data: GameData): Loadout {
  const loadout = emptyLoadout(ship);
  for (const g of ship.groups) {
    const cands = compatible(ship, g, data);
    if (!cands.length) continue;
    if (g.kind === 'engine') {
      loadout[g.key] = cands.reduce((a, b) => ('thrust' in b && 'thrust' in a && b.thrust > a.thrust ? b : a)).id;
    } else if (g.kind === 'shield') {
      loadout[g.key] = cands.reduce((a, b) => ('cap' in b && 'cap' in a && b.cap > a.cap ? b : a)).id;
    } else {
      const ws = cands as Weapon[];
      const mining = ws.filter(w => w.cat === 'mining');
      if (mining.length) {
        loadout[g.key] = mining.reduce((a, b) => (b.damage > a.damage ? b : a)).id;
      } else {
        const combat = ws.filter(w => w.cat === 'combat');
        const pool = combat.length ? combat : ws;
        loadout[g.key] = pool.reduce((a, b) => (b.sustained > a.sustained ? b : a)).id;
      }
    }
  }
  return loadout;
}

const MINING_SIZE_KM = 100; // matches the "per 100km" framing requested for mining efficiency

/** Hover text for a best-build stat's value cell: which module(s) that number assumes. */
function driverTooltip(stat: StatSort, s: Ship, c: SortCtx): string | undefined {
  if (!stat.driverKind) return stat.tip;
  const isMining = stat.id === 'miningEff100' || stat.id === 'miningDPS';
  const loadout = (isMining ? c.bestMiningLoadouts : c.bestLoadouts).get(s.id);
  if (!loadout) return stat.tip;
  const modules = driverModuleNames(loadout, s, stat.driverKind, c.data);
  const base = `Assumes: ${modules}`;
  return stat.tip ? `${stat.tip} ${base}` : base;
}

const STAT_SORTS: StatSort[] = [
  { id: 'hull', label: 'Hull', get: s => s.hull, fmt: v => fmt.big(v) },
  { id: 'cargo', label: 'Cargo', get: s => s.cargo, fmt: v => `${fmt.big(v)} m³` },
  { id: 'crew', label: 'Crew', get: s => s.people, fmt: v => fmt.n(v) },
  // ---- mobility (best-build loadout) ----
  { id: 'topSpeed', label: 'Top speed (best build)', driverKind: 'engine', get: (s, c) => c.bestDerived.get(s.id)?.topSpeed ?? 0, fmt: v => fmt.speed(v) },
  { id: 'boostSpeed', label: 'Boost speed (best build)', driverKind: 'engine', get: (s, c) => c.bestDerived.get(s.id)?.boostSpeed ?? 0, fmt: v => fmt.speed(v) },
  { id: 'travelSpeed', label: 'Travel speed (best build)', driverKind: 'engine', get: (s, c) => c.bestDerived.get(s.id)?.travelSpeed ?? 0, fmt: v => fmt.speed(v) },
  { id: 'accel', label: 'Acceleration (best build)', driverKind: 'engine', get: (s, c) => c.bestDerived.get(s.id)?.accel ?? 0, fmt: v => fmt.n(v, 1) },
  { id: 'turn', label: 'Agility (best build)', driverKind: 'engine', get: (s, c) => c.bestDerived.get(s.id)?.turn ?? 0, fmt: v => fmt.n(v, 1) },
  { id: 'cross100', label: '100 km sprint (best build)', driverKind: 'engine', get: (s, c) => -(c.bestDerived.get(s.id)?.cross100 ?? 0), fmt: v => fmt.time(-v) },
  { id: 'cross50', label: '50 km hop (best build)', driverKind: 'engine', get: (s, c) => -(c.bestDerived.get(s.id)?.cross50 ?? 0), fmt: v => fmt.time(-v) },
  // ---- combat (best-build loadout) ----
  { id: 'totalSustained', label: 'Total sustained DPS (best build)', driverKind: 'weapon', get: (s, c) => c.bestDerived.get(s.id)?.totalSustained ?? 0, fmt: v => fmt.big(v) },
  { id: 'alpha', label: 'Volley damage (best build)', driverKind: 'weapon', get: (s, c) => c.bestDerived.get(s.id)?.alpha ?? 0, fmt: v => fmt.big(v) },
  { id: 'range', label: 'Max weapon range (best build)', driverKind: 'weapon', get: (s, c) => c.bestDerived.get(s.id)?.range ?? 0, fmt: v => fmt.dist(v) },
  { id: 'turretTrack', label: 'Turret tracking (best build)', driverKind: 'turret', get: (s, c) => c.bestDerived.get(s.id)?.turretTrack ?? 0, fmt: v => `${fmt.n(v)}°/s` },
  { id: 'ehp', label: 'Effective HP (best build)', driverKind: 'shield', get: (s, c) => c.bestDerived.get(s.id)?.ehp ?? 0, fmt: v => fmt.big(v) },
  { id: 'shieldRate', label: 'Shield regen (best build)', driverKind: 'shield', get: (s, c) => c.bestDerived.get(s.id)?.shieldRate ?? 0, fmt: v => `${fmt.big(v)}/s` },
  // ---- mining (best-build loadout) ----
  {
    id: 'miningEff100', label: 'Mining efficiency /100km', driverKind: 'weapon', tip: 'Cargo hold × mining output, discounted by the round-trip time to haul 100 km back to a station. Rewards miners that combine strong lasers with enough cargo and speed to keep the loop short.',
    get: (s, c) => {
      const d = c.bestMiningDerived.get(s.id);
      if (!d || !isFinite(d.miningDPS) || d.miningDPS <= 0 || !isFinite(d.cross100) || d.cross100 <= 0) return -Infinity;
      // yield-rate proxy: (mining DPS * cargo) amortized over a 100km round trip (there and back)
      return (d.miningDPS * s.cargo) / (d.cross100 * 2) / MINING_SIZE_KM;
    },
    fmt: v => (isFinite(v) && v > -Infinity ? `${fmt.big(v)} /km` : '—'),
  },
  { id: 'miningDPS', label: 'Mining laser output (best build)', driverKind: 'weapon', get: (s, c) => c.bestMiningDerived.get(s.id)?.miningDPS ?? 0, fmt: v => fmt.big(v) },
];

export default function ShipBrowser({ data, fits, roles, onOpen }: {
  data: GameData;
  fits: Map<string, RoleFit[]> | null;
  roles: Role[];
  onOpen: (id: string) => void;
}) {
  const ROLE_MAP = roleMap(roles);
  const sortCtx = useMemo<SortCtx>(() => {
    const bestDerived = new Map<string, Derived>();
    const bestMiningDerived = new Map<string, Derived>();
    const bestLoadouts = new Map<string, Loadout>();
    const bestMiningLoadouts = new Map<string, Loadout>();
    for (const s of data.ships) {
      const bl = bestEffortLoadout(s, data);
      const bml = bestMiningLoadout(s, data);
      bestLoadouts.set(s.id, bl);
      bestMiningLoadouts.set(s.id, bml);
      bestDerived.set(s.id, derive(s, bl, data));
      bestMiningDerived.set(s.id, derive(s, bml, data));
    }
    return { bestDerived, bestMiningDerived, bestLoadouts, bestMiningLoadouts, data };
  }, [data]);
  const [q, setQ] = useState('');
  const [size, setSize] = useState('');
  const [cls, setCls] = useState('');
  const [faction, setFaction] = useState('');
  const [roleSort, setRoleSort] = useState('');
  const statSort = STAT_SORTS.find(x => x.id === roleSort) ?? null;
  const [view, setView] = useState<'grid' | 'list'>(() =>
    (localStorage.getItem('x4lp-browser-view') as 'grid' | 'list') ?? 'grid');
  const setViewPersist = (v: 'grid' | 'list') => { setView(v); try { localStorage.setItem('x4lp-browser-view', v); } catch { /* ignore */ } };

  // ---- cascading facets: each dropdown only offers values that exist among
  // ships matching ALL OTHER active filters, so no combination dead-ends ----
  const matches = (s: Ship, f: { q?: boolean; size?: boolean; cls?: boolean; faction?: boolean }) =>
    (!f.q || !q || s.name.toLowerCase().includes(q.toLowerCase())) &&
    (!f.size || !size || s.size === size) &&
    (!f.cls || !cls || s.class === cls) &&
    (!f.faction || !faction || (faction === PLAYABLE_FILTER ? !UNPLAYABLE_SHIP_IDS.has(s.id) : s.factions.includes(faction)));

  const availSizes = useMemo(() =>
    SIZES.filter(sz => data.ships.some(s => s.size === sz && matches(s, { q: true, cls: true, faction: true }))),
    [data, q, cls, faction]);
  const availClasses = useMemo(() =>
    new Set(data.ships.filter(s => matches(s, { q: true, size: true, faction: true })).map(s => s.class)),
    [data, q, size, faction]);
  const availFactions = useMemo(() => {
    const ids = new Set<string>();
    data.ships.filter(s => matches(s, { q: true, size: true, cls: true })).forEach(s => s.factions.forEach(f => ids.add(f)));
    return [...ids].sort((a, b) => (data.factions[a] ?? a).localeCompare(data.factions[b] ?? b));
  }, [data, q, size, cls]);

  const ships = useMemo(() => {
    let list = data.ships.filter(s => matches(s, { q: true, size: true, cls: true, faction: true }));
    const ssort = STAT_SORTS.find(x => x.id === roleSort);
    if (ssort) {
      list = [...list].sort((a, b) => ssort.get(b, sortCtx) - ssort.get(a, sortCtx) || a.name.localeCompare(b.name));
    } else if (roleSort && fits) {
      const score = (id: string) => fits.get(id)?.find(f => f.roleId === roleSort)?.score ?? -1;
      list = [...list].sort((a, b) => score(b.id) - score(a.id) || a.name.localeCompare(b.name));
    } else {
      list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    }
    return list;
  }, [data, q, size, cls, faction, roleSort, fits, sortCtx]);

  // roles that at least one currently-listed ship can actually perform
  const availRoles = useMemo(() => {
    if (!fits) return roles;
    const present = new Set<string>();
    for (const s of ships) for (const f of fits.get(s.id) ?? []) present.add(f.roleId);
    return roles.filter(r => present.has(r.id));
  }, [roles, fits, ships]);

  // auto-clear any selection its own facet no longer offers
  useEffect(() => { if (size && !availSizes.includes(size as typeof SIZES[number])) setSize(''); }, [size, availSizes]);
  useEffect(() => { if (cls && !availClasses.has(cls)) setCls(''); }, [cls, availClasses]);
  useEffect(() => { if (faction && faction !== PLAYABLE_FILTER && !availFactions.includes(faction)) setFaction(''); }, [faction, availFactions]);
  useEffect(() => {
    if (!roleSort || !fits) return;
    const isStat = STAT_SORTS.some(x => x.id === roleSort);
    if (!isStat && !availRoles.some(r => r.id === roleSort)) setRoleSort('');
  }, [roleSort, availRoles, fits]);

  const topFits = (s: Ship) => fits?.get(s.id)?.filter(x => x.score >= 40).slice(0, 3) ?? [];
  const sortScore = (s: Ship) => fits?.get(s.id)?.find(f => f.roleId === roleSort)?.score;

  const chips = (s: Ship) => {
    const f = topFits(s);
    return (
      <div className="chips">
        {f.map(x => (
          <span key={x.roleId} className="chip tt" data-tip={ROLE_MAP[x.roleId]?.desc ?? ''}>
            {ROLE_MAP[x.roleId]?.name.split(' / ')[0] ?? x.roleId} <b>{x.score}</b>
          </span>
        ))}
        {fits && f.length === 0 && <span className="chip dim">No strong role fit</span>}
      </div>
    );
  };

  return (
    <main className="browser">
      <div className="filters">
        <input placeholder="Search ships…" value={q} onChange={e => setQ(e.target.value)} />
        <select value={size} onChange={e => setSize(e.target.value)}>
          <option value="">All sizes</option>
          {availSizes.map(s => <option key={s} value={s}>{SIZE_LABEL[s]}</option>)}
        </select>
        <select value={cls} onChange={e => setCls(e.target.value)}>
          <option value="">All classes</option>
          {CLASS_GROUPS.map(([label, classes]) => {
            const present = classes.filter(c => availClasses.has(c));
            return present.length ? (
              <optgroup key={label} label={label}>
                {present.map(c => <option key={c} value={c}>{CLASS_LABEL[c] ?? c}</option>)}
              </optgroup>
            ) : null;
          })}
        </select>
        <select value={faction} onChange={e => setFaction(e.target.value)}
          title="Playable hides ships you can't own and fly in vanilla: all Kha'ak, and the Xenon hulls with no capture path (N, M, P, T, S, K, I, M0). The capturable Xenon — F, B, PE, SE, and the boardable H — stay in.">
          <option value="">All factions</option>
          <option value={PLAYABLE_FILTER}>Playable</option>
          {availFactions.map(f => <option key={f} value={f}>{data.factions[f] ?? f}</option>)}
        </select>
        <select value={roleSort} onChange={e => setRoleSort(e.target.value)} title={STAT_SORTS.find(x => x.id === roleSort)?.tip}>
          <optgroup label="Default">
            <option value="">Sort: name</option>
          </optgroup>
          <optgroup label="General">
            {STAT_SORTS.filter(x => ['hull', 'cargo', 'crew'].includes(x.id)).map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
          </optgroup>
          <optgroup label="Mobility">
            {STAT_SORTS.filter(x => ['topSpeed', 'boostSpeed', 'travelSpeed', 'accel', 'turn', 'cross100', 'cross50'].includes(x.id)).map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
          </optgroup>
          <optgroup label="Combat">
            {STAT_SORTS.filter(x => ['totalSustained', 'alpha', 'range', 'turretTrack', 'ehp', 'shieldRate'].includes(x.id)).map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
          </optgroup>
          <optgroup label="Mining">
            {STAT_SORTS.filter(x => ['miningEff100', 'miningDPS'].includes(x.id)).map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
          </optgroup>
          <optgroup label="By role fit (Beta)">
            {availRoles.map(r => <option key={r.id} value={r.id}>Best: {r.name}</option>)}
          </optgroup>
        </select>
        <div className="view-toggle" role="group" aria-label="View">
          <button className={view === 'grid' ? 'active' : ''} onClick={() => setViewPersist('grid')}>▦ Grid</button>
          <button className={view === 'list' ? 'active' : ''} onClick={() => setViewPersist('list')}>☰ List</button>
        </div>
      </div>
      {!fits && <div className="hint">Scoring role builds for all {data.ships.length} ships…</div>}
      <div className="result-count">{ships.length} ship{ships.length === 1 ? '' : 's'}</div>

      {view === 'grid' ? (
        <div className="grid">
          {ships.map(s => (
            <button key={s.id} className="card" onClick={() => onOpen(s.id)}>
              <div className="card-head">
                <span className="card-name">{s.name}</span>
                <span className="badge size">{SIZE_LABEL[s.size]}</span>
              </div>
              <div className="card-sub">
                <span>{CLASS_LABEL[s.class] ?? s.class}</span>
                {s.dlc !== 'Base' && <span className="badge dlc">{s.dlc}</span>}
                {statSort && <span className="fit-cell tt" data-tip={driverTooltip(statSort, s, sortCtx)}>{statSort.fmt(statSort.get(s, sortCtx))}</span>}
              </div>
              {chips(s)}
            </button>
          ))}
        </div>
      ) : (
        <div className="compare-scroll">
          <table className="ship-table">
            <thead>
              <tr>
                <th className="left">Ship</th>
                <th>Size</th>
                <th className="left">Class</th>
                {statSort && <th>{statSort.label}</th>}
                {roleSort && !statSort && <th>{ROLE_MAP[roleSort]?.name.split(' / ')[0] ?? 'Fit'}</th>}
                <th className="left">Best roles</th>
              </tr>
            </thead>
            <tbody>
              {ships.map(s => (
                <tr key={s.id} onClick={() => onOpen(s.id)} tabIndex={0}
                  onKeyDown={e => { if (e.key === 'Enter') onOpen(s.id); }}>
                  <td className="left name-cell">{s.name}</td>
                  <td><span className="badge size">{SIZE_LABEL[s.size]}</span></td>
                  <td className="left">{CLASS_LABEL[s.class] ?? s.class}</td>
                  {statSort && <td className="fit-cell tt" data-tip={driverTooltip(statSort, s, sortCtx)}>{statSort.fmt(statSort.get(s, sortCtx))}</td>}
                  {roleSort && !statSort && <td className="fit-cell">{sortScore(s) ?? '—'}</td>}
                  <td className="left">{chips(s)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
