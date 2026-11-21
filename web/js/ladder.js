// The live quote ladder and the arrival-rate curve. Both use the engine's own
// quoteOffsets/arrivalRate, so what you see here is exactly what the simulation does.
//
// The ladder is built once per layout and then updated in place, so bars glide
// (CSS transitions on transform/width) as the inventory slider moves.

import { arrivalRate, fillProbability, quoteOffsets } from './engine.js';
import { el, frame, line, pathFrom, placeTip, pointer, scale, text, ticks } from './svg.js';
import { fmt, fmtSigned, fmtTick } from './format.js';

const Q_RANGE = 15;
const ladders = new WeakMap();

function layoutKey(w, H, dom, market, strategies) {
  return JSON.stringify([w, H, dom.toFixed(6), market.A, market.k,
    strategies.map((s) => [s.id, s.kind, s.halfSpread, s.skew, s.maxInventory])]);
}

function buildLadder(container, { market, strategies }) {
  const narrow = container.clientWidth < 560;
  const H = narrow ? 360 : 340;
  const ml = narrow ? 44 : 64;
  const mt = 30;
  const mb = 34;
  const gapX = narrow ? 6 : 12;

  let dom = 0;
  for (const s of strategies) {
    for (const qq of [-Q_RANGE, Q_RANGE]) {
      const o = quoteOffsets(s, qq);
      dom = Math.max(dom, Math.abs(o.bidOffset), Math.abs(o.askOffset));
    }
  }
  dom = Math.max(dom * 1.12, 0.25);

  const w = Math.max(280, Math.floor(container.clientWidth));
  const key = layoutKey(w, H, dom, market, strategies);
  const existing = ladders.get(container);
  if (existing && existing.key === key && container.contains(existing.svg)) return existing;

  const { svg } = frame(container, H);
  svg.classList.add('ladder');
  const n = strategies.length;
  const colW = (w - ml - (n - 1) * gapX) / n;
  const y = scale(-dom, dom, H - mb, mt);

  const grid = el('g', { class: 'grid' }, svg);
  for (const t of ticks(-dom, dom, narrow ? 4 : 6)) {
    line(grid, ml, y(t), w, y(t));
    if (Math.abs(t) > 1e-9) text(svg, ml - 8, y(t) + 4, t > 0 ? `+${fmtTick(t)}` : fmtTick(t), { 'text-anchor': 'end' });
  }
  text(svg, ml - 8, y(0) + 4, 'Mid', { 'text-anchor': 'end', class: 't-strong' });
  if (!narrow) text(svg, 0, mt - 14, 'Price vs mid', { class: 't-ink' });

  const maxBar = colW - 20;
  const barH = 9;
  const cols = strategies.map((s, i) => {
    const x0 = ml + i * (colW + gapX);
    const g = el('g', { class: `s-${s.id}` }, svg);
    el('rect', { class: 'col-bg', x: x0, y: mt - 4, width: colW, height: H - mt - mb + 8, rx: 8 }, g);
    text(g, x0 + 10, mt - 14, s.label, { class: 't-strong' });

    // Unit-height stem scaled between the two quotes.
    const stem = el('rect', { class: 'stem', x: x0 + 10, y: 0, width: 1, height: 1 }, g);
    const resv = el('line', { class: 'resv', x1: x0 + 4, x2: x0 + colW - 4, y1: 0, y2: 0 }, g);

    const side = (above) => {
      const sg = el('g', { class: 'side' }, g);
      const bar = el('rect', { class: 'tick', x: x0 + 10, y: -barH / 2, width: 6, height: barH, rx: barH / 2 }, sg);
      el('rect', { class: 'tick-off', x: x0 + 10, y: -barH / 2, width: maxBar * 0.5, height: barH, rx: barH / 2 }, sg);
      const ly = above ? -barH / 2 - 18 : barH / 2 + 14;
      const l1 = text(sg, x0 + 10, ly, '', { class: 't-ink' });
      const l2 = text(sg, x0 + 10, ly + 13, '');
      return { g: sg, bar, l1, l2 };
    };
    // Narrow columns get a two-line footer instead of one long line.
    const foot = text(g, x0 + 10, narrow ? H - 18 : H - 10, '');
    const foot2 = text(g, x0 + 10, H - 5, '');
    return { s, stem, resv, ask: side(true), bid: side(false), foot, foot2 };
  });
  line(svg, ml, y(0), w, y(0), { class: 'mid-line' });

  const state = { key, svg, y, maxBar, market, cols, narrow };
  ladders.set(container, state);
  return state;
}

