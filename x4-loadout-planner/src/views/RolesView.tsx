import { useState } from 'react';
import type { Derived } from '../types';
import { DEFAULT_ROLES, saveOverride, isOverridden, saveCustomRole, deleteCustomRole, newCustomRoleId, type Role } from '../data/roles';
import { exportRole } from '../storage';
import { STAT_SECTIONS } from '../format';

// friendly label + tip for every scoreable stat, drawn from the stat panel definitions
const STAT_INFO: Record<string, { label: string; tip: string; lowerDefault: boolean }> = {};
for (const sec of STAT_SECTIONS) for (const r of sec.rows) STAT_INFO[r.key] = { label: r.label, tip: r.tip, lowerDefault: !!r.lowerBetter };

function RoleCard({ role, onChanged }: { role: Role; onChanged: () => void }) {
  const isCustom = role.id.startsWith('custom_');
  const def = DEFAULT_ROLES.find(r => r.id === role.id) ?? role;
  const [name, setName] = useState(role.name);
  const [desc, setDesc] = useState(role.desc);
  const [weights, setWeights] = useState<Record<string, number>>({ ...role.weights } as Record<string, number>);
  const [inverted, setInverted] = useState<Set<string>>(new Set(role.inverted ?? []));
  const [addKey, setAddKey] = useState('');

  const entries = Object.entries(weights);
  const sum = entries.reduce((a, [, w]) => a + w, 0) || 1;
  const dirty = JSON.stringify({ w: weights, i: [...inverted].sort(), n: name, d: desc })
    !== JSON.stringify({ w: role.weights, i: [...(role.inverted ?? [])].sort(), n: role.name, d: role.desc });
  const customized = isOverridden(role.id) || dirty;
  const nameEmpty = !name.trim();

  const save = () => {
    if (nameEmpty) return;
    const payload = { weights: weights as Partial<Record<keyof Derived, number>>, inverted: [...inverted] as (keyof Derived)[] };
    if (isCustom) saveCustomRole({ id: role.id, name: name.trim(), desc: desc.trim(), ...payload });
    else saveOverride(role.id, { ...payload, name: name.trim(), desc: desc.trim() });
    onChanged();
  };
  const reset = () => {
    if (isCustom) { if (confirm(`Delete custom role "${role.name}"?`)) { deleteCustomRole(role.id); onChanged(); } return; }
    saveOverride(role.id, null);
    setName(def.name);
    setDesc(def.desc);
    setWeights({ ...def.weights } as Record<string, number>);
    setInverted(new Set(def.inverted ?? []));
    onChanged();
  };

  const available = Object.keys(STAT_INFO).filter(k => !(k in weights));

  return (
    <div className="role-card">
      <div className="role-head">
        <input className="role-name-input" value={name} onChange={e => setName(e.target.value)}
          aria-label="Role name" placeholder="Role name" />
        {customized && <span className="badge dlc">customized</span>}
      </div>
      <textarea className="role-desc-input" value={desc} onChange={e => setDesc(e.target.value)}
        aria-label="Role description" placeholder="What is this role for?" rows={2} />
      <div className="role-weights">
        {entries.map(([k, w]) => (
          <div key={k} className="wrow">
            <span className="wlabel tt" data-tip={STAT_INFO[k]?.tip ?? k}>{STAT_INFO[k]?.label ?? k}</span>
            <input type="range" min={0} max={50} step={1} value={Math.round(w * 100)}
              onChange={e => setWeights(ws => ({ ...ws, [k]: Number(e.target.value) / 100 }))} />
            <span className="wpct">{Math.round((w / sum) * 100)}%</span>
            <label className="winv tt" data-tip="Score this stat as lower-is-better">
              <input type="checkbox" checked={inverted.has(k)}
                onChange={e => setInverted(inv => { const n = new Set(inv); e.target.checked ? n.add(k) : n.delete(k); return n; })} />↓
            </label>
            <button className="mini" title="Remove stat"
              onClick={() => { setWeights(ws => { const n = { ...ws }; delete n[k]; return n; }); setInverted(inv => { const n = new Set(inv); n.delete(k); return n; }); }}>✕</button>
          </div>
        ))}
        <div className="wadd">
          <select value={addKey} onChange={e => setAddKey(e.target.value)}>
            <option value="">Add a stat…</option>
            {available.map(k => <option key={k} value={k}>{STAT_INFO[k].label}</option>)}
          </select>
          <button className="mini" disabled={!addKey} onClick={() => {
            if (!addKey) return;
            setWeights(ws => ({ ...ws, [addKey]: 0.10 }));
            if (STAT_INFO[addKey].lowerDefault) setInverted(inv => new Set(inv).add(addKey));
            setAddKey('');
          }}>+ add</button>
        </div>
      </div>
      <div className="role-actions">
        <button disabled={!dirty || nameEmpty} title={nameEmpty ? 'Role name cannot be empty' : undefined} onClick={save}>Save & rescore</button>
        <button onClick={reset}>{isCustom ? 'Delete role' : 'Reset to default'}</button>
        <button className="tt" data-tip="Download this role's current tuning as a JSON file — import it on the Saved page of any device"
          onClick={() => exportRole(role.id, name || role.name,
            { weights: weights as Role['weights'], inverted: [...inverted] as Role['inverted'] & string[] }, '')}>
          ⤓ Export
        </button>
      </div>
    </div>
  );
}

export default function RolesView({ roles, recomputing, onRolesChanged }: {
  roles: Role[]; recomputing: boolean; onRolesChanged: () => void;
}) {
  return (
    <main className="roles">
      <div className="roles-intro">
        <h1>Role presets <span className="badge beta">beta</span></h1>
        {recomputing && <p className="hint"><b>Rescoring ships…</b></p>}
      </div>
      <div className="roles-tools">
        <button onClick={() => {
          const name = window.prompt('Name your role (e.g. "Torpedo Bomber", "Blockade Runner"):');
          if (!name?.trim()) return;
          saveCustomRole({ id: newCustomRoleId(), name: name.trim(), desc: 'Custom role — set its priorities below.',
            weights: { topSpeed: 0.25, ehp: 0.25, totalSustained: 0.25, cargo: 0.25 }, inverted: [] });
          onRolesChanged();
        }}>+ New custom role</button>
      </div>
      <div className="roles-grid">
        {roles.map(r => <RoleCard key={r.id} role={r} onChanged={onRolesChanged} />)}
      </div>
    </main>
  );
}
