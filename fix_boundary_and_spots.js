const fs = require('fs');
const turf = require('@turf/turf');

// 1. Load provinces and compute single union with large overlapping triangle
const provinces = JSON.parse(fs.readFileSync('./data/provinces.geojson', 'utf8'));
let nepalUnion = provinces.features[0];
for (let i = 1; i < provinces.features.length; i++) {
  try {
    nepalUnion = turf.union(turf.featureCollection([nepalUnion, provinces.features[i]]));
  } catch(e) {
    nepalUnion = turf.union(turf.featureCollection([nepalUnion, turf.buffer(provinces.features[i], 0.001)]));
  }
}

// Deep overlap triangle to guarantee single polygon union
const disputedTriangle = turf.polygon([[
  [80.0580, 30.1833],  // Limpiyadhura (southwestern vertex)
  [80.0580, 30.3500],  // West side going north
  [80.1200, 30.4200],  // Northwestern approach to Lipulekh
  [80.2833, 30.4467],  // Lipulekh Pass (northern vertex)
  [80.3060, 30.4300],  // East of Lipulekh
  [80.3200, 30.3500],  // Eastern ridge
  [80.3060, 30.2730],  // Kalapani (eastern vertex)
  [80.2500, 30.2200],  // South of Kalapani
  [80.8000, 29.5000],  // DEEP INSIDE PROVINCE 7
  [80.4000, 29.5000],  // DEEP INSIDE PROVINCE 7
  [80.0580, 30.1833]   // Close ring
]]);

try {
  nepalUnion = turf.union(turf.featureCollection([nepalUnion, disputedTriangle]));
} catch(e) {
  nepalUnion = turf.union(turf.featureCollection([nepalUnion, turf.buffer(disputedTriangle, 0.01)]));
}

// Clean up any small artifact holes or detached polygons, keep only the largest polygon
if (nepalUnion.geometry.type === 'MultiPolygon') {
  let maxArea = 0;
  let largestPoly = null;
  nepalUnion.geometry.coordinates.forEach(coords => {
    const poly = turf.polygon(coords);
    const area = turf.area(poly);
    if (area > maxArea) {
      maxArea = area;
      largestPoly = poly;
    }
  });
  // Strip inner rings (holes) from the largest polygon to make the mask solid
  nepalUnion.geometry = turf.polygon([largestPoly.geometry.coordinates[0]]).geometry;
} else if (nepalUnion.geometry.type === 'Polygon') {
  // Strip inner rings
  nepalUnion.geometry.coordinates = [nepalUnion.geometry.coordinates[0]];
}

const outputGeoJSON = {
  type: 'FeatureCollection',
  features: [{
    type: 'Feature',
    properties: { name: 'Nepal Official' },
    geometry: nepalUnion.geometry
  }]
};
fs.writeFileSync('./data/nepal_official_boundary.geojson', JSON.stringify(outputGeoJSON));
console.log('Fixed boundary. Geometry type:', nepalUnion.geometry.type);
if (nepalUnion.geometry.type === 'Polygon') {
  console.log('Rings:', nepalUnion.geometry.coordinates.length);
}

// 2. Filter tourism spots to ensure they are strictly inside the boundary
const spots = JSON.parse(fs.readFileSync('./data/tourism_spots.json', 'utf8'));
const originalCount = spots.features.length;

// A small buffer for points on the exact border
const boundaryBuffer = turf.buffer(nepalUnion, 2, { units: 'kilometers' });

const filteredFeatures = spots.features.filter(spot => {
  const pt = turf.point(spot.geometry.coordinates);
  return turf.booleanPointInPolygon(pt, boundaryBuffer);
});

spots.features = filteredFeatures;
fs.writeFileSync('./data/tourism_spots.json', JSON.stringify(spots, null, 2));

console.log(`Filtered spots. Removed ${originalCount - filteredFeatures.length} points outside Nepal.`);
console.log(`Total remaining spots: ${filteredFeatures.length}`);