function setSide(side, { on, off, name, lam, A, maxBar, y, limit, narrow }) {
  side.g.style.transform = `translate(0px, ${y.toFixed(2)}px)`;
  side.g.classList.toggle('off', !on);
  const len = Math.max(6, (lam / A) * maxBar);
  side.bar.setAttribute('width', len.toFixed(2));
  side.bar.style.width = `${len.toFixed(2)}px`;
  side.l1.textContent = on ? `${name} ${off >= 0 ? '' : 'through mid '}${fmtSigned(name === 'Ask' ? off : -off, 2)}` : `${name} not quoted`;
  if (narrow) side.l2.textContent = on ? `${fmt(lam, 0)} per session` : `limit of ${limit} hit`;
  else side.l2.textContent = on ? `${fmt(lam, 0)} orders per session` : `at the ${limit}-unit limit`;
}

export function renderLadder(container, { market, strategies, q }) {
  const st = buildLadder(container, { market, strategies });
  const { y, maxBar, narrow } = st;
  for (const c of st.cols) {
    const o = quoteOffsets(c.s, q);
    const askY = y(o.askOffset);
    const bidY = y(-o.bidOffset);
    const centre = (o.askOffset - o.bidOffset) / 2;

    setSide(c.ask, { on: o.askOn, off: o.askOffset, name: 'Ask', lam: arrivalRate(o.askOffset, market.A, market.k), A: market.A, maxBar, y: askY, limit: c.s.maxInventory, narrow });
    setSide(c.bid, { on: o.bidOn, off: o.bidOffset, name: 'Bid', lam: arrivalRate(o.bidOffset, market.A, market.k), A: market.A, maxBar, y: bidY, limit: c.s.maxInventory, narrow });

    c.stem.style.transform = `translate(0px, ${askY.toFixed(2)}px) scale(1, ${Math.max(0.001, bidY - askY).toFixed(2)})`;
    c.stem.style.opacity = o.askOn && o.bidOn ? '1' : '0';
    c.resv.style.transform = `translate(0px, ${y(centre).toFixed(2)}px)`;
    c.resv.style.opacity = c.s.kind === 'skew' && q !== 0 ? '1' : '0';

    const spread = `Spread ${fmt(o.askOffset + o.bidOffset, 2)}`;
    const centreText = c.s.kind === 'skew' ? `centre ${fmtSigned(centre, 2)}` : '';
    if (narrow) {
      c.foot.textContent = spread;
      c.foot2.textContent = centreText;
    } else {
      c.foot.textContent = centreText ? `${spread}, ${centreText}` : spread;
    }
  }
  container.setAttribute('aria-label', st.cols.map((c) => {
    const o = quoteOffsets(c.s, q);
    const ask = o.askOn ? `ask ${fmtSigned(o.askOffset, 2)}` : 'no ask';
    const bid = o.bidOn ? `bid ${fmtSigned(-o.bidOffset, 2)}` : 'no bid';
    return `${c.s.label}: ${bid}, ${ask}`;
  }).join('; ') + ` with inventory ${q}.`);
}

