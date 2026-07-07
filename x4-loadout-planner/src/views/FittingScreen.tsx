import { useMemo, useState } from 'react';
import type { GameData, Ship, Loadout, Module, Derived, Weapon, Engine, Shield, SlotGroup } from '../types';
import { compatible, derive, emptyLoadout } from '../engine/derive';
import { buildForRole, type RoleFit, type MissilePref } from '../engine/optimizer';
import { roleMap, type Role } from '../data/roles';
import { STAT_SECTIONS, SIZE_LABEL, RACE_LABEL, CLASS_LABEL, fmt } from '../format';
import { encodeBuild, type CompareEntry } from '../App';
import { saveBuild, exportBuild, loadBuilds, type SavedBuild } from '../storage';

const RACK_ORDER: SlotGroup['kind'][] = ['engine', 'weapon', 'turret', 'shield'];
const RACK_HEADER = { engine: 'Engines', weapon: 'Weapons', turret: 'Turrets', shield: 'Shields' } as const;

// REMOVAL CANDIDATE: the Missiles auto/prefer/avoid control is hidden until we decide whether
// missile loadouts stay in the planner long-term. Flip to true to bring the UI back.
const SHOW_MISSILE_PREF = false;

// ---- module scan-grid ----------------------------------------------------

function ModStats({ m, ship, engineCount }: { m: Module; ship: Ship; engineCount: number }) {
  const cells: [string, string][] = [];
  if ('thrust' in m) {
    // show what this engine DOES to this hull, in the same language as the readout panel
    const e = m as Engine;
    const top = (e.thrust * engineCount) / ship.dragFwd;
    cells.push(
      ['Top speed', fmt.speed(top)],
      ['Travel speed', fmt.speed(top * e.travelMult)],
      ['Boost speed', fmt.speed(top * e.boostMult)],
      ['Travel engage', fmt.time(e.travelCharge)],
      ['Full spool', fmt.time(e.travelCharge + e.travelAttack)],
    );
  } else if ('cap' in m) {
    const s = m as Shield;
    cells.push(['Capacity', fmt.big(s.cap)], ['Regen', `${fmt.big(s.rate)}/s`], ['Delay', fmt.time(s.delay)]);
  } else {
    const w = m as Weapon;
    if (w.cat === 'missile') {
      cells.push(['Ammo', String(w.ammo)], ['Reload', fmt.time(w.ammoReload)],
        ['DPS', w.supp ? `≈${fmt.big(w.sustained)}` : 'n/a *']);
      if (!w.beam && w.speed > 0 && w.supp) cells.push(['Missile', fmt.speed(w.speed)]);
    } else if (w.noDmg) {
      cells.push(['DPS', 'n/a *'], ['Range', w.beam ? 'beam' : fmt.dist(w.range)], ['Shot', fmt.speed(w.speed)]);
      if (w.mount === 'turret' && w.rot) cells.push(['Track', `${fmt.n(w.rot)}°/s`]);
    } else {
      cells.push(['DPS', `${w.supp ? '≈' : ''}${fmt.big(w.sustained)}`]);
      if (w.duty < 1) cells.push(['Burst', fmt.big(w.burst)]);
      cells.push(['Range', w.beam ? 'beam' : fmt.dist(w.range)], ['Shot', w.beam ? 'instant' : fmt.speed(w.speed)]);
      if (w.mount === 'turret' && w.rot) cells.push(['Track', `${fmt.n(w.rot)}°/s`]);
    }
  }
  return (
    <span className="mod-grid">
      {cells.map(([k, v]) => <span key={k} className="mg"><i>{k}</i><b>{v}</b></span>)}
    </span>
  );
}

// ---- picker sort/filter ---------------------------------------------------

interface SortOpt { id: string; label: string; get: (m: Module) => number | string; desc?: boolean }

