const { Router } = require('express');
const { searchByName, searchByZone, fetchZoneStats } = require('../services/overpass');
const { geocodeCity } = require('../services/nominatim');

const router = Router();

router.get('/name', async (req, res) => {
  const { q } = req.query;
  if (!q || q.trim().length < 2) {
    return res.status(400).json({ error: 'Paramètre q requis (min 2 caractères)' });
  }
  const fresh = req.query.fresh === '1';
  try {
    const courses = await searchByName(q.trim(), { fresh });
    res.json(courses);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.get('/zone', async (req, res) => {
  let { lat, lng, city, radius = 50 } = req.query;
  radius = Math.min(parseFloat(radius) || 50, 100);
  const fresh = req.query.fresh === '1';

  try {
    if (city) {
      const geo = await geocodeCity(city);
      lat = geo.lat;
      lng = geo.lng;
    } else {
      lat = parseFloat(lat);
      lng = parseFloat(lng);
      if (isNaN(lat) || isNaN(lng)) {
        return res.status(400).json({ error: 'lat/lng ou city requis' });
      }
    }
    const courses = await searchByZone(lat, lng, radius, { fresh });
    res.json({ lat, lng, radius, courses });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// GET /api/search/zone-stats?lat=…&lng=…&radius=50
// Comptage des features de jeu (trous/tees/greens/fairways/bunkers) par golf sur la zone.
router.get('/zone-stats', async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);
  const radius = Math.min(parseFloat(req.query.radius) || 50, 100);
  const fresh = req.query.fresh === '1';

  if (isNaN(lat) || isNaN(lng)) {
    return res.status(400).json({ error: 'lat/lng requis' });
  }
  try {
    const stats = await fetchZoneStats(lat, lng, radius, { fresh });
    res.json(stats);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
