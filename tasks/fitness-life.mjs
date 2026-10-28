// @ts-check
/**
 * `/life` front-page model (S2.2).
 *
 * Skier's Handlebars environment has no custom helpers (only `#if`, `#each`,
 * `#unless`), so everything the page shows is pre-formatted here into one
 * global, `fitnessLife`, and the templates only loop and test. All inputs are
 * the S2.1 globals (`fitnessIndex`, `fitnessActivities`, `fitnessRoundups`,
 * `fitnessUnavailable`), the calendar export `fitnessEvents` (S2.6: the Fitness
 * Events / Fitness Regular Google calendars, exported by the box as
 * `events.json`) and, only when that export is unavailable, the hand-written
 * events list in `personal/items/life/fitness.json`.
 *
 * Field meanings follow jarvis-memory specs/ripixel-website/fitness-zine.md
 * "Data contract (S0)" §2, §6 and §8.
 */
import fs from 'node:fs/promises';
import { activityTheme, FAMILIES, hybridRaceLabel, typeKeyOf, typeKeyOfTitle } from './fitness-theme.mjs';
import { recordLabel, latestRecords } from './fitness-records.mjs';
import { routePath } from './fitness-activity-pages.mjs';

export const DEFAULT_EVENTS_FILE = 'personal/items/life/fitness.json';
export const ACTIVITY_HREF = '/life/activity';
export const ROUNDUP_HREF = '/life/roundup';
export const ROUNDUPS_HREF = '/life/roundups';
export const SESSIONS_HREF = '/life/sessions';
export const CARD_COUNT = 6;
export const NEXT_UP_COUNT = 5;
export const WEEK_DAYS = 7;
export const TZ = 'Europe/London';

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

/** @param {string|undefined|null} iso */
function parse(iso) {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? null : new Date(t);
}

/** @param {Date} d @param {Intl.DateTimeFormatOptions} opts */
function fmt(d, opts) {
  // en-GB abbreviates September as "Sept"; the zine wants three letters everywhere.
  return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, ...opts }).format(d).replace(/\bSept\b/, 'Sep');
}

/** `SAT 17 OCT` @param {Date} d */
export function dayStamp(d) {
  return fmt(d, { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '').toUpperCase();
}

/** `17 OCT 2026` @param {Date} d */
function longDate(d) {
  return fmt(d, { day: 'numeric', month: 'short', year: 'numeric' }).toUpperCase();
}

/** `APR 2025` @param {Date} d */
function monthYear(d) {
  return fmt(d, { month: 'short', year: 'numeric' }).toUpperCase();
}

/** `12 – 18 OCT 2026` for [start, endExclusive). @param {Date} start @param {Date} endExcl */
export function rangeLabel(start, endExcl) {
  const last = new Date(endExcl.getTime() - 86_400_000);
  const sameMonth = fmt(start, { month: 'short' }) === fmt(last, { month: 'short' });
  const left = sameMonth ? fmt(start, { day: 'numeric' }) : fmt(start, { day: 'numeric', month: 'short' });
  return `${left} – ${fmt(last, { day: 'numeric', month: 'short', year: 'numeric' })}`.toUpperCase();
}

/** `YYYY-MM-DD` in the site timezone. @param {Date} d */
function ymd(d) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
  return parts; // en-CA gives ISO order
}

/** `ACTIVITY_TYPE_WEIGHT_TRAINING` → `WEIGHT TRAINING` @param {string|undefined} t */
export function typeLabel(t) {
  return String(t || '').replace(/^ACTIVITY_TYPE_/, '').replace(/_/g, ' ') || 'ACTIVITY';
}

