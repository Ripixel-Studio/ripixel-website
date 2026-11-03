// @ts-check
/**
 * The /life hub, its seven section pages and the personal bits (LH3.4, R2c.2): data only.
 * Pure functions shape `lifeIndex` (the public life export) and `fitnessLife`
 * into view models; the templates only loop and test. No HTML strings here.
 * The only computed strings are chart models from `chart-axes.mjs` (SVG path
 * data and tick labels).
 *
 * Globals set by `lifeHubTask()`:
 *   lifeHub       { cards[{name, href, title, headline, latest, note, staleLabel, empty}], outings[] }
 *   lifeSections  { [name]: view }
 *   lifePersonal  [{ key, label, value, tone }]
 *   lifeFacts     { [key]: value }
 *   lifeInsights  [{ id, text, href }]  (C5, at most 6)
 *
 * NOTE for Task 7: the `work` section is not part of this task. Its view
 * (`workView`) must carry a salary table (role, salary, delta) shown only when
 * `work.salary` exists in the export (ruling F9).
 */

import { lineChart } from './chart-axes.mjs';

export const SECTION_ORDER = ['fitness', 'body', 'games', 'code', 'watching', 'listening', 'reading'];
/** @param {string} name */
export const SECTION_HREF = (name) => '/life/' + name;

const TITLES = {
  fitness: 'Fitness', body: 'Body', games: 'Games',
  code: 'Code', watching: 'Watching', listening: 'Listening', reading: 'Reading',
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** @param {number|null|undefined} days */
export function staleLabel(days) {
  if (typeof days !== 'number' || !Number.isFinite(days) || days < 2) return '';
  return `last updated ${Math.floor(days)} days ago`;
}

/** 'Oct 2026' from YYYY-MM; '' when unusable. @param {string} month */
export function monthLabel(month) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
  if (!m || +m[2] < 1 || +m[2] > 12) return '';
  return `${MONTHS[+m[2] - 1]} ${m[1]}`;
}

/** @param {string} month YYYY-MM */
export function sawLabel(month) {
  const label = monthLabel(month);
  return label ? `saw in ${label}` : '';
}

const num = (/** @type {unknown} */ n) => (typeof n === 'number' && Number.isFinite(n) ? n : null);
const group = (/** @type {number} */ n) => Math.round(n).toLocaleString('en-GB');
const one = (/** @type {number} */ n) => (Math.round(n * 10) / 10).toFixed(1);
const hm = (/** @type {number} */ min) => `${Math.floor(min / 60)}h ${String(Math.round(min % 60)).padStart(2, '0')}m`;
const row = (/** @type {string} */ label, /** @type {string} */ value, unit = '') => ({ label, value, unit });

/** @param {any} h */
function headlineOf(h) {
  if (!h || typeof h !== 'object' || h.value == null) return null;
  const v = num(h.value);
  // A duration in minutes reads as hours and minutes ("7h 24m"), as the section's own rows do.
  if (v != null && String(h.unit || '') === 'min') return { value: hm(v), unit: '', label: String(h.label || '') };
  return { value: v == null ? String(h.value) : (Number.isInteger(v) ? group(v) : one(v)), unit: String(h.unit || ''), label: String(h.label || '') };
}

/** A section whose export gives no headline still leads with its own figure where it has one. @param {string} name @param {any} sec */
function fallbackHeadline(name, sec) {
  if (name === 'games' && num(sec.hoursTotal) != null) return { value: group(num(sec.hoursTotal)), unit: 'h', label: 'played, all time' };
  return null;
}

/** Newest notable by month (the first of equals). @param {any[]|undefined} list */
function latestOf(list) {
  let best = null;
  for (const n of Array.isArray(list) ? list : []) {
    if (!n || typeof n !== 'object') continue;
    if (!best || String(n.month || '') > String(best.month || '')) best = n;
  }
  return best;
}

/** @param {any} n */
function notableView(n) {
  return {
    key: String(n.key || ''), kind: String(n.kind || ''), title: String(n.title || ''),
    by: n.by || '', season: n.season ?? '', year: n.year ?? '', provider: n.provider || '',
    month: String(n.month || ''), monthLabel: monthLabel(n.month), reason: String(n.reason || ''), poster: n.poster || '',
  };
}