function sortOptions(kind: SlotGroup['kind']): SortOpt[] {
  const name: SortOpt = { id: 'name', label: 'Name', get: m => m.name };
  if (kind === 'engine') return [
    name,
    { id: 'top', label: 'Top speed', get: m => (m as Engine).thrust, desc: true },
    { id: 'travel', label: 'Travel speed', get: m => (m as Engine).thrust * (m as Engine).travelMult, desc: true },
    { id: 'boostS', label: 'Boost speed', get: m => (m as Engine).thrust * (m as Engine).boostMult, desc: true },
    { id: 'engage', label: 'Travel engage', get: m => (m as Engine).travelCharge },
    { id: 'spool', label: 'Full spool time', get: m => (m as Engine).travelCharge + (m as Engine).travelAttack },
    { id: 'boostDur', label: 'Boost duration', get: m => (m as Engine).boostDur, desc: true },
  ];
  if (kind === 'shield') return [
    name,
    { id: 'cap', label: 'Capacity', get: m => (m as Shield).cap, desc: true },
    { id: 'rate', label: 'Regen', get: m => (m as Shield).rate, desc: true },
    { id: 'delay', label: 'Recharge delay', get: m => (m as Shield).delay },
  ];
  const opts: SortOpt[] = [
    name,
    { id: 'sustained', label: 'Sustained DPS', get: m => (m as Weapon).sustained, desc: true },
    { id: 'burst', label: 'Burst DPS', get: m => (m as Weapon).burst, desc: true },
    { id: 'alpha', label: 'Damage per shot', get: m => { const w = m as Weapon; return w.rate > 0 ? w.burst / w.rate : w.damage; }, desc: true },
    { id: 'range', label: 'Range', get: m => (m as Weapon).range, desc: true },
    { id: 'speed', label: 'Shot speed', get: m => (m as Weapon).speed, desc: true },
  ];
  if (kind === 'turret') opts.push({ id: 'rot', label: 'Tracking', get: m => (m as Weapon).rot, desc: true });
  return opts;
}

// ---- stat relevance: stable per ship, independent of loadout/preview ------

function relevantStats(ship: Ship): Set<keyof Derived> {
  const r = new Set<keyof Derived>(['hull', 'ehp', 'ehp60', 'turn']);
  const kinds = new Set(ship.groups.map(g => g.kind));
  const accepts = ship.groups.map(g => g.accept ?? '');
  if (kinds.has('engine')) ['topSpeed', 'boostSpeed', 'travelSpeed', 'travelEngage', 'travelFull', 'travelDist', 'cross100', 'accel', 'boostDur'].forEach(k => r.add(k as keyof Derived));
  if (kinds.has('shield')) ['shieldCap', 'shieldRate', 'shieldDelay'].forEach(k => r.add(k as keyof Derived));
  if (ship.groups.some(g => g.kind === 'shield' && g.size !== ship.size)) r.add('surfaceShields');
  const hasCombatGuns = ship.groups.some(g => g.kind === 'weapon' && (!g.accept || g.accept.includes('combat') || g.accept.startsWith('special')));
  if (hasCombatGuns) ['burstDPS', 'sustainedDPS', 'alpha', 'range', 'projSpeed'].forEach(k => r.add(k as keyof Derived));
  if (kinds.has('turret')) ['turretDPS', 'turretSustained', 'turretTrack'].forEach(k => r.add(k as keyof Derived));
  if (hasCombatGuns || kinds.has('turret')) r.add('totalSustained');
  if (accepts.some(a => a.includes('mining'))) r.add('miningDPS');
  if (ship.missiles > 0) r.add('missileCapacity');
  if (accepts.some(a => a.includes('missile'))) r.add('missileDPS');
  if (ship.cargo > 0) r.add('cargo');
  if (ship.people > 0) r.add('people');
  if (Object.values(ship.docks).reduce((a, b) => a + b, 0) > 0) r.add('dockCap');
  if (ship.cms > 0) r.add('cms');
  return r;
}

// ---------------------------------------------------------------------------

interface Preset { roleId: string; name: string; loadout: Loadout; reasons: Record<string, string> }

