// @ts-check
/**
 * Fitness activity pages task (S2.3).
 *
 * Renders one static page per showcased activity from the `fitnessActivities`
 * global that tasks/fitness-fetch.mjs sets (contract: jarvis-memory
 * specs/ripixel-website/fitness-zine.md, "Data contract (S0)" §3/§4/§8).
 *
 *   personal/templates/activity.html  →  public/personal/life/activity/<slug>/index.html
 *
 * The page is linked and canonicalised slash-less (/life/activity/<slug>; firebase.json has
 * trailingSlash: false, so the directory form 301s to it). The directory output is kept
 * because Firebase serves <slug>/index.html at /life/activity/<slug> under cleanUrls. Skier has
 * no "page per object in a global" builtin, so this compiles the template
 * itself with Handlebars (the same library Skier uses), registering the site's
 * partials from personal/partials/.
 *
 * Everything presentational is computed here into a plain view model so the
 * template only does `{{#if}}` / `{{#each}}` — the maths (SVG paths, unit
 * formatting, module gating in §4's order) lives in exported functions that
 * tasks/fitness-activity-pages.test.mjs covers.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import Handlebars from 'handlebars';
import { athleteWords } from './fitness-words.mjs';
import { buildHyroxHistory, buildRaceView, pbChase, eventUrl } from './fitness-hyrox.mjs';
import { activityTheme, hybridRaceLabel } from './fitness-theme.mjs';
import { calorieFigure } from './fitness-calories.mjs';
import { orientationOf } from './fitness-photo-dims.mjs';

export const DEFAULT_TEMPLATE = 'personal/templates/activity.html';
export const DEFAULT_PARTIALS_DIR = 'personal/partials';
export const DEFAULT_OUT_DIR = 'public/personal';
export const ACTIVITY_BASE_PATH = '/life/activity';
/** Where tasks/fitness-feed.mjs writes the Atom feed (kept as a literal: that module imports this one). */
export const FITNESS_FEED_PATH = '/life/feed.xml';

/** Same shape the fetch task accepts; slugs become file names. */
const SAFE_SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/;

// ---------------------------------------------------------------------------
// Slug → path

/**
 * Where a slug's page is written and served. Throws on anything that is not a
 * plain showcase id (path separators, `..`, empty) so a bad index entry can
 * never escape the output directory.
 * @param {string} slug
 * @param {string} [outDir]
 */
export function slugToOutPath(slug, outDir = DEFAULT_OUT_DIR) {
  if (typeof slug !== 'string' || !SAFE_SLUG.test(slug) || slug.includes('..')) {
    throw new Error(`unusable activity slug ${JSON.stringify(slug)}`);
  }
  return path.join(outDir, 'life', 'activity', slug, 'index.html');
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
  ACTIVITY_TYPE_RUN: '🏃', ACTIVITY_TYPE_TRAIL_RUN: '🏔️', ACTIVITY_TYPE_VIRTUAL_RUN: '🏃',
  ACTIVITY_TYPE_WALK: '🚶', ACTIVITY_TYPE_HIKE: '🥾', ACTIVITY_TYPE_RIDE: '🚴',
  ACTIVITY_TYPE_MOUNTAIN_BIKE_RIDE: '🚵', ACTIVITY_TYPE_GRAVEL_RIDE: '🚴', ACTIVITY_TYPE_EBIKE_RIDE: '⚡',
  ACTIVITY_TYPE_EMOUNTAIN_BIKE_RIDE: '⚡', ACTIVITY_TYPE_VIRTUAL_RIDE: '🚴', ACTIVITY_TYPE_SWIM: '🏊',
  ACTIVITY_TYPE_ROWING: '🚣', ACTIVITY_TYPE_VIRTUAL_ROW: '🚣', ACTIVITY_TYPE_KAYAKING: '🛶',
  ACTIVITY_TYPE_STAND_UP_PADDLING: '🏄', ACTIVITY_TYPE_SURFING: '🏄', ACTIVITY_TYPE_WEIGHT_TRAINING: '🏋️',
  ACTIVITY_TYPE_CROSSFIT: '🏋️', ACTIVITY_TYPE_HIGH_INTENSITY_INTERVAL_TRAINING: '⚡', ACTIVITY_TYPE_YOGA: '🧘',
  ACTIVITY_TYPE_PILATES: '🧘', ACTIVITY_TYPE_ELLIPTICAL: '🔄', ACTIVITY_TYPE_STAIR_STEPPER: '🪜',
  ACTIVITY_TYPE_ALPINE_SKI: '⛷️', ACTIVITY_TYPE_NORDIC_SKI: '🎿', ACTIVITY_TYPE_BACKCOUNTRY_SKI: '🎿',
  ACTIVITY_TYPE_SNOWBOARD: '🏂', ACTIVITY_TYPE_SNOWSHOE: '🥾', ACTIVITY_TYPE_ROCK_CLIMBING: '🧗',
  ACTIVITY_TYPE_GOLF: '⛳', ACTIVITY_TYPE_TENNIS: '🎾', ACTIVITY_TYPE_BADMINTON: '🏸',
  ACTIVITY_TYPE_TABLE_TENNIS: '🏓', ACTIVITY_TYPE_SOCCER: '⚽', ACTIVITY_TYPE_PICKLEBALL: '🏓',
  ACTIVITY_TYPE_SQUASH: '🎾', ACTIVITY_TYPE_RACQUETBALL: '🎾', ACTIVITY_TYPE_SAIL: '⛵',
  ACTIVITY_TYPE_WINDSURF: '🪁', ACTIVITY_TYPE_KITESURF: '🪁', ACTIVITY_TYPE_WORKOUT: '🏃',
});

/** @param {string|undefined} activityType */
export function typeIcon(activityType) {
  return ACTIVITY_ICONS[String(activityType ?? '')] ?? '🏅';
}

