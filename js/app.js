/**
 * Skavtska karta - Scout Map Application
 * Static web application for scout use with Leaflet
 */

// ============================================
// Configuration
// ============================================

const CONFIG = {
    center: [46.1512, 14.9955], // Slovenia center
    zoom: 8,
    storageKey: 'skavtska-karta-data'
};

// ============================================
// Map Layers Definition
// ============================================

// Base layers
const BASE_LAYERS = {
    osm: {
        name: 'OpenStreetMap',
        layer: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            subdomains: 'abc',
            attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        })
    },
    otm: {
        name: 'OpenTopoMap',
        layer: L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
            maxZoom: 17,
            subdomains: 'abc',
            attribution: '© <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)'
        })
    },
    // Thunderforest Outdoors - odlična topografska karta
    outdoors: {
        name: 'Thunderforest Outdoors',
        layer: L.tileLayer('https://{s}.tile.thunderforest.com/outdoors/{z}/{x}/{y}.png?apikey=6170aad10dfd42a38d4d8c709a536f38', {
            maxZoom: 18,
            subdomains: 'abc',
            attribution: '© <a href="https://www.thunderforest.com/">Thunderforest</a>, © OSM'
        })
    },
    // ESRI World Topo
    esriTopo: {
        name: 'ESRI Topo',
        layer: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', {
            maxZoom: 19,
            attribution: '© Esri, HERE, Garmin, USGS'
        })
    },
    // ESRI Satellite
    esriSat: {
        name: 'Satelitski posnetek',
        layer: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            maxZoom: 19,
            attribution: '© Esri, Maxar, Earthstar'
        })
    }
};

// Planinske poti - vir: Waymarked Trails (waymarkedtrails.org)
// Podatki temeljijo na OpenStreetMap relacijah s hiking/walking routing
const OVERLAY_LAYERS = {
    hiking: {
        name: 'Planinske poti',
        source: 'Waymarked Trails (waymarkedtrails.org)',
        layer: L.tileLayer('https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png', {
            maxZoom: 18,
            opacity: 0.7,
            attribution: '© <a href="https://waymarkedtrails.org">Waymarked Trails</a> (podatki: OSM)'
        })
    }
};

// ============================================
// Application State
// ============================================

let map;
let drawnItems;
let currentTool = 'move';
let currentDrawHandler = null;
let measureLayer = null;
let measurePoints = [];
let layerHistory = []; // Track layer addition order for "delete last"

// Default drawing style
let drawStyle = {
    color: '#3388ff',
    weight: 3
};

// Pending click handler for adding point/text
let pendingClickHandler = null;

// Marker icons/styles
const MARKER_STYLES = {
    default: { icon: '📍', color: '#e74c3c', name: 'Privzeto' },
    camp: { icon: '⛺', color: '#27ae60', name: 'Tabor' },
    flag: { icon: '🚩', color: '#e74c3c', name: 'Zastava' },
    star: { icon: '⭐', color: '#f1c40f', name: 'Zvezda' },
    info: { icon: 'ℹ️', color: '#3498db', name: 'Info' },
    warning: { icon: '⚠️', color: '#e67e22', name: 'Opozorilo' },
    water: { icon: '💧', color: '#3498db', name: 'Voda' },
    food: { icon: '🍽️', color: '#9b59b6', name: 'Hrana' },
    shelter: { icon: '🏠', color: '#795548', name: 'Zavetje' },
    tree: { icon: '🌲', color: '#27ae60', name: 'Drevo' },
    mountain: { icon: '⛰️', color: '#607d8b', name: 'Gora' },
    fire: { icon: '🔥', color: '#e74c3c', name: 'Ogenj' },
    cross: { icon: '✝️', color: '#333', name: 'Križ' },
    circle: { icon: '⚫', color: '#333', name: 'Krog' }
};

// ============================================
// Initialization
// ============================================

document.addEventListener('DOMContentLoaded', init);

function init() {
    initMap();
    initLayers();
    initDrawing();
    initEventListeners();
    loadFromStorage();
    updateStyleOptions();
}

