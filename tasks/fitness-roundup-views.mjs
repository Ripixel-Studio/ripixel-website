// @ts-check
/**
 * Roundup views (S2.4) — data only.
 *
 * Shapes each roundup file in `fitnessRoundups` (see tasks/fitness-fetch.mjs)
 * into `fitnessRoundupPages`, and all of them into `fitnessRoundupsIndex`.
 * Skier renders them (see skier.personal.tasks.mjs):
 *
 *   fitnessRoundupPages[i]  →  public/personal/life/roundup/<periodKey>.html   (generateDataPagesTask)
 *   fitnessRoundupsIndex    →  public/personal/life/roundups.html              (generatePagesTask,
 *                                                                               personal/pages/life/roundups.html)
 *
 * Firebase `cleanUrls` serves the extension-less URLs. Weekly, monthly and
 * yearly roundups share one template (`personal/templates/roundup.html`) with
 * period-aware labels; everything the template needs is precomputed here as a
 * plain view model so the Handlebars stays helper-free.
 *
 * Field semantics follow the S0 data contract in
 * jarvis-memory/specs/ripixel-website/fitness-zine.md §6 and §8.
 */
import path from 'node:path';

import { buildStory, storyContext } from './fitness-roundup-story.mjs';
import { buildYearReview } from './fitness-year-review.mjs';
import { TAGS, tagOf, tagTheme } from './fitness-theme.mjs';
import { recordLabel } from './fitness-records.mjs';

export const ROUNDUP_URL_BASE = '/life/roundup';
export const ROUNDUPS_INDEX_URL = '/life/roundups';
export const ACTIVITY_URL_BASE = '/life/activity';
/** Where the fitness Atom feed is written (a literal here: tasks/fitness-feed-items.mjs imports this module). */
export const FITNESS_FEED_PATH = '/life/feed.xml';

/** Period keys as `periodKey()` in roundup_generator.go mints them (contract §0). */
export const PERIOD_KEY = /^(?:week-(\d{2})-(\d{4})|month-(\d{2})-(\d{4})|year-(\d{4}))$/;

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3).toUpperCase());
const DOW_SHORT = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']; // Mon-first, as periods are

/** A strength record's metric as the records wall words it, by recordLabel's metricKey, in card order. */
const STRENGTH_METRICS = /** @type {Record<string, string>} */ ({ heaviest: 'HEAVIEST', '1rm': '1RM', set_volume: 'SET VOLUME', volume: 'VOLUME', reps: 'REPS' });
const PR_METRIC_ORDER = Object.values(STRENGTH_METRICS);

const ELEVATION_LANDMARKS = [
  { name: 'Everest', m: 8849 },
  { name: 'Mont Blanc', m: 4808 },
  { name: 'Ben Nevis', m: 1345 },
  { name: 'Snowdon', m: 1085 },
  { name: 'the Shard', m: 310 },
];

// ---------------------------------------------------------------------------
// Period keys, labels, paths

/**
 * @param {unknown} key
 * @returns {{ type: 'week'|'month'|'year', week?: number, month?: number, year: number } | null}
 */
export function parsePeriodKey(key) {
  if (typeof key !== 'string') return null;
  const m = PERIOD_KEY.exec(key);
  if (!m) return null;
  if (m[1]) return { type: 'week', week: Number(m[1]), year: Number(m[2]) };
  if (m[3]) {
    const month = Number(m[3]);
    if (month < 1 || month > 12) return null;
    return { type: 'month', month, year: Number(m[4]) };
  }
  return { type: 'year', year: Number(m[5]) };
}

/** The page URL for a key: `/life/roundup/<key>`. */
export function keyToUrl(key) {
  return `${ROUNDUP_URL_BASE}/${key}`;
}

/** The output file for a key, relative to the output directory: `life/roundup/<key>.html`. */
export function keyToPath(key) {
  if (!parsePeriodKey(key)) throw new Error(`not a period key: ${JSON.stringify(key)}`);
  return path.posix.join('life', 'roundup', `${key}.html`);
}

/** `ROUNDUP_PERIOD_TYPE_WEEK` → 'week'; falls back to the key's prefix. */
export function periodTypeOf(roundup, key) {
  const t = String(roundup?.periodType || '');
  if (t.endsWith('_WEEK')) return 'week';
  if (t.endsWith('_MONTH')) return 'month';
  if (t.endsWith('_YEAR')) return 'year';
  return parsePeriodKey(key)?.type ?? 'week';
}

/** @param {number} n */
const pad2 = (n) => String(n).padStart(2, '0');

/** Parse an RFC 3339 string to a UTC Date, or null. */
function utcDate(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : new Date(t);
}

/** `17 OCT` / `17 OCT 2026` from a Date (UTC). */
function fmtDay(d, withYear = false) {
  const s = `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]}`;
  return withYear ? `${s} ${d.getUTCFullYear()}` : s;
}

/**
 * Period-aware labels. `periodEnd` is exclusive (contract §0), so the range
 * shows `end − 1 day`.
 * @param {string} key
 * @param {{ periodStart?: string, periodEnd?: string, periodType?: string }} [roundup]
 */
