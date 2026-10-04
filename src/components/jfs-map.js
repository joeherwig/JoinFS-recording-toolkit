// <jfs-map> - static multi-track map view.
// Tile-layer plumbing (loadLeaflet, TILES config, dark label-recoloring) is ported from
// joinfs-map-websocket-webcomponent/joinfs-map.js; track rendering (altitude-colored/grey-on-ground
// polyline runs, arrow playhead markers, event markers, focus/dim) is new for this toolkit -
// see PLAN.md Step 4.

import { altColor, desaturate, buildColoredRuns, decimateStride, interpolatePosition, isValidLatLon, firstValidPositionIndex, buildPositionSeries } from '../geo.js';
import { shortcuts } from '../shortcuts.js';

let _leafletPromise = null;
function loadLeaflet() {
  if (_leafletPromise) return _leafletPromise;
  _leafletPromise = Promise.all([
    import('https://esm.sh/leaflet@1.9.4'),
    fetch('https://esm.sh/leaflet@1.9.4/dist/leaflet.css').then((r) => r.text()),
  ]).then(([mod, css]) => ({ L: mod.default, css }));
  return _leafletPromise;
}

// ported from joinfs-map-websocket-webcomponent/joinfs-map.js TILES, plus a new `satellite` theme.
const TILES = {
  light: [{
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
  }],
  dark: [{
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles © <a href="https://www.esri.com/">Esri</a>',
    maxNativeZoom: 16,
    maxZoom: 19,
  }, {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
    maxNativeZoom: 16,
    maxZoom: 19,
    className: 'joinfs-labels',
  }],
  satellite: [{
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles © <a href="https://www.esri.com/">Esri</a>',
    maxZoom: 19,
  }],
};

const STYLE = `
  :host { display: block; position: relative; }
  #map { position: absolute; inset: 0; }
  .jfs-labels { filter: invert(1) grayscale(1) brightness(1.5); }
  /* will-change promotes the icon to its own compositing layer, so the drop-shadow filter is
     rasterized once rather than on every rotation update - cheaper, and avoids a possible repaint
     jank source on top of the DOM-replacement flicker fixed in _updateArrowIcon(). */
  .jfs-arrow-icon { transform-origin: center; filter: drop-shadow(0 1px 2px rgba(0,0,0,.6)); will-change: transform; }
  .jfs-legend {
    position: absolute; right: 8px; bottom: 8px; z-index: 1000;
    background: var(--panel-bg, rgba(20,22,28,.85)); color: var(--fg, #e2e8f0);
    border-radius: 8px; padding: 6px 10px; font: 12px/1.6 system-ui, sans-serif;
    max-height: 40%; overflow: auto;
  }
  .jfs-legend-row { display: flex; align-items: center; gap: 6px; cursor: pointer; white-space: nowrap; }
  .jfs-legend-swatch { width: 10px; height: 10px; border-radius: 2px; flex: none; }
  .jfs-event-tooltip { font: 12px system-ui, sans-serif; }
  .jfs-layer-btn {
    position: absolute; top: 8px; right: 8px; z-index: 1000;
    width: 34px; height: 34px; padding: 0; border-radius: 8px; border: none;
    background: var(--panel-bg, rgba(20,22,28,.85)); color: var(--fg, #e2e8f0);
    cursor: pointer; display: flex; align-items: center; justify-content: center;
  }
  .jfs-layer-btn:hover { background: var(--btn-bg-hover, rgba(255,255,255,.18)); }
  .jfs-layer-btn svg { width: 20px; height: 20px; }
`;

// Single "layer stack" icon (stacked/offset layers, à la flaticon's layer-stack glyphs) - one button
// cycles through the three tile themes on click, rather than three separate buttons, per the
// gpxviewer.app reference's minimalist single-icon layer control.
const LAYER_STACK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M12 3 2 8l10 5 10-5-10-5Z"/><path d="M2 13l10 5 10-5"/><path d="M2 17.5l10 5 10-5"/></svg>';
const LAYER_ORDER = ['dark', 'light', 'satellite'];
const LAYER_LABELS = { dark: 'Dark', light: 'Light (OSM)', satellite: 'Satellite' };

class JfsMap extends HTMLElement {
  static get observedAttributes() { return ['theme']; }

