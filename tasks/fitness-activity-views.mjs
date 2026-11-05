// @ts-check
/**
 * Fitness activity views (S2.3) — data only.
 *
 * Shapes the `fitnessActivities` global that tasks/fitness-fetch.mjs sets
 * (contract: jarvis-memory specs/ripixel-website/fitness-zine.md, "Data
 * contract (S0)" §3/§4/§8) into `fitnessActivityPages`: one plain view model
 * per activity. Skier's generateDataPagesTask renders each one with
 * personal/templates/activity.html (see skier.personal.tasks.mjs):
 *
 *   fitnessActivityPages[i]  →  public/personal/life/activity/<slug>/index.html
 *
 * The page is linked and canonicalised slash-less (/life/activity/<slug>; firebase.json has
 * trailingSlash: false, so the directory form 301s to it). The directory output is kept
 * because Firebase serves <slug>/index.html at /life/activity/<slug> under cleanUrls.
 *
 * Everything presentational is computed here so the template only does
 * `{{#if}}` / `{{#each}}` — the maths (SVG paths, unit formatting, module
 * gating in §4's order) lives in exported functions that
 * tasks/fitness-activity-views.test.mjs covers.
 */
import path from 'node:path';
import { athleteWords } from './fitness-words.mjs';
import { lineChart, niceTicks, formatTick } from './chart-axes.mjs';
import { buildHyroxHistory, buildRaceView, pbChase, eventUrl } from './fitness-hyrox.mjs';
import { activityTheme, hybridRaceLabel } from './fitness-theme.mjs';
import { calorieFigure } from './fitness-calories.mjs';
import { orientationOf } from './fitness-photo-dims.mjs';
import { routeMapState, cleanPoints, activityMapData, scriptJson, ROUTE_EMPTY_LABELS } from './route-map.mjs';
import {
  activityKind, shortLocation, isCurrentAiSummary, DEFAULT_MAX_HR, inferMaxHr, buildActivityHistory, effortRibbon, zoneSplit,
  runSplits, elevationProfile, bestEffortBadges, lifetimeProgress, liftCards, prList, prExercises, classStations,
  practiceStats, focusWords, steadyHeart, finePrint, kindAnchors,
} from './fitness-activity-kinds.mjs';

export const ACTIVITY_BASE_PATH = '/life/activity';
/** Where the fitness Atom feed is written (kept as a literal: tasks/fitness-feed-items.mjs imports this module). */
export const FITNESS_FEED_PATH = '/life/feed.xml';

const LINK_RULES = [
  { key: 'strava', label: 'Strava', re: /^https:\/\/www\.strava\.com\/activities\/\d+$/ },
  { key: 'hevy', label: 'Hevy', re: /^https:\/\/hevy\.com\/workout\/[A-Za-z0-9-]+$/ },
];

/**
 * C4 `links` ({strava?, hevy?}) → `[{key, label, url}]`, Strava first. A URL is kept only when it
 * matches its service's exact pattern (the export is data, never trusted into an href).
 * @param {unknown} links
 */
export function buildLinks(links) {
  if (!links || typeof links !== 'object') return [];
  const src = /** @type {Record<string, unknown>} */ (links);
  return LINK_RULES.flatMap(({ key, label, re }) => (typeof src[key] === 'string' && re.test(src[key]) ? [{ key, label, url: src[key] }] : []));
}

/** Same shape the fetch task accepts; slugs become file names. */
const SAFE_SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/;

// ---------------------------------------------------------------------------
// Slug → path

/** @param {unknown} slug */
export function isSafeSlug(slug) {
  return typeof slug === 'string' && SAFE_SLUG.test(slug) && !slug.includes('..');
}

/**
 * Where a slug's page is written, relative to the output directory. Throws on
 * anything that is not a plain showcase id (path separators, `..`, empty) so a
 * bad index entry can never escape it.
 * @param {string} slug
 */
export function activityOutPath(slug) {
  if (!isSafeSlug(slug)) {
    throw new Error(`unusable activity slug ${JSON.stringify(slug)}`);
  }
  return path.posix.join('life', 'activity', slug, 'index.html');
}

/** @param {string} slug */
export function activityUrl(slug) {
  return `${ACTIVITY_BASE_PATH}/${slug}`;
}

// ---------------------------------------------------------------------------
// Formatting helpers (units per the contract)

/** @param {unknown} v */
function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** @param {number} n @param {number} [digits] */
export function fmtNumber(n, digits = 0) {
  return num(n).toLocaleString('en-GB', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** Metres → "5.01" / "42.2" (km, ≥10 km gets one decimal). Empty when ≤ 0. */
export function fmtKm(m) {
  const v = num(m);
  if (v <= 0) return '';
  const km = v / 1000;
  return km >= 10 ? km.toFixed(1) : km.toFixed(2);
}

/** Metres → "850 m" / "5.0 km" (short display with unit). */
export function fmtDistance(m) {
  const v = num(m);
  if (v <= 0) return '';
  return v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 1 : 2)} km` : `${Math.round(v)} m`;
}

/** Seconds → "19:52" / "1:02:15" (clock style). Empty when ≤ 0. */
export function fmtClock(s) {
  const v = Math.round(num(s));
  if (v <= 0) return '';
  const h = Math.floor(v / 3600);
  const m = Math.floor((v % 3600) / 60);
  const sec = v % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`;
}

/** Seconds → "1h 2m" / "45m" / "30s" (prose style). Empty when ≤ 0. */
export function fmtDuration(s) {
  const v = Math.round(num(s));
  if (v <= 0) return '';
  const h = Math.floor(v / 3600);
  const m = Math.floor((v % 3600) / 60);
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return `${m}m`;
  return `${v}s`;
}

/** Seconds per km → "3:58". Empty when ≤ 0. */
export function fmtPace(secPerKm) {
  const v = num(secPerKm);
  if (v <= 0) return '';
  const m = Math.floor(v / 60);
  const s = Math.round(v % 60);
  return s === 60 ? `${m + 1}:00` : `${m}:${String(s).padStart(2, '0')}`;
}

/** m/s → seconds per km (0 when stationary). */
export function speedToPace(ms) {
  const v = num(ms);
  return v > 0 ? 1000 / v : 0;
}

/** kg → "2,560 kg" or "2.6 t" when ≥ 1000. Empty when ≤ 0. */
export function fmtWeight(kg) {
  const v = num(kg);
  if (v <= 0) return '';
  return v >= 1000 ? `${(v / 1000).toFixed(1)} t` : `${fmtNumber(Math.round(v))} kg`;
}

const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** RFC 3339 → "SAT 17 OCT 2026" (UTC, like the export). Empty when unparsable. */
export function fmtDateStamp(iso) {
  const t = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(t)) return '';
  const d = new Date(t);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** RFC 3339 → "17 Oct 2026". */
export function fmtDateShort(iso) {
  const t = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(t)) return '';
  const d = new Date(t);
  const mon = MONTHS[d.getUTCMonth()];
  return `${d.getUTCDate()} ${mon[0]}${mon.slice(1).toLowerCase()} ${d.getUTCFullYear()}`;
}

