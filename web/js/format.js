const cache = new Map();
function nf(d) {
  if (!cache.has(d)) cache.set(d, new Intl.NumberFormat('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
  return cache.get(d);
}
const MINUS = '−';

/** Fixed decimals with a true minus sign. */
export function fmt(x, d = 2) {
  if (!Number.isFinite(x)) return '–';
  const s = nf(d).format(Math.abs(x));
  return x < 0 && s !== nf(d).format(0) ? MINUS + s : s;
}

export function fmtSigned(x, d = 2) {
  if (!Number.isFinite(x)) return '–';
  const s = fmt(Math.abs(x), d);
  if (s === fmt(0, d)) return s;
  return (x > 0 ? '+' : MINUS) + s;
}

export function fmtPct(x, d = 1) {
  return Number.isFinite(x) ? `${fmt(x * 100, d)}%` : '–';
}

export function fmtInt(x) {
  return new Intl.NumberFormat('en-US').format(x);
}

export function fmtMs(ms) {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${fmt(ms / 1000, 1)} s`;
}

/** Short axis label: no trailing zeros, true minus sign. */
export function fmtTick(x) {
  const r = Math.round(x * 1e6) / 1e6;
  const a = Math.abs(r);
  const s = a >= 1000 ? fmtInt(a) : String(a);
  return r < 0 ? MINUS + s : s;
}
