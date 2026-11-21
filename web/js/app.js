import { DEFAULT_MARKET, DEFAULT_STRATEGIES, expectedSpreadPnl, validateMarket } from './engine.js';
import { renderLadder, renderLambda } from './ladder.js';
import { createTape } from './tape.js';
import { renderDrawdown, renderInventory, renderPnl } from './charts.js';
import { percentileSorted } from './metrics.js';
import { fmt, fmtInt, fmtMs, fmtPct, fmtSigned } from './format.js';

/* ---------- Parameters ---------- */

const DEFAULTS = Object.freeze({
  sigma: 2, A: 140, k: 2, nSteps: 1000, priceModel: 'gaussian',
  halfSpread: 0.5, skew: 0.05, maxInventory: 5, nPaths: 10000, seed: 20261120,
});

const SPEC = {
  sigma: { kind: 'float', min: 0, max: 50, label: 'Volatility' },
  A: { kind: 'float', min: 1, max: 5000, label: 'Arrival rate' },
  k: { kind: 'float', min: 0.01, max: 50, label: 'Decay' },
  nSteps: { kind: 'int', min: 10, max: 5000, label: 'Steps' },
  priceModel: { kind: 'enum', values: ['gaussian', 'binary'] },
  halfSpread: { kind: 'float', min: 0.01, max: 10, label: 'Half-spread' },
  skew: { kind: 'float', min: 0, max: 5, label: 'Skew' },
  maxInventory: { kind: 'int', min: 1, max: 1000, label: 'Inventory limit' },
  nPaths: { kind: 'enum', values: [1000, 5000, 10000, 25000] },
  seed: { kind: 'int', min: 0, max: Number.MAX_SAFE_INTEGER, label: 'Seed' },
};

const PRESETS = { baseline: { sigma: 2 }, high_vol: { sigma: 6 } };

function parseField(name, raw) {
  const s = SPEC[name];
  if (s.kind === 'enum') {
    const v = typeof s.values[0] === 'number' ? Number(raw) : String(raw);
    return s.values.includes(v) ? { value: v } : { error: 'Pick one of the listed options.' };
  }
  if (String(raw).trim() === '') return { error: `${s.label} is required.` };
  const v = Number(raw);
  if (!Number.isFinite(v)) return { error: `${s.label} must be a number.` };
  if (s.kind === 'int' && !Number.isInteger(v)) return { error: `${s.label} must be a whole number.` };
  if (v < s.min || v > s.max) return { error: `Use ${fmtInt(s.min)} to ${fmtInt(s.max)}.` };
  return { value: v };
}

