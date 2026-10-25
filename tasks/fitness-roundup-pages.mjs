// @ts-check
/**
 * Roundup pages (S2.4).
 *
 * Renders one page per roundup file in `fitnessRoundups` (see
 * tasks/fitness-fetch.mjs) and an index of all of them:
 *
 *   public/personal/life/roundup/<periodKey>.html   →  /life/roundup/<periodKey>
 *   public/personal/life/roundups.html              →  /life/roundups
 *
 * Firebase `cleanUrls` serves the extension-less URLs. Weekly, monthly and
 * yearly roundups share one template (`personal/templates/roundup.html`) with
 * period-aware labels; everything the template needs is precomputed here as a
 * plain view model so the Handlebars stays helper-free.
 *
 * Field semantics follow the S0 data contract in
 * jarvis-memory/specs/ripixel-website/fitness-zine.md §6 and §8.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import Handlebars from 'handlebars';

export const DEFAULT_TEMPLATE = 'personal/templates/roundup.html';
export const DEFAULT_INDEX_TEMPLATE = 'personal/templates/roundups-index.html';
export const DEFAULT_PARTIALS_DIR = 'personal/partials';
export const DEFAULT_OUT_DIR = 'public/personal';
export const ROUNDUP_URL_BASE = '/life/roundup';
export const ROUNDUPS_INDEX_URL = '/life/roundups';
export const ACTIVITY_URL_BASE = '/life/activity';

/** Period keys as `periodKey()` in roundup_generator.go mints them (contract §0). */
export const PERIOD_KEY = /^(?:week-(\d{2})-(\d{4})|month-(\d{2})-(\d{4})|year-(\d{4}))$/;

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3).toUpperCase());
const DOW_SHORT = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']; // Mon-first, as periods are

/** Emoji per activity type — copied from fitglue-web utils/activityMeta.ts (contract says copy, not import). */
export const ACTIVITY_TYPE_ICONS = /** @type {Record<string, string>} */ ({
  ACTIVITY_TYPE_RUN: '🏃', ACTIVITY_TYPE_TRAIL_RUN: '🏔️', ACTIVITY_TYPE_VIRTUAL_RUN: '🏃',
  ACTIVITY_TYPE_WALK: '🚶', ACTIVITY_TYPE_HIKE: '🥾', ACTIVITY_TYPE_RIDE: '🚴',
  ACTIVITY_TYPE_MOUNTAIN_BIKE_RIDE: '🚵', ACTIVITY_TYPE_GRAVEL_RIDE: '🚴',
  ACTIVITY_TYPE_EBIKE_RIDE: '⚡', ACTIVITY_TYPE_EMOUNTAIN_BIKE_RIDE: '⚡',
  ACTIVITY_TYPE_VIRTUAL_RIDE: '🚴', ACTIVITY_TYPE_SWIM: '🏊', ACTIVITY_TYPE_ROWING: '🚣',
  ACTIVITY_TYPE_VIRTUAL_ROW: '🚣', ACTIVITY_TYPE_KAYAKING: '🛶', ACTIVITY_TYPE_CANOEING: '🛶',
  ACTIVITY_TYPE_STAND_UP_PADDLING: '🏄', ACTIVITY_TYPE_SURFING: '🏄',
  ACTIVITY_TYPE_WEIGHT_TRAINING: '🏋️', ACTIVITY_TYPE_CROSSFIT: '🏋️',
  ACTIVITY_TYPE_HIGH_INTENSITY_INTERVAL_TRAINING: '⚡', ACTIVITY_TYPE_YOGA: '🧘',
  ACTIVITY_TYPE_PILATES: '🧘', ACTIVITY_TYPE_ELLIPTICAL: '🔄', ACTIVITY_TYPE_STAIR_STEPPER: '🪜',
  ACTIVITY_TYPE_ALPINE_SKI: '⛷️', ACTIVITY_TYPE_NORDIC_SKI: '🎿', ACTIVITY_TYPE_BACKCOUNTRY_SKI: '🎿',
  ACTIVITY_TYPE_SNOWBOARD: '🏂', ACTIVITY_TYPE_SNOWSHOE: '🥾', ACTIVITY_TYPE_ROCK_CLIMBING: '🧗',
  ACTIVITY_TYPE_GOLF: '⛳', ACTIVITY_TYPE_TENNIS: '🎾', ACTIVITY_TYPE_BADMINTON: '🏸',
  ACTIVITY_TYPE_TABLE_TENNIS: '🏓', ACTIVITY_TYPE_SOCCER: '⚽', ACTIVITY_TYPE_PICKLEBALL: '🏓',
  ACTIVITY_TYPE_SQUASH: '🎾', ACTIVITY_TYPE_RACQUETBALL: '🎾', ACTIVITY_TYPE_SAIL: '⛵',
  ACTIVITY_TYPE_WINDSURF: '🪁', ACTIVITY_TYPE_KITESURF: '🪁', ACTIVITY_TYPE_WORKOUT: '🏃',
});

