const { Router } = require('express');
const { fetchHoles } = require('../services/overpass');
const { analyzeHolesQuality, analyzeTeeGreenQuality } = require('../services/quality');

const router = Router();

// GET /api/holes?lat=…&lng=…&radius=5
router.get('/', async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);
  const radius = Math.min(parseFloat(req.query.radius) || 5, 10);

  if (isNaN(lat) || isNaN(lng)) {
    return res.status(400).json({ error: 'lat et lng requis' });
  }

  try {
    const { holes, tees: rawTees, greens: rawGreens } = await fetchHoles(lat, lng, radius);
    const quality = analyzeHolesQuality(holes);
    const { tees, greens } = analyzeTeeGreenQuality(holes, rawTees, rawGreens);
    res.json({ holes, quality, tees, greens });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
