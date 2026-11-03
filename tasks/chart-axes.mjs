// @ts-check
/**
 * chart-axes (R2c.1): one model for every line chart on /life.
 *
 * `lineChart()` turns a series into a `ChartModel` that `partials/chart-line.html`
 * draws: a gapped line + area scaled into a "nice" y domain, y and x tick
 * labels positioned in percent, and the aria summary. Pure data — the only
 * computed strings are SVG path data and tick labels (the Skier rule).
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MULTS = [1, 2, 2.5, 5, 10];

/** Strip float dust (0.30000000000000004 → 0.3). */
const clean = (v) => +v.toPrecision(12);

/** A percent to 2 places (style attributes stay short). */
const pc = (v) => Math.round(v * 100) / 100;

/** Smallest step from {1, 2, 2.5, 5} × 10^k that is ≥ raw. */
function niceStep(raw) {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const p = 10 ** Math.floor(Math.log10(raw));
  for (const m of MULTS) if (m * p >= raw * (1 - 1e-9)) return clean(m * p);
  return clean(10 * p);
}

/** Decimal places a step needs (2.5 → 1, 0.25 → 2, 50 → 0). */
function stepDecimals(step) {
  const s = String(step);
  const i = s.indexOf('.');
  return i < 0 ? 0 : s.length - i - 1;
}

/**
 * Ascending, evenly spaced ticks covering [min, max], aiming at `count` of
 * them. A flat range pads one step either side of the value.
 * @param {number} min
 * @param {number} max
 * @param {number} [count]
 * @returns {number[]}
 */
export function niceTicks(min, max, count = 3) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (min > max) [min, max] = [max, min];
  if (min === max) {
    const pad = niceStep(Math.abs(min) / 10 || 1);
    return niceTicks(min - pad, max + pad, count);
  }
  const step = niceStep((max - min) / Math.max(1, count - 1));
  const lo = Math.floor(clean(min / step));
  const hi = Math.ceil(clean(max / step));
  const out = [];
  for (let i = lo; i <= hi; i++) out.push(clean(i * step));
  return out;
}

/** `v` to `decimals` places, trailing zeros (and a bare `.`) dropped. */
function fixed(v, decimals) {
  const s = v.toFixed(Math.max(0, decimals));
  const t = s.includes('.') ? s.replace(/\.?0+$/, '') : s;
  return t === '-0' ? '0' : t;
}

/**
 * Tick label: 1,000 and up compacts to `1K` / `12.5K` (a million to `1M`),
 * otherwise `decimals` places with no trailing `.0`.
 * @param {number} v
 * @param {number} decimals
 */
export function formatTick(v, decimals) {
  const a = Math.abs(v);
  if (a >= 1e6) return `${fixed(v / 1e6, 1)}M`;
  if (a >= 1000) return `${fixed(v / 1000, 1)}K`;
  return fixed(v, decimals);
}

/** `2026-10-05` → `5 Oct`. */
function weekLabel(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
  return m ? `${+m[3]} ${MONTHS[+m[2] - 1] ?? ''}`.trim() : '';
}

/** `2026-10` → `Oct ’26`. */
function monthLabel(ym) {
  const m = /^(\d{4})-(\d{2})/.exec(String(ym ?? ''));
  return m ? `${MONTHS[+m[2] - 1] ?? ''} ’${m[1].slice(2)}` : '';
}

/** Seconds as `m:ss`, or `h:mm` when `long`. */
function clockLabel(sec, long) {
  const s = Math.max(0, Math.round(sec));
  const pad = (n) => String(n).padStart(2, '0');
  if (long) return `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}`;
  return `${Math.floor(s / 60)}:${pad(s % 60)}`;
}

/** x tick labels (first, middle, last; days: every label), pct from the left. */
function xTicksFor(x, n) {
  const pctOf = (i) => (n > 1 ? pc((i / (n - 1)) * 100) : 0);
  const fml = [...new Set([0, Math.floor((n - 1) / 2), n - 1])];
  if (!x || typeof x !== 'object') return [];
  if (x.kind === 'days') {
    const labels = Array.isArray(x.labels) ? x.labels : [];
    return labels.slice(0, n).map((label, i) => ({ label: String(label ?? ''), pct: pctOf(i) }));
  }
  if (x.kind === 'weeks') {
    const w = Array.isArray(x.weeks) ? x.weeks : [];
    return fml.map((i) => ({ label: weekLabel(w[i]), pct: pctOf(i) })).filter((t) => t.label);
  }
  if (x.kind === 'months') {
    const ms = Array.isArray(x.months) ? x.months : [];
    return fml.map((i) => ({ label: monthLabel(ms[i]), pct: pctOf(i) })).filter((t) => t.label);
  }
  if (x.kind === 'clock') {
    const total = Number.isFinite(x.seconds) && x.seconds > 0 ? x.seconds : 0;
    if (!total) return [];
    const long = total >= 3600;
    return [0, 50, 100].map((pct) => ({ label: clockLabel((total * pct) / 100, long), pct }));
  }
  return [];
}