function readHash() {
  const out = {};
  const qs = new URLSearchParams(location.hash.replace(/^#/, ''));
  for (const name of Object.keys(SPEC)) {
    if (!qs.has(name)) continue;
    const r = parseField(name, qs.get(name));
    if ('value' in r) out[name] = r.value;
  }
  return out;
}

function writeHash(params) {
  const qs = new URLSearchParams();
  for (const name of Object.keys(SPEC)) if (params[name] !== DEFAULTS[name]) qs.set(name, String(params[name]));
  const h = qs.toString();
  history.replaceState(null, '', h ? `#${h}` : location.pathname + location.search);
}

const toMarket = (p) => ({ ...DEFAULT_MARKET, sigma: p.sigma, A: p.A, k: p.k, nSteps: p.nSteps, priceModel: p.priceModel });
const toStrategies = (p) => DEFAULT_STRATEGIES.map((s) => ({
  ...s,
  halfSpread: p.halfSpread,
  ...(s.kind === 'skew' ? { skew: p.skew } : {}),
  ...(s.kind === 'limit' ? { maxInventory: p.maxInventory } : {}),
}));
const sameParams = (a, b) => Object.keys(SPEC).every((k) => a[k] === b[k]);

/* ---------- State ---------- */

const state = {
  params: { ...DEFAULTS, ...readHash() },
  errors: {},
  q: 0,
  run: null, // { params, payload, wall }
  running: null, // { id, params, t0 }
  tab: 'pnl',
};

const $ = (id) => document.getElementById(id);

/* ---------- Motion helpers ---------- */

const motionOK = () => document.documentElement.classList.contains('motion');
const easeOutCubic = (t) => 1 - (1 - t) ** 3;
const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Count a number from its previous value to `to`. */
function tween(node, from, to, digits, dur = 950) {
  if (!motionOK() || !Number.isFinite(from) || from === to) {
    node.textContent = fmt(to, digits);
    return;
  }
  const t0 = performance.now();
  let done = false;
  const step = (now) => {
    if (done) return;
    const p = Math.min(1, (now - t0) / dur);
    node.textContent = fmt(from + (to - from) * easeOutCubic(p), digits);
    if (p < 1) requestAnimationFrame(step); else done = true;
  };
  requestAnimationFrame(step);
  // Background tabs throttle rAF; make sure the true value always lands.
  setTimeout(() => { done = true; node.textContent = fmt(to, digits); }, dur + 60);
}

/** Restart a CSS entrance animation by toggling its class. */
function replay(node, cls) {
  node.classList.remove(cls);
  void node.offsetWidth;
  node.classList.add(cls);
}

/** Sliding pill behind the checked button of a segmented control. */
function mountPill(seg) {
  const pill = document.createElement('span');
  pill.className = 'seg-pill';
  pill.setAttribute('aria-hidden', 'true');
  pill.style.transition = 'none';
  seg.prepend(pill);
  requestAnimationFrame(() => requestAnimationFrame(() => { pill.style.transition = ''; }));
}
function positionPill(seg) {
  const pill = seg.querySelector('.seg-pill');
  if (!pill) return;
  const b = seg.querySelector('[aria-checked="true"]');
  if (!b) { pill.style.opacity = '0'; return; }
  pill.style.opacity = '1';
  pill.style.width = `${b.offsetWidth}px`;
  pill.style.transform = `translateX(${b.offsetLeft - 3}px)`;
  pill.style.left = '3px';
}
const positionAllPills = () => document.querySelectorAll('.seg').forEach(positionPill);
const els = {
  form: $('controls'), run: $('run'), cancel: $('cancel'), progress: $('progress'),
  meta: $('run-meta'), results: $('results'), board: $('board'), theory: $('theory'),
  csv: $('dl-csv'), json: $('dl-json'),
  headline: $('headline'), heroSub: $('hero-sub'), figures: $('hero-figures'),
  ladder: $('ladder'), lambda: $('lambda'), q: $('ladder-q'), qOut: $('ladder-q-out'),
  deltaStar: $('delta-star'), presets: $('presets'), presetNote: $('preset-note'),
  toast: $('toast'),
};
const tape = createTape($('tape'));
{
  const nav = document.querySelector('.nav');
  const onScroll = () => nav.classList.toggle('scrolled', scrollY > 8);
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

/* ---------- Form ---------- */

function syncForm() {
  for (const name of Object.keys(SPEC)) {
    const input = $(`f-${name}`);
    if (input && document.activeElement !== input) input.value = String(state.params[name]);
    const range = $(`r-${name}`);
    if (range) range.value = String(state.params[name]);
  }
}

function setError(name, msg) {
  const field = els.form.querySelector(`[data-field="${name}"]`);
  if (!field) return;
  field.classList.toggle('invalid', Boolean(msg));
  const err = field.querySelector('.error');
  if (err) err.textContent = msg || '';
  const input = $(`f-${name}`);
  if (input) input.setAttribute('aria-invalid', msg ? 'true' : 'false');
  if (msg) state.errors[name] = msg; else delete state.errors[name];
  els.run.disabled = Object.keys(state.errors).length > 0 || Boolean(state.running);
}

function onParamChange(name, raw, { fromRange = false } = {}) {
  const r = parseField(name, raw);
  if ('error' in r) return setError(name, r.error);
  setError(name, null);
  state.params[name] = r.value;
  if (fromRange) $(`f-${name}`).value = String(r.value);
  else if ($(`r-${name}`)) $(`r-${name}`).value = String(r.value);
  writeHash(state.params);
  updatePresetUi();
  renderExplainers();
  updateStale();
}

function updatePresetUi() {
  let active = null;
  for (const [key, preset] of Object.entries(PRESETS)) {
    const merged = { ...DEFAULTS, ...preset, seed: state.params.seed, nPaths: state.params.nPaths };
    if (sameParams(merged, state.params)) active = key;
  }
  for (const b of els.presets.querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.preset === active));
  positionPill(els.presets);
  els.presetNote.textContent = active
    ? 'Presets match the Python analysis. Change anything and run again.'
    : 'Custom settings. Pick a preset above to return to the Python analysis settings.';
}

function bindForm() {
  for (const name of Object.keys(SPEC)) {
    const input = $(`f-${name}`);
    if (!input) continue;
    input.addEventListener(input.tagName === 'SELECT' ? 'change' : 'input', () => onParamChange(name, input.value));
    input.addEventListener('blur', () => { if (!state.errors[name]) input.value = String(state.params[name]); });
    const range = $(`r-${name}`);
    if (range) range.addEventListener('input', () => onParamChange(name, range.value, { fromRange: true }));
  }
  els.presets.addEventListener('click', (e) => {
    const b = e.target.closest('[data-preset]');
    if (!b) return;
    const keep = { seed: state.params.seed, nPaths: state.params.nPaths };
    state.params = { ...DEFAULTS, ...PRESETS[b.dataset.preset], ...keep };
    for (const name of Object.keys(SPEC)) setError(name, null);
    syncForm();
    writeHash(state.params);
    updatePresetUi();
    renderExplainers();
    startRun();
  });
  $('new-seed').addEventListener('click', () => {
    const seed = Math.floor(Math.random() * 2 ** 31);
    $('f-seed').value = String(seed);
    onParamChange('seed', seed);
  });
  els.form.addEventListener('submit', (e) => {
    e.preventDefault();
    startRun();
  });
  els.cancel.addEventListener('click', () => cancelRun());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      startRun();
    }
  });
  els.q.addEventListener('input', () => {
    state.q = Number(els.q.value);
    renderExplainers();
  });
}