export default function FittingScreen({ data, ship, fits, roles, initial, onAddCompare, onGoCompare, onSwitchBuild }: {
  data: GameData; ship: Ship; fits: RoleFit[]; roles: Role[]; initial?: Loadout;
  onAddCompare: (e: CompareEntry) => void; onGoCompare: () => void; onSwitchBuild: (b: SavedBuild) => void;
}) {
  const roleM = useMemo(() => roleMap(roles), [roles]);
  const draftKey = `x4lp-draft-${ship.id}`;
  const [loadout, setLoadoutRaw] = useState<Loadout>(() => {
    if (initial) return initial;
    try {
      const d = localStorage.getItem(draftKey);
      if (d) return { ...emptyLoadout(ship), ...JSON.parse(d) };
    } catch { /* ignore */ }
    return emptyLoadout(ship);
  });
  const setLoadout = (fn: Loadout | ((l: Loadout) => Loadout)) => {
    setLoadoutRaw(prev => {
      const next = typeof fn === 'function' ? fn(prev) : fn;
      try { localStorage.setItem(draftKey, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };
  const [activeGroup, setActiveGroup] = useState<string | null>(ship.groups[0]?.key ?? null);
  const [hoverId, setHoverId] = useState<string | null | undefined>(undefined);
  const [preset, setPreset] = useState<Preset | null>(null);
  const [copied, setCopied] = useState(false);
  const [savedMsg, setSavedMsg] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const [pickQ, setPickQ] = useState('');
  const [pickRace, setPickRace] = useState('');
  const [pickSort, setPickSort] = useState('name');
  const [pickDir, setPickDir] = useState<1 | -1 | 0>(0); // 0 = option default
  const [missilePref, setMissilePref] = useState<MissilePref>('auto');
  const [statMode, setStatMode] = useState<'is' | 'oos'>('is');
  // re-read whenever savedMsg flips true (a save just happened on this screen) so a build the
  // user just saved shows up in "Load saved build" without needing to leave and come back
  const savedBuilds = useMemo(() => loadBuilds(), [savedMsg]);
  const thisShipBuilds = useMemo(() => savedBuilds.filter(b => b.shipId === ship.id), [savedBuilds, ship.id]);
  const d = useMemo(() => derive(ship, loadout, data), [ship, loadout, data]);
  const group = ship.groups.find(g => g.key === activeGroup) ?? null;
  const preview = useMemo(() => {
    if (hoverId === undefined || !group) return null;
    if (hoverId === (loadout[group.key] ?? null)) return null;
    return derive(ship, { ...loadout, [group.key]: hoverId }, data);
  }, [hoverId, group, ship, loadout, data]);

  const relevant = useMemo(() => relevantStats(ship), [ship]);
  // OOS view: turrets fire ~30% of the time in low attention; forward guns hit ~90% baseline.
  const OOS_MULT: Partial<Record<keyof Derived, number>> = {
    burstDPS: 0.9, sustainedDPS: 0.9, alpha: 0.9, missileDPS: 0.9,
    turretDPS: 0.27, turretSustained: 0.27, // 0.30 fire chance × 0.90 hit
    totalSustained: NaN, // recomputed below from its parts
  };
  const statView = (key: keyof Derived, from: Derived): number => {
    const v = from[key] as number;
    if (statMode === 'is') return v;
    if (key === 'totalSustained') return (from.sustainedDPS * 0.9) + (from.turretSustained * 0.27);
    const m = OOS_MULT[key];
    return m !== undefined && isFinite(m) ? v * m : v;
  };

  const candidates = useMemo(() => (group ? compatible(ship, group, data) : []), [group, ship, data]);
  const races = useMemo(() => [...new Set(candidates.map(c => c.race))].sort(), [candidates]);
  const sortOpts = group ? sortOptions(group.kind) : [];
  const filtered = useMemo(() => {
    let list = candidates.filter(m =>
      (!pickQ || m.name.toLowerCase().includes(pickQ.toLowerCase())) &&
      (!pickRace || m.race === pickRace));
    const opt = sortOpts.find(o => o.id === pickSort) ?? sortOpts[0];
    if (opt) {
      const dir = pickDir !== 0 ? pickDir : opt.desc ? -1 : 1;
      list = [...list].sort((a, b) => {
        const va = opt.get(a), vb = opt.get(b);
        return (typeof va === 'string' ? String(va).localeCompare(String(vb)) : (va as number) - (vb as number)) * dir;
      });
    }
    return list;
  }, [candidates, pickQ, pickRace, pickSort, pickDir, sortOpts]);

  const applyRole = (roleId: string, pref?: MissilePref) => {
    const role = roleM[roleId];
    if (!role) return;
    // explicit user toggle wins; else the role's own doctrine; else 'auto'
    const effective = pref ?? (missilePref !== 'auto' ? missilePref : role.missilePref ?? 'auto');
    const b = buildForRole(ship, role, data, effective);
    setLoadout(b.loadout);
    setPreset({ roleId, name: role.name, loadout: b.loadout, reasons: b.reasons });
  };

  const share = () => {
    const code = encodeBuild(ship.id, loadout);
    navigator.clipboard?.writeText(`${location.origin}${location.pathname}#b=${code}`).catch(() => {});
    location.hash = `b=${code}`;
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const groupName = (g: SlotGroup) => {
    const acc = g.accept ? (g.accept.startsWith('special:') ? 'main battery' : g.accept.replace('+', ' / ')) : '';
    return `${SIZE_LABEL[g.size]}${acc ? ` · ${acc}` : ''} ×${g.count}`;
  };

  const allMods = useMemo(() => [...data.engines, ...data.shields, ...data.weapons] as Module[], [data]);
  const modName = (id: string | null | undefined) => (id ? allMods.find(m => m.id === id)?.name ?? id : '— empty —');

  const selectGroup = (key: string) => { setActiveGroup(key); setHoverId(undefined); setPickQ(''); setPickRace(''); setPickSort('name'); setPickDir(0); };

  return (
    <main className="fit">
      <div className="fit-head">
        <div>
          <h1>{ship.name} <span className="build-tag">{preset ? preset.name : 'Custom build'}</span></h1>
          <div className="fit-sub">
            <span className="badge size">{SIZE_LABEL[ship.size]}</span>
            <span>{CLASS_LABEL[ship.class] ?? ship.class}</span>
            {ship.dlc !== 'Base' && <span className="badge dlc">{ship.dlc}</span>}
            {fits.filter(f => f.score >= 40).slice(0, 4).map(f => (
              <button key={f.roleId} className={`chip clickable tt ${preset?.roleId === f.roleId ? 'chip-active' : ''}`} data-tip={roleM[f.roleId]?.desc ?? ''}
                onClick={() => applyRole(f.roleId)}>
                {roleM[f.roleId]?.name.split(' / ')[0] ?? f.roleId} <b>{f.score}</b>
              </button>
            ))}
          </div>
        </div>
        <div className="fit-actions">
          {/* TODO(removal-candidate): Missiles auto/prefer/avoid control is hidden pending a
              decision on whether missile loadouts stay in the planner long-term. Logic and
              state (missilePref) are untouched — only the UI is hidden. Set SHOW_MISSILE_PREF
              to true, or delete this block and the related state/prop plumbing, to fully
              remove it later. */}
          {SHOW_MISSILE_PREF && (
            <select className="tt" data-tip="How presets treat mixed weapon/missile slots. Dedicated missile slots always get missiles."
              value={missilePref} onChange={e => { setMissilePref(e.target.value as MissilePref); if (preset) applyRole(preset.roleId, e.target.value as MissilePref); }}>
              <option value="auto">Missiles: auto</option>
              <option value="prefer">Missiles: prefer</option>
              <option value="avoid">Missiles: avoid</option>
            </select>
          )}
          <select value="" onChange={e => applyRole(e.target.value)}>
            <option value="">Apply role preset…</option>
            {roles.filter(r => !r.appliesTo || r.appliesTo(ship)).map(r => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
          {thisShipBuilds.length > 0 && (
            <select className="tt" data-tip="Swap in a build you've previously saved for this ship"
              value="" onChange={e => { const b = thisShipBuilds.find(x => x.id === e.target.value); if (b) onSwitchBuild(b); }}>
              <option value="">Load saved build…</option>
              {thisShipBuilds.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
          <button onClick={() => { setLoadout(emptyLoadout(ship)); setPreset(null); try { localStorage.removeItem(draftKey); } catch { /* ignore */ } }}>Clear</button>
          <button onClick={share}>{copied ? 'Link copied ✓' : 'Share'}</button>
          <button className="tt" data-tip="Save this build to your local library (Saved page)" onClick={() => {
            const def = `${ship.name}${preset ? ` — ${preset.name}` : ' — custom'}`;
            const name = window.prompt('Name this build:', def);
            if (name === null) return;
            saveBuild({ name: name.trim() || def, shipId: ship.id, loadout, roleId: preset?.roleId ?? null });
            setSavedMsg(true); setTimeout(() => setSavedMsg(false), 1500);
          }}>{savedMsg ? 'Saved ✓' : 'Save'}</button>
          <button className="tt" data-tip="Download this loadout as a JSON file (offline, shareable)" onClick={() => {
            exportBuild({
              id: 'export', savedAt: new Date().toISOString(),
              name: `${ship.name}${preset ? ` — ${preset.name}` : ' — custom'}`,
              shipId: ship.id, loadout, roleId: preset?.roleId ?? null,
            }, data.meta.gameVersion);
          }}>⤓ Export</button>
          <button onClick={() => { onAddCompare({ shipId: ship.id, loadout, label: `${ship.name}${preset ? ` — ${preset.name}` : ''}` }); onGoCompare(); }}>
            + Compare
          </button>
        </div>
      </div>
      {preset && <div className="hint">Applied <b>{preset.name}</b> preset — every slot stays editable. Modified slots are marked and can be reset individually.</div>}

      <div className="fit-cols">
        <section className="rack">
          {RACK_ORDER.map(kind => {
            const gs = ship.groups.filter(g => g.kind === kind);
            if (!gs.length) return null;
            return (
              <div key={kind} className={`rack-sec ${gs.some(g => g.key === activeGroup) ? 'sec-active' : ''}`}>
                <h4>{RACK_HEADER[kind]}</h4>
                {gs.map(g => {
                  const id = loadout[g.key] ?? null;
                  const presetPick = preset ? (preset.loadout[g.key] ?? null) : undefined;
                  const modified = preset !== null && presetPick !== id;
                  return (
                    <div key={g.key} className={`slot ${activeGroup === g.key ? 'active' : ''} ${modified ? 'modified' : ''}`}
                      role="button" tabIndex={0}
                      onClick={() => selectGroup(g.key)}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') selectGroup(g.key); }}>
                      <div className="slot-kind">{groupName(g)}{modified && <span className="mod-flag">modified</span>}</div>
                      <div className={`slot-mod ${id ? '' : 'empty'}`}>{modName(id)}</div>
                      {modified ? (
                        <div className="slot-why">
                          Preset pick: {modName(presetPick)}
                          <button className="mini" onClick={e => { e.stopPropagation(); setLoadout(l => ({ ...l, [g.key]: presetPick ?? null })); }}>
                            ↺ reset
                          </button>
                        </div>
                      ) : preset?.reasons[g.key] ? (
                        <div className="slot-why">{preset.reasons[g.key]}</div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </section>

        <section className="picker">
          <h2>{group ? `${RACK_HEADER[group.kind]} — ${groupName(group)}` : 'Pick a slot'}</h2>
          {group && candidates.length === 0 && <div className="hint">No compatible modules in dataset (NPC-locked hardpoint).</div>}
          {group && candidates.length > 0 && (
            <>
              <div className="pick-controls">
                <input placeholder="Search…" value={pickQ} onChange={e => setPickQ(e.target.value)} />
                <select value={pickRace} onChange={e => setPickRace(e.target.value)}>
                  <option value="">All makers</option>
                  {races.map(r => <option key={r} value={r}>{RACE_LABEL[r] ?? r}</option>)}
                </select>
                <select value={pickSort} onChange={e => { setPickSort(e.target.value); setPickDir(0); }}>
                  {sortOpts.map(o => <option key={o.id} value={o.id}>Sort: {o.label}</option>)}
                </select>
                <button className="tt" data-tip="Flip sort direction"
                  onClick={() => setPickDir(dir => (dir === 0 ? ((sortOpts.find(o => o.id === pickSort)?.desc ? 1 : -1) as 1 | -1) : dir === 1 ? -1 : 1))}>
                  {(pickDir !== 0 ? pickDir : sortOpts.find(o => o.id === pickSort)?.desc ? -1 : 1) === -1 ? '↓' : '↑'}
                </button>
              </div>
              <div className="mods" onMouseLeave={() => setHoverId(undefined)}>
                <button className={`mod ${!loadout[group.key] ? 'active' : ''}`}
                  onMouseEnter={() => setHoverId(null)} onFocus={() => setHoverId(null)} onBlur={() => setHoverId(undefined)}
                  onClick={() => { setLoadout(l => ({ ...l, [group.key]: null })); setHoverId(undefined); }}>
                  <span className="mod-name">— empty —</span>
                </button>
                {filtered.map(m => (
                  <button key={m.id} className={`mod ${loadout[group.key] === m.id ? 'active' : ''}`}
                    onMouseEnter={() => setHoverId(m.id)} onFocus={() => setHoverId(m.id)} onBlur={() => setHoverId(undefined)}
                    onClick={() => { setLoadout(l => ({ ...l, [group.key]: m.id })); setHoverId(undefined); }}>
                    <span className="mod-top">
                      <span className="mod-name">{m.name}</span>
                      <span className="mod-meta">{RACE_LABEL[m.race] ?? m.race} · Mk{m.mk}{m.dlc !== 'Base' ? ` · ${m.dlc}` : ''}</span>
                    </span>
                    <ModStats m={m} ship={ship} engineCount={ship.groups.find(g => g.kind === 'engine')?.count ?? 1} />
                  </button>
                ))}
                {filtered.length === 0 && <div className="hint small">No modules match the current filters.</div>}
              </div>
            </>
          )}
        </section>

        <section className="stats">
          <div className="stats-head">
            <div className="view-toggle" role="group" aria-label="Combat context">
              <button className={statMode === 'is' ? 'active' : ''} onClick={() => setStatMode('is')}
                title="Fully simulated combat — stats as extracted">In-sector</button>
              <button className={statMode === 'oos' ? 'active' : ''} onClick={() => setStatMode('oos')}
                title="Low-attention estimate: turrets fire ~30% of the time, forward guns ~90% hit — offense stats scaled accordingly">OOS est.</button>
            </div>
          </div>
          <div className="preview-note">{preview ? <>Previewing: <span className="dimtext">current</span> → new</> : statMode === 'oos' ? 'Offense shown as out-of-sector effective output' : '\u00A0'}</div>
          {STAT_SECTIONS.map(sec => {
            const rows = sec.rows.filter(r => relevant.has(r.key));
            if (!rows.length) return null;
            return (
              <div key={sec.title} className="stat-sec">
                <h3>{sec.title}</h3>
                {rows.map(r => {
                  const v = statView(r.key, d);
                  const pv = preview ? statView(r.key, preview) : undefined;
                  const changed = pv !== undefined && Math.abs(pv - v) > 1e-6;
                  const dirTag = r.lowerBetter && <span className="dir tt" data-tip="Lower is better">↓</span>;
                  const label = <span className="stat-label"><span className="tt" data-tip={r.tip}>{r.label}</span>{dirTag}</span>;
                  const cur = v === 0 || !isFinite(v) ? '—' : r.format(v);
                  if (preview && changed) {
                    // filling or emptying a slot has no meaningful better/worse baseline — teal for every stat
                    const zeroBase = v === 0 || !isFinite(v) || pv === 0 || !isFinite(pv!);
                    const good = !zeroBase && (r.lowerBetter ? pv! < v : pv! > v);
                    return (
                      <div key={r.key} className="stat-row chg">
                        {label}
                        <span className="stat-val">
                          <span className="dimtext">{cur}</span> <em className={zeroBase ? 'neu' : good ? 'up' : 'down'}>→ {pv === 0 ? '—' : r.format(pv!)}</em>
                        </span>
                      </div>
                    );
                  }
                  return (
                    <div key={r.key} className={`stat-row ${preview ? 'dim-row' : ''}`}>
                      {label}
                      <span className="stat-val">{cur}</span>
                    </div>
                  );
                })}
              </div>
            );
          })}
          {d.hasBeam && <div className="hint small">Beam weapons mounted — beam range excluded from range stat (dataset limitation).</div>}
          <div className="legend">↓ lower is better · * modeled index or dataset gap · hover a label for details</div>
          <button className="raw-toggle" onClick={() => setShowRaw(s => !s)}>{showRaw ? 'Hide' : 'Show'} raw ship data</button>
          {showRaw && (
            <pre className="raw">{JSON.stringify({ hull: ship.hull, mass: ship.mass, dragFwd: ship.dragFwd, dragPitch: ship.dragPitch, dragYaw: ship.dragYaw, inertiaPitch: ship.inertiaPitch, inertiaYaw: ship.inertiaYaw, accFactorFwd: ship.accFwd, jerkFwd: ship.jerkFwd, jerkTravel: ship.jerkTravel, jerkBoost: ship.jerkBoost, cargoType: ship.cargoType, docks: ship.docks }, null, 1)}</pre>
          )}
        </section>
      </div>
    </main>
  );
}