const HR_ZONES = [
  { z: 'Z1', name: 'Easy' },
  { z: 'Z2', name: 'Aerobic' },
  { z: 'Z3', name: 'Tempo' },
  { z: 'Z4', name: 'Threshold' },
  { z: 'Z5', name: 'Max' },
];

const STRENGTH_SUFFIXES = ['_1rm', '_set_volume', '_volume', '_reps'];
const PR_METRIC_ORDER = ['1RM', 'SET VOLUME', 'VOLUME', 'REPS'];

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

/** The output file for a key, relative to outDir: `life/roundup/<key>.html`. */
export function keyToPath(key, outDir = '') {
  if (!parsePeriodKey(key)) throw new Error(`not a period key: ${JSON.stringify(key)}`);
  return path.join(outDir, 'life', 'roundup', `${key}.html`);
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

/** `ACTIVITY_TYPE_WEIGHT_TRAINING` → `Weight Training` */
export function enumLabel(value, prefix) {
  const s = String(value || '').replace(prefix, '').toLowerCase().replace(/_/g, ' ');
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** `upper_back` → `Upper Back` */
const titleCase = (s) => String(s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/** Only absolute https URLs are rendered (contract §5); anything else is dropped. */
const safeUrl = (u) => (typeof u === 'string' && /^https:\/\//i.test(u) ? u : null);

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
 * Week → seven bars; month/year → a Mon-first day grid. Coordinates are
 * precomputed so the partial only places <rect>s and <text>s.
 */
export function buildEffortStrip(type, days) {
  if (!days.length) return null;
  const dowMon = (d) => (d.getUTCDay() + 6) % 7;
  const cellTitle = (d) => `${fmtDay(d.date, true)}: ${LEVEL_WORDS[d.level]}${d.count ? ` · ${d.count} session${d.count === 1 ? '' : 's'}` : ''}`;

  if (type === 'week') {
    const cw = 44, gap = 10, maxH = 72, base = 6, labelH = 34;
    const cells = days.map((d, i) => {
      const h = d.level === 0 ? base : base + (maxH - base) * (d.level / 4);
      return {
        x: i * (cw + gap), y: maxH - h, w: cw, h,
        level: d.level, title: cellTitle(d),
        label: DOW_SHORT[dowMon(d.date)], sub: String(d.date.getUTCDate()),
        lx: i * (cw + gap) + cw / 2, ly: maxH + 16, sy: maxH + 29,
      };
    });
    const width = days.length * (cw + gap) - gap;
    return { kind: 'bars', width, height: maxH + labelH, vx: 0, vw: width, cells, labels: [] };
  }

  const cell = type === 'year' ? 11 : 18;
  const gap = type === 'year' ? 2 : 4;
  const top = 14;
  const cells = [];
  const labels = [];
  let col = 0;
  let lastMonth = -1;
  days.forEach((d, i) => {
    const dow = dowMon(d.date);
    if (i > 0 && dow === 0) col++;
    if (type === 'year' && d.date.getUTCMonth() !== lastMonth && dow === 0) {
      lastMonth = d.date.getUTCMonth();
      labels.push({ x: col * (cell + gap), y: 10, text: MONTHS_SHORT[lastMonth] });
    }
    cells.push({
      x: col * (cell + gap), y: top + dow * (cell + gap), w: cell, h: cell,
      level: d.level, title: cellTitle(d),
    });
  });
  if (type === 'month') {
    DOW_SHORT.forEach((t, r) => labels.push({ x: -8, y: top + r * (cell + gap) + cell - 4, text: t.slice(0, 1), anchor: 'end' }));
  }
  const width = (col + 1) * (cell + gap) - gap;
  const pad = type === 'month' ? 14 : 0;
  return { kind: 'grid', width, height: top + 7 * (cell + gap) - gap, vx: -pad, vw: width + pad, cells, labels };
}

// ---------------------------------------------------------------------------
// Personal records

/** `Bench Press (Barbell)_1rm` → { label: 'Bench Press (Barbell)', metric: '1RM', isStrength: true } */
export function parseRecordType(recordType) {
  const rt = String(recordType || '');
  for (const suffix of STRENGTH_SUFFIXES) {
    if (rt.endsWith(suffix)) {
      return { label: titleCase(rt.slice(0, -suffix.length)), metric: suffix.slice(1).toUpperCase().replace(/_/g, ' '), isStrength: true };
    }
  }
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
        glyph: pr.unit === 'kg' || parsed.isStrength ? '🏋️' : pr.unit === 'seconds' ? '🏃' : '🏅',
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
// View models

/**
 * Everything `personal/templates/roundup.html` renders, as plain data.
 * @param {{ key: string, previousKey?: string, roundup: any }} file
 * @param {{ byKey: Map<string, any>, neighbours: Map<string, any>, activitySlugs: Set<string>, showPhotoGallery: boolean }} ctx
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

  // --- callouts
  const callouts = (r.calloutActivities || []).filter(Boolean).map((c) => {
    const kind = String(c.kind || '').toUpperCase();
    const glyph = kind.includes('STREAK') ? '🔥' : kind.includes('RECORD') || kind.includes('PR') ? '🏆' : ACTIVITY_TYPE_ICONS[c.activityType] || '⚡';
    return { kind: c.kind || '', title: c.title || '', statValue: c.statValue || '', statUnit: c.statUnit || '', sub: c.sub || '', date: c.date || '', glyph, href: href(c.showcaseId) };
  });

  // --- sport breakdown
  const breakdownsRaw = [...(r.activityTypeBreakdowns || [])].filter(Boolean).sort((a, b) => num(b.activityCount) - num(a.activityCount));
  const sessionTotal = breakdownsRaw.reduce((s, b) => s + num(b.activityCount), 0);
  const distanceTotal = breakdownsRaw.reduce((s, b) => s + num(b.totalDistanceMeters), 0);
  const breakdown = breakdownsRaw.map((b, i) => {
    const count = num(b.activityCount);
    const dist = num(b.totalDistanceMeters);
    const w = num(b.totalWeightKg);
    const stats = [];
    if (dist > 500) stats.push(`${fmtKm(dist)} km`);
    if (num(b.totalDurationSeconds) > 0) stats.push(fmtDuration(num(b.totalDurationSeconds)));
    if (num(b.totalSets) > 0) stats.push(`${num(b.totalSets)} sets`);
    if (w > 0) { const fw = fmtWeight(w); stats.push(`${fw.value}${fw.unit} moved`); }
    return {
      ink: i % 6, glyph: ACTIVITY_TYPE_ICONS[b.activityType] || '🏅', label: enumLabel(b.activityType, 'ACTIVITY_TYPE_'),
      count, pct: sessionTotal ? Math.round((count / sessionTotal) * 100) : 0,
      share: sessionTotal ? (count / sessionTotal) * 100 : 0,
      distShare: distanceTotal ? (dist / distanceTotal) * 100 : 0,
      stats: stats.join(' · '),
    };
  });
  const distanceStack = breakdown.filter((b) => b.distShare > 0);

  // --- muscles
  const musclesRaw = (r.muscles || []).filter((m) => m && num(m.count) > 0);
  const muscleMax = Math.max(1, ...musclesRaw.map((m) => num(m.count)));
  const muscles = musclesRaw.map((m) => ({ name: titleCase(m.name), count: num(m.count), width: (num(m.count) / muscleMax) * 100 }));

  // --- media
  const photos = ctx.showPhotoGallery
    ? (r.photos || []).filter((p) => p && safeUrl(p.url)).map((p) => ({ url: safeUrl(p.url), title: p.activityTitle || '', date: p.date || '', glyph: ACTIVITY_TYPE_ICONS[p.activityType] || '', href: href(p.showcaseId) }))
    : [];
  const routes = (r.routes || []).filter((x) => x && safeUrl(x.thumbnailUrl)).map((x) => ({
    url: safeUrl(x.thumbnailUrl), title: x.activityTitle || '', date: x.date || '',
    km: num(x.distanceMeters) > 500 ? `${fmtKm(num(x.distanceMeters))} km` : '',
    glyph: ACTIVITY_TYPE_ICONS[x.activityType] || '', href: href(x.showcaseId),
  }));

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

  // --- effort strip + HR zones
  const days = calendarDays(r.periodStart, r.periodEnd, r.dayEntries);
  const effortStrip = buildEffortStrip(type, days);
  const activeDays = days.filter((d) => d.level > 0).length;
  const hrMinutes = Array.isArray(r.hrZoneMinutes) ? r.hrZoneMinutes.map(num) : [];
  const tracked = [1, 2, 3, 4, 5].reduce((s, i) => s + (hrMinutes[i] || 0), 0);
  const zoneMax = Math.max(1, ...[1, 2, 3, 4, 5].map((i) => hrMinutes[i] || 0));
  const zones = tracked >= 30
    ? HR_ZONES.map((z, i) => {
      const m = hrMinutes[i + 1] || 0;
      return { ...z, minutes: Math.round(m), pct: Math.round((m / tracked) * 100), width: (m / zoneMax) * 100 };
    })
    : null;

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
    totals, comparison, callouts, breakdown, distanceStack, hasDistanceStack: distanceStack.length > 1,
    muscles, photos, featuredPhoto: photos.length >= 5 ? photos[0] : null, gridPhotos: photos.length >= 5 ? photos.slice(1) : photos,
    routes, places, placesNote, weather,
    effortStrip, activeDays, dayCount: days.length, zones, hrTracked: Math.round(tracked),
    bestEfforts, highlights, records, prCount, sources: sources.join(' · '),
    aiSummary, prevNav, nextNav, hasNav: Boolean(prevNav || nextNav), description,
    indexUrl: ROUNDUPS_INDEX_URL,
  };
}

/** Tiles for `/life/roundups`, newest first inside each period group. */
export function buildIndexView(files) {
  const groups = { week: [], month: [], year: [] };
  for (const f of files) {
    if (!f || !parsePeriodKey(f.key)) continue;
    const r = f.roundup || {};
    const labels = periodLabels(f.key, r);
    const distance = num(r.totalDistanceMeters);
    const weight = (r.activityTypeBreakdowns || []).reduce((s, b) => s + num(b?.totalWeightKg), 0);
    const hasStrength = (r.activityTypeBreakdowns || []).some((b) => num(b?.totalSets) > 0);
    let secondary;
    if (distance > 500) secondary = `${fmtKm(distance)} km`;
    else if (hasStrength && weight > 0) { const fw = fmtWeight(weight); secondary = `${fw.value}${fw.unit} moved`; }
    else secondary = fmtDuration(num(r.totalDurationSeconds));
    const prs = (r.prsAchieved || []).length;
    groups[labels.type].push({
      key: f.key, href: keyToUrl(f.key), kicker: labels.kicker, title: labels.title, short: labels.short,
      dateRange: labels.dateRange, sessions: num(r.totalActivities), sessionsLabel: num(r.totalActivities) === 1 ? 'session' : 'sessions', secondary,
      prs: prs ? `+${prs} PR${prs === 1 ? '' : 'S'}` : '', hasAiSummary: typeof r.aiSummary === 'string' && r.aiSummary.trim() !== '',
      _start: Date.parse(r.periodStart || '') || 0,
    });
  }
  const order = [
    { type: 'week', heading: 'WEEKS', blurb: 'seven days at a time.' },
    { type: 'month', heading: 'MONTHS', blurb: 'the longer arc.' },
    { type: 'year', heading: 'YEARS', blurb: 'in review.' },
  ];
  return order
    .map((o) => ({ ...o, tiles: groups[o.type].sort((a, b) => b._start - a._start).map(({ _start, ...t }) => t) }))
    .filter((g) => g.tiles.length > 0);
}

// ---------------------------------------------------------------------------
// The Skier task

/** @param {unknown} e */
const errMsg = (e) => (e instanceof Error ? e.message : String(e));

async function registerPartials(hb, dir) {
  const files = await fs.readdir(dir);
  for (const f of files) {
    const ext = path.extname(f);
    if (ext !== '.html' && ext !== '.hbs') continue;
    hb.registerPartial(path.basename(f, ext), await fs.readFile(path.join(dir, f), 'utf8'));
  }
}

/**
 * @param {{ template?: string, indexTemplate?: string, partialsDir?: string, outDir?: string }} [config]
 */
export function fitnessRoundupPagesTask(config = {}) {
  return {
    name: 'fitness-roundup-pages',
    title: 'Generate fitness roundup pages (/life/roundup/<key> + /life/roundups)',
    config,
    run: async (/** @type {any} */ cfg, /** @type {any} */ ctx) => {
      const template = cfg.template || DEFAULT_TEMPLATE;
      const indexTemplate = cfg.indexTemplate || DEFAULT_INDEX_TEMPLATE;
      const partialsDir = cfg.partialsDir || DEFAULT_PARTIALS_DIR;
      const outDir = cfg.outDir || DEFAULT_OUT_DIR;
      const g = ctx.globals;

      const hb = Handlebars.create();
      await registerPartials(hb, partialsDir);
      const renderPage = hb.compile(await fs.readFile(template, 'utf8'));
      const renderIndex = hb.compile(await fs.readFile(indexTemplate, 'utf8'));

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
      };
      const common = { page: 'life', fitnessIndex: index };

      const pages = [];
      for (const file of files) {
        try {
          const view = buildRoundupView(file, viewCtx);
          const html = renderPage({ ...g, ...common, subpage: `| ${view.subpage} roundup`, description: view.description, roundup: view });
          const outPath = keyToPath(file.key, outDir);
          await fs.mkdir(path.dirname(outPath), { recursive: true });
          await fs.writeFile(outPath, html);
          pages.push({ key: file.key, url: view.url, title: view.short, periodType: view.type, periodStart: file.roundup?.periodStart || '', periodEnd: file.roundup?.periodEnd || '', generatedAt: view.generatedAt, description: view.description });
          ctx.logger.debug(`Generated ${outPath}`);
        } catch (e) {
          ctx.logger.error(`roundup ${file.key}: ${errMsg(e)}`);
        }
      }

      const groups = buildIndexView(files.filter((f) => pages.some((p) => p.key === f.key)));
      const indexHtml = renderIndex({
        ...g, ...common,
        subpage: '| roundups',
        description: 'Weekly, monthly and yearly training roundups — every session, summed up.',
        roundupGroups: groups,
        roundupCount: pages.length,
        roundupCountLabel: `${pages.length} issue${pages.length === 1 ? '' : 's'}`,
        fitnessUnavailable: Boolean(g.fitnessUnavailable),
      });
      const indexPath = path.join(outDir, 'life', 'roundups.html');
      await fs.mkdir(path.dirname(indexPath), { recursive: true });
      await fs.writeFile(indexPath, indexHtml);

      ctx.logger.info(`Roundup pages: ${pages.length} generated + index`);
      return { fitnessRoundupPages: pages };
    },
  };
}
