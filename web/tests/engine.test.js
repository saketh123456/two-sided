import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Rng } from '../js/rng.js';
import {
  DEFAULT_MARKET,
  DEFAULT_STRATEGIES,
  expectedSpreadPnl,
  fillProbability,
  quoteOffsets,
  simulate,
} from '../js/engine.js';
import { mean, percentileSorted, std, summarize } from '../js/metrics.js';

const market = (over = {}) => ({ ...DEFAULT_MARKET, ...over });

test('rng is deterministic and roughly uniform / normal', () => {
  const a = new Rng(42).fillUniform(new Float64Array(1000));
  const b = new Rng(42).fillUniform(new Float64Array(1000));
  assert.deepEqual(a, b);
  const u = new Rng(1).fillUniform(new Float64Array(200000));
  assert.ok(Math.abs(mean(u) - 0.5) < 0.005);
  const z = new Rng(2).fillNormal(new Float64Array(200000));
  assert.ok(Math.abs(mean(z)) < 0.01);
  assert.ok(Math.abs(std(z) - 1) < 0.01);
});

test('fill probability falls with distance and matches the Poisson formula', () => {
  let prev = 1;
  for (let d = 0; d <= 5; d += 0.1) {
    const p = fillProbability(d, 140, 2, 0.001);
    assert.ok(p < prev && p > 0);
    prev = p;
  }
  const lam = 140 * Math.exp(-1);
  assert.ok(Math.abs(fillProbability(0.5, 140, 2, 0.001) - (1 - Math.exp(-lam * 0.001))) < 1e-15);
});

test('skew moves both quotes against inventory; limit switches sides off', () => {
  const skew = { kind: 'skew', halfSpread: 0.5, skew: 0.1 };
  assert.deepEqual(quoteOffsets(skew, 5), { bidOffset: 1.0, askOffset: 0.0, bidOn: true, askOn: true });
  const lim = { kind: 'limit', halfSpread: 0.5, maxInventory: 2 };
  assert.equal(quoteOffsets(lim, 2).bidOn, false);
  assert.equal(quoteOffsets(lim, -2).askOn, false);
});

test('zero volatility: PnL is exactly half-spread x fills, never draws down', () => {
  const run = simulate(market({ sigma: 0, nSteps: 400 }), [DEFAULT_STRATEGIES[0]], { nPaths: 2000, seed: 1 });
  const r = run.results[0];
  for (let i = 0; i < r.finalPnl.length; i++) {
    assert.ok(Math.abs(r.finalPnl[i] - 0.5 * r.fills[i]) < 1e-9);
    assert.equal(r.maxDrawdown[i], 0);
  }
});

test('zero volatility: mean PnL matches closed form, inventory is mean zero', () => {
  const m = market({ sigma: 0, nSteps: 400 });
  const run = simulate(m, [DEFAULT_STRATEGIES[0]], { nPaths: 4000, seed: 2 });
  const r = run.results[0];
  const se = std(r.finalPnl) / Math.sqrt(r.finalPnl.length);
  assert.ok(Math.abs(mean(r.finalPnl) - expectedSpreadPnl(m, 0.5)) < 4 * se);
  const q = Float64Array.from(r.finalInventory);
  assert.ok(Math.abs(mean(q)) < 4 * (std(q) / Math.sqrt(q.length)));
});

test('same seed reproduces exactly; different seed differs', () => {
  const m = market({ nSteps: 200 });
  const a = simulate(m, DEFAULT_STRATEGIES, { nPaths: 300, seed: 7 });
  const b = simulate(m, DEFAULT_STRATEGIES, { nPaths: 300, seed: 7 });
  const c = simulate(m, DEFAULT_STRATEGIES, { nPaths: 300, seed: 8 });
  for (let s = 0; s < 3; s++) {
    assert.deepEqual(a.results[s].finalPnl, b.results[s].finalPnl);
    assert.deepEqual(a.results[s].inventoryBands, b.results[s].inventoryBands);
  }
  assert.notDeepEqual(a.results[0].finalPnl, c.results[0].finalPnl);
});

