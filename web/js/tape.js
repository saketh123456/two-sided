// The hero "tape": one simulated session played back in real time.
//
// Top panel: the mid price with the inventory-skew strategy's bid and ask trailing it,
// and a mark wherever a market order filled one of its quotes.
// Bottom panel: inventory of all three strategies, on the same orders and prices
// (common random numbers, exactly as in the Monte Carlo run).
//
// The whole session is simulated up front from a seed, then revealed left to right.

import { Rng } from './rng.js';
import { fillProbability, quoteOffsets } from './engine.js';
import { fmt, fmtSigned } from './format.js';

const PLAY_MS = 17000;
const HOLD_MS = 2600;

export function simulateSession(market, strategies, seed) {
  const T = market.nSteps;
  const dt = market.horizon / T;
  const vol = market.sigma * Math.sqrt(dt);
  const rng = new Rng(seed);
  const z = new Float64Array(1);
  const mid = new Float64Array(T + 1);
  mid[0] = market.s0;
  const S = strategies.map((s) => ({
    s, q: 0, cash: 0,
    inv: new Int16Array(T + 1), pnl: new Float64Array(T + 1),
    bid: new Float64Array(T + 1), ask: new Float64Array(T + 1),
    fills: [],
  }));
  for (let t = 0; t < T; t++) {
    rng.fillNormal(z);
    const ub = rng.random();
    const ua = rng.random();
    for (const st of S) {
      const o = quoteOffsets(st.s, st.q);
      const b = mid[t] - o.bidOffset;
      const a = mid[t] + o.askOffset;
      st.bid[t] = o.bidOn ? b : NaN;
      st.ask[t] = o.askOn ? a : NaN;
      if (o.bidOn && ub < fillProbability(o.bidOffset, market.A, market.k, dt)) {
        st.q += 1; st.cash -= b; st.fills.push([t, b, 1]);
      }
      if (o.askOn && ua < fillProbability(o.askOffset, market.A, market.k, dt)) {
        st.q -= 1; st.cash += a; st.fills.push([t, a, -1]);
      }
    }
    mid[t + 1] = market.priceModel === 'binary' ? mid[t] + (z[0] >= 0 ? vol : -vol) : mid[t] + vol * z[0];
    for (const st of S) {
      st.inv[t + 1] = st.q;
      st.pnl[t + 1] = st.cash + st.q * mid[t + 1];
    }
  }
  for (const st of S) { st.bid[T] = st.bid[T - 1]; st.ask[T] = st.ask[T - 1]; }
  return { T, mid, S };
}

const css = (node, name) => getComputedStyle(node).getPropertyValue(name).trim();

