const fetch = require('node-fetch');

const OSM_AUTH_URL  = 'https://www.openstreetmap.org/oauth2/authorize';
const OSM_TOKEN_URL = 'https://www.openstreetmap.org/oauth2/token';
const OOB_REDIRECT  = 'urn:ietf:wg:oauth:2.0:oob';

// Token stocké en mémoire (valide jusqu'au redémarrage du serveur)
let _accessToken = null;

function buildAuthUrl() {
  const clientId = process.env.OSM_CLIENT_ID;
  if (!clientId) throw new Error('OSM_CLIENT_ID non configuré');
  const params = new URLSearchParams({
    client_id:     clientId,
    redirect_uri:  OOB_REDIRECT,
    response_type: 'code',
    scope:         'write_api',
  });
  return `${OSM_AUTH_URL}?${params}`;
}

async function exchangeCode(code) {
  const clientId     = process.env.OSM_CLIENT_ID;
  const clientSecret = process.env.OSM_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('OSM_CLIENT_ID / OSM_CLIENT_SECRET non configurés');

  const res = await fetch(OSM_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'authorization_code',
      code,
      redirect_uri:  OOB_REDIRECT,
      client_id:     clientId,
      client_secret: clientSecret,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Échange OAuth échoué: HTTP ${res.status} — ${text}`);
  }

  const data = await res.json();
  if (!data.access_token) throw new Error(`Token absent dans la réponse OSM: ${JSON.stringify(data)}`);

  _accessToken = data.access_token;
  return _accessToken;
}

function getToken() {
  if (!_accessToken) throw new Error('Non authentifié OSM — connecte-toi via /api/osm-auth/login');
  return _accessToken;
}

function isAuthenticated() {
  return !!_accessToken;
}

function logout() {
  _accessToken = null;
}

module.exports = { buildAuthUrl, exchangeCode, getToken, isAuthenticated, logout };
