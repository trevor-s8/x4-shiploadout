import type { GameData, Loadout } from './types';
import { loadOverrides, saveOverride, loadCustomRoles, saveCustomRole, type RoleOverride, type CustomRoleDef } from './data/roles';

export interface SavedBuild {
  id: string;
  name: string;
  shipId: string;
  loadout: Loadout;
  roleId?: string | null;
  savedAt: string;
}

const LS_BUILDS = 'x4lp-saved-builds';
const LS_FONT_SCALE = 'x4lp-font-scale';

export const FONT_SCALE_MIN = 0.85;
export const FONT_SCALE_MAX = 1.3;
export const FONT_SCALE_STEP = 0.05;
export const FONT_SCALE_DEFAULT = 1;

export function loadFontScale(): number {
  try {
    const v = Number(localStorage.getItem(LS_FONT_SCALE));
    if (!Number.isFinite(v) || v <= 0) return FONT_SCALE_DEFAULT;
    return Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, v));
  } catch { return FONT_SCALE_DEFAULT; }
}

export function saveFontScale(scale: number): void {
  try { localStorage.setItem(LS_FONT_SCALE, String(scale)); } catch { /* storage unavailable */ }
}

export function loadBuilds(): SavedBuild[] {
  try {
    const v = JSON.parse(localStorage.getItem(LS_BUILDS) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}

function persist(builds: SavedBuild[]): void {
  try { localStorage.setItem(LS_BUILDS, JSON.stringify(builds)); } catch { /* storage unavailable */ }
}

export function saveBuild(b: Omit<SavedBuild, 'id' | 'savedAt'>): SavedBuild {
  const build: SavedBuild = { ...b, id: `b_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`, savedAt: new Date().toISOString() };
  persist([build, ...loadBuilds()]);
  return build;
}

export function deleteBuild(id: string): void {
  persist(loadBuilds().filter(b => b.id !== id));
}

// ---- export file shapes ----------------------------------------------------

interface FileMeta { version: 1; exportedAt: string; gameVersion: string }
export interface BackupFile extends FileMeta { kind: 'x4lp-backup'; builds: SavedBuild[]; roleOverrides: Record<string, RoleOverride>; customRoles?: CustomRoleDef[] }
export interface BuildFile extends FileMeta { kind: 'x4lp-build'; build: SavedBuild }
export interface RoleFile extends FileMeta { kind: 'x4lp-role'; roleId: string; name: string; override: RoleOverride }

function download(filename: string, obj: unknown): void {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

const meta = (gameVersion: string): FileMeta => ({ version: 1, exportedAt: new Date().toISOString(), gameVersion });
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'export';

export function exportBackup(gameVersion: string): void {
  const f: BackupFile = { kind: 'x4lp-backup', ...meta(gameVersion), builds: loadBuilds(), roleOverrides: loadOverrides(), customRoles: loadCustomRoles() };
  download(`x4lp-backup-${new Date().toISOString().slice(0, 10)}.json`, f);
}

export function exportBuild(build: SavedBuild, gameVersion: string): void {
  const f: BuildFile = { kind: 'x4lp-build', ...meta(gameVersion), build };
  download(`x4lp-build-${slug(build.name)}.json`, f);
}

export function exportRole(roleId: string, name: string, override: RoleOverride, gameVersion: string): void {
  const f: RoleFile = { kind: 'x4lp-role', ...meta(gameVersion), roleId, name, override };
  download(`x4lp-role-${slug(name)}.json`, f);
}

// ---- import -----------------------------------------------------------------

export interface ImportResult { builds: number; skippedBuilds: number; roles: number; skippedRoles: number; error?: string }

function validBuild(b: unknown, data: GameData): b is SavedBuild {
  const x = b as SavedBuild;
  return !!x && typeof x.shipId === 'string' && typeof x.name === 'string'
    && typeof x.loadout === 'object' && x.loadout !== null
    && data.ships.some(s => s.id === x.shipId);
}

function validOverride(o: unknown): o is RoleOverride {
  const x = o as RoleOverride;
  return !!x && typeof x.weights === 'object' && x.weights !== null && Array.isArray(x.inverted);
}

function mergeBuilds(incoming: SavedBuild[], data: GameData): { added: number; skipped: number } {
  const existing = loadBuilds();
  const seen = new Set(existing.map(b => b.id));
  let added = 0, skipped = 0;
  const merged = [...existing];
  for (const b of incoming) {
    if (!validBuild(b, data)) { skipped++; continue; }
    const nb: SavedBuild = {
      ...b,
      id: seen.has(b.id) ? `b_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}` : b.id,
      savedAt: b.savedAt ?? new Date().toISOString(),
    };
    seen.add(nb.id);
    merged.unshift(nb);
    added++;
  }
  persist(merged);
  return { added, skipped };
}

/** Import any x4lp file (backup, single build, or single role). Known role ids only —
 *  roles are overrides on the built-in set, so unknown ids are skipped. */
export function importFile(text: string, data: GameData, knownRoleIds: Set<string>): ImportResult {
  const res: ImportResult = { builds: 0, skippedBuilds: 0, roles: 0, skippedRoles: 0 };
  let f: BackupFile | BuildFile | RoleFile;
  try { f = JSON.parse(text); } catch { return { ...res, error: 'Not valid JSON.' }; }
  if (!f || typeof f !== 'object' || !('kind' in f)) return { ...res, error: 'Not an X4 Loadout Planner export file.' };

  if (f.kind === 'x4lp-build') {
    const m = mergeBuilds([f.build], data);
    res.builds = m.added; res.skippedBuilds = m.skipped;
  } else if (f.kind === 'x4lp-role') {
    if (knownRoleIds.has(f.roleId) && validOverride(f.override)) { saveOverride(f.roleId, f.override); res.roles = 1; }
    else res.skippedRoles = 1;
  } else if (f.kind === 'x4lp-backup') {
    const m = mergeBuilds(f.builds ?? [], data);
    res.builds = m.added; res.skippedBuilds = m.skipped;
    for (const [id, o] of Object.entries(f.roleOverrides ?? {})) {
      if (knownRoleIds.has(id) && validOverride(o)) { saveOverride(id, o); res.roles++; }
      else res.skippedRoles++;
    }
    for (const c of f.customRoles ?? []) {
      if (c && typeof c.id === 'string' && c.id.startsWith('custom_') && validOverride(c)) { saveCustomRole(c); res.roles++; }
    }
  } else {
    return { ...res, error: `Unknown file kind "${(f as { kind: string }).kind}".` };
  }
  return res;
}
