import { useMemo, useState } from 'react';
import type { GameData, Loadout } from '../types';
import { emptyLoadout } from '../engine/derive';
import { buildForRole } from '../engine/optimizer';
import { evaluate, type CombatMode, type SideSpec, type SideEval } from '../engine/combat';
import { roleMap, type Role } from '../data/roles';
import { loadBuilds } from '../storage';
import { SIZE_LABEL, CLASS_LABEL, fmt } from '../format';

function SidePicker({ data, roles, side, spec, onChange, onOpenFitting }: {
  data: GameData; roles: Role[]; side: 'A' | 'B';
  spec: SideSpec | null; onChange: (s: SideSpec | null) => void; onOpenFitting: (shipId: string) => void;
}) {
  const [shipId, setShipId] = useState(spec?.ship.id ?? '');
  const [shipQuery, setShipQuery] = useState(spec?.ship.name ?? '');
  const [buildKey, setBuildKey] = useState('');
  const [count, setCount] = useState(spec?.count ?? 1);
  const ship = data.ships.find(s => s.id === shipId) ?? null;
  const saved = useMemo(() => loadBuilds().filter(b => b.shipId === shipId), [shipId]);
  const applicableRoles = ship ? roles.filter(r => !r.appliesTo || r.appliesTo(ship)) : [];

  const emit = (sid: string, bkey: string, n: number) => {
    const sh = data.ships.find(s => s.id === sid);
    if (!sh) { onChange(null); return; }
    let loadout: Loadout; let label: string;
    if (bkey.startsWith('role:')) {
      const role = roleMap(roles)[bkey.slice(5)];
      loadout = buildForRole(sh, role, data).loadout;
      label = `${sh.name} — ${role.name}`;
    } else if (bkey.startsWith('saved:')) {
      const b = loadBuilds().find(x => x.id === bkey.slice(6));
      loadout = { ...emptyLoadout(sh), ...(b?.loadout ?? {}) };
      label = b ? b.name : sh.name;
    } else {
      loadout = emptyLoadout(sh);
      label = `${sh.name} — stock (empty)`;
    }
    onChange({ ship: sh, loadout, count: Math.max(1, n), label });
  };

  const listId = `ships-${side}`;
  const pickShip = (name: string) => {
    setShipQuery(name);
    const sh = data.ships.find(s => s.name === name);
    if (!sh) return;
    setShipId(sh.id);
    // saved builds for this ship take priority — the `saved` memo above is still keyed to the
    // previous shipId at this point (state hasn't re-rendered yet), so re-read fresh here
    const shipSaved = loadBuilds().filter(b => b.shipId === sh.id);
    const firstRole = roles.find(r => !r.appliesTo || r.appliesTo(sh));
    const bk = shipSaved.length > 0 ? `saved:${shipSaved[0].id}` : firstRole ? `role:${firstRole.id}` : 'stock';
    setBuildKey(bk);
    emit(sh.id, bk, count);
  };
  return (
    <div className="cside">
      <h3>Side {side}</h3>
      <input list={listId} placeholder="Type to search ships…" value={shipQuery}
        onChange={e => pickShip(e.target.value)} />
      <datalist id={listId}>
        {data.ships.map(s => (
          <option key={s.id} value={s.name}>{s.name} — {SIZE_LABEL[s.size]} {CLASS_LABEL[s.class] ?? s.class}</option>
        ))}
      </datalist>
      {ship && saved.length === 0 && (
        <div className="cside-empty">
          <span>No saved load outs for {ship.name} yet.</span>
          <button type="button" onClick={() => onOpenFitting(ship.id)}>+ Create load out</button>
        </div>
      )}
      <select value={buildKey} disabled={!ship} onChange={e => { setBuildKey(e.target.value); emit(shipId, e.target.value, count); }}>
        {saved.length > 0 && (
          <optgroup label="Your saved builds">
            {saved.map(b => <option key={b.id} value={`saved:${b.id}`}>{b.name}</option>)}
          </optgroup>
        )}
        <optgroup label="Generated role builds">
          {applicableRoles.map(r => <option key={r.id} value={`role:${r.id}`}>{r.name}</option>)}
        </optgroup>
        <option value="stock">Stock (empty slots)</option>
      </select>
      <label className="count-label">
        ×
        <input type="number" min={1} max={500} value={count}
          onChange={e => { const n = Number(e.target.value) || 1; setCount(n); emit(shipId, buildKey, n); }} />
        ships
      </label>
    </div>
  );
}

