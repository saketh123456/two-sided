// Runs the Monte Carlo off the main thread so the page stays responsive.

import { simulate } from './engine.js';
import { pairedDifference, sorted, summarize } from './metrics.js';

self.onmessage = (event) => {
  const { id, market, strategies, nPaths, seed } = event.data;
  try {
    const t0 = performance.now();
    const run = simulate(market, strategies, {
      nPaths,
      seed,
      onProgress: (p) => self.postMessage({ id, type: 'progress', p }),
    });
    const simMs = performance.now() - t0;

    const summaries = run.results.map((r) => summarize(r, market.nSteps));
    const base = run.results[0];
    const paired = run.results.slice(1).map((r) => ({ id: r.id, label: r.label, ...pairedDifference(r, base) }));
    const items = run.results.map((r) => ({
      id: r.id,
      label: r.label,
      finalPnl: r.finalPnl,
      ddSorted: sorted(r.maxDrawdown),
      inventoryBands: r.inventoryBands,
      sampleInventory: r.sampleInventory,
    }));

    const transfer = [run.recordTimes.buffer];
    for (const it of items) {
      transfer.push(it.finalPnl.buffer, it.ddSorted.buffer);
      for (const a of Object.values(it.inventoryBands)) transfer.push(a.buffer);
      for (const a of it.sampleInventory) transfer.push(a.buffer);
    }
    self.postMessage({
      id,
      type: 'done',
      payload: { recordTimes: run.recordTimes, items, summaries, paired, simMs, totalMs: performance.now() - t0 },
    }, transfer);
  } catch (err) {
    self.postMessage({ id, type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
