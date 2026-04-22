import { useState } from 'react';
import { searchByName, searchByZone } from '../services/api.js';

export default function SearchPanel({ onResults, onLoading, onError }) {
  const [mode, setMode] = useState('name');
  const [nameQuery, setNameQuery] = useState('');
  const [city, setCity] = useState('');
  const [radius, setRadius] = useState(50);
  const [locating, setLocating] = useState(false);
  const [geoCoords, setGeoCoords] = useState(null);

  async function handleSearch(e) {
    e.preventDefault();
    onError(null);
    onLoading(true);
    try {
      let results;
      if (mode === 'name') {
        results = await searchByName(nameQuery);
        onResults({ mode: 'name', courses: results });
      } else {
        const payload = geoCoords
          ? { lat: geoCoords.lat, lng: geoCoords.lng, radius }
          : { city, radius };
        const data = await searchByZone(payload);
        onResults({ mode: 'zone', ...data });
      }
    } catch (err) {
      onError(err.message);
    } finally {
      onLoading(false);
    }
  }

  function locateMe() {
    if (!navigator.geolocation) return onError('Géolocalisation non supportée');
    setLocating(true);
    setCity('');
    navigator.geolocation.getCurrentPosition(
      pos => {
        setGeoCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocating(false);
      },
      () => {
        onError('Impossible d\'obtenir la position');
        setLocating(false);
      }
    );
  }

  function clearGeo() {
    setGeoCoords(null);
  }

  return (
    <form className="search-panel" onSubmit={handleSearch}>
      <div className="mode-tabs">
        <button
          type="button"
          className={mode === 'name' ? 'active' : ''}
          onClick={() => setMode('name')}
        >
          Par nom
        </button>
        <button
          type="button"
          className={mode === 'zone' ? 'active' : ''}
          onClick={() => setMode('zone')}
        >
          Par zone
        </button>
      </div>

      {mode === 'name' ? (
        <div className="search-row">
          <input
            type="text"
            placeholder="Nom du golf ou du parcours..."
            value={nameQuery}
            onChange={e => setNameQuery(e.target.value)}
            minLength={2}
            required
          />
          <button type="submit">Rechercher</button>
        </div>
      ) : (
        <div className="zone-fields">
          {geoCoords ? (
            <div className="geo-badge">
              <span>📍 Ma position ({geoCoords.lat.toFixed(4)}, {geoCoords.lng.toFixed(4)})</span>
              <button type="button" className="clear-btn" onClick={clearGeo}>✕</button>
            </div>
          ) : (
            <div className="search-row">
              <input
                type="text"
                placeholder="Ville..."
                value={city}
                onChange={e => setCity(e.target.value)}
                required={!geoCoords}
              />
              <button type="button" className="geo-btn" onClick={locateMe} disabled={locating}>
                {locating ? '…' : '📍'}
              </button>
            </div>
          )}
          <div className="radius-row">
            <label>Rayon : <strong>{radius} km</strong></label>
            <input
              type="range"
              min={5}
              max={100}
              step={5}
              value={radius}
              onChange={e => setRadius(Number(e.target.value))}
            />
          </div>
          <button type="submit" className="submit-btn">Rechercher</button>
        </div>
      )}
    </form>
  );
}
