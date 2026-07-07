const { initializeApp, getApps } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');

// Initialise l'Admin SDK une seule fois. Sur Cloud Run, les identifiants applicatifs
// par défaut (ADC) et le projet sont fournis par l'environnement ; en local on peut
// passer le projet explicitement via FIREBASE_PROJECT_ID.
if (!getApps().length) {
  initializeApp({
    projectId:
      process.env.FIREBASE_PROJECT_ID ||
      process.env.GOOGLE_CLOUD_PROJECT ||
      undefined,
  });
}

// Emails habilités (CSV). « Login obligatoire » ne suffit pas : sans allowlist,
// n'importe quel compte Google entrerait. Fail-closed si non configuré.
function allowedEmails() {
  return (process.env.AUTHORIZED_EMAILS || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
}

// Vérifie l'ID token Firebase (Bearer) puis l'habilitation par email.
// Bypass explicite en dev local via AUTH_DISABLED=1 (jamais posé en prod).
async function requireAuth(req, res, next) {
  if (process.env.AUTH_DISABLED === '1') return next();

  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  if (!m) return res.status(401).json({ error: 'Authentification requise' });

  let decoded;
  try {
    decoded = await getAuth().verifyIdToken(m[1]);
  } catch {
    return res.status(401).json({ error: 'Token invalide ou expiré' });
  }

  const allow = allowedEmails();
  if (allow.length === 0) {
    return res.status(403).json({ error: 'Habilitation non configurée (AUTHORIZED_EMAILS vide)' });
  }
  const email = (decoded.email || '').toLowerCase();
  if (!allow.includes(email)) {
    return res.status(403).json({ error: 'Compte non autorisé' });
  }

  req.user = decoded;
  next();
}

module.exports = { requireAuth };
