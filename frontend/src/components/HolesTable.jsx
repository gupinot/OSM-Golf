import { useState, useEffect } from 'react';
import { fetchPersistedCustomSources, removePersistedCustomSource } from '../services/api.js';
import { apiFetch } from '../services/http.js';
import { buildComparison, findCgolfForCourse, swapHalves } from './holes/compare.js';
import { QualityBadge, OsmUnifiedTable, CgolfPanel } from './holes/tables.jsx';
import CustomSourceInput from './holes/CustomSourceInput.jsx';

export default function HolesTable({
  course,
  holesData, holesLoading, holesError,
  cgolfData, cgolfLoading, cgolfError,
  onRefreshHoles,
}) {
  const [customSources, setCustomSources] = useState({});
  const [swappedCourses, setSwappedCourses] = useState(new Set());

  useEffect(() => {
    if (!course?.osmId) return;
    fetchPersistedCustomSources(course.osmId).then(saved => {
      if (Object.keys(saved).length > 0) setCustomSources(saved);
    });
  }, [course?.osmId]);

  if (!course) return null;

  function setCustomSource(courseKey, result) {
    setCustomSources(prev => ({ ...prev, [courseKey]: result }));
  }
  function clearCustomSource(courseKey) {
    removePersistedCustomSource(course.osmId, courseKey);
    setCustomSources(prev => { const n = { ...prev }; delete n[courseKey]; return n; });
  }

  return (
    <div className="holes-section">
      <div className="holes-header">
        <h2>{course.name}</h2>
        {holesData?.holes?.length > 0 && (
          <AssignRefsButton course={course} onRefreshHoles={onRefreshHoles} />
        )}
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
              const baseMatch = custom
                ? { holes: custom.holes, cgolfName: custom.sourceName, cgolfUrl: null }
                : defaultMatch;
              const isSwapped = swappedCourses.has(courseKey);
              const activeMatch = baseMatch && isSwapped
                ? { ...baseMatch, holes: swapHalves(baseMatch.holes) }
                : baseMatch;
              const canUpdate = canUpdateOsm(courseData, activeMatch, custom ? { found: true } : cgolfData);
              const comparison = buildComparison(courseData.holes, activeMatch?.holes);

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
                        osmId={course.osmId}
                        courseKey={courseKey}
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
                        comparison={comparison}
                      />
                    </div>

                    {/* ── Col 3 row 2 : tableau scorecard ── */}
                    <div className="panel-cgolf-table">
                      <CgolfPanel
                        match={activeMatch}
                        cgolfLoading={cgolfLoading && !custom}
                        cgolfError={cgolfError}
                        cgolfFound={custom ? true : cgolfData?.found}
                        comparison={comparison}
                        isSwapped={isSwapped}
                        canSwap={baseMatch?.holes?.length > 0}
                        onToggleSwap={() => setSwappedCourses(prev => {
                          const next = new Set(prev);
                          isSwapped ? next.delete(courseKey) : next.add(courseKey);
                          return next;
                        })}
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
      const res = await apiFetch('/api/osm-auth/auth-url');
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
      const res = await apiFetch('/api/osm-auth/exchange', {
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
    apiFetch('/api/osm-auth/status')
      .then(r => r.json())
      .then(d => { setAuthenticated(d.authenticated); setAuthChecked(true); })
      .catch(() => setAuthChecked(true));
  });

  async function handleConfirm() {
    setStatus('loading');
    setErrorMsg('');
    try {
      const res = await apiFetch('/api/holes/update-osm', {
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

function AssignRefsButton({ course, onRefreshHoles }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        className="assign-refs-btn"
        onClick={() => setOpen(true)}
        title="Affecter le ref (et course) des greens/tees sans ref, par géométrie"
      >
        🎯 Affecter ref greens/tees
      </button>
      {open && (
        <AssignRefsModal
          course={course}
          onClose={() => setOpen(false)}
          onRefreshHoles={onRefreshHoles}
        />
      )}
    </>
  );
}

function AssignRefsModal({ course, onClose, onRefreshHoles }) {
  const [authChecked, setAuthChecked] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [preview, setPreview] = useState(null);
  const [status, setStatus] = useState('idle'); // idle|previewing|ready|applying|success|error
  const [result, setResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    apiFetch('/api/osm-auth/status')
      .then(r => r.json())
      .then(d => { setAuthenticated(d.authenticated); setAuthChecked(true); })
      .catch(() => setAuthChecked(true));
  }, []);

  useEffect(() => {
    if (!authenticated || status !== 'idle') return;
    setStatus('previewing');
    apiFetch('/api/holes/assign-refs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ osmId: course.osmId, lat: course.lat, lng: course.lng, preview: true }),
    })
      .then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Erreur'); return d; })
      .then(d => { setPreview(d); setStatus('ready'); })
      .catch(err => { setErrorMsg(err.message); setStatus('error'); });
  }, [authenticated, status, course.osmId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleApply() {
    setStatus('applying');
    setErrorMsg('');
    try {
      const res = await apiFetch('/api/holes/assign-refs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ osmId: course.osmId, lat: course.lat, lng: course.lng, preview: false }),
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

  function renderChange(c, i) {
    const label = c.kind === 'green' ? 'Green' : 'Tee';
    const extras = [];
    if (c.ref) extras.push(`ref=${c.ref}`);
    if (c.course) extras.push(`course=${c.course}`);
    if (c.color) extras.push(`tee=${c.color}`);
    return (
      <li key={i}>
        <strong>{label} {c.osmId}</strong> : {extras.join(', ')}
      </li>
    );
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h3 className="modal-title">Affecter le ref des greens/tees (géométrie)</h3>

        {!authChecked && <p className="modal-loading">Vérification authentification…</p>}

        {authChecked && !authenticated && (
          <OsmLoginFlow onAuthenticated={() => setAuthenticated(true)} />
        )}

        {status === 'previewing' && <p className="modal-loading">Analyse géométrique…</p>}

        {status === 'ready' && preview && (
          <>
            <p className="modal-desc">
              Affectation du <strong>ref</strong> (et <strong>course</strong> si manquant) aux greens et tees,
              plus la <strong>couleur</strong> des tees (tag <code>tee</code>) déduite des distances
              <code>dist:*</code> du trou. Rien n'est écrasé si la valeur existe déjà.
            </p>
            {preview.changes.length === 0
              ? <p className="modal-success">Rien à faire — aucun green/tee sans ref n'a pu être associé.</p>
              : (
                <>
                  <p>{preview.changes.length} élément{preview.changes.length > 1 ? 's' : ''} à mettre à jour :</p>
                  <ul className="modal-changes">{preview.changes.map(renderChange)}</ul>
                </>
              )}
            {preview.skipped?.length > 0 && (
              <p className="modal-hint">
                {preview.skipped.length} ignoré{preview.skipped.length > 1 ? 's' : ''} (ambigus) :{' '}
                {preview.skipped.map(s => `${s.kind} ${s.osmId} (${s.reason})`).join(' ; ')}
              </p>
            )}
          </>
        )}

        {status === 'applying' && <p className="modal-loading">Écriture dans OSM…</p>}

        {status === 'success' && (
          <div className="modal-success">
            {result.updated === 0
              ? <p>Aucune modification appliquée.</p>
              : <>
                  <p>✅ {result.updated} élément{result.updated > 1 ? 's' : ''} mis à jour.</p>
                  <ul className="modal-changes">{result.changes.map(renderChange)}</ul>
                </>}
          </div>
        )}

        {status === 'error' && <p className="modal-error">❌ {errorMsg}</p>}

        <div className="modal-actions">
          {status === 'ready' && preview?.changes.length > 0 && (
            <button className="btn-confirm" onClick={handleApply}>Confirmer</button>
          )}
          <button className="btn-cancel" onClick={onClose}>
            {status === 'success' || status === 'error' ? 'Fermer' : 'Annuler'}
          </button>
        </div>
      </div>
    </div>
  );
}

