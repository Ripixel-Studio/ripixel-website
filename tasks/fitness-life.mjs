// @ts-check
/**
 * `/life` front-page model (S2.2).
 *
 * Everything the page shows is pre-formatted here into one global,
 * `fitnessLife`, and the templates only loop and test (`#if`, `#each`,
 * `#unless`); Skier's generatePagesTask renders personal/pages/life.html. All inputs are
 * the S2.1 globals (`fitnessIndex`, `fitnessActivities`, `fitnessRoundups`,
 * `fitnessUnavailable`), the calendar export `fitnessEvents` (S2.6: the Fitness
 * Events / Fitness Regular Google calendars, exported by the box as
 * `events.json`) and, only when that export is unavailable, the hand-written
 * events list in `personal/items/life/fitness.json`.
 *
 * Time-relative wording (countdowns, the current week, today) lives in
 * life-clock.mjs, which the page also runs in the browser (S6).
 *
 * Field meanings follow jarvis-memory specs/ripixel-website/fitness-zine.md
 * "Data contract (S0)" §2, §6 and §8.
 */
import fs from 'node:fs/promises';
import { TAGS, themeOf, tagOf } from './fitness-theme.mjs';
import {
  TZ, WEEK_DAYS, NEXT_UP_COUNT, DAY_MS, parse, fmt, ymd, dayStamp, rangeLabel, countdown, weekMonday, weekKicker,
  calendarModel, renderCalendar, clientScript, publicEvent,
} from './life-clock.mjs';
import { resolveOptions } from './fitness-fetch.mjs';
import { recordLabel, latestRecords } from './fitness-records.mjs';
import { routePath } from './fitness-activity-views.mjs';
import { buildHyroxHistory, hyroxWall } from './fitness-hyrox.mjs';
import { buildRacePbs, absorbedEfforts, RACE_PBS_ANCHOR } from './fitness-race-pbs.mjs';

export const DEFAULT_EVENTS_FILE = 'personal/items/life/fitness.json';
export const ACTIVITY_HREF = '/life/activity';
export const ROUNDUP_HREF = '/life/roundup';
export const ROUNDUPS_HREF = '/life/roundups';
export const SESSIONS_HREF = '/life/sessions';
export const CARD_COUNT = 6;
export { TZ, WEEK_DAYS, NEXT_UP_COUNT, countdown, dayStamp, rangeLabel };

// ---------------------------------------------------------------------------
// Formatting

/** @param {number} n */
function thousands(n) {
  return Math.round(n).toLocaleString('en-GB');
}

/** Kilometres from metres: one decimal under 100 km, none above. @param {number} m */
export function km(m) {
  const v = m / 1000;
  if (v >= 100) return thousands(v);
  return (Math.round(v * 10) / 10).toFixed(1).replace(/\.0$/, '');
}

