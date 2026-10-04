// Time text for the edit dialogs.

/** 3725.4 -> "01:02:05.4" (tenths only when present); parseClock is the forgiving inverse (h:mm:ss, m:ss or plain seconds). */
export function formatClock(sec) {
  const tenths = Math.round(Math.max(0, sec) * 10);
  const whole = Math.floor(tenths / 10), frac = tenths % 10;
  const p = (n) => String(n).padStart(2, '0');
  return `${p(Math.floor(whole / 3600))}:${p(Math.floor((whole % 3600) / 60))}:${p(whole % 60)}${frac ? '.' + frac : ''}`;
}
export function parseClock(text) {
  const parts = String(text).trim().replace(',', '.').split(':');
  if (!parts.length || parts.length > 3 || parts.some((x) => x === '' || !/^\d+(\.\d*)?$/.test(x))) return NaN;
  return parts.reduce((acc, x) => acc * 60 + Number(x), 0);
}
