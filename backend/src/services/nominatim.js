const fetch = require('node-fetch');
const { debug } = require('../utils/logger');

async function geocodeCity(cityName) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(cityName)}&format=json&limit=1`;
  const t0 = Date.now();
  debug(`[Nominatim] geocodeCity("${cityName}") →`);
  const res = await fetch(url, {
    headers: { 'User-Agent': 'OSM-Golf-App/1.0' },
    timeout: 10000,
  });
  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
  const results = await res.json();
  if (!results.length) throw new Error(`Ville introuvable : ${cityName}`);
  const { lat, lon, display_name } = results[0];
  debug(`[Nominatim] geocodeCity("${cityName}") ← ${display_name} (${Date.now() - t0}ms)`);
  return {
    lat: parseFloat(lat),
    lng: parseFloat(lon),
    displayName: display_name,
  };
}

module.exports = { geocodeCity };