export function periodLabels(key, roundup = {}) {
  const parsed = parsePeriodKey(key);
  const type = periodTypeOf(roundup, key);
  const start = utcDate(roundup.periodStart);
  const endEx = utcDate(roundup.periodEnd);
  const end = endEx ? new Date(endEx.getTime() - 86_400_000) : null;

  let title = key.toUpperCase();
  let short = key.toUpperCase();
  let kicker = 'ROUNDUP';
  let word = 'Period';
  let subpage = key;
  if (parsed?.type === 'week') {
    title = `WEEK ${parsed.week}`;
    short = `Week ${parsed.week} · ${parsed.year}`;
    kicker = 'WEEKLY ROUNDUP';
    word = 'Week';
    subpage = `week ${parsed.week} ${parsed.year}`;
  } else if (parsed?.type === 'month') {
    const name = MONTHS[(parsed.month ?? 1) - 1];
    title = name.toUpperCase();
    short = `${name} ${parsed.year}`;
    kicker = 'MONTHLY ROUNDUP';
    word = 'Month';
    subpage = `${name.toLowerCase()} ${parsed.year}`;
  } else if (parsed?.type === 'year') {
    title = String(parsed.year);
    short = String(parsed.year);
    kicker = 'YEAR IN REVIEW';
    word = 'Year';
    subpage = String(parsed.year);
  }

  let dateRange = '';
  if (start && end && end >= start) dateRange = `${fmtDay(start)} — ${fmtDay(end, true)}`;
  else if (start) dateRange = fmtDay(start, true);

  return { type, title, short, kicker, word, dateRange, subpage, year: parsed?.year ?? start?.getUTCFullYear() ?? null };
}

// ---------------------------------------------------------------------------
// Previous / next resolution

/**
 * For every roundup, which page is "previous" and "next" and whether the
 * exact `previousKey` exists (that one drives the comparison ticker, §6).
 *
 * Navigation falls back to the nearest older/newer roundup of the same
 * period type when `previousKey` points at a roundup that was never
 * generated, so a gap week does not dead-end the chain.
 *
 * @param {Array<{ key: string, previousKey?: string, roundup?: any }>} files
 * @returns {Map<string, { prev: string|null, next: string|null, comparison: string|null }>}
 */