function WeaponTable({ ev, attacker, defender, count }: { ev: SideEval; attacker: string; defender: string; count: number }) {
  return (
    <div className="wtable">
      <h3>{attacker} → {defender}</h3>
      {ev.groups.length === 0 && <div className="hint small">No modeled weapons on this side.</div>}
      {ev.groups.length > 0 && (
        <table className="ship-table">
          <thead>
            <tr>
              <th className="left">Weapon</th><th>Mount</th><th>Base DPS</th>
              <th className="tt tt-left" data-tip="Chance each shot connects with this defender in the selected mode. Evasion = 100% − hit.">Hit %</th>
              <th className="tt tt-left" data-tip="Defender's evasion against this specific weapon type">Evaded</th>
              <th>Eff. DPS</th>
            </tr>
          </thead>
          <tbody>
            {ev.groups.map((g, i) => (
              <tr key={i}>
                <td className="left">{g.name} ×{g.count}</td>
                <td className="dimtext">{g.mount}</td>
                <td>{fmt.big(g.baseDPS * g.count)}</td>
                <td className="fit-cell">{Math.round(g.hit * 100)}%</td>
                <td className="dimtext">{Math.round((1 - g.hit) * 100)}%</td>
                <td><b>{fmt.big(g.effDPS)}</b></td>
              </tr>
            ))}
            <tr>
              <td className="left"><b>Total effective</b></td><td /><td /><td /><td />
              <td className="fit-cell">{fmt.big(ev.effDPS)} <span className="dimtext">/ship</span>{count > 1 && <> · {fmt.big(ev.effDPS * count)} <span className="dimtext">side</span></>}</td>
            </tr>
          </tbody>
        </table>
      )}
      {ev.excluded.length > 0 && (
        <div className="hint small">Not modeled: {ev.excluded.join('; ')}.</div>
      )}
    </div>
  );
}

