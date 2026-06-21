/**
 * Script to generate Nepal's official boundary GeoJSON
 * including the Lipulekh-Limpiyadhura-Kalapani triangle.
 * 
 * Steps:
 * 1. Load provinces.geojson
 * 2. Union all provinces into a single polygon
 * 3. Add the disputed Lipulekh-Limpiyadhura-Kalapani triangle
 * 4. Save as nepal_official_boundary.geojson
 */

const fs = require('fs');
const path = require('path');
const turf = require('@turf/turf');

console.log('Loading provinces GeoJSON...');
const provincesPath = path.join(__dirname, 'data', 'provinces.geojson');
const provinces = JSON.parse(fs.readFileSync(provincesPath, 'utf8'));

console.log(`Found ${provinces.features.length} provinces.`);

// Step 1: Union all provinces into a single polygon
console.log('Computing union of all provinces...');
let nepalUnion = null;

for (let i = 0; i < provinces.features.length; i++) {
  const feature = provinces.features[i];
  const provId = feature.properties.ADM1_EN || feature.properties.PROVINCE;
  console.log(`  Processing Province ${provId}...`);
  
  if (nepalUnion === null) {
    nepalUnion = feature;
  } else {
    try {
      nepalUnion = turf.union(
        turf.featureCollection([nepalUnion, feature])
      );
    } catch (e) {
      console.error(`  Error unioning province ${provId}:`, e.message);
      // Try buffering slightly to fix topology issues
      try {
        const buffered = turf.buffer(feature, 0.001, { units: 'kilometers' });
        nepalUnion = turf.union(
          turf.featureCollection([nepalUnion, buffered])
        );
        console.log(`  Fixed with buffer workaround.`);
      } catch (e2) {
        console.error(`  Buffer workaround also failed:`, e2.message);
      }
    }
  }
}

if (!nepalUnion) {
  console.error('Failed to compute Nepal union!');
  process.exit(1);
}

console.log('Union complete. Geometry type:', nepalUnion.geometry.type);

// Step 2: Create the Lipulekh-Limpiyadhura-Kalapani triangle
// These coordinates represent Nepal's official claim as per the
// Government of Nepal's updated political map published in 2020.
// The triangle extends northwest of the current Province 7 boundary.
const disputedTriangle = turf.polygon([[
  [80.0580, 30.1833],  // Limpiyadhura (southwestern vertex)
  [80.0580, 30.3500],  // West side going north
  [80.1200, 30.4200],  // Northwestern approach to Lipulekh
  [80.2833, 30.4467],  // Lipulekh Pass (northern vertex)
  [80.3060, 30.4300],  // East of Lipulekh
  [80.3200, 30.3500],  // Eastern ridge
  [80.3060, 30.2730],  // Kalapani (eastern vertex)
  [80.2500, 30.2200],  // South of Kalapani
  [80.1800, 30.1900],  // Connecting back south
  [80.0586, 30.1900],  // Meet existing boundary
  [80.0580, 30.1833]   // Close ring at Limpiyadhura
]]);

console.log('Adding Lipulekh-Limpiyadhura-Kalapani disputed territory...');

// Step 3: Union the disputed triangle with the existing Nepal boundary
try {
  nepalUnion = turf.union(
    turf.featureCollection([nepalUnion, disputedTriangle])
  );
  console.log('Disputed territory added successfully.');
} catch (e) {
  console.error('Error adding disputed territory:', e.message);
  // Try with a slight buffer
  try {
    const bufferedTriangle = turf.buffer(disputedTriangle, 0.01, { units: 'kilometers' });
    nepalUnion = turf.union(
      turf.featureCollection([nepalUnion, bufferedTriangle])
    );
    console.log('Added with buffer workaround.');
  } catch (e2) {
    console.error('Buffer workaround failed:', e2.message);
  }
}

// Step 4: Create the output GeoJSON
const outputGeoJSON = {
  type: 'FeatureCollection',
  features: [{
    type: 'Feature',
    properties: {
      name: 'Nepal',
      name_ne: 'नेपाल',
      boundary_type: 'official',
      note: 'Includes Lipulekh-Limpiyadhura-Kalapani as per Government of Nepal official map (2020)',
      source: 'Generated from provinces union + disputed territory extension'
    },
    geometry: nepalUnion.geometry
  }]
};

// Verify bounding box
const bbox = turf.bbox(nepalUnion);
console.log(`\nBounding box: [${bbox[0].toFixed(4)}, ${bbox[1].toFixed(4)}] to [${bbox[2].toFixed(4)}, ${bbox[3].toFixed(4)}]`);
console.log(`  West: ${bbox[0].toFixed(4)}°E (should be ~80.058)`);
console.log(`  South: ${bbox[1].toFixed(4)}°N (should be ~26.35)`);
console.log(`  East: ${bbox[2].toFixed(4)}°E (should be ~88.20)`);
console.log(`  North: ${bbox[3].toFixed(4)}°N (should be ~30.45 with disputed area)`);

const outputPath = path.join(__dirname, 'data', 'nepal_official_boundary.geojson');
fs.writeFileSync(outputPath, JSON.stringify(outputGeoJSON));
console.log(`\nSaved to: ${outputPath}`);
console.log(`File size: ${(fs.statSync(outputPath).size / 1024).toFixed(1)} KB`);
