const crypto = require('crypto');
const { FieldValue } = require('firebase-admin/firestore');
const { getDb, getBucket } = require('../services/firestore');
const { COLLECTIONS, scorecardPath, scorecardObjectPath } = require('./schema');

// Repository des scorecards (collection top-level) : image + document(s) archivés en
// Cloud Storage, décodage + métadonnées en Firestore. Une scorecard peut exister sans
// golf persisté (rôle cache d'affichage), reliée en souple par osm.golfOsmId.

const sha1 = (buf) => crypto.createHash('sha1').update(buf).digest('hex');

const EXT_BY_MIME = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
const mimeExt = (mime) => EXT_BY_MIME[(mime || '').toLowerCase()] || 'bin';

async function getScorecard(scorecardId) {
  const snap = await getDb().doc(scorecardPath(scorecardId)).get();
  return snap.exists ? { id: snap.id, ...snap.data() } : null;
}

async function findScorecardsByOsm(golfOsmId) {
  const q = await getDb()
    .collection(COLLECTIONS.SCORECARDS)
    .where('osm.golfOsmId', '==', golfOsmId)
    .get();
  return q.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// Persiste une scorecard : upload de l'image (dédup — skip si déjà présente) + doc.
async function putScorecard({ scorecardId, source, imageBuffer, mimeType, decoded, kind, osm, contentHash }) {
  const ext = mimeExt(mimeType);
  const imagePath = scorecardObjectPath(scorecardId, ext);

  const file = getBucket().file(imagePath);
  const [exists] = await file.exists();
  if (!exists) {
    await file.save(imageBuffer, { contentType: mimeType || 'application/octet-stream', resumable: false });
  }

  const ref = getDb().doc(scorecardPath(scorecardId));
  const prev = await ref.get();
  const doc = {
    source,
    imagePath,
    mimeType: mimeType || null,
    contentHash: contentHash || (imageBuffer ? sha1(imageBuffer) : null),
    decoded,
    decodedBy: 'gemini-2.5-flash',
    decodedAt: FieldValue.serverTimestamp(),
    kind: kind || (source && source.kind === 'cgolf' ? 'original' : 'manual'),
    osm: osm || {},
    swapHalves: false,
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (!prev.exists) doc.createdAt = FieldValue.serverTimestamp();
  await ref.set(doc, { merge: true });
  return { scorecardId, imagePath };
}

// Lit l'image stockée (pour le proxy d'affichage). Retourne { buffer, mimeType }.
async function getScorecardImage(scorecardId) {
  const sc = await getScorecard(scorecardId);
  if (!sc || !sc.imagePath) return null;
  const [buffer] = await getBucket().file(sc.imagePath).download();
  return { buffer, mimeType: sc.mimeType || 'application/octet-stream' };
}

module.exports = { getScorecard, findScorecardsByOsm, putScorecard, getScorecardImage, mimeExt, sha1 };
