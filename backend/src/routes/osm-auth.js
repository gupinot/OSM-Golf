const { Router } = require('express');
const { buildAuthUrl, exchangeCode, isAuthenticated, logout } = require('../services/osm-auth');

const router = Router();

// GET /api/osm-auth/auth-url → retourne l'URL OSM à ouvrir (flux OOB)
router.get('/auth-url', (req, res) => {
  try {
    res.json({ url: buildAuthUrl() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/osm-auth/exchange  { code: "…" }
router.post('/exchange', async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'Code OAuth manquant' });

  try {
    await exchangeCode(code);
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// GET /api/osm-auth/status
router.get('/status', (req, res) => {
  res.json({ authenticated: isAuthenticated() });
});

// POST /api/osm-auth/logout
router.post('/logout', (req, res) => {
  logout();
  res.json({ ok: true });
});

module.exports = router;