/* ---------- Ladder and arrival-rate explainers ---------- */

function renderExplainers() {
  const market = toMarket(state.params);
  const strategies = toStrategies(state.params);
  els.qOut.textContent = state.q > 0 ? `+${state.q}` : state.q < 0 ? `−${-state.q}` : '0';
  els.deltaStar.textContent = fmt(1 / market.k, 2);
  renderLadder(els.ladder, { market, strategies, q: state.q });
  renderLambda(els.lambda, { market, strategies, q: state.q });
  if (!Object.keys(validateMarket(market)).length) tape.set(market, strategies);
}

/* ---------- Worker ---------- */

let worker = null;
let runSeq = 0;

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = onWorkerMessage;
    worker.onerror = (e) => {
      e.preventDefault();
      failRun(`The simulation stopped unexpectedly: ${e.message || 'worker error'}.`);
    };
  }
  return worker;
}

function startRun() {
  if (Object.keys(state.errors).length) {
    $(`f-${Object.keys(state.errors)[0]}`)?.focus();
    return;
  }
  if (state.running) cancelRun({ quiet: true });
  const id = ++runSeq;
  const params = { ...state.params };
  state.running = { id, params, t0: performance.now() };
  els.run.classList.add('running');
  setProgress(0);
  els.cancel.hidden = false;
  els.run.disabled = true;
  els.meta.textContent = `Simulating ${fmtInt(params.nPaths)} sessions for each strategy…`;
  getWorker().postMessage({
    id, market: toMarket(params), strategies: toStrategies(params), nPaths: params.nPaths, seed: params.seed,
  });
}

function cancelRun({ quiet = false } = {}) {
  if (!state.running) return;
  worker?.terminate();
  worker = null;
  state.running = null;
  resetRunUi();
  if (!quiet) {
    els.meta.textContent = state.run ? 'Run cancelled. Showing the previous results.' : 'Run cancelled.';
    updateStale();
  }
}

function resetRunUi() {
  els.cancel.hidden = true;
  els.run.classList.remove('running');
  els.run.style.setProperty('--p', '0');
  els.run.querySelector('.run-label').textContent = 'Run simulation';
  els.run.disabled = Object.keys(state.errors).length > 0;
}

function failRun(message) {
  state.running = null;
  worker?.terminate();
  worker = null;
  resetRunUi();
  els.meta.textContent = message;
}

function setProgress(p) {
  const pct = Math.round(p * 100);
  els.progress.setAttribute('aria-valuenow', String(pct));
  els.run.style.setProperty('--p', String(p));
  els.run.querySelector('.run-label').textContent = `Running ${pct}%`;
}

function onWorkerMessage(e) {
  const msg = e.data;
  if (!state.running || msg.id !== state.running.id) return;
  if (msg.type === 'progress') return setProgress(msg.p);
  if (msg.type === 'error') return failRun(`The simulation could not run: ${msg.message}`);
  const { params, t0 } = state.running;
  state.running = null;
  resetRunUi();
  state.run = { params, payload: msg.payload, wall: performance.now() - t0 };
  renderResults();
}

