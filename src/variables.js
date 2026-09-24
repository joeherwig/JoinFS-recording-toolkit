// Gear/flaps/light "system" variable decoding, ported from
// joinfs-gpx-to-jfs-webcomponent/src/joinfs-gpx-to-jfs.js (hashString, VU, ~line 503-520).
// JoinFS stores these as IntegerVariables/FloatVariables frames; the id is a hash of the
// (lower-cased) SimConnect variable name. The file itself never stores the human-readable name -
// only this fixed table lets us recognize and label the handful of variables we care about.

/** Ported verbatim from joinfs-gpx-to-jfs.js's hashString (djb2-style, matches JoinFS's own Variables.cs/Node.cs HashString). */
export function hashString(str) {
  let h1 = ((5381 << 16) + 5381) >>> 0, h2 = h1;
  for (let i = 0; i < str.length; i += 2) {
    h1 = (((h1 << 5) + h1) ^ str.charCodeAt(i)) >>> 0;
    if (i === str.length - 1) break;
    h2 = (((h2 << 5) + h2) ^ str.charCodeAt(i + 1)) >>> 0;
  }
  return (h1 + Math.imul(h2, 1566083941)) >>> 0;
}

const vuid = (name) => hashString(name.toLowerCase()) || 1;

export const VU = {
  gear: vuid('GEAR HANDLE POSITION'), // integer 0/1
  flaps: vuid('FLAPS HANDLE PERCENT'), // float 0..1
  lightStates: vuid('LIGHT STATES'), // integer bit mask - drives the simulator
  nav: vuid('LIGHT STATES1'),
  beacon: vuid('LIGHT STATES2'),
  landing: vuid('LIGHT STATES4'),
  taxi: vuid('LIGHT STATES8'),
  strobe: vuid('LIGHT STROBE'),
};

const LIGHT_NAMES = {
  [VU.nav]: 'Nav light',
  [VU.beacon]: 'Beacon light',
  [VU.landing]: 'Landing light',
  [VU.taxi]: 'Taxi light',
  [VU.strobe]: 'Strobe light',
};

/**
 * Formats a decoded IntegerVariables/FloatVariables entry into a human-readable event, or returns
 * null if the id isn't in the known table (still preserved byte-for-byte elsewhere, just not
 * surfaced as a marker).
 */
export function decodeKnownVariable(id, value) {
  if (id === VU.gear) return { variable: 'gear', label: value ? 'Gear: Down' : 'Gear: Up' };
  if (id === VU.flaps) {
    const pct = Math.round(value * 100);
    const desc = pct <= 0 ? 'Up' : pct >= 100 ? 'Full' : `${pct}%`;
    return { variable: 'flaps', label: `Flaps: ${desc}` };
  }
  if (id === VU.lightStates) return null; // the bit-mask itself isn't individually meaningful; per-bit mirrors below are
  const lightName = LIGHT_NAMES[id];
  if (lightName) return { variable: lightName, label: `${lightName}: ${value ? 'ON' : 'OFF'}` };
  return null;
}