function initMap() {
    map = L.map('map', {
        center: CONFIG.center,
        zoom: CONFIG.zoom
    });

    // Add default base layer
    BASE_LAYERS.osm.layer.addTo(map);

    // Initialize drawn items layer
    drawnItems = new L.FeatureGroup();
    map.addLayer(drawnItems);

    // Add scale control (for print)
    L.control.scale({
        metric: true,
        imperial: false,
        position: 'bottomleft'
    }).addTo(map);
}

function initLayers() {
    // Base layer radio buttons
    document.querySelectorAll('input[name="base-layer"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            // Remove all base layers
            Object.values(BASE_LAYERS).forEach(bl => {
                if (map.hasLayer(bl.layer)) {
                    map.removeLayer(bl.layer);
                }
            });
            // Add selected base layer
            const selected = BASE_LAYERS[e.target.value];
            if (selected) {
                selected.layer.addTo(map);
            }
        });
    });

    // Overlay layer checkboxes
    document.getElementById('overlay-hiking').addEventListener('change', (e) => {
        if (e.target.checked) {
            OVERLAY_LAYERS.hiking.layer.addTo(map);
        } else {
            map.removeLayer(OVERLAY_LAYERS.hiking.layer);
        }
    });
}

// ============================================
// Drawing Tools
// ============================================

function initDrawing() {
    // Tool button listeners
    document.querySelectorAll('.tool-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            selectTool(btn.dataset.tool);
        });
    });
}

function selectTool(tool) {
    // Cancel any active drawing
    if (currentDrawHandler) {
        currentDrawHandler.disable();
        currentDrawHandler = null;
    }

    // Remove pending click handler
    if (pendingClickHandler) {
        map.off('click', pendingClickHandler);
        pendingClickHandler = null;
    }

    // Clear measure mode
    if (measureLayer) {
        map.removeLayer(measureLayer);
        measureLayer = null;
        measurePoints = [];
        map.off('click', onMeasureClick);
    }

    // Reset cursor
    map.getContainer().style.cursor = '';

    // Update UI
    document.querySelectorAll('.tool-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tool === tool);
    });

    currentTool = tool;

    // Show/hide style options
    const styleOptions = document.getElementById('style-options');
    styleOptions.style.display = (tool === 'polyline' || tool === 'polygon') ? 'block' : 'none';

    // Handle tool selection
    switch (tool) {
        case 'move':
            map.dragging.enable();
            break;
        case 'measure':
            startMeasure();
            break;
        case 'marker':
            startMarkerMode();
            break;
        case 'polyline':
            startPolyline();
            break;
        case 'polygon':
            startPolygon();
            break;
        case 'text':
            startTextMode();
            break;
    }
}

// ============================================
// Marker Mode - Click first, then modal
// ============================================

function startMarkerMode() {
    map.getContainer().style.cursor = 'crosshair';
    map.dragging.enable();

    pendingClickHandler = function(e) {
        showPointModal(e.latlng);
    };
    map.on('click', pendingClickHandler);
}

function startTextMode() {
    map.getContainer().style.cursor = 'crosshair';
    map.dragging.enable();

    pendingClickHandler = function(e) {
        showTextModal(e.latlng);
    };
    map.on('click', pendingClickHandler);
}

// ============================================
// Polyline and Polygon - Fix color timing
// ============================================

function startPolyline() {
    // Read current style at the moment of starting
    const currentColor = document.getElementById('stroke-color').value;
    const currentWeight = parseInt(document.getElementById('stroke-width').value);

    drawStyle.color = currentColor;
    drawStyle.weight = currentWeight;

    currentDrawHandler = new L.Draw.Polyline(map, {
        shapeOptions: {
            color: currentColor,
            weight: currentWeight
        }
    });
    currentDrawHandler.enable();
}

