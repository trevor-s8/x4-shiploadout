import { useEffect, useMemo, useState } from 'react';
import type { GameData, Ship, Loadout } from './types';
import { computeRoleFits, type RoleFit } from './engine/optimizer';
import { getRoles, type Role } from './data/roles';
import ShipBrowser from './views/ShipBrowser';
import FittingScreen from './views/FittingScreen';
import CompareView from './views/CompareView';
import RolesView from './views/RolesView';
import SavedView from './views/SavedView';
import CombatView from './views/CombatView';
import { type SavedBuild, loadFontScale, saveFontScale, FONT_SCALE_MIN, FONT_SCALE_MAX, FONT_SCALE_STEP, FONT_SCALE_DEFAULT } from './storage';
import { emptyLoadout } from './engine/derive';

export interface CompareEntry { shipId: string; loadout: Loadout; label: string }

export function encodeBuild(shipId: string, loadout: Loadout): string {
  const json = JSON.stringify({ s: shipId, l: loadout });
  return btoa(unescape(encodeURIComponent(json))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function decodeBuild(code: string): { s: string; l: Loadout } | null {
  try {
    const b64 = code.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(decodeURIComponent(escape(atob(b64))));
  } catch { return null; }
}

type View = { name: 'browser' } | { name: 'fit'; shipId: string; initial?: Loadout } | { name: 'compare' } | { name: 'roles' } | { name: 'saved' } | { name: 'combat' };

export default function App() {
  const [data, setData] = useState<GameData | null>(null);
  const [fits, setFits] = useState<Map<string, RoleFit[]> | null>(null);
  const [view, setViewRaw] = useState<View>({ name: 'browser' });
  const setView = (v: View) => {
    setViewRaw(v);
    try { history.pushState({ x4lpView: v }, ''); } catch { /* ignore */ }
  };
  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      const v = (e.state as { x4lpView?: View } | null)?.x4lpView;
      setViewRaw(v ?? { name: 'browser' });
    };
    window.addEventListener('popstate', onPop);
    try { history.replaceState({ x4lpView: { name: 'browser' } }, ''); } catch { /* ignore */ }
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const [compare, setCompare] = useState<CompareEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [roles, setRoles] = useState<Role[]>(() => getRoles());
  const [fontScale, setFontScale] = useState<number>(() => loadFontScale());

  const adjustFontScale = (delta: number) => {
    setFontScale(s => {
      const next = Math.round((Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, s + delta))) * 100) / 100;
      saveFontScale(next);
      return next;
    });
  };
  const resetFontScale = () => {
    setFontScale(FONT_SCALE_DEFAULT);
    saveFontScale(FONT_SCALE_DEFAULT);
  };

  useEffect(() => {
    const inlined = (window as unknown as { __GAMEDATA__?: GameData }).__GAMEDATA__;
    const load = inlined ? Promise.resolve(inlined) : fetch(`${import.meta.env.BASE_URL}data/gamedata.json`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); });
    load
      .then((d: GameData) => {
        setData(d);
        const m = location.hash.match(/b=([A-Za-z0-9_-]+)/);
        if (m) {
          const b = decodeBuild(m[1]);
          if (b && d.ships.some(s => s.id === b.s)) setView({ name: 'fit', shipId: b.s, initial: b.l });
        }
      })
      .catch(e => setError(String(e)));
  }, []);

  // role fits recompute whenever role weights change (heavy-ish; after paint)
  useEffect(() => {
    if (!data) return;
    setFits(null);
    const t = setTimeout(() => setFits(computeRoleFits(data, roles)), 50);
    return () => clearTimeout(t);
  }, [data, roles]);

  const shipById = useMemo(() => {
    const m = new Map<string, Ship>();
    data?.ships.forEach(s => m.set(s.id, s));
    return m;
  }, [data]);

  // shared by SavedView's "Open" and FittingScreen's "Load saved build" dropdown: sanitizes a
  // saved build's loadout against its ship's current slot shape (files may cross game versions)
  const openBuild = (b: SavedBuild) => {
    const ship = shipById.get(b.shipId);
    if (!ship) return;
    const clean: Loadout = { ...emptyLoadout(ship) };
    for (const k of Object.keys(clean)) if (b.loadout[k] !== undefined) clean[k] = b.loadout[k];
    setView({ name: 'fit', shipId: b.shipId, initial: clean });
  };

  if (error) return <div className="loading">Failed to load game data: {error}</div>;
  if (!data) return <div className="loading">Loading 9.0 game data…</div>;

  const addCompare = (e: CompareEntry) => setCompare(c => (c.length >= 4 ? c : [...c, e]));

  return (
    <div className="app" style={{ '--font-scale': fontScale } as React.CSSProperties}>
      <header className="topbar">
        <button className="brand" onClick={() => setView({ name: 'browser' })}>
          <span className="brand-x4">X4</span> LOADOUT PLANNER
        </button>
        <nav>
          <button className={view.name === 'browser' ? 'active' : ''} onClick={() => setView({ name: 'browser' })}>Ships</button>
          <button className={view.name === 'compare' ? 'active' : ''} onClick={() => setView({ name: 'compare' })}>
            Compare{compare.length ? ` (${compare.length})` : ''}
          </button>
          <button className={view.name === 'combat' ? 'active' : ''} onClick={() => setView({ name: 'combat' })}>Combat</button>
          <button className={view.name === 'roles' ? 'active' : ''} onClick={() => setView({ name: 'roles' })}>Roles <span className="badge beta nav-beta">beta</span></button>
          <button className={view.name === 'saved' ? 'active' : ''} onClick={() => setView({ name: 'saved' })}>Saved</button>
        </nav>
        <div className="text-size" role="group" aria-label="Text size">
          <button
            onClick={() => adjustFontScale(-FONT_SCALE_STEP)}
            disabled={fontScale <= FONT_SCALE_MIN}
            title="Decrease text size"
            aria-label="Decrease text size"
          >A−</button>
          <button
            className="text-size-reset"
            onClick={resetFontScale}
            title={`Reset text size (${Math.round(fontScale * 100)}%)`}
            aria-label="Reset text size"
          >{Math.round(fontScale * 100)}%</button>
          <button
            onClick={() => adjustFontScale(FONT_SCALE_STEP)}
            disabled={fontScale >= FONT_SCALE_MAX}
            title="Increase text size"
            aria-label="Increase text size"
          >A+</button>
        </div>
        <span className="version">v{data.meta.gameVersion}</span>
      </header>

      {view.name === 'browser' && (
        <ShipBrowser data={data} fits={fits} roles={roles} onOpen={id => setView({ name: 'fit', shipId: id })} />
      )}
      {view.name === 'combat' && (
        <CombatView data={data} roles={roles} onOpenFitting={id => setView({ name: 'fit', shipId: id })} />
      )}
      {view.name === 'saved' && (
        <SavedView
          data={data}
          roles={roles}
          onRolesChanged={() => setRoles(getRoles())}
          onOpen={openBuild}
        />
      )}
      {view.name === 'roles' && (
        <RolesView roles={roles} recomputing={!fits} onRolesChanged={() => setRoles(getRoles())} />
      )}
      {view.name === 'fit' && shipById.get(view.shipId) && (
        <FittingScreen
          key={view.shipId}
          data={data}
          ship={shipById.get(view.shipId)!}
          fits={fits?.get(view.shipId) ?? []}
          roles={roles}
          initial={view.initial}
          onAddCompare={addCompare}
          onGoCompare={() => setView({ name: 'compare' })}
          onSwitchBuild={openBuild}
        />
      )}
      {view.name === 'compare' && (
        <CompareView
          data={data}
          entries={compare}
          onRemove={i => setCompare(c => c.filter((_, j) => j !== i))}
          onOpen={(e) => setView({ name: 'fit', shipId: e.shipId, initial: e.loadout })}
        />
      )}

      <footer className="footer">
        Game data v{data.meta.gameVersion} · extracted via {data.meta.source} · generated {data.meta.generated} ·
        stats marked * are modeled indices pending in-game validation
      </footer>
    </div>
  );
}
