export type Size = 's' | 'm' | 'l' | 'xl';

export interface SlotGroup {
  key: string;
  kind: 'engine' | 'shield' | 'weapon' | 'turret';
  size: Size;
  count: number;
  accept?: string; // 'combat' | 'missile' | 'mining' | 'combat+missile' | 'special:<token>' ...
}

export interface Ship {
  id: string; name: string; size: Size; class: string;
  factions: string[]; dlc: string;
  hull: number; mass: number;
  dragFwd: number; dragPitch: number; dragYaw: number;
  inertiaPitch: number; inertiaYaw: number; accFwd: number;
  jerkFwd: number; jerkTravel: number; jerkBoost: number;
  people: number; missiles: number; cargo: number; cargoType: string;
  cms: number; docks: Record<string, number>;
  hangar?: number | null;
  groups: SlotGroup[];
}

export interface Engine {
  id: string; name: string; size: Size; mk: number; race: string; dlc: string;
  thrust: number; reverse: number;
  boostMult: number; boostDur: number; boostRech: number; boostAttack: number;
  travelMult: number; travelCharge: number; travelAttack: number; travelRelease: number;
}

export interface Shield {
  id: string; name: string; size: Size; mk: number; race: string; dlc: string;
  cap: number; rate: number; delay: number;
}

export interface Weapon {
  id: string; name: string; size: Size; mk: number; race: string; dlc: string;
  mount: 'weapon' | 'turret'; cat: 'combat' | 'missile' | 'mining';
  noDmg?: boolean;
  supp?: boolean;
  shieldDPS?: number; hullDPS?: number;
  system: string; beam: boolean;
  damage: number; rate: number; burst: number; sustained: number; duty: number;
  speed: number; range: number; rot: number; ammo: number; ammoReload: number; repair: number;
}

export type Module = Engine | Shield | Weapon;

export interface GameData {
  meta: { gameVersion: string; source: string; generated: string };
  factions: Record<string, string>;
  ships: Ship[]; engines: Engine[]; shields: Shield[]; weapons: Weapon[];
}

/** groupKey -> selected module id (null = empty) */
export type Loadout = Record<string, string | null>;

export interface Derived {
  topSpeed: number; boostSpeed: number; travelSpeed: number;
  accel: number; turn: number;
  travelEngage: number; travelFull: number; travelDist: number; cross100: number; cross50: number;
  boostDur: number; boostRech: number;
  shieldCap: number; shieldRate: number; shieldDelay: number; surfaceShields: number;
  ehp: number; ehp60: number; hull: number;
  burstDPS: number; sustainedDPS: number; totalSustained: number; alpha: number;
  range: number; projSpeed: number; hasBeam: boolean;
  turretDPS: number; turretSustained: number; turretTrack: number;
  miningDPS: number; missileDPS: number; missileCapacity: number;
  cargo: number; people: number; dockCap: number; cms: number;
}
