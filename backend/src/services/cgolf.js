const fetch = require('node-fetch');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const { debug } = require('../utils/logger');

const SCRIPTS_OUTPUT = path.join(__dirname, '..', '..', '..', 'scripts', 'output');
const CGOLF_REGIONS_CACHE_PATH = path.join(SCRIPTS_OUTPUT, 'cgolf_regions_cache.json');
const CGOLF_MATCH_CACHE_PATH = path.join(SCRIPTS_OUTPUT, 'cgolf_match_cache.json');
const CUSTOM_SOURCES_PATH = path.join(SCRIPTS_OUTPUT, 'custom_sources.json');

const CGOLF_BASE = 'https://www.cgolf.fr';

// Régions cgolf.fr avec centre approximatif pour sélection par proximité
const CGOLF_REGIONS = [
  { path: '/parcours/golfs-ile-de-france',              lat: 48.85,  lng:  2.35 },
  { path: '/parcours/golfs-rhone-alpes',                lat: 45.75,  lng:  4.85 },
  { path: '/parcours/golfs-auvergne',                   lat: 45.75,  lng:  3.10 },
  { path: '/parcours/golfs-bourgogne',                  lat: 47.00,  lng:  4.85 },
  { path: '/parcours/golfs-franche-comte',              lat: 47.25,  lng:  6.02 },
  { path: '/parcours/golfs-provence-alpes-cote-d-azur', lat: 43.70,  lng:  5.90 },
  { path: '/parcours/golfs-languedoc-roussillon',       lat: 43.60,  lng:  3.90 },
  { path: '/parcours/golfs-midi-pyrenees',              lat: 43.60,  lng:  1.45 },
  { path: '/parcours/golfs-aquitaine',                  lat: 44.85,  lng: -0.58 },
  { path: '/parcours/golfs-pays-de-la-loire',           lat: 47.48,  lng: -0.55 },
  { path: '/parcours/golfs-bretagne',                   lat: 48.11,  lng: -1.68 },
  { path: '/parcours/golfs-normandie',                  lat: 49.18,  lng:  0.35 },
  { path: '/parcours/golfs-nord-pas-de-calais',         lat: 50.63,  lng:  3.06 },
  { path: '/parcours/golfs-centre',                     lat: 47.90,  lng:  1.90 },
  { path: '/parcours/golfs-alsace',                     lat: 48.58,  lng:  7.75 },
];

// Rayon de sélection des régions cgolf à scraper autour d'un golf (km)
const REGION_SEARCH_RADIUS_KM = 200;

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
};

// Fuzzy threshold (0-100) et seuils géo (km)
const FUZZY_THRESHOLD = 60;
const GEO_MAX_FUZZY_KM = 10;
const GEO_FALLBACK_KM = 3;

const SCORECARD_PROMPT =
  "Voici la carte de score d'un parcours de golf. " +
  'Extrais les données trou par trou et retourne UNIQUEMENT un JSON valide, ' +
  'sans texte supplémentaire, sous cette forme exacte :\n' +
  '[\n  {"hole": 1, "par": 4, "handicap": 5, ' +
  '"distances": {"black": 378, "white": 378, "yellow": 369, "blue": 312, "red": 307}},\n  ...\n]\n' +
  'Utilise null pour les valeurs absentes. ' +
  'Colonnes françaises → clés JSON : Trou=hole, Par=par, Hcp=handicap, ' +
  'Noire=black, Blanc=white, Jaune=yellow, Bleu=blue, Rouge=red. ' +
  'Ignore les lignes Aller/Retour/Total/SSS/Slope.';

// ---------------------------------------------------------------------------
// Cache régions cgolf (regionPath → [courses]) — scrapé une fois par région
// Cache matches (osmId → [matches]) — calculé une fois par golf
// ---------------------------------------------------------------------------

let regionsCache = null;
let matchCache = null;

