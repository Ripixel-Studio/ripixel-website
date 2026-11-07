// @ts-check
/**
 * /life/body, the drawn parts (data only; the template loops and tests):
 *
 *   recompView(journey)          fat mass against lean mass: a then/now pair of stacked columns,
 *                                one stacked column a month, and the one-line story. Null without
 *                                both ends of weight and body fat.
 *   engineView(journey)          the heart (resting rate then and now, and the heartbeats a day that
 *                                makes) and VO2 max on a fixed scale with then/now markers.
 *   nightsView(nights)           the last 30 nights as stacked stage columns: minutes only, never a clock.
 *   stepsView(steps, endDay)     a year of days, contribution-grid style, plus the lifetime numbers.
 */
import { commitGrid } from './code-view.mjs';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const num = (/** @type {unknown} */ n) => (typeof n === 'number' && Number.isFinite(n) ? n : null);
const group = (/** @type {number} */ n) => Math.round(n).toLocaleString('en-GB');
const one = (/** @type {number} */ n) => (Math.round(n * 10) / 10).toFixed(1);
const hm = (/** @type {number} */ min) => `${Math.floor(min / 60)}h ${String(Math.round(min % 60)).padStart(2, '0')}m`;
const pct = (/** @type {number} */ n) => Math.round(n * 10) / 10;
/** 'Aug 2025' from YYYY-MM @param {unknown} m */
const month = (m) => {
  const x = /^(\d{4})-(\d{2})$/.exec(String(m ?? ''));
  return x ? `${MONTHS[+x[2] - 1]} ${x[1]}` : '';
};
/** `Aug` and, in January or the first column, the year under it @param {string} m @param {boolean} first */
const tick = (m, first) => ({ label: MONTHS[+m.slice(5, 7) - 1], year: first || m.endsWith('-01') ? m.slice(0, 4) : '' });

/** @param {any} journey @returns {Record<string, any>} */
const rowsOf = (journey) => Object.fromEntries((Array.isArray(journey?.rows) ? journey.rows : [])
  .filter((/** @type {any} */ r) => r && typeof r.key === 'string' && num(r.first) != null && num(r.now) != null)
  .map((/** @type {any} */ r) => [r.key, r]));

/** @param {any} journey */
export function recompView(journey) {
  const r = rowsOf(journey);
  const fat = r.fatMassKg, lean = r.leanMassKg;
  if (!fat || !lean) return null;
  const top = Math.max(fat.first + lean.first, fat.now + lean.now);
  const col = (/** @type {number} */ f, /** @type {number} */ l, /** @type {string} */ when) => ({
    when, fat: one(f), lean: one(l), weight: one(f + l), fatPct: one((100 * f) / (f + l)),
    h: pct((100 * (f + l)) / top), fatShare: pct((100 * f) / (f + l)),
  });
  const df = fat.now - fat.first, dl = lean.now - lean.first;
  const story = df < -0.5 && dl > 0.5
    ? { lead: `${one(-df)} kg of fat`, mid: 'swapped for', tail: `${one(dl)} kg of lean` }
    : df < -0.5 ? { lead: `${one(-df)} kg of fat`, mid: 'gone', tail: '' }
      : dl > 0.5 ? { lead: `${one(dl)} kg of lean`, mid: 'added', tail: '' } : null;
  const months = (Array.isArray(journey.monthly) ? journey.monthly : [])
    .filter((/** @type {any} */ m) => m && /^\d{4}-\d{2}$/.test(String(m.month)) && num(m.fatMassKg) != null && num(m.leanMassKg) != null);
  const mtop = Math.max(...months.map((/** @type {any} */ m) => m.fatMassKg + m.leanMassKg), 1);
  const then = col(fat.first, lean.first, month(fat.from)), now = col(fat.now, lean.now, month(fat.to));
  return {
    from: month(fat.from), to: month(fat.to), story, then, now, pair: [then, now],
    weightFlat: r.weightKg ? Math.abs(r.weightKg.change) <= 0.5 : false,
    weightChange: r.weightKg ? one(Math.abs(r.weightKg.change)) : '',
    weightDir: r.weightKg ? (r.weightKg.change > 0.5 ? 'up' : r.weightKg.change < -0.5 ? 'down' : 'flat') : '',
    monthly: months.map((/** @type {any} */ m, /** @type {number} */ i) => ({
      ...tick(m.month, i === 0),
      h: pct((100 * (m.fatMassKg + m.leanMassKg)) / mtop),
      fatShare: pct((100 * m.fatMassKg) / (m.fatMassKg + m.leanMassKg)),
      title: `${month(m.month)}: ${one(m.leanMassKg)} kg lean, ${one(m.fatMassKg)} kg fat`,
    })),
  };
}

const VO2_LO = 35, VO2_HI = 60;

