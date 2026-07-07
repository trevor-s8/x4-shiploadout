import { useRef, useState } from 'react';
import type { GameData } from '../types';
import { SIZE_LABEL, CLASS_LABEL } from '../format';
import { roleMap, type Role } from '../data/roles';
import { loadBuilds, deleteBuild, exportBackup, exportBuild, importFile, type SavedBuild, type ImportResult } from '../storage';

export default function SavedView({ data, roles, onOpen, onRolesChanged }: {
  data: GameData;
  roles: Role[];
  onOpen: (b: SavedBuild) => void;
  onRolesChanged: () => void;
}) {
  const [, bump] = useState(0);
  const refresh = () => bump(n => n + 1);
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const builds = loadBuilds();
  const RM = roleMap(roles);
  const ship = (id: string) => data.ships.find(s => s.id === id);

  const onImport = async (file: File) => {
    const text = await file.text();
    const r: ImportResult = importFile(text, data, new Set(roles.map(x => x.id)));
    if (r.error) { setMsg(`Import failed: ${r.error}`); return; }
    const parts: string[] = [];
    if (r.builds) parts.push(`${r.builds} build${r.builds === 1 ? '' : 's'}`);
    if (r.roles) parts.push(`${r.roles} role tuning${r.roles === 1 ? '' : 's'}`);
    const skipped = r.skippedBuilds + r.skippedRoles;
    setMsg(parts.length
      ? `Imported ${parts.join(' and ')}.${skipped ? ` Skipped ${skipped} incompatible item${skipped === 1 ? '' : 's'}.` : ''}`
      : 'Nothing importable found in that file.');
    if (r.roles) onRolesChanged();
    refresh();
  };

  return (
    <main className="saved">
      <div className="saved-head">
        <div>
          <h1>Saved builds</h1>
          <p className="hint">
            Everything here lives in this browser only — nothing leaves your machine unless you export it.
            Exports are plain JSON files you can back up, move to another device, or hand to a friend.
          </p>
        </div>
        <div className="saved-actions">
          <button className="tt" data-tip="Download one file containing every saved build and all custom role tunings"
            onClick={() => exportBackup(data.meta.gameVersion)}>⤓ Export everything</button>
          <button className="tt" data-tip="Import a backup, a single build, or a single role file"
            onClick={() => fileRef.current?.click()}>⤒ Import file…</button>
          <input ref={fileRef} type="file" accept=".json,application/json" hidden
            onChange={e => { const f = e.target.files?.[0]; if (f) onImport(f); e.target.value = ''; }} />
        </div>
      </div>
      {msg && <div className="hint import-msg">{msg}</div>}

      {builds.length === 0 ? (
        <div className="hint">No saved builds yet. Fit a ship and hit <b>Save</b> — it'll show up here.</div>
      ) : (
        <div className="compare-scroll">
          <table className="ship-table">
            <thead>
              <tr>
                <th className="left">Build</th>
                <th className="left">Ship</th>
                <th>Size</th>
                <th className="left">Preset</th>
                <th className="left">Saved</th>
                <th className="left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {builds.map(b => {
                const s = ship(b.shipId);
                return (
                  <tr key={b.id}>
                    <td className="left name-cell">{b.name}</td>
                    <td className="left">{s ? `${s.name} · ${CLASS_LABEL[s.class] ?? s.class}` : <span className="dimtext">unknown ship</span>}</td>
                    <td>{s && <span className="badge size">{SIZE_LABEL[s.size]}</span>}</td>
                    <td className="left dimtext">{b.roleId ? RM[b.roleId]?.name ?? b.roleId : 'custom'}</td>
                    <td className="left dimtext">{new Date(b.savedAt).toLocaleDateString()}</td>
                    <td className="left actions-cell">
                      <button disabled={!s} onClick={() => s && onOpen(b)}>Open</button>
                      <button onClick={() => exportBuild(b, data.meta.gameVersion)}>Export</button>
                      <button className="danger" onClick={() => { if (confirm(`Delete "${b.name}"?`)) { deleteBuild(b.id); refresh(); } }}>Delete</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