/** `SOURCE_PARKRUN_RESULTS` → `Parkrun Results` @param {string|undefined} s */
export function sourceLabel(s) {
  return String(s || '').replace(/^SOURCE_/, '').toLowerCase().replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const DISTANCE_TYPES = new Set([
  'RUN', 'TRAIL_RUN', 'VIRTUAL_RUN', 'RIDE', 'GRAVEL_RIDE', 'MOUNTAIN_BIKE_RIDE', 'EMOUNTAIN_BIKE_RIDE',
  'EBIKE_RIDE', 'VIRTUAL_RIDE', 'HANDCYCLE', 'VELOMOBILE', 'ROLLER_SKI', 'NORDIC_SKI', 'BACKCOUNTRY_SKI',
  'ALPINE_SKI', 'SNOWSHOE', 'ICE_SKATE', 'INLINE_SKATE', 'WALK', 'HIKE', 'WHEELCHAIR', 'KAYAKING',
  'CANOEING', 'ROWING', 'VIRTUAL_ROW', 'STAND_UP_PADDLING', 'SWIM', 'WINDSURF', 'KITESURF', 'SAIL',
  'SURFING', 'SKATEBOARD',
]);

/**
 * Card family + glyph for an index entry (§8 "three metrics by family").
 * @param {any} e
 * @returns {{ family: 'distance'|'strength'|'other', glyph: string }}
 */
export function familyOf(e) {
  const t = String(e.activityType || '').replace(/^ACTIVITY_TYPE_/, '');
  if ((e.totalSets || 0) > 0 || t === 'WEIGHT_TRAINING') return { family: 'strength', glyph: '🏋️' };
  if (/RUN$/.test(t)) return { family: 'distance', glyph: '🏃' };
  if (/RIDE$|CYCLE$/.test(t)) return { family: 'distance', glyph: '🚴' };
  if (t === 'WALK' || t === 'HIKE' || t === 'SNOWSHOE') return { family: 'distance', glyph: '🚶' };
  if (t === 'SWIM') return { family: 'distance', glyph: '🏊' };
  if (/ROW|KAYAK|CANOE|PADDL|SAIL|SURF/.test(t)) return { family: 'distance', glyph: '🚣' };
  if (/SKI|SKATE/.test(t)) return { family: 'distance', glyph: '⛷️' };
  if (DISTANCE_TYPES.has(t)) return { family: 'distance', glyph: '🏃' };
  if (t === 'YOGA' || t === 'PILATES') return { family: 'other', glyph: '🧘' };
  if (/TENNIS|BADMINTON|PICKLEBALL|RACQUETBALL|SQUASH|SOCCER|GOLF|CLIMBING/.test(t)) {
    return { family: 'other', glyph: '🏅' };
  }
  return { family: 'other', glyph: '⚡' };
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
const STRIP = { colW: 40, barW: 28, baseY: 56, unit: 12, pad: 6 };

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
    if (!cur || secs > cur.secs) best.set(key, { typeKey: typeKeyOf(e.activityType), secs });
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
      const isCurrent = now >= start && now < end;
      const kg = (r.activityTypeBreakdowns || []).reduce((a, b) => a + (Number(b?.totalWeightKg) || 0), 0);
      return {
        mode: 'roundup',
        kicker: isCurrent ? 'THIS WEEK' : 'LATEST WEEK',
        title: weekNo ? `WEEK ${Number(weekNo)}` : 'THE WEEK',
        range: rangeLabel(start, end),
        href: `${ROUNDUP_HREF}/${encodeURIComponent(r.periodKey || weekly.key)}`,
        days,
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
  const { family, glyph } = familyOf(e);
  const theme = activityTheme(e.activityType);
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
  const typeText = hybridRaceLabel(e.title) || typeLabel(e.activityType);
  return {
    slug: e.slug,
    href: `${ACTIVITY_HREF}/${encodeURIComponent(e.slug)}`,
    title: e.title || 'Untitled activity',
    date: start ? dayStamp(start) : '',
    dateTime: start ? start.toISOString() : '',
    typeLabel: typeText,
    ...theme,
    source: sourceLabel(e.source),
    glyph,
    family,
    stats,
    keyStat: keyStatOf(family, stats),
    prLabel: typeof e.prLabel === 'string' && e.prLabel ? e.prLabel : '',
    thumb,
    hasThumb: Boolean(thumb),
    ...cardPicture(e, file),
    pictureWord: typeText.split(' ').slice(0, 2).join(' '),
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
 * The personal-bests wall, grouped by kind of record, then by exercise:
 *   ON FOOT (fastest standard distances + longest run), ON THE BIKE,
 *   HYROX STATIONS (by race order), IRON (one tile per exercise carrying its
 *   heaviest lift and est. 1RM together, heaviest exercises first).
 * Volume and rep records stay on the activity and roundup pages.
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

  const hyrox = all
    .filter((p) => p.group === 'hyrox')
    .sort((a, b) => a.order - b.order)
    .map((p) => tile(p.name, [p]));

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
    { key: 'hyrox', title: 'hyrox stations', typeClass: 'fit-type--crossfit', tiles: hyrox },
    { key: 'iron', title: 'iron · heaviest lift & est. 1RM', typeClass: 'fit-type--strength', tiles: iron },
  ].filter((g) => g.tiles.length > 0);
  return groups;
}

/** @param {any} index @param {any[]} [roundupFiles] every roundup file: their prsAchieved fill in the PB wall */
export function buildStats(index, roundupFiles = []) {
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
    subtitle: typeof p.subtitle === 'string' ? p.subtitle : '',
    bio: typeof p.bio === 'string' ? p.bio : '',
  };
}

// ---------------------------------------------------------------------------
// On the calendar (S2.6)
//
// `events.json` from the bucket is the Fitness Events (races, one-offs; 120 days)
// and Fitness Regular (recurring sessions; 21 days) calendars, one sorted list
// with `calendar: 'events'|'regular'` and `kind: race|other|class|session`.
// The hand-written list in fitness.json is only the fallback when that export
// is unavailable. Past entries are never shown; with nothing upcoming the
// section renders nothing at all.

/** `12:10` in the site timezone (h23 so midnight is 00:00, never 24:00). @param {Date} d */
function hm(d) {
  return fmt(d, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}

/** Whole days since the epoch of the site-local date of `d`. @param {Date} d */
function dayIndex(d) {
  const [y, m, day] = ymd(d).split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, day) / 86_400_000);
}