test('accounting identity: inventory = bid fills - ask fills, PnL = cash + q * mid', () => {
  const run = simulate(market({ nSteps: 200 }), DEFAULT_STRATEGIES, { nPaths: 500, seed: 3 });
  for (const r of run.results) {
    for (let i = 0; i < 500; i++) {
      assert.equal(r.finalInventory[i], r.fillsBid[i] - r.fillsAsk[i]);
      assert.ok(Math.abs(r.finalPnl[i] - (r.finalCash[i] + r.finalInventory[i] * run.finalMid[i])) < 1e-8);
    }
  }
});

test('inventory limit is never breached, and is reached', () => {
  const lim = { id: 'l', kind: 'limit', label: 'l', halfSpread: 0.5, maxInventory: 3 };
  const r = simulate(market({ nSteps: 300 }), [lim], { nPaths: 2000, seed: 4 }).results[0];
  const worst = r.maxAbsInventory.reduce((a, b) => Math.max(a, b), 0);
  assert.equal(worst, 3);
});

test('degenerate strategies reproduce the fixed spread exactly', () => {
  const strategies = [
    DEFAULT_STRATEGIES[0],
    { id: 's0', kind: 'skew', label: 's0', halfSpread: 0.5, skew: 0 },
    { id: 'lbig', kind: 'limit', label: 'lbig', halfSpread: 0.5, maxInventory: 1e6 },
  ];
  const run = simulate(market({ nSteps: 300 }), strategies, { nPaths: 400, seed: 5 });
  assert.deepEqual(run.results[1].finalPnl, run.results[0].finalPnl);
  assert.deepEqual(run.results[2].finalPnl, run.results[0].finalPnl);
});

test('binary price model stays on its lattice', () => {
  const m = market({ sigma: 1, nSteps: 100, priceModel: 'binary' });
  const run = simulate(m, [DEFAULT_STRATEGIES[0]], { nPaths: 500, seed: 6 });
  const step = Math.sqrt(m.horizon / m.nSteps);
  for (const s of run.finalMid) {
    const k = (s - m.s0) / step;
    assert.ok(Math.abs(k - Math.round(k)) < 1e-6);
    assert.equal(Math.abs(Math.round(k)) % 2, 0);
  }
});

test('percentile matches NumPy linear interpolation', () => {
  const s = Float64Array.of(1, 2, 3, 4, 10);
  assert.equal(percentileSorted(s, 0.5), 3);
  assert.ok(Math.abs(percentileSorted(s, 0.9) - 7.6) < 1e-12);
});

test('invalid inputs are rejected', () => {
  assert.throws(() => simulate(market({ k: 0 }), DEFAULT_STRATEGIES, { nPaths: 10 }), RangeError);
  assert.throws(() => new Rng(-1), RangeError);
});

// Statistical parity with the Python implementation. Different RNGs, same model:
// means must agree within 4 combined standard errors and stds within 5%.
const summaryPath = fileURLToPath(new URL('../../results/summary.json', import.meta.url));
test('parity with Python results/summary.json', { skip: !existsSync(summaryPath) }, () => {
  const py = JSON.parse(readFileSync(summaryPath, 'utf8'));
  const sigmas = { baseline: 2, high_vol: 6 };
  const pyIds = { fixed: 'fixed_spread', skew: 'inventory_skew', limit: 'inventory_limit' };
  for (const [name, sigma] of Object.entries(sigmas)) {
    const n = py.n_paths;
    const run = simulate(market({ sigma }), DEFAULT_STRATEGIES, { nPaths: n, seed: 20261120 });
    for (const r of run.results) {
      const js = summarize(r, DEFAULT_MARKET.nSteps);
      const ref = py.scenarios[name].summary.find((s) => s.strategy === pyIds[r.id]);
      const se = Math.sqrt(js.stdPnl ** 2 / n + ref.std_pnl ** 2 / n);
      assert.ok(Math.abs(js.meanPnl - ref.mean_pnl) < 4 * se, `${name}/${r.id} mean ${js.meanPnl} vs ${ref.mean_pnl}`);
      assert.ok(Math.abs(js.stdPnl / ref.std_pnl - 1) < 0.05, `${name}/${r.id} std ${js.stdPnl} vs ${ref.std_pnl}`);
      assert.ok(Math.abs(js.fillsMean - ref.fills_mean) < 1, `${name}/${r.id} fills ${js.fillsMean} vs ${ref.fills_mean}`);
    }
  }
});