/** `19:52`, `1:13:00`. @param {number} s */
export function clock(s) {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(h ? 2 : 1, '0');
  const ss = String(sec).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** `57m`, `1h 13m`, `540h`. @param {number} s */
export function duration(s) {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  if (h >= 100) return `${thousands(s / 3600)}h`;
  if (h) return m ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

/** Weight moved: `6,286 kg` under 10 t, else `2,432 t`. @param {number} kg */
export function tonnage(kg) {
  if (kg >= 10_000) return { value: thousands(kg / 1000), unit: 't' };
  return { value: thousands(kg), unit: 'kg' };
}

/** @param {number} kgv */
function kgLabel(kgv) {
  const r = Math.round(kgv * 10) / 10;
  return `${r.toFixed(1).replace(/\.0$/, '')} kg`;
}

/** `17 OCT 2026` @param {Date} d */
function longDate(d) {
  return fmt(d, { day: 'numeric', month: 'short', year: 'numeric' }).toUpperCase();
}

/** `APR 2025` @param {Date} d */
function monthYear(d) {
  return fmt(d, { month: 'short', year: 'numeric' }).toUpperCase();
}

/**
 * What I do, from what I have actually done: the activity tags with at least `min`
 * sessions in the last `days`, most sessions first, at most 5, as title-cased labels.
 * Replaces FitGlue's hand-set `profile.subtitle`, which went stale.
 * @param {any[]} activities index entries ({activityType, startTime})
 * @param {Date} now
 * @param {number} [days] @param {number} [min]
 * @returns {string[]}
 */
export function whatIDo(activities, now, days = 90, min = 2) {
  const from = now.getTime() - days * 86_400_000;
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const e of Array.isArray(activities) ? activities : []) {
    const t = Date.parse(e?.startTime);
    if (!Number.isFinite(t) || t < from || t > now.getTime()) continue;
    const label = TAGS[tagOf(e).tag].label;
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return [...counts].filter(([, n]) => n >= min).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([l]) => l);
}

/** `SOURCE_PARKRUN_RESULTS` → `Parkrun Results` @param {string|undefined} s */
export function sourceLabel(s) {
  return String(s || '').replace(/^SOURCE_/, '').toLowerCase().replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Which three metrics a card shows (§8 "three metrics by family"), from the activity's tag:
 * distance for runs, rides and walks, sets and weight for strength, time for the rest.
 * @param {any} e
 * @returns {'distance'|'strength'|'other'}
 */
export function metricFamilyOf(e) {
  const { tag } = tagOf(e);
  if (tag === 'run' || tag === 'ride' || tag === 'walk') return 'distance';
  if (tag === 'strength' || (Number(e?.totalSets) || 0) > 1) return 'strength';
  return 'other';
}

// ---------------------------------------------------------------------------
// Effort levels (§6 dayEntries rule, used for the no-roundup fallback)

/** @param {any} e */
export function effortLevelOf(e) {
  const z = Array.isArray(e.hrZoneMinutes) ? e.hrZoneMinutes : [];
  const z1to5 = z.slice(1, 6).reduce((a, b) => a + (Number(b) || 0), 0);
  if (z1to5 > 10) {
    const z5 = (Number(z[5]) || 0) / z1to5;
    const z45 = ((Number(z[4]) || 0) + (Number(z[5]) || 0)) / z1to5;
    const z12 = ((Number(z[1]) || 0) + (Number(z[2]) || 0)) / z1to5;
    if (z5 > 0.15) return 4;
    if (z45 > 0.25) return 3;
    if (z12 > 0.7) return 1;
    return 2;
  }
  const min = (Number(e.durationSeconds) || 0) / 60;
  if (min >= 120) return 4;
  if (min >= 75) return 3;
  if (min >= 30) return 2;
  if (min > 0) return 1;
  return 0;
}

const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const STRIP = { colW: 40, barW: 28, baseY: 56, unit: 12, pad: 6, vbH: 72 };

/** Effort axis beside the strip: 0, 2 and 4 at the height a bar of that level reaches (percent of the viewBox). */
export const STRIP_AXIS = {
  caption: 'effort, 0–4',
  ticks: [4, 2, 0].map((level) => ({ label: String(level), pct: Math.round(((STRIP.baseY - level * STRIP.unit) / STRIP.vbH) * 10000) / 100 })),
};

/**
 * Seven strip bars for [start, start+7d). `levels` maps YYYY-MM-DD → {level, count}.
 * Coordinates are precomputed so the template is a plain `#each`.
 * @param {Date} start  UTC midnight (roundup periodStart) or a site-local day
 * @param {Map<string, {level: number, count: number, typeKey?: string}>} levels
 */
export function stripDays(start, levels) {
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start.getTime() + i * 86_400_000);
    const key = ymd(d);
    const hit = levels.get(key) || { level: 0, count: 0 };
    const level = Math.max(0, Math.min(4, hit.level));
    const h = level ? level * STRIP.unit : 3;
    const typeKey = level && hit.typeKey ? hit.typeKey : '';
    days.push({
      key,
      letter: DAY_LETTERS[i],
      label: fmt(d, { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', ''),
      level,
      levelClass: `fit-strip__bar--l${level}${typeKey ? ` fit-type--${typeKey}` : ''}`,
      typeKey,
      count: hit.count,
      sessions: hit.count === 1 ? '1 session' : `${hit.count} sessions`,
      x: i * STRIP.colW + STRIP.pad,
      y: STRIP.baseY - h,
      h,
      textX: i * STRIP.colW + STRIP.colW / 2,
    });
  }
  return days;
}

/** @param {{ sessions: number, seconds: number, metres: number, kg: number, kcal: number, elevation: number }} t */
function weekStats(t) {
  const out = [
    { value: String(t.sessions), unit: '', label: t.sessions === 1 ? 'session' : 'sessions' },
    { value: duration(t.seconds), unit: '', label: 'on the clock' },
  ];
  if (t.metres > 500) out.push({ value: km(t.metres), unit: 'km', label: 'covered' });
  if (t.kg > 0) {
    const w = tonnage(t.kg);
    out.push({ value: w.value, unit: w.unit, label: 'moved' });
  }
  if (out.length < 4 && t.kcal > 0) out.push({ value: thousands(t.kcal), unit: 'kcal', label: 'burned' });
  if (out.length < 4 && t.elevation > 50) out.push({ value: thousands(t.elevation), unit: 'm', label: 'climbed' });
  return out.slice(0, 4);
}

/**
 * The family of each site-local day's longest session, `YYYY-MM-DD` → type key:
 * the effort strip colours a day's bar by it.
 * @param {any} index
 */
export function dominantTypes(index) {
  /** @type {Map<string, {typeKey: string, secs: number}>} */
  const best = new Map();
  for (const e of index?.activities || []) {
    const t = parse(e?.startTime);
    if (!t) continue;
    const key = ymd(t);
    const secs = Number(e.durationSeconds) || 0;
    const cur = best.get(key);
    if (!cur || secs > cur.secs) best.set(key, { typeKey: tagOf(e).tag, secs });
  }
  return new Map([...best].map(([k, v]) => [k, v.typeKey]));
}

/**
 * "This week" block: latest weekly roundup, else the 7 days ending on the
 * latest activity, else null.
 * @param {any} index @param {any[]} roundupFiles @param {Date} now
 */
export function buildWeek(index, roundupFiles, now) {
  const weekly = (roundupFiles || []).find((r) => r?.roundup?.periodType === 'ROUNDUP_PERIOD_TYPE_WEEK');
  if (weekly) {
    const r = weekly.roundup;
    const start = parse(r.periodStart);
    const end = parse(r.periodEnd);
    if (start && end) {
      const levels = new Map();
      const types = dominantTypes(index);
      for (const d of r.dayEntries || []) {
        if (d && typeof d.date === 'string') {
          levels.set(d.date, {
            level: Number(d.effortLevel) || 0, count: Number(d.activityCount) || 0, typeKey: types.get(d.date),
          });
        }
      }
      const days = stripDays(start, levels);
      const weekNo = String(r.periodKey || weekly.key || '').match(/^week-(\d+)-/)?.[1];
      const kg = (r.activityTypeBreakdowns || []).reduce((a, b) => a + (Number(b?.totalWeightKg) || 0), 0);
      return {
        mode: 'roundup',
        kicker: weekKicker(start, end, now),
        // The page script re-checks the kicker against the reader's clock.
        kickerStart: start.toISOString(),
        kickerEnd: end.toISOString(),
        title: weekNo ? `WEEK ${Number(weekNo)}` : 'THE WEEK',
        range: rangeLabel(start, end),
        href: `${ROUNDUP_HREF}/${encodeURIComponent(r.periodKey || weekly.key)}`,
        days,
        yAxis: STRIP_AXIS,
        activeDays: days.filter((d) => d.count > 0).length,
        stats: weekStats({
          sessions: Number(r.totalActivities) || 0,
          seconds: Number(r.totalDurationSeconds) || 0,
          metres: Number(r.totalDistanceMeters) || 0,
          kg,
          kcal: Number(r.totalCaloriesKcal) || 0,
          elevation: Number(r.totalElevationGainMeters) || 0,
        }),
      };
    }
  }

  const entries = (index?.activities || []).filter((e) => parse(e?.startTime));
  if (!entries.length) return null;
  const latest = entries.reduce((a, b) => (parse(b.startTime).getTime() > parse(a.startTime).getTime() ? b : a));
  // Window: the 7 site-local days ending on the latest activity's day.
  const lastKey = ymd(parse(latest.startTime));
  const [y, m, d] = lastKey.split('-').map(Number);
  // Anchor at local noon so DST shifts cannot move a day across midnight.
  const lastNoon = new Date(Date.UTC(y, m - 1, d, 12));
  const startNoon = new Date(lastNoon.getTime() - 6 * 86_400_000);
  const endExcl = new Date(lastNoon.getTime() + 86_400_000);
  const levels = new Map();
  const tot = { sessions: 0, seconds: 0, metres: 0, kg: 0, kcal: 0, elevation: 0 };
  for (const e of entries) {
    const key = ymd(parse(e.startTime));
    if (key < ymd(startNoon) || key > lastKey) continue;
    const cur = levels.get(key) || { level: 0, count: 0 };
    levels.set(key, { level: Math.max(cur.level, effortLevelOf(e)), count: cur.count + 1 });
    tot.sessions += 1;
    tot.seconds += Number(e.durationSeconds) || 0;
    tot.metres += Number(e.distanceMeters) || 0;
    tot.kg += Number(e.totalWeightKg) || 0;
    tot.kcal += Number(e.caloriesKcal) || 0;
    tot.elevation += Number(e.elevationGainM) || 0;
  }
  const types = dominantTypes(index);
  for (const [k, v] of levels) v.typeKey = types.get(k);
  const days = stripDays(startNoon, levels);
  return {
    mode: 'activities',
    kicker: 'LAST 7 DAYS',
    title: 'THE WEEK',
    range: rangeLabel(startNoon, endExcl),
    href: null,
    days,
    yAxis: STRIP_AXIS,
    activeDays: days.filter((x) => x.count > 0).length,
    stats: weekStats(tot),
  };
}

// ---------------------------------------------------------------------------
// Activity cards

/** @param {unknown} u */
function httpsUrl(u) {
  return typeof u === 'string' && /^https:\/\//.test(u) ? u : '';
}

/** Route points thinned to at most `max` (first and last kept). @param {any[]} pts @param {number} max */
function thin(pts, max) {
  if (pts.length <= max) return pts;
  const step = (pts.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => pts[Math.round(i * step)]);
}

/**
 * The picture for a card: the activity's first photo, else its exported route
 * thumbnail, else a route drawn from the activity file's GPS points, else a
 * type-coloured placeholder. Exactly one of `photo`, `route`, `placeholder` is set.
 * @param {any} e index entry @param {any} [file] the full activity file, when loaded
 */
export function cardPicture(e, file) {
  const photos = (Array.isArray(e.photoUrls) ? e.photoUrls : []).map(httpsUrl).filter(Boolean);
  const thumb = httpsUrl(e.routeThumbnailUrl);
  const img = photos[0] || thumb;
  if (img) {
    return {
      photo: img, isPhoto: Boolean(photos[0]), route: null, placeholder: false,
      photoCount: photos.length > 1 ? `+${photos.length - 1}` : '',
      pictureClass: 'fit-photo--photo',
    };
  }
  const pts = Array.isArray(file?.routePoints) ? file.routePoints : [];
  const r = pts.length >= 10 ? routePath(thin(pts, 120), { size: 200, pad: 6 }) : null;
  if (r) {
    return {
      photo: '', isPhoto: false, route: { d: r.d, w: r.w, h: r.h, start: r.start, end: r.end },
      placeholder: false, photoCount: '', pictureClass: 'fit-photo--route',
    };
  }
  return { photo: '', isPhoto: false, route: null, placeholder: true, photoCount: '', pictureClass: 'fit-photo--placeholder' };
}

/**
 * The one stat a session tile shows: distance for distance sports, weight
 * moved for lifting, else time on the clock.
 * @param {string} family @param {{value: string, unit: string, label: string}[]} stats
 */
function keyStatOf(family, stats) {
  const want = family === 'distance' ? 'distance' : family === 'strength' ? 'moved' : 'time';
  return stats.find((x) => x.label === want) || stats.find((x) => x.label === 'time') || stats[0] || null;
}

/** @param {any} e index entry @param {any} [file] full activity file (for the route) */
export function buildCard(e, file) {
  const family = metricFamilyOf(e);
  const theme = themeOf(e);
  const start = parse(e.startTime);
  /** @type {{value: string, unit: string, label: string}[]} */
  const stats = [];
  const dist = Number(e.distanceMeters) || 0;
  const dur = Number(e.durationSeconds) || 0;
  const bpm = Number(e.avgHeartRate) || 0;
  const kcal = Number(e.caloriesKcal) || 0;
  const sets = Number(e.totalSets) || 0;
  const kg = Number(e.totalWeightKg) || 0;
  const push = (/** @type {boolean} */ ok, /** @type {string} */ value, /** @type {string} */ unit, /** @type {string} */ label) => {
    if (ok && stats.length < 3) stats.push({ value, unit, label });
  };
  if (family === 'distance') {
    push(dist > 0, km(dist), 'km', 'distance');
    push(dur > 0, duration(dur), '', 'time');
    push(bpm > 0, String(bpm), 'bpm', 'avg hr');
    push(kcal > 0, thousands(kcal), 'kcal', 'burned');
  } else if (family === 'strength') {
    push(sets > 1, String(sets), '', 'sets');
    const w = tonnage(kg);
    push(kg > 0, w.value, w.unit, 'moved');
    push(dur > 0, duration(dur), '', 'time');
    push(kcal > 0, thousands(kcal), 'kcal', 'burned');
  } else {
    push(dur > 0, duration(dur), '', 'time');
    push(kcal > 0, thousands(kcal), 'kcal', 'burned');
    push(bpm > 0, String(bpm), 'bpm', 'avg hr');
  }
  const thumb = httpsUrl(e.routeThumbnailUrl);
  return {
    slug: e.slug,
    href: `${ACTIVITY_HREF}/${encodeURIComponent(e.slug)}`,
    title: e.title || 'Untitled activity',
    date: start ? dayStamp(start) : '',
    dateTime: start ? start.toISOString() : '',
    typeLabel: theme.tagLabel.toUpperCase(),
    ...theme,
    source: sourceLabel(e.source),
    glyph: theme.tagGlyph,
    family,
    stats,
    keyStat: keyStatOf(family, stats),
    prLabel: typeof e.prLabel === 'string' && e.prLabel ? e.prLabel : '',
    thumb,
    hasThumb: Boolean(thumb),
    ...cardPicture(e, file),
    pictureWord: theme.tagLabel,
    location: typeof e.locationName === 'string' ? e.locationName : '',
  };
}

// ---------------------------------------------------------------------------
// Roundup teaser

/** @param {any} summary index.roundups[i] @param {any|undefined} file matching roundup file */
export function buildRoundupTeaser(summary, file) {
  if (!summary || typeof summary.key !== 'string') return null;
  const start = parse(summary.periodStart);
  const end = parse(summary.periodEnd);
  const type = String(summary.periodType || '').replace(/^ROUNDUP_PERIOD_TYPE_/, '');
  const m = summary.key.match(/^(week|month|year)-(\d+)(?:-(\d+))?$/);
  let kindLabel = 'ROUNDUP';
  let periodLabel = summary.key;
  if (type === 'WEEK' || m?.[1] === 'week') {
    kindLabel = 'WEEKLY ROUNDUP';
    periodLabel = m ? `Week ${Number(m[2])} · ${m[3]}` : summary.key;
  } else if (type === 'MONTH' || m?.[1] === 'month') {
    kindLabel = 'MONTHLY ROUNDUP';
    periodLabel = start ? fmt(start, { month: 'long', year: 'numeric' }).toUpperCase() : summary.key;
  } else if (type === 'YEAR' || m?.[1] === 'year') {
    kindLabel = 'YEAR IN REVIEW';
    periodLabel = m ? m[2] : summary.key;
  }
  const sessions = Number(summary.totalActivities) || 0;
  const metres = Number(summary.totalDistanceMeters) || 0;
  const kg = Number(summary.totalWeightKg) || 0;
  let secondary;
  if (metres > 500) secondary = { value: km(metres), unit: 'km', label: 'covered' };
  else if (summary.hasStrength && kg > 0) {
    const w = tonnage(kg);
    secondary = { value: w.value, unit: w.unit, label: 'moved' };
  } else secondary = { value: duration(Number(summary.totalDurationSeconds) || 0), unit: '', label: 'on the clock' };
  const prCount = Number(summary.prCount) || 0;
  const raw = typeof file?.roundup?.aiSummary === 'string' ? file.roundup.aiSummary.trim() : '';
  let summaryText = raw;
  if (summaryText.length > 280) {
    summaryText = summaryText.slice(0, 280).replace(/\s+\S*$/, '') + '…';
  }
  return {
    key: summary.key,
    href: `${ROUNDUP_HREF}/${encodeURIComponent(summary.key)}`,
    kindLabel,
    periodLabel,
    range: start && end ? rangeLabel(start, end) : '',
    sessions: String(sessions),
    sessionsLabel: sessions === 1 ? 'session' : 'sessions',
    secondary,
    prs: prCount > 0 ? `+${prCount} PR${prCount === 1 ? '' : 'S'}` : '',
    summary: summaryText,
    hasSummary: Boolean(summaryText),
  };
}

// ---------------------------------------------------------------------------
// Lifetime stats, streaks, PBs

/** @param {number} v @param {string} unit */
function prDisplay(v, unit) {
  if (unit === 'seconds') return clock(v);
  if (unit === 'meters') return `${km(v)} km`;
  if (unit === 'kg') return kgLabel(v);
  return `${Math.round(v * 10) / 10} ${unit}`.trim();
}

/** @param {any} pr ShowcaseTopPR */
export function buildPr(pr) {
  const label = recordLabel(pr?.recordType);
  const unit = String(pr?.unit || '');
  const value = Number(pr?.value) || 0;
  const prev = pr?.previousValue == null ? null : Number(pr.previousValue);
  const display = prDisplay(value, unit);
  let delta = '';
  const tiny = unit === 'seconds' ? 0.5 : 0.05; // a sub-second "improvement" would print as −0s
  if (prev != null && Number.isFinite(prev) && Math.abs(prev - value) >= tiny) {
    const diff = value - prev;
    const sign = diff > 0 ? '+' : '−';
    const abs = Math.abs(diff);
    if (unit === 'seconds') delta = `${sign}${abs >= 60 ? clock(abs) : `${Math.round(abs)}s`}`;
    else if (unit === 'kg') delta = `${sign}${kgLabel(abs)}`;
    else if (unit === 'meters') delta = `${sign}${km(abs)} km`;
    else delta = `${sign}${Math.round(abs * 10) / 10}`;
  }
  const at = parse(pr?.achievedAt);
  return {
    name: label.name, metric: label.metric, metricKey: label.metricKey, group: label.group, race: label.race,
    order: label.order, display, unit, value, delta,
    improved: delta && prev != null ? (unit === 'seconds' ? value < prev : value > prev) : false,
    date: at ? longDate(at) : '',
    ts: at ? at.getTime() : 0,
  };
}

/** Distances the front page shows, in order; anything else is on the activity / roundup pages. */
const RUN_PBS = ['1K', '1 MILE', '5K', '10K', 'HALF MARATHON', 'MARATHON', 'LONGEST RUN'];
const RIDE_PBS = ['10K', '20K', '40K', '50K', '100K', 'LONGEST RIDE'];
const IRON_COUNT = 8;
/** Strength metrics on the wall, in display order: the two that are weight actually lifted. */
const IRON_METRICS = ['heaviest', '1rm'];

/**
 * The training bests, grouped by kind of record, then by exercise:
 *   ON FOOT (fastest standard distances + longest run), ON THE BIKE,
 *   IRON (one tile per exercise carrying its heaviest lift and est. 1RM together,
 *   heaviest exercises first).
 * Volume and rep records stay on the activity and roundup pages. Hyrox bests live on
 * the race board (personalBestsModel), per division, with their splits. FitGlue's
 * division-less `hybrid_race_hyrox_*` records mixed doubles with solo, so they are
 * not used.
 * @param {any[]} prs  current records (see latestRecords)
 */
export function buildPbBoard(prs) {
  const all = (Array.isArray(prs) ? prs : []).map(buildPr);
  /** @param {string} g @param {string[]} keep */
  const pick = (g, keep) => keep
    .map((name) => all.find((p) => p.group === g && p.name === name))
    .filter(Boolean)
    .map((p) => tile(/** @type {any} */ (p).name, [/** @type {any} */ (p)]));
  /** @param {string} name @param {any[]} metrics */
  const tile = (name, metrics) => {
    const latest = metrics.reduce((a, b) => (b.ts > a.ts ? b : a));
    return {
      name,
      metrics: metrics.map(({ metric, display, delta, improved }) => ({ metric, display, delta, improved })),
      single: metrics.length === 1,
      date: latest.date,
    };
  };

  /** @type {Map<string, any[]>} */
  const byExercise = new Map();
  for (const p of all) {
    if (p.group !== 'strength' || !IRON_METRICS.includes(p.metricKey)) continue;
    const k = p.name.toLowerCase();
    byExercise.set(k, [...(byExercise.get(k) || []), p]);
  }
  const iron = [...byExercise.values()]
    .map((ms) => ms.sort((a, b) => IRON_METRICS.indexOf(a.metricKey) - IRON_METRICS.indexOf(b.metricKey)))
    .sort((a, b) => Math.max(...b.map((m) => m.value)) - Math.max(...a.map((m) => m.value)))
    .slice(0, IRON_COUNT)
    .map((ms) => tile(ms[0].name, ms));

  const groups = [
    { key: 'run', title: 'on foot', typeClass: 'fit-type--run', tiles: pick('run', RUN_PBS) },
    { key: 'ride', title: 'on the bike', typeClass: 'fit-type--ride', tiles: pick('ride', RIDE_PBS) },
    { key: 'iron', title: 'iron · heaviest lift & est. 1RM', typeClass: 'fit-type--strength', tiles: iron },
  ].filter((g) => g.tiles.length > 0);
  return groups;
}

/**
 * @param {any} index @param {any[]} [roundupFiles] every roundup file: their prsAchieved fill in the PB wall
 * @param {any[]} [activityFiles] every activity file (unused by the stats themselves)
 */
export function buildStats(index, roundupFiles = [], activityFiles = [], now = new Date()) {
  const p = index?.profile || {};
  const streaks = index?.streaks || { currentWeeks: 0, longestWeeks: 0 };
  const sh = p.streakHistory || null;
  const tracked = Number(sh?.weeksTracked) || 0;
  const missed = Number(sh?.missedWeeks) || 0;
  const weekly = Array.isArray(sh?.weeklyActive) ? sh.weeklyActive.slice(-52) : [];
  const hours = (Number(p.totalDurationSeconds) || 0) / 3600;

  const strip = [
    { value: thousands(Number(p.totalActivities) || 0), unit: '', label: 'activities' },
    { value: km(Number(p.totalDistanceMeters) || 0), unit: 'km', label: 'covered' },
    { value: thousands(hours), unit: 'h', label: 'on the clock' },
    {
      value: String(Number(streaks.currentWeeks) || 0), unit: 'wk',
      label: 'current streak', sub: `longest ${Number(streaks.longestWeeks) || 0} wk`,
    },
  ];
  if (tracked > 0) {
    strip.push({
      value: `${tracked - missed}/${tracked}`, unit: '',
      label: 'weeks active', sub: missed === 1 ? '1 week missed' : `${missed} weeks missed`,
    });
  }

  const zones = Array.isArray(p.zoneSplit?.zones) ? p.zoneSplit.zones : [];
  const effortShare = zones
    .filter((z) => Number(z?.zoneIndex) >= 2)
    .reduce((a, z) => a + (Number(z?.percentage) || 0), 0);

  const sets = Number(p.totalSets) || 0;
  const reps = Number(p.totalReps) || 0;
  const kg = Number(p.totalWeightKg) || 0;
  const w = tonnage(kg);
  const firstActivity = (index?.activities || [])
    .map((/** @type {any} */ e) => parse(e?.startTime))
    .filter(Boolean)
    .reduce((/** @type {Date|null} */ a, /** @type {Date} */ b) => (!a || b < a ? b : a), null);
  const since = parse(p.createdAt) || firstActivity;
  const last = parse(p.latestActivityAt);
  const prGroups = buildPbBoard(latestRecords(
    ...(roundupFiles || []).map((f) => f?.roundup?.prsAchieved),
    p.topPrs,
  ));

  return {
    strip,
    stripClass: strip.length === 5 ? 'stat-strip--5' : '',
    consistency: {
      weeks: weekly.map((a, i) => ({
        active: Boolean(a),
        label: `${weekly.length - i} week${weekly.length - i === 1 ? '' : 's'} ago`,
      })),
      hasWeeks: weekly.length > 0,
      tracked,
      missed,
      label: tracked ? `${tracked - missed} of the last ${tracked} weeks active` : '',
    },
    zone: {
      label: typeof p.zoneSplit?.label === 'string' ? p.zoneSplit.label : '',
      effortShare: effortShare > 0 ? `${Math.round(effortShare)}%` : '',
      has: Boolean(p.zoneSplit?.label) || effortShare > 0,
    },
    strength: {
      has: sets > 0,
      sets: thousands(sets),
      reps: thousands(reps),
      moved: `${w.value} ${w.unit}`,
    },
    prGroups,
    hasPrs: prGroups.length > 0,
    since: since ? monthYear(since) : '',
    lastActive: last ? longDate(last) : '',
    whatIDo: whatIDo(index?.activities || [], now),
    bio: typeof p.bio === 'string' ? p.bio : '',
  };
}

// ---------------------------------------------------------------------------
// On the calendar (S2.6, S6)
//
// `events.json` from the bucket is the Fitness Events (races, one-offs; 120 days)
// and Fitness Regular (recurring sessions; 21 days) calendars, one sorted list
// with `calendar: 'events'|'regular'` and `kind: race|other|class|session`.
// The hand-written list in fitness.json is only the fallback when that export
// is unavailable. The model and the markup are life-clock.mjs's, shared with
// the page's inline script: the build bakes them with its own `now` (the no-JS
// fallback) and the page renders them again with the reader's clock and a
// fresh events.json, so a calendar change needs no rebuild.

/**
 * The hand-written fitness.json events in the export's shape (all-day, Events
 * calendar, `race` when the tag says so).
 * @param {any[]} handwritten
 */
export function handwrittenEvents(handwritten) {
  return (Array.isArray(handwritten) ? handwritten : [])
    .filter((e) => e && typeof e.title === 'string' && typeof e.date === 'string')
    .map((e) => {
      const start = parse(`${e.date}T00:00:00Z`);
      if (!start) return null;
      return {
        id: '',
        calendar: 'events',
        title: e.title,
        start: start.toISOString(),
        end: new Date(start.getTime() + DAY_MS).toISOString(),
        allDay: true,
        kind: /\brace\b/i.test(String(e.tag || '')) ? 'race' : 'other',
        location: '',
        description: [e.tag, e.description].filter((x) => typeof x === 'string' && x).join(' — '),
      };
    })
    .filter(Boolean);
}

/**
 * An index entry as a logged session for the week strip, pre-themed so the
 * page script needs no type tables: `{start, title, href, typeClass, typeKey}`.
 * @param {any} e
 */
export function doneEntry(e) {
  const theme = themeOf(e);
  return {
    start: e.startTime,
    title: e.title || theme.tagLabel,
    href: `${ACTIVITY_HREF}/${encodeURIComponent(e.slug)}`,
    typeClass: theme.typeClass,
    typeKey: theme.typeKey,
  };
}

/**
 * The "on the calendar" block at `now`, plus what the page needs to redo it:
 * `html` (the baked section) and `data` (`{builtAt, source, events, done,
 * eventsUrl}`, embedded as JSON). `done` keeps the sessions from the Monday a
 * week before this one, so a page up to a week old still fills its strip.
 * @param {any} exported   events.json object or null
 * @param {any[]} handwritten  fitness.json events
 * @param {Date} now
 * @param {any[]} [activities] index entries, for the days already done
 * @param {string} [eventsUrl] where the page fetches a fresh events.json ('' = never)
 */
export function buildCalendar(exported, handwritten, now, activities = [], eventsUrl = '') {
  const hasExport = Boolean(exported && Array.isArray(exported.events));
  const since = ymd(new Date(weekMonday(now).getTime() - WEEK_DAYS * DAY_MS));
  const done = (Array.isArray(activities) ? activities : [])
    .filter((e) => e && typeof e.slug === 'string' && parse(e.startTime) && ymd(/** @type {Date} */ (parse(e.startTime))) >= since)
    .map(doneEntry);
  const data = {
    builtAt: now.toISOString(),
    source: hasExport ? 'calendar' : 'handwritten',
    events: (hasExport ? exported.events : handwrittenEvents(handwritten)).map(publicEvent),
    done,
    eventsUrl,
  };
  const model = calendarModel(data, now);
  return { ...model, html: renderCalendar(model), data };
}

/** The calendar data as JSON safe inside a script element. @param {any} data */
export function scriptJson(data) {
  return JSON.stringify(data).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

const CLOCK_SOURCE = new URL('./life-clock.mjs', import.meta.url);

// ---------------------------------------------------------------------------
// Assembly

/**
 * @param {{ index: any, activities?: any[], roundups?: any[], events?: any[], calendar?: any, unavailable?: boolean, now?: Date }} input
 *   `events` is the hand-written list (fallback only); `calendar` the events.json object or null;
 *   `activities` the full activity files (their route points draw a card's picture when it has no photo).
 */
export function buildLifeModel({ index, activities = [], roundups = [], events = [], calendar = null, unavailable = false, now = new Date(), eventsUrl = '' }) {
  const idx = index || { activities: [], roundups: [], profile: null, streaks: { currentWeeks: 0, longestWeeks: 0 } };
  const entries = Array.isArray(idx.activities) ? idx.activities.filter((e) => e && typeof e.slug === 'string') : [];
  const sorted = [...entries].sort(
    (a, b) => (parse(b.startTime)?.getTime() || 0) - (parse(a.startTime)?.getTime() || 0),
  );
  const summaries = Array.isArray(idx.roundups) ? idx.roundups.filter((r) => r && typeof r.key === 'string') : [];
  const latestSummary = summaries[0] || null;
  const latestFile = latestSummary ? roundups.find((f) => f?.key === latestSummary.key) : undefined;

  const files = filesBySlug(activities);
  const available = !unavailable && entries.length > 0;
  const stats = available ? buildStats(idx, roundups, activities, now) : null;
  return {
    available,
    hasData: entries.length > 0,
    week: available ? buildWeek(idx, roundups, now) : null,
    activities: sorted.slice(0, CARD_COUNT).map((e) => buildCard(e, files.get(e.slug))),
    sessionsHref: SESSIONS_HREF,
    hasActivities: sorted.length > 0,
    activityCount: entries.length,
    moreActivities: Math.max(0, entries.length - CARD_COUNT),
    roundup: available ? buildRoundupTeaser(latestSummary, latestFile) : null,
    roundupsHref: ROUNDUPS_HREF,
    roundupCount: summaries.length,
    hasRoundups: summaries.length > 0,
    stats,
    personalBests: stats ? personalBestsModel(activities, stats.prGroups) : null,
    calendar: buildCalendar(calendar, events, now, available ? entries : [], eventsUrl),
  };
}

/**
 * Personal bests, one section in two halves so no number shows twice:
 *   races: the race board (tasks/fitness-race-pbs.mjs), with each Hyrox division's best
 *     splits and each road distance's best effort folded into its row;
 *   training: the wall's remaining tiles (buildPbBoard) minus the on-foot distances a
 *     road race row has taken over.
 * Null when neither half has anything.
 * @param {any[]} activities
 * @param {ReturnType<typeof buildPbBoard>} [wall]
 */
export function personalBestsModel(activities, wall = []) {
  const run = wall.find((g) => g.key === 'run');
  const efforts = (run?.tiles || []).map((t) => ({ name: t.name, display: t.metrics[0]?.display ?? '', date: t.date }));
  const groups = buildRacePbs(activities, { hyroxSplits: hyroxWall(buildHyroxHistory(activities)), efforts });
  const taken = absorbedEfforts(groups);
  const training = wall
    .map((g) => (g.key === 'run' ? { ...g, tiles: g.tiles.filter((t) => !taken.has(t.name.toLowerCase())) } : g))
    .filter((g) => g.tiles.length > 0);
  if (!groups.length && !training.length) return null;
  return {
    anchor: RACE_PBS_ANCHOR, racesHref: `${SESSIONS_HREF}/race`,
    groups, hasRaces: groups.length > 0, training, hasTraining: training.length > 0,
  };
}

/** Activity files by slug. @param {any[]} activities */
export function filesBySlug(activities) {
  /** @type {Map<string, any>} */
  const m = new Map();
  for (const f of Array.isArray(activities) ? activities : []) {
    const slug = f?.slug || f?.indexEntry?.slug;
    if (typeof slug === 'string') m.set(slug, f);
  }
  return m;
}

/** @param {string} file @param {{ warn(m: string): void }} logger */
export async function readEvents(file, logger) {
  try {
    const data = JSON.parse(await fs.readFile(file, 'utf8'));
    return Array.isArray(data?.events) ? data.events : [];
  } catch (e) {
    logger.warn(`${file}: ${e instanceof Error ? e.message : String(e)}; no events`);
    return [];
  }
}

/**
 * The Skier task. Must run after `fetchFitnessTask` and before page generation.
 * The page fetches a fresh events.json from the same bucket the build read, but
 * only when the build read live data: a fixtures build stays a fixtures page.
 * @param {{ eventsFile?: string, now?: Date, eventsUrl?: string }} [config]
 */
export function fitnessLifeTask(config = {}) {
  return {
    name: 'fitness-life',
    title: 'Build the /life fitness front-page model',
    config,
    run: async (/** @type {any} */ cfg, /** @type {any} */ ctx) => {
      const g = ctx.globals || {};
      const events = await readEvents(cfg.eventsFile || DEFAULT_EVENTS_FILE, ctx.logger);
      const live = g.fitnessSource === 'live' || g.fitnessSource === 'cache';
      const eventsUrl = typeof cfg.eventsUrl === 'string' ? cfg.eventsUrl
        : live ? `${resolveOptions(process.env).baseUrl}/events.json` : '';
      const fitnessLife = buildLifeModel({
        index: g.fitnessIndex,
        activities: Array.isArray(g.fitnessActivities) ? g.fitnessActivities : [],
        roundups: Array.isArray(g.fitnessRoundups) ? g.fitnessRoundups : [],
        events,
        calendar: g.fitnessEvents || null,
        unavailable: Boolean(g.fitnessUnavailable),
        now: cfg.now instanceof Date ? cfg.now : new Date(),
        eventsUrl,
      });
      fitnessLife.calendar.json = scriptJson(fitnessLife.calendar.data);
      fitnessLife.clockJs = clientScript(await fs.readFile(CLOCK_SOURCE, 'utf8'));
      ctx.logger.info(
        `Life page: ${fitnessLife.activities.length} cards, week=${fitnessLife.week?.mode || 'none'}, ` +
        `roundup=${fitnessLife.roundup?.key || 'none'}, calendar=${fitnessLife.calendar.source} ` +
        `(${fitnessLife.calendar.nextUp.length} next up, ` +
        `${fitnessLife.calendar.week.reduce((a, d) => a + d.count, 0)} sessions this week, ` +
        `${fitnessLife.calendar.activeDays} active; page refetches events: ${eventsUrl ? 'yes' : 'no'})`,
      );
      return { fitnessLife };
    },
  };
}
