const crypto = require('crypto');
const { getBucket } = require('../services/firestore');
const { SRC, wrap } = require('./schema');

// Construction du GeoJSON d'un sous-parcours à partir des features OSM, et upload en
// Cloud Storage. Provenance osm portée par les propriétés emballées (ref, color).

// Géométrie OSM [{lat,lon}] → coordonnées GeoJSON [lng,lat].
const toCoords = (geom) => geom.map((p) => [p.lon, p.lat]);

// Anneau de polygone fermé (1er point == dernier), requis par GeoJSON.
function closedRing(coords) {
  if (coords.length === 0) return coords;
  const f = coords[0];
  const l = coords[coords.length - 1];
  return f[0] === l[0] && f[1] === l[1] ? coords : [...coords, f];
}

const refProp = (ref, src, at) => (ref ? { ref: wrap(ref, src, at) } : {});

function lineFeature(golf, f, src, at) {
  return {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: toCoords(f.geometry) },
    properties: {
      golf,
      course: f.course || '',
      osmId: f.osmId ?? f.osmWayId,
      osmType: f.osmType || 'way',
      ...refProp(f.ref, src, at),
    },
  };
}

function polyFeature(golf, f, src, at, extra = {}) {
  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [closedRing(toCoords(f.geometry))] },
    properties: {
      golf,
      course: f.course || '',
      osmId: f.osmId,
      osmType: f.osmType || 'way',
      ...refProp(f.ref, src, at),
      ...extra,
    },
  };
}

// FeatureCollection GeoJSON d'un sous-parcours : holes = LineString (tracé),
// tees/greens/fairways/bunkers = Polygon.
function buildFeatureCollection({ holes = [], tees = [], greens = [], fairways = [], bunkers = [], at }) {
  const src = SRC.OSM;
  const features = [];
  for (const h of holes) if (h.geometry?.length) features.push(lineFeature('hole', h, src, at));
  for (const t of tees) {
    if (!t.geometry?.length) continue;
    features.push(polyFeature('tee', t, src, at, t.color ? { color: wrap(t.color, src, at) } : {}));
  }
  for (const g of greens) if (g.geometry?.length) features.push(polyFeature('green', g, src, at));
  for (const f of fairways) if (f.geometry?.length) features.push(polyFeature('fairway', f, src, at));
  for (const b of bunkers) if (b.geometry?.length) features.push(polyFeature('bunker', b, src, at));
  return { type: 'FeatureCollection', features };
}

// Hash stable du contenu géométrique (hors horodatage) pour détecter un changement réel
// entre deux ingestions et éviter d'empiler des versions identiques.
function geometryHash(fc) {
  const stable = fc.features.map((f) => ({
    g: f.geometry,
    golf: f.properties.golf,
    ref: f.properties.ref?.v ?? null,
    color: f.properties.color?.v ?? null,
    course: f.properties.course,
  }));
  return crypto.createHash('sha1').update(JSON.stringify(stable)).digest('hex');
}

// Upload du GeoJSON dans Cloud Storage (ou l'émulateur Storage).
async function putGeometry(path, fc) {
  const buf = Buffer.from(JSON.stringify(fc));
  await getBucket().file(path).save(buf, {
    contentType: 'application/geo+json',
    resumable: false,
  });
}

module.exports = { buildFeatureCollection, geometryHash, putGeometry };
