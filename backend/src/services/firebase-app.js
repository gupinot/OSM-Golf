const { initializeApp, getApps, getApp } = require('firebase-admin/app');

// Initialise l'Admin SDK une seule fois, partagé par l'auth et Firestore/Storage.
// Sur Cloud Run, les identifiants applicatifs par défaut (ADC) et le projet sont fournis
// par l'environnement ; en local on peut passer le projet via FIREBASE_PROJECT_ID.
function ensureApp() {
  if (!getApps().length) {
    initializeApp({
      projectId:
        process.env.FIREBASE_PROJECT_ID ||
        process.env.GOOGLE_CLOUD_PROJECT ||
        undefined,
    });
  }
  return getApp();
}

module.exports = { ensureApp };