function startPolygon() {
    // Read current style at the moment of starting
    const currentColor = document.getElementById('stroke-color').value;
    const currentWeight = parseInt(document.getElementById('stroke-width').value);

    drawStyle.color = currentColor;
    drawStyle.weight = currentWeight;

    currentDrawHandler = new L.Draw.Polygon(map, {
        shapeOptions: {
            color: currentColor,
            weight: currentWeight,
            fillColor: currentColor,
            fillOpacity: 0.3
        }
    });
    currentDrawHandler.enable();
}

// ============================================
// Measurement Tool
// ============================================

function startMeasure() {
    measurePoints = [];
    measureLayer = L.layerGroup().addTo(map);

    map.on('click', onMeasureClick);
    map.getContainer().style.cursor = 'crosshair';
}

function onMeasureClick(e) {
    if (currentTool !== 'measure') return;

    measurePoints.push(e.latlng);

    // Add marker
    L.circleMarker(e.latlng, {
        radius: 5,
        color: '#ff6600',
        fillColor: '#ff6600',
        fillOpacity: 1
    }).addTo(measureLayer);

    if (measurePoints.length > 1) {
        // Draw line between last two points
        const lastTwo = measurePoints.slice(-2);
        L.polyline(lastTwo, {
            color: '#ff6600',
            weight: 2,
            dashArray: '5, 5'
        }).addTo(measureLayer);

        // Calculate and show total distance
        const totalDist = calculateTotalDistance(measurePoints);
        showMeasureTooltip(e.latlng, totalDist);
    }
}

function calculateTotalDistance(points) {
    let total = 0;
    for (let i = 1; i < points.length; i++) {
        total += points[i - 1].distanceTo(points[i]);
    }
    return total;
}

function showMeasureTooltip(latlng, distance) {
    const formatted = formatDistance(distance);
    L.popup({
        closeButton: false,
        className: 'measure-tooltip'
    })
        .setLatLng(latlng)
        .setContent(`Razdalja: ${formatted}`)
        .openOn(map);
}

function formatDistance(meters) {
    if (meters >= 1000) {
        return (meters / 1000).toFixed(2) + ' km';
    }
    return Math.round(meters) + ' m';
}

function formatArea(sqMeters) {
    if (sqMeters >= 10000) {
        return (sqMeters / 10000).toFixed(2) + ' ha';
    }
    return Math.round(sqMeters) + ' m²';
}

// ============================================
// Point Modal
// ============================================

function showPointModal(coords) {
    // Remove click handler while modal is open
    if (pendingClickHandler) {
        map.off('click', pendingClickHandler);
    }

    const modal = document.getElementById('point-modal');
    modal.classList.add('active');

    document.getElementById('point-name').value = '';
    document.getElementById('point-description').value = '';
    document.getElementById('point-coords').value = coords ? `${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)}` : '';
    document.getElementById('point-name').focus();
}

function hidePointModal() {
    document.getElementById('point-modal').classList.remove('active');
    selectTool('move');
}

function confirmPoint() {
    const name = document.getElementById('point-name').value.trim();
    const description = document.getElementById('point-description').value.trim();
    const coordsStr = document.getElementById('point-coords').value.trim();
    const markerStyle = document.getElementById('point-style').value;

    if (!coordsStr) {
        alert('Koordinate niso določene!');
        return;
    }

    const coords = parseCoordinates(coordsStr);
    if (!coords) {
        alert('Napačen format koordinat!');
        return;
    }

    addMarker(coords, name, description, markerStyle);
    hidePointModal();
    saveToStorage();
}

// ============================================
// Text Modal
// ============================================

function showTextModal(coords) {
    // Remove click handler while modal is open
    if (pendingClickHandler) {
        map.off('click', pendingClickHandler);
    }

    const modal = document.getElementById('text-modal');
    modal.classList.add('active');

    document.getElementById('text-content').value = '';
    document.getElementById('text-coords').value = coords ? `${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)}` : '';
    document.getElementById('text-content').focus();
}

function hideTextModal() {
    document.getElementById('text-modal').classList.remove('active');
    selectTool('move');
}