export function renderLambda(container, { market, strategies, q }) {
  const H = 250;
  const { svg, w, tip } = frame(container, H);
  const ml = 44, mr = 12, mt = 10, mb = 38;
  const h = strategies[0].halfSpread;
  const xmax = Math.max(3 / market.k, h * 2.4, 0.5);
  const x = scale(0, xmax, ml, w - mr);
  const y = scale(0, market.A, H - mb, mt);
  const dt = market.horizon / market.nSteps;

  const grid = el('g', { class: 'grid' }, svg);
  for (const t of ticks(0, xmax, 5)) {
    line(grid, x(t), y(0), x(t), y(market.A));
    text(svg, x(t), H - mb + 16, fmtTick(t), { 'text-anchor': 'middle' });
  }
  for (const t of ticks(0, market.A, 4)) {
    line(grid, x(0), y(t), x(xmax), y(t));
    text(svg, ml - 8, y(t) + 4, fmtTick(t), { 'text-anchor': 'end' });
  }
  text(svg, (ml + w - mr) / 2, H - 4, 'Distance from the mid', { 'text-anchor': 'middle', class: 't-ink' });

  const pts = [];
  for (let i = 0; i <= 160; i++) {
    const d = (i / 160) * xmax;
    pts.push([x(d), y(arrivalRate(d, market.A, market.k))]);
  }
  el('path', { d: pathFrom(pts), style: 'fill:none;stroke:var(--ink);stroke-width:2' }, svg);

  const dStar = 1 / market.k;
  if (dStar <= xmax) {
    line(svg, x(dStar), y(0), x(dStar), y(market.A), { class: 'ref' });
    text(svg, x(dStar) + 6, y(market.A) + 12, `1/k = ${fmt(dStar, 2)}`);
  }

  const marks = [];
  for (const s of strategies) {
    const o = quoteOffsets(s, q);
    if (o.bidOn) marks.push({ s, side: 'Bid', d: Math.max(0, o.bidOffset) });
    if (o.askOn) marks.push({ s, side: 'Ask', d: Math.max(0, o.askOffset) });
  }
  marks.sort((a, b) => a.d - b.d);
  let lastX = -Infinity, stack = 0;
  for (const m of marks) {
    if (m.d > xmax) continue;
    const xx = x(m.d);
    stack = Math.abs(xx - lastX) < 3 ? stack + 1 : 0;
    lastX = xx;
    const g = el('g', { class: `s-${m.s.id}` }, svg);
    el('circle', {
      class: 'dot', cx: xx, cy: y(arrivalRate(m.d, market.A, market.k)) - stack * 9, r: 4.5,
      style: m.side === 'Ask' ? 'fill:var(--panel);stroke:var(--c);stroke-width:2' : null,
    }, g);
  }

  const cross = line(svg, 0, y(0), 0, y(market.A), { class: 'crosshair', visibility: 'hidden' });
  const hit = el('rect', { class: 'hit', x: ml, y: mt, width: w - ml - mr, height: H - mt - mb }, svg);
  hit.addEventListener('pointermove', (e) => {
    const p = pointer(e, svg, container, w);
    const d = Math.max(0, Math.min(xmax, x.invert(p.x)));
    cross.setAttribute('x1', x(d));
    cross.setAttribute('x2', x(d));
    cross.setAttribute('visibility', 'visible');
    const lam = arrivalRate(d, market.A, market.k);
    const near = marks.filter((m) => Math.abs(x(m.d) - p.x) < 6)
      .map((m) => `<div class="row"><span class="k"><span class="sw s-${m.s.id}"></span>${m.s.label}</span>${m.side}</div>`).join('');
    placeTip(container, tip,
      `<b>Distance ${fmt(d, 2)}</b>` +
      `<div class="row"><span class="k">Orders per session</span>${fmt(lam, 1)}</div>` +
      `<div class="row"><span class="k">Fill chance per step</span>${fmt(fillProbability(d, market.A, market.k, dt) * 100, 2)}%</div>` +
      `<div class="row"><span class="k">Spread income per side</span>${fmt(d * lam, 1)}</div>` + near,
      p.cx, p.cy);
  });
  hit.addEventListener('pointerleave', () => {
    cross.setAttribute('visibility', 'hidden');
    tip.hidden = true;
  });
}
