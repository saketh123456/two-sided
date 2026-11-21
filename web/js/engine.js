// Market-making simulation engine (browser + Node). Mirrors mmsim/model.py.
//
// Step t -> t+1:
//   1. each strategy quotes from mid S_t and its own inventory q_t
//   2. each side fills (one unit) with probability 1 - exp(-A e^{-k delta} dt)
//   3. cash / inventory update at the quoted prices
//   4. the shared mid moves; PnL is marked to market at S_{t+1}
//
// All strategies are simulated in one pass over the same random draws, so they
// see identical price paths and order arrivals (common random numbers).

import { Rng } from './rng.js';

export const DEFAULT_MARKET = Object.freeze({
  s0: 100,
  sigma: 2,
  horizon: 1,
  nSteps: 1000,
  A: 140,
  k: 2,
  priceModel: 'gaussian',
});

export const DEFAULT_STRATEGIES = Object.freeze([
  Object.freeze({ id: 'fixed', kind: 'fixed', label: 'Fixed spread', halfSpread: 0.5 }),
  Object.freeze({ id: 'skew', kind: 'skew', label: 'Inventory skew', halfSpread: 0.5, skew: 0.05 }),
  Object.freeze({ id: 'limit', kind: 'limit', label: 'Inventory limit', halfSpread: 0.5, maxInventory: 5 }),
]);

export function arrivalRate(delta, A, k) {
  return A * Math.exp(-k * Math.max(delta, 0));
}

export function fillProbability(delta, A, k, dt) {
  return -Math.expm1(-arrivalRate(delta, A, k) * dt);
}

/** Distances of bid/ask below/above the mid, and whether each side is quoted. */
export function quoteOffsets(strategy, q) {
  const h = strategy.halfSpread;
  switch (strategy.kind) {
    case 'fixed':
      return { bidOffset: h, askOffset: h, bidOn: true, askOn: true };
    case 'skew': {
      const shift = strategy.skew * q; // reservation price r = mid - skew * q
      return { bidOffset: h + shift, askOffset: h - shift, bidOn: true, askOn: true };
    }
    case 'limit':
      return {
        bidOffset: h,
        askOffset: h,
        bidOn: q < strategy.maxInventory,
        askOn: q > -strategy.maxInventory,
      };
    default:
      throw new Error(`unknown strategy kind ${strategy.kind}`);
  }
}

/** Closed-form expected spread income for a symmetric, always-on quote at half-spread h. */
export function expectedSpreadPnl(market, h) {
  const dt = market.horizon / market.nSteps;
  return 2 * market.nSteps * fillProbability(h, market.A, market.k, dt) * h;
}

export function validateMarket(m) {
  const errors = {};
  if (!(m.sigma >= 0)) errors.sigma = 'Volatility must be zero or more.';
  if (!(m.A > 0)) errors.A = 'Arrival rate must be above zero.';
  if (!(m.k > 0)) errors.k = 'Decay must be above zero.';
  if (!Number.isInteger(m.nSteps) || m.nSteps < 10 || m.nSteps > 5000) errors.nSteps = 'Use 10 to 5,000 steps.';
  if (!(m.horizon > 0)) errors.horizon = 'Horizon must be above zero.';
  if (m.priceModel !== 'gaussian' && m.priceModel !== 'binary') errors.priceModel = 'Unknown price model.';
  return errors;
}

/** Quantile of integer data given a histogram (nearest-rank, used for display bands). */
function quantileFromCounts(counts, offset, n, p) {
  const target = Math.max(1, Math.ceil(p * n));
  let cum = 0;
  for (let i = 0; i < counts.length; i++) {
    cum += counts[i];
    if (cum >= target) return i - offset;
  }
  return counts.length - 1 - offset;
}

const BAND_PROBS = [0.05, 0.25, 0.5, 0.75, 0.95];

/**
 * Run nPaths sessions for every strategy.
 * @returns {{market, seed, nPaths, recordTimes: Float64Array, results: object[]}}
 */