function readRegionsCache() {
  if (regionsCache) return regionsCache;
  if (!fs.existsSync(CGOLF_REGIONS_CACHE_PATH)) return {};
  try { regionsCache = JSON.parse(fs.readFileSync(CGOLF_REGIONS_CACHE_PATH, 'utf8')); }
  catch { regionsCache = {}; }
  return regionsCache;
}

function writeRegionsCache(data) {
  regionsCache = data;
  fs.mkdirSync(SCRIPTS_OUTPUT, { recursive: true });
  fs.writeFileSync(CGOLF_REGIONS_CACHE_PATH, JSON.stringify(data, null, 2));
}

function readMatchCache() {
  if (matchCache) return matchCache;
  if (!fs.existsSync(CGOLF_MATCH_CACHE_PATH)) return {};
  try { matchCache = JSON.parse(fs.readFileSync(CGOLF_MATCH_CACHE_PATH, 'utf8')); }
  catch { matchCache = {}; }
  return matchCache;
}

function writeMatchCache(data) {
  matchCache = data;
  fs.mkdirSync(SCRIPTS_OUTPUT, { recursive: true });
  fs.writeFileSync(CGOLF_MATCH_CACHE_PATH, JSON.stringify(data, null, 2));
}

// ---------------------------------------------------------------------------
// Normalisation nom pour matching fuzzy
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  'golf', 'club', 'de', 'du', 'le', 'la', 'les', 'l', 'd', 'des',
  'et', 'en', 'au', 'aux', 'sur', 'parcours', 'course',
]);

function normalizeName(name) {
  if (!name) return '';
  return name
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t && !STOP_WORDS.has(t))
    .join(' ');
}

// Token set ratio simplifié (comme rapidfuzz)
function tokenSetRatio(a, b) {
  const ta = new Set(a.split(' ').filter(Boolean));
  const tb = new Set(b.split(' ').filter(Boolean));
  const inter = [...ta].filter(t => tb.has(t));
  if (!inter.length) return 0;
  const sortedInter = inter.sort().join(' ');
  const ra = [sortedInter, [...ta].sort().join(' ')].sort().join(' ');
  const rb = [sortedInter, [...tb].sort().join(' ')].sort().join(' ');
  return Math.round(100 * (2 * inter.length) / (ta.size + tb.size));
}

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ---------------------------------------------------------------------------
// Scraping cgolf.fr
// ---------------------------------------------------------------------------

async function fetchDetailUrls(regionPath) {
  const url = CGOLF_BASE + regionPath;
  try {
    const res = await fetch(url, { headers: HEADERS, timeout: 20000 });
    if (!res.ok) return [];
    const html = await res.text();
    const $ = cheerio.load(html);
    const seen = new Set();
    const urls = [];
    $('a[href^="/detail/"]').each((_, el) => {
      const href = $(el).attr('href');
      if (!seen.has(href)) { seen.add(href); urls.push(CGOLF_BASE + href); }
    });
    debug(`[cgolf] ${regionPath} → ${urls.length} liens`);
    return urls;
  } catch {
    return [];
  }
}

