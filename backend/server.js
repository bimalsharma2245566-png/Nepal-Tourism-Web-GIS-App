const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for API routes
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

// Serve static files from the 'front end/public' directory
app.use(express.static(path.join(__dirname, '..', 'front end', 'public')));

const sqlite3 = require('sqlite3').verbose();

// Initialize Database Connection
const dbPath = path.join(__dirname, 'nepal_tourism.sqlite');
let db;

if (fs.existsSync(dbPath)) {
  db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
    if (err) console.error('Error opening database:', err.message);
    else console.log('Successfully connected to SQLite database layer.');
  });
} else {
  console.warn('WARNING: SQLite database not found. Please run "npm run db:setup" first.');
}

// Helper to query the DB and reconstruct a GeoJSON FeatureCollection
function serveGeoJSONFromDB(tableName, res) {
  if (!db) {
    return res.status(500).json({ error: 'Database not initialized' });
  }

  // Execute SQL Query against the specific table
  const sql = `SELECT properties_json, geometry_json FROM ${tableName}`;
  
  db.all(sql, [], (err, rows) => {
    if (err) {
      console.error(`Database query error on ${tableName}:`, err.message);
      return res.status(500).json({ error: 'Database query failed' });
    }

    // Map the relational rows back into a standard GeoJSON Feature structure
    const features = rows.map(row => {
      let properties = {};
      let geometry = null;
      try {
        if (row.properties_json) properties = JSON.parse(row.properties_json);
        if (row.geometry_json) geometry = JSON.parse(row.geometry_json);
      } catch (e) {
        console.error('Error parsing JSON from database row:', e.message);
      }

      return {
        type: 'Feature',
        properties: properties,
        geometry: geometry
      };
    });

    res.json({
      type: 'FeatureCollection',
      features: features
    });
  });
}

// API Endpoint to serve Province Boundaries
app.get('/api/geojson/provinces', (req, res) => {
  serveGeoJSONFromDB('provinces', res);
});

// API Endpoint to serve District Boundaries
app.get('/api/geojson/districts', (req, res) => {
  serveGeoJSONFromDB('districts', res);
});

// API Endpoint to serve Municipality (Local Level) Boundaries
app.get('/api/geojson/municipalities', (req, res) => {
  serveGeoJSONFromDB('municipalities', res);
});

// API Endpoint to serve Tourism spots
app.get('/api/geojson/tourism', (req, res) => {
  serveGeoJSONFromDB('tourism_spots', res);
});

// API Endpoint to serve Nepal Official Boundary
app.get('/api/geojson/nepal-boundary', (req, res) => {
  serveGeoJSONFromDB('nepal_boundary', res);
});

// Catch-all route to serve the main HTML index file for the root path
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'front end', 'public', 'index.html'));
});

// Start the server
app.listen(PORT, () => {
  console.log(`Nepal Tourism Web GIS server running on http://localhost:${PORT}`);
});