/** Notables newest month first, stable. @param {any[]} list */
function sortedNotables(list) {
  return (Array.isArray(list) ? list : [])
    .filter((n) => n && typeof n === 'object' && n.title)
    .map((n, i) => ({ n, i }))
    .sort((a, b) => String(b.n.month || '').localeCompare(String(a.n.month || '')) || a.i - b.i)
    .map((x) => notableView(x.n));
}

/** Non-empty: a non-null scalar, a non-empty string/array, or an object with a non-empty value. @param {any} v @returns {boolean} */
function filled(v) {
  if (v == null) return false;
  if (Array.isArray(v)) return v.some(filled);
  if (typeof v === 'object') return Object.values(v).some(filled);
  if (typeof v === 'string') return v.trim() !== '';
  return true;
}

/**
 * A section has data when its headline OR anything else beyond the bookkeeping
 * keys (lists, totals, single figures) is non-empty. A null headline with a
 * populated list (games: mostPlayed, serious, backlog...) is still data.
 * @param {any} sec
 */
function hasData(sec) {
  if (!sec || typeof sec !== 'object' || Array.isArray(sec)) return false;
  if (sec.headline && sec.headline.value != null) return true;
  return Object.entries(sec).some(([k, v]) => k !== 'updated' && k !== 'staleDays' && k !== 'headline' && filled(v));
}

/** One weekly column, gaps kept as null (the chart breaks its line there). @param {any[]} weekly @param {string} key */
const column = (weekly, key) => (Array.isArray(weekly) ? weekly : []).map((w) => num(w?.[key]));

/** A weekly line chart (axes from chart-axes.mjs), or null with fewer than 2 values. */
function weeklyChart(/** @type {any[]} */ weekly, /** @type {string} */ key, /** @type {string} */ label, /** @type {string} */ unit, decimals = 0, scale = 1) {
  const rows = Array.isArray(weekly) ? weekly.filter((w) => w && typeof w === 'object') : [];
  const values = column(rows, key).map((v) => (v == null ? null : v / scale));
  return lineChart(values, { label, unit, decimals, x: { kind: 'weeks', weeks: rows.map((w) => String(w.week || '')) } });
}

/** A stat row, or false when the number is missing (no zeros from nowhere). */
const stat = (/** @type {string} */ label, /** @type {unknown} */ v, /** @type {(n: number) => string} */ fmt, unit = '') => (num(v) != null ? row(label, fmt(/** @type {number} */ (v)), unit) : false);

/** A block view, or null when it has nothing to show. @param {any} v */
const block = (v) => (v.stats.length || v.charts.length ? v : null);

/** One 100 % bar from whole-number shares; null without at least two positive parts. */
function shares(/** @type {any} */ src, /** @type {[string, string, string][]} */ parts) {
  if (!src || typeof src !== 'object') return null;
  const out = parts.map(([key, field, label]) => ({ key, label, pct: num(src[field]) }))
    .filter((p) => p.pct != null && p.pct > 0)
    .map((p) => ({ ...p, pct: Math.round(/** @type {number} */ (p.pct)), narrow: /** @type {number} */ (p.pct) < 12 }));
  return out.length >= 2 ? out : null;
}

const MEASURE_LABELS = /** @type {Record<string, string>} */ ({
  waistCm: 'Waist', chestCm: 'Chest', hipsCm: 'Hips', neckCm: 'Neck', shoulderCm: 'Shoulders',
  armLCm: 'Left arm', armRCm: 'Right arm', thighLCm: 'Left thigh', thighRCm: 'Right thigh', calfLCm: 'Left calf', calfRCm: 'Right calf',
  muscleKg: 'Muscle mass', waterPct: 'Body water', boneKg: 'Bone mass', visceral: 'Visceral fat', bmrKcal: 'BMR',
  metabolicAge: 'Metabolic age', subcutaneousPct: 'Subcutaneous fat', skeletalMusclePct: 'Skeletal muscle', proteinPct: 'Protein',
});

/** `armRCm` → `Arm r`: a readable label for a measure this site has not named yet. */
const humanKey = (/** @type {string} */ k) => {
  const t = k.replace(/(Cm|Kg|Pct|Kcal)$/, '').replace(/([A-Z])/g, ' $1').trim().toLowerCase();
  return t ? t[0].toUpperCase() + t.slice(1) : k;
};

