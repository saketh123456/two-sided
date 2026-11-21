// Minimal SVG + scale helpers shared by the charts.

const NS = 'http://www.w3.org/2000/svg';

export function el(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}

export function text(parent, x, y, str, attrs = {}) {
  const t = el('text', { x, y, ...attrs }, parent);
  t.textContent = str;
  return t;
}

export function line(parent, x1, y1, x2, y2, attrs = {}) {
  return el('line', { x1, y1, x2, y2, ...attrs }, parent);
}

export function scale(d0, d1, r0, r1) {
  const span = d1 - d0 || 1;
  const f = (x) => r0 + ((x - d0) / span) * (r1 - r0);
  f.invert = (y) => d0 + ((y - r0) / (r1 - r0)) * span;
  return f;
}

function niceStep(span, count) {
  const raw = span / Math.max(1, count);
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p;
}

export function ticks(min, max, count = 5) {
  if (!(max > min)) return [min];
  const s = niceStep(max - min, count);
  const out = [];
  for (let v = Math.ceil(min / s) * s; v <= max + s * 1e-9; v += s) out.push(Math.round(v / s) * s);
  return out;
}

export function niceMax(x) {
  if (!(x > 0)) return 1;
  const s = niceStep(x, 4);
  return Math.ceil(x / s) * s;
}

/** Clear a container and give it an SVG sized to its width plus a tooltip element. */
export function frame(container, height, { minWidth = 280 } = {}) {
  container.replaceChildren();
  const w = Math.max(minWidth, Math.floor(container.clientWidth));
  // viewBox only: the SVG scales to its container instead of forcing an intrinsic width.
  const svg = el('svg', { viewBox: `0 0 ${w} ${height}` });
  container.appendChild(svg);
  const tip = document.createElement('div');
  tip.className = 'tip';
  tip.hidden = true;
  container.appendChild(tip);
  return { svg, w, h: height, tip };
}

/** Pointer position in SVG units, plus container-relative pixels for the tooltip. */
export function pointer(evt, svg, container, w) {
  const r = svg.getBoundingClientRect();
  const c = container.getBoundingClientRect();
  const k = w / r.width;
  return {
    x: (evt.clientX - r.left) * k,
    y: (evt.clientY - r.top) * k,
    cx: evt.clientX - c.left,
    cy: evt.clientY - c.top,
  };
}

export function placeTip(container, tip, html, cx, cy) {
  tip.innerHTML = html;
  tip.hidden = false;
  const cw = container.clientWidth;
  const tw = tip.offsetWidth;
  const th = tip.offsetHeight;
  let left = cx + 14;
  if (left + tw > cw) left = cx - 14 - tw;
  if (left < 0) left = Math.max(0, Math.min(cw - tw, cx - tw / 2));
  let top = cy - th - 12;
  if (top < 0) top = cy + 16;
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

export function pathFrom(points) {
  let d = '';
  for (let i = 0; i < points.length; i++) d += `${i ? 'L' : 'M'}${points[i][0].toFixed(2)},${points[i][1].toFixed(2)}`;
  return d;
}