/* ---------- Results ---------- */

function updateStale() {
  if (!state.run || state.running) return;
  const stale = !sameParams(state.run.params, state.params);
  els.results.classList.toggle('results-stale', stale);
  els.meta.textContent = stale ? 'Settings changed. Run again to update these results.' : runMetaText();
}

function runMetaText() {
  const { params, payload, wall } = state.run;
  const model = params.priceModel === 'binary' ? ', up-or-down price steps' : '';
  return `${fmtInt(params.nPaths)} sessions per strategy, seed ${params.seed}, volatility ${fmt(params.sigma, 1)}${model}. ` +
    `Simulated in ${fmtMs(payload.simMs)}, ${fmtMs(wall)} end to end.`;
}

function itemsWithSummary() {
  const { items, summaries } = state.run.payload;
  return items.map((it, i) => ({ ...it, summary: summaries[i] }));
}

const pct0 = (x) => `${Math.round(x * 100)}%`;

function renderHeadline(S, params) {
  const fixed = S.find((s) => s.id === 'fixed');
  const best = S.reduce((a, b) => (b.sharpe > a.sharpe ? b : a));
  let text;
  if (best.id === 'fixed') {
    text = 'With these settings, the fixed spread is the best risk-adjusted choice.';
  } else {
    const keep = best.meanPnl / fixed.meanPnl;
    const cut = 1 - best.stdPnl / fixed.stdPnl;
    if (fixed.meanPnl > 0 && keep > 0 && keep <= 1 && cut > 0) {
      text = `${best.label} kept ${pct0(keep)} of the fixed spread’s profit and cut its risk by ${pct0(cut)}.`;
    } else if (cut > 0) {
      text = `${best.label} earned ${fmt(best.meanPnl, 1)} per session against ${fmt(fixed.meanPnl, 1)}, with ${pct0(cut)} less risk.`;
    } else {
      text = `${best.label} earns the most for the risk it takes with these settings.`;
    }
  }
  if (els.headline.dataset.text !== text) {
    els.headline.dataset.text = text;
    els.headline.setAttribute('aria-label', text);
    els.headline.innerHTML = text.split(' ').map((word, i) =>
      `<span class="w" aria-hidden="true"><span style="--i:${i}">${escapeHtml(word)}</span></span>`).join(' ');
    replay(els.headline, 'reveal');
  }
  els.heroSub.textContent =
    `Risk here is the standard deviation of profit per session. ${fmtInt(params.nPaths)} simulated sessions per strategy ` +
    `at volatility ${fmt(params.sigma, 1)}, with identical prices and orders for all three.`;

  els.figures.innerHTML = S.map((s) => `
    <li class="s-${s.id}">
      <span class="sw" aria-hidden="true"></span>
      <span class="name">${s.label}</span>
      <span class="val" data-id="${s.id}">${fmt(s.meanPnl, 2)}</span>
      <span class="pm">± ${fmt(s.stdPnl, 2)}</span>
    </li>`).join('');
  countUp(els.figures, '.val', S);
}

/** Count each strategy's headline number up from what was shown before. */
const shown = new Map();
function countUp(root, selector, S) {
  for (const node of root.querySelectorAll(selector)) {
    const s = S.find((x) => x.id === node.dataset.id);
    const key = `${selector}:${s.id}`;
    const from = shown.has(key) ? shown.get(key) : 0;
    shown.set(key, s.meanPnl);
    tween(node, from, s.meanPnl, 2);
  }
}

function sparkline(values, lo, hi, mean) {
  const W = 132, H = 30, nb = 30;
  const counts = new Array(nb).fill(0);
  const bw = (hi - lo) / nb;
  for (const v of values) {
    let b = Math.floor((v - lo) / bw);
    if (b < 0) b = 0; else if (b >= nb) b = nb - 1;
    counts[b]++;
  }
  const max = Math.max(...counts) || 1;
  const step = W / nb;
  let rects = '';
  counts.forEach((c, i) => {
    if (!c) return;
    const h = Math.max(1, (c / max) * (H - 2));
    rects += `<rect x="${(i * step + 0.5).toFixed(1)}" y="${(H - h).toFixed(1)}" width="${(step - 1).toFixed(1)}" height="${h.toFixed(1)}" rx="0.8"/>`;
  });
  const mx = ((mean - lo) / (hi - lo)) * W;
  const meanLine = mx >= 0 && mx <= W ? `<line x1="${mx.toFixed(1)}" x2="${mx.toFixed(1)}" y1="0" y2="${H}"/>` : '';
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" aria-hidden="true">${rects}${meanLine}</svg>`;
}