/** Signed change with a real minus: `+0.7`, `−2.5`, `0`. */
const signed = (/** @type {number} */ n, /** @type {number} */ d) => {
  const r = Number(n.toFixed(d));
  return r === 0 ? '0' : `${r > 0 ? '+' : '−'}${Math.abs(r).toFixed(d)}`;
};

/** `2026-08-11` → `11 Aug 2026`. */
const dayLabel = (/** @type {unknown} */ iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
  return m ? `${+m[3]} ${MONTHS[+m[2] - 1]} ${m[1]}` : '';
};

/** The Renpho block: tape and scale measures, each with change since its first reading. */
function measurementsView(/** @type {any} */ m) {
  if (!m || typeof m !== 'object') return null;
  const list = [...(Array.isArray(m.tape) ? m.tape : []), ...(Array.isArray(m.scale) ? m.scale : [])]
    .filter((x) => x && typeof x.key === 'string' && num(x.latest?.value) != null);
  const rows = [];
  const charts = [];
  for (const x of list) {
    const label = MEASURE_LABELS[x.key] || humanKey(x.key);
    const unit = String(x.unit || '');
    const d = Number.isInteger(x.latest.value) && (num(x.first?.value) == null || Number.isInteger(x.first.value)) ? 0 : 1;
    rows.push({
      key: x.key, label, unit, value: d ? one(x.latest.value) : group(x.latest.value),
      change: num(x.change) != null ? signed(x.change, d) : '',
      since: dayLabel(x.first?.date),
    });
    const c = weeklyChart(x.weekly, 'value', label, unit, d);
    if (c) charts.push(c);
  }
  return rows.length ? { rows, charts } : null;
}

/** The merged /life/body view (R2c.2): measures, sleep, food, movement, and Renpho measurements. */
function bodyView(/** @type {any} */ sec) {
  const l = sec.latest || {};
  const weekly = Array.isArray(sec.weekly) ? sec.weekly : [];
  const measures = {
    stats: [
      stat('Weight', l.weightKg, one, 'kg'),
      stat('Body fat', l.bodyFatPct, one, '%'),
      stat('BMI', l.bmi, one),
      stat('Lean mass', l.leanMassKg, one, 'kg'),
      stat('Resting heart rate', l.restingHr, group, 'bpm'),
      stat('HRV', l.hrvMs, group, 'ms'),
      stat('VO₂ max', l.vo2Max, one, 'ml/kg/min'),
      stat('SpO₂', l.spo2Pct, one, '%'),
      stat('Breathing rate', l.breathsPerMin, one, '/min'),
    ].filter(Boolean),
    charts: [
      weeklyChart(weekly, 'weightKg', 'Weight', 'kg', 1),
      weeklyChart(weekly, 'bodyFatPct', 'Body fat', '%', 1),
      weeklyChart(weekly, 'restingHr', 'Resting heart rate', 'bpm'),
      weeklyChart(weekly, 'hrvMs', 'HRV', 'ms'),
      weeklyChart(weekly, 'vo2Max', 'VO₂ max', 'ml/kg/min', 1),
      weeklyChart(weekly, 'spo2Pct', 'SpO₂', '%', 1),
      weeklyChart(weekly, 'breathsPerMin', 'Breathing rate', 'breaths/min', 1),
    ].filter(Boolean),
  };

  const s = sec.sleep && typeof sec.sleep === 'object' ? sec.sleep : null;
  const sleep = s && block({
    stats: [
      stat('Last 30 nights', s.avgMinutes30, hm),
      stat('Last 90 nights', s.avgMinutes90, hm),
      stat('Consistency', s.consistencyMinutes, (n) => `±${group(n)}`, 'min'),
      s.best?.date && num(s.best.minutes) != null && { ...row('Best night', hm(s.best.minutes)), sub: String(s.best.date) },
      s.worst?.date && num(s.worst.minutes) != null && { ...row('Shortest night', hm(s.worst.minutes)), sub: String(s.worst.date) },
    ].filter(Boolean),
    charts: [weeklyChart(s.weekly, 'avgMinutes', 'Sleep, weekly average', 'h', 1, 60)].filter(Boolean),
    stages: shares(s.stages30, [['deep', 'deepPct', 'Deep'], ['light', 'lightPct', 'Light'], ['rem', 'remPct', 'REM'], ['wake', 'wakePct', 'Awake']]),
  });

  const f = sec.food && typeof sec.food === 'object' ? sec.food : null;
  const food = f && block({
    stats: [
      stat('Protein per kg', f.proteinPerKg30, one, 'g/kg'),
      stat('Energy', f.avgKcal30, group, 'kcal'),
      stat('Protein', f.avgProteinG30, group, 'g'),
      stat('Carbs', f.avgCarbsG30, group, 'g'),
      stat('Fat', f.avgFatG30, group, 'g'),
      stat('Fibre', f.avgFibreG30, group, 'g'),
      stat('Logging streak', f.loggedStreakDays, group, 'days'),
      stat('Protein target streak', f.proteinStreakDays, group, 'days'),
    ].filter(Boolean),
    charts: [
      weeklyChart(f.weekly, 'avgKcal', 'Energy, daily average', 'kcal'),
      weeklyChart(f.weekly, 'avgProteinG', 'Protein, daily average', 'g'),
    ].filter(Boolean),
    split: shares(f.split30, [['protein', 'proteinPct', 'Protein'], ['carbs', 'carbsPct', 'Carbs'], ['fat', 'fatPct', 'Fat']]),
  });

  const mv = sec.movement && typeof sec.movement === 'object' ? sec.movement : null;
  const movement = mv && block({
    stats: [
      stat('Steps a day', mv.avgSteps30, group),
      stat('Active zone minutes a week', mv.avgAzmWeek4, group, 'min'),
    ].filter(Boolean),
    charts: [
      weeklyChart(mv.weekly, 'avgSteps', 'Steps, daily average', 'steps'),
      weeklyChart(mv.weekly, 'azmMinutes', 'Active zone minutes', 'min'),
    ].filter(Boolean),
  });

  return { measures, sleep: sleep || null, food: food || null, movement: movement || null, measurements: measurementsView(sec.measurements) };
}