/** @param {any} journey @param {any} latest the export's `latest` (VO2 max may be newer than the journey's end) */
export function engineView(journey, latest) {
  const r = rowsOf(journey);
  const hr = r.restingHr, vo2 = r.vo2Max;
  const heart = hr ? {
    was: group(hr.first), now: group(hr.now), from: month(hr.from),
    drop: hr.change < 0 ? group(-hr.change) : '',
    beats: hr.change <= -1 ? group(Math.round(-hr.change) * 1440) : '',
    // one beat per second-ish: the pulse animation runs at the resting rate now
    period: one(60 / hr.now),
  } : null;
  const at = (/** @type {number} */ v) => pct(Math.max(0, Math.min(100, ((v - VO2_LO) / (VO2_HI - VO2_LO)) * 100)));
  const nowV = num(latest?.vo2Max) ?? vo2?.now;
  const gauge = vo2 && nowV != null ? {
    was: one(vo2.first), now: one(nowV), from: month(vo2.from), last: month(vo2.to),
    firstAt: at(vo2.first), nowAt: at(nowV), up: nowV > vo2.first ? one(nowV - vo2.first) : '',
    ticks: [35, 40, 45, 50, 55, 60].map((v) => ({ v, at: at(v) })),
  } : null;
  return heart || gauge ? { heart, gauge } : null;
}

const NIGHT_FLOOR = 540;    // the columns are drawn against at least 9 hours, so a short month still looks short

/** @param {any} nights [{date, minutes, deep?, light?, rem?, wake?}] */
export function nightsView(nights) {
  const rows = (Array.isArray(nights) ? nights : []).filter((n) => n && /^\d{4}-\d{2}-\d{2}$/.test(String(n.date)) && num(n.minutes) != null && n.minutes > 0);
  if (rows.length < 7) return null;
  const total = (/** @type {any} */ n) => n.minutes + (num(n.wake) ?? 0);
  const top = Math.max(NIGHT_FLOOR, ...rows.map(total));
  const avg = rows.reduce((a, n) => a + n.minutes, 0) / rows.length;
  const staged = rows.filter((n) => ['deep', 'light', 'rem'].every((k) => num(n[k]) != null));
  const longest = rows.reduce((a, n) => (n.minutes > a.minutes ? n : a));
  return {
    count: rows.length,
    avg: hm(avg), avgAt: pct((100 * avg) / top),
    guides: [6, 8].filter((h) => h * 60 < top).map((h) => ({ label: `${h}h`, at: pct((100 * h * 60) / top) })),
    deepest: staged.length ? hm(Math.max(...staged.map((n) => n.deep))) : '',
    longest: hm(longest.minutes),
    cols: rows.map((n) => {
      const d = new Date(`${n.date}T00:00:00Z`);
      const t = total(n);
      const parts = staged.includes(n)
        ? ['deep', 'rem', 'light', 'wake'].map((k) => ({ key: k, h: pct((100 * (num(n[k]) ?? 0)) / t) })).filter((p) => p.h > 0)
        : [{ key: 'asleep', h: 100 }];
      return {
        dow: DOW[d.getUTCDay()], weekend: d.getUTCDay() === 0 || d.getUTCDay() === 6,
        h: pct((100 * t) / top), parts,
        title: `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}: ${hm(n.minutes)} asleep${staged.includes(n) ? `, ${hm(n.deep)} deep, ${hm(n.rem)} REM` : ''}`,
      };
    }),
  };
}

const STRIDE_M = 0.75;      // an average stride; the distance is an estimate and says so
const MARATHON_KM = 42.195;

/** @param {any} steps {since, total, days, tenK, best, daily: {day: n}} @param {string} endDay */
export function stepsView(steps, endDay) {
  if (!steps || typeof steps !== 'object' || num(steps.total) == null || !steps.daily || typeof steps.daily !== 'object') return null;
  const grid = commitGrid(Object.entries(steps.daily).map(([day, n]) => ({ day, n })), endDay, 53,
    { noun: ['step', 'steps'], cuts: [4999, 9999, 14999] });
  const km = (steps.total * STRIDE_M) / 1000;
  const millions = steps.total >= 1e6;
  return {
    grid,
    total: millions ? one(steps.total / 1e6) : group(steps.total), totalUnit: millions ? 'million' : '',
    since: month(String(steps.since || '').slice(0, 7)),
    km: group(km), marathons: group(km / MARATHON_KM),
    tenK: num(steps.tenK) != null ? group(steps.tenK) : '', days: num(steps.days) != null ? group(steps.days) : '',
    tenKShare: num(steps.tenK) != null && steps.days ? Math.round((100 * steps.tenK) / steps.days) : null,
    best: num(steps.best) != null ? group(steps.best) : '',
    legend: [
      { level: 1, label: 'under 5k' }, { level: 2, label: '5–10k' }, { level: 3, label: '10–15k' }, { level: 4, label: '15k+' },
    ],
  };
}
