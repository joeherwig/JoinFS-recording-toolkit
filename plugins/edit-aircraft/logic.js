// Pure helpers of the edit-aircraft plugin (no DOM, so they run under node --test).

export const ICAO_RE = /^[A-Z0-9]{2,4}$/;
export const MAX_CALLSIGN = 16;
export const MAX_NICKNAME = 32;
export const M_PER_FT = 0.3048;

/** Indices of the frames that carry a position (event and variable frames share the arrays with zeros). */
export function fixIndices(track) {
  const { lat, lon } = track.frames;
  const out = [];
  for (let i = 0; i < lat.length; i++) {
    if (Number.isFinite(lat[i]) && Number.isFinite(lon[i]) && !(lat[i] === 0 && lon[i] === 0)) out.push(i);
  }
  return out;
}

/** Position and altitude (metres) of the first frame with a position, or null if there is none. */
export function firstFix(track) {
  const idx = fixIndices(track);
  if (!idx.length) return null;
  const f = track.frames;
  return { lat: f.lat[idx[0]], lon: f.lon[idx[0]], alt: f.alt[idx[0]] };
}

/**
 * Terrain height in metres at one position from Open-Meteo's key-free elevation API (Copernicus 90 m model), the same service
 * the GPX importer uses; null on any failure (offline, blocked, rate-limited, timeout). The position is rounded to 4 decimals (about 11 m).
 */
export async function lookupElevation(lat, lon, { fetch: doFetch = globalThis.fetch, timeoutMs = 4000 } = {}) {
  if (typeof doFetch !== 'function') return null;
  const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ac ? setTimeout(() => ac.abort(), timeoutMs) : null;
  try {
    const url = `https://api.open-meteo.com/v1/elevation?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}`;
    const res = await doFetch(url, { signal: ac ? ac.signal : undefined });
    if (!res.ok) return null;
    const data = await res.json();
    const m = data && Array.isArray(data.elevation) ? data.elevation[0] : undefined;
    return typeof m === 'number' && Number.isFinite(m) ? m : null;
  } catch { return null; } finally { if (timer) clearTimeout(timer); }
}

/** Altitude (metres) of the first frame with a position, or null if there is none. */
export function firstAltitudeM(track) {
  const idx = fixIndices(track);
  return idx.length ? track.frames.alt[idx[0]] : null;
}

export const toUnit = (metres, unit) => (unit === 'ft' ? metres / M_PER_FT : metres);
export const toMetres = (value, unit) => (unit === 'ft' ? value * M_PER_FT : value);

/** Metres to add to every position frame so the first one ends up at `target` (given in `unit`). */
export function altitudeDeltaM(firstAltM, target, unit) {
  return toMetres(target, unit) - firstAltM;
}

/** Parses a typed altitude ("1,247", "1247.5"); NaN if it is not a number. */
export function parseAltitude(text) {
  const s = String(text ?? '').trim().replace(/\s/g, '').replace(',', '.');
  return s !== '' && /^-?\d*\.?\d+$/.test(s) ? Number(s) : NaN;
}

/** Error keys (locale keys under `err.`) per field; an empty object means valid. `altitude` may be omitted when the track has none. */
export function validate(values) {
  const errors = {};
  const icao = String(values.icaoType ?? '').trim().toUpperCase();
  if (icao !== '' && !ICAO_RE.test(icao)) errors.icaoType = 'err.icao';
  if (String(values.callsign ?? '').trim().length > MAX_CALLSIGN) errors.callsign = 'err.length';
  if (String(values.nickname ?? '').trim().length > MAX_NICKNAME) errors.nickname = 'err.length';
  if (values.altitude !== undefined && values.altitude !== null && values.altitude !== '' && !Number.isFinite(values.altitude)) errors.altitude = 'err.altitude';
  return errors;
}

/** The text fields whose normalised value differs from `before`; normalised = trimmed, ICAO upper-cased. */
export function diff(before, after) {
  const norm = { icaoType: (v) => String(v ?? '').trim().toUpperCase(), callsign: (v) => String(v ?? '').trim(), nickname: (v) => String(v ?? '').trim() };
  const out = {};
  for (const key of Object.keys(norm)) {
    if (after[key] === undefined) continue;
    const next = norm[key](after[key]);
    if (next !== String(before[key] ?? '')) out[key] = next;
  }
  return out;
}
