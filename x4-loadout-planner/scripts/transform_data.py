#!/usr/bin/env python3
"""Transform Mistralys/x4-core data (game v9.0.0.0) into the app's gamedata.json.

Usage: python3 scripts/transform_data.py --source <path-to-x4-core>/data --out public/data/gamedata.json
"""
import json, argparse, re, sys, datetime

DLC = {
    'vanilla': 'Base', 'ego_dlc_split': 'Split Vendetta', 'ego_dlc_terran': 'Cradle of Humanity',
    'ego_dlc_pirate': 'Tides of Avarice', 'ego_dlc_boron': 'Kingdom End',
    'ego_dlc_timelines': 'Timelines', 'ego_dlc_mini_01': 'Hyperion Pack', 'ego_dlc_mini_02': 'Envoy Pack',
}

def entries(x):
    if x is None: return []
    return x if isinstance(x, list) else [x]

def size_from_id(wid):
    m = re.search(r'_(xl|s|m|l)_', wid)
    return m.group(1) if m else None

def norm_token(tok):
    return tok[5:] if tok.startswith('ship_') else tok

def token_regex(tok):
    """arg_destroyer_01 -> matches ..._arg_(s|m|l|xl)_destroyer_01... or literal token."""
    t = norm_token(tok)
    parts = t.split('_', 1)
    pats = [re.escape(t)]
    if len(parts) == 2:
        pats.append(re.escape(parts[0]) + r'_(?:s|m|l|xl)_' + re.escape(parts[1]))
    return re.compile('|'.join(pats))

import re as _re
MISSILE_ID = _re.compile(r'_(dumbfire|guided|torpedo|tracking)_')

def weapon_kind(w):
    ws = w.get('weaponSystem', '')
    wid = w['wareID']
    mount = 'turret' if wid.startswith('turret_') else 'weapon'
    if ws == 'weapon_mining': cat = 'mining'
    # some missile turrets carry turret_* weaponSystem in the source data — catch them by id
    elif ws.startswith('missile') or ws in ('torpedo', 'bomb') or MISSILE_ID.search(wid): cat = 'missile'
    else: cat = 'combat'
    return mount, cat