function confirmText() {
    const text = document.getElementById('text-content').value.trim();
    const coordsStr = document.getElementById('text-coords').value.trim();

    if (!text) {
        alert('Vnesite besedilo!');
        return;
    }

    if (!coordsStr) {
        alert('Koordinate niso določene!');
        return;
    }

    const coords = parseCoordinates(coordsStr);
    if (!coords) {
        alert('Napačen format koordinat!');
        return;
    }

    addTextLabel(coords, text);
    hideTextModal();
    saveToStorage();
}

// ============================================
// Coordinate Parsing
// ============================================

function parseCoordinates(str) {
    if (!str) return null;

    // Try decimal degrees: 46.0514, 14.5069
    let match = str.match(/^(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)$/);
    if (match) {
        const lat = parseFloat(match[1]);
        const lng = parseFloat(match[2]);
        if (isValidWGS84(lat, lng)) {
            return L.latLng(lat, lng);
        }
    }

    // Try DMS format: 46°03'05"N, 14°30'25"E
    match = str.match(/(\d+)°(\d+)'(\d+(?:\.\d+)?)"?([NS])\s*,?\s*(\d+)°(\d+)'(\d+(?:\.\d+)?)"?([EW])/i);
    if (match) {
        let lat = parseInt(match[1]) + parseInt(match[2]) / 60 + parseFloat(match[3]) / 3600;
        let lng = parseInt(match[5]) + parseInt(match[6]) / 60 + parseFloat(match[7]) / 3600;
        if (match[4].toUpperCase() === 'S') lat = -lat;
        if (match[8].toUpperCase() === 'W') lng = -lng;
        if (isValidWGS84(lat, lng)) {
            return L.latLng(lat, lng);
        }
    }

    // Try D48/GK format (Y, X) - simplified conversion
    match = str.match(/^(\d{6})\s*,\s*(\d{6})$/);
    if (match) {
        const y = parseInt(match[1]);
        const x = parseInt(match[2]);
        const coords = d48ToWgs84(y, x);
        if (coords) {
            return L.latLng(coords.lat, coords.lng);
        }
    }

    return null;
}

function isValidWGS84(lat, lng) {
    return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

// Simplified D48/GK to WGS84 conversion for Slovenia
function d48ToWgs84(y, x) {
    if (y < 350000 || y > 650000 || x < 10000 || x > 220000) {
        return null;
    }

    const lat = 45.8 + (x - 30000) / 111000;
    const lng = 13.3 + (y - 370000) / 78000;

    if (isValidWGS84(lat, lng)) {
        return { lat, lng };
    }
    return null;
}

// ============================================
// Adding Map Elements
// ============================================

function addMarker(latlng, name, description, markerStyle = 'default') {
    const style = MARKER_STYLES[markerStyle] || MARKER_STYLES.default;

    // Create custom icon
    const icon = L.divIcon({
        className: 'custom-marker',
        html: `<div class="marker-icon" style="color: ${style.color};">${style.icon}</div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 30],
        popupAnchor: [0, -30]
    });

    const marker = L.marker(latlng, { icon });

    marker.feature = {
        type: 'Feature',
        geometry: {
            type: 'Point',
            coordinates: [latlng.lng, latlng.lat]
        },
        properties: {
            name: name || 'Točka',
            description: description || '',
            markerStyle: markerStyle
        }
    };

    marker.bindPopup(() => createPopupContent(marker));
    drawnItems.addLayer(marker);
    layerHistory.push(L.stamp(marker));

    return marker;
}

function addTextLabel(latlng, text) {
    const icon = L.divIcon({
        className: 'text-label',
        html: text,
        iconSize: null
    });

    const marker = L.marker(latlng, { icon });

    marker.feature = {
        type: 'Feature',
        geometry: {
            type: 'Point',
            coordinates: [latlng.lng, latlng.lat]
        },
        properties: {
            type: 'text',
            text: text
        }
    };

    marker.bindPopup(() => createTextPopupContent(marker));
    drawnItems.addLayer(marker);
    layerHistory.push(L.stamp(marker));

    return marker;
}

// ============================================
// Popup Content
// ============================================

function createPopupContent(layer) {
    const props = layer.feature?.properties || {};
    const geom = layer.feature?.geometry;
    const layerId = L.stamp(layer);
    const isMarker = layer instanceof L.Marker && !props.type;
    const isPolyline = layer instanceof L.Polyline && !(layer instanceof L.Polygon);
    const isPolygon = layer instanceof L.Polygon;

    let html = '<div class="popup-content">';

    if (props.name) {
        html += `<h4>${escapeHtml(props.name)}</h4>`;
    }

    if (props.description) {
        html += `<p>${escapeHtml(props.description)}</p>`;
    }

    // Show coordinates for points
    if (geom?.type === 'Point') {
        const coords = geom.coordinates;
        html += `<p><small>Koordinate: ${coords[1].toFixed(6)}, ${coords[0].toFixed(6)}</small></p>`;
    }

    // Show length for polylines
    if (isPolyline) {
        const length = calculatePolylineLength(layer);
        html += `<p><small>Dolžina: ${formatDistance(length)}</small></p>`;
    }

    // Show area for polygons
    if (isPolygon) {
        const area = calculatePolygonArea(layer);
        html += `<p><small>Površina: ${formatArea(area)}</small></p>`;
    }

    // Style options based on layer type
    if (isMarker) {
        // Marker style selector
        const currentStyle = props.markerStyle || 'default';
        html += `<div class="popup-style-picker">`;
        html += `<label>Oznaka:</label>`;
        html += `<select onchange="changeMarkerStyle(${layerId}, this.value)">`;
        for (const [key, style] of Object.entries(MARKER_STYLES)) {
            const selected = key === currentStyle ? 'selected' : '';
            html += `<option value="${key}" ${selected}>${style.icon} ${style.name}</option>`;
        }
        html += `</select>`;
        html += `</div>`;
    } else if (isPolyline || isPolygon) {
        // Color picker for lines/polygons
        const currentColor = props.color || '#3388ff';
        html += `<div class="popup-color-picker">`;
        html += `<label>Barva: <input type="color" value="${currentColor}" onchange="changeElementColor(${layerId}, this.value)" /></label>`;
        html += `</div>`;
    }

    html += '<div class="popup-actions">';
    if (!isMarker) {
        html += `<button onclick="editElement(${layerId})">Uredi</button>`;
    }
    html += `<button class="delete-btn" onclick="deleteElement(${layerId})">Izbriši</button>`;
    html += '</div>';
    html += '</div>';

    return html;
}

function createTextPopupContent(marker) {
    const text = marker.feature?.properties?.text || '';
    const markerId = L.stamp(marker);

    let html = '<div class="popup-content">';
    html += `<p>Besedilo: ${escapeHtml(text)}</p>`;
    html += '<div class="popup-actions">';
    html += `<button class="delete-btn" onclick="deleteElement(${markerId})">Izbriši</button>`;
    html += '</div>';
    html += '</div>';

    return html;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function calculatePolylineLength(polyline) {
    const latlngs = polyline.getLatLngs();
    let length = 0;
    for (let i = 1; i < latlngs.length; i++) {
        length += latlngs[i - 1].distanceTo(latlngs[i]);
    }
    return length;
}

function calculatePolygonArea(polygon) {
    const latlngs = polygon.getLatLngs()[0];
    if (!latlngs || latlngs.length < 3) return 0;

    // Shoelace formula approximation for small areas
    let area = 0;
    const n = latlngs.length;

    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const lat1 = latlngs[i].lat * Math.PI / 180;
        const lat2 = latlngs[j].lat * Math.PI / 180;
        const lng1 = latlngs[i].lng * Math.PI / 180;
        const lng2 = latlngs[j].lng * Math.PI / 180;

        area += (lng2 - lng1) * (2 + Math.sin(lat1) + Math.sin(lat2));
    }

    area = Math.abs(area * 6378137 * 6378137 / 2);
    return area;
}

// ============================================
// Element Management
// ============================================

function changeElementColor(id, newColor) {
    const layer = drawnItems.getLayer(id);
    if (!layer) return;

    // Update feature properties
    if (layer.feature && layer.feature.properties) {
        layer.feature.properties.color = newColor;
    }

    // Update layer style
    if (layer.setStyle) {
        layer.setStyle({
            color: newColor,
            fillColor: newColor
        });
    }

    saveToStorage();
    map.closePopup();
}

function changeMarkerStyle(id, newStyle) {
    const layer = drawnItems.getLayer(id);
    if (!layer || !(layer instanceof L.Marker)) return;

    const style = MARKER_STYLES[newStyle] || MARKER_STYLES.default;

    // Update feature properties
    if (layer.feature && layer.feature.properties) {
        layer.feature.properties.markerStyle = newStyle;
    }

    // Update icon
    const icon = L.divIcon({
        className: 'custom-marker',
        html: `<div class="marker-icon" style="color: ${style.color};">${style.icon}</div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 30],
        popupAnchor: [0, -30]
    });
    layer.setIcon(icon);

    saveToStorage();
    map.closePopup();
}

function editElement(id) {
    const layer = drawnItems.getLayer(id);
    if (!layer) return;

    // Enable editing for the layer
    if (layer.editing) {
        layer.editing.enable();

        // Save on edit end
        layer.on('edit', () => {
            updateFeatureGeometry(layer);
            saveToStorage();
        });
    }

    map.closePopup();
}

function deleteElement(id) {
    if (confirm('Ali res želite izbrisati ta element?')) {
        const layer = drawnItems.getLayer(id);
        if (layer) {
            drawnItems.removeLayer(layer);
            // Remove from history
            const histIdx = layerHistory.indexOf(id);
            if (histIdx > -1) {
                layerHistory.splice(histIdx, 1);
            }
            saveToStorage();
        }
    }
    map.closePopup();
}

function deleteLastElement() {
    if (layerHistory.length === 0) {
        alert('Ni elementov za brisanje.');
        return;
    }

    const lastId = layerHistory[layerHistory.length - 1];
    const layer = drawnItems.getLayer(lastId);

    if (layer) {
        drawnItems.removeLayer(layer);
        layerHistory.pop();
        saveToStorage();
    }
}

function updateFeatureGeometry(layer) {
    if (!layer.feature) return;

    if (layer instanceof L.Marker) {
        const latlng = layer.getLatLng();
        layer.feature.geometry.coordinates = [latlng.lng, latlng.lat];
    } else if (layer instanceof L.Polygon) {
        const latlngs = layer.getLatLngs()[0];
        layer.feature.geometry.coordinates = [latlngs.map(ll => [ll.lng, ll.lat])];
    } else if (layer instanceof L.Polyline) {
        const latlngs = layer.getLatLngs();
        layer.feature.geometry.coordinates = latlngs.map(ll => [ll.lng, ll.lat]);
    }
}

// ============================================
// Event Listeners
// ============================================

function initEventListeners() {
    // Drawing events
    map.on(L.Draw.Event.CREATED, onDrawCreated);

    // Modal events
    document.getElementById('point-cancel').addEventListener('click', hidePointModal);
    document.getElementById('point-confirm').addEventListener('click', confirmPoint);
    document.getElementById('text-cancel').addEventListener('click', hideTextModal);
    document.getElementById('text-confirm').addEventListener('click', confirmText);

    // Toolbar events
    document.getElementById('btn-import').addEventListener('click', importGeoJSON);
    document.getElementById('btn-export').addEventListener('click', exportGeoJSON);
    document.getElementById('btn-delete-all').addEventListener('click', deleteAll);
    document.getElementById('btn-delete-last').addEventListener('click', deleteLastElement);
    document.getElementById('btn-print').addEventListener('click', printMap);

    // File input
    document.getElementById('file-input').addEventListener('change', handleFileSelect);

    // Style options - update immediately when changed
    document.getElementById('stroke-color').addEventListener('input', (e) => {
        drawStyle.color = e.target.value;
        // If currently drawing, restart with new color
        if (currentDrawHandler && (currentTool === 'polyline' || currentTool === 'polygon')) {
            currentDrawHandler.disable();
            if (currentTool === 'polyline') {
                startPolyline();
            } else {
                startPolygon();
            }
        }
    });

    document.getElementById('stroke-width').addEventListener('input', (e) => {
        drawStyle.weight = parseInt(e.target.value);
        document.getElementById('stroke-width-value').textContent = e.target.value;
        // If currently drawing, restart with new weight
        if (currentDrawHandler && (currentTool === 'polyline' || currentTool === 'polygon')) {
            currentDrawHandler.disable();
            if (currentTool === 'polyline') {
                startPolyline();
            } else {
                startPolygon();
            }
        }
    });

    // Close modal on outside click
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.remove('active');
                selectTool('move');
            }
        });
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            document.querySelectorAll('.modal').forEach(m => m.classList.remove('active'));
            selectTool('move');
        }
    });
}

