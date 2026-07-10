const express = require('express');
const { applicationDefault } = require('firebase-admin/app');
const { getDb, isBaseConfigured } = require('../services/firestore');
const { COLLECTIONS } = require('../data/schema');
const { ingestGolf } = require('../services/ingest-osm');
const { decodeAndCache, listCachedByOsm } = require('../services/scorecards');
const { getScorecardImage } = require('../data/scorecards');

const router = express.Router();

// Garde d'environnement pour les endpoints qui écrivent/lisent la base : 503 lisible
// quand la couche données n'est pas configurée (dev local sans émulateur).
function requireBase(req, res, next) {
  if (!isBaseConfigured()) {
    return res.status(503).json({ error: 'Couche données non configurée (émulateur/ADC absent)' });
  }
  next();
}

// Borne l'attente : sans identifiants (ADC), le client Firestore boucle sur le metadata
// server au lieu d'échouer vite → on renvoie un 503 lisible plutôt que de laisser pendre.
const HEALTH_TIMEOUT_MS = 5000;
const withTimeout = (promise, ms) =>
  Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Firestore injoignable (timeout ${ms}ms)`)), ms)
    ),
  ]);

// Health-check de la couche données : vérifie la connectivité Firestore de bout en bout
// sans écrire de données (collections vides à ce stade). 503 si la base est injoignable
// (ex. ADC/projet non configurés en local).
router.get('/health', async (req, res) => {
  try {
    // Pré-vérifie les identifiants (ADC) via un appel maîtrisé : sans ADC, le client
    // Firestore déclenche des retries gRPC non catchés qui feraient crasher le process
    // (Node ≥ 15). En échouant ici, on renvoie un 503 lisible sans jamais y toucher.
    await withTimeout(applicationDefault().getAccessToken(), HEALTH_TIMEOUT_MS);
    const snap = await withTimeout(
      getDb().collection(COLLECTIONS.GOLFS).limit(1).get(),
      HEALTH_TIMEOUT_MS
    );
    res.json({
      ok: true,
      projectId:
        process.env.FIREBASE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || null,
      golfsEmpty: snap.empty,
    });
  } catch (err) {
    res.status(503).json({ ok: false, error: err.message });
  }
});

// Ingestion OSM d'un golf en base (provenance osm). Déclenchée par appel explicite ;
// le bouton IHM viendra avec le branchement du détail parcours (incrément ultérieur).
router.post('/ingest', async (req, res) => {
  const { osmId, lat, lng, name, radiusKm, force } = req.body || {};
  if (!osmId || lat == null || lng == null || !name) {
    return res.status(400).json({ error: 'osmId, lat, lng et name requis' });
  }
  try {
    const summary = await ingestGolf({
      osmId,
      lat: Number(lat),
      lng: Number(lng),
      name,
      radiusKm: radiusKm != null ? Number(radiusKm) : undefined,
      force: force === true || force === '1',
    });
    res.json(summary);
  } catch (err) {
    console.error('[ingest]', err);
    res.status(500).json({ error: err.message });
  }
});

// Décode une scorecard (URL cgolf/web ou upload base64) et la met en cache en base
// (image en Storage + décodage). Dédup : même image → pas de re-décodage Gemini.
router.post('/scorecard', requireBase, async (req, res) => {
  const { url, fileData, mimeType, fileName, osmId, kind } = req.body || {};
  if (!url && !fileData) return res.status(400).json({ error: 'url ou fileData requis' });
  try {
    const result = await decodeAndCache({
      imageBuffer: fileData ? Buffer.from(fileData, 'base64') : null,
      imageUrl: url || null,
      mimeType: mimeType || 'image/jpeg',
      source: {
        kind: kind || (url ? (url.includes('cgolf.fr') ? 'cgolf' : 'url') : 'upload'),
        name: fileName || url || null,
        originUrl: url || null,
        uploadName: fileName || null,
      },
      osm: osmId ? { golfOsmId: osmId } : null,
    });
    res.json(result);
  } catch (err) {
    console.error('[scorecard]', err);
    res.status(502).json({ error: err.message });
  }
});

// Scorecards en cache d'un golf (par osmId), même golf non persisté.
router.get('/scorecards', requireBase, async (req, res) => {
  const { osmId } = req.query;
  if (!osmId) return res.status(400).json({ error: 'osmId requis' });
  try {
    res.json({ scorecards: await listCachedByOsm(osmId) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Proxy de l'image stockée (Storage est privé/deny-all → servie par le backend).
router.get('/scorecard/:id/image', requireBase, async (req, res) => {
  try {
    const img = await getScorecardImage(req.params.id);
    if (!img) return res.status(404).json({ error: 'scorecard introuvable' });
    res.set('Content-Type', img.mimeType);
    res.send(img.buffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
