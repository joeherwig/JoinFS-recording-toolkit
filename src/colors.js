// Stable per-track color assignment. Categorical, colorblind-friendlier palette (Tableau10-ish).

const PALETTE = [
  '#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f',
  '#edc948', '#b07aa1', '#ff9da7', '#9c755f', '#bab0ac',
];

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic color for a track id: same id always gets the same color within a session. */
export function colorForTrackId(id) {
  return PALETTE[hashStr(String(id)) % PALETTE.length];
}
