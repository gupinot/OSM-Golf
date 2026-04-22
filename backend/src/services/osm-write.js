const fetch = require('node-fetch');
const { getToken } = require('./osm-auth');

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

module.exports = { updateHolesFromCgolf, previewChanges };
