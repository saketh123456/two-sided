// Result charts: profit histograms, inventory fans, drawdown CDFs.
// Each item: { id, label, finalPnl, ddSorted, inventoryBands, sampleInventory, summary }.

import { el, frame, line, niceMax, pathFrom, placeTip, pointer, scale, text, ticks } from './svg.js';
import { fmt, fmtInt, fmtPct, fmtSigned, fmtTick } from './format.js';
import { percentileSorted } from './metrics.js';

const swatch = (id) => `<span class="sw s-${id}"></span>`;

/* ---------- Profit distribution: small multiples sharing x ---------- */
export function renderPnl(container, items) {
  const narrow = container.clientWidth < 520;
  const panelH = narrow ? 104 : 118;
  const gapH = 14;
  const top = 4;
  const axisH = 40;
  const ml = 46;
  const mr = 12;
  const H = top + items.length * (panelH + gapH) - gapH + axisH;
  const { svg, w, tip } = frame(container, H);

  let total = 0;
  for (const it of items) total += it.finalPnl.length;
  const all = new Float64Array(total);
  let o = 0;
  for (const it of items) { all.set(it.finalPnl, o); o += it.finalPnl.length; }
  all.sort();
  let lo = percentileSorted(all, 0.001);
  let hi = percentileSorted(all, 0.999);
  if (!(hi > lo)) { lo -= 1; hi += 1; }
  const nb = narrow ? 36 : 60;
  const bw = (hi - lo) / nb;

  const counts = items.map((it) => {
    const c = new Int32Array(nb);
    for (const v of it.finalPnl) {
      let b = Math.floor((v - lo) / bw);
      if (b < 0) b = 0; else if (b >= nb) b = nb - 1;
      c[b]++;
    }
    return c;
  });
  let cmax = 0;
  for (const c of counts) for (const v of c) if (v > cmax) cmax = v;
  const ymax = niceMax(cmax);

  const x = scale(lo, hi, ml, w - mr);
  const xt = ticks(lo, hi, narrow ? 4 : 8);
  const pxPerBin = (w - ml - mr) / nb;
  const gap = pxPerBin > 6 ? 2 : pxPerBin > 3 ? 1 : 0;
  const bars = [];

  items.forEach((it, pi) => {
    const y0 = top + pi * (panelH + gapH);
    const plotTop = y0 + 26;
    const plotBottom = y0 + panelH;
    const y = scale(0, ymax, plotBottom, plotTop);
    const g = el('g', { class: `s-${it.id}` }, svg);

    const grid = el('g', { class: 'grid' }, g);
    for (const t of xt) line(grid, x(t), plotTop, x(t), plotBottom);
    line(grid, ml, y(ymax), w - mr, y(ymax));

    const title = text(g, ml, y0 + 13, it.label, { class: 't-strong' });
    const s = it.summary;
    const stats = text(g, ml, y0 + 13, `mean ${fmt(s.meanPnl, 1)}, sd ${fmt(s.stdPnl, 1)}, loss in ${fmtPct(s.pLoss, 2)} of sessions`);
    stats.setAttribute('x', ml + title.getComputedTextLength() + 10);

    text(g, ml - 8, y(ymax) + 4, fmtInt(ymax), { 'text-anchor': 'end' });
    text(g, ml - 8, plotBottom, '0', { 'text-anchor': 'end' });

    const row = [];
    const c = counts[pi];
    for (let b = 0; b < nb; b++) {
      if (!c[b]) { row.push(null); continue; }
      const yy = y(c[b]);
      row.push(el('rect', {
        class: 'bar',
        style: `--i:${b + pi * 8}`,
        x: (x(lo + b * bw) + gap / 2).toFixed(2),
        y: yy.toFixed(2),
        width: Math.max(1, pxPerBin - gap).toFixed(2),
        height: Math.max(0.5, plotBottom - yy).toFixed(2),
      }, g));
    }
    bars.push(row);

    el('g', { class: 'axis' }, g).appendChild(el('line', { x1: ml, x2: w - mr, y1: plotBottom, y2: plotBottom }));
    if (lo < 0 && hi > 0) line(g, x(0), plotTop - 4, x(0), plotBottom, { class: 'zero' });
    if (s.meanPnl > lo && s.meanPnl < hi) line(g, x(s.meanPnl), plotTop - 4, x(s.meanPnl), plotBottom, { class: 'mean' });
  });

  const axisY = H - axisH + 16;
  for (const t of xt) text(svg, x(t), axisY, fmtTick(t), { 'text-anchor': 'middle' });
  text(svg, (ml + w - mr) / 2, H - 4, 'Final profit per session', { 'text-anchor': 'middle', class: 't-ink' });

  const hit = el('rect', { class: 'hit', x: ml, y: 0, width: w - ml - mr, height: H - axisH }, svg);
  let lit = null;
  const clear = () => {
    if (lit) for (const r of lit) if (r) r.classList.remove('dim');
    lit = null;
    tip.hidden = true;
  };
  hit.addEventListener('pointermove', (e) => {
    const p = pointer(e, svg, container, w);
    const b = Math.floor((x.invert(p.x) - lo) / bw);
    const pi = Math.floor((p.y - top) / (panelH + gapH));
    if (b < 0 || b >= nb || pi < 0 || pi >= items.length) return clear();
    if (lit !== bars[pi]) { clear(); lit = bars[pi]; }
    lit.forEach((r, i) => r && r.classList.toggle('dim', i !== b));
    const it = items[pi];
    const n = counts[pi][b];
    const a = lo + b * bw;
    const range = b === 0 ? `Below ${fmt(a + bw, 1)}` : b === nb - 1 ? `Above ${fmt(a, 1)}` : `${fmt(a, 1)} to ${fmt(a + bw, 1)}`;
    placeTip(container, tip,
      `<div class="row"><b>${it.label}</b>${swatch(it.id)}</div>Profit ${range}<br>${fmtInt(n)} sessions (${fmtPct(n / it.finalPnl.length, 1)})`,
      p.cx, p.cy);
  });
  hit.addEventListener('pointerleave', clear);
}

