// Summary statistics. Mirrors mmsim/metrics.py.

const Z95 = 1.959963984540054;

export function mean(x) {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i];
  return s / x.length;
}

export function std(x, ddof = 1) {
  const m = mean(x);
  let s = 0;
  for (let i = 0; i < x.length; i++) s += (x[i] - m) ** 2;
  return Math.sqrt(s / (x.length - ddof));
}

export function sorted(x) {
  return Float64Array.from(x).sort();
}

/** Linear-interpolation percentile on pre-sorted data (NumPy's default method). */
export function percentileSorted(s, p) {
  if (s.length === 0) return NaN;
  const idx = (s.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.min(lo + 1, s.length - 1);
  return s[lo] + (s[hi] - s[lo]) * (idx - lo);
}

export function meanCi95(x) {
  const m = mean(x);
  const half = (Z95 * std(x)) / Math.sqrt(x.length);
  return [m - half, m + half];
}

export function expectedShortfallSorted(s, alpha = 0.05) {
  const k = Math.max(1, Math.floor(alpha * s.length));
  let t = 0;
  for (let i = 0; i < k; i++) t += s[i];
  return t / k;
}

export function summarize(result, nSteps) {
  const pnl = result.finalPnl;
  const n = pnl.length;
  const s = sorted(pnl);
  const m = mean(pnl);
  const sd = std(pnl);
  const [lo, hi] = meanCi95(pnl);
  let losses = 0;
  for (let i = 0; i < n; i++) if (pnl[i] < 0) losses++;

  const pathSharpe = [];
  for (let i = 0; i < n; i++) {
    if (result.stepStd[i] > 0) pathSharpe.push((result.stepMean[i] / result.stepStd[i]) * Math.sqrt(nSteps));
  }
  const dd = sorted(result.maxDrawdown);

  return {
    id: result.id,
    label: result.label,
    nPaths: n,
    meanPnl: m,
    stdPnl: sd,
    ci95Low: lo,
    ci95High: hi,
    pLoss: losses / n,
    pnlP05: percentileSorted(s, 0.05),
    es05: expectedShortfallSorted(s, 0.05),
    sharpe: sd > 0 ? m / sd : NaN,
    sharpePathMedian: pathSharpe.length ? percentileSorted(sorted(pathSharpe), 0.5) : NaN,
    ddMedian: percentileSorted(dd, 0.5),
    ddP95: percentileSorted(dd, 0.95),
    ddMax: dd[dd.length - 1],
    fillsMean: mean(result.fills),
    finalInvStd: std(result.finalInventory),
    meanAbsInv: mean(result.meanAbsInventory),
    maxAbsInv: result.maxAbsInventory.reduce((a, b) => (b > a ? b : a), 0),
  };
}

/** Mean and 95% CI of (a - b) final PnL; paired because the runs share draws. */
export function pairedDifference(a, b) {
  const n = a.finalPnl.length;
  const d = new Float64Array(n);
  for (let i = 0; i < n; i++) d[i] = a.finalPnl[i] - b.finalPnl[i];
  const [lo, hi] = meanCi95(d);
  return { meanDiff: mean(d), ci95Low: lo, ci95High: hi };
}
