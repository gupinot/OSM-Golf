const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

const FETCH_TIMEOUT = 25000;

// 406 = overpass-api.de rejette par surcharge/rate-limit (transitoire, la même requête
// repasse à 200 quelques secondes après) — on le réessaie comme un 429/503/504.
const RETRYABLE = status => status === 504 || status === 429 || status === 503 || status === 406;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function query(ql, label, maxAttempts = 3) {
  let lastErr;

  for (const endpoint of ENDPOINTS) {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const t0 = Date.now();
      console.log(`[Overpass] ${label} → ${endpoint}${attempt > 0 ? ` (essai ${attempt + 1}/${maxAttempts})` : ''}`);
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          body: `data=${encodeURIComponent(ql)}`,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: FETCH_TIMEOUT,
        });
        if (!res.ok) {
          const err = new Error(`HTTP ${res.status}`);
          err.status = res.status;
          err.isAreaNotFound = res.status === 406;
          throw err;
        }
        const json = await res.json();
        console.log(`[Overpass] ${label} ← ${json.elements?.length ?? 0} éléments en ${Date.now() - t0}ms`);
        return json;
      } catch (err) {
        console.log(`[Overpass] ${label} ✗ ${endpoint} — ${err.message} (${Date.now() - t0}ms)`);
        lastErr = err;
        // Le flag isAreaNotFound reste porté par lastErr (cf. throw final) pour le
        // fallback area() de fetchHoles, mais n'interrompt plus : un 406 est réessayé.
        if (!RETRYABLE(err.status)) break;
        if (attempt + 1 < maxAttempts) {
          const delay = Math.min(1000 * 2 ** attempt, 10000);
          console.log(`[Overpass] retry dans ${delay}ms…`);
          await sleep(delay);
        }
      }
    }
  }
  const err = new Error(`Overpass unavailable: ${lastErr?.message}`);
  err.isAreaNotFound = lastErr?.isAreaNotFound ?? false;
  throw err;
}

// Cache disque des recherches zone/nom : les golfs OSM bougent rarement, et les logs
// montrent la même requête relancée plusieurs fois de suite. Évite de marteler Overpass.
const SEARCH_CACHE_PATH = path.join(__dirname, '..', '..', '..', 'scripts', 'output', 'overpass_search_cache.json');
const SEARCH_CACHE_TTL = 7 * 24 * 3600 * 1000; // 7 jours
let searchCache = null;

function readSearchCache() {
  if (searchCache) return searchCache;
  try {
    searchCache = fs.existsSync(SEARCH_CACHE_PATH)
      ? JSON.parse(fs.readFileSync(SEARCH_CACHE_PATH, 'utf8'))
      : {};
  } catch { searchCache = {}; }
  return searchCache;
}

function getCached(key) {
  const entry = readSearchCache()[key];
  if (entry && Date.now() - entry.ts < SEARCH_CACHE_TTL) {
    console.log(`[Overpass] ${key} ← cache (${entry.data.length} résultats)`);
    return entry.data;
  }
  return null;
}

function setCached(key, data) {
  const cache = readSearchCache();
  cache[key] = { ts: Date.now(), data };
  fs.mkdirSync(path.dirname(SEARCH_CACHE_PATH), { recursive: true });
  fs.writeFileSync(SEARCH_CACHE_PATH, JSON.stringify(cache, null, 2));
}

async function searchByName(name, { fresh = false } = {}) {
  const key = `name:${name.trim().toLowerCase()}`;
  if (!fresh) {
    const cached = getCached(key);
    if (cached) return cached;
  }

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
  const courses = parseCourses(data.elements);
  setCached(key, courses);
  return courses;
}

async function searchByZone(lat, lng, radiusKm, { fresh = false } = {}) {
  const r = Math.min(radiusKm, 100);
  // Coords arrondies à ~100 m : deux recherches quasi identiques tapent la même entrée.
  const key = `zone:${lat.toFixed(3)},${lng.toFixed(3)},${r}`;
  if (!fresh) {
    const cached = getCached(key);
    if (cached) return cached;
  }

  const radiusM = r * 1000;
  const ql = `
[out:json][timeout:30];
(
  way["leisure"="golf_course"](around:${radiusM},${lat},${lng});
  relation["leisure"="golf_course"](around:${radiusM},${lat},${lng});
);
out center tags;
`;
  const data = await query(ql, `searchByZone(${lat},${lng},${radiusKm}km)`);
  const courses = parseCourses(data.elements, lat, lng);
  setCached(key, courses);
  return courses;
}