  constructor() {
    super();
    this._root = this.attachShadow({ mode: 'open' });
    this._root.innerHTML = `
      <style>${STYLE}</style>
      <div id="map"></div>
      <button type="button" class="jfs-layer-btn" id="layerBtn">${LAYER_STACK_ICON}</button>
      <div class="jfs-legend" id="legend" hidden></div>
    `;
    this._mapEl = this._root.getElementById('map');
    this._legendEl = this._root.getElementById('legend');
    this._layerBtn = this._root.getElementById('layerBtn');
    this._layerBtn.addEventListener('click', () => this.cycleLayer());
    this._trackLayers = new Map(); // trackId -> { group, runs, icon, eventMarkers }
    this._store = null;
    this._L = null;
    this._map = null;
    this._tileLayers = [];
  }

  set store(store) {
    if (this._store) {
      this._store.removeEventListener('tracks-changed', this._onTracksChanged);
      this._store.removeEventListener('time-changed', this._onTimeChanged);
      this._store.removeEventListener('selection-changed', this._onSelectionChanged);
    }
    this._store = store;
    this._onTracksChanged = () => this._renderTracks();
    this._onTimeChanged = () => this._updatePlayheads();
    this._onSelectionChanged = () => this._applyFocus();
    store.addEventListener('tracks-changed', this._onTracksChanged);
    store.addEventListener('time-changed', this._onTimeChanged);
    store.addEventListener('selection-changed', this._onSelectionChanged);
    if (this._map) this._renderTracks();
  }

  get store() { return this._store; }

  async connectedCallback() {
    this._unregisterKeys = [
      shortcuts.register({ id: 'map-clear-selection', key: 'Escape', preventDefault: false, run: () => { if (this._store) this._store.clearSelection(); } }),
      shortcuts.register({ id: 'map-cycle-layer', key: 'l', preventDefault: false, run: () => this.cycleLayer() }),
    ];
    const { L, css } = await loadLeaflet();
    this._L = L;
    const styleEl = document.createElement('style');
    styleEl.textContent = css;
    this._root.insertBefore(styleEl, this._root.firstChild);
    this._map = L.map(this._mapEl, { worldCopyJump: true }).setView([20, 0], 2);
    this._map.on('click', () => { if (this._store) this._store.clearSelection(); });
    this._swapTileLayer(this.getAttribute('theme') || 'dark');
    if (this._store) this._renderTracks();
  }

  disconnectedCallback() {
    for (const off of this._unregisterKeys || []) off();
    this._unregisterKeys = null;
  }

  attributeChangedCallback(name, oldVal, newVal) {
    if (name === 'theme' && this._map) this._swapTileLayer(newVal || 'dark');
  }

  /** Cycles dark -> light -> satellite -> dark. Bound to both the layer button and the "L" hotkey. */
  cycleLayer() {
    const current = this.getAttribute('theme') || 'dark';
    const next = LAYER_ORDER[(LAYER_ORDER.indexOf(current) + 1) % LAYER_ORDER.length];
    this.setAttribute('theme', next);
  }

  _swapTileLayer(theme) {
    const L = this._L;
    for (const layer of this._tileLayers) layer.remove();
    this._tileLayers = [];
    const stack = TILES[theme] || TILES.dark;
    for (const spec of stack) {
      const layer = L.tileLayer(spec.url, {
        attribution: spec.attribution || '',
        maxZoom: spec.maxZoom,
        maxNativeZoom: spec.maxNativeZoom,
        className: spec.className || '',
      }).addTo(this._map);
      this._tileLayers.push(layer);
    }
    const next = LAYER_ORDER[(LAYER_ORDER.indexOf(theme) + 1) % LAYER_ORDER.length];
    this._layerBtn.title = `Map layer: ${LAYER_LABELS[theme] || theme} (click, or press L, for ${LAYER_LABELS[next]})`;
    if (this._store) this._store.mapTileTheme = theme;
    this._updateGroundRunColors(theme);
  }