async function fetchDetailInfo(detailUrl) {
  try {
    const res = await fetch(detailUrl, { headers: HEADERS, timeout: 15000 });
    if (!res.ok) return null;
    const html = await res.text();

    // GPS depuis Leaflet : L.latLng('45.895719', 4.966835)
    const gpsM = html.match(/L\.latLng\(['"']?([\d.]+)['"']?\s*,\s*['"']?([\d.]+)['"']?\)/);
    if (!gpsM) return null;
    const lat = parseFloat(gpsM[1]);
    const lng = parseFloat(gpsM[2]);

    // Nom depuis <title> : "Score du Golf de X | Cgolf.fr"
    const $ = cheerio.load(html);
    let name = '';
    const title = $('title').text().trim();
    const mTitle = title.match(/Score\s+(?:du|de\s+la|de\s+l'|des?)\s+(.+?)(?:\s*[\|–\-]\s*Cgolf.*)?$/i);
    if (mTitle) {
      name = mTitle[1].trim();
    } else {
      name = title.replace(/\s*[\|–\-]\s*Cgolf.*$/i, '').replace(/\s*\(\d+\).*$/, '').trim();
    }
    if (!name) {
      const slug = detailUrl.split('/detail/').pop().replace(/-\d{5}[a-z]?$/, '');
      name = slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    }

    // URL scorecard : /gallery/parcours/{ID}.jpg
    const imgM = html.match(/gallery\/parcours\/(\d+)\.jpg/);
    const scorecardImgUrl = imgM ? `${CGOLF_BASE}/gallery/parcours/${imgM[1]}.jpg` : null;

    return { name, lat, lng, scorecardImgUrl, url: detailUrl };
  } catch {
    return null;
  }
}

// Scrape une région cgolf.fr et la met en cache
async function scrapeRegion(regionPath) {
  const urls = await fetchDetailUrls(regionPath);
  debug(`[cgolf] Scraping ${regionPath} — ${urls.length} pages`);
  const courses = [];
  for (const url of urls) {
    const info = await fetchDetailInfo(url);
    if (info) courses.push(info);
    await new Promise(r => setTimeout(r, 150));
  }
  return courses;
}

// Retourne les parcours cgolf.fr pertinents pour un golf donné
// Scrape uniquement les régions proches non encore cachées
async function getCgolfCoursesNear(lat, lng) {
  const nearbyRegions = CGOLF_REGIONS.filter(r =>
    haversine(lat, lng, r.lat, r.lng) <= REGION_SEARCH_RADIUS_KM
  );
  debug(`[cgolf] ${nearbyRegions.length} région(s) proche(s) pour (${lat},${lng})`);

  const cache = readRegionsCache();
  const allCourses = [];

  for (const region of nearbyRegions) {
    if (!cache[region.path]) {
      debug(`[cgolf] Scraping région manquante: ${region.path}`);
      cache[region.path] = await scrapeRegion(region.path);
      writeRegionsCache(cache);
    } else {
      debug(`[cgolf] Cache région: ${region.path} (${cache[region.path].length} parcours)`);
    }
    allCourses.push(...cache[region.path]);
  }

  return allCourses;
}

// ---------------------------------------------------------------------------
// Matching OSM ↔ cgolf
// ---------------------------------------------------------------------------

function matchCgolf(osmGolf, cgolfCourses) {
  const osmNorm = normalizeName(osmGolf.name);
  const matches = [];

  for (const cg of cgolfCourses) {
    const score = tokenSetRatio(osmNorm, normalizeName(cg.name));
    const dist = haversine(osmGolf.lat, osmGolf.lng, cg.lat, cg.lng);
    if ((score >= FUZZY_THRESHOLD && dist <= GEO_MAX_FUZZY_KM) || dist <= GEO_FALLBACK_KM) {
      matches.push({ score, cg });
    }
  }

  // Dédoublonne et trie par score décroissant
  const seen = new Set();
  return matches
    .sort((a, b) => b.score - a.score)
    .filter(({ cg }) => seen.has(cg.url) ? false : seen.add(cg.url))
    .map(({ score, cg }) => ({
      cgolfName: cg.name,
      cgolfUrl: cg.url,
      cgolfLat: cg.lat,
      cgolfLng: cg.lng,
      scorecardImgUrl: cg.scorecardImgUrl,
      matchScore: score,
    }));
}

// ---------------------------------------------------------------------------
// Point d'entrée principal : trouve les matches cgolf pour un golf OSM
// ---------------------------------------------------------------------------

async function findCgolfMatches(osmId, osmName, osmLat, osmLng) {
  const cache = readMatchCache();

  if (cache[osmId] !== undefined) {
    debug(`[cgolf] Cache match: ${osmId}`);
    return cache[osmId];
  }

  debug(`[cgolf] Recherche cgolf pour "${osmName}" (${osmId})`);
  const cgolfCourses = await getCgolfCoursesNear(osmLat, osmLng);
  const matches = matchCgolf({ name: osmName, lat: osmLat, lng: osmLng }, cgolfCourses);
  debug(`[cgolf] ${matches.length} match(es) pour ${osmId}`);

  cache[osmId] = matches;
  writeMatchCache(cache);
  return matches;
}

// ---------------------------------------------------------------------------
// Scorecard
// ---------------------------------------------------------------------------

async function analyzeScorecard(imgBuffer, mimeType = 'image/jpeg') {
  const { GoogleGenAI } = require('@google/genai');
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  debug('[cgolf] Analyse scorecard avec Gemini Vision');
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [{
      parts: [
        { inlineData: { mimeType, data: imgBuffer.toString('base64') } },
        { text: SCORECARD_PROMPT },
      ],
    }],
  });

  let raw = response.text.trim();
  const fence = raw.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
  if (fence) raw = fence[1];
  return JSON.parse(raw);
}