/* ---------- Inventory over time: percentile fans ---------- */
export function renderInventory(container, times, items) {
  const cw = container.clientWidth;
  const cols = cw >= 760 ? items.length : 1;
  const rows = Math.ceil(items.length / cols);
  const panelH = cols === 1 ? 190 : 250;
  const gapX = 22;
  const gapY = 26;
  const ml = 34;
  const mr = 8;
  const titleH = 24;
  const axisH = 36;
  const cellH = titleH + panelH + axisH;
  const H = rows * cellH + (rows - 1) * gapY;
  const { svg, w, tip } = frame(container, H);
  const pw = (w - (cols - 1) * gapX) / cols;

  let m = 1;
  for (const it of items) {
    for (const v of it.inventoryBands.p5) m = Math.max(m, Math.abs(v));
    for (const v of it.inventoryBands.p95) m = Math.max(m, Math.abs(v));
    for (const s of it.sampleInventory) for (const v of s) m = Math.max(m, Math.abs(v));
  }
  m = niceMax(m);
  const tmax = times[times.length - 1];
  const panels = [];

  items.forEach((it, i) => {
    const cx0 = (i % cols) * (pw + gapX);
    const cy0 = Math.floor(i / cols) * (cellH + gapY);
    const x = scale(0, tmax, cx0 + ml, cx0 + pw - mr);
    const y = scale(-m, m, cy0 + titleH + panelH, cy0 + titleH);
    const g = el('g', { class: `s-${it.id}` }, svg);

    const grid = el('g', { class: 'grid' }, g);
    const yt = ticks(-m, m, 4);
    for (const t of yt) {
      line(grid, x(0), y(t), x(tmax), y(t));
      text(g, x(0) - 6, y(t) + 4, fmtTick(t), { 'text-anchor': 'end' });
    }
    for (const t of ticks(0, tmax, 4)) text(g, x(t), cy0 + titleH + panelH + 16, fmtTick(t), { 'text-anchor': 'middle' });
    text(g, (x(0) + x(tmax)) / 2, cy0 + cellH - 4, 'Time through the session', { 'text-anchor': 'middle', class: 't-ink' });

    const title = text(g, cx0 + ml, cy0 + 14, it.label, { class: 't-strong' });
    const stat = text(g, 0, cy0 + 14, `average |inventory| ${fmt(it.summary.meanAbsInv, 2)}`);
    stat.setAttribute('x', cx0 + ml + title.getComputedTextLength() + 10);

    const B = it.inventoryBands;
    const area = (a, b) => {
      const up = [], dn = [];
      for (let k = 0; k < times.length; k++) up.push([x(times[k]), y(a[k])]);
      for (let k = times.length - 1; k >= 0; k--) dn.push([x(times[k]), y(b[k])]);
      return `${pathFrom(up)}L${pathFrom(dn).slice(1)}Z`;
    };
    el('path', { class: 'band-outer', d: area(B.p95, B.p5) }, g);
    el('path', { class: 'band-inner', d: area(B.p75, B.p25) }, g);
    for (const s of it.sampleInventory) {
      el('path', { class: 'sample', d: pathFrom(Array.from(s, (v, k) => [x(times[k]), y(v)])) }, g);
    }
    el('path', { class: 'line', pathLength: 1, d: pathFrom(Array.from(B.p50, (v, k) => [x(times[k]), y(v)])) }, g);
    line(g, x(0), y(0), x(tmax), y(0), { class: 'zero' });

    const cross = line(g, 0, y(m), 0, y(-m), { class: 'crosshair', visibility: 'hidden' });
    panels.push({ it, x, y, cross, x0: x(0), x1: x(tmax), y0: y(m), y1: y(-m) });
  });

  const hideAll = () => {
    for (const p of panels) p.cross.setAttribute('visibility', 'hidden');
    tip.hidden = true;
  };
  svg.addEventListener('pointermove', (e) => {
    const p = pointer(e, svg, container, w);
    const panel = panels.find((q) => p.x >= q.x0 && p.x <= q.x1 && p.y >= q.y0 && p.y <= q.y1);
    if (!panel) return hideAll();
    const t = Math.min(tmax, Math.max(0, panel.x.invert(p.x)));
    let k = 0;
    while (k < times.length - 1 && Math.abs(times[k + 1] - t) < Math.abs(times[k] - t)) k++;
    for (const q of panels) {
      const xx = q.x(times[k]);
      q.cross.setAttribute('x1', xx);
      q.cross.setAttribute('x2', xx);
      q.cross.setAttribute('visibility', 'visible');
    }
    const B = panel.it.inventoryBands;
    placeTip(container, tip,
      `<div class="row"><b>${panel.it.label}</b>${swatch(panel.it.id)}</div>` +
      `<div class="row"><span class="k">Time</span>${fmt(times[k], 2)}</div>` +
      `<div class="row"><span class="k">Median</span>${fmtSigned(B.p50[k], 0)}</div>` +
      `<div class="row"><span class="k">Middle 50%</span>${fmtSigned(B.p25[k], 0)} to ${fmtSigned(B.p75[k], 0)}</div>` +
      `<div class="row"><span class="k">Middle 90%</span>${fmtSigned(B.p5[k], 0)} to ${fmtSigned(B.p95[k], 0)}</div>`,
      p.cx, p.cy);
  });
  svg.addEventListener('pointerleave', hideAll);
}