  // On-ground path color is theme-dependent (see geo.js#GROUND_COLOR_BY_THEME) for contrast against
  // each basemap, but polyline runs are built once and cached (PLAN.md Step 4 - rebuilding on every
  // render would be expensive for long tracks) - so switching themes needs to restyle the
  // already-built ground-colored runs in place rather than waiting for the next full rebuild (which,
  // for a track whose frame count never changes after import, would otherwise be "never").
  _updateGroundRunColors(theme) {
    const groundColor = altColor(0, true, theme);
    for (const entry of this._trackLayers.values()) {
      for (const layer of entry.runLayers) {
        if (layer._colorKey === 'ground') layer._origColor = groundColor;
      }
    }
    this._applyFocus(); // re-applies opacity/desaturation using the updated _origColor values
  }

  _colorKeyFor(altFt, onGround) {
    return onGround ? 'ground' : `a${Math.round(altFt / 500)}`;
  }

  _renderTracks() {
    if (!this._map || !this._store) return;
    const L = this._L;
    const tracks = this._store.project.tracks;
    const seen = new Set();

    for (const track of tracks) {
      seen.add(track.id);
      let entry = this._trackLayers.get(track.id);
      if (!entry) {
        // eventMarkers starts as `null`, not `[]` - an empty array is truthy, which would silently
        // defeat the `if (!entry.eventMarkers)` "build once" guard below (a real bug this shipped
        // with: markers never got built at all, for any track, ever - "can't see any marks").
        entry = { group: L.layerGroup().addTo(this._map), runLayers: [], icon: null, eventMarkers: null, bounds: null };
        this._trackLayers.set(track.id, entry);
      }
      if (!track.visible) { entry.group.clearLayers(); entry.runLayers = []; entry.bounds = null; continue; }

      // (re)build runs only if we haven't yet, or the track's frame count changed (not on a pure
      // time-offset change - positions haven't moved, see PLAN.md Step 4).
      if (entry.frameCount !== track.frames.times.length) {
        entry.group.clearLayers();
        entry.runLayers = [];
        const idx = decimateStride(track.frames, 20000)
          // Exact (0,0) is a placeholder/missing fix some real recordings contain (e.g. an aircraft
          // armed for recording before the simulator delivered a first position) - including it
          // would drag the polyline/bounds out to "Null Island" ("crap on showing" - reported bug).
          .filter((i) => isValidLatLon(track.frames.lat[i], track.frames.lon[i]));
        const mapTheme = this.getAttribute('theme') || 'dark';
        const points = idx.map((i) => {
          const altFt = track.frames.alt[i] * 3.28084;
          const onGround = !!(track.frames.groundFlags[i] & 1);
          return {
            lat: track.frames.lat[i], lon: track.frames.lon[i],
            color: altColor(altFt, onGround, mapTheme), colorKey: this._colorKeyFor(altFt, onGround),
          };
        });
        const runs = buildColoredRuns(points);
        for (const run of runs) {
          const pl = L.polyline(run.latlngs, { color: run.color, weight: 3, opacity: 0.9, lineJoin: 'round' });
          pl._origColor = run.color; // Leaflet's setStyle() mutates options.color in place, so the
          // original (non-desaturated) color has to be kept separately for _applyFocus() to restore.
          pl._colorKey = run.colorKey; // used by _updateGroundRunColors() to find the ground-colored runs when the map theme changes
          pl.on('click', (e) => { L.DomEvent.stopPropagation(e); this._store.selectTrack(track.id); });
          pl.addTo(entry.group);
          entry.runLayers.push(pl);
        }
        entry.frameCount = track.frames.times.length;
        entry.bounds = idx.length ? L.latLngBounds(idx.map((i) => [track.frames.lat[i], track.frames.lon[i]])) : null;
        // Position-only series for interpolatePosition() to search over - see buildPositionSeries()
        // for why searching the raw frames directly (which include non-position frame types sharing
        // the same columns) is unsafe.
        entry.posSeries = buildPositionSeries(track.frames);
      }

      if (!entry.icon) {
        const startIdx = Math.max(0, firstValidPositionIndex(track.frames));
        entry.icon = L.marker([track.frames.lat[startIdx], track.frames.lon[startIdx]], {
          icon: L.divIcon({ className: '', html: this._arrowSvg(track.color, 0), iconSize: [22, 22], iconAnchor: [11, 11] }),
          interactive: true,
        });
        // Leaflet markers bubble click events up to the map by default (bubblingMouseEvents), which
        // would immediately re-trigger the map's own "click empty background -> clearSelection()"
        // handler right after selecting - stop it here the same way the polyline click handler does.
        entry.icon.on('click', (e) => { this._L.DomEvent.stopPropagation(e); this._store.selectTrack(track.id); });
        entry.icon.addTo(entry.group);
      }

      // Event marker positions are static (an event happened at a fixed point along the track), so
      // unlike the playhead arrow these only need building once, not on every time-changed tick -
      // rebuilding ~1000s of circleMarkers up to 60x/s during playback would be a real perf problem.
      if (!entry.eventMarkers) {
        entry.eventMarkers = entry.posSeries ? (track.events || []).map((evt) => {
          const pos = interpolatePosition(entry.posSeries, evt.timeS);
          const marker = L.circleMarker([pos.lat, pos.lon], { radius: 4, color: '#fff', weight: 1, fillColor: '#111827', fillOpacity: 0.9 });
          marker.bindTooltip(`<span class="jfs-event-tooltip">${evt.label}</span>`);
          return marker;
        }) : [];
      }
      this._syncEventMarkers(track, entry);
    }

    for (const [id, entry] of this._trackLayers) {
      if (!seen.has(id)) { entry.group.remove(); this._trackLayers.delete(id); }
    }

    // Re-fit whenever the *set* of included tracks changes (add/remove) - not on every render (e.g.
    // a lane toggle or time-offset drag would otherwise re-zoom the map, which is annoying) - see
    // REQUIREMENTS.md "the map zooms to show all included tracks".
    const trackIdKey = tracks.map((t) => t.id).sort().join(',');
    if (trackIdKey !== this._lastFitTrackIdKey) {
      this._lastFitTrackIdKey = trackIdKey;
      let unionBounds = null;
      for (const [id, entry] of this._trackLayers) {
        if (!seen.has(id) || !entry.bounds) continue;
        unionBounds = unionBounds ? unionBounds.extend(entry.bounds) : entry.bounds;
      }
      if (unionBounds) this._map.fitBounds(unionBounds, { padding: [24, 24] });
    }

    this._renderLegend();
    this._applyFocus();
    this._updatePlayheads();
  }

