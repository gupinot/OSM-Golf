const express = require('express');
const cors = require('cors');
const searchRoutes = require('./routes/search');
const holesRoutes = require('./routes/holes');
const cgolfHolesRoutes = require('./routes/cgolf-holes');
const osmAuthRoutes = require('./routes/osm-auth');

const app = express();
const PORT = process.env.PORT || 3001;

app.set('etag', false);
app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.use((req, res, next) => {
  const t0 = Date.now();
  const qs = Object.keys(req.query).length ? ' ' + JSON.stringify(req.query) : '';
  console.log(`→ ${req.method} ${req.path}${qs}`);
  res.on('finish', () => {
    console.log(`← ${res.statusCode} ${req.method} ${req.path} (${Date.now() - t0}ms)`);
  });
  next();
});

app.use('/api/search', searchRoutes);
app.use('/api/holes', holesRoutes);
app.use('/api/cgolf-holes', cgolfHolesRoutes);
app.use('/api/osm-auth', osmAuthRoutes);

app.listen(PORT, () => {
  const debugMode = process.env.DEBUG === 'osm-golf' || process.env.DEBUG === '*';
  console.log(`Backend OSM-Golf sur http://localhost:${PORT}${debugMode ? '  [debug ON]' : ''}`);
});