export default function CombatView({ data, roles, onOpenFitting }: { data: GameData; roles: Role[]; onOpenFitting: (shipId: string) => void }) {
  const [a, setA] = useState<SideSpec | null>(null);
  const [b, setB] = useState<SideSpec | null>(null);
  const [mode, setMode] = useState<CombatMode>('is');

  const results = useMemo(() => {
    if (!a || !b) return null;
    return { is: evaluate(a, b, 'is', data), oos: evaluate(a, b, 'oos', data) };
  }, [a, b, data]);

  const r = results ? results[mode] : null;
  const other = results ? results[mode === 'is' ? 'oos' : 'is'] : null;

  const verdict = (x: typeof r) => {
    if (!x || !a || !b) return '';
    if (x.winner === 'mutual') return `mutual destruction — both sides wiped by ${fmt.time(x.duration)}`;
    if (x.winner === 'stalemate') return `stalemate after ${fmt.time(x.duration)} — regen outpaces incoming damage`;
    const w = x.winner === 'A' ? a : b;
    const losses = x.winner === 'A' ? x.lossesA : x.lossesB;
    const surv = x.winner === 'A' ? x.survivorsA : x.survivorsB;
    return `Side ${x.winner} (${w.label}) wins in ${fmt.time(x.duration)}, ${surv} survivor${surv === 1 ? '' : 's'}, ${losses} lost`;
  };

  return (
    <main className="combat">
      <h1>Combat evaluator</h1>
      <div className="csides">
        <SidePicker data={data} roles={roles} side="A" spec={a} onChange={setA} onOpenFitting={onOpenFitting} />
        <div className="vs">VS</div>
        <SidePicker data={data} roles={roles} side="B" spec={b} onChange={setB} onOpenFitting={onOpenFitting} />
      </div>

      {results && a && b && (
        <>
          <div className={`verdict ${r!.winner === 'A' || r!.winner === 'B' ? 'win' : ''}`}>
            <div className="verdict-main">{verdict(r)}</div>
            <div className="verdict-sub">
              <div className="view-toggle" role="group" aria-label="Simulation mode">
                <button className={mode === 'is' ? 'active' : ''} onClick={() => setMode('is')}>In-sector</button>
                <button className={mode === 'oos' ? 'active' : ''} onClick={() => setMode('oos')}>Out-of-sector</button>
              </div>
              <span className="dimtext">{mode === 'is' ? 'OOS' : 'IS'}: {verdict(other)}</span>
            </div>
            {mode === 'oos' && <div className="hint small">Low-attention combat resolves in ~5 s rounds; durations are approximate.</div>}
            {r!.rangeNote && (
              <div className="hint small">Side {r!.rangeNote} outranges the other by 30%+ — real fights favor it more than shown.</div>
            )}
          </div>

          <div className="kstats">
            <div className="kstat tt" data-tip="One Side-A ship's effective DPS emptying one Side-B ship's hull + main shield pool, regen ignored — the classic time-to-kill number">
              <i>TTK · 1× {a.ship.name} → {b.ship.name}</i><b>{r!.ttkSingleAB ? fmt.time(r!.ttkSingleAB) : '—'}</b>
            </div>
            <div className="kstat tt" data-tip="One Side-B ship's effective DPS vs one Side-A ship's pool, regen ignored">
              <i>TTK · 1× {b.ship.name} → {a.ship.name}</i><b>{r!.ttkSingleBA ? fmt.time(r!.ttkSingleBA) : '—'}</b>
            </div>
            <div className="kstat"><i>First kill · A / B</i><b>{r!.firstKillByA ? fmt.time(r!.firstKillByA) : '—'} / {r!.firstKillByB ? fmt.time(r!.firstKillByB) : '—'}</b></div>
          </div>

          <div className="wtables">
            <WeaponTable ev={r!.evalA} attacker={`A · ${a.label} ×${a.count}`} defender={`B (${b.ship.name})`} count={a.count} />
            <WeaponTable ev={r!.evalB} attacker={`B · ${b.label} ×${b.count}`} defender={`A (${a.ship.name})`} count={b.count} />
          </div>

          <details className="model-notes">
            <summary>How this model works (and where it lies)</summary>
            <p>
              <b>In-sector:</b> hit chance falls as target speed rises relative to projectile speed, scaled by target size
              (S ships dodge, XL hulls don't); beams almost always land; turrets additionally need rotation speed to track the
              target's angular motion at ~60% of weapon range; shield regen runs at 25% while under fire (9.0 regen stun);
              attackers focus-fire one target.
            </p>
            <p>
              <b>Out-of-sector:</b> turrets fire only 30% of the time (community-verified low-attention constant); forward
              weapons hit ~90% baseline reduced by raw target speed (approaching immune near 2,000 m/s); projectile speed and
              tracking are ignored; shield regen applies in full; damage spreads across up to 5 targets.
            </p>
            <p>
              <b>Not modeled:</b> missiles and torpedoes (ammo stats missing from the dataset — a real bomber's alpha strike is
              therefore <i>underestimated</i>), flak/ion damage (AoE and split damage not extracted), positioning and kiting,
              crew skill, drones, surface-element sniping, boarding, and morale/flee behavior. Constants are heuristics fitted
              to community code-reading and testing, not extracted game logic.
            </p>
          </details>
        </>
      )}
    </main>
  );
}