function onDrawCreated(event) {
    const layer = event.layer;
    const type = event.layerType;

    // Read current style
    const currentColor = drawStyle.color;
    const currentWeight = drawStyle.weight;

    // Create feature properties
    layer.feature = {
        type: 'Feature',
        properties: {
            name: type === 'polyline' ? 'Pot' : 'Območje',
            color: currentColor,
            weight: currentWeight
        },
        geometry: null
    };

    // Set geometry
    if (type === 'polyline') {
        const latlngs = layer.getLatLngs();
        layer.feature.geometry = {
            type: 'LineString',
            coordinates: latlngs.map(ll => [ll.lng, ll.lat])
        };
    } else if (type === 'polygon') {
        const latlngs = layer.getLatLngs()[0];
        layer.feature.geometry = {
            type: 'Polygon',
            coordinates: [latlngs.map(ll => [ll.lng, ll.lat])]
        };
    }

    // Add popup
    layer.bindPopup(() => createPopupContent(layer));

    // Add to map and history
    drawnItems.addLayer(layer);
    layerHistory.push(L.stamp(layer));
    saveToStorage();

    // Continue with same tool
    selectTool(currentTool);
}

function updateStyleOptions() {
    document.getElementById('stroke-color').value = drawStyle.color;
    document.getElementById('stroke-width').value = drawStyle.weight;
    document.getElementById('stroke-width-value').textContent = drawStyle.weight;
}