export function simulate(market, strategies, opts = {}) {
  const { nPaths = 10000, seed = 0, maxRecordPoints = 250, nSamples = 5, onProgress } = opts;
  const errors = validateMarket(market);
  if (Object.keys(errors).length) throw new RangeError(Object.values(errors).join(' '));
  if (!Number.isInteger(nPaths) || nPaths < 1) throw new RangeError('nPaths must be a positive integer');

  const n = nPaths;
  const T = market.nSteps;
  const dt = market.horizon / T;
  const volStep = market.sigma * Math.sqrt(dt);
  const binary = market.priceModel === 'binary';
  const qOff = T;
  const qRange = 2 * T + 1;
  const recordEvery = Math.max(1, Math.ceil(T / maxRecordPoints));
  const ns = Math.min(nSamples, n);

  const recordSteps = [];
  for (let t = 0; t <= T; t += recordEvery) recordSteps.push(t);
  if (recordSteps[recordSteps.length - 1] !== T) recordSteps.push(T);
  const nRec = recordSteps.length;
  const recordTimes = Float64Array.from(recordSteps, (t) => t * dt);

  const rng = new Rng(seed);
  const z = new Float64Array(n);
  const ub = new Float64Array(n);
  const ua = new Float64Array(n);
  const mid = new Float64Array(n).fill(market.s0);

  const states = strategies.map((spec) => {
    const pBid = new Float64Array(qRange);
    const pAsk = new Float64Array(qRange);
    const bidOff = new Float64Array(qRange);
    const askOff = new Float64Array(qRange);
    for (let qi = 0; qi < qRange; qi++) {
      const o = quoteOffsets(spec, qi - qOff);
      bidOff[qi] = o.bidOffset;
      askOff[qi] = o.askOffset;
      pBid[qi] = o.bidOn ? fillProbability(o.bidOffset, market.A, market.k, dt) : 0;
      pAsk[qi] = o.askOn ? fillProbability(o.askOffset, market.A, market.k, dt) : 0;
    }
    const bands = BAND_PROBS.map(() => new Float64Array(nRec));
    return {
      spec, pBid, pAsk, bidOff, askOff, bands,
      q: new Int32Array(n),
      cash: new Float64Array(n),
      pnl: new Float64Array(n),
      peak: new Float64Array(n),
      maxDd: new Float64Array(n),
      fillsBid: new Int32Array(n),
      fillsAsk: new Int32Array(n),
      maxAbsInv: new Int32Array(n),
      dSum: new Float64Array(n),
      dSumSq: new Float64Array(n),
      absQSum: new Float64Array(n),
      counts: new Int32Array(qRange),
      meanInv: new Float64Array(nRec),
      samplePnl: Array.from({ length: ns }, () => new Float64Array(nRec)),
      sampleInv: Array.from({ length: ns }, () => new Float64Array(nRec)),
    };
  });

  const record = (st, r) => {
    const { q, counts } = st;
    counts.fill(0);
    let sum = 0;
    for (let i = 0; i < n; i++) {
      counts[q[i] + qOff]++;
      sum += q[i];
    }
    for (let b = 0; b < BAND_PROBS.length; b++) st.bands[b][r] = quantileFromCounts(counts, qOff, n, BAND_PROBS[b]);
    st.meanInv[r] = sum / n;
    for (let j = 0; j < ns; j++) {
      st.samplePnl[j][r] = st.pnl[j];
      st.sampleInv[j][r] = q[j];
    }
  };

  for (const st of states) record(st, 0);
  let rec = 1;
  const progressEvery = Math.max(1, Math.floor(T / 50));

  for (let t = 0; t < T; t++) {
    // Same draw order every step: normals, bid uniforms, ask uniforms.
    rng.fillNormal(z);
    rng.fillUniform(ub);
    rng.fillUniform(ua);

    for (const st of states) {
      const { q, cash, pBid, pAsk, bidOff, askOff, fillsBid, fillsAsk, maxAbsInv } = st;
      for (let i = 0; i < n; i++) {
        const qi = q[i] + qOff;
        const m = mid[i];
        let dq = 0;
        if (ub[i] < pBid[qi]) {
          cash[i] -= m - bidOff[qi];
          fillsBid[i]++;
          dq++;
        }
        if (ua[i] < pAsk[qi]) {
          cash[i] += m + askOff[qi];
          fillsAsk[i]++;
          dq--;
        }
        if (dq !== 0) {
          const nq = q[i] + dq;
          q[i] = nq;
          const a = nq < 0 ? -nq : nq;
          if (a > maxAbsInv[i]) maxAbsInv[i] = a;
        }
      }
    }

    if (binary) for (let i = 0; i < n; i++) mid[i] += z[i] >= 0 ? volStep : -volStep;
    else for (let i = 0; i < n; i++) mid[i] += volStep * z[i];

    for (const st of states) {
      const { q, cash, pnl, peak, maxDd, dSum, dSumSq, absQSum } = st;
      for (let i = 0; i < n; i++) {
        const p = cash[i] + q[i] * mid[i];
        const d = p - pnl[i];
        pnl[i] = p;
        dSum[i] += d;
        dSumSq[i] += d * d;
        if (p > peak[i]) peak[i] = p;
        const dd = peak[i] - p;
        if (dd > maxDd[i]) maxDd[i] = dd;
        absQSum[i] += q[i] < 0 ? -q[i] : q[i];
      }
    }

    if (rec < nRec && recordSteps[rec] === t + 1) {
      for (const st of states) record(st, rec);
      rec++;
    }
    if (onProgress && (t + 1) % progressEvery === 0) onProgress((t + 1) / T);
  }

  const results = states.map((st) => {
    const stepMean = new Float64Array(n);
    const stepStd = new Float64Array(n);
    const meanAbsInv = new Float64Array(n);
    const fills = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      const mu = st.dSum[i] / T;
      stepMean[i] = mu;
      stepStd[i] = Math.sqrt(Math.max(st.dSumSq[i] / T - mu * mu, 0));
      meanAbsInv[i] = st.absQSum[i] / T;
      fills[i] = st.fillsBid[i] + st.fillsAsk[i];
    }
    return {
      id: st.spec.id,
      label: st.spec.label,
      spec: { ...st.spec },
      finalPnl: st.pnl,
      finalInventory: st.q,
      finalCash: st.cash,
      maxDrawdown: st.maxDd,
      maxAbsInventory: st.maxAbsInv,
      fills,
      fillsBid: st.fillsBid,
      fillsAsk: st.fillsAsk,
      stepMean,
      stepStd,
      meanAbsInventory: meanAbsInv,
      inventoryBands: { p5: st.bands[0], p25: st.bands[1], p50: st.bands[2], p75: st.bands[3], p95: st.bands[4] },
      meanInventory: st.meanInv,
      samplePnl: st.samplePnl,
      sampleInventory: st.sampleInv,
    };
  });

  return { market: { ...market }, seed, nPaths: n, recordTimes, finalMid: mid, results };
}
