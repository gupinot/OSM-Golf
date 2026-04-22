const fetch = require('node-fetch');
const { debug } = require('../utils/logger');

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

const RETRYABLE = status => status === 504 || status === 429 || status === 503;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function query(ql, label, maxAttempts = 5) {
  let lastErr;

  for (const endpoint of ENDPOINTS) {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const t0 = Date.now();
      debug(`[Overpass] ${label} → ${endpoint}${attempt > 0 ? ` (essai ${attempt + 1}/${maxAttempts})` : ''}`);
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          body: `data=${encodeURIComponent(ql)}`,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 60000,
        });
        if (!res.ok) {
          const err = new Error(`HTTP ${res.status}`);
          err.status = res.status;
          throw err;
        }
        const json = await res.json();
        debug(`[Overpass] ${label} ← ${json.elements?.length ?? 0} éléments en ${Date.now() - t0}ms`);
        return json;
      } catch (err) {
        debug(`[Overpass] ${label} ✗ ${endpoint} — ${err.message} (${Date.now() - t0}ms)`);
        lastErr = err;
        if (!RETRYABLE(err.status)) break;
        if (attempt + 1 < maxAttempts) {
          const delay = Math.min(1000 * 2 ** attempt, 10000);
          debug(`[Overpass] retry dans ${delay}ms…`);
          await sleep(delay);
        }
      }
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

// "Vert n°16 - Bois joli" → "Vert" ; "Jaune n°10 - ..." → "Jaune"
function deriveCourse(tags) {
  if (tags.course?.trim()) return tags.course.trim();
  const name = tags.name?.trim();
  if (!name) return '';
  const m = name.match(/^(.+?)\s+n°\d+/i);
  return m ? m[1].trim() : '';
}

async function fetchBoundary(osmId) {
  const [type, rawId] = osmId.split('/');
  const ql = `[out:json][timeout:15];\n${type}(${rawId});\nout geom;\n`;
  try {
    const data = await query(ql, `fetchBoundary(${osmId})`);
    const el = data.elements?.[0];
    // way: geometry = [{lat, lon}, ...]
    if (el?.geometry?.length) return el.geometry;
    // relation: extraire les nœuds des membres outer
    if (el?.members) {
      const pts = [];
      for (const m of el.members) {
        if (m.role === 'outer' && m.geometry) pts.push(...m.geometry);
      }
      return pts.length ? pts : null;
    }
    return null;
  } catch {
    return null;
  }
}

function pointInPolygon(lat, lon, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lon, yi = polygon[i].lat;
    const xj = polygon[j].lon, yj = polygon[j].lat;
    if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

function elementInPolygon(el, polygon) {
  if (!polygon?.length) return true;
  if (el.type === 'node') return pointInPolygon(el.lat, el.lon, polygon);
  // way: au moins un nœud dans le polygon
  return el.geometry?.some(pt => pointInPolygon(pt.lat, pt.lon, polygon)) ?? false;
}

async function fetchHoles(osmId, lat, lng, radiusKm = 5) {
  let ql, label;

  if (osmId) {
    const [type, rawId] = osmId.split('/');
    const id = parseInt(rawId, 10);
    const areaId = type === 'relation' ? 3600000000 + id : 2400000000 + id;
    ql = `
[out:json][timeout:30];
area(${areaId})->.golf_area;
(
  way["golf"="hole"](area.golf_area);
  way["golf"="tee"](area.golf_area);
  node["golf"="tee"](area.golf_area);
  way["golf"="green"](area.golf_area);
);
out body geom;
`;
    label = `fetchHoles(${osmId})`;
  } else {
    const radiusM = radiusKm * 1000;
    ql = `
[out:json][timeout:30];
(
  way["golf"="hole"](around:${radiusM},${lat},${lng});
  way["golf"="tee"](around:${radiusM},${lat},${lng});
  node["golf"="tee"](around:${radiusM},${lat},${lng});
  way["golf"="green"](around:${radiusM},${lat},${lng});
);
out body geom;
`;
    label = `fetchHoles(${lat},${lng},${radiusKm}km)`;
  }

  let data = await query(ql, label);

  // Fallback: l'aire Overpass n'est pas indexée pour ce way.
  // On récupère la géométrie du way directement, puis on filtre les résultats radius par polygon.
  if (osmId && lat != null && !isNaN(lat) && data.elements.length === 0) {
    debug(`[fetchHoles] area(${osmId}) → 0 éléments, fallback radius + polygon filter`);
    const boundary = await fetchBoundary(osmId);
    const radiusM = radiusKm * 1000;
    const fallbackQl = `
[out:json][timeout:30];
(
  way["golf"="hole"](around:${radiusM},${lat},${lng});
  way["golf"="tee"](around:${radiusM},${lat},${lng});
  node["golf"="tee"](around:${radiusM},${lat},${lng});
  way["golf"="green"](around:${radiusM},${lat},${lng});
);
out body geom;
`;
    const raw = await query(fallbackQl, `fetchHoles-fallback(${lat},${lng},${radiusKm}km)`);
    if (boundary) {
      const before = raw.elements.length;
      raw.elements = raw.elements.filter(el => elementInPolygon(el, boundary));
      debug(`[fetchHoles] polygon filter: ${before} → ${raw.elements.length} éléments`);
    }
    data = raw;
  }

  const holes = [];
  const tees = [];
  const greens = [];

  for (const e of data.elements) {
    const tags = e.tags || {};
    const golf = tags.golf;

    if (golf === 'hole' && e.type === 'way') {
      const distTags = {};
      for (const [k, v] of Object.entries(tags)) {
        if (k.startsWith('dist:')) distTags[k.replace('dist:', '')] = v;
      }
      holes.push({
        osmWayId: e.id,
        ref: (tags.ref || '').trim(),
        course: deriveCourse(tags),
        par: (tags.par || '').trim(),
        handicap: (tags.handicap || '').trim(),
        distances: distTags,
        lastPoint: e.geometry?.length ? e.geometry[e.geometry.length - 1] : null,
      });
    } else if (golf === 'tee') {
      tees.push({
        ref: (tags.ref || '').trim(),
        course: (tags.course || '').trim(),
        color: (tags.tee || tags['golf:tee'] || '').trim(),
      });
    } else if (golf === 'green' && e.type === 'way') {
      greens.push({
        ref: (tags.ref || '').trim(),
        course: (tags.course || '').trim(),
        geometry: e.geometry || [],
      });
    }
  }

  return { holes, tees, greens };
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
