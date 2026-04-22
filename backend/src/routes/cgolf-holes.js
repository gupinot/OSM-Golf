const { Router } = require('express');
const fetch = require('node-fetch');
const { fetchCgolfHoles, analyzeScorecard } = require('../services/cgolf');

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

// POST /api/cgolf-holes/analyze
// Body: { url: "https://..." } OR { fileData: "<base64>", mimeType: "image/jpeg", fileName: "score.jpg" }
router.post('/analyze', async (req, res) => {
  const { url, fileData, mimeType, fileName } = req.body || {};
  if (!url && !fileData) return res.status(400).json({ error: 'url ou fileData requis' });

  try {
    let imgBuffer;
    let sourceName;

    if (url) {
      const imgRes = await fetch(url, {
        timeout: 15000,
        headers: { 'User-Agent': 'OSM-Golf-App/1.0' },
      });
      if (!imgRes.ok) throw new Error(`HTTP ${imgRes.status} pour ${url}`);
      imgBuffer = await imgRes.buffer();
      sourceName = url;
    } else {
      imgBuffer = Buffer.from(fileData, 'base64');
      sourceName = fileName || 'Fichier local';
    }

    const detectedMime = mimeType || 'image/jpeg';
    const holes = await analyzeScorecard(imgBuffer, detectedMime);
    res.json({ holes, sourceName });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