export function resolveNeighbours(files) {
  const byKey = new Map();
  for (const f of files) if (f && parsePeriodKey(f.key)) byKey.set(f.key, f);

  /** @type {Record<string, any[]>} */
  const byType = { week: [], month: [], year: [] };
  for (const f of byKey.values()) byType[periodTypeOf(f.roundup, f.key)].push(f);
  const startOf = (f) => Date.parse(f.roundup?.periodStart || '') || 0;
  for (const list of Object.values(byType)) list.sort((a, b) => startOf(b) - startOf(a)); // newest first

  const out = new Map();
  for (const list of Object.values(byType)) {
    list.forEach((f, i) => {
      const older = list[i + 1]?.key ?? null;
      const newer = list[i - 1]?.key ?? null;
      const exact = f.previousKey && byKey.has(f.previousKey) ? f.previousKey : null;
      // The roundup that names this one as its previous is the canonical "next".
      const claimsUs = list.find((g) => g.previousKey === f.key)?.key ?? null;
      out.set(f.key, {
        prev: exact ?? older,
        next: claimsUs ?? newer,
        comparison: exact,
      });
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Formatting

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** @param {number} m */
export function fmtKm(m) {
  const km = m / 1000;
  const digits = km < 100 ? 1 : 0;
  return km.toLocaleString('en-GB', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** @param {number} sec → `2h 29m` / `45m` */
export function fmtDuration(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** @param {number} sec → `m:ss` / `h:mm:ss` */
export function fmtClock(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
}

/** @param {number} kg → `{ value: '6.3', unit: 't' }` / `{ value: '640', unit: 'kg' }` */
export function fmtWeight(kg) {
  if (kg >= 1000) return { value: (kg / 1000).toFixed(1), unit: 't' };
  return { value: String(Math.round(kg)), unit: 'kg' };
}

/** `SOURCE_PARKRUN_RESULTS` → `Parkrun Results` */
export function enumLabel(value, prefix) {
  const s = String(value || '').replace(prefix, '').toLowerCase().replace(/_/g, ' ');
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** `upper_back` → `Upper Back` */

function elevationComparison(m) {
  if (m < 150) return '';
  for (const l of ELEVATION_LANDMARKS) {
    if (m >= l.m) {
      const x = m / l.m;
      return `${x.toFixed(x >= 10 ? 0 : 1)}× ${l.name}`;
    }
  }
  return '';
}

// ---------------------------------------------------------------------------
// Effort strip geometry (inline SVG, drawn by partials/roundup-effort-strip.html)

/**
 * Fill every day of [start, end) with its effort level (0 when absent).
 * @returns {Array<{ iso: string, date: Date, level: number, count: number }>}
 */
export function calendarDays(periodStart, periodEnd, dayEntries = []) {
  const byDate = new Map();
  for (const e of dayEntries || []) {
    if (e && typeof e.date === 'string') {
      byDate.set(e.date, { level: Math.max(0, Math.min(4, Math.round(num(e.effortLevel)))), count: num(e.activityCount) });
    }
  }
  const s = utcDate(periodStart);
  const e = utcDate(periodEnd);
  if (!s || !e) return [];
  const cur = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate()));
  const endUTC = new Date(Date.UTC(e.getUTCFullYear(), e.getUTCMonth(), e.getUTCDate()));
  const days = [];
  while (cur < endUTC && days.length < 800) {
    const iso = `${cur.getUTCFullYear()}-${pad2(cur.getUTCMonth() + 1)}-${pad2(cur.getUTCDate())}`;
    const hit = byDate.get(iso);
    days.push({ iso, date: new Date(cur), level: hit?.level ?? 0, count: hit?.count ?? 0 });
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return days;
}

const LEVEL_WORDS = ['rest', 'easy', 'moderate', 'hard', 'very hard'];

/**
 * The year's days as a Mon-first weekday grid with month labels (the week and the month
 * draw their own days: tasks/fitness-roundup-story.mjs). Coordinates are precomputed so
 * the partial only places <rect>s and <text>s.
 * @param {Array<{ date: Date, level: number, count: number }>} days
 */
export function buildEffortStrip(days) {
  if (!days.length) return null;
  const dowMon = (/** @type {Date} */ d) => (d.getUTCDay() + 6) % 7;
  const cellTitle = (/** @type {any} */ d) => `${fmtDay(d.date, true)}: ${LEVEL_WORDS[d.level]}${d.count ? ` · ${d.count} session${d.count === 1 ? '' : 's'}` : ''}`;
  const cell = 11;
  const gap = 2;
  const top = 14;
  const cells = [];
  const labels = [];
  let col = 0;
  let lastMonth = -1;
  days.forEach((d, i) => {
    const dow = dowMon(d.date);
    if (i > 0 && dow === 0) col++;
    if (d.date.getUTCMonth() !== lastMonth && dow === 0) {
      lastMonth = d.date.getUTCMonth();
      labels.push({ x: col * (cell + gap), y: 10, text: MONTHS_SHORT[lastMonth] });
    }
    cells.push({
      x: col * (cell + gap), y: top + dow * (cell + gap), w: cell, h: cell,
      level: d.level, title: cellTitle(d),
    });
  });
  const width = (col + 1) * (cell + gap) - gap;
  const height = top + 7 * (cell + gap) - gap;
  // The grid's rows are weekdays (its shade is the effort, keyed by the legend below it).
  const yAxis = {
    caption: 'day',
    ticks: [0, 2, 4, 6].map((r) => ({ label: DOW_SHORT[r].slice(0, 1) + DOW_SHORT[r].slice(1).toLowerCase(), pct: Math.round(((top + r * (cell + gap) + cell / 2) / height) * 10000) / 100 })),
  };
  return { kind: 'grid', width, height, vx: 0, vw: width, cells, labels, yAxis };
}

// ---------------------------------------------------------------------------
// Personal records

/**
 * `Bench Press (Barbell)_1rm` → { label: 'Bench Press (Barbell)', metric: '1RM', isStrength: true }.
 * Strength keys go through recordLabel (tasks/fitness-records.mjs, the site's one reading of
 * FitGlue's key grammar), so every metric of an exercise, `_heaviest_weight` included, lands
 * on that exercise's card.
 * @param {unknown} recordType
 */
export function parseRecordType(recordType) {
  const rt = String(recordType || '');
  const l = recordLabel(rt);
  if (l.group === 'strength') return { label: l.name, metric: STRENGTH_METRICS[l.metricKey] || l.metric, isStrength: true };
  return { label: rt.replace(/_/g, ' ').toUpperCase(), metric: '', isStrength: false };
}

function prValue(value, unit) {
  const v = num(value);
  if (unit === 'seconds') return { value: fmtClock(v), unit: '' };
  if (unit === 'kg') return { value: String(Math.round(v * 10) / 10), unit: 'kg' };
  if (unit === 'meters') return { value: v >= 1000 ? fmtKm(v) : String(Math.round(v)), unit: v >= 1000 ? 'km' : 'm' };
  return { value: String(Math.round(v)), unit: unit || '' };
}

function prDelta(value, previousValue, unit) {
  if (typeof previousValue !== 'number') return 'NEW';
  const v = num(value);
  if (unit === 'seconds') {
    const diff = Math.round(previousValue - v);
    return diff > 0 ? `−${diff}s` : 'NEW';
  }
  const diff = Math.round((v - previousValue) * 10) / 10;
  if (diff <= 0) return 'NEW';
  return `+${diff}${unit === 'kg' ? ' kg' : unit === 'meters' ? ' m' : ''}`;
}

/** Group per exercise (contract §2 `topPrs`), metrics in 1RM → SET VOLUME → VOLUME → REPS order. */
export function buildRecordGroups(prs = []) {
  const groups = new Map();
  for (const pr of prs || []) {
    if (!pr) continue;
    const parsed = parseRecordType(pr.recordType);
    const { value, unit } = prValue(pr.value, pr.unit);
    const ts = Date.parse(pr.achievedAt || '') || 0;
    let g = groups.get(parsed.label);
    if (!g) {
      g = {
        label: parsed.label,
        glyph: pr.unit === 'kg' || parsed.isStrength ? 'GYM' : pr.unit === 'seconds' ? 'RUN' : '★',
        date: '', _ts: -1, count: 0, metrics: [],
      };
      groups.set(parsed.label, g);
    }
    g.metrics.push({ metric: parsed.metric, value, unit, delta: prDelta(pr.value, pr.previousValue, pr.unit) });
    g.count++;
    if (ts > g._ts) {
      g._ts = ts;
      const d = utcDate(pr.achievedAt);
      g.date = d ? fmtDay(d) : '';
    }
  }
  return [...groups.values()].map((g) => {
    g.metrics.sort((a, b) => {
      const ai = PR_METRIC_ORDER.indexOf(a.metric), bi = PR_METRIC_ORDER.indexOf(b.metric);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
    const { _ts, ...rest } = g;
    return rest;
  });
}

// ---------------------------------------------------------------------------
// Comparison vs the previous period (contract §6 `buildDeltas`)

function pctDelta(cur, prev) {
  if (!(prev > 0)) return null;
  const pct = Math.round(((cur - prev) / prev) * 100);
  return { value: `${pct > 0 ? '+' : pct < 0 ? '−' : '±'}${Math.abs(pct)}%`, dir: pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat' };
}

export function buildDeltas(cur, prev) {
  const out = [];
  const push = (label, d) => d && out.push({ label, ...d });
  push('Sessions', pctDelta(num(cur.totalActivities), num(prev.totalActivities)));
  push('Time', pctDelta(num(cur.totalDurationSeconds), num(prev.totalDurationSeconds)));
  if (num(cur.totalDistanceMeters) > 500 && num(prev.totalDistanceMeters) > 500) {
    push('Distance', pctDelta(num(cur.totalDistanceMeters), num(prev.totalDistanceMeters)));
  }
  if (num(cur.totalCaloriesKcal) > 0 && num(prev.totalCaloriesKcal) > 0) {
    push('Calories', pctDelta(num(cur.totalCaloriesKcal), num(prev.totalCaloriesKcal)));
  }
  const c = (cur.prsAchieved || []).length, p = (prev.prsAchieved || []).length;
  if (c !== p) out.push({ label: 'Records', value: `${c > p ? '+' : '−'}${Math.abs(c - p)}`, dir: c > p ? 'up' : 'down' });
  return out;
}

// ---------------------------------------------------------------------------
// Life blocks (LH4.3): watching, listening, reading and outings from the period sidecar

const LIFE_BLOCKS = ['watching', 'listening', 'reading', 'outings'];

/** Kind codes the box sends (queue.SECTIONS) -> plain words. Anything else renders nothing. */
const LIFE_KIND_LABELS = /** @type {Record<string, string>} */ ({
  film: 'film', season: 'TV', episode: 'TV', series: 'TV', creator: 'channel', video: 'video',
  artist: 'artist', track: 'track', podcast: 'podcast', book: 'book', audiobook: 'audiobook',
  gig: 'gig', cinema: 'cinema',
});

/** Reason codes the box sends (assess.hard_reason, "sustained") -> plain words; '' means the kind already says it. */
const LIFE_REASON_LABELS = /** @type {Record<string, string>} */ ({
  film: 'watched', season: 'finished the season', book: 'finished', sustained: 'kept coming back',
  gig: '', cinema: '', outing: '',
});

/**
 * The heading for one life block.
 * @param {string} name watching | listening | reading | outings
 * @param {'week'|'month'|'year'} type
 * @param {{ short: string }} labels from periodLabels(); `short` is the month name or the year for those types
 */
export function lifeHeading(name, type, labels) {
  const when = type === 'month' ? labels.short.replace(/\s+\d{4}$/, '') : labels.short;
  if (type === 'week') {
    return { watching: "This week's watching", listening: "This week's listening", reading: "This week's reading", outings: 'Out and about' }[name] || '';
  }
  const pair = type === 'month' ? 'music and podcasts' : 'podcasts and music';
  return { watching: `${when} in films and TV`, listening: `${when} in ${pair}`, reading: `${when} in books`, outings: `${when}, out` }[name] || '';
}

/** @param {number} n @param {string} one @param {string} [many] */
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * "3 films · 14 episodes · 22 h": counts only, zero parts omitted, '' when there are none.
 * @param {string} name @param {Record<string, any>} [totals]
 */
export function totalsLine(name, totals = {}) {
  const t = totals || {};
  /** @type {Array<[number, string]>} */
  let parts = [];
  if (name === 'watching') {
    parts = [[num(t.films), 'film'], [num(t.episodes), 'episode'], [num(t.videos), 'video'], [num(t.hours), 'h']];
  } else if (name === 'listening') {
    parts = [[num(t.tracks), 'track'], [num(t.podcastEpisodes), 'podcast episode'], [num(t.audiobookHours), 'audiobook h']];
  } else if (name === 'reading') {
    parts = [[num(t.books), 'book'], [num(t.pages), 'page']];
  }
  return parts.filter(([n]) => n > 0)
    .map(([n, w]) => (w === 'h' ? `${n} h` : w === 'audiobook h' ? `${n} h audiobooks` : plural(n, w)))
    .join(' · ');
}

/** "2026-09" → "September 2026"; month precision is all an outing ever shows. */
function monthYear(ym) {
  const m = /^(\d{4})-(\d{2})/.exec(String(ym || ''));
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return '';
  return `${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

/** @param {string} name @param {any} n */
function lifeItem(name, n) {
  const title = String(n?.title || '').trim();
  if (!title) return null;
  const kind = String(n.kind || '').toLowerCase();
  const kindLabel = LIFE_KIND_LABELS[kind] || '';
  if (name === 'outings') {
    // Month precision only, never a venue or a day.
    return { title: `saw ${title}`, by: '', kindLabel, meta: monthYear(n.month) };
  }
  let reason = LIFE_REASON_LABELS[String(n.reason || '').trim().toLowerCase()] || '';
  if (reason.toLowerCase() === kindLabel.toLowerCase()) reason = '';
  const bits = [];
  if (n.season != null && n.season !== '') bits.push(`season ${n.season}`);
  if (typeof n.year === 'number' && n.year > 0) bits.push(String(n.year));
  if (reason) bits.push(reason);
  return { title, by: n.by ? String(n.by) : '', kindLabel, meta: bits.join(' · ') };
}

/**
 * @param {any} period the validated life/period sidecar (or nothing)
 * @param {{ type: 'week'|'month'|'year', short: string }} labels
 * @returns {{ blocks: Array<{ name: string, heading: string, items: any[], totalsLine: string }>, count: number } | null}
 */
export function buildRoundupLife(period, labels) {
  if (!period || typeof period !== 'object') return null;
  const blocks = [];
  for (const name of LIFE_BLOCKS) {
    const section = name === 'outings' ? (period.live ?? period.outings) : period[name]; // the box renamed the sidecar's outings key to live
    if (!section || typeof section !== 'object') continue;
    const items = (Array.isArray(section.notable) ? section.notable : []).map((n) => lifeItem(name, n)).filter(Boolean);
    const line = totalsLine(name, section.totals);
    if (!items.length && !line) continue;
    blocks.push({ name, heading: lifeHeading(name, labels.type, labels), items, totalsLine: line });
  }
  return blocks.length ? { blocks, count: blocks.length } : null;
}

/**
 * A period's sessions per site tag, most first: from the activities in the period when the
 * build has them (each already tagged), else from the export's per-type breakdown with each
 * type run through the same tag fallback.
 * @param {any} r  the roundup
 * @param {any[]} [entries]  index entries (fitnessIndex.activities)
 * @returns {{ tag: import('./fitness-theme.mjs').Tag, count: number, dist: number, secs: number, sets: number, kg: number }[]}
 */
export function tagBreakdown(r, entries = []) {
  const start = Date.parse(r?.periodStart || '');
  const end = Date.parse(r?.periodEnd || '');
  /** @type {Map<string, { tag: any, count: number, dist: number, secs: number, sets: number, kg: number }>} */
  const rows = new Map();
  const add = (/** @type {any} */ tag, /** @type {number} */ count, /** @type {any} */ x) => {
    const row = rows.get(tag) || { tag, count: 0, dist: 0, secs: 0, sets: 0, kg: 0 };
    row.count += count;
    row.dist += num(x.distanceMeters ?? x.totalDistanceMeters);
    row.secs += num(x.durationSeconds ?? x.totalDurationSeconds);
    row.sets += num(x.totalSets);
    row.kg += num(x.totalWeightKg);
    rows.set(tag, row);
  };
  const inPeriod = Number.isFinite(start) && Number.isFinite(end)
    ? (Array.isArray(entries) ? entries : []).filter((e) => { const t = Date.parse(e?.startTime || ''); return t >= start && t < end; })
    : [];
  if (inPeriod.length) for (const e of inPeriod) add(tagOf(e).tag, 1, e);
  else for (const b of r?.activityTypeBreakdowns || []) if (b) add(tagOf({ activityType: b.activityType, distanceMeters: num(b.totalDistanceMeters) }).tag, num(b.activityCount), b);
  const order = Object.keys(TAGS);
  return [...rows.values()].filter((x) => x.count > 0).sort((a, b) => b.count - a.count || order.indexOf(a.tag) - order.indexOf(b.tag));
}

// ---------------------------------------------------------------------------
// View models

/**
 * Everything `personal/templates/roundup.html` renders, as plain data.
 * @param {{ key: string, previousKey?: string, roundup: any }} file
 * @param {{ byKey: Map<string, any>, neighbours: Map<string, any>, activitySlugs: Set<string>, showPhotoGallery: boolean, lifePeriods?: Record<string, any>, entries?: any[], story?: ReturnType<typeof storyContext>, upcoming?: any[] }} ctx
 *   `story`: the shared highlights context (tasks/fitness-roundup-story.mjs); without it the page has no story blocks
 */
export function buildRoundupView(file, ctx) {
  const r = file.roundup || {};
  const key = file.key;
  const labels = periodLabels(key, r);
  const type = labels.type;
  const href = (id) => (typeof id === 'string' && id && ctx.activitySlugs.has(id) ? `${ACTIVITY_URL_BASE}/${id}` : null);

  // --- totals strip (adaptive 4-up, §6 totalDurationSeconds row)
  const totalWeightKg = (r.activityTypeBreakdowns || []).reduce((s, b) => s + num(b?.totalWeightKg), 0);
  const hasStrength = (r.activityTypeBreakdowns || []).some((b) => num(b?.totalSets) > 0);
  const distance = num(r.totalDistanceMeters);
  const elevation = num(r.totalElevationGainMeters);
  const calories = num(r.totalCaloriesKcal);
  const totals = [
    { value: String(num(r.totalActivities)), unit: '', label: 'sessions logged' },
    { value: fmtDuration(num(r.totalDurationSeconds)), unit: '', label: 'total time' },
  ];
  const elevationCell = { value: `+${Math.round(elevation).toLocaleString('en-GB')}`, unit: 'm', label: 'elevation' };
  if (distance > 500) totals.push({ value: fmtKm(distance), unit: 'km', label: 'distance covered' });
  else if (hasStrength && totalWeightKg > 0) totals.push({ ...fmtWeight(totalWeightKg), label: 'weight moved' });
  else if (elevation > 50) totals.push(elevationCell);
  if (calories > 0) {
    totals.push(calories >= 1000
      ? { value: (calories / 1000).toFixed(1), unit: 'k', label: 'calories burned' }
      : { value: calories.toLocaleString('en-GB'), unit: '', label: 'calories burned' });
  } else if (elevation > 50 && totals.length < 4) totals.push(elevationCell);
  while (totals.length < 4) totals.push({ value: '—', unit: '', label: '—' });

  // --- comparison
  const nb = ctx.neighbours.get(key) || { prev: null, next: null, comparison: null };
  const prevFile = nb.comparison ? ctx.byKey.get(nb.comparison) : null;
  const comparison = prevFile
    ? { label: periodLabels(nb.comparison, prevFile.roundup).short, href: keyToUrl(nb.comparison), deltas: buildDeltas(r, prevFile.roundup || {}) }
    : null;

  // --- sport breakdown, by the site's tags (fitness-theme.mjs)
  const tagRows = tagBreakdown(r, ctx.entries);
  const sessionTotal = tagRows.reduce((s, b) => s + b.count, 0);
  const distanceTotal = tagRows.reduce((s, b) => s + b.dist, 0);
  const breakdown = tagRows.map((b, i) => {
    const { count, dist, kg: w } = b;
    const stats = [];
    if (dist > 500) stats.push(`${fmtKm(dist)} km`);
    if (b.secs > 0) stats.push(fmtDuration(b.secs));
    if (b.sets > 0) stats.push(`${b.sets} sets`);
    if (w > 0) { const fw = fmtWeight(w); stats.push(`${fw.value}${fw.unit} moved`); }
    const theme = tagTheme(b.tag);
    return {
      ...theme,
      ink: i % 6, glyph: theme.tagGlyph, label: theme.tagLabel,
      count, pct: sessionTotal ? Math.round((count / sessionTotal) * 100) : 0,
      share: sessionTotal ? (count / sessionTotal) * 100 : 0,
      distShare: distanceTotal ? (dist / distanceTotal) * 100 : 0,
      stats: stats.join(' · '),
    };
  });
  const distanceStack = breakdown.filter((b) => b.distShare > 0);

  // --- places + weather
  const places = (r.places || []).filter((p) => p && p.name).map((p) => ({ name: p.name, country: p.country || '', count: num(p.activityCount) }));
  const countries = new Set(places.map((p) => p.country).filter(Boolean)).size;
  const placesNote = places.length ? `${places.length} place${places.length === 1 ? '' : 's'}${countries ? ` · ${countries} countr${countries === 1 ? 'y' : 'ies'}` : ''}` : '';
  const w = r.weather && num(r.weather.sessionCount) > 0 ? r.weather : null;
  const weather = w ? {
    cells: [
      ...(num(w.rainCount) > 0 ? [{ value: String(num(w.rainCount)), label: 'in the wet' }] : []),
      { value: `${Math.round(num(w.coldestTempC))}°`, label: 'coldest' },
      { value: `${Math.round(num(w.hottestTempC))}°`, label: 'hottest' },
      { value: String(num(w.sessionCount)), label: 'sessions tracked' },
    ],
  } : null;

  // --- the year's day grid (a week and a month draw their own days: tasks/fitness-roundup-story.mjs)
  const days = calendarDays(r.periodStart, r.periodEnd, r.dayEntries);
  const effortStrip = type === 'year' ? buildEffortStrip(days) : null;
  const activeDays = days.filter((d) => d.level > 0).length;

  // --- best efforts, highlights, records
  const bestEfforts = (r.bestEfforts || []).filter((b) => b && num(b.timeSeconds) > 0).map((b) => ({ display: b.display || b.distanceKey || '', time: fmtClock(num(b.timeSeconds)) }));

  const highlights = [];
  const longest = num(r.longestActivityDurationSeconds);
  if (longest > 60) highlights.push({ value: fmtDuration(longest), unit: '', label: 'longest session', sub: '', href: href(r.longestSessionShowcaseId) });
  const cph = num(r.highestCaloriesPerHourKcal);
  if (cph > 0) highlights.push({ value: String(Math.round(cph)), unit: 'kcal/h', label: 'highest burn rate', sub: '', href: href(r.highestBurnRateShowcaseId) });
  const bpm = num(r.highestAvgBpm);
  if (bpm > 0) highlights.push({ value: String(bpm), unit: 'bpm', label: 'peak avg HR', sub: r.highestAvgBpmActivityTitle || '', href: href(r.highestAvgBpmShowcaseId) });
  if (elevation > 50) highlights.push({ value: `+${Math.round(elevation).toLocaleString('en-GB')}`, unit: 'm climbed', label: 'total vertical', sub: elevationComparison(elevation), href: null });
  const furthest = num(r.furthestActivityMeters);
  if (furthest > 500) highlights.push({ value: fmtKm(furthest), unit: 'km', label: 'furthest session', sub: 'longest single distance', href: href(r.furthestShowcaseId) });
  const mostCal = num(r.mostCaloriesSingleKcal);
  if (mostCal > 0) highlights.push({ value: mostCal.toLocaleString('en-GB'), unit: 'kcal', label: 'biggest burn', sub: 'most in one session', href: href(r.mostCaloriesShowcaseId) });
  const biggestVol = num(r.biggestSessionVolumeKg);
  if (biggestVol > 0) highlights.push({ ...fmtWeight(biggestVol), label: 'heaviest session', sub: 'most volume in one session', href: href(r.biggestVolumeShowcaseId) });

  const records = buildRecordGroups(r.prsAchieved);
  const prCount = (r.prsAchieved || []).length;

  const sources = (r.sources || []).map((s) => enumLabel(s, 'SOURCE_')).filter(Boolean);
  const aiSummary = typeof r.aiSummary === 'string' ? r.aiSummary.trim() : '';

  const prevNav = nb.prev ? { href: keyToUrl(nb.prev), label: periodLabels(nb.prev, ctx.byKey.get(nb.prev)?.roundup).short } : null;
  const nextNav = nb.next ? { href: keyToUrl(nb.next), label: periodLabels(nb.next, ctx.byKey.get(nb.next)?.roundup).short } : null;

  const descBits = [`${num(r.totalActivities)} session${num(r.totalActivities) === 1 ? '' : 's'}`, fmtDuration(num(r.totalDurationSeconds))];
  if (distance > 500) descBits.push(`${fmtKm(distance)} km`);
  if (prCount) descBits.push(`${prCount} PR${prCount === 1 ? '' : 's'}`);
  const description = aiSummary ? aiSummary.slice(0, 157).replace(/\s+\S*$/, '') + (aiSummary.length > 157 ? '…' : '') : `${labels.short}: ${descBits.join(', ')}.`;

  return {
    key, url: keyToUrl(key), ...labels, byline: `your ${labels.word.toLowerCase()} in sport`,
    isWeek: type === 'week', isMonth: type === 'month', isYear: type === 'year',
    generatedAt: r.generatedAt || '',
    totals, comparison, breakdown, distanceStack, hasDistanceStack: distanceStack.length > 1,
    places, placesNote, weather,
    effortStrip, activeDays, dayCount: days.length,
    bestEfforts, highlights, records, prCount, sources: sources.join(' · '),
    life: buildRoundupLife(ctx.lifePeriods?.[key], labels),
    aiSummary, prevNav, nextNav, hasNav: Boolean(prevNav || nextNav), description,
    indexUrl: ROUNDUPS_INDEX_URL,
    periodStart: r.periodStart || '', sessionCount: num(r.totalActivities),
    story: ctx.story ? buildStory(file, type, ctx.story) : null,
    review: ctx.story && type === 'year' ? buildYearReview(file, ctx.story, { upcoming: ctx.upcoming || [] }) : null,
  };
}

const MONTH_NAMES = MONTHS;

/**
 * `/life/roundups` as one stream, newest first, like the watching wall: each year opens
 * with its year roundup (or a plain year card while the year is still running), each
 * month with its month roundup (or a plain month label), then that month's weeks. A week
 * belongs to the month its Thursday falls in (ISO). Every tile carries a teaser: the
 * headline numbers, the top highlight, a photo or a mini chart.
 * @param {any[]} views  buildRoundupView results
 */
export function buildTimeline(views) {
  /** @type {Map<number, { year: any, months: Map<number, { month: any, weeks: any[] }> }>} */
  const years = new Map();
  const yearOf = (/** @type {number} */ y) => {
    if (!years.has(y)) years.set(y, { year: null, months: new Map() });
    return /** @type {any} */ (years.get(y));
  };
  const monthOf = (/** @type {number} */ y, /** @type {number} */ m) => {
    const Y = yearOf(y);
    if (!Y.months.has(m)) Y.months.set(m, { month: null, weeks: [] });
    return Y.months.get(m);
  };
  for (const v of views) {
    const start = Date.parse(v.periodStart || '');
    if (!Number.isFinite(start)) continue;
    if (v.type === 'year') yearOf(new Date(start).getUTCFullYear()).year = v;
    else if (v.type === 'month') monthOf(new Date(start).getUTCFullYear(), new Date(start).getUTCMonth()).month = v;
    else {
      const thu = new Date(start + 3 * 864e5);
      monthOf(thu.getUTCFullYear(), thu.getUTCMonth()).weeks.push(v);
    }
  }
  const out = [];
  for (const y of [...years.keys()].sort((a, b) => b - a)) {
    const Y = /** @type {any} */ (years.get(y));
    let count = 0;
    for (const M of Y.months.values()) count += (M.month ? M.month.sessionCount : M.weeks.reduce((s, w) => s + w.sessionCount, 0));
    out.push(Y.year ? { ...tile(Y.year), isYear: true } : { isYearMark: true, mark: String(y), year: String(y), sub: 'so far' });
    for (const m of [...Y.months.keys()].sort((a, b) => b - a)) {
      const M = Y.months.get(m);
      if (M.month) out.push({ ...tile(M.month), isMonth: true });
      else out.push({ isMonthMark: true, mark: `${MONTH_NAMES[m]} ${y}`, label: MONTH_NAMES[m].toUpperCase(), year: String(y) });
      for (const w of M.weeks.sort((a, b) => Date.parse(b.periodStart) - Date.parse(a.periodStart))) out.push({ ...tile(w), isWeek: true });
    }
  }
  return out;
}

/** One tile's teaser. @param {any} v a buildRoundupView result */
function tile(v) {
  const st = v.story || {};
  const second = (v.totals || []).slice(2).find((t) => t.label && t.label !== '—');
  const lead = st.lead || null;
  const days = Array.isArray(st.days) ? st.days : [];
  const most = Math.max(1, ...days.map((d) => d.sessions.length));
  const months = Array.isArray(st.months) ? st.months : [];
  return {
    key: v.key, href: v.url, title: v.title, short: v.short, kicker: v.kicker, range: v.dateRange,
    sessions: String(v.sessionCount), sessionsLabel: v.sessionCount === 1 ? 'session' : 'sessions',
    secondary: second ? `${second.value}${second.unit ? ` ${second.unit}` : ''}` : '',
    secondaryLabel: second ? second.label.replace(/ covered$| moved$| burned$/, (m) => m) : '',
    prs: v.prCount ? `${v.prCount} PB${v.prCount === 1 ? '' : 's'}` : '',
    top: lead ? { stamp: lead.stamp, title: lead.title, typeClass: lead.typeClass } : null,
    lines: (st.coverLines || []).slice(1, 3),
    cover: st.cover?.url || '',
    collage: (st.collage || []).slice(0, 4).map((p) => p.url),
    routes: (st.routes || []).slice(0, v.type === 'year' ? 8 : 6),
    days: days.map((d) => ({ label: String(d.label || '').slice(0, 1), h: Math.round((d.sessions.length / most) * 100), typeClass: d.sessions[0]?.typeClass || '' })),
    months: months.map((m) => ({ label: String(m.label || '').slice(0, 1), h: m.height })),
  };
}

// ---------------------------------------------------------------------------
// The Skier task

/** @param {unknown} e */
const errMsg = (e) => (e instanceof Error ? e.message : String(e));

/**
 * Builds the roundup page and index view models (after fetch-fitness and
 * fitness-og-images). A roundup whose view throws is logged and left out of
 * both the pages and the index.
 */
export function fitnessRoundupViewsTask() {
  return {
    name: 'fitness-roundup-views',
    title: 'Build the /life/roundup/<key> and /life/roundups view models from fitnessRoundups',
    config: {},
    run: async (/** @type {any} */ _cfg, /** @type {any} */ ctx) => {
      const g = ctx.globals;
      const index = g.fitnessIndex || {};
      const files = (Array.isArray(g.fitnessRoundups) ? g.fitnessRoundups : []).filter((f) => {
        if (f && parsePeriodKey(f.key)) return true;
        ctx.logger.warn(`roundup with unusable key ${JSON.stringify(f?.key)} skipped`);
        return false;
      });
      const byKey = new Map(files.map((f) => [f.key, f]));
      const activitySlugs = new Set((index.activities || []).map((a) => a?.slug).filter((s) => typeof s === 'string'));
      const viewCtx = {
        byKey,
        neighbours: resolveNeighbours(files),
        activitySlugs,
        showPhotoGallery: Boolean(index.profile?.showPhotoGallery),
        lifePeriods: g.lifePeriods || {},
        upcoming: Array.isArray(g.fitnessEvents?.events) ? g.fitnessEvents.events : [],
        entries: Array.isArray(index.activities) ? index.activities : [],
        // Highlights: every activity file, the index, and the calendar's past Fitness Events (Jarvis).
        story: storyContext({
          files: Array.isArray(g.fitnessActivities) ? g.fitnessActivities : [],
          entries: Array.isArray(index.activities) ? index.activities : [],
          past: Array.isArray(g.fitnessEvents?.past) ? g.fitnessEvents.past : [],
          roundupFiles: files,
          showPhotos: Boolean(index.profile?.showPhotoGallery),
        }),
      };
      const siteUrl = String(g.siteUrl || '').replace(/\/+$/, '');
      const ogCards = g.fitnessOgImages?.roundup || {};

      /** Template variables per roundup page, rendered by Skier's generateDataPagesTask. */
      const pages = [];
      for (const file of files) {
        try {
          const view = buildRoundupView(file, viewCtx);
          const ogImage = typeof ogCards[file.key] === 'string' && /^https?:\/\//.test(ogCards[file.key]) ? ogCards[file.key] : '';
          pages.push({
            page: 'life', atomFeed: FITNESS_FEED_PATH,
            subpage: `| ${view.subpage} roundup`, description: view.description, roundup: { ...view, share: g.fitnessShareCards?.roundup?.[file.key] || null, yearShare: (view.review && g.fitnessYearDecks?.[file.key]) || null },
            ogType: 'article', ogImage, canonical: siteUrl ? `${siteUrl}${view.url}` : '', publishedTime: view.generatedAt,
          });
        } catch (e) {
          ctx.logger.error(`roundup ${file.key}: ${errMsg(e)}`);
        }
      }

      const timeline = buildTimeline(pages.map((p) => p.roundup));
      /** Template variables for /life/roundups, rendered by Skier's generatePagesTask. */
      const fitnessRoundupsIndex = {
        page: 'life', atomFeed: FITNESS_FEED_PATH,
        subpage: '| roundups',
        description: 'Weekly, monthly and yearly training roundups — every session, summed up.',
        timeline,
        roundupCount: pages.length,
        roundupCountLabel: `${pages.length} issue${pages.length === 1 ? '' : 's'}`,
        fitnessUnavailable: Boolean(g.fitnessUnavailable),
      };

      ctx.logger.info(`Roundup views: ${pages.length} pages + index`);
      return { fitnessRoundupPages: pages, fitnessRoundupsIndex };
    },
  };
}
