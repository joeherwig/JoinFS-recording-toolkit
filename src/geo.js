// Geometry / rendering helpers shared by <jfs-map> and <jfs-timeline>.

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;
export const FT_PER_M = 3.28084;
export const MPS_PER_KT = 0.514444;

const R_EARTH_M = 6371008.8;

/** Great-circle distance in metres between two lat/lon points given in degrees. */
export function haversineM(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * DEG2RAD;
  const dLon = (lon2 - lon1) * DEG2RAD;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * DEG2RAD) * Math.cos(lat2 * DEG2RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Treats exact (0,0) as an invalid/missing position fix ("Null Island"), not a real one - some
 * JoinFS recordings contain a placeholder frame at exactly 0,0 (e.g. an aircraft that was armed for
 * recording before the simulator delivered its first real position). A real aircraft is never
 * genuinely at exactly 0.0000000,0.0000000, so this is a safe, standard GPS-data-hygiene check.
 */
export function isValidLatLon(lat, lon) {
  return !(lat === 0 && lon === 0);
}

/** Index of the first frame with a valid (non-Null-Island) position, or -1 if none. */
export function firstValidPositionIndex(frames) {
  for (let i = 0; i < frames.lat.length; i++) if (isValidLatLon(frames.lat[i], frames.lon[i])) return i;
  return -1;
}

/** Horizontal ground speed in knots from the world-frame X (east) / Z (north) velocity components (m/s). */
export function horizontalSpeedKt(vX, vZ) {
  return Math.hypot(vX, vZ) / MPS_PER_KT;
}

// On-ground grey, tuned per map tile theme for contrast against that theme's basemap. A flat
// mid-grey (the original single value, still used for `light`/OSM) reads fine against a bright
// basemap but washes out against the dark theme's dark-grey canvas and blends into roads/pavement/
// shadow in satellite imagery - both needed a lighter, more contrasting shade (reported: "increase
// the line contrast in Satellite and Dark map view if on ground").
const GROUND_COLOR_BY_THEME = {
  light: 'hsl(0,0%,45%)', // unchanged - only dark/satellite were reported as low-contrast
  dark: 'hsl(0,0%,85%)',
  satellite: 'hsl(50,90%,60%)', // a warm yellow reads reliably against imagery (greens/greys/blues) where no single grey shade would
};

/**
 * Altitude-based color, ported from joinfs-map-websocket-webcomponent/joinfs-map.js `altColor()`
 * (ADSBExchange/tar1090-style HSL ramp). Ground handling differs from the original: the caller
 * passes `onGround` explicitly (from the decoded GroundFlags bit), rather than inferring it from
 * altitude <= 0, since we have the real flag available. `theme` (the map's tile theme, not the
 * app-chrome theme) picks the on-ground grey's shade for contrast against that basemap; airborne
 * colors are theme-independent (the ramp already has enough contrast against every basemap).
 */
export function altColor(altFt, onGround, theme = 'light') {
  const groundColor = GROUND_COLOR_BY_THEME[theme] || GROUND_COLOR_BY_THEME.light;
  if (onGround) return groundColor;
  if (altFt == null || Number.isNaN(altFt)) return 'hsl(0,0%,75%)';
  const ft = Number(altFt);
  if (ft <= 0) return groundColor;
  let hue;
  if (ft < 2000) hue = 20;
  else if (ft < 10000) hue = 20 + ((ft - 2000) / 8000) * 120;
  else if (ft <= 40000) hue = 140 + ((ft - 10000) / 30000) * 160;
  else hue = 300;
  return `hsl(${Math.round(hue)},88%,44%)`;
}

/** Desaturated/dimmed variant of an `altColor()` result, used for the focus-mode "unfocused" state. */
export function desaturate(hslColor) {
  const m = /^hsl\((\d+(?:\.\d+)?),\s*[\d.]+%,\s*([\d.]+)%\)$/.exec(hslColor);
  if (!m) return hslColor;
  return `hsl(${m[1]},12%,${m[2]}%)`;
}

/**
 * Binary search for the frame index whose time is the latest one <= t.
 * `times` is a Float64Array/array of ascending frame times (seconds, already offset-adjusted by the caller).
 * Returns -1 if t is before the first frame.
 */
export function findFrameIndexAtTime(times, t) {
  if (times.length === 0 || t < times[0]) return -1;
  if (t >= times[times.length - 1]) return times.length - 1;
  let lo = 0, hi = times.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (times[mid] <= t) lo = mid; else hi = mid - 1;
  }
  return lo;
}

