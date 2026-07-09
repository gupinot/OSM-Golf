// Vocabulaire du modèle de données Firestore : constructeurs de chemins et provenance.
// Aucune logique métier ici — uniquement le schéma partagé par les couches d'accès.
//
// Hiérarchie :
//   golfs/{golfId}
//     courses/{courseId}                 ← vue effective (valeurs « emballées »)
//       versions/{n}                      ← snapshots immuables
//       sources/{sourceId}                ← couches brutes (ex. dernier fetch OSM)
//     scorecards/{scorecardId}            ← image + décodage, couvre 1..n parcours
//
// Géométries : hors Firestore, en Cloud Storage (GeoJSON par version).

const COLLECTIONS = {
  GOLFS: 'golfs',
  COURSES: 'courses',
  VERSIONS: 'versions',
  SOURCES: 'sources',
  SCORECARDS: 'scorecards',
};

const golfPath = (golfId) => `${COLLECTIONS.GOLFS}/${golfId}`;
const coursePath = (golfId, courseId) =>
  `${golfPath(golfId)}/${COLLECTIONS.COURSES}/${courseId}`;
const versionPath = (golfId, courseId, n) =>
  `${coursePath(golfId, courseId)}/${COLLECTIONS.VERSIONS}/${n}`;
const sourcePath = (golfId, courseId, sourceId) =>
  `${coursePath(golfId, courseId)}/${COLLECTIONS.SOURCES}/${sourceId}`;
const scorecardPath = (golfId, scorecardId) =>
  `${golfPath(golfId)}/${COLLECTIONS.SCORECARDS}/${scorecardId}`;

// Chemin de l'objet géométrie dans Cloud Storage (une FeatureCollection par version).
const geometryObjectPath = (golfId, courseId, version) =>
  `golfs/${golfId}/courses/${courseId}/v${version}.geojson`;

// Provenance : 4 origines possibles pour toute information. Les cartes portent l'id de
// la scorecard concernée (kind original vs manuel encodé dans le préfixe).
const SRC = {
  OSM: 'osm',
  CARD_ORIGINAL: (scorecardId) => `card-original:${scorecardId}`,
  CARD_MANUAL: (scorecardId) => `card-manual:${scorecardId}`,
  MANUAL: 'manual',
};

// Emballe une valeur avec sa provenance et sa date (représentation « champ emballé »).
const wrap = (v, src, at = new Date().toISOString()) => ({ v, src, at });

module.exports = {
  COLLECTIONS,
  golfPath,
  coursePath,
  versionPath,
  sourcePath,
  scorecardPath,
  geometryObjectPath,
  SRC,
  wrap,
};