const GROUPS = [
  ['Return', [
    ['Mean profit', 'meanPnl', 2, 'high'],
    ['95% interval for the mean', 'ci', 2, null],
    ['5th percentile', 'pnlP05', 2, 'high'],
    ['Average of the worst 5%', 'es05', 2, 'high'],
  ]],
  ['Risk', [
    ['Standard deviation', 'stdPnl', 2, 'low'],
    ['Chance of a losing session', 'pLoss', 'pct', 'low'],
    ['Sharpe-like ratio, mean over sd', 'sharpe', 2, 'high'],
    ['Median per-session Sharpe', 'sharpePathMedian', 2, 'high'],
  ]],
  ['Drawdown', [
    ['Median', 'ddMedian', 2, 'low'],
    ['95th percentile', 'ddP95', 2, 'low'],
    ['Worst', 'ddMax', 2, 'low'],
  ]],
  ['Activity', [
    ['Fills per session', 'fillsMean', 1, null],
    ['Average |inventory|', 'meanAbsInv', 2, 'low'],
    ['Largest |inventory| seen', 'maxAbsInv', 0, 'low'],
  ]],
];

function cellText(s, key, d) {
  if (key === 'ci') return `${fmt(s.ci95Low, 2)} to ${fmt(s.ci95High, 2)}`;
  if (d === 'pct') return fmtPct(s[key], 2);
  return fmt(s[key], d);
}

function renderBoard(S, paired, items) {
  const all = new Float64Array(items.reduce((n, it) => n + it.finalPnl.length, 0));
  let o = 0;
  for (const it of items) { all.set(it.finalPnl, o); o += it.finalPnl.length; }
  all.sort();
  const lo = percentileSorted(all, 0.005);
  const hi = percentileSorted(all, 0.995);
  const bestSharpe = S.reduce((a, b) => (b.sharpe > a.sharpe ? b : a));

  const head = `<thead><tr><th scope="col">Per session</th>${S.map((s, i) => `
    <th scope="col" class="s-${s.id}">
      <div class="strat">
        <span class="strat-name"><span class="sw" aria-hidden="true"></span>${s.label}</span>
        <span class="strat-val" data-id="${s.id}">${fmt(s.meanPnl, 2)}</span>
        <span class="strat-pm">± ${fmt(s.stdPnl, 2)} mean profit</span>
        ${sparkline(items[i].finalPnl, lo, hi, s.meanPnl)}
        <span class="tag${s === bestSharpe ? '' : ' placeholder'}"${s === bestSharpe ? '' : ' aria-hidden="true"'}>Best risk-adjusted</span>
      </div>
    </th>`).join('')}</tr></thead>`;

  let rowIndex = 0;
  const groups = GROUPS.map(([name, rows]) => {
    const body = rows.map(([label, key, d, better]) => {
      const r = rowIndex++;
      let best = -1;
      if (better) {
        const vals = S.map((s) => s[key]);
        const target = better === 'high' ? Math.max(...vals) : Math.min(...vals);
        if (vals.filter((v) => v === target).length === 1) best = vals.indexOf(target);
      }
      return `<tr class="row"><th scope="row">${label}</th>${S.map((s, i) =>
        `<td class="s-${s.id}${i === best ? ' best' : ''}" style="--r:${r}">${cellText(s, key, d)}${i === best ? '<span class="visually-hidden"> (best)</span>' : ''}</td>`).join('')}</tr>`;
    }).join('');
    return `<tbody><tr><th scope="rowgroup" colspan="${S.length + 1}">${name}</th></tr>${body}</tbody>`;
  }).join('');

  const diffs = `<tbody><tr><th scope="rowgroup" colspan="${S.length + 1}">Against the fixed spread, same sessions</th></tr>
    <tr class="row"><th scope="row">Mean profit difference</th>${S.map((s) => {
      const p = paired.find((d) => d.id === s.id);
      return `<td class="s-${s.id}">${p ? fmtSigned(p.meanDiff, 2) : '–'}</td>`;
    }).join('')}</tr>
    <tr class="row"><th scope="row">95% interval</th>${S.map((s) => {
      const p = paired.find((d) => d.id === s.id);
      return `<td class="s-${s.id}">${p ? `${fmtSigned(p.ci95Low, 2)} to ${fmtSigned(p.ci95High, 2)}` : '–'}</td>`;
    }).join('')}</tr></tbody>`;

  els.board.innerHTML = head + groups + diffs;
  els.board.querySelectorAll('.spark rect').forEach((r, i) => r.style.setProperty('--i', String(i % 30)));
  replay(els.board, 'enter');
  countUp(els.board, '.strat-val', S);
}