/** The site-local noon of the day `offset` days after `now`'s day. @param {Date} now @param {number} offset */
function localDay(now, offset) {
  const [y, m, d] = ymd(now).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + offset, 12));
}

/**
 * `today 12:10`, `tomorrow`, `in 3 days`, `happening now`.
 * @param {Date} start @param {Date} end @param {boolean} allDay @param {Date} now
 */
export function countdown(start, end, allDay, now) {
  if (start <= now && end > now) return allDay ? 'today' : 'happening now';
  const diff = dayIndex(start) - dayIndex(now);
  const at = allDay ? '' : ` ${hm(start)}`;
  if (diff <= 0) return `today${at}`;
  if (diff === 1) return `tomorrow${at}`;
  return `in ${diff} days`;
}

/** A calendar export entry → parsed dates, or null when the start is unusable. @param {any} e */
function parseEntry(e) {
  if (!e || typeof e.title !== 'string') return null;
  const start = parse(e.start);
  if (!start) return null;
  const end = parse(e.end) || start;
  return { start, end: end > start ? end : start, allDay: Boolean(e.allDay) };
}

/** @param {any} e export entry @param {{start: Date, end: Date, allDay: boolean}} t @param {Date} now */
function nextUpEntry(e, t, now) {
  const race = e.kind === 'race';
  return {
    id: typeof e.id === 'string' ? e.id : '',
    title: e.title,
    kind: race ? 'race' : 'event',
    stamp: race ? 'RACE' : 'EVENT',
    stampClass: race ? 'fit-event__stamp--race' : 'fit-event__stamp--event',
    emoji: race ? '🏁' : '📍',
    day: fmt(t.start, { day: 'numeric' }),
    month: fmt(t.start, { month: 'short', year: 'numeric' }),
    date: dayStamp(t.start),
    time: t.allDay ? '' : hm(t.start),
    when: countdown(t.start, t.end, t.allDay, now),
    location: typeof e.location === 'string' ? e.location : '',
    description: typeof e.description === 'string' ? e.description : '',
    dateTime: t.start.toISOString(),
    allDay: t.allDay,
  };
}