/** `exercise-item` partial type from the contract's activity type / category. */
export function exerciseItemType(activityType, category) {
  if (category === 'strength') return 'strength';
  const t = String(activityType ?? '');
  if (/RUN$/.test(t)) return 'run';
  if (/RIDE$|HANDCYCLE|VELOMOBILE/.test(t)) return 'cycle';
  if (/WALK|HIKE|SNOWSHOE/.test(t)) return 'walk';
  return 'class';
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
 * Line + area path for a sparkline in a `w`×`h` box. `null`/non-finite
 * samples break the line (gaps), matching the contract's bucket-with-no-sample.
 * @param {Array<number|null|undefined>} values
 * @param {{ w?: number, h?: number, pad?: number, invert?: boolean }} [opts]
 * @returns {{ d: string, area: string, min: number, max: number, n: number, w: number, h: number } | null}
 */
export function sparklinePath(values, opts = {}) {
  const w = opts.w ?? 600;
  const h = opts.h ?? 120;
  const pad = opts.pad ?? 6;
  if (!Array.isArray(values)) return null;
  const valid = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (valid.length < 2) return null;
  const min = Math.min(...valid);
  const max = Math.max(...valid);
  const range = max - min || 1;
  const n = values.length;
  const stepX = n > 1 ? (w - pad * 2) / (n - 1) : 0;
  const innerH = h - pad * 2;
  const toY = (v) => {
    const t = (v - min) / range;
    const y = opts.invert ? pad + t * innerH : h - pad - t * innerH;
    return y;
  };
  const segs = [];
  let pen = false;
  let firstX = null;
  let lastX = null;
  for (let i = 0; i < n; i++) {
    const v = values[i];
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      pen = false;
      continue;
    }
    const x = +(pad + i * stepX).toFixed(1);
    const y = +toY(v).toFixed(1);
    segs.push(`${pen ? 'L' : 'M'}${x},${y}`);
    pen = true;
    if (firstX === null) firstX = x;
    lastX = x;
  }
  const d = segs.join(' ');
  // Area closes to the baseline across the span of drawn samples; gaps are
  // bridged (it is a wash, not data).
  const area = `${d.replace(/M/g, (m, i) => (i === 0 ? 'M' : 'L'))} L${lastX},${h - pad} L${firstX},${h - pad} Z`;
  return { d, area, min, max, n, w, h };
}

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
// Enrichment registry (copied from fitglue-web BoosterTimeline.tsx + format.ts,
// not imported — the contract says to carry the table).

const P = 'ENRICHER_PROVIDER_';

export const ENRICHER_ORDER = [
  'AI_BANNER', 'AI_COMPANION', 'ROUTE_THUMBNAIL',
  'CONDITION_MATCHER', 'ACTIVITY_FILTER', 'LOGIC_GATE', 'TYPE_MAPPER', 'AI_ACTIVITY_TYPE', 'AUTO_INCREMENT', 'SOURCE_LINK',
  'PARKRUN', 'HYBRID_RACE_TAGGER', 'RUNNING_DYNAMICS',
  'FITBIT_HEART_RATE', 'FIT_FILE_HEART_RATE', 'HEART_RATE_SUMMARY', 'HEART_RATE_ZONES', 'PACE_SUMMARY', 'SPEED_SUMMARY',
  'CADENCE_SUMMARY', 'POWER_SUMMARY', 'ELEVATION_SUMMARY', 'EFFORT_SCORE', 'CALORIES_BURNED', 'TRAINING_LOAD', 'WORKOUT_SUMMARY',
  'MUSCLE_HEATMAP', 'MUSCLE_HEATMAP_IMAGE',
  'PERSONAL_RECORDS', 'DISTANCE_MILESTONES', 'GOAL_TRACKER',
  'RECOVERY_ADVISOR', 'STREAK_TRACKER', 'INTERVALS', 'LOCATION_NAMING', 'WEATHER',
  'SPOTIFY_TRACKS',
  'USER_INPUT', 'MANUAL_WORKOUT_ENTRY', 'PHOTO_UPLOAD', 'VIRTUAL_GPS',
].map((k) => P + k);

const TYPED_OUTPUT = new Set([
  'HEART_RATE_SUMMARY', 'HEART_RATE_ZONES', 'PACE_SUMMARY', 'SPEED_SUMMARY', 'CADENCE_SUMMARY', 'POWER_SUMMARY',
  'ELEVATION_SUMMARY', 'EFFORT_SCORE', 'CALORIES_BURNED', 'TRAINING_LOAD', 'WORKOUT_SUMMARY', 'RECOVERY_ADVISOR',
  'STREAK_TRACKER', 'WEATHER', 'INTERVALS', 'RUNNING_DYNAMICS', 'MUSCLE_HEATMAP', 'MUSCLE_HEATMAP_IMAGE', 'PARKRUN',
  'HYBRID_RACE_TAGGER', 'PERSONAL_RECORDS', 'DISTANCE_MILESTONES', 'GOAL_TRACKER', 'SPOTIFY_TRACKS', 'AI_COMPANION',
  'AI_BANNER', 'ROUTE_THUMBNAIL',
].map((k) => P + k));

const ENRICHER_INFO = /** @type {Record<string, { icon: string, name: string }>} */ ({
  FITBIT_HEART_RATE: { icon: '❤️', name: 'Fitbit Heart Rate' },
  WORKOUT_SUMMARY: { icon: '📋', name: 'Workout Summary' },
  MUSCLE_HEATMAP: { icon: '🔥', name: 'Muscle Heatmap' },
  AI_COMPANION: { icon: '🤖', name: 'AI Companion' },
  HEART_RATE_SUMMARY: { icon: '💓', name: 'Heart Rate Summary' },
  PACE_SUMMARY: { icon: '⚡', name: 'Pace Summary' },
  CADENCE_SUMMARY: { icon: '🦶', name: 'Cadence Summary' },
  POWER_SUMMARY: { icon: '💪', name: 'Power Summary' },
  SPEED_SUMMARY: { icon: '🚀', name: 'Speed Summary' },
  PERSONAL_RECORDS: { icon: '🏆', name: 'Personal Records' },
  TRAINING_LOAD: { icon: '📊', name: 'Training Load' },
  WEATHER: { icon: '🌤️', name: 'Weather' },
  ELEVATION_SUMMARY: { icon: '⛰️', name: 'Elevation Summary' },
  LOCATION_NAMING: { icon: '📍', name: 'Location Naming' },
  MUSCLE_HEATMAP_IMAGE: { icon: '🔥', name: 'Muscle Heatmap Image' },
  ROUTE_THUMBNAIL: { icon: '🗺️', name: 'Route Thumbnail' },
  AI_BANNER: { icon: '🎨', name: 'AI Banner' },
  HEART_RATE_ZONES: { icon: '❤️‍🔥', name: 'Heart Rate Zones' },
  CALORIES_BURNED: { icon: '🔥', name: 'Calories Burned' },
  GOAL_TRACKER: { icon: '🎯', name: 'Goal Tracker' },
  STREAK_TRACKER: { icon: '🔥', name: 'Streak Tracker' },
  DISTANCE_MILESTONES: { icon: '🏅', name: 'Distance Milestones' },
  RECOVERY_ADVISOR: { icon: '🛌', name: 'Recovery Advisor' },
  EFFORT_SCORE: { icon: '💯', name: 'Effort Score' },
  INTERVALS: { icon: '⏱️', name: 'Intervals' },
  RUNNING_DYNAMICS: { icon: '🏃', name: 'Running Dynamics' },
  HYBRID_RACE_TAGGER: { icon: '🏁', name: 'Hybrid Race Tagger' },
  PARKRUN: { icon: '🏃', name: 'Parkrun Results' },
  SOURCE_LINK: { icon: '🔗', name: 'Source Link' },
});

/** @param {string} key */
export function enricherInfo(key) {
  const short = String(key ?? '').replace(P, '');
  return ENRICHER_INFO[short] ?? { icon: '✨', name: titleCase(short) || 'Booster' };
}