function renderTheory(S, params) {
  const fixed = S.find((s) => s.id === 'fixed');
  const theory = expectedSpreadPnl(toMarket(params), params.halfSpread);
  const inside = theory >= fixed.ci95Low && theory <= fixed.ci95High;
  els.theory.innerHTML = `
    <svg viewBox="0 0 16 16" aria-hidden="true" class="${inside ? 'ok' : 'warn'}">${inside
      ? '<circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M4.8 8.3l2.2 2.1 4.2-4.6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>'
      : '<circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 4.5v4.5M8 11.2v.3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>'}</svg>
    <span><strong>${inside ? 'Matches the formula.' : 'Outside the formula’s interval.'}</strong>
    Closed-form spread income for the fixed spread is ${fmt(theory, 2)}; the simulation gives ${fmt(fixed.meanPnl, 2)},
    with a 95% interval of ${fmt(fixed.ci95Low, 2)} to ${fmt(fixed.ci95High, 2)}.</span>`;
}

function renderResults() {
  const { payload, params } = state.run;
  renderHeadline(payload.summaries, params);
  renderBoard(payload.summaries, payload.paired, payload.items);
  renderTheory(payload.summaries, params);
  els.csv.disabled = false;
  els.json.disabled = false;
  els.results.classList.remove('results-stale');
  els.meta.textContent = runMetaText();
  renderActiveChart(true);
}

/** `fresh` plays the entrance (new results or a tab switch); resizes redraw silently. */
function renderActiveChart(fresh = false) {
  if (!state.run) return;
  const items = itemsWithSummary();
  const target = { pnl: $('chart-pnl'), inv: $('chart-inv'), dd: $('chart-dd') }[state.tab];
  target.classList.toggle('enter', fresh && motionOK());
  if (state.tab === 'pnl') renderPnl(target, items);
  if (state.tab === 'inv') renderInventory(target, state.run.payload.recordTimes, items);
  if (state.tab === 'dd') renderDrawdown(target, items);
}

/* ---------- Page motion: nav highlight and reveal on scroll ---------- */

function bindPageMotion() {
  const links = new Map([...document.querySelectorAll('.nav-links a')].map((a) => [a.getAttribute('href').slice(1), a]));
  const current = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      for (const [id, a] of links) {
        if (id === e.target.id) a.setAttribute('aria-current', 'true');
        else a.removeAttribute('aria-current');
      }
    }
  }, { rootMargin: '-45% 0px -50% 0px' });
  for (const id of links.keys()) { const s = $(id); if (s) current.observe(s); }
  const hero = document.querySelector('.hero');
  new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) for (const a of links.values()) a.removeAttribute('aria-current');
  }, { rootMargin: '-45% 0px -50% 0px' }).observe(hero);

  if (!motionOK()) return;
  const reveal = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add('is-in');
      reveal.unobserve(e.target);
    }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
  document.querySelectorAll('[data-reveal]').forEach((n) => reveal.observe(n));
}

/* ---------- Tabs ---------- */

let placeInkForSelected = () => {};

