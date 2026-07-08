import { useMemo, useState } from 'react';
import type { GameData } from '../types';
import { derive } from '../engine/derive';
import { STAT_SECTIONS } from '../format';
import type { CompareEntry } from '../App';

export default function CompareView({ data, entries, onRemove, onOpen }: {
  data: GameData;
  entries: CompareEntry[];
  onRemove: (i: number) => void;
  onOpen: (e: CompareEntry) => void;
}) {
  const [pct, setPct] = useState(false);
  const cols = useMemo(() => entries.map(e => {
    const ship = data.ships.find(s => s.id === e.shipId)!;
    return { entry: e, ship, d: derive(ship, e.loadout, data) };
  }).filter(c => c.ship), [entries, data]);

  if (!cols.length) {
    return <main className="compare"><div className="hint">Nothing to compare yet. Build a ship load out then press compare to add it to the comparison table.</div></main>;
  }

  return (
    <main className="compare">
      <div className="compare-tools">
        <label className="tt" data-tip="For each row, shows every build's value as a percentage of whichever build scored best on that stat — e.g. 80% means this build has 80% of the top build's cargo.">
          <input type="checkbox" checked={pct} onChange={e => setPct(e.target.checked)} /> Show % of best
        </label>
      </div>
      <div className="compare-scroll">
        <table>
          <thead>
            <tr>
              <th />
              {cols.map((c, i) => (
                <th key={i}>
                  <button className="link" onClick={() => onOpen(c.entry)}>{c.entry.label}</button>
                  <button className="x" onClick={() => onRemove(i)} title="Remove">✕</button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(() => {
              let dataRowIndex = 0;
              return STAT_SECTIONS.map(sec => {
                const rows = sec.rows.filter(r => cols.some(c => {
                  const v = c.d[r.key] as number;
                  return typeof v === 'number' && isFinite(v) && v !== 0;
                }));
                if (!rows.length) return null;
                return [
                  <tr key={sec.title} className="sec-row"><td colSpan={cols.length + 1}>{sec.title}</td></tr>,
                  ...rows.map(r => {
                    const vals = cols.map(c => c.d[r.key] as number);
                    const finite = vals.filter(v => isFinite(v));
                    const best = r.lowerBetter ? Math.min(...finite) : Math.max(...finite);
                    const rowClass = dataRowIndex++ % 2 === 1 ? 'data-row-alt' : '';
                    return (
                      <tr key={r.key} className={rowClass}>
                        <td className="stat-label"><span className="tt tt-left" data-tip={r.tip}>{r.label}</span>{r.lowerBetter && <span className="dir tt tt-left" data-tip="Lower is better">↓</span>}</td>
                        {vals.map((v, i) => {
                          const isBest = isFinite(v) && v === best && finite.length > 1;
                          const rel = pct && isFinite(v) && best !== 0
                            ? ` (${Math.round((r.lowerBetter ? best / v : v / best) * 100)}%)` : '';
                          return <td key={i} className={isBest ? 'best' : ''}>{r.format(v)}{rel}</td>;
                        })}
                      </tr>
                    );
                  }),
                ];
              });
            })()}
          </tbody>
        </table>
      </div>
    </main>
  );
}
