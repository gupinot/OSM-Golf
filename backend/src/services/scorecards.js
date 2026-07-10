const fetch = require('node-fetch');
const { analyzeScorecard } = require('./cgolf');
const { getScorecard, findScorecardsByOsm, putScorecard, sha1 } = require('../data/scorecards');

// Orchestration des scorecards : décodage Gemini + persistance en base (cache d'affichage),
// avec dédup. La base sert de cache — un accès ultérieur à la même image évite le
// re-téléchargement et le re-appel Gemini.

const HEADERS = { 'User-Agent': 'OSM-Golf-App/1.0' };

// id déterministe (dédup). cgolf → cgolf-<n> (depuis l'URL image, stable) ; autre URL →
// url-<hash> ; upload → upload-<hash du contenu>. Cet id est référencé en provenance
// card-*:{id} lors de la propagation en base (temps 2).
function scorecardIdFor(source, contentHash) {
  const url = source && source.originUrl;
  if (url) {
    const m = url.match(/parcours\/(\d+)\.jpg/i);
    if (m) return `cgolf-${m[1]}`;
    return `url-${sha1(url).slice(0, 16)}`;
  }
  if (!contentHash) throw new Error('id scorecard indéterminable (ni url ni contenu)');
  return `upload-${contentHash.slice(0, 16)}`;
}

// Décode une scorecard et la met en cache (base). Accepte soit un buffer image (upload),
// soit une URL (cgolf/web) — dans ce cas l'image n'est téléchargée qu'en cas de cache miss.
async function decodeAndCache({ imageBuffer = null, imageUrl = null, mimeType = 'image/jpeg', source = {}, osm = null }) {
  const originUrl = source.originUrl || imageUrl || null;
  const src = originUrl && !source.originUrl ? { ...source, originUrl } : source;

  let contentHash = imageBuffer ? sha1(imageBuffer) : null;
  let scorecardId = scorecardIdFor(src, contentHash);

  // Cache base d'abord → évite re-téléchargement + re-Gemini.
  const cached = await getScorecard(scorecardId);
  if (cached && cached.decoded) {
    return { scorecardId, decoded: cached.decoded, cached: true, imagePath: cached.imagePath };
  }

  // Cache miss : s'assurer d'avoir le buffer image.
  let buf = imageBuffer;
  if (!buf) {
    const url = imageUrl || originUrl;
    if (!url) throw new Error('image manquante (ni buffer ni url)');
    const r = await fetch(url, { timeout: 15000, headers: HEADERS });
    if (!r.ok) throw new Error(`Scorecard HTTP ${r.status}`);
    buf = await r.buffer();
    contentHash = sha1(buf);
    if (!src.originUrl) scorecardId = scorecardIdFor(src, contentHash);
  }

  const decoded = await analyzeScorecard(buf, mimeType);
  const { imagePath } = await putScorecard({
    scorecardId, source: src, imageBuffer: buf, mimeType, decoded, osm, contentHash,
  });
  return { scorecardId, decoded, cached: false, imagePath };
}

// Scorecards en cache pour un golf (par osmId), même golf non persisté.
async function listCachedByOsm(golfOsmId) {
  return findScorecardsByOsm(golfOsmId);
}

module.exports = { decodeAndCache, listCachedByOsm, scorecardIdFor };