/** The x extent in words for the summary: `26 weeks`, `55:00`, `7 days`. */
function xSpan(x, n) {
  switch (x?.kind) {
    case 'weeks': return `${n} weeks`;
    case 'months': return `${n} months`;
    case 'days': return `${n} days`;
    case 'clock': {
      const total = Number.isFinite(x.seconds) && x.seconds > 0 ? x.seconds : 0;
      return total ? `over ${clockLabel(total, total >= 3600)}` : `${n} samples`;
    }
    default: return `${n} points`;
  }
}

/**
 * @typedef {{ kind: 'weeks', weeks: string[] }
 *   | { kind: 'months', months: string[] }
 *   | { kind: 'clock', seconds: number }
 *   | { kind: 'days', labels: string[] }} XSpec
 * @typedef {{ label: string, pct: number }} Tick
 * @typedef {{ d: string, area: string, w: number, h: number, label: string, unit: string,
 *   yTicks: Tick[], xTicks: Tick[], summary: string,
 *   end: { label: string, x: number, y: number } }} ChartModel
 */

/**
 * The model for one line chart. `values` are in x order; `null`/non-finite
 * samples break the line. Null when fewer than 2 finite values.
 * @param {Array<number|null|undefined>} values
 * @param {{ label: string, unit: string, decimals?: number, w?: number, h?: number, x: XSpec }} opts
 * @returns {ChartModel | null}
 */
export function lineChart(values, opts) {
  if (!Array.isArray(values)) return null;
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);
  const valid = values.filter(finite);
  if (valid.length < 2) return null;
  const w = opts?.w ?? 600;
  const h = opts?.h ?? 160;
  const label = String(opts?.label ?? '');
  const unit = String(opts?.unit ?? '');
  const n = values.length;

  const ticks = niceTicks(Math.min(...valid), Math.max(...valid));
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];
  const step = ticks.length > 1 ? clean(ticks[1] - ticks[0]) : 1;
  const decimals = Math.max(opts?.decimals ?? 0, stepDecimals(step));
  const toY = (v) => +(h - ((v - lo) / (hi - lo)) * h).toFixed(1);
  const toX = (i) => +((i / (n - 1)) * w).toFixed(1);

  const segs = [];
  let pen = false;
  let firstX = 0;
  let lastX = 0;
  let lastI = 0;
  for (let i = 0; i < n; i++) {
    const v = values[i];
    if (!finite(v)) { pen = false; continue; }
    const x = toX(i);
    segs.push(`${pen ? 'L' : 'M'}${x},${toY(/** @type {number} */ (v))}`);
    if (segs.length === 1) firstX = x;
    pen = true;
    lastX = x;
    lastI = i;
  }
  const d = segs.join(' ');
  // The area closes to the baseline across the drawn span; gaps are bridged
  // (it is a wash, not data).
  const area = `${d.replace(/M/g, (m, i) => (i === 0 ? 'M' : 'L'))} L${lastX},${h} L${firstX},${h} Z`;

  const yTicks = [...ticks].reverse().map((t) => ({
    label: formatTick(t, decimals),
    pct: pc(((hi - t) / (hi - lo)) * 100),
  }));

  const words = (v) => v.toLocaleString('en-GB', { maximumFractionDigits: opts?.decimals ?? 0 });
  const first = valid[0];
  const last = valid[valid.length - 1];
  const summary = `${label}${unit ? ` in ${unit}` : ''}, ${xSpan(opts?.x, n)}: ${words(first)} to ${words(last)}`;

  return {
    d, area, w, h, label, unit,
    yTicks,
    xTicks: xTicksFor(opts?.x, n),
    summary,
    // The latest value, directly labelled at its point (percent of the plot).
    end: {
      label: formatTick(last, opts?.decimals ?? 0),
      x: pc((lastI / (n - 1)) * 100),
      y: pc(((hi - last) / (hi - lo)) * 100),
    },
  };
}