async function fetchScorecardForMatch(match) {
  const slug = match.cgolfUrl.split('/').pop();
  const cacheFile = path.join(SCRIPTS_OUTPUT, `cgolf_holes_${slug}.json`);

  if (fs.existsSync(cacheFile)) {
    debug(`[cgolf] Cache scorecard: ${slug}`);
    const holes = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    return { holes, cgolfName: match.cgolfName, cgolfUrl: match.cgolfUrl };
  }

  if (!match.scorecardImgUrl) return null;

  debug(`[cgolf] Téléchargement scorecard: ${match.scorecardImgUrl}`);
  const imgRes = await fetch(match.scorecardImgUrl, { timeout: 15000, headers: HEADERS });
  if (!imgRes.ok) throw new Error(`Scorecard HTTP ${imgRes.status}`);
  const imgBuffer = await imgRes.buffer();

  const holes = await analyzeScorecard(imgBuffer);
  fs.mkdirSync(SCRIPTS_OUTPUT, { recursive: true });
  fs.writeFileSync(cacheFile, JSON.stringify(holes, null, 2));
  debug(`[cgolf] Cached ${holes.length} trous → ${slug}`);

  return { holes, cgolfName: match.cgolfName, cgolfUrl: match.cgolfUrl };
}

// ---------------------------------------------------------------------------
// API publique
// ---------------------------------------------------------------------------

async function fetchCgolfHoles(osmId, osmName, osmLat, osmLng) {
  const matches = await findCgolfMatches(osmId, osmName, osmLat, osmLng);
  if (!matches.length) return null;

  const results = await Promise.all(matches.map(fetchScorecardForMatch));
  const valid = results.filter(Boolean);
  return valid.length ? valid : null;
}

function readCustomSources() {
  if (!fs.existsSync(CUSTOM_SOURCES_PATH)) return {};
  return JSON.parse(fs.readFileSync(CUSTOM_SOURCES_PATH, 'utf8'));
}

function writeCustomSources(data) {
  fs.writeFileSync(CUSTOM_SOURCES_PATH, JSON.stringify(data, null, 2));
}

function getCustomSources(osmId) {
  const all = readCustomSources();
  const result = {};
  const prefix = `${osmId}|`;
  for (const [key, val] of Object.entries(all)) {
    if (key.startsWith(prefix)) result[key.slice(prefix.length)] = val;
  }
  return result;
}

function saveCustomSource(osmId, courseKey, holes, sourceName) {
  const all = readCustomSources();
  all[`${osmId}|${courseKey}`] = { holes, sourceName, savedAt: new Date().toISOString() };
  writeCustomSources(all);
}

function deleteCustomSource(osmId, courseKey) {
  const all = readCustomSources();
  delete all[`${osmId}|${courseKey}`];
  writeCustomSources(all);
}

module.exports = { fetchCgolfHoles, analyzeScorecard, getCustomSources, saveCustomSource, deleteCustomSource };
