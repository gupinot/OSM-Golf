const { Router } = require('express');
const { fetchCgolfHoles } = require('../services/cgolf');

const router = Router();

// GET /api/cgolf-holes?osmId=way/139128639
router.get('/', async (req, res) => {
  const { osmId } = req.query;
  if (!osmId) return res.status(400).json({ error: 'osmId requis' });

  try {
    const data = await fetchCgolfHoles(osmId);
    if (!data) return res.json({ found: false });
    res.json({ found: true, matches: data });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