  _arrowSvg(color, headingDeg) {
    return `<svg width="22" height="22" viewBox="0 0 22 22" class="jfs-arrow-icon" style="transform:rotate(${headingDeg}deg)">` +
      `<polygon points="11,2 17,19 11,15 5,19" fill="${color}" stroke="#000" stroke-width="1"/></svg>`;
  }

  // Rotating/recoloring the arrow on every playhead tick (up to 60/s during playback) by calling
  // Marker#setIcon() with a brand-new L.divIcon each time was the cause of the reported flicker:
  // Leaflet tears down and reinserts the whole icon DOM node on every setIcon() call, and doing that
  // every animation frame is visibly janky. Mutating the existing SVG's rotation/fill in place is
  // cheap (a transform + an attribute, no DOM node replacement) and flicker-free.
  _updateArrowIcon(entry, color, headingDeg) {
    // Re-fetch whenever the cached element is missing OR no longer attached to the document - e.g.
    // if Leaflet ever recreates the marker's icon node internally (a map viewreset/zoomend can do
    // this). Without this check a stale-but-still-non-null cached reference would keep getting
    // mutated invisibly while the real, currently-visible node sat frozen at its last rotation/color
    // until the next such swap - which is what a "sometimes flickers" report matches: a visible snap
    // to the default un-rotated icon at each swap, then stuck wrong until the next one.
    if (!entry.iconEl || !entry.iconEl.isConnected) entry.iconEl = entry.icon.getElement();
    const svg = entry.iconEl && entry.iconEl.querySelector('svg');
    if (!svg) {
      // Element not rendered yet (e.g. first tick right after creation) - fall back to a one-off
      // full icon set; subsequent ticks will find the element and mutate it in place instead.
      entry.icon.setIcon(this._L.divIcon({ className: '', html: this._arrowSvg(color, headingDeg), iconSize: [22, 22], iconAnchor: [11, 11] }));
      entry.iconEl = entry.icon.getElement();
      return;
    }
    svg.style.transform = `rotate(${headingDeg}deg)`;
    const polygon = svg.querySelector('polygon');
    if (polygon) polygon.setAttribute('fill', color);
  }