// ============================================
// Storage
// ============================================

function saveToStorage() {
    const geojson = toGeoJSON();
    try {
        localStorage.setItem(CONFIG.storageKey, JSON.stringify(geojson));
    } catch (e) {
        console.error('Napaka pri shranjevanju:', e);
    }
}

function loadFromStorage() {
    try {
        const data = localStorage.getItem(CONFIG.storageKey);
        if (data) {
            const geojson = JSON.parse(data);
            loadGeoJSON(geojson);
        }
    } catch (e) {
        console.error('Napaka pri nalaganju:', e);
    }
}

function toGeoJSON() {
    const features = [];

    drawnItems.eachLayer(layer => {
        if (layer.feature) {
            features.push(layer.feature);
        }
    });

    return {
        type: 'FeatureCollection',
        features: features
    };
}

function loadGeoJSON(geojson) {
    if (!geojson || !geojson.features) return;

    geojson.features.forEach(feature => {
        const props = feature.properties || {};
        const geom = feature.geometry;

        if (!geom) return;

        let layer;

        switch (geom.type) {
            case 'Point':
                const latlng = L.latLng(geom.coordinates[1], geom.coordinates[0]);

                if (props.type === 'text' && props.text) {
                    // Text label
                    const textIcon = L.divIcon({
                        className: 'text-label',
                        html: props.text,
                        iconSize: null
                    });
                    layer = L.marker(latlng, { icon: textIcon });
                    layer.feature = feature;
                    layer.bindPopup(() => createTextPopupContent(layer));
                } else {
                    // Regular marker with style
                    const markerStyle = props.markerStyle || 'default';
                    const style = MARKER_STYLES[markerStyle] || MARKER_STYLES.default;
                    const markerIcon = L.divIcon({
                        className: 'custom-marker',
                        html: `<div class="marker-icon" style="color: ${style.color};">${style.icon}</div>`,
                        iconSize: [30, 30],
                        iconAnchor: [15, 30],
                        popupAnchor: [0, -30]
                    });
                    layer = L.marker(latlng, { icon: markerIcon });
                    layer.feature = feature;
                    layer.bindPopup(() => createPopupContent(layer));
                }
                break;

            case 'LineString':
                const lineCoords = geom.coordinates.map(c => L.latLng(c[1], c[0]));
                layer = L.polyline(lineCoords, {
                    color: props.color || '#3388ff',
                    weight: props.weight || 3
                });
                layer.feature = feature;
                layer.bindPopup(() => createPopupContent(layer));
                break;

            case 'Polygon':
                const polyCoords = geom.coordinates[0].map(c => L.latLng(c[1], c[0]));
                layer = L.polygon(polyCoords, {
                    color: props.color || '#3388ff',
                    weight: props.weight || 3,
                    fillColor: props.color || '#3388ff',
                    fillOpacity: 0.3
                });
                layer.feature = feature;
                layer.bindPopup(() => createPopupContent(layer));
                break;
        }

        if (layer) {
            drawnItems.addLayer(layer);
            layerHistory.push(L.stamp(layer));
        }
    });
}

