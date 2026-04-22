const fetch = require('node-fetch');
const { debug } = require('../utils/logger');

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

async function query(ql, label) {
  let lastErr;
  for (const endpoint of ENDPOINTS) {
    const t0 = Date.now();
    debug(`[Overpass] ${label} → ${endpoint}`);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        body: `data=${encodeURIComponent(ql)}`,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 60000,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      debug(`[Overpass] ${label} ← ${json.elements?.length ?? 0} éléments en ${Date.now() - t0}ms`);
      return json;
    } catch (err) {
      debug(`[Overpass] ${label} ✗ ${endpoint} — ${err.message} (${Date.now() - t0}ms)`);
      lastErr = err;
    }
  }
  throw new Error(`Overpass unavailable: ${lastErr?.message}`);
}

async function searchByName(name) {
  const escaped = name.replace(/"/g, '\\"');
  const ql = `
[out:json][timeout:30];
(
  way["leisure"="golf_course"]["name"~"${escaped}",i];
  relation["leisure"="golf_course"]["name"~"${escaped}",i];
);
out center tags;
`;
  const data = await query(ql, `searchByName("${name}")`);
  return parseCourses(data.elements);
}

async function searchByZone(lat, lng, radiusKm) {
  const radiusM = Math.min(radiusKm, 100) * 1000;
  const ql = `
[out:json][timeout:30];
(
  way["leisure"="golf_course"](around:${radiusM},${lat},${lng});
  relation["leisure"="golf_course"](around:${radiusM},${lat},${lng});
);
out center tags;
`;
  const data = await query(ql, `searchByZone(${lat},${lng},${radiusKm}km)`);
  return parseCourses(data.elements, lat, lng);
}

async function fetchHoles(lat, lng, radiusKm = 5) {
  const radiusM = radiusKm * 1000;
  const ql = `
[out:json][timeout:30];
way["golf"="hole"](around:${radiusM},${lat},${lng});
out tags;
`;
  const data = await query(ql, `fetchHoles(${lat},${lng},${radiusKm}km)`);
  return data.elements.map(e => {
    const tags = e.tags || {};
    const distTags = {};
    for (const [k, v] of Object.entries(tags)) {
      if (k.startsWith('dist:')) distTags[k.replace('dist:', '')] = v;
    }
    return {
      osmWayId: e.id,
      ref: (tags.ref || '').trim(),
      course: (tags.course || '').trim(),
      par: (tags.par || '').trim(),
      handicap: (tags.handicap || '').trim(),
      distances: distTags,
    };
  });
}

function parseCourses(elements, refLat, refLng) {
  return elements
    .filter(e => e.tags?.name)
    .map(e => {
      const tags = e.tags;
      const lat = e.center?.lat ?? e.lat;
      const lng = e.center?.lon ?? e.lon;
      const distanceKm = (refLat != null && lng != null)
        ? haversine(refLat, refLng, lat, lng)
        : null;
      return {
        osmId: `${e.type}/${e.id}`,
        name: tags.name.trim(),
        city: (tags['addr:city'] || tags['is_in:city'] || '').trim(),
        lat,
        lng,
        holes: parseInt(tags.holes || tags['golf:holes']) || null,
        distanceKm: distanceKm != null ? Math.round(distanceKm * 10) / 10 : null,
      };
    })
    .sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
}

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(deg) { return deg * Math.PI / 180; }

module.exports = { searchByName, searchByZone, fetchHoles };
