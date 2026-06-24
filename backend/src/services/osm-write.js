const fetch = require('node-fetch');
const { getToken } = require('./osm-auth');
const { fetchHoles } = require('./overpass');

const OSM_API = 'https://api.openstreetmap.org/api/0.6';
const CREATED_BY = 'OSM Golf Explorer';

function authHeaders() {
  return { Authorization: `Bearer ${getToken()}` };
}

function escXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function createChangeset(comment) {
  const body = `<osm><changeset>
    <tag k="created_by" v="${escXml(CREATED_BY)}"/>
    <tag k="comment" v="${escXml(comment)}"/>
  </changeset></osm>`;

  const res = await fetch(`${OSM_API}/changeset/create`, {
    method: 'PUT',
    headers: { ...authHeaders(), 'Content-Type': 'text/xml' },
    body,
  });
  if (!res.ok) throw new Error(`Création changeset OSM échouée: HTTP ${res.status}`);
  return (await res.text()).trim();
}

async function closeChangeset(changesetId) {
  await fetch(`${OSM_API}/changeset/${changesetId}/close`, {
    method: 'PUT',
    headers: authHeaders(),
  });
}

async function getWay(wayId) {
  const res = await fetch(`${OSM_API}/way/${wayId}.json`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`Récupération way ${wayId} échouée: HTTP ${res.status}`);
  const json = await res.json();
  return json.elements[0];
}