// Découpe une valeur type "Vert n°16 - Bois joli" ou "Azur - 4" en { prefix, number }.
// Le préfixe = nom de parcours ; number = n° de trou. null si aucun motif.
// Le préfixe purement numérique est rejeté (évite "9 - 18" → prefix "9").
function parseRefLike(value) {
  if (!value) return null;
  let m = value.match(/^(.+?)\s+n°\s*(\d+)/i);
  if (m) return { prefix: m[1].trim(), number: m[2] };
  m = value.match(/^(.+?)\s+[-–]\s+(\d+)/);
  if (m && !/^\d+$/.test(m[1].trim())) return { prefix: m[1].trim(), number: m[2] };
  return null;
}

// refTarget = n° de trou cible : extrait d'un ref type "Azur - 4" → "4", sinon le ref brut.
function deriveRefTarget(ref) {
  const parsed = parseRefLike(ref);
  return parsed ? parsed.number : ref;
}

// Infère le course des trous depuis les préfixes partagés (tag name ET ref).
// Ne retient un préfixe que s'il apparaît dans ≥ 2 trous (robustesse, comme avant).
// Retourne l'ensemble des courses connus (tags + inférés) pour réutilisation tees/greens.
function inferHoleCourses(holes) {
  const counts = new Map();
  for (const hole of holes) {
    if (hole.course) continue;
    for (const src of [hole._rawName, hole.ref]) {
      const p = parseRefLike(src);
      if (p) counts.set(p.prefix, (counts.get(p.prefix) || 0) + 1);
    }
  }
  for (const hole of holes) {
    if (!hole.course) {
      for (const src of [hole._rawName, hole.ref]) {
        const p = parseRefLike(src);
        if (p && (counts.get(p.prefix) || 0) >= 2) { hole.course = p.prefix; break; }
      }
    }
    delete hole._rawName;
  }
  return new Set(holes.map(h => h.course).filter(Boolean));
}

// Tee/green sans tag course : récupère le course depuis le préfixe du ref, uniquement
// s'il fait partie des courses connus (cohérence des clés course|refTarget avec les trous).
function inferFeatureCourse(item, knownCourses) {
  if (item.course) return;
  const p = parseRefLike(item.ref);
  if (p && knownCourses.has(p.prefix)) item.course = p.prefix;
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

  let data;
  let needsFallback = false;

  try {
    data = await query(ql, label);
    if (osmId && lat != null && !isNaN(lat) && data.elements.length === 0) needsFallback = true;
  } catch (err) {
    if (err.isAreaNotFound && osmId && lat != null && !isNaN(lat)) {
      console.log(`[fetchHoles] area(${osmId}) → 406, fallback radius + polygon filter`);
      needsFallback = true;
      data = { elements: [] };
    } else {
      throw err;
    }
  }

  // Fallback: l'aire Overpass n'est pas indexée pour ce way.
  // On récupère la géométrie du way directement, puis on filtre les résultats radius par polygon.
  if (needsFallback) {
    console.log(`[fetchHoles] area(${osmId}) → 0 éléments, fallback radius + polygon filter`);
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
      console.log(`[fetchHoles] polygon filter: ${before} → ${raw.elements.length} éléments`);
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
        course: (tags.course || '').trim(),
        _rawName: (tags.name || '').trim(),
        par: (tags.par || '').trim(),
        handicap: (tags.handicap || '').trim(),
        distances: distTags,
        firstPoint: e.geometry?.length ? e.geometry[0] : null,
        lastPoint: e.geometry?.length ? e.geometry[e.geometry.length - 1] : null,
      });
    } else if (golf === 'tee') {
      tees.push({
        osmId: e.id,
        osmType: e.type,
        ref: (tags.ref || '').trim(),
        course: (tags.course || '').trim(),
        color: (tags.tee || tags['golf:tee'] || '').trim(),
        geometry: e.geometry || [],
      });
    } else if (golf === 'green' && e.type === 'way') {
      greens.push({
        osmId: e.id,
        osmType: e.type,
        ref: (tags.ref || '').trim(),
        course: (tags.course || '').trim(),
        geometry: e.geometry || [],
      });
    }
  }

  // Normalisation course + refTarget (gère les refs type "Azur - 4" sans tag course/name).
  const knownCourses = inferHoleCourses(holes);
  for (const h of holes) h.refTarget = deriveRefTarget(h.ref);
  for (const t of tees) { inferFeatureCourse(t, knownCourses); t.refTarget = deriveRefTarget(t.ref); }
  for (const g of greens) { inferFeatureCourse(g, knownCourses); g.refTarget = deriveRefTarget(g.ref); }

  return { holes, tees, greens };
}