export function createTape(root) {
  const canvas = root.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const stepOut = root.querySelector('[data-tape-step]');
  const rows = new Map([...root.querySelectorAll('[data-tape-row]')].map((r) => [r.dataset.tapeRow, {
    pnl: r.querySelector('[data-pnl]'), inv: r.querySelector('[data-inv]'),
  }]));
  const replayBtn = root.querySelector('[data-tape-replay]');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');

  let session = null;
  let key = '';
  let seed = 7;
  let started = 0;
  let raf = 0;
  let visible = true;
  let W = 0, H = 0, dpr = 1;
  let colors = {};
  let inputs = null;

  function readColors() {
    colors = {
      ink: css(root, '--ink'), ink2: css(root, '--ink-2'), muted: css(root, '--muted'),
      grid: css(root, '--grid'), hair: css(root, '--hair-strong'), bg: css(root, '--tape-bg') || css(root, '--bg'),
      fixed: css(root, '--series-fixed'), skew: css(root, '--series-skew'), limit: css(root, '--series-limit'),
      font: css(root, '--font'),
    };
  }

  function size() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = canvas.clientWidth;
    H = canvas.clientHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
  }

  function build() {
    session = simulateSession(inputs.market, inputs.strategies, seed);
    const { mid, S, T } = session;
    let lo = Infinity, hi = -Infinity;
    const sk = S.find((s) => s.s.id === 'skew') || S[0];
    for (let t = 0; t <= T; t++) {
      lo = Math.min(lo, mid[t], sk.bid[t] || mid[t]);
      hi = Math.max(hi, mid[t], sk.ask[t] || mid[t]);
    }
    const pad = (hi - lo) * 0.08 + 0.2;
    session.lo = lo - pad; session.hi = hi + pad;
    let qmax = 3;
    for (const st of S) for (let t = 0; t <= T; t++) qmax = Math.max(qmax, Math.abs(st.inv[t]));
    session.qmax = Math.ceil(qmax * 1.15);
    session.focus = sk;
  }

  function draw(progress) {
    const { T, mid, S, lo, hi, qmax, focus } = session;
    const n = Math.max(1, Math.min(T, Math.floor(progress * T)));
    const narrow = W < 560;
    const L = narrow ? 8 : 0, R = narrow ? 58 : 84;
    const top = 14;
    const priceH = Math.round(H * 0.6);
    const gap = 30;
    const invTop = top + priceH + gap;
    const invH = H - invTop - 8;
    const x = (t) => L + (t / T) * (W - L - R);
    const py = (p) => top + (1 - (p - lo) / (hi - lo)) * priceH;
    const iy = (q) => invTop + invH / 2 - (q / qmax) * (invH / 2);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.font = `500 11px ${colors.font}`;
    ctx.textBaseline = 'middle';

    // Grid: price levels every whole unit, faint.
    ctx.strokeStyle = colors.grid;
    ctx.lineWidth = 1;
    ctx.fillStyle = colors.muted;
    const stepP = (hi - lo) > 12 ? 5 : (hi - lo) > 5 ? 2 : 1;
    for (let p = Math.ceil(lo / stepP) * stepP; p <= hi; p += stepP) {
      const yy = Math.round(py(p)) + 0.5;
      ctx.beginPath(); ctx.moveTo(L, yy); ctx.lineTo(W - R, yy); ctx.stroke();
      ctx.textAlign = 'left';
      if (Math.abs(yy - py(mid[n])) > 14) ctx.fillText(fmt(p, 0), W - R + 10, yy);
    }
    // Inventory zero line and limits.
    ctx.beginPath(); ctx.moveTo(L, Math.round(iy(0)) + 0.5); ctx.lineTo(W - R, Math.round(iy(0)) + 0.5); ctx.stroke();
    ctx.fillText('Flat', W - R + 10, iy(0));
    ctx.fillText(`+${qmax}`, W - R + 10, iy(qmax) + 4);
    ctx.fillText(`−${qmax}`, W - R + 10, iy(-qmax) - 4);
    ctx.fillStyle = colors.ink2;
    ctx.textAlign = 'left';
    ctx.fillText('Inventory held', L, invTop - 12);

    // Quote band of the focus strategy.
    const fc = colors[focus.s.id];
    ctx.beginPath();
    for (let t = 0; t <= n; t++) ctx.lineTo(x(t), py(focus.ask[t]));
    for (let t = n; t >= 0; t--) ctx.lineTo(x(t), py(focus.bid[t]));
    ctx.closePath();
    ctx.globalAlpha = 0.13; ctx.fillStyle = fc; ctx.fill(); ctx.globalAlpha = 1;
    for (const side of ['ask', 'bid']) {
      ctx.beginPath();
      for (let t = 0; t <= n; t++) ctx.lineTo(x(t), py(focus[side][t]));
      ctx.strokeStyle = fc; ctx.globalAlpha = 0.55; ctx.lineWidth = 1; ctx.stroke(); ctx.globalAlpha = 1;
    }

    // Mid price.
    ctx.beginPath();
    for (let t = 0; t <= n; t++) ctx.lineTo(x(t), py(mid[t]));
    ctx.strokeStyle = colors.ink; ctx.lineWidth = 1.6; ctx.lineJoin = 'round'; ctx.stroke();

    // Fills: filled dot = bought at the bid, ring = sold at the ask. Recent ones pop.
    for (const [t, p, side] of focus.fills) {
      if (t > n) break;
      const age = n - t;
      const r = age < 24 ? 2.6 + (1 - age / 24) * 3.4 : 2.6;
      ctx.beginPath(); ctx.arc(x(t), py(p), r, 0, Math.PI * 2);
      ctx.lineWidth = 1.3;
      if (side > 0) { ctx.fillStyle = fc; ctx.fill(); }
      else { ctx.fillStyle = colors.bg; ctx.fill(); ctx.strokeStyle = fc; ctx.stroke(); }
    }

    // Inventory of every strategy, as steps.
    for (const st of S) {
      ctx.beginPath();
      let prev = 0;
      ctx.moveTo(x(0), iy(0));
      for (let t = 1; t <= n; t++) {
        const q = st.inv[t];
        if (q !== prev) { ctx.lineTo(x(t), iy(prev)); ctx.lineTo(x(t), iy(q)); prev = q; }
      }
      ctx.lineTo(x(n), iy(prev));
      ctx.strokeStyle = colors[st.s.id]; ctx.lineWidth = st === focus ? 2 : 1.5;
      ctx.globalAlpha = st === focus ? 1 : 0.85;
      ctx.stroke(); ctx.globalAlpha = 1;
    }

    // Playhead and live price tag.
    const hx = x(n);
    ctx.strokeStyle = colors.hair; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(Math.round(hx) + 0.5, top); ctx.lineTo(Math.round(hx) + 0.5, H - 8); ctx.stroke();
    const my = py(mid[n]);
    ctx.beginPath(); ctx.arc(hx, my, 4, 0, Math.PI * 2); ctx.fillStyle = colors.ink; ctx.fill();
    if (progress < 1) {
      ctx.beginPath(); ctx.arc(hx, my, 9, 0, Math.PI * 2);
      ctx.globalAlpha = 0.18; ctx.fill(); ctx.globalAlpha = 1;
    }
    const tag = fmt(mid[n], 2);
    ctx.font = `600 11.5px ${colors.font}`;
    const tw = ctx.measureText(tag).width + 14;
    const tx = W - R + 4, ty = Math.max(top + 9, Math.min(top + priceH - 9, my));
    ctx.fillStyle = colors.ink;
    ctx.beginPath(); ctx.roundRect(tx, ty - 10, tw, 20, 4); ctx.fill();
    ctx.fillStyle = colors.bg; ctx.textAlign = 'left';
    ctx.fillText(tag, tx + 7, ty + 0.5);

    // Live readout in HTML.
    stepOut.textContent = `${fmt(n, 0)} of ${fmt(T, 0)}`;
    for (const st of S) {
      const row = rows.get(st.s.id);
      if (!row) continue;
      row.pnl.textContent = fmtSigned(st.pnl[n], 2);
      row.inv.textContent = st.inv[n] > 0 ? `+${st.inv[n]}` : st.inv[n] < 0 ? `−${-st.inv[n]}` : '0';
    }
  }

  function frame(now) {
    raf = 0;
    if (!session) return;
    if (reduced.matches) { draw(1); return; }
    const el = now - started;
    if (el > PLAY_MS + HOLD_MS) {
      seed += 1;
      build();
      started = now;
      draw(0);
    } else {
      draw(Math.min(1, el / PLAY_MS));
    }
    if (visible) raf = requestAnimationFrame(frame);
  }

  function kick() { if (!raf && visible) raf = requestAnimationFrame(frame); }

  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (visible) kick();
  }).observe(canvas);

  new ResizeObserver(() => { if (!session) return; size(); draw(Math.min(1, (performance.now() - started) / PLAY_MS)); }).observe(canvas);

  replayBtn?.addEventListener('click', () => {
    seed += 1; build(); started = performance.now(); kick();
  });

  const api = {
    /** Jump the playhead (0 to 1); used for checking layouts without waiting. */
    seek(p) { started = performance.now() - p * PLAY_MS; if (session) draw(Math.min(1, p)); },
    /** Restart playback when the market or strategies change. */
    set(market, strategies) {
      const k = JSON.stringify([market, strategies]);
      inputs = { market, strategies };
      readColors();
      if (k === key) return;
      key = k;
      size();
      build();
      started = performance.now();
      draw(reduced.matches ? 1 : 0);
      kick();
    },
    /** Colours change with the theme. */
    restyle() {
      if (!session) return;
      readColors();
      draw(Math.min(1, (performance.now() - started) / PLAY_MS));
    },
  };
  root.tape = api;
  return api;
}
