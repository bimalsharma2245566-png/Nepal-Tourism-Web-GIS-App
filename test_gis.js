const fs = require('fs');
const path = require('path');
const turf = require('@turf/turf');

console.log("=================================================");
console.log("GIS Quality Assurance & Data Integrity Test Suite");
console.log("=================================================\n");

let passedTestsCount = 0;
let failedTestsCount = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`[PASS] ${message}`);
    passedTestsCount++;
  } else {
    console.error(`[FAIL] ${message}`);
    failedTestsCount++;
  }
}

// 1. Load Datasets
const provincesPath = path.join(__dirname, 'data', 'provinces.geojson');
const districtsPath = path.join(__dirname, 'data', 'districts.geojson');
const municipalitiesPath = path.join(__dirname, 'data', 'municipalities.geojson');
const tourismPath = path.join(__dirname, 'data', 'tourism_spots.json');

let provinces, districts, municipalities, tourism;

try {
  provinces = JSON.parse(fs.readFileSync(provincesPath, 'utf8'));
  assert(true, "Successfully read and parsed provinces.geojson");
} catch (e) {
  assert(false, `Failed to parse provinces.geojson: ${e.message}`);
}

try {
  districts = JSON.parse(fs.readFileSync(districtsPath, 'utf8'));
  assert(true, "Successfully read and parsed districts.geojson");
} catch (e) {
  assert(false, `Failed to parse districts.geojson: ${e.message}`);
}

try {
  municipalities = JSON.parse(fs.readFileSync(municipalitiesPath, 'utf8'));
  assert(true, "Successfully read and parsed municipalities.geojson");
} catch (e) {
  assert(false, `Failed to parse municipalities.geojson: ${e.message}`);
}

try {
  tourism = JSON.parse(fs.readFileSync(tourismPath, 'utf8'));
  assert(true, "Successfully read and parsed tourism_spots.json");
} catch (e) {
  assert(false, `Failed to parse tourism_spots.json: ${e.message}`);
}

console.log("\n-------------------------------------------------");
console.log("Test Category 1: GeoJSON & Geometry Verification");
console.log("-------------------------------------------------");

