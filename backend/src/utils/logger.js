const enabled = process.env.DEBUG === 'osm-golf' || process.env.DEBUG === '*';

// Diagnostic de chargement : visible au démarrage si debug est actif
if (enabled) console.log('[DEBUG] logger chargé — debug actif (DEBUG=' + process.env.DEBUG + ')');

function debug(...args) {
  if (!enabled) return;
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[DEBUG ${ts}]`, ...args);
}

module.exports = { debug };
