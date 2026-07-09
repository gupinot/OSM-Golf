const { getFirestore } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');
const { ensureApp } = require('./firebase-app');

// Accès à la couche données. Le backend est le seul client Firestore/Storage (Admin SDK).

let _db;
function getDb() {
  if (!_db) {
    ensureApp();
    _db = getFirestore();
  }
  return _db;
}

// Bucket de données (géométries GeoJSON + images de scorecards). Le nom vient de
// DATA_BUCKET (posé au déploiement). Requis uniquement quand on accède au stockage.
function getBucket() {
  ensureApp();
  const name = process.env.DATA_BUCKET;
  if (!name) throw new Error('DATA_BUCKET non configuré');
  return getStorage().bucket(name);
}

module.exports = { getDb, getBucket };