function buildWayXml(way, changesetId) {
  const nodes = (way.nodes || []).map(n => `    <nd ref="${n}"/>`).join('\n');
  const tags = Object.entries(way.tags || {})
    .map(([k, v]) => `    <tag k="${escXml(k)}" v="${escXml(v)}"/>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<osm version="0.6">
  <way id="${way.id}" version="${way.version}" changeset="${changesetId}">
${nodes}
${tags}
  </way>
</osm>`;
}

async function updateWayTags(wayId, newTags, changesetId) {
  const way = await getWay(wayId);
  const mergedTags = { ...way.tags, ...newTags };
  const xml = buildWayXml({ ...way, tags: mergedTags }, changesetId);
  const res = await fetch(`${OSM_API}/way/${wayId}`, {
    method: 'PUT',
    headers: { ...authHeaders(), 'Content-Type': 'text/xml' },
    body: xml,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Mise à jour way ${wayId} échouée: HTTP ${res.status} — ${text}`);
  }
  return parseInt(await res.text()); // new version
}

// Compute which OSM tags need to be added/changed based on cgolf hole data
function computeTagDiff(osmHole, cgolfHole, force) {
  const COLORS = ['black', 'white', 'yellow', 'blue', 'red'];
  const updates = {};

  function shouldUpdate(osmVal, cgolfVal) {
    if (cgolfVal == null || cgolfVal === '') return false;
    const osmEmpty = !osmVal || osmVal === '';
    if (osmEmpty) return true;
    if (force && String(osmVal) !== String(cgolfVal)) return true;
    return false;
  }

  if (shouldUpdate(osmHole.par, cgolfHole.par)) updates.par = String(cgolfHole.par);
  if (shouldUpdate(osmHole.handicap, cgolfHole.handicap)) updates.handicap = String(cgolfHole.handicap);

  for (const color of COLORS) {
    const osmDist = osmHole.distances?.[color];
    const cgolfDist = cgolfHole.distances?.[color];
    if (shouldUpdate(osmDist, cgolfDist)) updates[`dist:${color}`] = String(cgolfDist);
  }

  return updates;
}

async function updateHolesFromCgolf(osmHoles, cgolfHoles, force) {
  const osmByRef = new Map(osmHoles.map(h => [String(h.ref), h]));
  const changes = [];

  for (const cgolfHole of cgolfHoles) {
    const ref = String(cgolfHole.hole);
    const osmHole = osmByRef.get(ref);
    if (!osmHole) continue;
    const diff = computeTagDiff(osmHole, cgolfHole, force);
    if (Object.keys(diff).length > 0) {
      changes.push({ osmHole, diff });
    }
  }

  if (changes.length === 0) return { updated: 0, changes: [] };

  const changesetId = await createChangeset(
    `OSM Golf Explorer — mise à jour des trous depuis cgolf.fr (force=${force})`
  );

  try {
    for (const { osmHole, diff } of changes) {
      await updateWayTags(osmHole.osmWayId, diff, changesetId);
    }
  } finally {
    await closeChangeset(changesetId);
  }

  return {
    updated: changes.length,
    changes: changes.map(({ osmHole, diff }) => ({ ref: osmHole.ref, wayId: osmHole.osmWayId, diff })),
  };
}

function previewChanges(osmHoles, cgolfHoles, force) {
  const osmByRef = new Map(osmHoles.map(h => [String(h.ref), h]));
  const changes = [];

  for (const cgolfHole of cgolfHoles) {
    const ref = String(cgolfHole.hole);
    const osmHole = osmByRef.get(ref);
    if (!osmHole) continue;
    const diff = computeTagDiff(osmHole, cgolfHole, force);
    if (Object.keys(diff).length > 0) {
      changes.push({ ref, wayId: osmHole.osmWayId, diff });
    }
  }

  return changes;
}

// Ray casting — point {lat, lon} dans un polygone [{lat, lon}, …]
function pointInPolygon(point, polygon) {
  if (!point || !polygon || polygon.length < 3) return false;
  const { lat, lon } = point;
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

// Affecte le ref (et course si manquant) aux greens/tees SANS ref, par géométrie :
//  - green ← ref du golf=hole dont le DERNIER point (arrivée) est dans le polygone du green
//  - tee (way) ← ref du golf=hole dont le PREMIER point (départ) est dans le polygone du tee
// Ne touche jamais un ref existant. Tees-nodes et greens-relations hors périmètre.
async function assignRefsFromGeometry(osmId, lat, lng, { preview = false } = {}) {
  const { holes, tees, greens } = await fetchHoles(osmId, lat, lng);
  const holesWithRef = holes.filter(h => h.ref);

  const changes = []; // { kind, osmId, ref, course, tags }
  const skipped = []; // { kind, osmId, reason }

  function propose(kind, el, point, hasArea) {
    if (el.ref) return;                              // déjà un ref → on ne touche pas
    if (!hasArea) return;                            // tee-node : pas d'aire
    const matching = holesWithRef.filter(h => point(h) && pointInPolygon(point(h), el.geometry));
    if (matching.length === 0) return;               // rien à l'intérieur (ex. green « missing »)
    const refs = [...new Set(matching.map(h => h.ref))];
    if (refs.length > 1) {
      skipped.push({ kind, osmId: el.osmId, reason: `ambigu (refs ${refs.join(', ')})` });
      return;
    }
    const hole = matching[0];
    const tags = { ref: hole.ref };
    if (!el.course && hole.course) tags.course = hole.course;
    changes.push({ kind, osmId: el.osmId, ref: hole.ref, course: tags.course || null, tags });
  }

  for (const g of greens) {
    propose('green', g, h => h.lastPoint, g.osmType === 'way' && g.geometry?.length >= 3);
  }
  for (const t of tees) {
    propose('tee', t, h => h.firstPoint, t.osmType === 'way' && t.geometry?.length >= 3);
  }

  if (preview) return { changes, skipped };
  if (changes.length === 0) return { updated: 0, changes: [], skipped };

  const changesetId = await createChangeset(
    'OSM Golf Explorer — affectation ref greens/tees par géométrie'
  );
  try {
    for (const c of changes) {
      await updateWayTags(c.osmId, c.tags, changesetId);
    }
  } finally {
    await closeChangeset(changesetId);
  }

  return { updated: changes.length, changes, skipped };
}

module.exports = { updateHolesFromCgolf, previewChanges, assignRefsFromGeometry };