/** @param {any} sec @param {any[]} outings notables of the matching outing kind */
function mediaView(sec, outings) {
  const yearTotals = sec.totals?.year || {};
  const monthTotals = sec.totals?.month || {};
  return {
    notable: sortedNotables(sec.notable),
    years: Object.fromEntries(Object.entries(sec.years || {}).map(([y, l]) => [y, sortedNotables(/** @type {any[]} */ (l))])),
    yearList: Object.keys(sec.years || {}).sort().reverse(),
    totals: { month: monthTotals, year: yearTotals },
    saw: outings.map((n) => ({ ...notableView(n), sawLabel: sawLabel(n.month) })),
    hasSaw: outings.length > 0,
  };
}

/**
 * One section's page view. `sec` is the export's section, or the fitness card
 * source; a missing or empty one gives `empty: true` and no numbers at all.
 * @param {string} name @param {any} sec @param {Date} [now]
 * @param {any[]} [outingNotables] outings notables (cinema/gig split here)
 */
export function buildSection(name, sec, now = new Date(), outingNotables = []) {
  const base = { name, href: SECTION_HREF(name), title: /** @type {any} */ (TITLES)[name] || name };
  if (!hasData(sec)) return { ...base, staleLabel: '', empty: true, headline: null, latest: null };
  const view = { ...base, staleLabel: staleLabel(sec.staleDays), updated: String(sec.updated || ''), empty: false, headline: headlineOf(sec.headline) ?? fallbackHeadline(name, sec), latest: /** @type {any} */ (null) };
  const weekly = sec.weekly;
  switch (name) {
    case 'body':
      return { ...view, ...bodyView(sec) };
    case 'games': {
      const a = sec.achievements || {};
      const names = (/** @type {any} */ l) => (Array.isArray(l) ? l : typeof l === 'string' && l ? [l] : []).map((g) => (typeof g === 'string' ? { name: g, hours: null } : { name: String(g?.name || ''), hours: num(g?.hours) })).filter((g) => g.name);
      return {
        ...view,
        stats: [
          num(sec.hoursYear) != null && row('This year', group(sec.hoursYear), 'h'),
          num(sec.hoursTotal) != null && row('All time', group(sec.hoursTotal), 'h'),
          num(a.unlocked) != null && num(a.total) != null && row('Achievements', `${group(a.unlocked)} / ${group(a.total)}`),
          num(sec.backlog) != null && row('Backlog', group(sec.backlog), 'games'),
        ].filter(Boolean),
        mostPlayed: names(sec.mostPlayed), recent: names(sec.recent), serious: names(sec.serious), silly: sameList(names(sec.silly), names(sec.serious)) ? [] : names(sec.silly),
      };
    }
    case 'code': {
      const byYear = sec.languagesByYear || {};
      return {
        ...view,
        projects: (Array.isArray(sec.projects) ? sec.projects : []).map((p) => ({
          name: String(p?.name || ''), started: String(p?.started || ''), languages: Array.isArray(p?.languages) ? p.languages : [],
          url: typeof p?.url === 'string' && /^https:\/\//.test(p.url) ? p.url : '',
        })).filter((p) => p.name),
        languagesNow: Array.isArray(sec.languagesNow) ? sec.languagesNow : [],
        languagesByYear: Object.keys(byYear).sort().map((y) => ({
          year: y,
          languages: Object.entries(byYear[y] || {}).sort((a, b) => Number(b[1]) - Number(a[1]))
            .map(([lang, share]) => ({ name: lang, pct: Math.round(Number(share) * 10) / 10 })),
        })),
        commits: (() => {
          const months = (Array.isArray(sec.commitsByMonth) ? sec.commitsByMonth : []).filter((m) => m && typeof m === 'object');
          return lineChart(months.map((m) => num(m.n) ?? 0), { label: 'Commits', unit: 'a month', x: { kind: 'months', months: months.map((m) => String(m.month || '')) } });
        })(),
      };
    }
    case 'watching': {
      const m = mediaView(sec, outingNotables.filter((n) => n.kind === 'cinema'));
      const y = m.totals.year, mo = m.totals.month;
      return { ...view, ...m, latest: latestOf(sec.notable),
        stats: [
          ['This year', y], ['This month', mo],
        ].map(([label, t]) => /** @type {any} */ (t) && Object.keys(/** @type {any} */ (t)).length ? ({
          label, // "watched", never "finished"
          items: [row('Films watched', group(num(t.films) ?? 0)), row('Episodes', group(num(t.episodes) ?? 0)), row('Videos', group(num(t.videos) ?? 0)), row('Hours', group(num(t.hours) ?? 0), 'h')],
        }) : null).filter(Boolean) };
    }
    case 'listening': {
      const m = mediaView(sec, outingNotables.filter((n) => n.kind === 'gig'));
      return { ...view, ...m, latest: latestOf(sec.notable),
        stats: [['This year', m.totals.year], ['This month', m.totals.month]].map(([label, t]) => /** @type {any} */ (t) && Object.keys(/** @type {any} */ (t)).length ? ({
          label,
          items: [row('Tracks', group(num(t.tracks) ?? 0)), row('Podcast episodes', group(num(t.podcastEpisodes) ?? 0)), row('Audiobook', group(num(t.audiobookHours) ?? 0), 'h')],
        }) : null).filter(Boolean) };
    }
    case 'reading': {
      const m = mediaView(sec, []);
      return { ...view, ...m, latest: latestOf(sec.notable),
        current: (Array.isArray(sec.current) ? sec.current : []).map((c) => ({ title: String(c?.title || ''), by: c?.by || '', percent: Math.round((num(c?.progress) ?? 0) * 100) })).filter((c) => c.title),
        stats: [['This year', m.totals.year], ['This month', m.totals.month]].map(([label, t]) => /** @type {any} */ (t) && Object.keys(/** @type {any} */ (t)).length ? ({
          label, items: [row('Books', group(num(t.books) ?? 0)), row('Pages', group(num(t.pages) ?? 0))],
        }) : null).filter(Boolean) };
    }
    default:
      return view;
  }
  void now;
}

