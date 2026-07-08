import { Link } from 'react-router-dom';
import { MapContainer, TileLayer } from 'react-leaflet';

// Page d'accueil — coquille avec états vides. Les données « en base » (nombre de
// parcours, qualité, derniers ajoutés/édités) et les marqueurs sur la carte seront
// branchés quand Firestore sera en place (2ᵉ temps). Pour l'instant : aucun appel
// backend, valeurs statiques à 0 / vides.

const FRANCE_CENTER = [46.6, 2.5];
const FRANCE_ZOOM = 5.5;

const STATS = [
  { label: 'Parcours en base', value: '0' },
  { label: 'Qualité moyenne', value: '—' },
  { label: 'Parcours édités', value: '0' },
  { label: 'Cartes de score', value: '0' },
];

function EmptyList({ label }) {
  return (
    <section className="home-section">
      <h2>{label}</h2>
      <p className="home-empty">Aucun parcours en base pour l'instant.</p>
    </section>
  );
}

export default function HomePage() {
  return (
    <main className="page home">
      <div className="home-banner">
        Base non alimentée — le nombre de parcours, les statistiques et les listes
        ci-dessous seront disponibles avec la persistance Firestore (à venir).
      </div>

      <section className="home-map-section">
        <MapContainer
          className="home-map"
          center={FRANCE_CENTER}
          zoom={FRANCE_ZOOM}
          scrollWheelZoom={false}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
        </MapContainer>
      </section>

      <section className="home-stats">
        {STATS.map(s => (
          <div className="stat-card" key={s.label}>
            <span className="stat-value">{s.value}</span>
            <span className="stat-label">{s.label}</span>
          </div>
        ))}
      </section>

      <EmptyList label="Derniers parcours ajoutés" />
      <EmptyList label="Derniers parcours édités" />

      <div className="home-cta">
        <Link to="/osmproxy" className="home-cta-link">Explorer les parcours via OSM →</Link>
      </div>
    </main>
  );
}