/** Monday (site-local noon) of the week containing `now`. @param {Date} now */
function weekMonday(now) {
  const dow = (dayIndex(now) + 3) % 7; // 1970-01-01 was a Thursday → Monday = 0
  return localDay(now, -dow);
}

/**
 * This week, Monday to Sunday, from both calendars and the record:
 * a day is **active** when a session was actually logged on it (index
 * activities), whatever was planned; still-to-come entries from the Fitness
 * Regular and Fitness Events calendars show as **planned**; a past day with
 * neither is a rest day. Races from the Events calendar are marked.
 * @param {{ e: any, t: {start: Date, end: Date, allDay: boolean} }[]} upcoming  both calendars, not yet ended
 * @param {any[]} activities  index entries
 * @param {Date} now
 */
export function weekStrip(upcoming, activities, now) {
  const monday = weekMonday(now);
  const todayKey = ymd(now);
  const days = [];
  for (let i = 0; i < WEEK_DAYS; i++) {
    const d = new Date(monday.getTime() + i * 86_400_000);
    const key = ymd(d);
    const done = (activities || [])
      .map((e) => ({ e, t: parse(e?.startTime) }))
      .filter((x) => x.t && typeof x.e.slug === 'string' && ymd(/** @type {Date} */ (x.t)) === key)
      .sort((a, b) => /** @type {Date} */ (a.t).getTime() - /** @type {Date} */ (b.t).getTime())
      .map(({ e, t }) => {
        const theme = activityTheme(e.activityType);
        return {
          title: e.title || typeLabel(e.activityType),
          time: hm(/** @type {Date} */ (t)),
          href: `${ACTIVITY_HREF}/${encodeURIComponent(e.slug)}`,
          typeClass: theme.typeClass,
          typeKey: theme.typeKey,
        };
      });
    const planned = upcoming
      .filter(({ t }) => ymd(t.start) === key)
      .sort((a, b) => a.t.start.getTime() - b.t.start.getTime())
      .map(({ e, t }) => {
        const race = e.calendar === 'events';
        const typeKey = typeKeyOfTitle(e.title);
        return {
          title: e.title,
          time: t.allDay ? '' : hm(t.start),
          kind: race ? (e.kind === 'race' ? 'race' : 'event') : (e.kind === 'class' ? 'class' : 'session'),
          isEvent: race,
          typeClass: `fit-type--${typeKey}`,
          location: typeof e.location === 'string' ? e.location : '',
        };
      });
    const isToday = key === todayKey;
    const isPast = key < todayKey;
    const state = done.length ? 'active' : planned.length ? 'planned' : isPast || isToday ? 'rest' : 'open';
    days.push({
      key,
      dow: fmt(d, { weekday: 'short' }).toUpperCase(),
      num: fmt(d, { day: 'numeric' }),
      label: fmt(d, { weekday: 'long', day: 'numeric', month: 'short' }).replace(',', ''),
      isToday,
      isPast,
      done,
      hasDone: done.length > 0,
      planned,
      hasPlanned: planned.length > 0,
      state,
      stateClass: `fit-week-strip__day--${state}`,
      isRest: state === 'rest',
      isOpen: state === 'open',
      count: done.length + planned.length,
    });
  }
  return days;
}

/**
 * The "on the calendar" block. Next up: the Fitness Events calendar only (races
 * and one-offs — the big things), or the hand-written list when the export is
 * missing. This week: see weekStrip.
 * @param {any} exported   events.json object or null
 * @param {any[]} handwritten  fitness.json events
 * @param {Date} now
 * @param {any[]} [activities] index entries, for the days already done
 */
