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

// Deux segments [p1,p2] et [p3,p4] se croisent-ils ? (points {lat, lon})
function segmentsIntersect(p1, p2, p3, p4) {
  const d = (a, b, c) => (b.lon - a.lon) * (c.lat - a.lat) - (b.lat - a.lat) * (c.lon - a.lon);
  const d1 = d(p3, p4, p1);
  const d2 = d(p3, p4, p2);
  const d3 = d(p1, p2, p3);
  const d4 = d(p1, p2, p4);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

// Le segment [a,b] intersecte-t-il le polygone ? (endpoint dedans OU croisement d'une arête)
function segmentIntersectsPolygon(a, b, polygon) {
  if (!a || !b || !polygon || polygon.length < 3) return false;
  if (pointInPolygon(a, polygon) || pointInPolygon(b, polygon)) return true;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    if (segmentsIntersect(a, b, polygon[j], polygon[i])) return true;
  }
  return false;
}

// ---- Géométrie pour la détection de couleur des tees (distances dist:*) ----

const R_EARTH = 6371000;
function haversineM(a, b) {
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(h));
}
// Longueur cumulée de la polyline entre les index [startIdx, fin]
function polylineLengthM(geom, startIdx = 0) {
  let s = 0;
  for (let i = startIdx + 1; i < geom.length; i++) s += haversineM(geom[i - 1], geom[i]);
  return s;
}
// Centroïde des sommets uniques (ferme la boucle : dernier == premier)
function polygonCentroid(geom) {
  const pts = geom.slice();
  if (pts.length > 1 && pts[0].lat === pts[pts.length - 1].lat && pts[0].lon === pts[pts.length - 1].lon) pts.pop();
  const lat = pts.reduce((a, p) => a + p.lat, 0) / pts.length;
  const lon = pts.reduce((a, p) => a + p.lon, 0) / pts.length;
  return { lat, lon };
}

// Ordre canonique des couleurs de té (du plus long/arrière au plus court/avant)
const TEE_COLOR_ORDER = ['black', 'white', 'yellow', 'blue', 'red', 'gold', 'green', 'orange', 'silver'];
const colorRank = c => { const i = TEE_COLOR_ORDER.indexOf(c); return i < 0 ? 99 : i; };

// Regroupe les distances cartées par valeur identique → un seul tee=color1;color2
// [{ dist, colors:['black','white'] }, …] trié par distance décroissante.
function distanceGroups(distances) {
  const byVal = new Map();
  for (const [color, raw] of Object.entries(distances || {})) {
    const d = parseFloat(raw);
    if (!isFinite(d)) continue;
    if (!byVal.has(d)) byVal.set(d, []);
    byVal.get(d).push(color);
  }
  return [...byVal.entries()]
    .map(([dist, colors]) => ({ dist, colors: colors.sort((a, b) => colorRank(a) - colorRank(b)) }))
    .sort((a, b) => b.dist - a.dist);
}

// Bruit toléré (m) au-delà de l'étendue physique du té (imprécision carte vs tracé OSM).
const TEE_COLOR_MARGIN_M = 5;

// Bande [lo, hi] des distances de jeu plausibles pour un té : on projette ses sommets sur
// l'axe de jeu (refPoint → target). baseDist = distance de jeu au refPoint (p=0). La balle
// peut être placée n'importe où dans le té → dist(p) = baseDist - p (avancer raccourcit).
function teeDistanceBand(geom, refPoint, baseDist, target) {
  const mLat = 111320, mLon = 111320 * Math.cos(refPoint.lat * Math.PI / 180);
  const dx = (target.lon - refPoint.lon) * mLon, dy = (target.lat - refPoint.lat) * mLat;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  let pmin = Infinity, pmax = -Infinity;
  for (const v of geom) {
    const p = (v.lon - refPoint.lon) * mLon * ux + (v.lat - refPoint.lat) * mLat * uy;
    if (p < pmin) pmin = p;
    if (p > pmax) pmax = p;
  }
  return { lo: baseDist - pmax - TEE_COLOR_MARGIN_M, hi: baseDist - pmin + TEE_COLOR_MARGIN_M };
}