// Polygone d'un golf_course : way → geometry directe ; relation → concaténation des outer.
function extractPolygon(el) {
  if (el.geometry?.length) return el.geometry;
  if (el.members) {
    const pts = [];
    for (const m of el.members) {
      if (m.role === 'outer' && m.geometry) pts.push(...m.geometry);
    }
    return pts.length ? pts : null;
  }
  return null;
}

// Point représentatif d'une feature pour l'attribution à un golf : coords du node,
// ou centroïde (moyenne des sommets) du way / de la relation (membres outer).
function representativePoint(el) {
  if (el.type === 'node') return { lat: el.lat, lon: el.lon };
  const geom = el.geometry?.length ? el.geometry : extractPolygon(el);
  if (geom?.length) {
    let lat = 0, lon = 0;
    for (const p of geom) { lat += p.lat; lon += p.lon; }
    return { lat: lat / geom.length, lon: lon / geom.length };
  }
  return null;
}

// Comptage des features de jeu par golf sur toute une zone, en 2 requêtes Overpass :
// 1) polygones des golf_course du rayon, 2) golf=hole|tee|green|fairway|bunker du rayon,
// puis attribution de chaque feature au golf dont le polygone la contient (point-in-polygon).
async function fetchZoneStats(lat, lng, radiusKm, { fresh = false } = {}) {
  const r = Math.min(radiusKm, 100);
  const key = `stats:${lat.toFixed(3)},${lng.toFixed(3)},${r}`;
  if (!fresh) {
    const cached = getCached(key);
    if (cached) return cached;
  }

  const radiusM = r * 1000;

  const golfQl = `
[out:json][timeout:30];
(
  way["leisure"="golf_course"](around:${radiusM},${lat},${lng});
  relation["leisure"="golf_course"](around:${radiusM},${lat},${lng});
);
out body geom;
`;
  const golfData = await query(golfQl, `fetchZoneStats-golfs(${lat},${lng},${r}km)`);

  const golfs = [];
  for (const el of golfData.elements) {
    if (!el.tags?.name) continue;
    const polygon = extractPolygon(el);
    if (!polygon?.length) continue;
    golfs.push({ osmId: `${el.type}/${el.id}`, polygon });
  }

  // hole = way uniquement (le node golf=hole est le drapeau, éviter le double comptage).
  // tee = way + node (deux formes légitimes). green/fairway/bunker = way OU relation
  // (multipolygon : tag porté par la relation, pas par les ways membres → pas de double comptage).
  const featQl = `
[out:json][timeout:60];
(
  way["golf"="hole"](around:${radiusM},${lat},${lng});
  way["golf"="tee"](around:${radiusM},${lat},${lng});
  node["golf"="tee"](around:${radiusM},${lat},${lng});
  way["golf"="green"](around:${radiusM},${lat},${lng});
  relation["golf"="green"](around:${radiusM},${lat},${lng});
  way["golf"="fairway"](around:${radiusM},${lat},${lng});
  relation["golf"="fairway"](around:${radiusM},${lat},${lng});
  way["golf"="bunker"](around:${radiusM},${lat},${lng});
  relation["golf"="bunker"](around:${radiusM},${lat},${lng});
);
out body geom;
`;
  const featData = await query(featQl, `fetchZoneStats-features(${lat},${lng},${r}km)`);

  const stats = {};
  for (const g of golfs) {
    stats[g.osmId] = {
      holes: { withRef: 0, withoutRef: 0 },
      tees: { withRef: 0, withoutRef: 0 },
      greens: { withRef: 0, withoutRef: 0 },
      fairways: 0,
      bunkers: 0,
    };
  }

  for (const el of featData.elements) {
    const golf = el.tags?.golf;
    if (!golf) continue;
    const pt = representativePoint(el);
    if (!pt) continue;
    const owner = golfs.find(g => pointInPolygon(pt.lat, pt.lon, g.polygon));
    if (!owner) continue;
    const s = stats[owner.osmId];
    const hasRef = !!(el.tags.ref || '').trim();
    if (golf === 'hole') hasRef ? s.holes.withRef++ : s.holes.withoutRef++;
    else if (golf === 'tee') hasRef ? s.tees.withRef++ : s.tees.withoutRef++;
    else if (golf === 'green') hasRef ? s.greens.withRef++ : s.greens.withoutRef++;
    else if (golf === 'fairway') s.fairways++;
    else if (golf === 'bunker') s.bunkers++;
  }

  setCached(key, stats);
  return stats;
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

module.exports = { searchByName, searchByZone, fetchHoles, fetchZoneStats };