/* ---------- Drawdown: empirical CDFs ---------- */
function shareAtOrBelow(sortedArr, v) {
  let lo = 0, hi = sortedArr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedArr[mid] <= v) lo = mid + 1; else hi = mid;
  }
  return lo / sortedArr.length;
}

export function renderDrawdown(container, items) {
  const legendHtml = `<ul class="legend">${items.map((it) => `<li class="s-${it.id}"><span class="sw"></span>${it.label}</li>`).join('')}</ul>`;
  const H = container.clientWidth < 520 ? 260 : 320;
  const { svg, w, tip } = frame(container, H);
  container.insertAdjacentHTML('afterbegin', legendHtml);

  const ml = 46, mr = 16, mt = 10, mb = 40;
  let xmax = 0;
  for (const it of items) xmax = Math.max(xmax, percentileSorted(it.ddSorted, 0.999));
  xmax = niceMax(xmax || 1);
  const x = scale(0, xmax, ml, w - mr);
  const y = scale(0, 1, H - mb, mt);

  const grid = el('g', { class: 'grid' }, svg);
  for (const t of ticks(0, xmax, 6)) {
    line(grid, x(t), y(0), x(t), y(1));
    text(svg, x(t), H - mb + 16, fmtTick(t), { 'text-anchor': 'middle' });
  }
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    line(grid, x(0), y(t), x(xmax), y(t));
    text(svg, ml - 8, y(t) + 4, `${t * 100}%`, { 'text-anchor': 'end' });
  }
  text(svg, (ml + w - mr) / 2, H - 4, 'Largest peak-to-trough fall in a session', { 'text-anchor': 'middle', class: 't-ink' });
  line(svg, x(0), y(0.95), x(xmax), y(0.95), { class: 'ref' });
  text(svg, x(xmax), y(0.95) + 15, '95% of sessions', { 'text-anchor': 'end' });

  // Curves bunch together near the origin, so identity comes from the legend and tooltip
  // rather than direct labels that would cross other curves.
  const dots = [];
  items.forEach((it) => {
    const g = el('g', { class: `s-${it.id}` }, svg);
    const pts = [];
    for (let k = 0; k <= 400; k++) {
      const p = k / 400;
      pts.push([x(Math.min(xmax, percentileSorted(it.ddSorted, p))), y(p)]);
    }
    el('path', { class: 'line', pathLength: 1, d: pathFrom(pts) }, g);
    dots.push(el('circle', { class: 'dot', r: 4, visibility: 'hidden' }, g));
  });

  const cross = line(svg, 0, y(0), 0, y(1), { class: 'crosshair', visibility: 'hidden' });
  const hit = el('rect', { class: 'hit', x: ml, y: mt, width: w - ml - mr, height: H - mt - mb }, svg);
  hit.addEventListener('pointermove', (e) => {
    const p = pointer(e, svg, container, w);
    const v = Math.max(0, Math.min(xmax, x.invert(p.x)));
    cross.setAttribute('x1', x(v));
    cross.setAttribute('x2', x(v));
    cross.setAttribute('visibility', 'visible');
    let rows = '';
    items.forEach((it, i) => {
      const s = shareAtOrBelow(it.ddSorted, v);
      dots[i].setAttribute('cx', x(v));
      dots[i].setAttribute('cy', y(s));
      dots[i].setAttribute('visibility', 'visible');
      rows += `<div class="row"><span class="k">${swatch(it.id)}${it.label}</span>${fmtPct(s, 1)}</div>`;
    });
    placeTip(container, tip, `<b>Drawdown at most ${fmt(v, 1)}</b>${rows}`, p.cx, p.cy);
  });
  hit.addEventListener('pointerleave', () => {
    cross.setAttribute('visibility', 'hidden');
    for (const d of dots) d.setAttribute('visibility', 'hidden');
    tip.hidden = true;
  });
}
