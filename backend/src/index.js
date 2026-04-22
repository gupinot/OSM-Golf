const express = require('express');
const cors = require('cors');
const searchRoutes = require('./routes/search');
const holesRoutes = require('./routes/holes');
const cgolfHolesRoutes = require('./routes/cgolf-holes');

const app = express();
const PORT = process.env.PORT || 3001;

app.set('etag', false);
app.use(cors());
app.use(express.json());

app.use('/api/search', searchRoutes);
app.use('/api/holes', holesRoutes);
app.use('/api/cgolf-holes', cgolfHolesRoutes);

app.listen(PORT, () => {
  const debugMode = process.env.DEBUG === 'osm-golf' || process.env.DEBUG === '*';
  console.log(`Backend OSM-Golf sur http://localhost:${PORT}${debugMode ? '  [debug ON]' : ''}`);
});
