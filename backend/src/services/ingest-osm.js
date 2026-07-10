const { fetchHoles, fetchGolfZones } = require('./overpass');
const { buildFeatureCollection } = require('../data/geometry');
const { upsertGolfAndCourses } = require('../data/golfs');
const { SRC, wrap } = require('../data/schema');

// Orchestration de l'ingestion OSM d'un golf : récupère holes/tees/greens (fetchHoles) +
// fairways/bunkers (fetchGolfZones), regroupe par sous-parcours, construit les trous
// « emballés » (provenance osm) et le GeoJSON, puis écrit en base (repository golfs).

const numOr = (s) => {
  const n = Number(s);
  return Number.isFinite(n) ? n : s;
};

// Trous d'un sous-parcours → lignes à champs emballés {v, src:osm, at}, triées par numéro.
function buildHoleRows(holes, at) {
  const src = SRC.OSM;
  const rows = holes.map((h) => {
    const row = { num: Number(h.refTarget) || Number(h.ref) || null };
    if (h.ref) row.ref = wrap(h.ref, src, at);
    if (h.par) row.par = wrap(numOr(h.par), src, at);
    if (h.handicap) row.handicap = wrap(numOr(h.handicap), src, at);
    const dist = {};
    for (const [color, v] of Object.entries(h.distances || {})) {
      if (v !== '' && v != null) dist[color] = wrap(numOr(v), src, at);
    }
    if (Object.keys(dist).length) row.distances = dist;
    return row;
  });
  rows.sort((a, b) => (a.num ?? 1e9) - (b.num ?? 1e9));
  return rows;
}

const centroidOfFeatures = (features) => {
  let lat = 0;
  let lon = 0;
  let n = 0;
  for (const f of features) for (const p of f.geometry || []) { lat += p.lat; lon += p.lon; n++; }
  return n ? { lat: lat / n, lon: lon / n } : null;
};

const featureCentroid = (f) => {
  const g = f.geometry || [];
  if (!g.length) return null;
  let lat = 0;
  let lon = 0;
  for (const p of g) { lat += p.lat; lon += p.lon; }
  return { lat: lat / g.length, lon: lon / g.length };
};

const dist2 = (a, b) => (a.lat - b.lat) ** 2 + (a.lon - b.lon) ** 2;

function nearestCourse(point, centroids) {
  if (!point) return null;
  let best = null;
  let bestD = Infinity;
  for (const [key, c] of centroids) {
    if (!c) continue;
    const d = dist2(point, c);
    if (d < bestD) { bestD = d; best = key; }
  }
  return best;
}

// Bbox [minLng, minLat, maxLng, maxLat] de toutes les géométries d'un golf.
function bboxOf(...lists) {
  let minLat = Infinity;
  let minLon = Infinity;
  let maxLat = -Infinity;
  let maxLon = -Infinity;
  for (const list of lists) for (const f of list) for (const p of f.geometry || []) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lon < minLon) minLon = p.lon;
    if (p.lon > maxLon) maxLon = p.lon;
  }
  return Number.isFinite(minLat) ? [minLon, minLat, maxLon, maxLat] : null;
}

async function ingestGolf({ osmId, lat, lng, name, radiusKm, force = false }) {
  const at = new Date().toISOString();
  const [osmType, osmIdNum] = String(osmId).split('/');

  const { holes, tees, greens } = await fetchHoles(osmId, lat, lng, radiusKm);
  const { fairways, bunkers } = await fetchGolfZones(osmId, lat, lng);

  // Ensemble des sous-parcours (défini par les trous). Golf mono-parcours = un seul groupe.
  const courseKeys = [...new Set(holes.map((h) => h.course || ''))];
  if (!courseKeys.length) courseKeys.push('');
  const single = courseKeys.length === 1;

  const holesByCourse = new Map(courseKeys.map((k) => [k, []]));
  for (const h of holes) {
    const k = single || !courseKeys.includes(h.course) ? courseKeys[0] : h.course;
    holesByCourse.get(k).push(h);
  }
  const centroids = new Map(courseKeys.map((k) => [k, centroidOfFeatures(holesByCourse.get(k))]));

  // Attribue tees/greens/fairways/bunkers à un sous-parcours : par tag course si connu,
  // sinon par proximité géométrique (centroïde le plus proche). Trivial en mono-parcours.
  const assign = (list) => {
    const by = new Map(courseKeys.map((k) => [k, []]));
    for (const f of list) {
      let k;
      if (single) k = courseKeys[0];
      else if (f.course && by.has(f.course)) k = f.course;
      else k = nearestCourse(featureCentroid(f), centroids) ?? courseKeys[0];
      by.get(k).push(f);
    }
    return by;
  };
  const teesBy = assign(tees);
  const greensBy = assign(greens);
  const fairwaysBy = assign(fairways);
  const bunkersBy = assign(bunkers);

  const courses = courseKeys.map((k) => {
    const ch = holesByCourse.get(k);
    const ct = teesBy.get(k);
    const cg = greensBy.get(k);
    const cf = fairwaysBy.get(k);
    const cb = bunkersBy.get(k);
    return {
      courseKey: k,
      holes: buildHoleRows(ch, at),
      features: { fairways: cf.length, greens: cg.length, tees: ct.length, bunkers: cb.length },
      featureCollection: buildFeatureCollection({ holes: ch, tees: ct, greens: cg, fairways: cf, bunkers: cb, at }),
    };
  });

  const bbox = bboxOf(holes, tees, greens, fairways, bunkers);
  return upsertGolfAndCourses(
    { osmType, osmId: osmIdNum, name, lat, lng, at, bbox },
    courses,
    { force }
  );
}

module.exports = { ingestGolf, buildHoleRows, bboxOf };