/**
 * The hub's second line for a section: its latest notable thing, or the one number
 * after the headline that says the most. `{label, value, href}` or null.
 * @param {string} name @param {any} v the section view (buildSection)
 */
export function hubNote(name, v) {
  if (!v || v.empty) return null;
  // body keeps its rows in blocks; the sleep average is named as the hub note reads it
  const rows = name === 'body'
    ? [...(v.sleep?.stats || []).map((/** @type {any} */ r) => (r.label === 'Last 30 nights' ? { ...r, label: 'Sleep, last 30 nights' } : r)), ...(v.measures?.stats || [])]
    : (Array.isArray(v.stats) ? v.stats : []);
  const stat = (/** @type {string} */ label) => {
    const r = rows.find((/** @type {any} */ x) => x && x.label === label);
    return r ? { label: r.label, value: r.unit ? `${r.value}${r.unit === '%' ? '' : ' '}${r.unit}` : String(r.value), href: '' } : null;
  };
  const latest = (/** @type {any} */ n) => (n && n.title ? { label: 'Latest', value: n.by ? `${n.title}, ${n.by}` : n.title, href: '' } : null);
  switch (name) {
    case 'body': return stat('Sleep, last 30 nights') || stat('Body fat') || stat('Resting heart rate');
    case 'games': return v.recent?.[0] ? { label: 'Recently', value: v.recent[0].name, href: '' } : null;
    case 'code': {
      const p = [...(v.projects || [])].sort((a, b) => b.started.localeCompare(a.started))[0];
      return p ? { label: 'Newest project', value: p.name, href: p.url || '' } : null;
    }
    case 'reading': {
      const c = v.current?.[0];
      return latest(v.latest) || (c ? { label: 'Reading now', value: c.by ? `${c.title}, ${c.by}` : c.title, href: '' } : null);
    }
    case 'watching':
    case 'listening':
      return latest(v.latest);
    default:
      return null;
  }
}