/** Linear interpolation between frame `i` and `i+1` in `times`/`values` at time `t`. */
function lerpAt(times, values, i, t) {
  if (i < 0) return values[0];
  if (i >= times.length - 1) return values[values.length - 1];
  const t0 = times[i], t1 = times[i + 1];
  const f = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
  return values[i] + (values[i + 1] - values[i]) * f;
}

/**
 * Filters a Track's columnar `frames` down to just the entries with real position data, for
 * interpolatePosition() to search over. Necessary because non-position frame types (SimEvent,
 * Integer/Float/String8 Variables) share the same `times`/`lat`/`lon` columns as position frames,
 * but their lat/lon slots are never written (left at the typed array's default of 0) - and the real
 * gpx-to-jfs-webcomponent writer emits gear/flaps/light variable frames at the *exact same
 * timestamp* as the position sample they were derived from. Searching the raw, unfiltered frames
 * for that exact timestamp could land on the variable frame's own (0,0) slot instead of the real
 * position frame right next to it - every event marker ended up at Null Island, 100% of the time,
 * since an event's timeS is always exactly its own frame's timestamp. Interpolating against this
 * filtered series instead sidesteps the ambiguity entirely: it only contains real position samples.
 */
export function buildPositionSeries(frames) {
  const n = frames.times.length;
  let count = 0;
  for (let i = 0; i < n; i++) if (isValidLatLon(frames.lat[i], frames.lon[i])) count++;
  if (count === 0) return null;
  const times = new Float64Array(count), lat = new Float64Array(count), lon = new Float64Array(count);
  const alt = new Float64Array(count), heading = new Float32Array(count), groundFlags = new Uint8Array(count);
  let k = 0;
  for (let i = 0; i < n; i++) {
    if (!isValidLatLon(frames.lat[i], frames.lon[i])) continue;
    times[k] = frames.times[i]; lat[k] = frames.lat[i]; lon[k] = frames.lon[i];
    alt[k] = frames.alt[i]; heading[k] = frames.heading[i]; groundFlags[k] = frames.groundFlags[i];
    k++;
  }
  return { times, lat, lon, alt, heading, groundFlags };
}

/** Interpolated lat/lon/heading/altitude at time `t`, for positioning a playhead marker. */
export function interpolatePosition(frames, t) {
  const i = findFrameIndexAtTime(frames.times, t);
  if (i < 0) {
    return { lat: frames.lat[0], lon: frames.lon[0], heading: frames.heading[0], alt: frames.alt[0], onGround: !!(frames.groundFlags[0] & 1) };
  }
  const lat = lerpAt(frames.times, frames.lat, i, t);
  const lon = lerpAt(frames.times, frames.lon, i, t);
  const alt = lerpAt(frames.times, frames.alt, i, t);
  // heading wraps at 360; interpolate the short way around
  const h0 = frames.heading[i], h1 = frames.heading[Math.min(i + 1, frames.heading.length - 1)];
  let dh = h1 - h0;
  dh -= Math.round(dh / 360) * 360;
  const t0 = frames.times[i], t1 = frames.times[Math.min(i + 1, frames.times.length - 1)];
  const f = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
  const heading = ((h0 + dh * f) % 360 + 360) % 360;
  return { lat, lon, alt, heading, onGround: !!(frames.groundFlags[i] & 1) };
}

