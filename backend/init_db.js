const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, 'nepal_tourism.sqlite');

// Remove existing DB file if it exists to start fresh
if (fs.existsSync(dbPath)) {
  fs.unlinkSync(dbPath);
}

const db = new sqlite3.Database(dbPath);

const dataFiles = {
  provinces: path.join(__dirname, '..', 'data', 'provinces.geojson'),
  districts: path.join(__dirname, '..', 'data', 'districts.geojson'),
  municipalities: path.join(__dirname, '..', 'data', 'municipalities.geojson'),
  nepal_boundary: path.join(__dirname, '..', 'data', 'nepal_official_boundary.geojson'),
  tourism_spots: path.join(__dirname, '..', 'data', 'tourism_spots.json')
};

db.serialize(() => {
  console.log('Creating database tables...');
  
  // Create tables for each GeoJSON dataset
  const tables = ['provinces', 'districts', 'municipalities', 'nepal_boundary', 'tourism_spots'];
  
  for (const table of tables) {
    db.run(`CREATE TABLE IF NOT EXISTS ${table} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      feature_id TEXT,
      properties_json TEXT,
      geometry_json TEXT
    )`);
  }

  // Extra table specifically for relational querying demonstration on tourism spots
  db.run(`CREATE TABLE IF NOT EXISTS tourism_spots_relational (
    pk_id INTEGER PRIMARY KEY AUTOINCREMENT,
    spot_id TEXT,
    name TEXT,
    category TEXT,
    province TEXT,
    district TEXT,
    properties_json TEXT,
    geometry_json TEXT
  )`);

  console.log('Tables created. Populating data...');
  
  for (const [key, filePath] of Object.entries(dataFiles)) {
    if (!fs.existsSync(filePath)) {
      console.warn(`Warning: File not found ${filePath}`);
      continue;
    }
    
    console.log(`Parsing ${key} features...`);
    const geojson = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const features = geojson.features || [];
    
    db.serialize(() => {
      db.run('BEGIN TRANSACTION');
      
      const stmt = db.prepare(`INSERT INTO ${key} (feature_id, properties_json, geometry_json) VALUES (?, ?, ?)`);
      
      features.forEach((feature, index) => {
        const featureId = feature.properties.id || feature.id || `feat_${index}`;
        const props = JSON.stringify(feature.properties);
        const geom = JSON.stringify(feature.geometry);
        stmt.run(featureId, props, geom);
        
        // Also insert into the relational table for tourism_spots to allow advanced querying
        if (key === 'tourism_spots') {
          db.run(`INSERT INTO tourism_spots_relational 
            (spot_id, name, category, province, district, properties_json, geometry_json) 
            VALUES (?, ?, ?, ?, ?, ?, ?)`, 
            [
              featureId, 
              feature.properties.name, 
              feature.properties.category, 
              feature.properties.province || feature.properties.province_name, 
              feature.properties.district,
              props, 
              geom
            ]
          );
        }
      });
      
      stmt.finalize();
      db.run('COMMIT');
      console.log(`Inserted ${features.length} rows into ${key}.`);
    });
  }
});

db.close((err) => {
  if (err) {
    console.error('Error closing database:', err.message);
  } else {
    console.log('Database initialization complete! Saved to', dbPath);
  }
});