// ============================================
// Import/Export
// ============================================

function importGeoJSON() {
    document.getElementById('file-input').click();
}

function handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const geojson = JSON.parse(e.target.result);
            loadGeoJSON(geojson);
            saveToStorage();

            // Zoom to fit imported features
            if (drawnItems.getLayers().length > 0) {
                map.fitBounds(drawnItems.getBounds(), { padding: [50, 50] });
            }
        } catch (err) {
            alert('Napaka pri branju datoteke: ' + err.message);
        }
    };
    reader.readAsText(file);

    // Reset input
    event.target.value = '';
}

function exportGeoJSON() {
    const geojson = toGeoJSON();
    const dataStr = JSON.stringify(geojson, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = 'skavtska-karta.geojson';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function deleteAll() {
    if (drawnItems.getLayers().length === 0) {
        alert('Ni elementov za brisanje.');
        return;
    }

    if (confirm('Ali res želite izbrisati vse narisane elemente? To dejanje ni mogoče razveljaviti.')) {
        drawnItems.clearLayers();
        layerHistory = [];
        saveToStorage();
    }
}

// ============================================
// Printing
// ============================================

function printMap() {
    // Update print legend and scale
    updatePrintLegend();

    // Small delay to ensure everything is rendered
    setTimeout(() => {
        window.print();
    }, 100);
}

function updatePrintLegend() {
    const legendContent = document.getElementById('legend-content');
    legendContent.innerHTML = '';

    const items = new Map();

    drawnItems.eachLayer(layer => {
        const props = layer.feature?.properties || {};

        if (layer instanceof L.Marker) {
            if (props.type === 'text') {
                items.set('text', '<div class="legend-item">📝 Besedilne oznake</div>');
            } else {
                items.set('marker', '<div class="legend-item">📍 Točke</div>');
            }
        } else if (layer instanceof L.Polygon) {
            const color = props.color || '#3388ff';
            items.set('polygon-' + color, `<div class="legend-item"><span class="legend-color" style="background: ${color};"></span>Območje</div>`);
        } else if (layer instanceof L.Polyline) {
            const color = props.color || '#3388ff';
            items.set('polyline-' + color, `<div class="legend-item"><span class="legend-line" style="background: ${color};"></span>Pot</div>`);
        }
    });

    items.forEach(item => {
        legendContent.innerHTML += item;
    });
}

// ============================================
// Make functions globally accessible
// ============================================

window.editElement = editElement;
window.deleteElement = deleteElement;
window.changeElementColor = changeElementColor;
window.changeMarkerStyle = changeMarkerStyle;
