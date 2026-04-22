const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const { debug } = require('../utils/logger');

const SCRIPTS_OUTPUT = path.join(__dirname, '..', '..', '..', 'scripts', 'output');
const MATCH_RESULTS_PATH = path.join(SCRIPTS_OUTPUT, 'match_results.json');

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

let matchResultsCache = null;

function getMatchResults() {
  if (!matchResultsCache) {
    matchResultsCache = JSON.parse(fs.readFileSync(MATCH_RESULTS_PATH, 'utf8'));
  }
  return matchResultsCache;
}

async function analyzeScorecard(imgBuffer) {
  const { GoogleGenAI } = require('@google/genai');
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  debug('[cgolf] Analyse scorecard avec Gemini Vision');
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [{
      parts: [
        { inlineData: { mimeType: 'image/jpeg', data: imgBuffer.toString('base64') } },
        { text: SCORECARD_PROMPT },
      ],
    }],
  });

  let raw = response.text.trim();
  const fence = raw.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
  if (fence) raw = fence[1];
  return JSON.parse(raw);
}

async function fetchCgolfMatch(match) {
  const slug = match.cgolf_url.split('/').pop();
  const cacheFile = path.join(SCRIPTS_OUTPUT, `cgolf_holes_${slug}.json`);

  if (fs.existsSync(cacheFile)) {
    debug(`[cgolf] Cache hit: ${slug}`);
    const holes = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    return { holes, cgolfName: match.cgolf_name, cgolfUrl: match.cgolf_url };
  }

  if (!match.cgolf_scorecard_img_url) return null;

  debug(`[cgolf] Téléchargement scorecard: ${match.cgolf_scorecard_img_url}`);
  const imgRes = await fetch(match.cgolf_scorecard_img_url, {
    timeout: 15000,
    headers: { 'User-Agent': 'OSM-Golf-App/1.0' },
  });
  if (!imgRes.ok) throw new Error(`Scorecard HTTP ${imgRes.status}`);
  const imgBuffer = await imgRes.buffer();

  const holes = await analyzeScorecard(imgBuffer);
  fs.writeFileSync(cacheFile, JSON.stringify(holes, null, 2));
  debug(`[cgolf] Cached ${holes.length} trous → ${slug}`);

  return { holes, cgolfName: match.cgolf_name, cgolfUrl: match.cgolf_url };
}

async function fetchCgolfHoles(osmId) {
  const matches = getMatchResults().filter(r => r.osm_id === osmId && r.cgolf_found);
  if (!matches.length) return null;

  const results = await Promise.all(matches.map(fetchCgolfMatch));
  const valid = results.filter(Boolean);
  return valid.length ? valid : null;
}

module.exports = { fetchCgolfHoles };