if (provinces && districts && municipalities && tourism) {
  
  // Verify FeatureCollections
  assert(provinces.type === 'FeatureCollection', "Provinces is a valid FeatureCollection");
  assert(districts.type === 'FeatureCollection', "Districts is a valid FeatureCollection");
  assert(municipalities.type === 'FeatureCollection', "Municipalities is a valid FeatureCollection");
  assert(tourism.type === 'FeatureCollection', "Tourism is a valid FeatureCollection");
  
  // Verify counts
  assert(provinces.features.length === 7, `Provinces contains exactly 7 provinces (Found: ${provinces.features.length})`);
  assert(districts.features.length === 77, `Districts contains exactly 77 districts (Found: ${districts.features.length})`);
  assert(municipalities.features.length > 700, `Municipalities contains local level boundaries (Found: ${municipalities.features.length})`);
  assert(tourism.features.length >= 15, `Tourism database has sufficient coverage (Found: ${tourism.features.length} points)`);
  
  console.log("\n-------------------------------------------------");
  console.log("Test Category 2: Administrative Hierarchy Consistency");
  console.log("-------------------------------------------------");
  
  // Build lookup lists from boundaries
  const districtList = districts.features.map(f => f.properties.DISTRICT.toUpperCase());
  const provinceList = [1, 2, 3, 4, 5, 6, 7];
  
  // Check each tourism spot for administrative validity
  tourism.features.forEach(spot => {
    const props = spot.properties;
    const name = props.name;
    
    // Check Province Number is valid
    assert(provinceList.includes(props.province), `${name} has a valid Province ID: ${props.province}`);
    
    // Check District Name is valid and exists in boundary layers
    const distExists = districtList.includes(props.district.toUpperCase());
    assert(distExists, `${name} has a valid Nepalese District: "${props.district}"`);
    
    // Verify that the spot's province match the boundary district's province
    if (distExists) {
      const boundaryDist = districts.features.find(f => f.properties.DISTRICT.toUpperCase() === props.district.toUpperCase());
      const boundProv = boundaryDist.properties.PROVINCE;
      assert(parseInt(props.province) === parseInt(boundProv), `${name} province matches district boundary province (${props.province} == ${boundProv})`);
    }
  });

  console.log("\n-------------------------------------------------");
  console.log("Test Category 3: Turf.js Spatial Operations QA");
  console.log("-------------------------------------------------");
  
  // Base location: Kathmandu Durbar Square (85.3073, 27.7042)
  const ktmDurbarSq = [85.3073, 27.7042];
  const ktmPoint = turf.point(ktmDurbarSq);
  
  // A. Nearest Point Finder Test
  // With expanded dataset, Patan Museum is now the nearest other spot to KTM Durbar Square.
  const tourismCollection = turf.featureCollection(tourism.features);
  const nearest = turf.nearestPoint(ktmPoint, tourismCollection);
  
  // Kathmandu Durbar Square itself is in the collection. Let's exclude it to find the *other* closest spot.
  const otherSpots = tourism.features.filter(f => f.properties.id !== 'ktm-durbar-square');
  const otherCollection = turf.featureCollection(otherSpots);
  const nextNearest = turf.nearestPoint(ktmPoint, otherCollection);
  
  // In the expanded dataset, Patan Museum is nearest (at ~3.5km), very close to Swayambhunath (3.7km)
  const validNearestIds = ['swayambhunath', 'patan-museum', 'rani-pokhari', 'garden-of-dreams', 'golden-temple-patan'];
  assert(validNearestIds.includes(nextNearest.properties.id), 
    `Nearest point algorithm identifies a known close spot from Kathmandu Durbar Square (Found: ${nextNearest.properties.name})`);
  
  // B. Buffer Analysis Test (10 km Buffer)
  const bufferDistance = 10; // km
  const bufferPoly = turf.buffer(ktmPoint, bufferDistance, { units: 'kilometers' });
  
  // Test points inside and outside:
  // Patan Durbar Square (85.3252, 27.6734) -> ~5 km (Inside)
  // Swayambhunath (85.2905, 27.7150) -> ~3 km (Inside)
  // Pashupatinath (85.3486, 27.7104) -> ~5.5 km (Inside)
  // Bhaktapur Durbar Square (85.4281, 27.6721) -> ~12.5 km (Outside)
  
  const patanPoint = turf.point([85.3252, 27.6734]);
  const swayambhuPoint = turf.point([85.2905, 27.7150]);
  const pashupatiPoint = turf.point([85.3486, 27.7104]);
  const bhaktapurPoint = turf.point([85.4281, 27.6721]);
  
  assert(turf.booleanPointInPolygon(patanPoint, bufferPoly), "Patan Durbar Square is correctly classified INSIDE 10km buffer");
  assert(turf.booleanPointInPolygon(swayambhuPoint, bufferPoly), "Swayambhunath is correctly classified INSIDE 10km buffer");
  assert(turf.booleanPointInPolygon(pashupatiPoint, bufferPoly), "Pashupatinath is correctly classified INSIDE 10km buffer");
  assert(!turf.booleanPointInPolygon(bhaktapurPoint, bufferPoly), "Bhaktapur Durbar Square is correctly classified OUTSIDE 10km buffer (Distance ~12.5km)");
  
  // Check count inside 10km buffer (flexible for expanded dataset)
  let insideCount = 0;
  tourism.features.forEach(spot => {
    const pt = turf.point(spot.geometry.coordinates);
    if (turf.booleanPointInPolygon(pt, bufferPoly)) {
      insideCount++;
    }
  });
  
  // With expanded dataset, more spots exist in the Kathmandu Valley 10km buffer area
  assert(insideCount >= 4, `10km Buffer contains at least 4 spots in Kathmandu Valley (Found: ${insideCount})`);
  assert(insideCount <= 30, `10km Buffer count is within a reasonable range for Kathmandu (Found: ${insideCount})`);
}

console.log("\n=================================================");
console.log("                TEST RUN SUMMARY                 ");
console.log("=================================================");
console.log(`Total Tests Run: ${passedTestsCount + failedTestsCount}`);
console.log(`Passed: ${passedTestsCount}`);
console.log(`Failed: ${failedTestsCount}`);
console.log("=================================================\n");

if (failedTestsCount > 0) {
  process.exit(1);
} else {
  console.log("QA Verification Completed Successfully! All systems functional.");
  process.exit(0);
}