export function buildCalendar(exported, handwritten, now, activities = []) {
  const hasExport = Boolean(exported && Array.isArray(exported.events));
  const upcoming = hasExport
    ? exported.events
      .map((/** @type {any} */ e) => ({ e, t: parseEntry(e) }))
      .filter((/** @type {any} */ x) => x.t && x.t.end > now)
      .sort((/** @type {any} */ a, /** @type {any} */ b) => a.t.start.getTime() - b.t.start.getTime())
    : [];
  const week = weekStrip(upcoming, activities, now);
  const hasWeek = week.some((d) => d.count > 0);

  let nextUp;
  let source;
  let meta;
  if (hasExport) {
    source = 'calendar';
    meta = 'races & one-offs, the regular sessions, and what actually got done';
    nextUp = upcoming
      .filter(({ e }) => e.calendar === 'events')
      .slice(0, NEXT_UP_COUNT)
      .map(({ e, t }) => nextUpEntry(e, t, now));
  } else {
    const today = ymd(now);
    nextUp = (Array.isArray(handwritten) ? handwritten : [])
      .filter((e) => e && typeof e.title === 'string' && typeof e.date === 'string' && e.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, NEXT_UP_COUNT)
      .map((e) => {
        const start = parse(`${e.date}T00:00:00Z`) || now;
        const end = new Date(start.getTime() + 86_400_000);
        const race = /\brace\b/i.test(String(e.tag || ''));
        return nextUpEntry({
          id: '',
          title: e.title,
          kind: race ? 'race' : 'other',
          location: '',
          description: [e.tag, e.description].filter((x) => typeof x === 'string' && x).join(' — '),
        }, { start, end, allDay: true }, now);
      });
    source = nextUp.length ? 'handwritten' : 'none';
    meta = nextUp.length ? 'races & events, hand-written for now' : '';
  }
  return {
    source,
    meta,
    nextUp,
    hasNextUp: nextUp.length > 0,
    week: hasWeek ? week : [],
    hasWeek,
    weekRange: hasWeek ? rangeLabel(weekMonday(now), new Date(weekMonday(now).getTime() + WEEK_DAYS * 86_400_000)) : '',
    activeDays: week.filter((d) => d.hasDone).length,
    hasAny: nextUp.length > 0 || hasWeek,
  };
}

// ---------------------------------------------------------------------------
// Assembly

/**
 * @param {{ index: any, activities?: any[], roundups?: any[], events?: any[], calendar?: any, unavailable?: boolean, now?: Date }} input
 *   `events` is the hand-written list (fallback only); `calendar` the events.json object or null;
 *   `activities` the full activity files (their route points draw a card's picture when it has no photo).
 */
export function buildLifeModel({ index, activities = [], roundups = [], events = [], calendar = null, unavailable = false, now = new Date() }) {
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
    stats: available ? buildStats(idx, roundups) : null,
    calendar: buildCalendar(calendar, events, now, available ? entries : []),
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
 * @param {{ eventsFile?: string, now?: Date }} [config]
 */
export function fitnessLifeTask(config = {}) {
  return {
    name: 'fitness-life',
    title: 'Build the /life fitness front-page model',
    config,
    run: async (/** @type {any} */ cfg, /** @type {any} */ ctx) => {
      const g = ctx.globals || {};
      const events = await readEvents(cfg.eventsFile || DEFAULT_EVENTS_FILE, ctx.logger);
      const fitnessLife = buildLifeModel({
        index: g.fitnessIndex,
        activities: Array.isArray(g.fitnessActivities) ? g.fitnessActivities : [],
        roundups: Array.isArray(g.fitnessRoundups) ? g.fitnessRoundups : [],
        events,
        calendar: g.fitnessEvents || null,
        unavailable: Boolean(g.fitnessUnavailable),
        now: cfg.now instanceof Date ? cfg.now : new Date(),
      });
      ctx.logger.info(
        `Life page: ${fitnessLife.activities.length} cards, week=${fitnessLife.week?.mode || 'none'}, ` +
        `roundup=${fitnessLife.roundup?.key || 'none'}, calendar=${fitnessLife.calendar.source} ` +
        `(${fitnessLife.calendar.nextUp.length} next up, ` +
        `${fitnessLife.calendar.week.reduce((a, d) => a + d.count, 0)} sessions this week, ` +
        `${fitnessLife.calendar.activeDays} active)`,
      );
      return { fitnessLife };
    },
  };
}
