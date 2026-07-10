const { Router } = require('express');
const fetch = require('node-fetch');
const { fetchCgolfHoles, analyzeScorecard, getCustomSources, saveCustomSource, deleteCustomSource } = require('../services/cgolf');
const { isBaseConfigured } = require('../services/firestore');

const router = Router();

// GET /api/cgolf-holes?osmId=way/139128639&name=Golf+de+X&lat=…&lng=…
router.get('/', async (req, res) => {
  const { osmId, name, lat, lng } = req.query;
  if (!osmId) return res.status(400).json({ error: 'osmId requis' });

  try {
    const data = await fetchCgolfHoles(osmId, name, parseFloat(lat), parseFloat(lng));
    if (!data) return res.json({ found: false });
    res.json({ found: true, matches: data });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// POST /api/cgolf-holes/analyze
// Body: { url, fileData, mimeType, fileName, osmId?, courseKey? }
router.post('/analyze', async (req, res) => {
  const { url, fileData, mimeType, fileName, osmId, courseKey } = req.body || {};
  if (!url && !fileData) return res.status(400).json({ error: 'url ou fileData requis' });

  try {
    // Chemin base (si configurée) : décode + met en cache la scorecard (dédup, image en
    // Storage). Best-effort → en cas d'échec, on retombe sur le décodage disque ci-dessous.
    if (isBaseConfigured()) {
      try {
        const { decodeAndCache } = require('../services/scorecards');
        const r = await decodeAndCache({
          imageBuffer: fileData ? Buffer.from(fileData, 'base64') : null,
          imageUrl: url || null,
          mimeType: mimeType || 'image/jpeg',
          source: {
            kind: url ? (url.includes('cgolf.fr') ? 'cgolf' : 'url') : 'upload',
            name: fileName || url || null,
            originUrl: url || null,
            uploadName: fileName || null,
          },
          osm: osmId ? { golfOsmId: osmId } : null,
        });
        const srcName = fileName || url || 'source';
        if (osmId && courseKey) saveCustomSource(osmId, courseKey, r.decoded, srcName);
        return res.json({ holes: r.decoded, sourceName: srcName, scorecardId: r.scorecardId, cached: r.cached });
      } catch (e) {
        console.error('[analyze] base indispo, fallback disque:', e.message);
      }
    }

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

    if (osmId && courseKey) {
      saveCustomSource(osmId, courseKey, holes, sourceName);
    }

    res.json({ holes, sourceName });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// GET /api/cgolf-holes/custom-sources?osmId=way/123
router.get('/custom-sources', (req, res) => {
  const { osmId } = req.query;
  if (!osmId) return res.status(400).json({ error: 'osmId requis' });
  res.json(getCustomSources(osmId));
});

// DELETE /api/cgolf-holes/custom-source?osmId=way/123&courseKey=Parcours
router.delete('/custom-source', (req, res) => {
  const { osmId, courseKey } = req.query;
  if (!osmId || !courseKey) return res.status(400).json({ error: 'osmId et courseKey requis' });
  deleteCustomSource(osmId, courseKey);
  res.json({ ok: true });
});

module.exports = router;