  _updatePlayheads() {
    if (!this._store) return;
    const t = this._store.currentTimeS;
    for (const track of this._store.project.tracks) {
      const entry = this._trackLayers.get(track.id);
      if (!entry || !entry.icon || !track.visible || !entry.posSeries) continue;
      if (track.frames.times.length === 0) continue;
      const localT = t - track.timeOffsetS;
      const pos = interpolatePosition(entry.posSeries, localT);
      // Skip repositioning on a degenerate (0,0) frame - see the Null Island note in _renderTracks -
      // rather than jumping the marker out to the middle of the ocean; it just holds its last
      // known-good position until the interpolated frame is valid again.
      if (isValidLatLon(pos.lat, pos.lon)) {
        entry.icon.setLatLng([pos.lat, pos.lon]);
        const altFt = pos.alt * 3.28084;
        this._updateArrowIcon(entry, altColor(altFt, pos.onGround, this.getAttribute('theme') || 'dark'), pos.heading);
      }
      // Event markers are static (built once in _renderTracks) - no per-tick work needed here.
    }
  }

  // Gated by the track's own showEvents toggle (sidebar EVT button in <jfs-timeline>, same as
  // ALT/SPD) rather than by focus/selection - markers used to only ever appear for the selected
  // track, which meant they were invisible by default (nothing is selected initially). Focus mode
  // dims them (like the path/icon) instead of hiding them outright. Markers themselves are built
  // once in _renderTracks (positions are static); this only adds/removes them from the map and
  // updates their opacity - cheap enough to call on every focus change or lane-toggle.
  _syncEventMarkers(track, entry) {
    const dim = this._store.selectedTrackId && this._store.selectedTrackId !== track.id;
    const opacity = dim ? 0.35 : 1, fillOpacity = dim ? 0.3 : 0.9;
    for (const marker of entry.eventMarkers) {
      // Add/remove via the *group's* own addLayer/removeLayer, not marker.addTo()/marker.remove() -
      // the latter detaches the marker from the map but does not update the LayerGroup's own
      // internal membership bookkeeping, so a later group.hasLayer(marker) check would keep
      // (incorrectly) reporting it present - which was a real bug: toggling EVT off then back on
      // left every marker permanently gone, because hasLayer() never stopped saying "already added".
      if (track.showEvents) {
        if (!entry.group.hasLayer(marker)) entry.group.addLayer(marker);
        marker.setStyle({ opacity, fillOpacity });
      } else if (entry.group.hasLayer(marker)) {
        entry.group.removeLayer(marker);
      }
    }
  }

  _applyFocus() {
    if (!this._store) return;
    const selected = this._store.selectedTrackId;
    for (const track of this._store.project.tracks) {
      const entry = this._trackLayers.get(track.id);
      if (!entry) continue;
      const dim = selected && selected !== track.id;
      for (const layer of entry.runLayers) {
        layer.setStyle({ opacity: dim ? 0.35 : 0.9, color: dim ? desaturate(layer._origColor) : layer._origColor });
      }
      if (entry.icon) {
        const el = entry.icon.getElement();
        if (el) el.style.opacity = dim ? 0.35 : 1;
      }
      if (entry.eventMarkers) this._syncEventMarkers(track, entry);
    }
    this._renderLegend();
  }

  _renderLegend() {
    if (!this._store) return;
    const tracks = this._store.project.tracks;
    this._legendEl.hidden = tracks.length === 0;
    this._legendEl.innerHTML = '';
    for (const track of tracks) {
      const row = document.createElement('div');
      row.className = 'jfs-legend-row';
      row.style.opacity = this._store.selectedTrackId && this._store.selectedTrackId !== track.id ? 0.5 : 1;
      row.innerHTML = `<span class="jfs-legend-swatch" style="background:${track.color}"></span><span>${track.callsign || track.model || track.id}</span>`;
      row.addEventListener('click', () => this._store.selectTrack(track.id));
      this._legendEl.appendChild(row);
    }
  }
}

customElements.define('jfs-map', JfsMap);
