import type { Derived, Ship } from '../types';

export interface Role {
  id: string;
  name: string;
  desc: string;
  /** How you'd actually use this in an X4 playthrough */
  playstyle: string;
  weights: Partial<Record<keyof Derived, number>>;
  inverted?: (keyof Derived)[];
  appliesTo?: (ship: Ship) => boolean;
  /** how this role wants mixed weapon/missile slots filled */
  missilePref?: 'auto' | 'prefer' | 'avoid';
  /** score across all applicable ships instead of per size class (e.g. carriers: L and XL compete) */
  poolAll?: boolean;
}

const hasKind = (s: Ship, kind: string) => s.groups.some(g => g.kind === kind);

// Ship purpose from class: a Dolphin having turrets doesn't make it a warship,
// and a Hyperion having cargo doesn't make it a station hauler.
const COMBAT_CLASSES = new Set(['fighter', 'heavyfighter', 'scout', 'corvette', 'frigate', 'gunboat',
  'destroyer', 'battleship', 'carrier', 'resupplier', 'expeditionary']);
const TRADE_CLASSES = new Set(['freighter', 'transporter', 'courier', 'envoy']);
const isCombat = (s: Ship) => COMBAT_CLASSES.has(s.class);
const isTrade = (s: Ship) => TRADE_CLASSES.has(s.class);

// Roles is in BETA: we ship a small, well-tested starter set and lean on
// custom roles (below) for anything else. Add your own from the Roles page,
// or tune/rename these two freely — changes persist per-browser.
export const DEFAULT_ROLES: Role[] = [
  {
    id: 'hauler', name: 'Efficient Haulers',
    desc: 'Move the most cargo per minute, whether that\'s a short station-to-station hop or a cross-sector run: cargo capacity first, both hop-distance timers close behind.',
    playstyle: 'General-purpose trade and logistics ships — station supply runs, auto-traders, distribute-wares duty. Works for both intra-sector haulers and cross-sector couriers.',
    weights: { cargo: 0.35, cross50: 0.20, cross100: 0.20, travelEngage: 0.15, topSpeed: 0.10 },
    inverted: ['cross50', 'cross100', 'travelEngage'],
    appliesTo: s => isTrade(s) && s.cargo > 0,
  },
  {
    id: 'bomber', name: 'Bombers',
    desc: 'The bulk of any carrier wing: "big booms" — torpedoes, plasma, blast mortars — delivered fast. Speed is life; shields are for ships that get hit.',
    playstyle: 'Set to Bombard under a carrier or maintenance base. Chimera/Barracuda torpedo runs delete stations and capitals faster than destroyer lines — just feed the ammo logistics.',
    weights: { missileDPS: 0.25, alpha: 0.25, topSpeed: 0.25, boostSpeed: 0.15, accel: 0.10 },
    appliesTo: s => isCombat(s) && hasKind(s, 'weapon') && (s.size === 's' || s.size === 'm'),
    missilePref: 'prefer',
  },
];

// ---- custom roles (fully user-defined), persisted in localStorage ----

const LS_CUSTOM = 'x4lp-custom-roles';

export interface CustomRoleDef {
  id: string; name: string; desc: string;
  weights: Partial<Record<keyof Derived, number>>;
  inverted: (keyof Derived)[];
}

export function loadCustomRoles(): CustomRoleDef[] {
  try {
    const v = JSON.parse(localStorage.getItem(LS_CUSTOM) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}

export function saveCustomRole(def: CustomRoleDef): void {
  const all = loadCustomRoles().filter(r => r.id !== def.id);
  all.push(def);
  try { localStorage.setItem(LS_CUSTOM, JSON.stringify(all)); } catch { /* ignore */ }
}

export function deleteCustomRole(id: string): void {
  try { localStorage.setItem(LS_CUSTOM, JSON.stringify(loadCustomRoles().filter(r => r.id !== id))); } catch { /* ignore */ }
}

export function newCustomRoleId(): string {
  return `custom_${Date.now().toString(36)}`;
}

// ---- user overrides (weights + inverted), persisted in localStorage ----

const LS_KEY = 'x4lp-role-overrides';

export interface RoleOverride {
  weights: Partial<Record<keyof Derived, number>>;
  inverted: (keyof Derived)[];
  /** rename/redescribe a built-in role without forking it into a custom role */
  name?: string;
  desc?: string;
}

export function loadOverrides(): Record<string, RoleOverride> {
  try { return JSON.parse(localStorage.getItem(LS_KEY) ?? '{}'); } catch { return {}; }
}

export function saveOverride(roleId: string, o: RoleOverride | null): void {
  const all = loadOverrides();
  if (o) all[roleId] = o; else delete all[roleId];
  try { localStorage.setItem(LS_KEY, JSON.stringify(all)); } catch { /* storage unavailable */ }
}

/** Default roles merged with user overrides, plus any custom roles (apply to all ships). */
export function getRoles(): Role[] {
  const ov = loadOverrides();
  const base = DEFAULT_ROLES.map(r => {
    const o = ov[r.id];
    return o ? { ...r, weights: o.weights, inverted: o.inverted, name: o.name ?? r.name, desc: o.desc ?? r.desc } : r;
  });
  const custom: Role[] = loadCustomRoles().map(c => ({
    id: c.id, name: c.name, desc: c.desc || 'Custom role.',
    playstyle: 'Your own doctrine — edit the weights below.',
    weights: c.weights, inverted: c.inverted,
  }));
  return [...base, ...custom];
}

export function isOverridden(roleId: string): boolean {
  return roleId in loadOverrides();
}

export const roleMap = (roles: Role[]): Record<string, Role> =>
  Object.fromEntries(roles.map(r => [r.id, r]));
