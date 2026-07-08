import { useState, useEffect, useRef } from 'react';
import { ALL_COLORS, cellClass } from './compare.js';

// Tableaux d'affichage partagés (OSM Proxy + page détail parcours).

export function QualityBadge({ quality }) {
  const issues = [];
  if (quality.missingRefCount > 0) issues.push(`${quality.missingRefCount} sans ref`);
  if (quality.unresolvedDuplicates > 0) issues.push(`${quality.unresolvedDuplicates} doublons`);

  if (quality.valid) {
    return <span className="badge badge-ok">✓ {quality.totalHoles} trous</span>;
  }
  return (
    <span className="badge badge-warn">
      ⚠ {quality.totalHoles} trous — {issues.join(', ')}
    </span>
  );
}

export function OsmUnifiedTable({ holes, issues, teesData, greensData, courseKey, comparison }) {
  if (!holes.length) return null;
  const dupRefs = new Set(issues.duplicateRefs || []);

  return (
    <div className="table-wrapper">
      <table className="holes-table">
        <thead>
          <tr>
            <th colSpan={2} className="group-header">Ref</th>
            <th colSpan={7} className="group-header">golf=hole</th>
            <th colSpan={6} className="group-header">golf=tee</th>
            <th colSpan={1} className="group-header">golf=green</th>
          </tr>
          <tr>
            <th title="N° de trou cible (parcours via course/regex)">cible</th>
            <th title="Valeur ref actuelle sur OSM">OSM</th>
            <th className="group-start">Par</th>
            <th>Hcp</th>
            {ALL_COLORS.map(c => <th key={`hole-${c}`}>{c.slice(0, 3)}</th>)}
            {ALL_COLORS.map((c, i) => <th key={`tee-${c}`} className={i === 0 ? 'group-start' : ''}>{c.slice(0, 3)}</th>)}
            <th title="Tees avec ref mais sans tag couleur">nocolor</th>
            <th className="group-start">Green</th>
          </tr>
        </thead>
        <tbody>
          {holes.map(h => {
            const key = `${courseKey}|${h.refTarget}`;
            const holeTees = teesData?.[key];
            const greenStatus = greensData?.[key];
            const refDiverges = h.ref !== h.refTarget;
            let greenCell;
            if (greenStatus === 'tagged') greenCell = '✅';
            else if (greenStatus === 'untagged') greenCell = '⚠️';
            else if (greenStatus === 'missing') greenCell = '❌';
            else greenCell = <span className="missing">?</span>;

            return (
              <tr
                key={h.osmWayId}
                className={!h.refTarget ? 'row-warn' : dupRefs.has(h.refTarget) ? 'row-dup' : ''}
              >
                <td>{h.refTarget || <span className="missing">—</span>}</td>
                <td className={refDiverges ? 'cell-mismatch' : ''}>
                  {h.ref || <span className="missing">—</span>}
                </td>
                {(() => {
                  const cmp = comparison?.[String(h.refTarget)];
                  return <>
                    <td className={['group-start', cellClass(cmp?.par, 'osm')].filter(Boolean).join(' ')}>
                      {h.par || <span className="missing">—</span>}
                    </td>
                    <td className={cellClass(cmp?.handicap, 'osm')}>
                      {h.handicap || <span className="missing">—</span>}
                    </td>
                    {ALL_COLORS.map(c => (
                      <td key={`hole-${c}`} className={cellClass(cmp?.distances?.[c], 'osm')}>
                        {h.distances[c] ?? <span className="missing">—</span>}
                      </td>
                    ))}
                  </>;
                })()}
                {ALL_COLORS.map((c, i) => {
                  const cls = i === 0 ? 'group-start' : '';
                  if (!h.distances[c]) return <td key={`tee-${c}`} className={cls}><span className="missing">—</span></td>;
                  const exists = holeTees?.[c];
                  if (exists === undefined) return <td key={`tee-${c}`} className={cls}><span className="missing">?</span></td>;
                  return <td key={`tee-${c}`} className={cls}>{exists ? '✅' : '❌'}</td>;
                })}
                <td>{holeTees?.nocolor ? (holeTees.nocolor > 1 ? `⚠️ ${holeTees.nocolor}` : '⚠️') : <span className="missing">—</span>}</td>
                <td className="group-start">{greenCell}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function CgolfPanel({ match, cgolfLoading, cgolfError, cgolfFound, comparison, isSwapped, canSwap, onToggleSwap }) {
  const splitRowRef = useRef(null);
  const [btnTop, setBtnTop] = useState(null);

  useEffect(() => {
    if (splitRowRef.current) {
      setBtnTop(splitRowRef.current.offsetTop);
    }
  }, [match?.holes]);

  if (cgolfLoading) return <p className="loading">Analyse scorecard…</p>;
  if (cgolfError) return <p className="error">{cgolfError}</p>;
  if (cgolfFound === false) return <p className="empty">Aucune correspondance cgolf.fr</p>;
  if (!match) return <p className="empty">Pas de scorecard cgolf pour ce sous-parcours</p>;

  const hasSplit = canSwap && match.holes.some(h => Number(h.hole) === 10);

  return (
    <div className="cgolf-panel-outer">
      <div className="table-wrapper">
        <table className="holes-table">
          <thead>
            <tr>
              <th colSpan={8} className="group-header">scorecard</th>
            </tr>
            <tr>
              <th>Ref</th>
              <th>Par</th>
              <th>Hcp</th>
              {ALL_COLORS.map(c => <th key={c}>{c.slice(0, 3)}</th>)}
            </tr>
          </thead>
          <tbody>
            {match.holes.map(h => {
              const isHole10 = Number(h.hole) === 10;
              const cmp = comparison?.[String(h.hole)];
              return (
                <tr key={h.hole} ref={isHole10 ? splitRowRef : null}>
                  <td>{h.hole}</td>
                  <td className={cellClass(cmp?.par, 'cgolf')}>{h.par ?? <span className="missing">—</span>}</td>
                  <td className={cellClass(cmp?.handicap, 'cgolf')}>{h.handicap ?? <span className="missing">—</span>}</td>
                  {ALL_COLORS.map(c => (
                    <td key={c} className={cellClass(cmp?.distances?.[c], 'cgolf')}>
                      {h.distances?.[c] ?? <span className="missing">—</span>}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {hasSplit && btnTop !== null && (
        <button
          className={`swap-halves-btn${isSwapped ? ' active' : ''}`}
          style={{ top: btnTop }}
          onClick={onToggleSwap}
        >
          {isSwapped ? 'unswitch front/back' : 'switch front/back'}
        </button>
      )}
    </div>
  );
}