/** @param {any} lifeIndex */
function outingNotables(lifeIndex) {
  const o = lifeIndex?.sections?.outings;
  return Array.isArray(o?.notable) ? o.notable.filter((n) => n && n.title) : [];
}

/**
 * The hub: one card per section in order, then the outings list.
 * @param {any} lifeIndex @param {any} fitnessLife @param {Date} now
 */
export function buildHub(lifeIndex, fitnessLife, now = new Date()) {
  const sections = lifeIndex?.sections && typeof lifeIndex.sections === 'object' ? lifeIndex.sections : {};
  const outs = outingNotables(lifeIndex);
  const cards = SECTION_ORDER.map((name) => {
    if (name === 'fitness') {
      const first = fitnessLife?.stats?.strip?.[0];
      const empty = !first;
      const act = fitnessLife?.activities?.[0];
      return {
        name, href: SECTION_HREF(name), title: TITLES.fitness, empty, staleLabel: '', latest: null,
        headline: empty ? null : { value: String(first.value), unit: String(first.unit || ''), label: String(first.label || '') },
        note: act && act.title ? { label: 'Latest session', value: String(act.title), href: String(act.href || '') } : null,
      };
    }
    const v = /** @type {any} */ (buildSection(name, sections[name], now, outs));
    return { name, href: v.href, title: v.title, headline: v.empty ? null : v.headline, latest: v.empty ? null : v.latest, staleLabel: v.staleLabel, empty: v.empty, note: hubNote(name, v) };
  });
  return {
    cards,
    outings: sortedNotables(outs).map((n) => ({ ...n, sawLabel: sawLabel(n.month) })),
  };
}

/** Same game names, ignoring case. @param {{name: string}[]} a @param {{name: string}[]} b */
const sameList = (a, b) => a.length > 0 && a.length === b.length && a.every((x, i) => x.name.toLowerCase() === b[i].name.toLowerCase());

const BIT_LABELS = {
  'personal.height': 'Height', 'personal.likes': 'Likes', 'personal.boardgames': 'Board games', 'personal.desk': 'Desk',
  'body.weight_kg': 'Weight', 'games.serious': 'Serious games', 'games.silly': 'Silly games',
};

/** @param {any} f */
const isPublic = (f) => f && typeof f === 'object' && typeof f.key === 'string' && !['private', 'sensitive'].includes(f.visibility);

/** @param {any} v */
const listText = (v) => (Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : x?.name)).filter(Boolean).join(', ') : String(v ?? ''));

/**
 * The personal bits, from public facts only.
 * @param {any[]} facts the export's `facts`
 */
export function personalBits(facts) {
  const byKey = new Map((Array.isArray(facts) ? facts : []).filter(isPublic).map((f) => [f.key, f]));
  const out = [];
  for (const [key, label] of Object.entries(BIT_LABELS)) {
    const f = byKey.get(key);
    if (!f || f.value == null || f.value === '') continue;
    let value;
    if (key === 'body.weight_kg') {
      const n = Number(f.value);
      if (!Number.isFinite(n)) continue;
      value = `${one(n)} kg`;
    } else {
      value = listText(f.value) + (f.unit && !Array.isArray(f.value) ? ` ${f.unit}` : '');
    }
    if (!value) continue;
    if (key === 'games.silly' && out.some((b) => b.key === 'games.serious' && b.value.toLowerCase() === value.toLowerCase())) continue;
    out.push({ key, label, value, tone: String(f.tone || 'neutral') });
  }
  return out;
}