/** `some_enum_value` → `Some Enum Value`. */
export function titleCase(s) {
  return String(s ?? '')
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/** `ACTIVITY_TYPE_TRAIL_RUN` → `TRAIL RUN`. */
export function typeLabel(activityType) {
  const t = String(activityType ?? '').replace(/^ACTIVITY_TYPE_/, '').replace(/_/g, ' ').trim();
  return t || 'ACTIVITY';
}

/** `SOURCE_PARKRUN_RESULTS` → `Parkrun Results` (File Upload → FIT Upload, as the web app does). */
export function sourceLabel(source) {
  const s = String(source ?? '');
  if (!s) return '';
  const name = titleCase(s.replace(/^SOURCE_/, ''));
  return name === 'File Upload' ? 'FIT Upload' : name;
}

// Copied from fitglue-web src/showcase/utils/activityMeta.ts (ACTIVITY_TYPE_ICONS).
export const ACTIVITY_ICONS = /** @type {Record<string, string>} */ ({
  ACTIVITY_TYPE_RUN: 'RUN', ACTIVITY_TYPE_TRAIL_RUN: 'TRL', ACTIVITY_TYPE_VIRTUAL_RUN: 'RUN',
  ACTIVITY_TYPE_WALK: 'WLK', ACTIVITY_TYPE_HIKE: 'HIK', ACTIVITY_TYPE_RIDE: 'RDE',
  ACTIVITY_TYPE_MOUNTAIN_BIKE_RIDE: 'MTB', ACTIVITY_TYPE_GRAVEL_RIDE: 'RDE', ACTIVITY_TYPE_EBIKE_RIDE: 'RDE',
  ACTIVITY_TYPE_EMOUNTAIN_BIKE_RIDE: 'MTB', ACTIVITY_TYPE_VIRTUAL_RIDE: 'RDE', ACTIVITY_TYPE_SWIM: 'SWM',
  ACTIVITY_TYPE_ROWING: 'ROW', ACTIVITY_TYPE_VIRTUAL_ROW: 'ROW', ACTIVITY_TYPE_KAYAKING: 'PAD',
  ACTIVITY_TYPE_STAND_UP_PADDLING: 'SRF', ACTIVITY_TYPE_SURFING: 'SRF', ACTIVITY_TYPE_WEIGHT_TRAINING: 'GYM',
  ACTIVITY_TYPE_CROSSFIT: 'GYM', ACTIVITY_TYPE_HIGH_INTENSITY_INTERVAL_TRAINING: 'HIT', ACTIVITY_TYPE_YOGA: 'YOG',
  ACTIVITY_TYPE_PILATES: 'YOG', ACTIVITY_TYPE_ELLIPTICAL: 'ELL', ACTIVITY_TYPE_STAIR_STEPPER: 'STR',
  ACTIVITY_TYPE_ALPINE_SKI: 'SKI', ACTIVITY_TYPE_NORDIC_SKI: 'SKI', ACTIVITY_TYPE_BACKCOUNTRY_SKI: 'SKI',
  ACTIVITY_TYPE_SNOWBOARD: 'SNO', ACTIVITY_TYPE_SNOWSHOE: 'HIK', ACTIVITY_TYPE_ROCK_CLIMBING: 'CLM',
  ACTIVITY_TYPE_GOLF: 'GLF', ACTIVITY_TYPE_TENNIS: 'RKT', ACTIVITY_TYPE_BADMINTON: 'BAD',
  ACTIVITY_TYPE_TABLE_TENNIS: 'TT', ACTIVITY_TYPE_SOCCER: 'FTB', ACTIVITY_TYPE_PICKLEBALL: 'TT',
  ACTIVITY_TYPE_SQUASH: 'RKT', ACTIVITY_TYPE_RACQUETBALL: 'RKT', ACTIVITY_TYPE_SAIL: 'SAL',
  ACTIVITY_TYPE_WINDSURF: 'KIT', ACTIVITY_TYPE_KITESURF: 'KIT', ACTIVITY_TYPE_WORKOUT: 'RUN',
});

/** @param {string|undefined} activityType */
export function typeIcon(activityType) {
  return ACTIVITY_ICONS[String(activityType ?? '')] ?? '★';
}

// ---------------------------------------------------------------------------
// Text helpers

/**
 * The athlete's own words (contract §3.1): his paragraphs only, with the source app's
 * header blocks (ROXFIT's split table), Hevy set dumps and FitGlue's enricher sections
 * removed. See tasks/fitness-words.mjs.
 * @param {string|undefined|null} text
 */
export function descriptionPreamble(text) {
  return athleteWords(text);
}

const AI_ALLOWED_TAGS = new Set(['p', 'br', 'strong', 'em', 'b', 'i', 'ul', 'ol', 'li']);

/**
 * `aiSummary.html` → HTML safe to render unescaped: a leading `<h1–6>` and any
 * `AI Summary:` label are stripped, then only p/br/strong/em/b/i/ul/ol/li
 * survive (attribute-less); every other tag is removed, its text kept.
 * Script/style bodies are dropped whole.
 * @param {string|undefined|null} html
 */
export function sanitizeAiHtml(html) {
  if (!html) return '';
  let s = String(html)
    .replace(/^\s*<h[1-6][^>]*>[\s\S]*?<\/h[1-6]>\s*/i, '')
    .replace(/\bAI\s*Summary\s*:\s*/i, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  s = s.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g, (m, tag) => {
    const t = String(tag).toLowerCase();
    if (!AI_ALLOWED_TAGS.has(t)) return '';
    if (t === 'br') return '<br>';
    return m.startsWith('</') ? `</${t}>` : `<${t}>`;
  });
  return s.trim();
}

/** HTML → plain text (for OG descriptions). */
export function stripTags(html) {
  return String(html ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** @param {string} s @param {number} max */
export function truncate(s, max) {
  const t = String(s ?? '').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).trimEnd()}…`;
}

// ---------------------------------------------------------------------------
// SVG maths (inline SVG, no client JS)

/**
 * Route polyline from `[lat, lng]` pairs, equirectangular (lng scaled by
 * cos(mid-lat)) and fitted into a box whose longer side is `size`.
 * @param {Array<[number, number]>} points
 * @param {{ size?: number, pad?: number }} [opts]
 * @returns {{ d: string, w: number, h: number, start: {x:number,y:number}, end: {x:number,y:number} } | null}
 */
export function routePath(points, opts = {}) {
  const size = opts.size ?? 600;
  const pad = opts.pad ?? 16;
  if (!Array.isArray(points)) return null;
  const pts = points.filter(
    (p) => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && (p[0] !== 0 || p[1] !== 0),
  );
  if (pts.length < 2) return null;
  const lats = pts.map((p) => p[0]);
  const lngs = pts.map((p) => p[1]);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const k = Math.cos(((minLat + maxLat) / 2) * (Math.PI / 180)) || 1;
  const spanX = (maxLng - minLng) * k || 1e-9;
  const spanY = maxLat - minLat || 1e-9;
  const scale = (size - pad * 2) / Math.max(spanX, spanY);
  const w = Math.max(Math.round(spanX * scale + pad * 2), pad * 2 + 1);
  const h = Math.max(Math.round(spanY * scale + pad * 2), pad * 2 + 1);
  const toXY = (/** @type {[number, number]} */ p) => ({
    x: +(pad + (p[1] - minLng) * k * scale).toFixed(1) || 0,
    y: +(h - pad - (p[0] - minLat) * scale).toFixed(1) || 0,
  });
  const xy = pts.map(toXY);
  const d = xy.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
  return { d, w, h, start: xy[0], end: xy[xy.length - 1] };
}

// ---------------------------------------------------------------------------
// Enricher names arrive as ENRICHER_PROVIDER_<NAME>.

const P = 'ENRICHER_PROVIDER_';

// ---------------------------------------------------------------------------
// Personal records (prFormat.ts, copied)

const STRENGTH_SUFFIXES = ['_1rm', '_set_volume', '_volume', '_reps'];
const CARDIO_PRIORITY = [
  'fastest_ultra_marathon', 'longest_run', 'fastest_marathon', 'fastest_40k', 'fastest_30_mile',
  'fastest_half_marathon', 'fastest_20_mile', 'fastest_30k', 'fastest_20k', 'fastest_15_mile', 'fastest_10_mile',
  'fastest_10k', 'fastest_5_mile', 'fastest_5k', 'fastest_2_mile', 'fastest_2k', 'fastest_1_mile', 'fastest_1k',
  'fastest_500m', 'fastest_400m', 'fastest_200m', 'fastest_100m', 'longest_ride', 'fastest_ride_100k',
  'fastest_ride_50k', 'fastest_ride_30_mile', 'fastest_ride_25_mile', 'fastest_ride_40k', 'fastest_ride_20_mile',
  'fastest_ride_20k', 'fastest_ride_10_mile', 'fastest_ride_30k', 'fastest_ride_10k', 'fastest_ride_5_mile',
  'fastest_ride_5k', 'highest_elevation_gain',
];

/** @param {{ recordType: string }[]} records */
export function topPR(records) {
  return [...records].sort((a, b) => {
    const ai = STRENGTH_SUFFIXES.findIndex((s) => a.recordType.endsWith(s));
    const bi = STRENGTH_SUFFIXES.findIndex((s) => b.recordType.endsWith(s));
    if (ai !== -1 || bi !== -1) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    const ci = CARDIO_PRIORITY.indexOf(a.recordType);
    const di = CARDIO_PRIORITY.indexOf(b.recordType);
    return (ci === -1 ? 99 : ci) - (di === -1 ? 99 : di);
  })[0];
}

/** @param {number} value @param {string} unit */
export function prValue(value, unit) {
  const v = num(value);
  if (unit === 'seconds') return { val: fmtClock(v) || '0:00', unit: '' };
  if (unit === 'kg') return { val: fmtNumber(Math.round(v)), unit: 'kg' };
  if (unit === 'meters') return v >= 1000 ? { val: (v / 1000).toFixed(1), unit: 'km' } : { val: String(Math.round(v)), unit: 'm' };
  return { val: fmtNumber(Math.round(v)), unit: unit || '' };
}

/** @param {number} value @param {number|undefined|null} previous @param {string} unit */
export function prDelta(value, previous, unit) {
  if (previous == null || num(previous) <= 0) return '';
  if (unit === 'seconds') {
    const delta = num(previous) - num(value);
    if (delta <= 0) return '';
    const m = Math.floor(delta / 60);
    const s = Math.floor(delta % 60);
    return m > 0 ? `−${m}:${String(s).padStart(2, '0')}` : `−${s}s`;
  }
  const delta = num(value) - num(previous);
  if (delta <= 0) return '';
  const shown = Number.isInteger(delta) ? String(delta) : delta.toFixed(1);
  return `+${shown} ${unit}`.trim();
}

// ---------------------------------------------------------------------------
// Module gating + order (contract §4)

/** @param {number} v @param {string} [unit] @param {string} [label] */
function cell(value, unit, label, extra = {}) {
  return { value, unit: unit || '', label, ...extra };
}

/**
 * Build one grid module view model, or null when the gate fails.
 * @param {string} key  module key (contract §4 names)
 * @param {object} ctx  { en, series, category, applied, entry, activity }
 */
export function buildModule(key, ctx) {
  const { en, series, has } = ctx;
  const seconds = num(ctx.durationS) || num(ctx.entry?.durationSeconds);
  const chart = (values, label, unit, decimals = 0) =>
    lineChart(values, { label, unit, decimals, h: 120, x: { kind: 'clock', seconds } });
  switch (key) {
    case 'speed': {
      const d = en.speed;
      if (!has('SPEED_SUMMARY') || !d || num(d.avgSpeedKmh) <= 0) return null;
      const kmh = Array.isArray(series.speedMs) ? series.speedMs.map((v) => (typeof v === 'number' ? v * 3.6 : null)) : null;
      return {
        key, title: 'Speed',
        cells: [cell(fmtNumber(d.avgSpeedKmh, 1), 'km/h', 'avg', { lead: true }), cell(fmtNumber(d.maxSpeedKmh, 1), 'km/h', 'max')],
        chart: kmh ? chart(kmh, 'Speed', 'km/h', 1) : null,
      };
    }
    case 'cadence': {
      const d = en.cadence;
      if (!has('CADENCE_SUMMARY') || !d || num(d.avgRpm) <= 0) return null;
      const unit = ctx.category === 'cardio-distance' && /RUN|WALK|HIKE/.test(ctx.activityType) ? 'spm' : 'rpm';
      return {
        key, title: 'Cadence',
        cells: [cell(Math.round(d.avgRpm), unit, 'avg', { lead: true }), cell(Math.round(d.maxRpm), unit, 'max')],
        chart: chart(series.cadenceRpm, 'Cadence', unit),
      };
    }
    case 'power': {
      const d = en.power;
      if (!has('POWER_SUMMARY') || !d || num(d.avgWatts) <= 0) return null;
      const cells = [cell(Math.round(d.avgWatts), 'W', 'avg', { lead: true })];
      if (num(d.normalizedPower) > 0) cells.push(cell(Math.round(d.normalizedPower), 'W', 'normalized'));
      cells.push(cell(Math.round(num(d.maxWatts)), 'W', 'max'));
      if (num(d.kilojoules) > 0) cells.push(cell(Math.round(d.kilojoules), 'kJ', 'work'));
      if (num(d.intensityFactor) > 0) cells.push(cell(fmtNumber(d.intensityFactor, 2), '', 'intensity factor'));
      return { key, title: 'Power', cells, chart: chart(series.powerW, 'Power', 'W') };
    }
    case 'running-dynamics': {
      const d = en.runningDynamics;
      if (!has('RUNNING_DYNAMICS') || !d || num(d.avgGroundContactMs) <= 0) return null;
      return {
        key, title: 'Running dynamics',
        cells: [cell(Math.round(d.avgGroundContactMs), 'ms', 'ground contact', { lead: true }), cell(fmtNumber(d.avgVerticalOscillationCm, 1), 'cm', 'vertical osc.'), cell(fmtNumber(d.avgStepLengthM, 2), 'm', 'step length')],
      };
    }
    case 'intervals': {
      const d = en.intervals;
      const segs = Array.isArray(d?.segments) ? d.segments : [];
      if (!has('INTERVALS') || !segs.length) return null;
      return {
        key, title: 'Intervals', right: d.workoutName || '', wide: true,
        table: {
          head: ['type', 'duration', 'distance', 'hr', 'pace'],
          rows: segs.map((s) => ({
            tone: s.type || '',
            cells: [s.label || titleCase(s.type || ''), fmtClock(s.durationSeconds) || '—', fmtDistance(s.distanceMeters) || '—', num(s.avgHr) > 0 ? `${Math.round(s.avgHr)} bpm` : '—', num(s.avgSpeedMs) > 0 ? `${fmtPace(1000 / s.avgSpeedMs)}/km` : '—'],
          })),
        },
      };
    }
    case 'goals': {
      const d = en.goalTracker;
      const goals = Array.isArray(d?.goals) ? d.goals : [];
      if (!has('GOAL_TRACKER') || !goals.length) return null;
      return {
        key, title: 'Goals',
        goals: goals.map((g) => ({
          label: g.label, value: `${Number.isInteger(g.current) ? g.current : Number(num(g.current).toFixed(1))}/${g.target} ${g.unit || ''}`.trim(),
          pct: num(g.target) > 0 ? Math.min(100, Math.round((num(g.current) / g.target) * 100)) : 0,
          status: g.onPace ? 'on pace ✓' : 'behind ✗', onPace: !!g.onPace,
          days: `${num(g.daysRemaining)} day${num(g.daysRemaining) === 1 ? '' : 's'} left`,
        })),
      };
    }
    case 'temperature': {
      const d = en.temperature;
      if (!has('TEMPERATURE_SUMMARY') || !d || typeof d.avgC !== 'number') return null;
      return {
        key, title: 'Temperature',
        cells: [cell(`${fmtNumber(d.minC, 0)}°`, 'C', 'min'), cell(`${fmtNumber(d.avgC, 0)}°`, 'C', 'avg', { lead: true }), cell(`${fmtNumber(d.maxC, 0)}°`, 'C', 'max')],
        chart: chart(series.temperatureC, 'Temperature', '°C'),
      };
    }
    case 'hdrop': {
      const d = en.hdrop;
      if (!has('HDROP') || !d || typeof d.totalFluidLossL !== 'number') return null;
      const score = num(d.avgHdropScore);
      const band = score >= 70 ? 'Good' : score >= 50 ? 'Moderate' : 'Low';
      const ts = Array.isArray(d.timeseries) ? d.timeseries : [];
      const cells = [cell(fmtNumber(d.totalFluidLossL, 2), 'L', 'fluid lost', { lead: true }), cell(fmtNumber(d.sweatRateLPerHr, 2), 'L/h', 'sweat rate'), cell(Math.round(num(d.totalSodiumMg)), 'mg', 'sodium'), cell(Math.round(score), '/100', `hdrop · ${band.toLowerCase()}`)];
      return {
        key, title: 'Sweat analysis', right: [d.bodyLocation ? titleCase(d.bodyLocation) : '', `hDrop ${band}`].filter(Boolean).join(' · '),
        cells, chart: ts.length >= 2 ? lineChart(ts.map((p) => p.fluidLossCumulative), { label: 'Fluid lost, cumulative', unit: 'L', decimals: 1, h: 120, x: { kind: 'clock', seconds } }) : null,
      };
    }
    case 'spotify': {
      const d = en.spotify;
      const tracks = Array.isArray(d?.tracks) ? d.tracks : [];
      if (!has('SPOTIFY_TRACKS') || !tracks.length) return null;
      const more = num(d.totalCount) - Math.min(tracks.length, 8);
      return {
        key, title: 'Soundtrack', right: 'music',
        list: tracks.slice(0, 8).map((t) => ({ primary: t.title, secondary: t.artist, tertiary: fmtClock(t.durationSeconds) })),
        note: more > 0 ? `+${more} more` : '',
      };
    }
    default:
      return null;
  }
}

/**
 * HR zone bars (Z1–Z5; index 0 is "below Z1" and is not drawn) laid out for
 * the inline SVG in partials/activity-hr-zones.html.
 * @param {Array<{ zoneIndex?: number, name?: string, minutes?: number, percentage?: number }>|number[]} zones
 *   either the enrichment's `zones[]` or the entry's `hrZoneMinutes` int array
 */
export function hrZoneBars(zones) {
  const w = 340;
  const plotH = 84;
  const top = 6;
  const base = top + plotH; // baseline y
  const h = base + 18;      // room for the Z labels
  const colW = w / 5;
  const barW = 40;
  /** @type {{ i: number, name: string, minutes: number, pct: number }[]} */
  const rows = [];
  for (let i = 1; i <= 5; i++) {
    const z = Array.isArray(zones) ? zones[i] : undefined;
    if (typeof z === 'number') rows.push({ i, name: `Zone ${i}`, minutes: num(z), pct: 0 });
    else rows.push({ i, name: z?.name || `Zone ${i}`, minutes: num(z?.minutes), pct: num(z?.percentage) });
  }
  const total = rows.reduce((s, r) => s + r.minutes, 0);
  const max = rows.reduce((m, r) => Math.max(m, r.minutes), 0);
  if (!total) return null;
  // The axis tops out on a nice number at or above the busiest zone.
  const ticks = niceTicks(0, max);
  const hi = ticks[ticks.length - 1];
  const decimals = ticks.every(Number.isInteger) ? 0 : 1;
  const yOf = (v) => top + plotH - (v / hi) * plotH;
  return {
    w,
    h,
    total,
    base,
    yLabel: 'min',
    yTicks: [...ticks].reverse().map((t) => ({ label: formatTick(t, decimals), pct: Math.round((yOf(t) / h) * 10000) / 100 })),
    bars: rows.map((r, idx) => {
      const bh = r.minutes > 0 ? Math.max(2, Math.round((r.minutes / hi) * plotH)) : 0;
      const cx = idx * colW + colW / 2;
      return {
        label: `Z${r.i}`,
        name: r.name,
        minutes: r.minutes,
        pct: r.pct || Math.round((r.minutes / total) * 100),
        x: Math.round(cx - barW / 2),
        y: base - bh,
        w: barW,
        h: bh,
        textX: cx,
        textY: base + 13,
        valueY: Math.max(9, base - bh - 4),
        opacity: (0.45 + (r.i - 1) * 0.1375).toFixed(2),
      };
    }),
  };
}

/**
 * The small grid cards each kind keeps under its own sections (gating per module in
 * buildModule). Heart rate, zones, splits, elevation, efforts, muscles, records and the
 * fine print are drawn by the kind sections themselves (tasks/fitness-activity-kinds.mjs).
 */
const MODULES_BY_KIND = /** @type {Record<import('./fitness-activity-kinds.mjs').Kind, string[]>} */ ({
  run: ['cadence', 'power', 'running-dynamics', 'intervals', 'goals', 'temperature', 'hdrop', 'spotify'],
  ride: ['speed', 'cadence', 'power', 'goals', 'temperature', 'hdrop', 'spotify'],
  walk: ['goals', 'spotify'],
  strength: ['hdrop', 'spotify'],
  class: ['intervals', 'hdrop', 'spotify'],
  mind: ['spotify'],
  race: ['hdrop', 'spotify'],
  other: ['speed', 'cadence', 'power', 'hdrop', 'spotify'],
});

/** Grid module keys for a kind, in order (gating applied later). @param {string} kind */
export function modulesFor(kind) {
  return MODULES_BY_KIND[/** @type {keyof typeof MODULES_BY_KIND} */ (kind)] ?? MODULES_BY_KIND.other;
}

// ---------------------------------------------------------------------------
// View model

/**
 * Derive the category when the export did not carry one (contract §3.2).
 * @param {any} activity
 */
export function deriveCategory(activity) {
  const sessions = activity?.activityData?.sessions ?? [];
  if (sessions.some((s) => Array.isArray(s?.strengthSets) && s.strengthSets.length > 0)) return 'strength';
  const t = String(activity?.activityType ?? '').replace(/^ACTIVITY_TYPE_/, '');
  const distance = new Set(['RUN', 'TRAIL_RUN', 'VIRTUAL_RUN', 'RIDE', 'GRAVEL_RIDE', 'MOUNTAIN_BIKE_RIDE', 'EMOUNTAIN_BIKE_RIDE', 'EBIKE_RIDE', 'VIRTUAL_RIDE', 'HANDCYCLE', 'VELOMOBILE', 'ROLLER_SKI', 'NORDIC_SKI', 'BACKCOUNTRY_SKI', 'ALPINE_SKI', 'SNOWSHOE', 'ICE_SKATE', 'INLINE_SKATE', 'WALK', 'HIKE', 'WHEELCHAIR', 'KAYAKING', 'CANOEING', 'ROWING', 'VIRTUAL_ROW', 'STAND_UP_PADDLING', 'SWIM', 'WINDSURF', 'KITESURF', 'SAIL', 'SURFING', 'SKATEBOARD']);
  const time = new Set(['ELLIPTICAL', 'STAIR_STEPPER', 'HIGH_INTENSITY_INTERVAL_TRAINING', 'PILATES', 'YOGA', 'WORKOUT', 'CROSSFIT']);
  const sport = new Set(['TENNIS', 'BADMINTON', 'PICKLEBALL', 'RACQUETBALL', 'SQUASH', 'TABLE_TENNIS', 'SOCCER', 'GOLF', 'ROCK_CLIMBING']);
  if (distance.has(t)) return 'cardio-distance';
  if (time.has(t)) return 'cardio-time';
  if (sport.has(t)) return 'sport';
  return 'untraditional';
}

/**
 * The four hero anchor cells by category (§8).
 * @returns {{ value: string, unit: string, label: string }[]}
 */
export function anchorStats({ category, distanceM, durationS, avgBpm, maxBpm, calories, pace, speedKmh, sets, volumeKg, prCount, icon }) {
  const dash = (v) => (v ? String(v) : '—');
  const out = [];
  if (category === 'cardio-distance') {
    out.push({ value: dash(fmtKm(distanceM)), unit: distanceM > 0 ? 'km' : '', label: 'distance' });
    out.push({ value: dash(fmtClock(durationS)), unit: '', label: 'time' });
    const isRide = speedKmh > 0 && !(pace > 0);
    if (isRide) out.push({ value: fmtNumber(speedKmh, 1), unit: 'km/h', label: 'avg speed' });
    else {
      const p = pace > 0 ? pace : durationS > 0 && distanceM > 0 ? durationS / (distanceM / 1000) : 0;
      out.push({ value: dash(fmtPace(p)), unit: p > 0 ? '/km' : '', label: 'avg pace' });
    }
    out.push({ value: dash(avgBpm), unit: avgBpm > 0 ? 'bpm' : '', label: 'avg hr' });
  } else if (category === 'cardio-time') {
    out.push({ value: dash(durationS > 0 ? Math.round(durationS / 60) : 0), unit: durationS > 0 ? 'min' : '', label: 'duration' });
    out.push({ value: dash(avgBpm), unit: avgBpm > 0 ? 'bpm' : '', label: 'avg hr' });
    out.push({ value: dash(maxBpm), unit: maxBpm > 0 ? 'bpm' : '', label: 'max hr' });
    out.push({ value: dash(calories ? fmtNumber(calories) : ''), unit: calories > 0 ? 'kcal' : '', label: 'calories' });
  } else if (category === 'strength') {
    out.push({ value: dash(sets), unit: '', label: 'sets' });
    out.push({ value: dash(volumeKg > 0 ? fmtNumber(Math.round(volumeKg)) : ''), unit: volumeKg > 0 ? 'kg' : '', label: 'volume moved' });
    out.push({ value: dash(durationS > 0 ? Math.round(durationS / 60) : 0), unit: durationS > 0 ? 'min' : '', label: 'duration' });
    out.push({ value: prCount > 0 ? `+${prCount}` : '—', unit: '', label: 'personal records' });
  } else if (category === 'sport') {
    out.push({ value: dash(durationS > 0 ? Math.round(durationS / 60) : 0), unit: durationS > 0 ? 'min' : '', label: 'duration' });
    out.push({ value: dash(avgBpm), unit: avgBpm > 0 ? 'bpm' : '', label: 'avg hr' });
    out.push({ value: dash(calories ? fmtNumber(calories) : ''), unit: calories > 0 ? 'kcal' : '', label: 'calories' });
    out.push({ value: icon, unit: '', label: 'activity type' });
  } else {
    out.push({ value: dash(durationS > 0 ? Math.round(durationS / 60) : 0), unit: durationS > 0 ? 'min' : '', label: 'duration' });
    if (avgBpm > 0) out.push({ value: String(avgBpm), unit: 'bpm', label: 'avg hr' });
    if (calories > 0) out.push({ value: fmtNumber(calories), unit: 'kcal', label: 'calories' });
    if (distanceM > 0) out.push({ value: fmtKm(distanceM), unit: 'km', label: 'distance' });
    while (out.length < 4) out.push({ value: '—', unit: '', label: '—' });
  }
  return out.slice(0, 4);
}

/**
 * Hero anchors for a Hyrox race: finish time, then the official placings when the timing
 * app reported them (else runs / stations), then average HR.
 * @param {any} race  buildRaceView() output
 * @param {number} avgBpm
 */
export function raceAnchors(race, avgBpm) {
  const out = [{ value: race.total || '—', unit: '', label: 'finish time' }];
  for (const r of race.ranks) out.push({ value: r.value, unit: '', label: `${r.label} rank` });
  if (out.length < 3) out.push({ value: race.runs || '—', unit: '', label: 'running' });
  if (out.length < 3) out.push({ value: race.stations || '—', unit: '', label: 'stations' });
  out.push(avgBpm > 0 ? { value: String(avgBpm), unit: 'bpm', label: 'avg hr' } : { value: race.roxzone || '—', unit: '', label: 'roxzone' });
  return out.slice(0, 4);
}

/**
 * Hero layout from the picture's size: `heroShape` ('portrait' | 'landscape' | 'square',
 * '' when unknown) and `heroRatio` ("1080 / 1440") for the art box's aspect-ratio.
 * @param {{ w: number, h: number }|undefined} dims
 */
export function heroLayout(dims) {
  const heroShape = orientationOf(dims);
  return { heroShape, heroRatio: heroShape && dims ? `${Math.round(dims.w)} / ${Math.round(dims.h)}` : '' };
}

/**
 * Build the template context for one activity file. The page is laid out by its kind
 * (tasks/fitness-activity-kinds.mjs activityKind): `act.is.<kind>` picks the kind's
 * sections in personal/templates/activity.html.
 * @param {any} file     an element of `fitnessActivities` (activity file + indexEntry)
 * @param {any} index    `fitnessIndex`
 * @param {{ siteUrl?: string, ogCard?: string, share?: any, hyrox?: import('./fitness-hyrox.mjs').HyroxHistory|null,
 *   photoDims?: Record<string, { w: number, h: number }>, activityHistory?: import('./fitness-activity-kinds.mjs').ActivityHistory|null, maxHr?: number }} [opts]
 *   `ogCard` is the rendered OG card URL from tasks/fitness-og-images.mjs; when set it is the og:image,
 *   else first photo → section card. `hyrox` is buildHyroxHistory(fitnessActivities), for PBs
 *   per division, race weekends and the PB chase. `photoDims` (fitnessPhotoDims) lays the hero out by the
 *   picture's shape. `share` is the page's Share-button entry (fitnessShareCards.activity[slug], F5.4).
 *   `activityHistory` is buildActivityHistory(fitnessActivities) (best efforts, last time per exercise, the
 *   practice so far) and `maxHr` inferMaxHr(fitnessActivities) (the effort ribbon's zone edges).
 */
export function buildActivityView(file, index, opts = {}) {
  const activity = file?.activity ?? {};
  const entry = file?.entry ?? file?.indexEntry ?? {};
  const series = file?.series && typeof file.series === 'object' ? file.series : {};
  const routePoints = Array.isArray(file?.routePoints) ? file.routePoints : [];
  const slug = String(file?.slug ?? entry.showcaseId ?? activity.showcaseId ?? '');
  const category = file?.category || deriveCategory(activity);
  const kind = activityKind(file);
  const activityType = String(activity.activityType ?? entry.activityType ?? '');
  // A run Hevy filed as a workout (one running set) is stamped and inked as the run it was.
  const shownType = kind === 'run' && !/RUN$/.test(activityType) ? 'ACTIVITY_TYPE_RUN' : activityType;
  const applied = Array.isArray(activity.appliedEnrichments) ? activity.appliedEnrichments : [];
  const appliedSet = new Set(applied);
  const has = (/** @type {string} */ k) => appliedSet.has(P + k);
  const enrichmentsMissing = activity.enrichments === null || activity.enrichments === undefined;
  const en = enrichmentsMissing ? {} : activity.enrichments;
  const sessions = Array.isArray(activity.activityData?.sessions) ? activity.activityData.sessions : [];
  const showPhotos = !!index?.profile?.showPhotoGallery;
  const photos = showPhotos && Array.isArray(activity.photoUrls) ? activity.photoUrls.filter((u) => /^https:\/\//.test(String(u))) : [];
  const siteUrl = (opts.siteUrl || '').replace(/\/+$/, '');
  const startTime = activity.startTime ?? entry.startTime ?? '';
  const history = opts.activityHistory ?? null;

  // Totals from the sessions (falls back to the entry for metadata-only activities, and to
  // the sets for a run logged in Hevy as one running set).
  const allSets = sessions.flatMap((s) => (Array.isArray(s?.strengthSets) ? s.strengthSets : []));
  const sessionDuration = sessions.reduce((s, x) => s + num(x?.totalElapsedTime), 0);
  const sessionDistance = sessions.reduce((s, x) => s + num(x?.totalDistance), 0);
  const durationS = sessionDuration || num(entry.durationSeconds);
  const distanceM = sessionDistance || num(entry.distanceMeters) || (kind === 'run' ? allSets.reduce((s, x) => s + num(x?.distanceMeters), 0) : 0);
  const sets = allSets.length || num(entry.totalSets);
  const volumeKg = allSets.length ? allSets.reduce((s, x) => s + num(x.reps) * num(x.weightKg), 0) : num(entry.totalWeightKg);
  const reps = allSets.length ? allSets.reduce((s, x) => s + num(x.reps), 0) : num(entry.totalReps);
  const topKg = allSets.reduce((m, x) => (num(x.reps) > 0 ? Math.max(m, num(x.weightKg)) : m), 0);
  const avgBpm = num(en.heartRate?.avgBpm) || num(entry.avgHeartRate) || num(sessions[0]?.avgHeartRate);
  const maxBpm = num(en.heartRate?.maxBpm) || num(sessions[0]?.maxHeartRate);
  const calorieInfo = calorieFigure(activity, entry);
  const calories = calorieInfo.kcal;
  // Hyrox race (F5.2): the export's `race` plus PBs per division across the whole history.
  // FitGlue's division-less hybrid_race_* records are superseded by the per-division ones
  // computed here, so they are dropped from this page.
  const hyrox = opts.hyrox ?? null;
  const description = descriptionPreamble(activity.description);
  const race = buildRaceView(file, hyrox, { words: description });
  const allRecords = has('PERSONAL_RECORDS') && Array.isArray(en.personalRecords?.records) ? en.personalRecords.records : [];
  // A calm session has no records worth a stamp (Hevy files its minutes as one).
  const records = kind === 'mind' ? [] : race ? allRecords.filter((r) => !String(r?.recordType ?? '').startsWith('hybrid_race_')) : allRecords;
  const prCount = records.length + (race ? race.prCount : 0);
  const icon = typeIcon(activityType);
  const title = String(activity.title ?? entry.title ?? 'Activity');
  const locationName = shortLocation(en.location?.locationName ?? entry.locationName ?? '');

  // His words, then the AI note — only the current (Claude, his voice) ones; the older
  // Gemini summaries stay hidden (see isCurrentAiSummary).
  const aiSummaryHtml = has('AI_COMPANION') && isCurrentAiSummary(en.aiSummary, startTime) ? sanitizeAiHtml(en.aiSummary?.html) : '';
  const hybrid = has('HYBRID_RACE_TAGGER') && Array.isArray(activity.activityData?.hybridRaceSummary?.segments)
    ? activity.activityData.hybridRaceSummary.segments
    : [];
  const hybridRace = hybrid.length && !race
    ? {
        total: fmtClock(hybrid.reduce((s, x) => s + num(x.durationSeconds), 0)),
        segments: hybrid.map((s) => ({ icon: s.icon || (s.isRun ? 'RUN' : 'GYM'), label: s.label || '', duration: fmtClock(s.durationSeconds) || '—', isRun: !!s.isRun })),
      }
    : null;
  const lifetime = (kind === 'run' || kind === 'ride' || kind === 'walk') && has('DISTANCE_MILESTONES') ? lifetimeProgress(en.distanceMilestone) : null;
  const tags = Array.isArray(activity.tags) ? activity.tags.filter((t) => typeof t === 'string' && t) : [];
  // Route card: the tiled map over the published points (static SVG underneath for no-JS),
  // or a one-line empty state. A hidden route is never drawn, whatever points came with it.
  const routeState = routeMapState({ routePoints, routeHidden: file?.routeHidden ?? entry.routeHidden, category: kind === 'run' || kind === 'ride' || kind === 'walk' ? 'cardio-distance' : category });
  const route = routeState === 'map' ? routePath(cleanPoints(routePoints)) : null;
  const routeMap = !routeState || !['run', 'ride', 'walk'].includes(kind)
    ? null
    : routeState === 'map' && route
      ? { state: 'map', json: scriptJson(activityMapData(routePoints)) }
      : { state: routeState === 'map' ? 'indoor' : routeState, label: ROUTE_EMPTY_LABELS[routeState === 'map' ? 'indoor' : routeState] };

  // Bands
  const pk = has('PARKRUN') && kind === 'run' && en.parkrun?.eventName ? en.parkrun : null;
  const parkrun = pk
    ? { eventName: pk.eventName, finishTime: pk.finishTime || '', position: num(pk.position) > 0 ? `#${pk.position}` : '', ageGrade: pk.ageGrade || '', totalParkruns: num(pk.totalParkruns) > 0 ? String(pk.totalParkruns) : '', isTimePb: !!pk.isTimePb, isAgeGradePb: !!pk.isAgeGradePb }
    : null;
  let prBand = null;
  if (race?.isTotalPB) {
    const more = prCount - 1;
    prBand = {
      label: `${race.divisionLabel} PB`.toUpperCase(),
      sub: ['HYROX · NEW PERSONAL BEST', race.totalPbTime ? `PREVIOUS ${race.totalPbTime}` : '', more > 0 ? `+${more} MORE BELOW` : ''].filter(Boolean).join(' · '),
      value: race.total,
      unit: '',
      delta: race.totalDelta,
    };
  } else if (records.length && !race) {
    const top = topPR(records);
    const v = prValue(top.newValue, top.unit);
    const extra = records.length - 1;
    const [named] = prList([top]);
    prBand = {
      label: named.primary.toUpperCase(),
      sub: ['NEW PERSONAL RECORD', extra > 0 ? `+${extra} MORE RECORD${extra === 1 ? '' : 'S'} BELOW` : ''].filter(Boolean).join(' · '),
      value: v.val,
      unit: v.unit,
      delta: prDelta(top.newValue, top.previousValue, top.unit),
    };
  }

  // The heart card: the one heart-rate chart on the page, with the zones beside it. A class
  // draws its heart as the effort ribbon and a calm session as its steady line instead.
  const zoneMinutes = Array.isArray(entry.hrZoneMinutes) && entry.hrZoneMinutes.length === 6 ? entry.hrZoneMinutes : null;
  const zoneSource = Array.isArray(en.heartRateZones?.zones) && en.heartRateZones.zones.length === 6 ? en.heartRateZones.zones : zoneMinutes;
  const hrZones = has('HEART_RATE_ZONES') && zoneSource ? hrZoneBars(zoneSource) : null;
  const hrChart = Array.isArray(series.heartRate) ? lineChart(series.heartRate, { label: 'Heart rate', unit: 'bpm', h: 140, x: { kind: 'clock', seconds: durationS } }) : null;
  const d = en.heartRate;
  const hrCells = has('HEART_RATE_SUMMARY') && d && num(d.avgBpm) > 0
    ? [cell(d.minBpm, 'bpm', 'min'), cell(d.avgBpm, 'bpm', 'avg', { lead: true }), cell(d.maxBpm, 'bpm', 'max'), ...(num(d.driftBpm) !== 0 ? [cell(`${d.driftBpm > 0 ? '+' : ''}${d.driftBpm}`, 'bpm', 'drift', { warn: !!d.driftWarning })] : [])]
    : [];
  const heart = kind !== 'class' && kind !== 'mind' && (hrCells.length || hrChart || hrZones)
    ? { cells: hrCells, chart: hrChart, zones: hrZones, right: hrZones ? `${hrZones.total} min` : '' }
    : null;

  // Kind sections
  const prNames = prExercises(records);
  const efforts = Array.isArray(entry.bestEfforts) && entry.bestEfforts.length ? entry.bestEfforts : en.bestEfforts?.efforts;
  const run = kind === 'run'
    ? {
        splits: runSplits(series, en.pace, file?.kmSplits),
        elevation: elevationProfile(series, en.elevation),
        efforts: has('BEST_EFFORTS') || (Array.isArray(entry.bestEfforts) && entry.bestEfforts.length) ? bestEffortBadges(efforts, allRecords, history, startTime) : [],
      }
    : null;
  const ride = kind === 'ride' || kind === 'walk' ? { elevation: elevationProfile(series, en.elevation) } : null;
  const muscles = en.muscleHeatmap && (has('MUSCLE_HEATMAP') || has('MUSCLE_HEATMAP_IMAGE'))
    ? [...(en.muscleHeatmap.primary ?? []).map((/** @type {string} */ m) => ({ text: titleCase(m), tone: 'primary' })), ...(en.muscleHeatmap.secondary ?? []).map((/** @type {string} */ m) => ({ text: titleCase(m), tone: 'secondary' }))]
    : [];
  const strength = kind === 'strength'
    ? { lifts: liftCards(allSets, { history, date: startTime, prNames }), muscles, hasSecondary: muscles.some((m) => m.tone === 'secondary') }
    : null;
  const hotMinutes = zoneMinutes ? num(zoneMinutes[4]) + num(zoneMinutes[5]) : 0;
  const ribbon = kind === 'class' ? effortRibbon(series, opts.maxHr ?? DEFAULT_MAX_HR, durationS) : null;
  const split = kind === 'class' ? zoneSplit(zoneMinutes) : null;
  const engine = kind === 'class' && (ribbon || split)
    ? {
        ribbon,
        split,
        cells: [
          ...(avgBpm > 0 ? [cell(Math.round(avgBpm), 'bpm', 'avg')] : []),
          ...(maxBpm > 0 ? [cell(Math.round(maxBpm), 'bpm', 'peak', { lead: true })] : []),
          ...(has('EFFORT_SCORE') && num(en.effort?.score) > 0 ? [cell(Math.round(en.effort.score), '/100', `effort · ${String(en.effort.band || '').toLowerCase()}`)] : []),
        ],
      }
    : null;
  const stations = kind === 'class' ? classStations(allSets) : null;
  const practice = kind === 'mind' ? practiceStats(history, file) : null;
  const mind = kind === 'mind'
    ? { practice, focus: focusWords(title), steady: steadyHeart(series, en.heartRate, durationS) }
    : null;
  // Records get their own list on lifting and class pages; a run shows its PBs as effort
  // badges, a race as its splits.
  const prs = kind === 'strength' || kind === 'class' ? prList(records) : [];

  // Small grid cards, then the fine print.
  const ctx = { durationS, en, series, has, category, activityType, entry, activity, kmSplits: file?.kmSplits, records, calories: calorieInfo };
  const modules = modulesFor(kind).map((key) => buildModule(key, ctx)).filter(Boolean);
  const fine = finePrint({ calories: calorieInfo, en, has, kind, entry });
  const footerChips = [];
  if (has('AUTO_INCREMENT')) footerChips.push('Series activity');
  if (has('SOURCE_LINK')) footerChips.push(`→ Linked to ${sourceLabel(activity.source ?? entry.source) || 'source'}`);

  // Race-day context, the event weekend it belongs to, and the PB progression.
  const eventGroup = race ? hyrox?.eventBySlug.get(slug) : undefined;
  const eventLink = eventGroup
    ? {
        url: eventUrl(eventGroup.slug),
        name: eventGroup.name,
        count: eventGroup.slugs.length,
        others: eventGroup.slugs.filter((x) => x !== slug).map((x) => hyrox?.races.get(x)).filter(Boolean).map((r) => ({ url: r.url, title: r.title, total: r.total, division: r.divisionLabel, isPB: r.isPB })),
      }
    : null;
  const weather = en.weather && typeof en.weather.tempC === 'number'
    ? `${Math.round(en.weather.tempC)}°C${en.weather.weatherDescription ? ` · ${String(en.weather.weatherDescription).toLowerCase()}` : ''}`
    : typeof entry.tempC === 'number' ? `${Math.round(entry.tempC)}°C${entry.weatherDescription ? ` · ${String(entry.weatherDescription).toLowerCase()}` : ''}` : '';
  const raceDay = race
    ? [
        { label: 'venue', value: locationName || race.event },
        { label: 'race day', value: fmtDateShort(startTime) },
        { label: 'division', value: race.divisionLabel },
        weather ? { label: 'weather', value: weather } : null,
        race.partner ? { label: 'partner', value: race.partner } : null,
      ].filter((x) => x && x.value)
    : [];
  // This race against the PB it was chasing, its own division only, history up to it (F5.5).
  const divisionKey = String(file?.race?.division?.key ?? '');
  const chase = race && hyrox && divisionKey && !race.isSimulation ? pbChase(hyrox, divisionKey, [slug]) : null;
  const gallery = photos.map((src, i) => ({ src, id: `photo-${i + 1}`, n: i + 1, prev: `#photo-${i === 0 ? photos.length : i}`, next: `#photo-${i + 2 > photos.length ? 1 : i + 2}`, total: photos.length }));

  const ogDescription = truncate(description || stripTags(aiSummaryHtml) || `${typeLabel(activityType).toLowerCase()} · ${fmtDateShort(startTime)}`, 200);
  const ogImage = (opts.ogCard && /^https?:\/\//.test(opts.ogCard) ? opts.ogCard : '') || photos[0] || '';
  const canonical = siteUrl ? `${siteUrl}${activityUrl(slug)}` : '';
  const pace = num(en.pace?.avgPaceSecondsPerKm);
  const speedKmh = num(en.speed?.avgSpeedKmh);

  return {
    page: 'life',
    subpage: `| ${title}`,
    description: ogDescription,
    currentPage: `life/activity/${slug}`,
    // head.html overrides (shared partial): title, article OG, canonical, the fitness feed.
    headTitle: `${title} — James King`,
    ogType: 'article',
    ogImage,
    canonical,
    publishedTime: startTime,
    atomFeed: FITNESS_FEED_PATH,
    act: {
      slug,
      url: activityUrl(slug),
      canonical,
      title,
      icon,
      kind,
      is: { [kind]: true },
      typeLabel: hybridRaceLabel(title, { hasRace: !!race, event: race?.event }) || typeLabel(shownType),
      ...activityTheme(shownType),
      category,
      source: sourceLabel(activity.source ?? entry.source),
      dateStamp: fmtDateStamp(startTime),
      dateIso: startTime,
      prCount,
      bgPhotoUrl: photos[0] || '',
      ...heroLayout(opts.photoDims?.[photos[0] || '']),
      owner: String(activity.ownerDisplayName ?? index?.profile?.displayName ?? 'James').toUpperCase(),
      locationName: locationName.toUpperCase(),
      links: buildLinks(file?.links),
      // `anchors` feed the share cards, the Atom feed and the race weekend (unchanged); the
      // page leads with `headline`, the kind's own numbers, never padded with a dash.
      anchors: race ? raceAnchors(race, avgBpm) : anchorStats({ category, distanceM, durationS, avgBpm, maxBpm, calories, pace, speedKmh, sets, volumeKg, prCount, icon }),
      headline: race ? raceAnchors(race, avgBpm) : kindAnchors(kind, { durationS, distanceM, avgBpm, maxBpm, calories, pace, speedKmh, sets, reps, volumeKg, topKg, hotMinutes, elevationM: num(entry.elevationGainM), practice }),
      parkrun,
      lifetime,
      prBand,
      hybridRace,
      race,
      raceDay,
      eventLink,
      chase,
      gallery,
      description,
      aiSummaryHtml,
      tags,
      photos,
      route,
      routeMap,
      heart,
      hrZones,
      run,
      ride,
      strength,
      engine,
      stations,
      mind,
      prs,
      modules,
      finePrint: fine,
      footerChips,
      ogImage,
      ogDescription,
      share: opts.share || null,
    },
  };
}

// ---------------------------------------------------------------------------
// The Skier task

/**
 * Builds `fitnessActivityPages` from `fitnessActivities` + `fitnessIndex`
 * (after fetch-fitness and fitness-og-images, which supplies the og:image).
 * Activities whose slug is unusable as a file name are skipped with a warning.
 */
export function fitnessActivityViewsTask() {
  return {
    name: 'fitness-activity-views',
    title: 'Build the /life/activity/<slug> view models from fitnessActivities',
    config: {},
    run: async (/** @type {any} */ _cfg, /** @type {any} */ ctx) => {
      const g = ctx.globals;
      const activities = Array.isArray(g.fitnessActivities) ? g.fitnessActivities : [];
      if (!activities.length) {
        ctx.logger.warn('No fitness activities to render (fitnessActivities is empty)');
        return { fitnessActivityPages: [] };
      }
      const hyrox = buildHyroxHistory(activities);
      const activityHistory = buildActivityHistory(activities);
      const maxHr = inferMaxHr(activities);
      const pages = [];
      for (const file of activities) {
        const slug = file?.slug ?? file?.entry?.showcaseId;
        if (!isSafeSlug(slug)) {
          ctx.logger.warn(`unusable activity slug ${JSON.stringify(slug)}`);
          continue;
        }
        const ogCard = g.fitnessOgImages?.activity?.[String(slug)];
        const share = g.fitnessShareCards?.activity?.[String(slug)];
        pages.push(buildActivityView(file, g.fitnessIndex, { siteUrl: g.siteUrl, ogCard, share, hyrox, photoDims: g.fitnessPhotoDims, activityHistory, maxHr }));
      }
      const kinds = pages.reduce((/** @type {Record<string, number>} */ m, p) => ({ ...m, [p.act.kind]: (m[p.act.kind] ?? 0) + 1 }), {});
      ctx.logger.info(`Activity views: ${pages.length} of ${activities.length} (${Object.entries(kinds).map(([k, n]) => `${k} ${n}`).join(', ')}; max HR ${maxHr})`);
      return { fitnessActivityPages: pages };
    },
  };
}