/**
 * Min/max-preserving decimation (audio-waveform technique): buckets `values` into `bucketCount`
 * buckets and keeps both the min and max of each bucket, so spikes survive zoom-out.
 * Returns { times, min, max } typed arrays, one entry per bucket (times = bucket start time).
 */
export function buildLodLevel(times, values, bucketCount) {
  const n = times.length;
  if (n === 0) return { times: new Float64Array(0), min: new Float32Array(0), max: new Float32Array(0) };
  bucketCount = Math.max(1, Math.min(bucketCount, n));
  const outTimes = new Float64Array(bucketCount);
  const outMin = new Float32Array(bucketCount);
  const outMax = new Float32Array(bucketCount);
  const perBucket = n / bucketCount;
  for (let b = 0; b < bucketCount; b++) {
    const start = Math.floor(b * perBucket);
    const end = b === bucketCount - 1 ? n : Math.floor((b + 1) * perBucket);
    let min = Infinity, max = -Infinity;
    for (let i = start; i < end; i++) {
      const v = values[i];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (min === Infinity) { min = values[Math.min(start, n - 1)]; max = min; }
    outTimes[b] = times[start];
    outMin[b] = min;
    outMax[b] = max;
  }
  return { times: outTimes, min: outMin, max: outMax };
}

/** Builds a small pyramid of LOD levels (full resolution down to a coarse overview) for one value series. */
export function buildLodPyramid(times, values, { levels = 6, minBuckets = 64 } = {}) {
  const n = times.length;
  const pyramid = [];
  let bucketCount = n;
  for (let i = 0; i < levels && bucketCount > minBuckets; i++) {
    pyramid.push(buildLodLevel(times, values, bucketCount));
    bucketCount = Math.max(minBuckets, Math.floor(bucketCount / 4));
  }
  pyramid.push(buildLodLevel(times, values, Math.min(bucketCount, n)));
  return pyramid;
}

/** Picks the coarsest LOD level whose bucket count still gives >= targetPxPerBucket at the given pixel width. */
export function pickLodLevel(pyramid, visibleDurationS, pixelsPerSecond, targetPxPerBucket = 2) {
  const widthPx = visibleDurationS * pixelsPerSecond;
  for (const level of pyramid) {
    const pxPerBucket = widthPx / Math.max(1, level.times.length);
    if (pxPerBucket >= targetPxPerBucket) return level;
  }
  return pyramid[pyramid.length - 1];
}

/**
 * Merges consecutive points that fall in the same color bucket into runs, so the map only needs one
 * polyline per run instead of one per point/segment (see joinfs-map-websocket-webcomponent's
 * `_shouldSavePoint`, which uses the same "color bucket changed" trigger for its own trail decimation,
 * but there draws one polyline per 2-point segment - too many layers for a long static track).
 * `points` is [{lat, lon, colorKey, color}], already decimated to a reasonable point count.
 */
export function buildColoredRuns(points) {
  const runs = [];
  let current = null;
  for (const p of points) {
    if (!current || current.colorKey !== p.colorKey) {
      current = { color: p.color, colorKey: p.colorKey, latlngs: [[p.lat, p.lon]] };
      runs.push(current);
    } else {
      current.latlngs.push([p.lat, p.lon]);
    }
  }
  // ensure runs connect visually (each run's first point = previous run's last point)
  for (let i = 1; i < runs.length; i++) {
    const prevLast = runs[i - 1].latlngs[runs[i - 1].latlngs.length - 1];
    runs[i].latlngs.unshift(prevLast);
  }
  return runs;
}

/** Simple stride-based decimation for very long tracks, applied before buildColoredRuns for the map. */
export function decimateStride(frames, maxPoints) {
  const n = frames.times.length;
  if (n <= maxPoints) return Array.from({ length: n }, (_, i) => i);
  const stride = Math.ceil(n / maxPoints);
  const idx = [];
  for (let i = 0; i < n; i += stride) idx.push(i);
  if (idx[idx.length - 1] !== n - 1) idx.push(n - 1);
  return idx;
}
