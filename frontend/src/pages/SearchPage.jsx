import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet';
import SearchPanel from '../components/SearchPanel.jsx';

// Écran de recherche de parcours. Réutilise SearchPanel (par nom / par zone) pour
// l'interrogation OSM. Les sources « Base » et « Les deux » sont désactivées tant que
// Firestore n'est pas en place. Un clic sur un résultat navigue vers /course/:id.

const FRANCE_CENTER = [46.6, 2.5];
const FRANCE_ZOOM = 5.5;

// Persistance de la dernière recherche (résultats + vue) : au retour depuis le détail
// parcours (ou après un reload), on retrouve la liste/carte de la dernière recherche.
// Portée onglet (sessionStorage), comme la session de l'OSM Proxy.
const SEARCH_KEY = 'osmgolf.search';

function loadSearch() {
  try {
    const raw = sessionStorage.getItem(SEARCH_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

// osmId "way/22752042" → identifiant d'URL "way-22752042" (le / casserait la route).
function courseToId(course) {
  return course.osmId.replace('/', '-');
}

// Recentre/ajuste la carte sur les résultats à chaque nouvelle recherche.
function FitBounds({ points }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) {
      map.setView(FRANCE_CENTER, FRANCE_ZOOM);
    } else if (points.length === 1) {
      map.setView(points[0], 13);
    } else {
      map.fitBounds(points, { padding: [40, 40] });
    }
  }, [points, map]);
  return null;
}

function PresenceBadges() {
  // Présence : OSM confirmé (résultat issu d'OSM), Base non branchée pour l'instant.
  return (
    <span className="presence">
      <span className="presence-badge on" title="Présent sur OpenStreetMap">OSM</span>
      <span className="presence-badge off" title="Base non alimentée (Firestore à venir)">Base</span>
    </span>
  );
}

function ResultsList({ courses, onOpen }) {
  return (
    <ul className="results-list">
      {courses.map(course => (
        <li key={course.osmId}>
          <button type="button" className="result-row" onClick={() => onOpen(course)}>
            <span className="result-main">
              <span className="result-name">{course.name}</span>
              <span className="result-meta">
                {course.city && <span>{course.city}</span>}
                {course.distanceKm != null && <span>{course.distanceKm} km</span>}
              </span>
            </span>
            <PresenceBadges />
            <span className="result-chevron">›</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function ResultsMap({ courses, onOpen }) {
  const points = useMemo(
    () => courses.filter(c => c.lat != null && c.lng != null).map(c => [c.lat, c.lng]),
    [courses]
  );
  return (
    <MapContainer className="search-map" center={FRANCE_CENTER} zoom={FRANCE_ZOOM} scrollWheelZoom>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitBounds points={points} />
      {courses.filter(c => c.lat != null && c.lng != null).map(course => (
        <CircleMarker
          key={course.osmId}
          center={[course.lat, course.lng]}
          radius={7}
          pathOptions={{ color: '#166534', fillColor: '#22c55e', fillOpacity: 0.8, weight: 2 }}
        >
          <Popup>
            <strong>{course.name}</strong>
            {course.city && <div>{course.city}</div>}
            <button type="button" className="popup-link" onClick={() => onOpen(course)}>
              Voir le détail →
            </button>
          </Popup>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}

export default function SearchPage() {
  const navigate = useNavigate();
  // Lu au montage : restaure la dernière recherche persistée.
  const [persisted] = useState(loadSearch);
  const [results, setResults] = useState(persisted.results ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [view, setView] = useState(persisted.view ?? 'list');

  // Sauvegarde résultats + vue à chaque changement (les états transitoires
  // loading/error ne sont pas persistés).
  useEffect(() => {
    try {
      sessionStorage.setItem(SEARCH_KEY, JSON.stringify({ results, view }));
    } catch {
      /* quota/private mode : ignore */
    }
  }, [results, view]);

  const courses = results?.courses ?? [];

  function openCourse(course) {
    // L'objet complet est passé via state pour que la page détail dispose du nom/coords
    // sans re-requêter (l'URL ne porte que l'identifiant).
    navigate(`/course/${courseToId(course)}`, { state: { course } });
  }

  return (
    <main className="page search-page">
      <h1 className="search-title">Recherche de parcours</h1>

      <div className="search-card">
        <div className="source-tabs" role="group" aria-label="Source de recherche">
          <button type="button" className="active">OSM</button>
          <button type="button" disabled title="À venir (Firestore)">Base</button>
          <button type="button" disabled title="À venir (Firestore)">Les deux</button>
        </div>

        <SearchPanel
          onResults={setResults}
          onLoading={setLoading}
          onError={setError}
        />
      </div>

      {error && <p className="error">{error}</p>}
      {loading && <p className="loading">Recherche en cours…</p>}

      {!loading && results && (
        <div className="results-block">
          <div className="results-head">
            <span className="results-count">
              {courses.length} parcours {courses.length > 1 ? 'trouvés' : 'trouvé'}
            </span>
            <div className="view-tabs" role="group" aria-label="Affichage des résultats">
              <button
                type="button"
                className={view === 'list' ? 'active' : ''}
                onClick={() => setView('list')}
              >
                Liste
              </button>
              <button
                type="button"
                className={view === 'map' ? 'active' : ''}
                onClick={() => setView('map')}
              >
                Carte
              </button>
            </div>
          </div>

          {courses.length === 0 ? (
            <p className="empty">Aucun parcours trouvé.</p>
          ) : view === 'list' ? (
            <ResultsList courses={courses} onOpen={openCourse} />
          ) : (
            <ResultsMap courses={courses} onOpen={openCourse} />
          )}
        </div>
      )}
    </main>
  );
}