def accept_key(tags, kind):
    toks = [t for t in tags if '_' in t and not t.startswith('symmetry')]
    if toks: return 'special:' + norm_token(toks[0])
    acc = []
    if 'combat' in tags: acc.append('combat')
    if 'missile' in tags: acc.append('missile')
    if 'mining' in tags: acc.append('mining')
    if not acc: acc = ['combat']
    return '+'.join(acc)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--source', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--supplemental', default='data/supplemental')
    a = ap.parse_args()
    import os
    def load_supp(name):
        p = os.path.join(a.supplemental, name)
        if os.path.exists(p):
            try: return json.load(open(p))
            except Exception as e: print(f'WARN: bad supplemental {name}: {e}')
        return None
    supp_dmg = (load_supp('damage-overrides.json') or {}).get('weapons', {})
    supp_mis = (load_supp('missiles.json') or {}).get('launchers', {})
    supp_hang = (load_supp('hangars.json') or {}).get('ships', {})
    filled_dmg = filled_mis = 0
    L = lambda f: json.load(open(f'{a.source}/{f}'))
    ships, engines, shields, weapons, factions = L('ships.json'), L('engines.json'), L('shields.json'), L('weapons.json'), L('factions.json')

    out_engines = []
    for e in engines:
        out_engines.append({
            'id': e['wareID'], 'name': e['label'], 'size': e['size'], 'mk': e.get('mk', 1),
            'race': (e.get('makerRaces') or ['generic'])[0], 'dlc': DLC.get(e.get('dataSourceID', 'vanilla'), e.get('dataSourceID')),
            'thrust': e.get('thrustForward', 0), 'reverse': e.get('thrustReverse', 0),
            'boostMult': e.get('boostThrust', 0), 'boostDur': e.get('boostDuration', 0),
            'boostRech': e.get('boostRecharge', 0), 'boostAttack': e.get('boostAttack', 0),
            'travelMult': e.get('travelThrust', 0), 'travelCharge': e.get('travelCharge', 0),
            'travelAttack': e.get('travelAttack', 0), 'travelRelease': e.get('travelRelease', 0),
        })
    out_shields = [{
        'id': s['wareID'], 'name': s['label'], 'size': s['size'], 'mk': s.get('mk', 1),
        'race': (s.get('makerRaces') or ['generic'])[0], 'dlc': DLC.get(s.get('dataSourceID', 'vanilla'), s.get('dataSourceID')),
        'cap': s.get('rechargeMax', 0), 'rate': s.get('rechargeRate', 0), 'delay': s.get('rechargeDelay', 0),
    } for s in shields]

    out_weapons = []
    for w in weapons:
        size = w.get('size') or size_from_id(w['wareID'])
        if not size: continue
        mount, cat = weapon_kind(w)
        ws = w.get('weaponSystem', '')
        spd, life = w.get('bulletSpeed', 0), w.get('bulletLifetime', 0)
        beam = spd >= 1e8
        rate = w.get('reloadRate', 0)
        ammo, ammo_reload = w.get('ammoValue', 0), w.get('ammoReload', 0)
        timediff = w.get('bulletTimediff', 0)
        # magazine weapons (e.g. L plasma turrets): fire `ammo` shots, then reload for `ammoReload` s
        if cat != 'missile' and ammo > 0 and ammo_reload > 0:
            intra = 1.0 / rate if rate > 0 else (timediff if timediff > 0 else 0)
            rate = ammo / ((ammo - 1) * intra + ammo_reload)
        dmg, amt, barrels = w.get('damageValue', 0), max(1, w.get('bulletAmount', 1)), max(1, w.get('bulletBarrelamount', 1))
        if beam:
            burst = dmg  # beam damageValue behaves as DPS
        elif cat == 'missile':
            burst = 0    # missile ammo stats not in dataset (known gap)
        else:
            burst = dmg * amt * barrels * rate
        hps = w.get('heatPerShot', 0)
        duty = 1.0
        if hps > 0 and rate > 0 and w.get('heatOverheat', 0) > 0:
            cool = w.get('heatCoolrate', 0)
            duty = min(1.0, cool / (hps * rate)) if hps * rate > 0 else 1.0
        rng = 0 if beam else round(spd * life)
        if not beam and w.get('bulletRange', 0): rng = max(rng, w['bulletRange'])
        no_dmg = cat == 'combat' and burst == 0
        supp = False
        shield_dps = hull_dps = 0
        # supplemental damage (flak/ion) — raw per-shot values hand-filled or extracted
        ov = supp_dmg.get(w['wareID'])
        if no_dmg and ov and ov.get('burstDPS'):
            # DPS-level fill (e.g. from Roguey's list page Burst column); RoF from the same row
            # restores per-shot damage (alpha) for weapons whose rate wasn't extracted
            burst = ov['burstDPS']
            if rate <= 0 and ov.get('rof'):
                rate = ov['rof']
            dmg, no_dmg, supp = (burst / (amt * barrels * rate) if rate > 0 else burst), False, True
            filled_dmg += 1
        elif no_dmg and ov and (ov.get('value') or ov.get('shield') or ov.get('hull')):
            sv, hv = ov.get('shield') or 0, ov.get('hull') or 0
            dmg_eff = ov.get('value') or (sv + hv) / 2
            burst = dmg_eff * amt * barrels * rate
            shield_dps = round((ov.get('value') or sv) * amt * barrels * rate * duty, 1)
            hull_dps = round((ov.get('value') or hv) * amt * barrels * rate * duty, 1)
            dmg, no_dmg, supp = dmg_eff, False, True
            filled_dmg += 1
        # supplemental missiles — representative missile per launcher
        mv = supp_mis.get(w['wareID'])
        if cat == 'missile' and mv and mv.get('missileDamage'):
            m_rate = rate
            if ammo > 0 and ammo_reload > 0:
                intra = 1.0 / rate if rate > 0 else (timediff if timediff > 0 else 1.0)
                m_rate = ammo / ((ammo - 1) * intra + ammo_reload)
            elif rate <= 0:
                m_rate = 1.0 / max(1.0, ammo_reload or 4.0)
            burst = mv['missileDamage'] * m_rate
            dmg, supp = mv['missileDamage'], True
            if mv.get('missileSpeed'): spd = mv['missileSpeed']
            filled_mis += 1
        out_weapons.append({
            'noDmg': no_dmg, 'supp': supp, 'shieldDPS': shield_dps, 'hullDPS': hull_dps,
            'id': w['wareID'], 'name': w['label'], 'size': size, 'mk': w.get('mk', 1),
            'race': (w.get('makerRaces') or ['generic'])[0], 'dlc': DLC.get(w.get('dataSourceID', 'vanilla'), w.get('dataSourceID')),
            'mount': mount, 'cat': cat, 'system': ws, 'beam': beam,
            'damage': dmg, 'rate': rate, 'burst': round(burst, 1), 'sustained': round(burst * duty, 1),
            'duty': round(duty, 3), 'speed': 0 if beam else spd, 'range': rng,
            'rot': w.get('rotationSpeed', 0), 'ammo': w.get('ammoValue', 0), 'ammoReload': w.get('ammoReload', 0),
            'repair': w.get('repairValue', 0),
        })

    out_ships = []
    for s in ships:
        eq = s.get('equipment') or {}
        groups = []
        eng = entries(eq.get('engines'))
        if eng:
            groups.append({'key': 'engine', 'kind': 'engine', 'size': eng[0]['size'], 'count': sum(e.get('count', 1) for e in eng)})
        for i, sh in enumerate(entries(eq.get('shields'))):
            groups.append({'key': f"shield_{sh['size']}", 'kind': 'shield', 'size': sh['size'], 'count': sh.get('count', 1)})
        # merge weapon/turret entries by (size, accept)
        for kind in ('weapon', 'turret'):
            merged = {}
            for e in entries(eq.get(kind + 's')):
                ak = accept_key(e.get('tags', []), kind)
                k = (e['size'], ak)
                merged[k] = merged.get(k, 0) + e.get('count', 1)
            for (sz, ak), cnt in sorted(merged.items()):
                groups.append({'key': f'{kind}_{sz}_{ak}', 'kind': kind, 'size': sz, 'count': cnt, 'accept': ak})
        # merge duplicate shield keys
        sm = {}
        final = []
        for g in groups:
            if g['kind'] == 'shield':
                if g['key'] in sm: sm[g['key']]['count'] += g['count']; continue
                sm[g['key']] = g
            final.append(g)
        out_ships.append({
            'id': s['wareID'], 'name': s['label'], 'size': s['size'], 'class': s['classID'],
            'factions': s.get('builderFactionIDs', []), 'dlc': DLC.get(s.get('dataSourceID', 'vanilla'), s.get('dataSourceID')),
            'hull': s.get('hull', 0), 'mass': s.get('mass', 0),
            'dragFwd': s.get('dragForward', 1), 'dragPitch': s.get('dragPitch', 1), 'dragYaw': s.get('dragYaw', 1),
            'inertiaPitch': s.get('inertiaPitch', 1), 'inertiaYaw': s.get('inertiaYaw', 1),
            'accFwd': s.get('accFactorForward', 1),
            'jerkFwd': s.get('jerkForwardAccel', 0), 'jerkTravel': s.get('jerkTravelAccel', 0), 'jerkBoost': s.get('jerkBoostAccel', 0),
            'people': s.get('people', 0), 'missiles': s.get('storageMissile', 0),
            'cargo': s.get('cargoCapacity', 0), 'cargoType': s.get('cargoType', ''),
            'cms': (eq.get('countermeasures') or 0), 'docks': eq.get('docks') or {},
            'hangar': (supp_hang.get(s['wareID']) or {}).get('capacity'),
            'groups': final,
        })

    # disambiguate colliding display names (hull refreshes and turret mount variants share labels)
    import collections as _c, re as _re
    def _dedupe(items):
        byname = _c.defaultdict(list)
        for it in items: byname[it['name']].append(it)
        for name, group in byname.items():
            if len(group) < 2: continue
            for it in group:
                m = _re.search(r'_(\d+)(?:_[a-z])?(?:_mk\d+)?$', it['id'])
                tag = m.group(1).lstrip('0') or '1' if m else '?'
                it['name'] = f"{name} (T{tag})"
    _dedupe(out_ships); _dedupe(out_weapons); _dedupe(out_engines); _dedupe(out_shields)

    data = {
        'meta': {'gameVersion': '9.0.0.0', 'source': 'github.com/Mistralys/x4-core (MIT)',
                 'generated': datetime.date.today().isoformat()},
        'factions': {f['id']: f['name'] for f in factions},
        'ships': out_ships, 'engines': out_engines, 'shields': out_shields, 'weapons': out_weapons,
    }
    json.dump(data, open(a.out, 'w'), separators=(',', ':'))
    print(f"ships={len(out_ships)} engines={len(out_engines)} shields={len(out_shields)} weapons={len(out_weapons)}")
    if supp_dmg or supp_mis:
        missing_d = sum(1 for k, v in supp_dmg.items() if not (v.get('value') or v.get('shield') or v.get('hull') or v.get('burstDPS')))
        missing_m = sum(1 for k, v in supp_mis.items() if not v.get('missileDamage'))
        print(f"supplemental: damage filled {filled_dmg}/{len(supp_dmg)} (missing {missing_d}), missiles filled {filled_mis}/{len(supp_mis)} (missing {missing_m})")
    # sanity prints
    b = next(x for x in out_ships if x['name'] == 'Behemoth Vanguard')
    print('Behemoth groups:', json.dumps(b['groups']))
    pulse = next((w for w in out_weapons if 'Pulse' in w['name'] and w['size'] == 's' and w['mk'] == 1), None)
    print('sample S pulse:', json.dumps(pulse))

if __name__ == '__main__':
    main()
