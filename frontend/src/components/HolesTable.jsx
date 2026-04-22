import { useState, useRef } from 'react';
import { analyzeCustomScorecard } from '../services/api.js';

const ALL_COLORS = ['black', 'white', 'yellow', 'blue', 'red'];

function findCgolfForCourse(cgolfData, courseKey) {
  if (!cgolfData?.matches) return null;
  if (cgolfData.matches.length === 1) return cgolfData.matches[0];
  const key = courseKey.toLowerCase();
  const slug = key.replace(/\s+/g, '-');
  return (
    cgolfData.matches.find(m =>
      m.cgolfName.toLowerCase().includes(key) ||
      m.cgolfUrl.toLowerCase().includes(slug)
    ) || cgolfData.matches[0]
  );
}

export default function HolesTable({
  course,
  holesData, holesLoading, holesError,
  cgolfData, cgolfLoading, cgolfError,
  onRefreshHoles,
}) {
  const [customSources, setCustomSources] = useState({});

  if (!course) return null;

  function setCustomSource(courseKey, result) {
    setCustomSources(prev => ({ ...prev, [courseKey]: result }));
  }
  function clearCustomSource(courseKey) {
    setCustomSources(prev => { const n = { ...prev }; delete n[courseKey]; return n; });
  }

  return (
    <div className="holes-section">
      <div className="holes-header">
        <h2>{course.name}</h2>
      </div>

      {holesLoading && !holesData && <p className="loading">Chargement OSM…</p>}
      {holesError && <p className="error">{holesError}</p>}

      {holesData && (() => {
        const { holes, quality, tees, greens } = holesData;
        const courseEntries = Object.entries(quality.courses);
        return (
          <>
            {courseEntries.map(([courseKey, courseData]) => {
              const defaultMatch = findCgolfForCourse(cgolfData, courseKey);
              const custom = customSources[courseKey];
              const activeMatch = custom
                ? { holes: custom.holes, cgolfName: custom.sourceName, cgolfUrl: null }
                : defaultMatch;
              const canUpdate = canUpdateOsm(courseData, activeMatch, custom ? { found: true } : cgolfData);

              return (
                <div key={courseKey} className="course-group">
                  {courseKey && <h3 className="course-key">{courseKey}</h3>}
                  <div className="panels-layout">

                    {/* ── Col 1 row 1 : en-tête OSM ── */}
                    <div className="panel-osm-header">
                      <div className="panel-title">
                        Source OSM
                        {holesLoading && <span className="osm-spinner" />}
                        {holesData && <QualityBadge quality={holesData.quality} />}
                        <a
                          className="osm-edit-btn"
                          href={`https://www.openstreetmap.org/edit#map=17/${course.lat}/${course.lng}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Ouvrir dans l'éditeur OSM"
                        >✏️ Éditer</a>
                        <button
                          className="refresh-btn"
                          onClick={onRefreshHoles}
                          disabled={holesLoading}
                          title="Recharger les données OSM"
                        >⟳</button>
                      </div>
                    </div>

                    {/* ── Col 2 : séparateur (spans 2 lignes) ── */}
                    <div className="panel-divider">
                      {canUpdate && (
                        <UpdateOsmButton
                          osmHoles={courseData.holes}
                          match={activeMatch}
                          courseKey={courseKey}
                          onRefreshHoles={onRefreshHoles}
                        />
                      )}
                    </div>

                    {/* ── Col 3 row 1 : en-tête scorecard ── */}
                    <div className="panel-cgolf-header">
                      <div className="panel-title">
                        Carte de score officielle
                        <span className="panel-source-sep">—</span>
                        <span className="panel-subtitle">
                          {custom ? custom.sourceName : 'cgolf.fr'}
                        </span>
                        {!custom && defaultMatch?.cgolfUrl && (
                          <a
                            className="cgolf-link-btn"
                            href={defaultMatch.cgolfUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Ouvrir la page cgolf.fr"
                          >↗</a>
                        )}
                      </div>
                      <CustomSourceInput
                        hasDefault={!!defaultMatch}
                        isCustom={!!custom}
                        onResult={result => setCustomSource(courseKey, result)}
                        onReset={() => clearCustomSource(courseKey)}
                      />
                    </div>

                    {/* ── Col 1 row 2 : tableau OSM ── */}
                    <div className="panel-osm-table">
                      <OsmUnifiedTable
                        holes={courseData.holes}
                        issues={courseData}
                        teesData={tees}
                        greensData={greens}
                        courseKey={courseKey}
                      />
                    </div>

                    {/* ── Col 3 row 2 : tableau scorecard ── */}
                    <div className="panel-cgolf-table">
                      <CgolfPanel
                        match={activeMatch}
                        cgolfLoading={cgolfLoading && !custom}
                        cgolfError={cgolfError}
                        cgolfFound={custom ? true : cgolfData?.found}
                      />
                    </div>

                  </div>
                </div>
              );
            })}
            {!holes.length && (
              <p className="empty">Aucun trou (golf=hole) trouvé dans un rayon de 5 km.</p>
            )}
          </>
        );
      })()}
    </div>
  );
}

function QualityBadge({ quality }) {
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

function OsmCourseTable({ holes, issues }) {
  if (!holes.length) return null;
  const dupRefs = new Set(issues.duplicateRefs || []);

  return (
    <div className="table-wrapper">
      <table className="holes-table">
        <thead>
          <tr>
            <th>Ref</th>
            <th>Par</th>
            <th>Hcp</th>
            {ALL_COLORS.map(c => <th key={c}>{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {holes.map(h => (
            <tr
              key={h.osmWayId}
              className={!h.ref ? 'row-warn' : dupRefs.has(h.ref) ? 'row-dup' : ''}
            >
              <td>{h.ref || <span className="missing">—</span>}</td>
              <td>{h.par || <span className="missing">—</span>}</td>
              <td>{h.handicap || <span className="missing">—</span>}</td>
              {ALL_COLORS.map(c => (
                <td key={c}>{h.distances[c] ?? <span className="missing">—</span>}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OsmUnifiedTable({ holes, issues, teesData, greensData, courseKey }) {
  if (!holes.length) return null;
  const dupRefs = new Set(issues.duplicateRefs || []);

  return (
    <div className="table-wrapper">
      <table className="holes-table">
        <thead>
          <tr>
            <th rowSpan={2}>Ref</th>
            <th colSpan={7} className="group-header">golf=hole</th>
            <th colSpan={5} className="group-header">golf=tee</th>
            <th colSpan={1} className="group-header">golf=green</th>
          </tr>
          <tr>
            <th className="group-start">Par</th>
            <th>Hcp</th>
            {ALL_COLORS.map(c => <th key={`hole-${c}`}>{c.slice(0, 3)}</th>)}
            {ALL_COLORS.map((c, i) => <th key={`tee-${c}`} className={i === 0 ? 'group-start' : ''}>{c.slice(0, 3)}</th>)}
            <th className="group-start">Green</th>
          </tr>
        </thead>
        <tbody>
          {holes.map(h => {
            const key = `${courseKey}|${h.ref}`;
            const holeTees = teesData?.[key];
            const greenStatus = greensData?.[key];
            let greenCell;
            if (greenStatus === 'tagged') greenCell = '✅';
            else if (greenStatus === 'untagged') greenCell = '⚠️';
            else if (greenStatus === 'missing') greenCell = '❌';
            else greenCell = <span className="missing">?</span>;

            return (
              <tr
                key={h.osmWayId}
                className={!h.ref ? 'row-warn' : dupRefs.has(h.ref) ? 'row-dup' : ''}
              >
                <td>{h.ref || <span className="missing">—</span>}</td>
                <td className="group-start">{h.par || <span className="missing">—</span>}</td>
                <td>{h.handicap || <span className="missing">—</span>}</td>
                {ALL_COLORS.map(c => (
                  <td key={`hole-${c}`}>{h.distances[c] ?? <span className="missing">—</span>}</td>
                ))}
                {ALL_COLORS.map((c, i) => {
                  const cls = i === 0 ? 'group-start' : '';
                  if (!h.distances[c]) return <td key={`tee-${c}`} className={cls}><span className="missing">—</span></td>;
                  const exists = holeTees?.[c];
                  if (exists === undefined) return <td key={`tee-${c}`} className={cls}><span className="missing">?</span></td>;
                  return <td key={`tee-${c}`} className={cls}>{exists ? '✅' : '❌'}</td>;
                })}
                <td className="group-start">{greenCell}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function canUpdateOsm(courseData, match, cgolfData) {
  if (!match || cgolfData?.found === false) return false;
  if (!match.holes?.length) return false;
  if ((courseData.duplicateRefs || []).length > 0) return false;
  const osmRefSet = new Set(courseData.holes.map(h => String(h.ref)));
  return match.holes.every(h => osmRefSet.has(String(h.hole)));
}

function UpdateOsmButton({ osmHoles, match, courseKey, onRefreshHoles }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="update-osm-btn" onClick={() => setOpen(true)} title="Mettre à jour OSM depuis cgolf.fr">
        ←
      </button>
      {open && (
        <UpdateOsmModal
          osmHoles={osmHoles}
          cgolfHoles={match.holes}
          courseKey={courseKey}
          onClose={() => setOpen(false)}
          onRefreshHoles={onRefreshHoles}
        />
      )}
    </>
  );
}

const BACKEND = 'http://localhost:3001';

function OsmLoginFlow({ onAuthenticated }) {
  const [step, setStep] = useState('idle');
  const [code, setCode] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  async function handleOpenOsm() {
    try {
      const res = await fetch('/api/osm-auth/auth-url');
      const { url } = await res.json();
      window.open(url, '_blank');
      setStep('waiting');
    } catch {
      setErrorMsg('Impossible de contacter le backend.');
      setStep('error');
    }
  }

  async function handleExchange() {
    if (!code.trim()) return;
    setStep('exchanging');
    try {
      const res = await fetch('/api/osm-auth/exchange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Échange échoué');
      onAuthenticated();
    } catch (err) {
      setErrorMsg(err.message);
      setStep('error');
    }
  }

  return (
    <div className="modal-auth">
      <p className="modal-desc">Connexion à OpenStreetMap requise pour écrire des modifications.</p>
      {step === 'idle' && (
        <button className="btn-osm-login" onClick={handleOpenOsm}>
          Ouvrir OSM pour autoriser
        </button>
      )}
      {step === 'waiting' && (
        <>
          <p className="modal-hint">
            OSM a affiché un code d'autorisation dans le nouvel onglet. Copie-le et colle-le ici :
          </p>
          <div className="modal-code-row">
            <input
              className="modal-code-input"
              type="text"
              placeholder="Code d'autorisation OSM"
              value={code}
              onChange={e => setCode(e.target.value)}
              autoFocus
            />
            <button className="btn-confirm" onClick={handleExchange} disabled={!code.trim()}>
              Valider
            </button>
          </div>
        </>
      )}
      {step === 'exchanging' && <p className="modal-loading">Échange du code…</p>}
      {step === 'error' && <p className="modal-error">❌ {errorMsg}</p>}
    </div>
  );
}

function UpdateOsmModal({ osmHoles, cgolfHoles, courseKey, onClose, onRefreshHoles }) {
  const [authChecked, setAuthChecked] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [force, setForce] = useState(false);
  const [status, setStatus] = useState(null);
  const [result, setResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');

  useState(() => {
    fetch('/api/osm-auth/status')
      .then(r => r.json())
      .then(d => { setAuthenticated(d.authenticated); setAuthChecked(true); })
      .catch(() => setAuthChecked(true));
  });

  async function handleConfirm() {
    setStatus('loading');
    setErrorMsg('');
    try {
      const res = await fetch('/api/holes/update-osm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ osmHoles, cgolfHoles, force }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur inconnue');
      setResult(data);
      setStatus('success');
      if (data.updated > 0) onRefreshHoles?.();
    } catch (err) {
      setErrorMsg(err.message);
      setStatus('error');
    }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h3 className="modal-title">Mettre à jour OSM depuis cgolf.fr</h3>

        {!authChecked && <p className="modal-loading">Vérification authentification…</p>}

        {authChecked && !authenticated && (
          <OsmLoginFlow onAuthenticated={() => setAuthenticated(true)} />
        )}

        {authChecked && authenticated && status === null && (
          <>
            <p className="modal-desc">
              Les champs <strong>par</strong>, <strong>handicap</strong> et <strong>distances</strong> (golf=hole)
              seront mis à jour dans OpenStreetMap.
            </p>
            <label className="modal-option">
              <input
                type="checkbox"
                checked={force}
                onChange={e => setForce(e.target.checked)}
              />
              <span>
                <strong>Force</strong> — écraser les valeurs OSM existantes si elles diffèrent de cgolf.fr
              </span>
            </label>
            <p className="modal-hint">
              Sans force : seules les valeurs <em>absentes</em> dans OSM sont ajoutées.
            </p>
          </>
        )}

        {status === 'loading' && <p className="modal-loading">Mise à jour en cours…</p>}

        {status === 'success' && (
          <div className="modal-success">
            {result.updated === 0
              ? <p>Aucune modification nécessaire — OSM est déjà à jour.</p>
              : <>
                  <p>✅ {result.updated} trou{result.updated > 1 ? 's' : ''} mis à jour.</p>
                  <ul className="modal-changes">
                    {result.changes.map(c => (
                      <li key={c.ref}>
                        <strong>Trou {c.ref}</strong> : {Object.entries(c.diff).map(([k, v]) => `${k}=${v}`).join(', ')}
                      </li>
                    ))}
                  </ul>
                </>
            }
          </div>
        )}

        {status === 'error' && <p className="modal-error">❌ {errorMsg}</p>}

        <div className="modal-actions">
          {authenticated && status === null && (
            <button className="btn-confirm" onClick={handleConfirm}>Confirmer</button>
          )}
          <button className="btn-cancel" onClick={onClose}>
            {status === 'success' || status === 'error' ? 'Fermer' : 'Annuler'}
          </button>
        </div>
      </div>
    </div>
  );
}

function CgolfPanel({ match, cgolfLoading, cgolfError, cgolfFound }) {
  if (cgolfLoading) return <p className="loading">Analyse scorecard…</p>;
  if (cgolfError) return <p className="error">{cgolfError}</p>;
  if (cgolfFound === false) return <p className="empty">Aucune correspondance cgolf.fr</p>;
  if (!match) return null;

  return (
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
          {match.holes.map(h => (
            <tr key={h.hole}>
              <td>{h.hole}</td>
              <td>{h.par ?? <span className="missing">—</span>}</td>
              <td>{h.handicap ?? <span className="missing">—</span>}</td>
              {ALL_COLORS.map(c => (
                <td key={c}>{h.distances?.[c] ?? <span className="missing">—</span>}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CustomSourceInput({ hasDefault, isCustom, onResult, onReset }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef(null);

  async function runAnalysis(payload) {
    setLoading(true);
    setError(null);
    try {
      const result = await analyzeCustomScorecard(payload);
      onResult(result);
      setOpen(false);
      setUrl('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleUrl(e) {
    e.preventDefault();
    if (!url.trim()) return;
    runAnalysis({ url: url.trim() });
  }

  function handleFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result.split(',')[1];
      runAnalysis({ fileData: base64, mimeType: file.type || 'image/jpeg', fileName: file.name });
    };
    reader.readAsDataURL(file);
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  if (!open) {
    return (
      <button
        className="custom-source-toggle"
        onClick={() => setOpen(true)}
        title="Utiliser une autre source de scorecard"
      >
        Changer source
      </button>
    );
  }

  return (
    <div className="custom-source-panel">
      <div className="custom-source-header">
        <span>Changer la source de scorecard</span>
        <button className="custom-source-close" onClick={() => { setOpen(false); setError(null); }}>×</button>
      </div>

      {hasDefault && isCustom && (
        <button className="custom-source-revert" onClick={() => { onReset(); setOpen(false); }}>
          ↩ Revenir à cgolf.fr
        </button>
      )}

      <form className="custom-source-url-row" onSubmit={handleUrl}>
        <input
          className="custom-source-url-input"
          type="url"
          placeholder="https://… (URL image)"
          value={url}
          onChange={e => setUrl(e.target.value)}
          disabled={loading}
        />
        <button className="custom-source-url-btn" type="submit" disabled={loading || !url.trim()}>
          {loading ? '…' : 'Analyser'}
        </button>
      </form>

      <div
        className={`custom-source-dropzone${dragging ? ' dragging' : ''}`}
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        {loading ? 'Analyse en cours…' : 'Glisser une image ici ou cliquer'}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={e => handleFile(e.target.files[0])}
        />
      </div>

      {error && <p className="custom-source-error">{error}</p>}
    </div>
  );
}
