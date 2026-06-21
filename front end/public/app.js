/**
 * Nepal Tourism & Destination Finder - Web GIS Mapping Engine
 */

document.addEventListener('DOMContentLoaded', () => {
  
  // ==========================================
  // 1. STATE & GLOBAL VARIABLES
  // ==========================================
  let map = null;
  let originMarker = null;
  let bufferLayer = null;
  let routeLayer = null;
  let nearestRouteLayer = null;
  
  // Datasets stored in memory after fetching
  let provincesGeoJSON = null;
  let districtsGeoJSON = null;
  let municipalitiesGeoJSON = null;
  let tourismSpotsGeoJSON = null;
  let nepalBoundaryPolygon = null;  // Turf feature for boundary checks
  
  // Map layers for toggling
  let provincesLayerGroup = L.layerGroup();
  let districtsLayerGroup = L.layerGroup();
  let municipalitiesLayerGroup = L.layerGroup();
  let tourismLayerGroup = L.layerGroup();
  
  // App state variables
  let originCoords = null; // [lat, lng]
  let activeCategory = 'none';
  let activeTourismMarkers = [];
  let selectedSpotId = null;
  
  // Map of Province ID to Name
  const PROVINCE_NAMES = {
    1: "Koshi Province",
    2: "Madhesh Province",
    3: "Bagmati Province",
    4: "Gandaki Province",
    5: "Lumbini Province",
    6: "Karnali Province",
    7: "Sudurpashchim Province"
  };

  // Base Maps Tile Layers
  const basemaps = {
    osm: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap contributors'
    }),
    satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
      attribution: 'Tiles © Esri — Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
    }),
    terrain: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
      attribution: 'Tiles © Esri — Esri, DeLorme, NAVTEQ, TomTom, Intermap, iPC, USGS, FAO, NPS, NRCAN, GeoBase, Kadaster NL, Ordnance Survey, Esri Japan, METI, Esri China (Hong Kong), and the GIS User Community'
    })
  };

  // ==========================================
  // 2. INITIALIZATION
  // ==========================================
  function init() {
    setupMap();
    setupEventListeners();
    fetchDatasets();
  }

  // Set up the Leaflet map and add default layers
  function setupMap() {
    // Center map on central Nepal
    map = L.map('map', {
      center: [28.3949, 84.1240],
      zoom: 7,
      minZoom: 7,
      maxBounds: [
        [26.347, 80.051], // Southwest bounds of Nepal
        [30.550, 88.201]  // Northeast bounds (updated to include Lipulekh)
      ],
      layers: [basemaps.osm], // Default base map
      zoomControl: false, // Disable default to add custom on top-right
      // Mobile touch optimizations:
      tap: false, // Prevents 300ms tap delay to make touch feel instant
      bounceAtZoomLimits: false, // Disabling bounce improves pinch-zoom performance
      touchZoom: true // Explicitly enable multi-touch zooming
    });

    // Add zoom control at top-right
    L.control.zoom({ position: 'topright' }).addTo(map);
    
    // Add layer groups to map
    provincesLayerGroup.addTo(map);
    districtsLayerGroup.addTo(map);
    municipalitiesLayerGroup.addTo(map);
    tourismLayerGroup.addTo(map);

    // Recalculate map size after layout settles (sidebars are now overlays)
    setTimeout(() => map.invalidateSize(), 100);
  }

  // ==========================================
  // 3. EVENT LISTENERS
  // ==========================================
  function setupEventListeners() {
    // Expose selectBufferSpot globally so buffer list links can trigger selection
    window.selectBufferSpot = function(id) {
      const spotItem = activeTourismMarkers.find(item => item.feature.properties.id === id);
      if (spotItem) {
        selectTourismSpot(spotItem.feature);
      }
    };

    // Map Click - Set Origin Point (restricted to Nepal boundary)
    map.on('click', (e) => {
      const { lat, lng } = e.latlng;

      // If boundary is not yet loaded, fall back to unrestricted behaviour
      if (!nepalBoundaryPolygon) {
        setOrigin(lat, lng);
        return;
      }

      const clickedPoint = turf.point([lng, lat]);

      if (turf.booleanPointInPolygon(clickedPoint, nepalBoundaryPolygon)) {
        // ✅ Click is inside Nepal — place origin normally
        setOrigin(lat, lng);
      } else {
        // ❌ Click is outside Nepal — snap to the nearest point on the border
        const snapped = snapToNepalBorder(lng, lat);
        if (snapped) {
          showBoundaryToast(`Outside Nepal — snapped to nearest border point.`);
          setOrigin(snapped[1], snapped[0]); // turf point is [lng, lat]
        } else {
          showBoundaryToast(`Please click inside Nepal to set an origin point.`);
        }
      }
    });

    // Detect GPS Button
    document.getElementById('btn-detect-gps').addEventListener('click', detectGPS);

    // Sidebar Category Tag Toggles
    const tags = document.querySelectorAll('.category-tag');
    tags.forEach(tag => {
      tag.addEventListener('click', (e) => {
        tags.forEach(t => t.classList.remove('active'));
        tag.classList.add('active');
        activeCategory = tag.getAttribute('data-category');
        applyFilters();
      });
    });

    // Search input typing
    document.getElementById('search-input').addEventListener('input', applyFilters);

    // Administrative dropdowns
    document.getElementById('filter-province').addEventListener('change', (e) => {
      populateDistrictDropdown(e.target.value);
      applyFilters();
    });
    document.getElementById('filter-district').addEventListener('change', applyFilters);

    // Spatial Analysis: Find Nearest
    document.getElementById('btn-find-nearest').addEventListener('click', findNearestAttraction);

    // Spatial Analysis: Buffer Radius Slider
    const slider = document.getElementById('buffer-radius-slider');
    const valDisplay = document.getElementById('buffer-radius-value');
    slider.addEventListener('input', (e) => {
      valDisplay.textContent = `${e.target.value} km`;
    });

    document.getElementById('btn-draw-buffer').addEventListener('click', runBufferAnalysis);
    document.getElementById('btn-clear-buffer').addEventListener('click', clearBuffer);

    // Spatial Analysis: Routing
    document.getElementById('btn-calculate-route').addEventListener('click', calculateRouteFromSidebar);
    document.getElementById('btn-clear-route').addEventListener('click', clearRoute);

    // Custom Layer Control toggling
    const btnLayersMenu = document.getElementById('btn-toggle-layers-menu');
    const layersMenuContent = document.getElementById('layers-menu-content');
    btnLayersMenu.addEventListener('click', (e) => {
      e.stopPropagation();
      layersMenuContent.classList.toggle('hidden');
    });
    
    // Hide layers menu when clicking elsewhere on map
    map.on('click', () => {
      layersMenuContent.classList.add('hidden');
    });

    // Basemap selector radios
    const basemapRadios = document.getElementsByName('basemap-radio');
    basemapRadios.forEach(radio => {
      radio.addEventListener('change', (e) => {
        const selected = e.target.value;
        // Remove active basemaps
        Object.values(basemaps).forEach(layer => map.removeLayer(layer));
        // Add selected basemap
        basemaps[selected].addTo(map);
      });
    });

    // Overlays layer toggles
    document.getElementById('chk-overlay-provinces').addEventListener('change', (e) => {
      if (e.target.checked) map.addLayer(provincesLayerGroup);
      else map.removeLayer(provincesLayerGroup);
    });
    document.getElementById('chk-overlay-districts').addEventListener('change', (e) => {
      if (e.target.checked) map.addLayer(districtsLayerGroup);
      else map.removeLayer(districtsLayerGroup);
    });
    document.getElementById('chk-overlay-municipalities').addEventListener('change', (e) => {
      if (e.target.checked) map.addLayer(municipalitiesLayerGroup);
      else map.removeLayer(municipalitiesLayerGroup);
    });
    document.getElementById('chk-overlay-tourism').addEventListener('change', (e) => {
      if (e.target.checked) map.addLayer(tourismLayerGroup);
      else map.removeLayer(tourismLayerGroup);
    });
  }

  // ==========================================
  // 4. DATA RETRIEVAL & PARSING
  // ==========================================
  async function fetchDatasets() {
    toggleLoadingOverlay(true, "Loading Geospatial Datasets...");
    
    try {
      // 1. Fetch Tourism Spots
      const tourismRes = await fetch('/api/geojson/tourism');
      tourismSpotsGeoJSON = await tourismRes.json();
      
      // Populate the target route selector and tourism layer
      populateRouteSelectDropdown();
      renderTourismSpots(tourismSpotsGeoJSON.features);
      
      // 2. Fetch Provinces Boundaries
      toggleLoadingOverlay(true, "Loading Province Boundaries (5.2MB)...");
      const provincesRes = await fetch('/api/geojson/provinces');
      provincesGeoJSON = await provincesRes.json();
      renderProvincesLayer();
      
      // 2b. Fetch Official Nepal Boundary for Masking + boundary checks
      const nepalBoundaryRes = await fetch('/api/geojson/nepal-boundary');
      const nepalBoundaryGeoJSON = await nepalBoundaryRes.json();
      // Store the first feature as a persistent turf polygon for click validation
      if (nepalBoundaryGeoJSON.features && nepalBoundaryGeoJSON.features.length > 0) {
        nepalBoundaryPolygon = nepalBoundaryGeoJSON.features[0];
      }
      generateNepalMask(nepalBoundaryGeoJSON);
      
      // 3. Fetch Districts Boundaries
      toggleLoadingOverlay(true, "Loading District Boundaries (1.2MB)...");
      const districtsRes = await fetch('/api/geojson/districts');
      districtsGeoJSON = await districtsRes.json();
      renderDistrictsLayer();
      populateDistrictDropdown('all');

      // 4. Fetch Municipalities (Local levels / Palikas)
      toggleLoadingOverlay(true, "Loading Municipality Boundaries (3.5MB)...");
      const municipalitiesRes = await fetch('/api/geojson/municipalities');
      municipalitiesGeoJSON = await municipalitiesRes.json();
      renderMunicipalitiesLayer();
      
      toggleLoadingOverlay(false);
    } catch (error) {
      console.error("Error loading Web GIS datasets:", error);
      toggleLoadingOverlay(true, "Error loading spatial data. Please refresh page.");
    }
  }

  function toggleLoadingOverlay(show, text = "") {
    const overlay = document.getElementById('loading-overlay');
    const loadingText = document.getElementById('loading-text');
    if (show) {
      loadingText.textContent = text;
      overlay.classList.remove('hidden');
    } else {
      overlay.classList.add('hidden');
    }
  }

  // ==========================================
  // 5. BOUNDARY RENDERING & STYLING
  // ==========================================
  
  // Render Provinces Overlay (Admin Level 1)
  function renderProvincesLayer() {
    if (!provincesGeoJSON) return;
    
    L.geoJSON(provincesGeoJSON, {
      style: {
        color: 'hsl(350, 70%, 50%)', // Red borders
        weight: 2.5,
        opacity: 0.85,
        fillColor: 'hsl(350, 70%, 50%)',
        fillOpacity: 0.03
      },
      onEachFeature: (feature, layer) => {
        const provCode = parseInt(feature.properties.ADM1_EN || feature.properties.PROVINCE);
        const name = PROVINCE_NAMES[provCode] || `Province ${provCode}`;
        
        layer.bindTooltip(`<strong>${name}</strong>`, {
          sticky: true,
          className: 'leaflet-boundary-tooltip'
        });
        
        layer.on({
          mouseover: (e) => {
            const l = e.target;
            l.setStyle({ fillOpacity: 0.12, weight: 3 });
          },
          mouseout: (e) => {
            const l = e.target;
            l.setStyle({ fillOpacity: 0.03, weight: 2.5 });
          }
        });
      }
    }).addTo(provincesLayerGroup);
  }

  // Generate an inverted polygon mask to dim regions outside Nepal
  function generateNepalMask(geojson) {
    try {
      // The official boundary GeoJSON already has the unioned polygon as the first feature
      const nepalFeature = geojson.features[0];
      if (!nepalFeature) return;

      const worldCoords = [
        [90, -180],
        [90, 180],
        [-90, 180],
        [-90, -180],
        [90, -180]
      ];

      let rings = [worldCoords];

      if (nepalFeature.geometry.type === 'Polygon') {
        const nepalRing = nepalFeature.geometry.coordinates[0].map(coord => [coord[1], coord[0]]);
        rings.push(nepalRing);
      } else if (nepalFeature.geometry.type === 'MultiPolygon') {
        nepalFeature.geometry.coordinates.forEach(polyCoords => {
          const nepalRing = polyCoords[0].map(coord => [coord[1], coord[0]]);
          rings.push(nepalRing);
        });
      }

      L.polygon(rings, {
        color: 'rgba(255, 255, 255, 0.1)', // Subtle glow line for Nepal's boundary
        weight: 1,
        fillColor: '#0a0f1e', // Dark slate mask matching index.css
        fillOpacity: 0.85,    // Dim surrounding areas strongly (India/China)
        interactive: false,
        className: 'nepal-outer-mask'
      }).addTo(map);
    } catch (e) {
      console.error("Error generating Nepal boundary mask:", e);
    }
  }

  // Render Districts Overlay (Admin Level 2)
  function renderDistrictsLayer() {
    if (!districtsGeoJSON) return;
    
    L.geoJSON(districtsGeoJSON, {
      style: {
        color: 'hsl(210, 80%, 50%)', // Blue borders
        weight: 1.5,
        dashArray: '4, 4',
        opacity: 0.8,
        fillOpacity: 0
      },
      onEachFeature: (feature, layer) => {
        const districtName = feature.properties.DISTRICT;
        const hq = feature.properties.HQ;
        const provCode = feature.properties.PROVINCE;
        const provName = PROVINCE_NAMES[provCode] || `Province ${provCode}`;
        
        layer.bindTooltip(`<strong>${districtName} District</strong><br>HQ: ${hq}<br>${provName}`, {
          sticky: true
        });
        
        layer.on({
          mouseover: (e) => {
            const l = e.target;
            l.setStyle({ fillOpacity: 0.08, weight: 2, color: 'hsl(210, 90%, 60%)' });
          },
          mouseout: (e) => {
            const l = e.target;
            l.setStyle({ fillOpacity: 0, weight: 1.5, color: 'hsl(210, 80%, 50%)' });
          }
        });
      }
    }).addTo(districtsLayerGroup);
  }

  // Render Municipalities/Local levels Overlay (Admin Level 3)
  function renderMunicipalitiesLayer() {
    if (!municipalitiesGeoJSON) return;
    
    L.geoJSON(municipalitiesGeoJSON, {
      style: {
        color: 'hsl(280, 70%, 60%)', // Purple borders
        weight: 0.8,
        opacity: 0.7,
        fillColor: 'hsl(280, 70%, 60%)',
        fillOpacity: 0.02
      },
      onEachFeature: (feature, layer) => {
        const name = feature.properties.locallevel_name;
        const nepName = feature.properties.locallevel_name_nepali;
        const type = feature.properties.locallevel_type;
        const district = feature.properties.district;
        const provCode = feature.properties.province;
        const provName = PROVINCE_NAMES[provCode] || `Province ${provCode}`;
        
        layer.bindTooltip(`<strong>${name} (${type})</strong><br>${nepName}<br>District: ${district}<br>${provName}`, {
          sticky: true
        });
        
        layer.on({
          mouseover: (e) => {
            const l = e.target;
            l.setStyle({ fillOpacity: 0.1, weight: 1.5, color: 'hsl(280, 80%, 70%)' });
          },
          mouseout: (e) => {
            const l = e.target;
            l.setStyle({ fillOpacity: 0.02, weight: 0.8, color: 'hsl(280, 70%, 60%)' });
          }
        });
      }
    }).addTo(municipalitiesLayerGroup);
  }

  // ==========================================
  // 6. TOURISM PINS & POPUPS
  // ==========================================
  function createCustomIcon(category, isSelected = false, isSuccessState = false) {
    let iconClass = 'fa-location-dot';
    let markerColorClass = 'marker-heritage';
    
    switch (category) {
      case 'Heritage':
        iconClass = 'fa-landmark';
        markerColorClass = 'marker-heritage';
        break;
      case 'Nature':
        iconClass = 'fa-tree';
        markerColorClass = 'marker-nature';
        break;
      case 'Religion':
        iconClass = 'fa-dharmachakra';
        markerColorClass = 'marker-religion';
        break;
      case 'Adventure':
        iconClass = 'fa-compass';
        markerColorClass = 'marker-adventure';
        break;
    }
    
    const highlightClass = isSelected ? ' selected-highlight' : '';
    const successClass = isSuccessState ? ' success-state' : '';
    
    return L.divIcon({
      html: `<div class="custom-leaflet-marker ${markerColorClass}${highlightClass}${successClass}"><i class="fa-solid ${iconClass}"></i></div>`,
      className: 'leaflet-custom-marker-parent',
      iconSize: [32, 32],
      iconAnchor: [16, 32],
      popupAnchor: [0, -32]
    });
  }

  // Render Tourism Spot Markers on map
  function renderTourismSpots(features) {
    // Clear existing markers
    tourismLayerGroup.clearLayers();
    activeTourismMarkers = [];
    
    features.forEach(spot => {
      const coords = spot.geometry.coordinates; // [lng, lat]
      const props = spot.properties;
      
      const isSelected = selectedSpotId && props.id === selectedSpotId;
      const markerIcon = createCustomIcon(props.category, isSelected, false);
      const marker = L.marker([coords[1], coords[0]], { icon: markerIcon });
      if (isSelected) {
        marker.setZIndexOffset(10000);
      }
      
      // Bind click handler to display details in the side panel
      marker.on('click', () => {
        selectTourismSpot(spot);
      });
      
      marker.addTo(tourismLayerGroup);
      activeTourismMarkers.push({
        marker: marker,
        feature: spot
      });
    });
  }

  // Select a tourism spot and render its details in the side panel
  function selectTourismSpot(spot) {
    const coords = spot.geometry.coordinates; // [lng, lat]
    const props = spot.properties;
    
    selectedSpotId = props.id;
    
    // Update Details Panel HTML
    const detailsPanel = document.getElementById('details-panel');
    const emptyState = detailsPanel.querySelector('.empty-state');
    const contentArea = detailsPanel.querySelector('.details-content');
    
    emptyState.classList.add('hidden');
    detailsPanel.classList.remove('details-panel-empty');
    contentArea.classList.remove('hidden');
    
    // Highlight the selected spot marker and remove highlight from others
    activeTourismMarkers.forEach(item => {
      const isSelected = item.feature.properties.id === props.id;
      const isSuccess = item.isInsideBuffer || false;
      const markerIcon = createCustomIcon(item.feature.properties.category, isSelected, isSuccess);
      item.marker.setIcon(markerIcon);
      
      if (isSelected) {
        item.marker.setZIndexOffset(10000);
        item.marker.setOpacity(1.0);
      } else {
        item.marker.setZIndexOffset(0);
        if (bufferLayer) {
          item.marker.setOpacity(item.isInsideBuffer ? 1.0 : 0.3);
        } else {
          item.marker.setOpacity(1.0);
        }
      }
    });
    
    // Invalidate map size and center on selection after DOM layout updates
    if (map) {
      setTimeout(() => {
        map.invalidateSize();
        map.setView([coords[1], coords[0]], 13);
      }, 50);
    }
    
    const facilitiesList = props.facilities.map(fac => `<span class="detail-facility-tag">${fac}</span>`).join('');
    
    contentArea.innerHTML = `
      <div class="details-body">
        <h2 class="details-title">${props.name}</h2>
        <div class="details-location">
          <i class="fa-solid fa-map-pin icon-color"></i>
          <span>${props.district} District, ${props.province_name}</span>
        </div>
        
        <div class="details-coords">
          <i class="fa-solid fa-location-crosshairs"></i>
          <span>${coords[0].toFixed(5)}° E, ${coords[1].toFixed(5)}° N</span>
        </div>
        
        <hr class="detail-divider">
        
        <h3 class="details-sub-title">Description</h3>
        <p class="details-desc">${props.description}</p>
        
        <h3 class="details-sub-title">Facilities &amp; Amenities</h3>
        <div class="details-facilities-tags">${facilitiesList}</div>
        
        <hr class="detail-divider">
        
        <div class="details-actions">
          <button class="btn primary-btn" onclick="window.setAsRouteTarget('${props.id}', ${coords[1]}, ${coords[0]}, '${props.name.replace(/'/g, "\\'")}')">
            <i class="fa-solid fa-route"></i> Navigate to Destination
          </button>
          
          <button class="btn secondary-btn" id="btn-deselect-spot">
            <i class="fa-solid fa-xmark"></i> Close Details
          </button>
        </div>
      </div>
    `;
    
    // Attach close details event
    document.getElementById('btn-deselect-spot').addEventListener('click', deselectTourismSpot);

    // Reset scroll to top and trigger a pop-in animation so the resize feels smooth
    const body = contentArea.querySelector('.details-body');
    if (body) {
      body.scrollTop = 0;
      // Brief scale + fade animation on new content
      body.style.transition = 'none';
      body.style.opacity = '0';
      body.style.transform = 'translateY(6px)';
      requestAnimationFrame(() => {
        body.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
        body.style.opacity = '1';
        body.style.transform = 'translateY(0)';
      });
    }

    // On mobile, collapse the main sidebar controller to give the details panel space
    if (window.innerWidth <= 768) {
      document.getElementById('sidebar-panel').classList.add('collapsed');
    }
  }

  // Clear current tourism spot selection and return to empty state
  function deselectTourismSpot() {
    selectedSpotId = null;
    const detailsPanel = document.getElementById('details-panel');
    const emptyState = detailsPanel.querySelector('.empty-state');
    const contentArea = detailsPanel.querySelector('.details-content');
    
    emptyState.classList.remove('hidden');
    detailsPanel.classList.add('details-panel-empty');
    contentArea.classList.add('hidden');
    contentArea.innerHTML = '';
    
    // On mobile, restore the main sidebar controller when details are closed
    if (window.innerWidth <= 768) {
      document.getElementById('sidebar-panel').classList.remove('collapsed');
    }
    
    // Remove highlights from all markers
    activeTourismMarkers.forEach(item => {
      const isSuccess = item.isInsideBuffer || false;
      const markerIcon = createCustomIcon(item.feature.properties.category, false, isSuccess);
      item.marker.setIcon(markerIcon);
      item.marker.setZIndexOffset(0);
      if (bufferLayer) {
        item.marker.setOpacity(item.isInsideBuffer ? 1.0 : 0.3);
      } else {
        item.marker.setOpacity(1.0);
      }
    });
    
    // Invalidate map size after DOM updates to expand full width
    if (map) {
      setTimeout(() => {
        map.invalidateSize();
      }, 50);
    }
  }

  // Global function for popup interaction link
  window.setAsRouteTarget = function(id, lat, lng, name) {
    const routeSelect = document.getElementById('route-target-select');
    routeSelect.value = id;
    
    // Auto trigger routing if origin is already set
    if (originCoords) {
      calculateOSRMRoute(originCoords, [lat, lng], getSelectedTravelMode());
    } else {
      // Prompt user to select origin
      alert(`Target set to ${name}. Now choose an origin point on the map to calculate the route.`);
    }
  };

  // ==========================================
  // 7. LOCATION & ORIGIN OPERATIONS
  // ==========================================

  // ── Boundary helpers ─────────────────────────────────────────────────────

  /**
   * Returns true if [lng, lat] is inside Nepal's official boundary polygon.
   */
  function isInsideNepal(lng, lat) {
    if (!nepalBoundaryPolygon) return true; // fail open if boundary not loaded
    return turf.booleanPointInPolygon(turf.point([lng, lat]), nepalBoundaryPolygon);
  }

  /**
   * Finds the nearest point on Nepal's border ring to the given [lng, lat].
   * Returns [lng, lat] of the snapped coordinate, or null if unavailable.
   * Samples the outer ring at a configurable density for performance.
   */
  function snapToNepalBorder(lng, lat) {
    if (!nepalBoundaryPolygon) return null;

    const geom = nepalBoundaryPolygon.geometry;
    // Handle both Polygon and MultiPolygon
    const outerRing = geom.type === 'Polygon'
      ? geom.coordinates[0]
      : geom.coordinates[0][0];

    if (!outerRing || outerRing.length === 0) return null;

    const clickPt = turf.point([lng, lat]);
    let minDist = Infinity;
    let nearest = null;

    // Sample every Nth vertex for performance (border has ~58k vertices)
    const STEP = 10;
    for (let i = 0; i < outerRing.length; i += STEP) {
      const candidate = turf.point(outerRing[i]);
      const dist = turf.distance(clickPt, candidate, { units: 'kilometers' });
      if (dist < minDist) {
        minDist = dist;
        nearest = outerRing[i]; // [lng, lat]
      }
    }
    return nearest; // [lng, lat] or null
  }

  /**
   * Shows a brief non-blocking toast notification for boundary violations.
   */
  function showBoundaryToast(message) {
    // Reuse existing toast if present, otherwise create one
    let toast = document.getElementById('boundary-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'boundary-toast';
      toast.style.cssText = [
        'position:fixed', 'bottom:24px', 'left:50%', 'transform:translateX(-50%)',
        'background:rgba(20,20,35,0.92)', 'color:#fff', 'padding:10px 20px',
        'border-radius:8px', 'font-size:13px', 'font-weight:500',
        'border:1px solid rgba(255,100,100,0.5)', 'box-shadow:0 4px 20px rgba(0,0,0,0.4)',
        'z-index:99999', 'pointer-events:none', 'transition:opacity 0.4s ease'
      ].join(';');
      document.body.appendChild(toast);
    }
    toast.textContent = `⚠️  ${message}`;
    toast.style.opacity = '1';
    clearTimeout(toast._hideTimer);
    toast._hideTimer = setTimeout(() => { toast.style.opacity = '0'; }, 3000);
  }

  // ── Set origin coordinate and marker ─────────────────────────────────────
  function setOrigin(lat, lng) {
    originCoords = [lat, lng];
    
    if (originMarker) {
      originMarker.setLatLng(originCoords);
    } else {
      const originIcon = L.divIcon({
        html: `<div class="custom-leaflet-marker marker-origin"><i class="fa-solid fa-house-chimney"></i></div>`,
        className: 'leaflet-custom-marker-parent',
        iconSize: [36, 36],
        iconAnchor: [18, 18]
      });
      originMarker = L.marker(originCoords, { icon: originIcon }).addTo(map);
    }
    
    // Update Sidebar
    const coordString = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    const coordCard = document.getElementById('origin-coords');
    const infoCard = document.getElementById('origin-info-card');
    
    coordCard.textContent = coordString;
    infoCard.className = "info-card success-state";
    
    // Enable analysis buttons
    document.getElementById('btn-find-nearest').disabled = false;
    document.getElementById('btn-draw-buffer').disabled = false;
    document.getElementById('btn-calculate-route').disabled = false;
  }

  // Detect location automatically via Geolocation API
  function detectGPS() {
    if (!navigator.geolocation) {
      alert("Geolocation is not supported by your browser");
      return;
    }
    
    toggleLoadingOverlay(true, "Locating your GPS Position...");
    
    navigator.geolocation.getCurrentPosition(
      (position) => {
        toggleLoadingOverlay(false);
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        
        // Use real polygon check (not just bbox) to validate GPS position
        if (isInsideNepal(lng, lat)) {
          setOrigin(lat, lng);
          map.setView([lat, lng], 11);
        } else {
          // GPS is outside Nepal's actual boundary — snap to border
          const snapped = snapToNepalBorder(lng, lat);
          if (snapped) {
            showBoundaryToast('GPS position is outside Nepal. Snapped to nearest border point.');
            setOrigin(snapped[1], snapped[0]);
            map.setView([snapped[1], snapped[0]], 10);
          } else {
            alert('Your GPS position is outside Nepal. Defaulting to Kathmandu.');
            setOrigin(27.7042, 85.3073);
            map.setView([27.7042, 85.3073], 12);
          }
        }
      },
      (error) => {
        toggleLoadingOverlay(false);
        console.warn(`Geolocation error (${error.code}): ${error.message}`);
        alert("Unable to detect GPS position. Mocking location at Kathmandu Durbar Square.");
        setOrigin(27.7042, 85.3073);
        map.setView([27.7042, 85.3073], 12);
      },
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
    );
  }

  // ==========================================
  // 8. DROPDOWN POPULATION & FILTERS
  // ==========================================
  
  // Populate target selector for travel modes
  function populateRouteSelectDropdown() {
    const routeSelect = document.getElementById('route-target-select');
    
    // Clear existing options except default
    routeSelect.innerHTML = '<option value="" disabled selected>Choose a destination...</option>';
    
    // Sort spots alphabetically
    const sortedFeatures = [...tourismSpotsGeoJSON.features].sort((a, b) => 
      a.properties.name.localeCompare(b.properties.name)
    );
    
    sortedFeatures.forEach(feat => {
      const option = document.createElement('option');
      option.value = feat.properties.id;
      option.textContent = `${feat.properties.name} (${feat.properties.district})`;
      routeSelect.appendChild(option);
    });
  }

  // Populate districts list based on Province Selection
  function populateDistrictDropdown(provinceVal) {
    const districtSelect = document.getElementById('filter-district');
    districtSelect.innerHTML = '<option value="all">All Districts</option>';
    
    if (!districtsGeoJSON) return;
    
    // Collect all districts matching the filter
    const districts = [];
    districtsGeoJSON.features.forEach(feat => {
      const props = feat.properties;
      if (provinceVal === 'all' || parseInt(props.PROVINCE) === parseInt(provinceVal)) {
        districts.push(props.DISTRICT);
      }
    });
    
    // Sort alphabetically and add options
    districts.sort().forEach(dist => {
      const option = document.createElement('option');
      option.value = dist.toUpperCase();
      option.textContent = dist.charAt(0) + dist.slice(1).toLowerCase();
      districtSelect.appendChild(option);
    });
  }

  // Search, category, and administrative filter controller
  function applyFilters() {
    if (!tourismSpotsGeoJSON) return;
    
    const searchText = document.getElementById('search-input').value.toLowerCase().trim();
    const provinceVal = document.getElementById('filter-province').value;
    const districtVal = document.getElementById('filter-district').value;
    
    const filteredFeatures = tourismSpotsGeoJSON.features.filter(feat => {
      const props = feat.properties;
      
      // 1. Text Search Filter
      const matchesSearch = props.name.toLowerCase().includes(searchText) || 
                            props.description.toLowerCase().includes(searchText) ||
                            props.district.toLowerCase().includes(searchText);
                            
      // 2. Category tag filter
      const matchesCategory = (activeCategory === 'all' || props.category === activeCategory);
      
      // 3. Province dropdown filter
      const matchesProvince = (provinceVal === 'all' || parseInt(props.province) === parseInt(provinceVal));
      
      // 4. District dropdown filter
      const matchesDistrict = (districtVal === 'all' || props.district.toUpperCase() === districtVal.toUpperCase());
      
      return matchesSearch && matchesCategory && matchesProvince && matchesDistrict;
    });
    
    // Re-render matching spots
    renderTourismSpots(filteredFeatures);
    
    // If selected spot gets filtered out, deselect it
    if (selectedSpotId && !filteredFeatures.some(f => f.properties.id === selectedSpotId)) {
      deselectTourismSpot();
    }
    
    // Update target route dropdown options to match currently filtered set
    updateRouteDropdownMatchingFilters(filteredFeatures);
    
    // Automatically fit bounds and restrict zoom to selected province/district
    fitMapToSelection(provinceVal, districtVal);
  }

  // Fits map bounds to selected area and restricts zooming/panning
  function fitMapToSelection(provinceVal, districtVal) {
    if (!map) return;

    // 1. If a district is chosen
    if (districtVal !== 'all' && districtsGeoJSON) {
      const match = districtsGeoJSON.features.find(
        f => f.properties.DISTRICT.toUpperCase() === districtVal.toUpperCase()
      );
      if (match) {
        const bounds = L.geoJSON(match).getBounds();
        map.fitBounds(bounds, { padding: [30, 30] });
        
        // Restrict boundary panning and zoom range to keep focus in district
        map.setMaxBounds(bounds.pad(0.2));
        const currentZoom = map.getBoundsZoom(bounds);
        map.setMinZoom(Math.max(6, currentZoom - 1));
        return;
      }
    }

    // 2. If a province is chosen
    if (provinceVal !== 'all' && provincesGeoJSON) {
      const match = provincesGeoJSON.features.find(
        f => parseInt(f.properties.ADM1_EN || f.properties.PROVINCE) === parseInt(provinceVal)
      );
      if (match) {
        const bounds = L.geoJSON(match).getBounds();
        map.fitBounds(bounds, { padding: [30, 30] });
        
        // Restrict boundary panning and zoom range to keep focus in province
        map.setMaxBounds(bounds.pad(0.15));
        const currentZoom = map.getBoundsZoom(bounds);
        map.setMinZoom(Math.max(6, currentZoom - 1));
        return;
      }
    }

    // 3. Reset boundaries and zoom limits to default when 'All' is selected
    map.setMaxBounds([
      [26.347, 80.051],
      [30.447, 88.201]
    ]);
    map.setMinZoom(7);
    
    if (provinceVal === 'all' && districtVal === 'all') {
      map.setView([28.3949, 84.1240], 7);
    }
  }

  function updateRouteDropdownMatchingFilters(features) {
    const routeSelect = document.getElementById('route-target-select');
    const currentValue = routeSelect.value;
    
    routeSelect.innerHTML = '<option value="" disabled selected>Choose a destination...</option>';
    
    // Sort
    const sorted = [...features].sort((a, b) => a.properties.name.localeCompare(b.properties.name));
    
    sorted.forEach(feat => {
      const option = document.createElement('option');
      option.value = feat.properties.id;
      option.textContent = `${feat.properties.name} (${feat.properties.district})`;
      routeSelect.appendChild(option);
    });
    
    // Restore previous selection if still in filtered list
    if (features.some(f => f.properties.id === currentValue)) {
      routeSelect.value = currentValue;
    }
  }

  // ==========================================
  // 9. TURF.JS SPATIAL UTILITIES
  // ==========================================
  
  // Spatial Tool A: Find Nearest Location
  function findNearestAttraction() {
    if (!originCoords || !tourismSpotsGeoJSON) return;
    
    // Clear previous routes/buffers
    clearAllTemporaryLayers();
    
    // Target feature set (we search among currently visible/filtered spots)
    const targetFeatures = activeTourismMarkers.map(item => item.feature);
    
    if (targetFeatures.length === 0) {
      alert("No tourism spots matching current filters to query!");
      return;
    }
    
    // Convert origin coords to Turf Point [lng, lat]
    const originTurfPoint = turf.point([originCoords[1], originCoords[2] || originCoords[0]]);
    
    // Create FeatureCollection of candidate tourism spots
    const targetCollection = turf.featureCollection(targetFeatures);
    
    // Find closest spot
    const nearest = turf.nearestPoint(originTurfPoint, targetCollection);
    const distanceKm = nearest.properties.distanceToPoint;
    const destName = nearest.properties.name;
    const destCoords = nearest.geometry.coordinates; // [lng, lat]
    
    // Show results panel
    const resultCard = document.getElementById('nearest-result-card');
    resultCard.innerHTML = `
      <h4><i class="fa-solid fa-award"></i> Nearest Spot Found!</h4>
      <div class="result-stat">
        <span class="result-label">Name:</span>
        <span class="result-value">${destName}</span>
      </div>
      <div class="result-stat">
        <span class="result-label">Category:</span>
        <span class="result-value">${nearest.properties.category}</span>
      </div>
      <div class="result-stat">
        <span class="result-label">District:</span>
        <span class="result-value">${nearest.properties.district}</span>
      </div>
      <div class="result-stat">
        <span class="result-label">Straight-Line Distance:</span>
        <span class="result-value" style="color: var(--accent-primary); font-weight:700;">${distanceKm.toFixed(2)} km</span>
      </div>
      <p class="tool-desc" style="margin-top:6px;">Plotting walking/driving routes to destination below...</p>
    `;
    resultCard.classList.remove('hidden');
    
    // Trigger OSRM Routing automatically to the nearest spot
    const travelMode = getSelectedTravelMode();
    calculateOSRMRoute(originCoords, [destCoords[1], destCoords[0]], travelMode);
    
    // Display details in the right-hand panel
    selectTourismSpot(nearest);
  }

  // Spatial Tool B: Buffer Analysis
  function runBufferAnalysis() {
    if (!originCoords) return;
    
    // Clear previous buffers/routes
    clearAllTemporaryLayers();
    
    const radiusVal = parseInt(document.getElementById('buffer-radius-slider').value);
    
    // Create Turf point [lng, lat]
    const originTurf = turf.point([originCoords[1], originCoords[0]]);
    
    // Generate Buffer Polygon using Turf.js
    const bufferGeoJSON = turf.buffer(originTurf, radiusVal, { units: 'kilometers' });
    
    // Draw buffer layer on Leaflet
    bufferLayer = L.geoJSON(bufferGeoJSON, {
      style: {
        color: 'var(--accent-secondary)',
        weight: 1.5,
        fillColor: 'var(--accent-secondary)',
        fillOpacity: 0.15,
        dashArray: '3, 6'
      }
    }).addTo(map);
    
    // Check which tourism spots fall inside this buffer
    const spotsInside = [];
    
    activeTourismMarkers.forEach(item => {
      const spotPoint = turf.point(item.feature.geometry.coordinates);
      const isInside = turf.booleanPointInPolygon(spotPoint, bufferGeoJSON);
      item.isInsideBuffer = isInside;
      
      const isSelected = selectedSpotId && item.feature.properties.id === selectedSpotId;
      const markerIcon = createCustomIcon(item.feature.properties.category, isSelected, isInside);
      item.marker.setIcon(markerIcon);
      
      if (isInside) {
        spotsInside.push(item.feature);
        item.marker.setOpacity(1.0);
      } else {
        item.marker.setOpacity(0.3);
      }
    });
    
    // Display results in sidebar
    const resultCard = document.getElementById('buffer-result-card');
    document.getElementById('btn-clear-buffer').classList.remove('hidden');
    
    if (spotsInside.length === 0) {
      resultCard.innerHTML = `
        <h4><i class="fa-solid fa-circle-exclamation"></i> Buffer Summary</h4>
        <p class="tool-desc" style="color: var(--accent-danger);">No attractions found within ${radiusVal} km of your origin point.</p>
      `;
    } else {
      const itemsListHTML = spotsInside.map(spot => `
        <li style="margin-bottom: 6px; list-style: none;">
          <a href="#" class="buffer-spot-link" onclick="window.selectBufferSpot('${spot.properties.id}'); return false;">
            <i class="fa-solid fa-map-location-dot" style="color: var(--accent-primary); margin-right: 6px;"></i>
            <strong>${spot.properties.name}</strong> <span style="font-size: 9px; color: var(--text-dim);">(${spot.properties.category})</span>
          </a>
        </li>
      `).join('');
      
      resultCard.innerHTML = `
        <h4><i class="fa-solid fa-list-check"></i> Buffer Summary</h4>
        <div class="result-stat">
          <span class="result-label">Radius:</span>
          <span class="result-value">${radiusVal} km</span>
        </div>
        <div class="result-stat">
          <span class="result-label">Spots Found:</span>
          <span class="result-value" style="color:var(--accent-primary); font-weight:700;">${spotsInside.length} spot(s)</span>
        </div>
        <div class="result-stat" style="margin-top:6px; font-weight:600;">
          <span class="result-label">Destinations:</span>
        </div>
        <ul style="font-size: 11px; color: var(--text-muted); max-height:100px; overflow-y:auto; padding-top:2px; padding-left: 0;">
          ${itemsListHTML}
        </ul>
      `;
    }
    resultCard.classList.remove('hidden');
    
    // Fit map bounds to buffer polygon
    map.fitBounds(bufferLayer.getBounds(), { padding: [20, 20] });
  }

  function clearBuffer() {
    if (bufferLayer) {
      map.removeLayer(bufferLayer);
      bufferLayer = null;
    }
    
    // Reset marker opacities and remove highlights
    activeTourismMarkers.forEach(item => {
      item.isInsideBuffer = undefined;
      item.marker.setOpacity(1.0);
      
      const isSelected = selectedSpotId && item.feature.properties.id === selectedSpotId;
      const markerIcon = createCustomIcon(item.feature.properties.category, isSelected, false);
      item.marker.setIcon(markerIcon);
      if (isSelected) {
        item.marker.setZIndexOffset(10000);
      } else {
        item.marker.setZIndexOffset(0);
      }
    });
    
    document.getElementById('btn-clear-buffer').classList.add('hidden');
    document.getElementById('buffer-result-card').classList.add('hidden');
  }

  // ==========================================
  // 10. OSRM ROUTING OPERATIONS
  // ==========================================
  function getSelectedTravelMode() {
    const selected = document.querySelector('input[name="travel-mode"]:checked');
    return selected ? selected.value : 'driving';
  }

  // Calculate route from Sidebar dropdown targets
  function calculateRouteFromSidebar() {
    if (!originCoords) return;
    
    const targetId = document.getElementById('route-target-select').value;
    if (!targetId) {
      alert("Please select a target destination from the dropdown first.");
      return;
    }
    
    // Find matching spot
    const targetSpot = tourismSpotsGeoJSON.features.find(f => f.properties.id === targetId);
    if (!targetSpot) return;
    
    const targetCoords = [targetSpot.geometry.coordinates[1], targetSpot.geometry.coordinates[0]]; // [lat, lng]
    const travelMode = getSelectedTravelMode();
    
    calculateOSRMRoute(originCoords, targetCoords, travelMode);
    
    // Display details in the right-hand panel
    selectTourismSpot(targetSpot);
  }

  async function calculateOSRMRoute(startLatLon, endLatLon, mode) {
    // Clear previous route
    if (routeLayer) {
      map.removeLayer(routeLayer);
      routeLayer = null;
    }
    
    toggleLoadingOverlay(true, `Querying OSRM Routes...`);
    
    // Format: lng,lat;lng,lat
    const coordinatesString = `${startLatLon[1]},${startLatLon[0]};${endLatLon[1]},${endLatLon[0]}`;
    const urlDriving = `https://router.project-osrm.org/route/v1/driving/${coordinatesString}?overview=full&geometries=geojson`;
    const urlFoot    = `https://router.project-osrm.org/route/v1/foot/${coordinatesString}?overview=full&geometries=geojson`;
    
    try {
      // Fetch both profiles in parallel — driving and foot are completely independent OSRM profiles
      const [responseDriving, responseFoot] = await Promise.all([
        fetch(urlDriving).catch(e => { console.warn("OSRM driving error:", e); return null; }),
        fetch(urlFoot).catch(e =>    { console.warn("OSRM foot error:", e);    return null; })
      ]);
      
      let dataDriving = null;
      let dataFoot    = null;
      
      if (responseDriving && responseDriving.ok) dataDriving = await responseDriving.json();
      if (responseFoot    && responseFoot.ok)    dataFoot    = await responseFoot.json();
      
      toggleLoadingOverlay(false);
      
      const hasDriving = dataDriving && dataDriving.code === 'Ok' && dataDriving.routes?.length > 0;
      const hasFoot    = dataFoot    && dataFoot.code    === 'Ok' && dataFoot.routes?.length    > 0;
      
      if (!hasDriving && !hasFoot) {
        alert("Unable to calculate road routes between coordinates. Displaying straight-line fallback.");
        drawStraightLineFallback(startLatLon, endLatLon);
        return;
      }
      
      const drivingRoute = hasDriving ? dataDriving.routes[0] : null;
      const footRoute    = hasFoot    ? dataFoot.routes[0]    : null;
      
      // ── Vehicle metrics: OSRM driving profile (road network) ─────────────
      let vehicleDistanceKm  = 0;
      let vehicleDurationMin = 0;
      if (drivingRoute) {
        vehicleDistanceKm  = drivingRoute.distance / 1000;
        vehicleDurationMin = drivingRoute.duration / 60;   // OSRM uses road speed limits
      } else {
        // Driving profile offline — estimate from foot distance with vehicle road factor
        vehicleDistanceKm  = (footRoute.distance / 1000) * 1.5;
        vehicleDurationMin = (vehicleDistanceKm / 35) * 60;
      }
      
      // ── Walking metrics: OSRM foot profile (foot-accessible paths only) ───
      // The foot profile routes exclusively over footways, trails, and pedestrian
      // paths — a genuinely different network from the driving profile.
      // We apply a Nepal mountain-terrain speed of 4 km/h and a 1.2x winding
      // factor for switchbacks and unpaved trails to produce realistic estimates.
      const WALK_SPEED_KMH   = 4.0;  // realistic Nepal trail speed
      const WALK_WIND_FACTOR = 1.2;  // extra distance due to mountain switchbacks
      let walkingDistanceKm  = 0;
      let walkingDurationMin = 0;
      if (footRoute) {
        walkingDistanceKm  = (footRoute.distance / 1000) * WALK_WIND_FACTOR;
        walkingDurationMin = (walkingDistanceKm / WALK_SPEED_KMH) * 60;
      } else {
        // Foot profile offline — estimate from driving distance
        walkingDistanceKm  = (drivingRoute.distance / 1000) * 1.3;
        walkingDurationMin = (walkingDistanceKm / WALK_SPEED_KMH) * 60;
      }
      
      // ── Select geometry to render based on chosen mode ────────────────────
      let activeRouteGeoJSON = null;
      if      (mode === 'foot'    && footRoute)    activeRouteGeoJSON = footRoute.geometry;
      else if (mode === 'driving' && drivingRoute) activeRouteGeoJSON = drivingRoute.geometry;
      else    activeRouteGeoJSON = footRoute?.geometry ?? drivingRoute?.geometry ?? null;
      
      // ── Render route polyline ─────────────────────────────────────────────
      if (activeRouteGeoJSON) {
        routeLayer = L.geoJSON(activeRouteGeoJSON, {
          style: {
            color:     mode === 'foot' ? 'var(--accent-warning)' : 'var(--accent-secondary)',
            weight:    5,
            opacity:   0.9,
            lineCap:   'round',
            lineJoin:  'round'
          }
        }).addTo(map);
        
        // ── Single fitBounds: route geometry + both endpoint markers ──────
        // Extending the route bounds to cover origin and destination markers
        // guarantees the full journey is visible without manual panning.
        const journeyBounds = routeLayer.getBounds()
          .extend(L.latLng(startLatLon[0], startLatLon[1]))
          .extend(L.latLng(endLatLon[0],   endLatLon[1]));
        map.fitBounds(journeyBounds, { padding: [70, 70], maxZoom: 14, animate: true });
      }
      
      // ── Update Routing Panel UI ───────────────────────────────────────────
      const resultCard = document.getElementById('routing-result-card');
      document.getElementById('btn-clear-route').classList.remove('hidden');
      
      function formatDuration(min) {
        if (min > 60) {
          return `${Math.floor(min / 60)} hr ${Math.round(min % 60)} mins`;
        }
        return `${Math.round(min)} mins`;
      }
      
      const activeDistanceKm = mode === 'foot' ? walkingDistanceKm : vehicleDistanceKm;
      
      resultCard.innerHTML = `
        <h4><i class="fa-solid fa-route"></i> Route Calculated!</h4>
        <div class="result-stat">
          <span class="result-label">Selected Mode:</span>
          <span class="result-value">${mode === 'foot'
            ? '<i class="fa-solid fa-person-walking"></i> Walking'
            : '<i class="fa-solid fa-car"></i> Vehicle'}</span>
        </div>
        <div class="result-stat">
          <span class="result-label">Route Distance:</span>
          <span class="result-value" style="color:var(--accent-primary); font-weight:700;">
            ${activeDistanceKm.toFixed(1)} km
          </span>
        </div>
        <hr class="detail-divider" style="margin: 6px 0;">
        <div class="result-stat">
          <span class="result-label"><i class="fa-solid fa-car"></i> Vehicle Route:</span>
          <span class="result-value" style="color: var(--accent-secondary); font-weight: 600;">
            ${drivingRoute
              ? `${vehicleDistanceKm.toFixed(1)} km &nbsp;·&nbsp; ${formatDuration(vehicleDurationMin)}`
              : 'Route unavailable'}
          </span>
        </div>
        <div class="result-stat">
          <span class="result-label"><i class="fa-solid fa-person-walking"></i> Walking Route:</span>
          <span class="result-value" style="color: var(--accent-warning); font-weight: 600;">
            ${footRoute
              ? `${walkingDistanceKm.toFixed(1)} km &nbsp;·&nbsp; ${formatDuration(walkingDurationMin)}`
              : 'Route unavailable'}
          </span>
        </div>
        <p class="tool-desc" style="margin-top:8px; color: var(--text-muted); font-size:10px;">
          Vehicle: OSRM driving profile (road network, speed-limit based).
          Walking: OSRM foot profile (footways &amp; trails only) · 4 km/h mountain speed.
        </p>
      `;
      resultCard.classList.remove('hidden');
      
    } catch (error) {
      toggleLoadingOverlay(false);
      console.error("OSRM API error:", error);
      alert("Error contacting OSRM service. Plotting straight-line fallback.");
      drawStraightLineFallback(startLatLon, endLatLon);
    }
  }

  function drawStraightLineFallback(start, end) {
    // Turf distance straight line
    const startPoint = turf.point([start[1], start[0]]);
    const endPoint = turf.point([end[1], end[0]]);
    const distanceKm = turf.distance(startPoint, endPoint);
    
    // Draw straight polyline on Leaflet
    routeLayer = L.polyline([start, end], {
      color: 'var(--accent-danger)',
      weight: 3,
      dashArray: '5, 8',
      opacity: 0.8
    }).addTo(map);
    
    // Fit map to show both origin and destination with comfortable padding
    const fallbackBounds = L.latLngBounds(
      L.latLng(start[0], start[1]),
      L.latLng(end[0], end[1])
    );
    map.fitBounds(fallbackBounds, { padding: [80, 80], maxZoom: 14, animate: true, duration: 0.8 });
    
    const resultCard = document.getElementById('routing-result-card');
    document.getElementById('btn-clear-route').classList.remove('hidden');
    
    // Calculate walking and driving times independently using distinct algorithms over straight line distance
    // Applying winding factors typical for Nepal's mountainous terrain
    const walkingDistanceEstimated = distanceKm * 1.25;
    const vehicleDistanceEstimated = distanceKm * 1.5;
    
    const walkingDurationMin = (walkingDistanceEstimated / 4.5) * 60;
    const vehicleDurationMin = (vehicleDistanceEstimated / 35) * 60;
    
    function formatDuration(durationMin) {
      if (durationMin > 60) {
        const hrs = Math.floor(durationMin / 60);
        const mins = Math.round(durationMin % 60);
        return `${hrs} hr ${mins} mins`;
      }
      return `${Math.round(durationMin)} mins`;
    }
    
    const vehicleTimeStr = formatDuration(vehicleDurationMin);
    const walkingTimeStr = formatDuration(walkingDurationMin);
    
    resultCard.innerHTML = `
      <h4><i class="fa-solid fa-circle-nodes"></i> Line Distance (Fallback)</h4>
      <p class="tool-desc" style="color: var(--accent-warning); margin-bottom: 6px;">OSRM routing offline or unreachable. Using winding-factor algorithms.</p>
      <div class="result-stat">
        <span class="result-label">Straight-Line Distance:</span>
        <span class="result-value" style="color:var(--accent-danger); font-weight:700;">${distanceKm.toFixed(2)} km</span>
      </div>
      
      <hr class="detail-divider" style="margin: 6px 0;">
      
      <div class="result-stat">
        <span class="result-label"><i class="fa-solid fa-car"></i> Est. Vehicle Route:</span>
        <span class="result-value" style="color: var(--accent-secondary); font-weight: 600;">${vehicleDistanceEstimated.toFixed(1)} km / ${vehicleTimeStr}</span>
      </div>
      <div class="result-stat">
        <span class="result-label"><i class="fa-solid fa-person-walking"></i> Est. Walking Route:</span>
        <span class="result-value" style="color: var(--accent-warning); font-weight: 600;">${walkingDistanceEstimated.toFixed(1)} km / ${walkingTimeStr}</span>
      </div>
    `;
    resultCard.classList.remove('hidden');
    map.fitBounds(routeLayer.getBounds(), { padding: [40, 40] });
  }

  function clearRoute() {
    if (routeLayer) {
      map.removeLayer(routeLayer);
      routeLayer = null;
    }
    document.getElementById('btn-clear-route').classList.add('hidden');
    document.getElementById('routing-result-card').classList.add('hidden');
  }

  // Helper clear function
  function clearAllTemporaryLayers() {
    clearRoute();
    clearBuffer();
    // Clear nearest finder results card
    document.getElementById('nearest-result-card').classList.add('hidden');
  }

  // Initial setup call
  init();
});