// Affecte par géométrie, aux greens/tees, sans jamais écraser une valeur existante :
//  - green : ref ← golf=hole dont le DERNIER point (arrivée) est dans le polygone.
//  - tee (way) : ref ← golf=hole dont le PREMIER SEGMENT (départ→1er point du tracé)
//    traverse le polygone (capte le tee arrière ET les tees avancés en enfilade).
//  - tee (way) : couleur (tag `tee`) ← déduite des distances dist:* du golf=hole. Les
//    couleurs de même distance forment un groupe → tee=color1;color2. Chaque té est estimé
//    (départ = longueur totale depuis le 1er nœud du way ; avancé = centroïde→2e point +
//    reste du tracé), puis rattaché au groupe dont la distance tombe dans sa bande physique
//    (aire du té projetée sur l'axe de jeu), en matching 1-pour-1 par écart croissant.
// Tees-nodes et greens-relations hors périmètre.
async function assignRefsFromGeometry(osmId, lat, lng, { preview = false } = {}) {
  const { holes, tees, greens } = await fetchHoles(osmId, lat, lng);
  const holesWithRef = holes.filter(h => h.ref);

  const skipped = []; // { kind, osmId, reason }

  // --- Greens : ref par containment du dernier point ---
  const greenChanges = [];
  for (const g of greens) {
    if (g.ref) continue;                             // déjà un ref → on ne touche pas
    if (!(g.osmType === 'way' && g.geometry?.length >= 3)) continue;
    const matching = holesWithRef.filter(h => h.lastPoint && pointInPolygon(h.lastPoint, g.geometry));
    if (matching.length === 0) continue;
    const refs = [...new Set(matching.map(h => h.ref))];
    if (refs.length > 1) { skipped.push({ kind: 'green', osmId: g.osmId, reason: `ambigu (refs ${refs.join(', ')})` }); continue; }
    const hole = matching[0];
    const tags = { ref: hole.ref };
    if (!g.course && hole.course) tags.course = hole.course;
    greenChanges.push({ kind: 'green', osmId: g.osmId, ref: hole.ref, course: tags.course || null, color: null, tags });
  }

  // --- Tees : accumulateur par osmId (un même té peut recevoir ref ET/OU couleur) ---
  const teeChanges = new Map(); // osmId -> { kind, osmId, ref, course, color, tags }
  const teeChange = t => {
    let c = teeChanges.get(t.osmId);
    if (!c) { c = { kind: 'tee', osmId: t.osmId, ref: null, course: null, color: null, tags: {} }; teeChanges.set(t.osmId, c); }
    return c;
  };

  // ref par premier segment ; on mémorise le ref effectif (existant ou proposé) de chaque té
  const teeEffectiveRef = new Map(); // osmId -> ref
  for (const t of tees) {
    if (!(t.osmType === 'way' && t.geometry?.length >= 3)) continue;
    if (t.ref) { teeEffectiveRef.set(t.osmId, t.ref); continue; } // ref existant conservé
    const matching = holesWithRef.filter(h => h.firstPoint && h.secondPoint && segmentIntersectsPolygon(h.firstPoint, h.secondPoint, t.geometry));
    if (matching.length === 0) continue;
    const refs = [...new Set(matching.map(h => h.ref))];
    if (refs.length > 1) { skipped.push({ kind: 'tee', osmId: t.osmId, reason: `ambigu (refs ${refs.join(', ')})` }); continue; }
    const hole = matching[0];
    const c = teeChange(t);
    c.ref = hole.ref; c.tags.ref = hole.ref;
    if (!t.course && hole.course) { c.course = hole.course; c.tags.course = hole.course; }
    teeEffectiveRef.set(t.osmId, hole.ref);
  }

  // couleur (tag `tee`) par distances dist:* du hole correspondant
  for (const hole of holes) {
    if (!hole.ref) continue;
    const groups = distanceGroups(hole.distances);
    if (groups.length === 0 || !(hole.geometry?.length >= 2)) continue;
    const first = hole.geometry[0], second = hole.geometry[1];
    const total = polylineLengthM(hole.geometry);
    const rest = polylineLengthM(hole.geometry, 1); // 2e point → green

    // tés candidats : way, sans couleur, ref effectif == hole.ref, sur le 1er segment
    const cand = [];
    for (const t of tees) {
      if (t.color) continue;                                   // couleur existante conservée
      if (!(t.osmType === 'way' && t.geometry?.length >= 3)) continue;
      if (teeEffectiveRef.get(t.osmId) !== hole.ref) continue;
      if (!segmentIntersectsPolygon(first, second, t.geometry)) continue;
      const isStart = pointInPolygon(first, t.geometry);       // le té contient le 1er nœud du way ?
      const c = polygonCentroid(t.geometry);
      const refPoint = isStart ? first : c;                    // départ : 1er nœud ; avancé : centroïde
      const baseDist = isStart ? total : haversineM(c, second) + rest;
      const band = teeDistanceBand(t.geometry, refPoint, baseDist, second);
      cand.push({ t, refDist: baseDist, lo: band.lo, hi: band.hi });
    }
    // matching 1-pour-1 : paires (té, groupe) éligibles (groupe dans la bande), écart croissant
    const pairs = [];
    for (const cd of cand) for (const g of groups) {
      if (g.dist >= cd.lo && g.dist <= cd.hi) pairs.push({ cd, g, d: Math.abs(g.dist - cd.refDist) });
    }
    pairs.sort((a, b) => a.d - b.d);
    const usedTee = new Set(), usedGrp = new Set();
    for (const p of pairs) {
      if (usedTee.has(p.cd.t.osmId) || usedGrp.has(p.g.dist)) continue;
      usedTee.add(p.cd.t.osmId); usedGrp.add(p.g.dist);
      const color = p.g.colors.join(';');
      const c = teeChange(p.cd.t);
      c.color = color; c.tags.tee = color;
    }
  }

  const changes = [...greenChanges, ...teeChanges.values()];

  if (preview) return { changes, skipped };
  if (changes.length === 0) return { updated: 0, changes: [], skipped };

  const changesetId = await createChangeset(
    'OSM Golf Explorer — affectation ref + couleur greens/tees par géométrie'
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
