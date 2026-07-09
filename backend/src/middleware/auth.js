const { getAuth } = require('firebase-admin/auth');
const { ensureApp } = require('../services/firebase-app');

// Initialise l'Admin SDK une seule fois (partagé avec Firestore/Storage).
ensureApp();

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
