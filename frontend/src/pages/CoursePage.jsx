import { useState, useEffect } from 'react';
import { useParams, useLocation, useNavigate, Link } from 'react-router-dom';
import { fetchHoles, fetchCgolfHoles, fetchPersistedCustomSources, removePersistedCustomSource } from '../services/api.js';
import { buildComparison, findCgolfForCourse, swapHalves } from '../components/holes/compare.js';
import { QualityBadge, OsmUnifiedTable, CgolfPanel } from '../components/holes/tables.jsx';
import CustomSourceInput from '../components/holes/CustomSourceInput.jsx';

// Écran détail parcours. Body en zones pliables (base / OSM / carte). Le contenu OSM et
// la scorecard sont chargés paresseusement à l'ouverture de leur zone. Le delta
// (comparaison OSM↔carte, réutilise buildComparison) s'active depuis le header quand les
// deux zones sont dépliées. Édition (report, association ref, etc.) reportée.

const COURSE_KEY = 'osmgolf.course';

// Persistance du parcours ouvert : un reload / accès direct sur /course/:id restaure le
// nom + coords (l'URL ne porte que l'identifiant). Portée onglet (sessionStorage).
function loadCourse(id) {
  try {
    const raw = sessionStorage.getItem(COURSE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    return saved?.id === id ? saved.course : null;
  } catch {
    return null;
  }
}

function Zone({ title, badge, open, onToggle, actions, children, col }) {
  const style = { gridColumn: col };
  // Pliée : bande verticale étroite (titre à la verticale, cliquable pour déplier).
  if (!open) {
    return (
      <section className="detail-zone collapsed" style={style}>
        <button className="zone-collapsed-bar" onClick={onToggle} title={`Déplier « ${title} »`}>
          <span className="zone-collapsed-icon">▸</span>
          <span className="zone-collapsed-title">{title}</span>
        </button>
      </section>
    );
  }
  // Dépliée : colonne pleine. Le corps est aplati (display:contents en CSS) pour que ses
  // bandes (titre de sous-parcours, tableau) participent à la grille subgrid de la zone,
  // d'où l'alignement des lignes de trous d'une colonne à l'autre.
  return (
    <section className="detail-zone open" style={style}>
      <div className="zone-head" onClick={onToggle}>
        <button className="zone-toggle" aria-expanded={open} title={`Replier « ${title} »`}>▾</button>
        <h2>{title}</h2>
        {badge}
        {actions && <div className="zone-actions" onClick={e => e.stopPropagation()}>{actions}</div>}
      </div>
      <div className="zone-body">{children}</div>
    </section>
  );
}

export default function CoursePage() {
  const { id } = useParams();
  const { state } = useLocation();
  const navigate = useNavigate();

  const [course] = useState(() => state?.course ?? loadCourse(id));

  // Zones : base pliée (absente), OSM dépliée par défaut (pas de base), carte pliée.
  const [openBase, setOpenBase] = useState(false);
  const [openOsm, setOpenOsm] = useState(true);
  const [openCard, setOpenCard] = useState(false);

  const [holesData, setHolesData] = useState(null);
  const [holesLoading, setHolesLoading] = useState(false);
  const [holesError, setHolesError] = useState(null);

  const [cgolfData, setCgolfData] = useState(null);
  const [cgolfLoading, setCgolfLoading] = useState(false);
  const [cgolfError, setCgolfError] = useState(null);

  const [customSources, setCustomSources] = useState({});
  const [swappedCourses, setSwappedCourses] = useState(new Set());
  const [deltaOn, setDeltaOn] = useState(false);

  // Persiste le parcours ouvert (pour survivre à un reload / lien direct).
  useEffect(() => {
    if (!course) return;
    try {
      sessionStorage.setItem(COURSE_KEY, JSON.stringify({ id, course }));
    } catch {
      /* quota/private mode : ignore */
    }
  }, [id, course]);

  // Sources scorecard perso persistées (par osmId).
  useEffect(() => {
    if (!course?.osmId) return;
    fetchPersistedCustomSources(course.osmId).then(saved => {
      if (Object.keys(saved).length > 0) setCustomSources(saved);
    });
  }, [course?.osmId]);

  // Chargement initial de la zone OSM (dépliée par défaut). Effet de montage ; loadHoles
  // est déclaré plus bas (fonction hoistée) pour rester hors de l'analyse de l'effet.
  useEffect(() => {
    if (openOsm) loadHoles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function loadHoles() {
    if (!course) return;
    setHolesError(null);
    setHolesLoading(true);
    fetchHoles(course.osmId, course.lat, course.lng)
      .then(setHolesData)
      .catch(err => setHolesError(err.message))
      .finally(() => setHolesLoading(false));
  }

  function loadCgolf() {
    if (!course) return;
    setCgolfError(null);
    setCgolfLoading(true);
    fetchCgolfHoles(course.osmId, course.name, course.lat, course.lng)
      .then(setCgolfData)
      .catch(err => setCgolfError(err.message))
      .finally(() => setCgolfLoading(false));
  }

  // Lazy-load déclenché au dépliage d'une zone (dans le handler, pas dans un effet →
  // pas de re-fetch au repliage/redépliage, les données restent en mémoire).
  function toggleOsm() {
    const next = !openOsm;
    setOpenOsm(next);
    if (next && !holesData && !holesLoading) loadHoles();
  }
  function toggleCard() {
    const next = !openCard;
    setOpenCard(next);
    if (next && !cgolfData && !cgolfLoading) loadCgolf();
  }

  function setCustomSource(courseKey, result) {
    setCustomSources(prev => ({ ...prev, [courseKey]: result }));
  }
  function clearCustomSource(courseKey) {
    removePersistedCustomSource(course.osmId, courseKey);
    setCustomSources(prev => { const n = { ...prev }; delete n[courseKey]; return n; });
  }
  function toggleSwap(courseKey) {
    setSwappedCourses(prev => {
      const n = new Set(prev);
      n.has(courseKey) ? n.delete(courseKey) : n.add(courseKey);
      return n;
    });
  }

  if (!course) {
    return (
      <main className="page detail-page">
        <div className="detail-notice">
          <p>Impossible d'afficher ce parcours directement.</p>
          <p><Link to="/search" className="back-link">← Ouvre-le depuis la recherche</Link></p>
        </div>
      </main>
    );
  }

  // Le delta n'a de sens que si les deux zones comparées sont dépliées.
  const canDelta = openOsm && openCard;
  const deltaActive = deltaOn && canDelta;

  // Appariement par sous-parcours (courseKey) : table OSM, scorecard active, delta.
  const groups = holesData
    ? Object.entries(holesData.quality.courses).map(([courseKey, courseData]) => {
        const defaultMatch = findCgolfForCourse(cgolfData, courseKey);
        const custom = customSources[courseKey];
        const baseMatch = custom
          ? { holes: custom.holes, cgolfName: custom.sourceName, cgolfUrl: null }
          : defaultMatch;
        const isSwapped = swappedCourses.has(courseKey);
        const activeMatch = baseMatch && isSwapped
          ? { ...baseMatch, holes: swapHalves(baseMatch.holes) }
          : baseMatch;
        const comparison = deltaActive ? buildComparison(courseData.holes, activeMatch?.holes) : {};
        return { courseKey, courseData, defaultMatch, custom, baseMatch, isSwapped, activeMatch, comparison };
      })
    : [];

  // Grille du body : une colonne par zone (48px repliée, sinon 1fr) + pistes de lignes
  // partagées (en-tête, puis [titre, tableau] par sous-parcours) sur lesquelles les zones
  // dépliées se calent via subgrid → trou N aligné entre OSM et carte.
  const gridTemplateColumns = [openBase, openOsm, openCard]
    .map(o => (o ? 'minmax(0, 1fr)' : '48px'))
    .join(' ');
  const gridTemplateRows = groups.length > 0
    ? `auto repeat(${groups.length}, auto auto)`
    : 'auto';

  return (
    <main className="page detail-page">
      <div className="detail-subheader">
        <button className="back-btn" onClick={() => navigate(-1)} title="Retour">←</button>
        <div className="detail-title">
          <h1>{course.name}</h1>
          {course.city && <span className="detail-city">{course.city}</span>}
          {holesData && <QualityBadge quality={holesData.quality} />}
        </div>
        <div className="detail-ops">
          <button
            className={`delta-btn${deltaActive ? ' active' : ''}`}
            disabled={!canDelta}
            onClick={() => setDeltaOn(v => !v)}
            aria-pressed={deltaActive}
            title={canDelta ? 'Afficher/masquer le delta OSM ↔ carte' : 'Déplie les zones OSM et Carte pour comparer'}
          >
            Δ Delta {deltaActive ? 'ON' : 'OFF'}
          </button>
        </div>
      </div>

      {deltaActive && (
        <p className="delta-hint">Comparaison <strong>OSM ↔ carte</strong> : rouge = valeur absente d'un côté, orange = valeurs différentes.</p>
      )}

      <div className="detail-body" style={{ gridTemplateColumns, gridTemplateRows }}>
        {/* ── Zone parcours en base ── */}
        <Zone title="Parcours en base" col={1} open={openBase} onToggle={() => setOpenBase(o => !o)}>
          <p className="zone-empty">Base non alimentée — ce parcours n'existe pas encore en base (Firestore à venir).</p>
        </Zone>

        {/* ── Zone parcours OSM ── */}
        <Zone
          title="Parcours OSM"
          col={2}
          badge={holesData && <QualityBadge quality={holesData.quality} />}
          open={openOsm}
          onToggle={toggleOsm}
          actions={
            <>
              <a
                className="osm-edit-btn"
                href={`https://www.openstreetmap.org/edit#map=17/${course.lat}/${course.lng}`}
                target="_blank"
                rel="noopener noreferrer"
                title="Ouvrir dans l'éditeur OSM"
              >✏️ Éditer OSM</a>
              <button className="refresh-btn" onClick={loadHoles} disabled={holesLoading} title="Recharger les données OSM">⟳</button>
            </>
          }
        >
          {holesLoading && !holesData && <p className="loading">Chargement OSM…</p>}
          {holesError && <p className="error">{holesError}</p>}
          {holesData && groups.map(g => (
            <div key={g.courseKey} className="course-group">
              {/* Bande titre toujours rendue (même vide) pour garder le même nombre de
                  pistes que la colonne Carte → alignement subgrid. */}
              <h3 className="course-key">{g.courseKey}</h3>
              <OsmUnifiedTable
                holes={g.courseData.holes}
                issues={g.courseData}
                teesData={holesData.tees}
                greensData={holesData.greens}
                courseKey={g.courseKey}
                comparison={g.comparison}
              />
            </div>
          ))}
          {holesData && !holesData.holes.length && (
            <p className="empty">Aucun trou (golf=hole) trouvé dans un rayon de 5 km.</p>
          )}
        </Zone>

        {/* ── Zone carte de parcours (scorecard) ── */}
        <Zone title="Carte de parcours" col={3} open={openCard} onToggle={toggleCard}>
          {!holesData && !holesLoading && (
            <p className="zone-empty">Déplie d'abord la zone OSM pour apparier les sous-parcours.</p>
          )}
          {holesData && groups.map(g => (
            <div key={g.courseKey} className="course-group">
              {/* Titre du sous-parcours fusionné dans la bande source (même hauteur de
                  piste que la bande titre OSM) ; CgolfPanel gère son propre état de chargement. */}
              <div className="card-source-head">
                {g.courseKey && <span className="course-key">{g.courseKey}</span>}
                <span className="card-source-name">{g.custom ? g.custom.sourceName : 'cgolf.fr'}</span>
                {!g.custom && g.defaultMatch?.cgolfUrl && (
                  <a className="cgolf-link-btn" href={g.defaultMatch.cgolfUrl} target="_blank" rel="noopener noreferrer" title="Ouvrir la page cgolf.fr">↗</a>
                )}
                <CustomSourceInput
                  hasDefault={!!g.defaultMatch}
                  isCustom={!!g.custom}
                  osmId={course.osmId}
                  courseKey={g.courseKey}
                  onResult={result => setCustomSource(g.courseKey, result)}
                  onReset={() => clearCustomSource(g.courseKey)}
                />
              </div>
              <CgolfPanel
                match={g.activeMatch}
                cgolfLoading={cgolfLoading && !g.custom}
                cgolfError={cgolfError}
                cgolfFound={g.custom ? true : cgolfData?.found}
                comparison={g.comparison}
                isSwapped={g.isSwapped}
                canSwap={g.baseMatch?.holes?.length > 0}
                onToggleSwap={() => toggleSwap(g.courseKey)}
              />
            </div>
          ))}
        </Zone>
      </div>
    </main>
  );
}