/**
 * "⚡ Booster Sequence · N ran": applied enrichers in canonical order,
 * unknown names last as-is.
 * @param {string[]|undefined} applied
 */
export function boosterTimeline(applied) {
  const list = Array.isArray(applied) ? applied.filter((k) => typeof k === 'string') : [];
  if (!list.length) return null;
  const set = new Set(list);
  const known = ENRICHER_ORDER.filter((k) => set.has(k));
  const unknown = list.filter((k) => !ENRICHER_ORDER.includes(k));
  const items = [...known, ...unknown].map((k) => {
    const info = enricherInfo(k);
    const typed = TYPED_OUTPUT.has(k);
    return { key: k, icon: info.icon, name: info.name, typed, sub: typed ? '✓ ran' : '✓ ran · no visual output' };
  });
  return { count: list.length, items };
}

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

/** `Bench Press (Barbell)_1rm` → { label, prType: '1RM', exercise } ; `5k` → { label: '5k', prType: '' }. */
export function parseRecordType(recordType) {
  const rt = String(recordType ?? '');
  for (const suffix of STRENGTH_SUFFIXES) {
    if (rt.endsWith(suffix)) {
      const exercise = rt.slice(0, -suffix.length);
      return { label: titleCase(exercise), exercise, prType: suffix.slice(1).toUpperCase().replace(/_/g, ' '), isStrength: true };
    }
  }
  return { label: rt.replace(/_/g, ' '), exercise: rt, prType: '', isStrength: false };
}

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
// Strength set list (SetListModule.tsx, copied)

/** @param {number} kg */
function setWeight(kg) {
  return kg % 1 === 0 ? String(kg) : kg.toFixed(1);
}

/** @param {number} secs */
function setDuration(secs) {
  if (secs >= 3600) {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    return m > 0 ? `${h}h${m}m` : `${h}h`;
  }
  if (secs >= 60) {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return s > 0 ? `${m}m${s}s` : `${m}m`;
  }
  return `${secs}s`;
}

/** `3×8 × 80kg`, `45s`, `1.2km × 20kg`… */
export function setChip(s) {
  const hasDuration = s.durationSeconds > 0;
  const hasDistance = s.distanceMeters > 0;
  const hasWeight = s.weightKg > 0;
  let base;
  if (hasDuration) {
    const dur = setDuration(s.durationSeconds);
    base = hasWeight ? `${dur} × ${setWeight(s.weightKg)}kg` : dur;
  } else if (hasDistance) {
    const dist = s.distanceMeters >= 1000 ? `${(s.distanceMeters / 1000).toFixed(1)}km` : `${Math.round(s.distanceMeters)}m`;
    base = hasWeight ? `${dist} × ${setWeight(s.weightKg)}kg` : dist;
  } else {
    const weight = hasWeight ? ` × ${setWeight(s.weightKg)}kg` : '';
    base = s.reps > 0 ? `${s.reps}${weight}` : `—${weight}`;
  }
  return s.count > 1 ? `${s.count}×${base}` : base;
}

/**
 * Group sets by exercise (first-seen order), collapse consecutive identical
 * sets, compute per-exercise volume and the footer totals.
 * @param {any[]} sets   every session's `strengthSets` flattened
 * @param {Set<string>} [prNames]  exercise names with a PR this activity
 */
export function groupStrengthSets(sets, prNames = new Set()) {
  const list = Array.isArray(sets) ? sets : [];
  if (!list.length) return null;
  /** @type {string[]} */
  const order = [];
  /** @type {Record<string, any[]>} */
  const runs = {};
  for (const set of list) {
    const name = String(set?.exerciseName ?? '');
    if (!runs[name]) {
      order.push(name);
      runs[name] = [];
    }
    runs[name].push(set);
  }
  const exercises = order.map((name) => {
    const raw = runs[name];
    /** @type {any[]} */
    const combined = [];
    for (const set of raw) {
      const entry = {
        reps: num(set.reps),
        weightKg: num(set.weightKg),
        durationSeconds: num(set.durationSeconds),
        distanceMeters: num(set.distanceMeters),
      };
      const last = combined[combined.length - 1];
      if (
        last &&
        last.reps === entry.reps &&
        last.weightKg === entry.weightKg &&
        last.durationSeconds === entry.durationSeconds &&
        last.distanceMeters === entry.distanceMeters
      ) {
        last.count += 1;
      } else {
        combined.push({ ...entry, count: 1 });
      }
    }
    const volume = raw.reduce((sum, s) => sum + num(s.reps) * num(s.weightKg), 0);
    const reps = raw.reduce((sum, s) => sum + num(s.reps), 0);
    const duration = raw.reduce((sum, s) => sum + num(s.durationSeconds), 0);
    const chips = combined.map(setChip);
    const summary = [
      `${raw.length} set${raw.length === 1 ? '' : 's'}`,
      reps > 0 ? `${reps} reps` : '',
      volume > 0 ? `${fmtNumber(Math.round(volume))} kg` : duration > 0 ? setDuration(duration) : '',
    ].filter(Boolean).join(' · ');
    return {
      name: name || 'Exercise',
      isPR: !!(name && prNames.has(name)),
      chips,
      setCount: raw.length,
      reps,
      volume: Math.round(volume),
      volumeLabel: volume > 0 ? `${fmtNumber(Math.round(volume))} kg` : duration > 0 ? setDuration(duration) : '',
      summary,
    };
  });
  const totalSets = list.length;
  const totalReps = list.reduce((sum, s) => sum + num(s.reps), 0);
  const totalVolume = Math.round(list.reduce((sum, s) => sum + num(s.reps) * num(s.weightKg), 0));
  const totalDuration = list.reduce((sum, s) => sum + num(s.durationSeconds), 0);
  return {
    exercises,
    totalSets,
    totalReps,
    totalVolume,
    totalVolumeLabel: fmtNumber(totalVolume),
    totalDurationLabel: totalReps === 0 && totalDuration > 0 ? setDuration(totalDuration) : '',
    right: `${exercises.length} exercise${exercises.length === 1 ? '' : 's'} · ${totalSets} set${totalSets === 1 ? '' : 's'}`,
  };
}

// ---------------------------------------------------------------------------
// Module gating + order (contract §4)

const WEATHER_ICONS = [
  [0, '☀️'], [1, '🌤️'], [2, '⛅'], [3, '☁️'], [45, '🌫️'], [48, '🌫️'], [51, '🌦️'], [53, '🌦️'], [55, '🌧️'],
  [56, '🌧️'], [57, '🌧️'], [61, '🌧️'], [63, '🌧️'], [65, '🌧️'], [66, '🌧️'], [67, '🌧️'], [71, '🌨️'], [73, '🌨️'],
  [75, '❄️'], [77, '🌨️'], [80, '🌦️'], [81, '🌧️'], [82, '⛈️'], [85, '🌨️'], [86, '❄️'], [95, '⛈️'], [96, '⛈️'], [99, '⛈️'],
];