function bindTabs() {
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  const list = document.querySelector('.tabs');
  const ink = document.createElement('span');
  ink.className = 'tab-ink';
  ink.setAttribute('aria-hidden', 'true');
  list.appendChild(ink);
  const placeInk = (tab) => {
    ink.style.width = `${tab.offsetWidth}px`;
    ink.style.transform = `translateX(${tab.offsetLeft}px)`;
  };
  placeInkForSelected = () => placeInk(tabs.find((t) => t.getAttribute('aria-selected') === 'true') || tabs[0]);
  const select = (tab, focus = false) => {
    if (state.tab === tab.id.replace('tab-', '') && !focus) return;
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      $(t.getAttribute('aria-controls')).hidden = !on;
    }
    state.tab = tab.id.replace('tab-', '');
    placeInk(tab);
    if (focus) tab.focus();
    renderActiveChart(true);
  };
  for (const t of tabs) {
    t.addEventListener('click', () => select(t));
    t.addEventListener('keydown', (e) => {
      const i = tabs.indexOf(t);
      if (e.key === 'ArrowRight') select(tabs[(i + 1) % tabs.length], true);
      else if (e.key === 'ArrowLeft') select(tabs[(i - 1 + tabs.length) % tabs.length], true);
      else if (e.key === 'Home') select(tabs[0], true);
      else if (e.key === 'End') select(tabs[tabs.length - 1], true);
      else return;
      e.preventDefault();
    });
  }
}

/* ---------- Export, share, theme ---------- */

function download(name, type, content) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function fileStem() {
  const p = state.run.params;
  return `mmsim_sigma${p.sigma}_seed${p.seed}_${p.nPaths}paths`;
}

function bindExports() {
  els.json.addEventListener('click', () => {
    if (!state.run) return;
    const { params, payload } = state.run;
    const doc = {
      note: 'Synthetic simulation. Prices and order flow are generated by the model; no real market data.',
      generatedAt: new Date().toISOString(),
      params,
      market: toMarket(params),
      strategies: toStrategies(params),
      closedFormFixedSpreadPnl: expectedSpreadPnl(toMarket(params), params.halfSpread),
      summaries: payload.summaries,
      pairedDiffVsFixed: payload.paired,
      simulationMs: payload.simMs,
    };
    download(`${fileStem()}.json`, 'application/json', JSON.stringify(doc, null, 2));
    toast('Results downloaded');
  });
  els.csv.addEventListener('click', () => {
    if (!state.run) return;
    const S = state.run.payload.summaries;
    const keys = Object.keys(S[0]).filter((k) => k !== 'label' && k !== 'id');
    const rows = [['strategy', ...keys].join(',')];
    for (const s of S) rows.push([s.id, ...keys.map((k) => s[k])].join(','));
    download(`${fileStem()}.csv`, 'text/csv', `${rows.join('\n')}\n`);
    toast('Table downloaded');
  });
  $('copy-link').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      toast('Link copied. It opens with these exact settings.');
    } catch {
      toast('The browser blocked copying. Copy the address bar instead.');
    }
  });
}

let toastTimer = 0;
function toast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2400);
}

function bindTheme() {
  const root = document.documentElement;
  const group = $('theme-toggle');
  const current = () => root.dataset.theme || 'system';
  const paint = () => {
    for (const b of group.querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.themeChoice === current()));
    positionPill(group);
  };
  group.addEventListener('click', (e) => {
    const b = e.target.closest('[data-theme-choice]');
    if (!b) return;
    const v = b.dataset.themeChoice;
    if (v === 'system') delete root.dataset.theme; else root.dataset.theme = v;
    try {
      if (v === 'system') localStorage.removeItem('mmsim-theme'); else localStorage.setItem('mmsim-theme', v);
    } catch { /* storage unavailable: the theme still applies for this visit */ }
    paint();
    renderExplainers();
    renderActiveChart();
    tape.restyle();
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => tape.restyle());
  paint();
}

/* ---------- Resize ---------- */

function bindResize() {
  let frameId = 0;
  let lastW = 0;
  const ro = new ResizeObserver((entries) => {
    const w = Math.round(entries[0].contentRect.width);
    if (w === lastW) return;
    lastW = w;
    cancelAnimationFrame(frameId);
    frameId = requestAnimationFrame(() => {
      renderExplainers();
      renderActiveChart();
      positionAllPills();
      placeInkForSelected();
    });
  });
  ro.observe(document.body);
}

/* ---------- Boot ---------- */

window.addEventListener('hashchange', () => {
  state.params = { ...DEFAULTS, ...readHash() };
  syncForm();
  updatePresetUi();
  renderExplainers();
  updateStale();
});

document.querySelectorAll('.seg').forEach(mountPill);
syncForm();
bindForm();
bindTabs();
bindExports();
bindTheme();
updatePresetUi();
renderExplainers();
bindResize();
bindPageMotion();
placeInkForSelected();
// Web fonts change button widths; re-measure the pills and tab ink once they load.
document.fonts?.ready.then(() => { positionAllPills(); placeInkForSelected(); });
startRun();
