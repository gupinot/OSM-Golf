const express = require('express');
const { applicationDefault } = require('firebase-admin/app');
const { getDb } = require('../services/firestore');
const { COLLECTIONS } = require('../data/schema');

const router = express.Router();

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

module.exports = router;