/** WMO weather code → emoji. */
export function weatherIcon(code) {
  const c = num(code);
  const hit = WEATHER_ICONS.find(([k]) => k === c);
  return hit ? hit[1] : '🌡️';
}

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
  const spark = (values, opts) => {
    const p = sparklinePath(values, opts);
    return p ? { d: p.d, area: p.area } : null;
  };
  switch (key) {
    case 'heart-rate': {
      const d = en.heartRate;
      if (!has('HEART_RATE_SUMMARY') || !d || num(d.avgBpm) <= 0) return null;
      const cells = [cell(d.minBpm, 'bpm', 'min'), cell(d.avgBpm, 'bpm', 'avg', { lead: true }), cell(d.maxBpm, 'bpm', 'max')];
      if (num(d.driftBpm) !== 0) cells.push(cell(`${d.driftBpm > 0 ? '+' : ''}${d.driftBpm}`, 'bpm', 'drift', { warn: !!d.driftWarning }));
      return { key, title: 'Heart rate', cells, sparkline: spark(series.heartRate), sparkCaption: 'bpm over the session' };
    }
    case 'zones': {
      const d = en.heartRateZones;
      const zones = Array.isArray(d?.zones) ? d.zones : [];
      if (!has('HEART_RATE_ZONES') || !zones.some((z) => num(z.minutes) > 0)) return null;
      return { key, title: 'HR zones', right: d.totalMinutes ? `${d.totalMinutes} min` : '', zones: hrZoneBars(zones) };
    }
    case 'pace': {
      const d = en.pace;
      if (!has('PACE_SUMMARY') || !d || num(d.avgPaceSecondsPerKm) <= 0) return null;
      const cells = [cell(fmtPace(d.avgPaceSecondsPerKm), '/km', 'avg pace', { lead: true })];
      if (num(d.bestSplitSecondsPerKm) > 0) cells.push(cell(fmtPace(d.bestSplitSecondsPerKm), '/km', 'best split'));
      const splits = Array.isArray(d.splits) ? d.splits.filter((s) => num(s.seconds) > 0) : [];
      const slowest = splits.reduce((m, s) => Math.max(m, num(s.seconds)), 0);
      const kmHr = new Map((Array.isArray(ctx.kmSplits) ? ctx.kmSplits : []).map((k) => [num(k.km), k]));
      const bars = splits.map((s) => {
        const hr = kmHr.get(num(s.km));
        return { label: `${s.km} km`, value: fmtPace(s.seconds), pct: slowest ? Math.round((num(s.seconds) / slowest) * 100) : 0, hr: hr && num(hr.avgHr) > 0 ? `${Math.round(hr.avgHr)}` : '', hrMax: hr && num(hr.maxHr) > 0 ? `${Math.round(hr.maxHr)}` : '' };
      });
      const paceSeries = Array.isArray(series.speedMs) ? series.speedMs.map((v) => (num(v) > 0 ? 1000 / v : null)) : null;
      return {
        key, title: 'Pace', cells,
        sparkline: paceSeries ? spark(paceSeries, { invert: true }) : null, sparkCaption: 'pace (faster is higher)',
        bars: bars.length ? { rows: bars, hasHr: bars.some((b) => b.hr) } : null,
        note: num(d.paceDropPercent) > 0 ? `😓 ${Math.round(d.paceDropPercent)}% pace drop in the final quarter` : '',
      };
    }
    case 'speed': {
      const d = en.speed;
      if (!has('SPEED_SUMMARY') || !d || num(d.avgSpeedKmh) <= 0) return null;
      const kmh = Array.isArray(series.speedMs) ? series.speedMs.map((v) => (typeof v === 'number' ? v * 3.6 : null)) : null;
      return {
        key, title: 'Speed',
        cells: [cell(fmtNumber(d.avgSpeedKmh, 1), 'km/h', 'avg', { lead: true }), cell(fmtNumber(d.maxSpeedKmh, 1), 'km/h', 'max')],
        sparkline: kmh ? spark(kmh) : null, sparkCaption: 'km/h over the session',
      };
    }
    case 'cadence': {
      const d = en.cadence;
      if (!has('CADENCE_SUMMARY') || !d || num(d.avgRpm) <= 0) return null;
      const unit = ctx.category === 'cardio-distance' && /RUN|WALK|HIKE/.test(ctx.activityType) ? 'spm' : 'rpm';
      return {
        key, title: 'Cadence',
        cells: [cell(Math.round(d.avgRpm), unit, 'avg', { lead: true }), cell(Math.round(d.maxRpm), unit, 'max')],
        sparkline: spark(series.cadenceRpm), sparkCaption: `${unit} over the session`,
      };
    }
    case 'elevation': {
      const d = en.elevation;
      if (!has('ELEVATION_SUMMARY') || !d || (num(d.totalGainM) === 0 && num(d.totalLossM) === 0)) return null;
      const cells = [cell(`↑ ${Math.round(num(d.totalGainM))}`, 'm', 'gain', { lead: true }), cell(`↓ ${Math.round(num(d.totalLossM))}`, 'm', 'loss')];
      if (num(d.maxAltitudeM) > 0) cells.push(cell(Math.round(d.maxAltitudeM), 'm', 'max altitude'));
      return { key, title: 'Elevation', cells, sparkline: spark(series.altitudeM), sparkCaption: 'altitude profile', area: true };
    }
    case 'power': {
      const d = en.power;
      if (!has('POWER_SUMMARY') || !d || num(d.avgWatts) <= 0) return null;
      const cells = [cell(Math.round(d.avgWatts), 'W', 'avg', { lead: true })];
      if (num(d.normalizedPower) > 0) cells.push(cell(Math.round(d.normalizedPower), 'W', 'normalized'));
      cells.push(cell(Math.round(num(d.maxWatts)), 'W', 'max'));
      if (num(d.kilojoules) > 0) cells.push(cell(Math.round(d.kilojoules), 'kJ', 'work'));
      if (num(d.intensityFactor) > 0) cells.push(cell(fmtNumber(d.intensityFactor, 2), '', 'intensity factor'));
      return { key, title: 'Power', cells, sparkline: spark(series.powerW), sparkCaption: 'watts over the session' };
    }
    case 'effort': {
      const d = en.effort;
      if (!has('EFFORT_SCORE') || !d) return null;
      const factors = Array.isArray(d.factors) ? d.factors.filter((f) => f && f.label) : [];
      return {
        key, title: 'Effort', right: d.band || '',
        cells: [cell(Math.round(num(d.score)), '/100', 'score', { lead: true }), cell(d.band || '—', '', 'band')],
        note: factors.length ? factors.map((f) => `${f.label} ×${fmtNumber(f.ratioVsBaseline, 2)}`).join(' · ') : '',
      };
    }
    case 'calories': {
      // The platform's figure (Strava's) over FitGlue's estimate (F5.5).
      const c = ctx.calories ?? calorieFigure(ctx.activity, ctx.entry);
      if ((!has('CALORIES_BURNED') && c.source !== 'platform') || c.kcal <= 0) return null;
      const right = c.source === 'platform' ? `from ${sourceLabel(ctx.activity?.source) || 'the source'}` : 'estimated';
      return { key, title: 'Calories', right, cells: [cell(fmtNumber(c.kcal), 'kcal', 'burned', { lead: true })], note: c.note };
    }
    case 'training-load': {
      const d = en.trainingLoad;
      if (!has('TRAINING_LOAD') || !d || num(d.trimp) <= 0) return null;
      return { key, title: 'Training load', right: d.bucket || '', cells: [cell(Math.round(d.trimp), 'trimp', 'load', { lead: true }), cell(d.bucket || '—', '', 'bucket')], note: d.hint || '' };
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
    case 'best-efforts': {
      const d = en.bestEfforts;
      const efforts = Array.isArray(d?.efforts) ? d.efforts : [];
      if (!has('BEST_EFFORTS') || !efforts.length || ctx.category !== 'cardio-distance') return null;
      return { key, title: 'Best efforts', cells: efforts.map((e) => cell(fmtClock(e.timeSeconds) || '—', '', e.display || e.distanceKey)) };
    }
    case 'muscle-heatmap': {
      const d = en.muscleHeatmap;
      const primary = Array.isArray(d?.primary) ? d.primary : [];
      const secondary = Array.isArray(d?.secondary) ? d.secondary : [];
      if (!(has('MUSCLE_HEATMAP') || has('MUSCLE_HEATMAP_IMAGE')) || !d || !(primary.length || secondary.length || d.imageUrl)) return null;
      return {
        key, title: 'Muscles',
        image: d.imageUrl ? { src: d.imageUrl, alt: 'Muscle heatmap' } : null,
        chips: [...primary.map((m) => ({ text: titleCase(m), tone: 'primary' })), ...secondary.map((m) => ({ text: titleCase(m), tone: 'secondary' }))],
        chipsLegend: primary.length && secondary.length ? 'solid = primary · outlined = secondary' : '',
      };
    }
    case 'recovery': {
      const d = en.recovery;
      if (!has('RECOVERY_ADVISOR') || !d) return null;
      const cells = [cell(Math.round(num(d.sessionLoad)), '', 'session load', { lead: true }), cell(fmtNumber(d.acuteChronicRatio, 2), '', 'acute:chronic'), cell(Math.round(num(d.hoursToRecover)), 'h', 'to recover')];
      if (num(d.sevenDayLoad) > 0) cells.push(cell(Math.round(d.sevenDayLoad), '', '7-day load'));
      if (num(d.twentyEightDayAvgLoad) > 0) cells.push(cell(Math.round(d.twentyEightDayAvgLoad), '', '28-day avg'));
      return { key, title: 'Recovery', cells, note: d.alert ? d.alertText || 'Recovery alert' : '', noteWarn: !!d.alert };
    }
    case 'streak': {
      const d = en.streak;
      if (!has('STREAK_TRACKER') || !d || num(d.currentDays) <= 0) return null;
      const cal = Array.isArray(d.calendar) ? d.calendar.slice(-28) : [];
      return {
        key, title: 'Streak',
        cells: [cell(d.currentDays, 'days', 'current', { lead: true }), cell(num(d.longestDays), 'days', 'longest')],
        dots: cal.map((c) => ({ date: c.date, state: String(c.state ?? '').replace('STREAK_DAY_STATE_', '').toLowerCase() || 'off' })),
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
    case 'weather': {
      const d = en.weather;
      if (!has('WEATHER') || ctx.category !== 'cardio-distance' || !d || typeof d.tempC !== 'number') return null;
      return {
        key, title: 'Weather', right: weatherIcon(d.weatherCode),
        cells: [cell(`${Math.round(d.tempC)}°`, 'C', 'temp', { lead: true }), cell(d.weatherDescription || '—', '', 'conditions'), cell(Math.round(num(d.windSpeedKph)), 'km/h', 'wind'), cell(d.windDirection || '—', '', 'direction')],
      };
    }
    case 'temperature': {
      const d = en.temperature;
      if (!has('TEMPERATURE_SUMMARY') || !d || typeof d.avgC !== 'number') return null;
      return {
        key, title: 'Temperature',
        cells: [cell(`${fmtNumber(d.minC, 0)}°`, 'C', 'min'), cell(`${fmtNumber(d.avgC, 0)}°`, 'C', 'avg', { lead: true }), cell(`${fmtNumber(d.maxC, 0)}°`, 'C', 'max')],
        sparkline: spark(series.temperatureC), sparkCaption: '°C over the session',
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
        cells, sparkline: ts.length >= 2 ? spark(ts.map((p) => p.fluidLossCumulative)) : null, sparkCaption: 'cumulative fluid loss', area: true,
      };
    }
    case 'spotify': {
      const d = en.spotify;
      const tracks = Array.isArray(d?.tracks) ? d.tracks : [];
      if (!has('SPOTIFY_TRACKS') || !tracks.length) return null;
      const more = num(d.totalCount) - Math.min(tracks.length, 8);
      return {
        key, title: 'Soundtrack', right: '🎧',
        list: tracks.slice(0, 8).map((t) => ({ primary: t.title, secondary: t.artist, tertiary: fmtClock(t.durationSeconds) })),
        note: more > 0 ? `+${more} more` : '',
      };
    }
    case 'pr-callout': {
      const d = en.personalRecords;
      const records = Array.isArray(ctx.records) ? ctx.records : Array.isArray(d?.records) ? d.records : [];
      if (!has('PERSONAL_RECORDS') || !records.length) return null;
      return {
        key, title: 'Personal records', right: `${records.length} new`,
        list: records.map((r) => {
          const parsed = parseRecordType(r.recordType);
          const v = prValue(r.newValue, r.unit);
          return { primary: r.displayMessage || `${parsed.label} ${parsed.prType}`.trim(), secondary: `${v.val}${v.unit ? ` ${v.unit}` : ''}`, tertiary: prDelta(r.newValue, r.previousValue, r.unit) };
        }),
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
  const rowH = 22;
  const barX = 34;
  const barMaxW = 236;
  const labelX = 280;
  /** @type {{ i: number, name: string, minutes: number, pct: number }[]} */
  const rows = [];
  for (let i = 1; i <= 5; i++) {
    const z = Array.isArray(zones) ? zones[i] : undefined;
    if (typeof z === 'number') rows.push({ i, name: `Zone ${i}`, minutes: num(z), pct: 0 });
    else rows.push({ i, name: z?.name || `Zone ${i}`, minutes: num(z?.minutes), pct: num(z?.percentage) });
  }
  const total = rows.reduce((s, r) => s + r.minutes, 0);
  const max = rows.reduce((m, r) => Math.max(m, r.minutes), 0) || 1;
  if (!total) return null;
  return {
    w: 340,
    h: rowH * 5,
    total,
    bars: rows.map((r, idx) => ({
      label: `Z${r.i}`,
      name: r.name,
      minutes: r.minutes,
      pct: r.pct || Math.round((r.minutes / total) * 100),
      x: barX,
      y: idx * rowH + 4,
      w: Math.max(r.minutes > 0 ? 2 : 0, Math.round((r.minutes / max) * barMaxW)),
      h: rowH - 8,
      textY: idx * rowH + rowH / 2 + 4,
      labelX,
      opacity: (0.45 + (r.i - 1) * 0.1375).toFixed(2),
    })),
  };
}

const GRID_ORDER = /** @type {Record<string, string[]>} */ ({
  'cardio-distance': ['heart-rate', 'zones', 'pace', 'speed', 'cadence', 'elevation', 'power', 'effort', 'calories', 'training-load', 'running-dynamics', 'intervals', 'best-efforts'],
  'cardio-time': ['heart-rate', 'zones', 'cadence', 'effort', 'calories', 'training-load'],
  strength: ['muscle-heatmap', 'set-list', 'heart-rate', 'zones', 'effort', 'calories', 'training-load'],
  sport: ['heart-rate', 'zones', 'effort', 'calories'],
  untraditional: ['heart-rate', 'calories'],
});
const TAIL_ORDER = ['recovery', 'streak', 'goals', 'weather', 'temperature', 'hdrop', 'spotify'];

/** Module keys for a category, in the contract's order (gating applied later). */
export function moduleOrderFor(category) {
  return [...(GRID_ORDER[category] ?? GRID_ORDER.untraditional), 'pr-callout', ...TAIL_ORDER];
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
 * Build the template context for one activity file.
 * @param {any} file     an element of `fitnessActivities` (activity file + indexEntry)
 * @param {any} index    `fitnessIndex`
 * @param {{ siteUrl?: string, ogCard?: string, hyrox?: import('./fitness-hyrox.mjs').HyroxHistory|null, photoDims?: Record<string, { w: number, h: number }> }} [opts]
 *   `ogCard` is the rendered OG card URL from tasks/fitness-og-images.mjs; when set it is the og:image,
 *   else banner → first photo → section card. `hyrox` is buildHyroxHistory(fitnessActivities), for PBs
 *   per division, race weekends and the PB chase. `photoDims` (fitnessPhotoDims) lays the hero out by the
 *   picture's shape.
 */
export function buildActivityView(file, index, opts = {}) {
  const activity = file?.activity ?? {};
  const entry = file?.entry ?? file?.indexEntry ?? {};
  const series = file?.series && typeof file.series === 'object' ? file.series : {};
  const routePoints = Array.isArray(file?.routePoints) ? file.routePoints : [];
  const slug = String(file?.slug ?? entry.showcaseId ?? activity.showcaseId ?? '');
  const category = file?.category || deriveCategory(activity);
  const activityType = String(activity.activityType ?? entry.activityType ?? '');
  const applied = Array.isArray(activity.appliedEnrichments) ? activity.appliedEnrichments : [];
  const appliedSet = new Set(applied);
  const has = (/** @type {string} */ k) => appliedSet.has(P + k);
  const enrichmentsMissing = activity.enrichments === null || activity.enrichments === undefined;
  const en = enrichmentsMissing ? {} : activity.enrichments;
  const sessions = Array.isArray(activity.activityData?.sessions) ? activity.activityData.sessions : [];
  const showPhotos = !!index?.profile?.showPhotoGallery;
  const photos = showPhotos && Array.isArray(activity.photoUrls) ? activity.photoUrls.filter((u) => /^https:\/\//.test(String(u))) : [];
  const siteUrl = (opts.siteUrl || '').replace(/\/+$/, '');

  // Totals from the sessions (falls back to the entry for metadata-only activities).
  const sessionDuration = sessions.reduce((s, x) => s + num(x?.totalElapsedTime), 0);
  const sessionDistance = sessions.reduce((s, x) => s + num(x?.totalDistance), 0);
  const durationS = sessionDuration || num(entry.durationSeconds);
  const distanceM = sessionDistance || num(entry.distanceMeters);
  const allSets = sessions.flatMap((s) => (Array.isArray(s?.strengthSets) ? s.strengthSets : []));
  const sets = allSets.length || num(entry.totalSets);
  const volumeKg = allSets.length ? allSets.reduce((s, x) => s + num(x.reps) * num(x.weightKg), 0) : num(entry.totalWeightKg);
  const reps = allSets.length ? allSets.reduce((s, x) => s + num(x.reps), 0) : num(entry.totalReps);
  const avgBpm = num(en.heartRate?.avgBpm) || num(entry.avgHeartRate) || num(sessions[0]?.avgHeartRate);
  const maxBpm = num(en.heartRate?.maxBpm) || num(sessions[0]?.maxHeartRate);
  const calorieInfo = calorieFigure(activity, entry);
  const calories = calorieInfo.kcal;
  // Hyrox race (F5.2): the export's `race` plus PBs per division across the whole history.
  // FitGlue's division-less hybrid_race_* records are superseded by the per-division ones
  // computed here, so they are dropped from this page.
  const history = opts.hyrox ?? null;
  const description = descriptionPreamble(activity.description);
  const race = buildRaceView(file, history, { words: description });
  const allRecords = has('PERSONAL_RECORDS') && Array.isArray(en.personalRecords?.records) ? en.personalRecords.records : [];
  const records = race ? allRecords.filter((r) => !String(r?.recordType ?? '').startsWith('hybrid_race_')) : allRecords;
  const prCount = records.length + (race ? race.prCount : 0);
  const icon = typeIcon(activityType);
  const title = String(activity.title ?? entry.title ?? 'Activity');
  const bannerUrl = en.aiBanner?.imageUrl && /^https:\/\//.test(en.aiBanner.imageUrl) ? en.aiBanner.imageUrl : '';
  const locationName = String(en.location?.locationName ?? entry.locationName ?? '');
  const boosterCount = applied.length;
  const destinationCount = num(entry.destinationCount);

  // Pre-grid pieces
  const aiSummaryHtml = has('AI_COMPANION') ? sanitizeAiHtml(en.aiSummary?.html) : '';
  const hybrid = has('HYBRID_RACE_TAGGER') && Array.isArray(activity.activityData?.hybridRaceSummary?.segments)
    ? activity.activityData.hybridRaceSummary.segments
    : [];
  const hybridRace = hybrid.length && !race
    ? {
        total: fmtClock(hybrid.reduce((s, x) => s + num(x.durationSeconds), 0)),
        segments: hybrid.map((s) => ({ icon: s.icon || (s.isRun ? '🏃' : '🏋️'), label: s.label || '', duration: fmtClock(s.durationSeconds) || '—', isRun: !!s.isRun })),
      }
    : null;
  const ms = has('DISTANCE_MILESTONES') && en.distanceMilestone && num(en.distanceMilestone.lifetimeDistanceKm) > 0 ? en.distanceMilestone : null;
  const milestone = ms
    ? {
        lifetimeKm: fmtNumber(ms.lifetimeDistanceKm, 1),
        typeLabel: ms.activityTypeLabel || typeLabel(activityType).toLowerCase(),
        nextKm: num(ms.nextMilestoneKm) > ms.lifetimeDistanceKm ? fmtNumber(ms.nextMilestoneKm) : '',
        toGoKm: num(ms.nextMilestoneKm) > ms.lifetimeDistanceKm ? fmtNumber(ms.nextMilestoneKm - ms.lifetimeDistanceKm, 1) : '',
        crossedKm: num(ms.milestoneKm) > 0 ? fmtNumber(ms.milestoneKm) : '',
      }
    : null;
  const tags = Array.isArray(activity.tags) ? activity.tags.filter((t) => typeof t === 'string' && t) : [];
  const route = category === 'cardio-distance' && routePoints.length >= 10 ? routePath(routePoints) : null;
  const routeThumbnailUrl = !route && entry.routeThumbnailUrl && /^https:\/\//.test(entry.routeThumbnailUrl) ? entry.routeThumbnailUrl : '';

  // Page bands
  const pk = has('PARKRUN') && activityType === 'ACTIVITY_TYPE_RUN' && en.parkrun?.eventName ? en.parkrun : null;
  const parkrun = pk
    ? { eventName: pk.eventName, finishTime: pk.finishTime || '—', position: num(pk.position) > 0 ? `#${pk.position}` : '—', ageGrade: pk.ageGrade || '—', totalParkruns: num(pk.totalParkruns) > 0 ? String(pk.totalParkruns) : '', isTimePb: !!pk.isTimePb, isAgeGradePb: !!pk.isAgeGradePb }
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
      message: '',
    };
  } else if (records.length && !race) {
    const top = topPR(records);
    const parsed = parseRecordType(top.recordType);
    const v = prValue(top.newValue, top.unit);
    const extra = records.length - 1;
    prBand = {
      label: parsed.label.toUpperCase(),
      sub: [parsed.prType, 'NEW PERSONAL RECORD', extra > 0 ? `+${extra} MORE RECORD${extra === 1 ? '' : 'S'} BELOW` : ''].filter(Boolean).join(' · '),
      value: v.val,
      unit: v.unit,
      delta: prDelta(top.newValue, top.previousValue, top.unit),
      message: top.displayMessage || '',
    };
  }

  // Hero sparkline: first of HR / power / speed in `series` (same preference as entry.sparkline.metric).
  let heroSpark = null;
  for (const [key, label, map] of [
    ['heartRate', 'heart rate · bpm', (v) => v],
    ['powerW', 'power · W', (v) => v],
    ['speedMs', 'speed · km/h', (v) => (typeof v === 'number' ? v * 3.6 : null)],
  ]) {
    if (Array.isArray(series[key])) {
      const p = sparklinePath(series[key].map(map));
      if (p) {
        heroSpark = { d: p.d, area: p.area, label, min: fmtNumber(p.min, key === 'speedMs' ? 1 : 0), max: fmtNumber(p.max, key === 'speedMs' ? 1 : 0), duration: fmtClock(durationS) };
        break;
      }
    }
  }

  // HR zones from the entry's hrZoneMinutes (index 0 = below Z1, not drawn),
  // names/percentages from the enrichment when it is present. Gate per §4.
  const zoneMinutes = Array.isArray(entry.hrZoneMinutes) && entry.hrZoneMinutes.length === 6 ? entry.hrZoneMinutes : null;
  const zoneSource = Array.isArray(en.heartRateZones?.zones) && en.heartRateZones.zones.length === 6 ? en.heartRateZones.zones : zoneMinutes;
  const hrZones = has('HEART_RATE_ZONES') && zoneSource ? hrZoneBars(zoneSource) : null;

  // Grid modules in §4 order; the set list is its own partial but slots in order.
  const prNames = new Set(records.map((r) => parseRecordType(r.recordType).exercise));
  const setList = category === 'strength' || allSets.length ? groupStrengthSets(allSets, prNames) : null;
  const ctx = { en, series, has, category, activityType, entry, activity, kmSplits: file?.kmSplits, records, calories: calorieInfo };
  const modules = [];
  for (const key of moduleOrderFor(category)) {
    if (key === 'zones') {
      if (hrZones) modules.push({ key, title: 'HR zones', right: `${hrZones.total} min`, zones: hrZones });
      continue;
    }
    if (key === 'set-list') {
      // A race's sets are its splits, which the race breakdown already shows.
      if (setList && !race) modules.push({ key, title: 'Workout', right: setList.right, wide: true, setList });
      continue;
    }
    const m = buildModule(key, ctx);
    if (m) modules.push(m);
  }
  const footerChips = [];
  if (has('AUTO_INCREMENT')) footerChips.push('📈 Series activity');
  if (has('SOURCE_LINK')) footerChips.push(`↗ Linked to ${sourceLabel(activity.source ?? entry.source) || 'source'}`);

  const extraStats = [];
  if (category !== 'cardio-time' && calories > 0) extraStats.push({ value: fmtNumber(calories), unit: 'kcal', label: 'calories' });
  if (num(entry.elevationGainM) > 0) extraStats.push({ value: Math.round(entry.elevationGainM), unit: 'm', label: 'elevation gain' });
  if (category !== 'cardio-time' && maxBpm > 0) extraStats.push({ value: maxBpm, unit: 'bpm', label: 'max hr' });
  if (category === 'strength' && reps > 0 && !race) extraStats.push({ value: fmtNumber(reps), unit: '', label: 'reps' });
  if (category === 'strength' && avgBpm > 0 && !race) extraStats.push({ value: avgBpm, unit: 'bpm', label: 'avg hr' });
  if (typeof entry.tempC === 'number') extraStats.push({ value: `${Math.round(entry.tempC)}°`, unit: 'C', label: entry.weatherDescription ? String(entry.weatherDescription).toLowerCase() : 'temperature' });
  if (destinationCount > 0) extraStats.push({ value: destinationCount, unit: '', label: `destination${destinationCount === 1 ? '' : 's'}`, subtext: 'pushed to' });

  // Race-day context, the event weekend it belongs to, and the PB progression.
  const eventGroup = race ? history?.eventBySlug.get(slug) : undefined;
  const eventLink = eventGroup
    ? {
        url: eventUrl(eventGroup.slug),
        name: eventGroup.name,
        count: eventGroup.slugs.length,
        others: eventGroup.slugs.filter((x) => x !== slug).map((x) => history?.races.get(x)).filter(Boolean).map((r) => ({ url: r.url, title: r.title, total: r.total, division: r.divisionLabel, isPB: r.isPB })),
      }
    : null;
  const weather = en.weather && typeof en.weather.tempC === 'number'
    ? `${Math.round(en.weather.tempC)}°C${en.weather.weatherDescription ? ` · ${String(en.weather.weatherDescription).toLowerCase()}` : ''}`
    : typeof entry.tempC === 'number' ? `${Math.round(entry.tempC)}°C${entry.weatherDescription ? ` · ${String(entry.weatherDescription).toLowerCase()}` : ''}` : '';
  const raceDay = race
    ? [
        { icon: '📍', label: 'venue', value: locationName || race.event },
        { icon: '📅', label: 'race day', value: fmtDateShort(activity.startTime ?? entry.startTime) },
        { icon: '🏷️', label: 'division', value: race.divisionLabel },
        weather ? { icon: '🌡️', label: 'weather', value: weather } : null,
        race.partner ? { icon: '🤝', label: 'partner', value: race.partner } : null,
      ].filter((x) => x && x.value)
    : [];
  // This race against the PB it was chasing, its own division only, history up to it (F5.5).
  const divisionKey = String(file?.race?.division?.key ?? '');
  const chase = race && history && divisionKey && !race.isSimulation ? pbChase(history, divisionKey, [slug]) : null;
  const gallery = photos.map((src, i) => ({ src, id: `photo-${i + 1}`, n: i + 1, prev: `#photo-${i === 0 ? photos.length : i}`, next: `#photo-${i + 2 > photos.length ? 1 : i + 2}`, total: photos.length }));

  const ogDescription = truncate(description || stripTags(aiSummaryHtml) || `${typeLabel(activityType).toLowerCase()} · ${fmtDateShort(activity.startTime ?? entry.startTime)}`, 200);
  const ogImage = (opts.ogCard && /^https?:\/\//.test(opts.ogCard) ? opts.ogCard : '') || bannerUrl || photos[0] || '';
  const canonical = siteUrl ? `${siteUrl}${activityUrl(slug)}` : '';

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
    publishedTime: activity.startTime ?? entry.startTime ?? '',
    atomFeed: FITNESS_FEED_PATH,
    act: {
      slug,
      url: activityUrl(slug),
      canonical,
      title,
      icon,
      typeLabel: hybridRaceLabel(title, { hasRace: !!race, event: race?.event }) || typeLabel(activityType),
      ...activityTheme(activityType),
      category,
      source: sourceLabel(activity.source ?? entry.source),
      dateStamp: fmtDateStamp(activity.startTime ?? entry.startTime),
      dateIso: activity.startTime ?? entry.startTime ?? '',
      prCount,
      bannerUrl,
      bgPhotoUrl: !bannerUrl && photos[0] ? photos[0] : '',
      ...heroLayout(opts.photoDims?.[bannerUrl || photos[0] || '']),
      owner: String(activity.ownerDisplayName ?? index?.profile?.displayName ?? 'James').toUpperCase(),
      boosterCount,
      boosterWord: boosterCount === 1 ? 'BOOSTER' : 'BOOSTERS',
      destinationCount,
      destinationWord: destinationCount === 1 ? 'DESTINATION' : 'DESTINATIONS',
      locationName: locationName.toUpperCase(),
      anchors: race ? raceAnchors(race, avgBpm) : anchorStats({ category, distanceM, durationS, avgBpm, maxBpm, calories, pace: num(en.pace?.avgPaceSecondsPerKm), speedKmh: num(en.speed?.avgSpeedKmh), sets, volumeKg, prCount, icon }),
      extraStats,
      parkrun,
      milestone,
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
      routeThumbnailUrl,
      heroSpark,
      hrZones,
      modules,
      footerChips,
      boosters: boosterTimeline(applied),
      boostersDidNotRun: enrichmentsMissing,
      ogImage,
      ogDescription,
    },
  };
}

// ---------------------------------------------------------------------------
// Handlebars environment + task

/** @param {string} partialsDir */
async function registerPartials(hb, partialsDir) {
  const files = (await fs.readdir(partialsDir)).filter((f) => /\.(html|hbs)$/.test(f));
  for (const f of files) {
    hb.registerPartial(f.replace(/\.(html|hbs)$/, ''), await fs.readFile(path.join(partialsDir, f), 'utf8'));
  }
}

/** A Handlebars instance with the site's partials and the helpers they use. */
export async function createActivityRenderer({ template = DEFAULT_TEMPLATE, partialsDir = DEFAULT_PARTIALS_DIR } = {}) {
  const hb = Handlebars.create();
  hb.registerHelper('eq', (a, b) => a === b);
  hb.registerHelper('times', function (n, options) {
    let out = '';
    for (let i = 0; i < num(n); i++) out += options.fn(i);
    return out;
  });
  await registerPartials(hb, partialsDir);
  const compiled = hb.compile(await fs.readFile(template, 'utf8'));
  return (/** @type {Record<string, unknown>} */ vars) => compiled(vars);
}

/**
 * The Skier task. Runs after fetch-fitness; reads `fitnessActivities` and
 * `fitnessIndex` from globals and writes one page per listed slug.
 * @param {{ template?: string, partialsDir?: string, outDir?: string }} [config]
 */
export function generateActivityPagesTask(config = {}) {
  return {
    name: 'generate-activity-pages',
    title: 'Generate /life/activity/<slug> pages from fitnessActivities',
    config,
    run: async (/** @type {any} */ cfg, /** @type {any} */ ctx) => {
      const outDir = cfg.outDir || DEFAULT_OUT_DIR;
      const activities = Array.isArray(ctx.globals.fitnessActivities) ? ctx.globals.fitnessActivities : [];
      if (!activities.length) {
        ctx.logger.warn('No fitness activities to render (fitnessActivities is empty)');
        return {};
      }
      const render = await createActivityRenderer(cfg);
      const hyrox = buildHyroxHistory(activities);
      let written = 0;
      /** @type {string[]} */
      const slugs = [];
      for (const file of activities) {
        const slug = file?.slug ?? file?.entry?.showcaseId;
        let outPath;
        try {
          outPath = slugToOutPath(slug, outDir);
        } catch (e) {
          ctx.logger.warn(e instanceof Error ? e.message : String(e));
          continue;
        }
        const ogCard = ctx.globals.fitnessOgImages?.activity?.[String(slug)];
        const view = buildActivityView(file, ctx.globals.fitnessIndex, { siteUrl: ctx.globals.siteUrl, ogCard, hyrox, photoDims: ctx.globals.fitnessPhotoDims });
        const html = render({ ...ctx.globals, ...view });
        await fs.mkdir(path.dirname(outPath), { recursive: true });
        await fs.writeFile(outPath, html);
        slugs.push(view.act.slug);
        written++;
        ctx.logger.debug(`Generated ${outPath}`);
      }
      ctx.logger.info(`Activity pages: ${written} written under ${path.join(outDir, 'life', 'activity')}`);
      return { fitnessActivitySlugs: slugs };
    },
  };
}
