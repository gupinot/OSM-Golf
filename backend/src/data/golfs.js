const crypto = require('crypto');
const ngeohash = require('ngeohash');
const { GeoPoint, FieldValue } = require('firebase-admin/firestore');
const { getDb } = require('../services/firestore');
const {
  COLLECTIONS,
  golfPath,
  coursePath,
  versionPath,
  geometryObjectPath,
  SRC,
  wrap,
} = require('./schema');
const { putGeometry, geometryHash } = require('./geometry');

// Repository de la couche données : upsert d'un golf et de ses sous-parcours depuis OSM,
// avec identité stable (lookup par osm.ref), geohash/nameIndex, et versioning par hash de
// contenu (une nouvelle version n'est écrite que si le contenu résolu change réellement).

const stripDiacritics = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

function slugify(s) {
  return (
    stripDiacritics(String(s || '').toLowerCase())
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'x'
  );
}

// Tokens normalisés du nom pour la recherche (array-contains ultérieur).
function nameTokens(name) {
  return [...new Set(slugify(name).split('-').filter((t) => t.length >= 2))];
}

const shortHash = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 8);

// Valeur d'un champ emballé {v,src,at} → v (ou la valeur brute si non emballée).
const val = (w) => (w && typeof w === 'object' && 'v' in w ? w.v : (w ?? null));

// Champ emballé dont la provenance n'est PAS osm (donc une édition à préserver).
const isNonOsmWrap = (w) => w && typeof w === 'object' && 'src' in w && w.src !== SRC.OSM;

// Le parcours en base porte-t-il au moins une information non-osm (manual/card-*) ?
// Sert de garde-fou : l'import OSM opt-in ne doit pas écraser des éditions sans force.
function hasNonOsmProvenance(course) {
  if (!course) return false;
  if (isNonOsmWrap(course.name)) return true;
  for (const h of course.holes || []) {
    if (isNonOsmWrap(h.ref) || isNonOsmWrap(h.par) || isNonOsmWrap(h.handicap)) return true;
    for (const w of Object.values(h.distances || {})) if (isNonOsmWrap(w)) return true;
  }
  return false;
}

// Représentation « valeurs seules » des trous (hors provenance/horodatage) pour le hash.
function holesValues(holes) {
  return holes.map((h) => ({
    num: h.num,
    ref: val(h.ref),
    par: val(h.par),
    handicap: val(h.handicap),
    distances: Object.fromEntries(
      Object.entries(h.distances || {}).map(([k, w]) => [k, val(w)])
    ),
  }));
}

function courseContentHash(holes, geomHash) {
  return crypto
    .createHash('sha1')
    .update(JSON.stringify({ holes: holesValues(holes), geomHash }))
    .digest('hex');
}

async function findGolfByOsmRef(osmRef) {
  const snap = await getDb()
    .collection(COLLECTIONS.GOLFS)
    .where('osm.ref', '==', osmRef)
    .limit(1)
    .get();
  return snap.empty ? null : snap.docs[0];
}

// Upsert d'un golf et de ses sous-parcours. golfMeta = { osmType, osmId, name, lat, lng, at, bbox? }.
// courses = [{ courseKey, holes[], features{}, featureCollection }]. options.force = true
// autorise l'écrasement des parcours édités (provenance ≠ osm). Retourne un résumé.
async function upsertGolfAndCourses(golfMeta, courses, { force = false } = {}) {
  const db = getDb();
  const { osmType, osmId, name, lat, lng, at, bbox } = golfMeta;
  const osmRef = `${osmType}/${osmId}`;

  const existing = await findGolfByOsmRef(osmRef);
  const golfId = existing ? existing.id : `${slugify(name)}-${shortHash(osmRef)}`;
  const golfRef = db.doc(golfPath(golfId));

  const result = { golfId, created: !existing, courses: [] };

  for (const c of courses) {
    const courseId = slugify(c.courseKey || 'principal');
    const courseRef = db.doc(coursePath(golfId, courseId));
    const snap = await courseRef.get();
    const prev = snap.exists ? snap.data() : null;

    // Garde-fou : ne pas écraser un parcours portant des éditions (provenance ≠ osm)
    // sans force. L'import OSM est opt-in et ne doit pas détruire manual/card-*.
    if (prev && !force && hasNonOsmProvenance(prev)) {
      result.courses.push({
        courseId,
        version: prev.version,
        changed: false,
        skipped: 'protected',
        holes: prev.holesCount ?? (prev.holes?.length ?? 0),
      });
      continue;
    }

    const geomHash = geometryHash(c.featureCollection);
    const contentHash = courseContentHash(c.holes, geomHash);

    // Contenu inchangé → pas de nouvelle version.
    if (prev && prev.contentHash === contentHash) {
      result.courses.push({ courseId, version: prev.version, changed: false, holes: c.holes.length });
      continue;
    }

    const version = (prev?.version || 0) + 1;
    const geometryPath = geometryObjectPath(golfId, courseId, version);
    await putGeometry(geometryPath, c.featureCollection);

    const head = {
      name: wrap(c.courseKey || null, SRC.OSM, at),
      slug: courseId,
      holesCount: c.holes.length,
      holes: c.holes,
      features: c.features,
      version,
      geometryPath,
      geometryHash: geomHash,
      contentHash,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (!prev) head.createdAt = FieldValue.serverTimestamp();

    const versionSnap = {
      reason: 'osm-ingest',
      holes: c.holes,
      features: c.features,
      geometryPath,
      geometryHash: geomHash,
      createdAt: FieldValue.serverTimestamp(),
    };

    const batch = db.batch();
    batch.set(courseRef, head, { merge: true });
    batch.set(db.doc(versionPath(golfId, courseId, version)), versionSnap);
    await batch.commit();

    result.courses.push({ courseId, version, changed: true, holes: c.holes.length });
  }

  const golfDoc = {
    location: new GeoPoint(lat, lng),
    geohash: ngeohash.encode(lat, lng, 9),
    osm: { type: osmType, id: osmId, ref: osmRef },
    nameIndex: nameTokens(name),
    coursesCount: result.courses.length,
    updatedAt: FieldValue.serverTimestamp(),
  };
  // Nom : ne pas écraser un nom édité (provenance ≠ osm) sans force.
  if (force || !existing || !isNonOsmWrap(existing.data().name)) {
    golfDoc.name = wrap(name, SRC.OSM, at);
  }
  if (bbox) golfDoc.bbox = bbox;
  if (!existing) golfDoc.createdAt = FieldValue.serverTimestamp();
  await golfRef.set(golfDoc, { merge: true });

  return result;
}

module.exports = { upsertGolfAndCourses, findGolfByOsmRef, slugify, nameTokens };