/** @param {any[]} facts */
export function lifeFacts(facts) {
  return Object.fromEntries((Array.isArray(facts) ? facts : []).filter(isPublic).map((f) => [f.key, f.value]));
}

/**
 * FitGlue's start year: the earliest `started` across every project whose name starts with
 * "fitglue" (fitglue-server, fitglue-web, ...), from the `code.projects` rows and the matching
 * `code.project.fitglue_*.started` facts. Empty when there are none.
 * @param {any} idx the life index
 */
export function fitglueStarted(idx) {
  const facts = (Array.isArray(idx?.facts) ? idx.facts : []).filter(isPublic)
    .filter((f) => /^code\.project\.fitglue([_-][^.]*)?\.started$/i.test(f.key)).map((f) => String(f.value || ''));
  const rows = (Array.isArray(idx?.sections?.code?.projects) ? idx.sections.code.projects : [])
    .filter((p) => /^fitglue/i.test(String(p?.name || ''))).map((p) => String(p?.started || ''));
  const dates = [...facts, ...rows].filter((d) => /^\d{4}-\d{2}-\d{2}/.test(d)).sort();
  return dates.length ? dates[0].slice(0, 4) : '';
}

/**
 * The C5 insights as `[{id, text, href}]`: at most 6, export order, rows without a 1-160
 * character string `text` dropped. Plain data: the partial does the markup.
 * @param {any} idx the life export
 */
export function lifeInsights(idx) {
  const rows = Array.isArray(idx?.insights) ? idx.insights : [];
  /** @type {{id: string, text: string, href: string}[]} */
  const out = [];
  for (const r of rows) {
    if (!r || typeof r.text !== 'string' || r.text.length < 1 || r.text.length > 160) continue;
    const href = r.section === 'body' ? '/life/body' : r.section === 'fitness' ? '/life/fitness' : '/life';
    out.push({ id: typeof r.id === 'string' ? r.id : String(out.length), text: r.text, href });
    if (out.length === 6) break;
  }
  return out;
}

/**
 * The homepage "life." card: blurb from the hub's section titles, footer from the newest outing.
 * @param {{cards: {title: string}[], outings: {title: string, sawLabel?: string}[]}} hub
 */
export function homeLifeGlobals(hub) {
  const names = (hub?.cards || []).map((c) => String(c.title).toLowerCase());
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names.join('');
  const o = hub?.outings?.[0];
  return {
    lifeBlurb: `James, by the numbers${list ? `: ${list}` : ''}, all gathered automatically.`,
    lifeLatest: o && o.title ? o.title : '',
    lifeLatestDate: o && o.title ? o.sawLabel || '' : '',
  };
}

export function lifeHubTask(config = {}) {
  return {
    name: 'life-hub',
    title: 'Build the /life hub, section and personal-bits view models',
    config,
    run: async (/** @type {any} */ cfg, /** @type {any} */ ctx) => {
      const g = ctx.globals || {};
      const now = cfg.now instanceof Date ? cfg.now : new Date();
      const idx = g.lifeIndex || null;
      const outs = outingNotables(idx);
      const lifeSections = Object.fromEntries(
        SECTION_ORDER.filter((n) => n !== 'fitness').map((n) => [n, buildSection(n, idx?.sections?.[n], now, outs)]),
      );
      const lifeHub = buildHub(idx, g.fitnessLife, now);
      ctx.logger.info(`Life hub: ${lifeHub.cards.filter((c) => !c.empty).length}/${lifeHub.cards.length} sections have data`);
      return { lifeHub, ...homeLifeGlobals(lifeHub), lifeSections, lifePersonal: personalBits(idx?.facts), lifeFacts: lifeFacts(idx?.facts),
        lifeInsights: lifeInsights(idx),
        // the homepage's "latest project" line and the "built <year>" badges
        fitglueStartedYear: fitglueStarted(idx),
        latestProjectDate: fitglueStarted(idx) ? `${fitglueStarted(idx)} → present` : '',
      };
    },
  };
}
