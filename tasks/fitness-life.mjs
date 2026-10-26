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

export const DEFAULT_EVENTS_FILE = 'personal/items/life/fitness.json';
export const ACTIVITY_HREF = '/life/activity';
export const ROUNDUP_HREF = '/life/roundup';
export const ROUNDUPS_HREF = '/life/roundups';
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
 * @param {Map<string, {level: number, count: number}>} levels
 */
export function stripDays(start, levels) {
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start.getTime() + i * 86_400_000);
    const key = ymd(d);
    const hit = levels.get(key) || { level: 0, count: 0 };
    const level = Math.max(0, Math.min(4, hit.level));
    const h = level ? level * STRIP.unit : 3;
    days.push({
      key,
      letter: DAY_LETTERS[i],
      label: fmt(d, { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', ''),
      level,
      levelClass: `fit-strip__bar--l${level}`,
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
      for (const d of r.dayEntries || []) {
        if (d && typeof d.date === 'string') {
          levels.set(d.date, { level: Number(d.effortLevel) || 0, count: Number(d.activityCount) || 0 });
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

/** @param {any} e index entry */
export function buildCard(e) {
  const { family, glyph } = familyOf(e);
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
    push(sets > 0, String(sets), '', 'sets');
    const w = tonnage(kg);
    push(kg > 0, w.value, w.unit, 'moved');
    push(dur > 0, duration(dur), '', 'time');
    push(kcal > 0, thousands(kcal), 'kcal', 'burned');
  } else {
    push(dur > 0, duration(dur), '', 'time');
    push(kcal > 0, thousands(kcal), 'kcal', 'burned');
    push(bpm > 0, String(bpm), 'bpm', 'avg hr');
  }
  const thumb = typeof e.routeThumbnailUrl === 'string' && /^https:\/\//.test(e.routeThumbnailUrl)
    ? e.routeThumbnailUrl : '';
  return {
    slug: e.slug,
    href: `${ACTIVITY_HREF}/${encodeURIComponent(e.slug)}`,
    title: e.title || 'Untitled activity',
    date: start ? dayStamp(start) : '',
    dateTime: start ? start.toISOString() : '',
    typeLabel: typeLabel(e.activityType),
    source: sourceLabel(e.source),
    glyph,
    family,
    stats,
    prLabel: typeof e.prLabel === 'string' && e.prLabel ? e.prLabel : '',
    thumb,
    hasThumb: Boolean(thumb),
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

const PR_SUFFIX = /_(1rm|set_volume|volume|reps)$/;
const CARDIO_NAMES = /** @type {Record<string, string>} */ ({
  '400m': '400M', '1k': '1K', '1_mile': '1 MILE', '5k': '5K', '10k': '10K',
  half_marathon: 'HALF MARATHON', marathon: 'MARATHON',
});

/** @param {any} pr ShowcaseTopPR */
export function buildPr(pr) {
  const type = String(pr?.recordType || '');
  const suffix = type.match(PR_SUFFIX)?.[1];
  const base = type.replace(PR_SUFFIX, '');
  const name = suffix ? base.toUpperCase() : (CARDIO_NAMES[base] || base.replace(/_/g, ' ').toUpperCase());
  const metric = suffix ? suffix.replace('_', ' ').toUpperCase() : 'BEST';
  const unit = String(pr?.unit || '');
  const value = Number(pr?.value) || 0;
  const prev = pr?.previousValue == null ? null : Number(pr.previousValue);
  let display;
  if (unit === 'seconds') display = clock(value);
  else if (unit === 'meters') display = `${km(value)} km`;
  else if (unit === 'kg') display = kgLabel(value);
  else display = `${value} ${unit}`.trim();
  let delta = '';
  if (prev != null && Number.isFinite(prev) && prev !== value) {
    const diff = value - prev;
    const sign = diff > 0 ? '+' : '−';
    const abs = Math.abs(diff);
    if (unit === 'seconds') delta = `${sign}${abs >= 60 ? clock(abs) : `${Math.round(abs)}s`}`;
    else if (unit === 'kg') delta = `${sign}${kgLabel(abs)}`;
    else if (unit === 'meters') delta = `${sign}${km(abs)} km`;
    else delta = `${sign}${abs}`;
  }
  const at = parse(pr?.achievedAt);
  return {
    name, metric, display, unit, delta,
    improved: delta ? (unit === 'seconds' ? value < prev : value > prev) : false,
    date: at ? longDate(at) : '',
  };
}

/** @param {any} index */
export function buildStats(index) {
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
  const since = parse(p.createdAt);
  const last = parse(p.latestActivityAt);

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
    prs: (Array.isArray(p.topPrs) ? p.topPrs : []).map(buildPr),
    hasPrs: Array.isArray(p.topPrs) && p.topPrs.length > 0,
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

/**
 * Seven day columns from today: the regular sessions in each.
 * @param {{ e: any, t: {start: Date, end: Date, allDay: boolean} }[]} regular  upcoming only
 * @param {Date} now
 */
export function weekStrip(regular, now) {
  const days = [];
  for (let i = 0; i < WEEK_DAYS; i++) {
    const d = localDay(now, i);
    const key = ymd(d);
    const sessions = regular
      .filter(({ t }) => ymd(t.start) === key)
      .sort((a, b) => a.t.start.getTime() - b.t.start.getTime())
      .map(({ e, t }) => ({
        title: e.title,
        time: t.allDay ? '' : hm(t.start),
        kind: e.kind === 'class' ? 'class' : 'session',
        kindClass: e.kind === 'class' ? 'fit-week-strip__session--class' : 'fit-week-strip__session--session',
        location: typeof e.location === 'string' ? e.location : '',
      }));
    days.push({
      key,
      dow: fmt(d, { weekday: 'short' }).toUpperCase(),
      num: fmt(d, { day: 'numeric' }),
      label: fmt(d, { weekday: 'long', day: 'numeric', month: 'short' }).replace(',', ''),
      isToday: i === 0,
      sessions,
      hasSessions: sessions.length > 0,
      count: sessions.length,
    });
  }
  return days;
}

/**
 * The "on the calendar" block from the export (preferred) or the hand-written list.
 * @param {any} exported   events.json object or null
 * @param {any[]} handwritten  fitness.json events
 * @param {Date} now
 */
export function buildCalendar(exported, handwritten, now) {
  const none = { source: 'none', meta: '', nextUp: [], hasNextUp: false, week: [], hasWeek: false, hasAny: false };
  if (exported && Array.isArray(exported.events)) {
    const upcoming = exported.events
      .map((e) => ({ e, t: parseEntry(e) }))
      .filter((x) => x.t && x.t.end > now)
      .sort((a, b) => a.t.start.getTime() - b.t.start.getTime());
    const nextUp = upcoming
      .filter(({ e }) => e.calendar === 'events')
      .slice(0, NEXT_UP_COUNT)
      .map(({ e, t }) => nextUpEntry(e, t, now));
    const week = weekStrip(upcoming.filter(({ e }) => e.calendar === 'regular'), now);
    const hasWeek = week.some((d) => d.hasSessions);
    return {
      source: 'calendar',
      meta: 'races, one-offs & the regular sessions, straight off the calendar',
      nextUp,
      hasNextUp: nextUp.length > 0,
      week: hasWeek ? week : [],
      hasWeek,
      hasAny: nextUp.length > 0 || hasWeek,
    };
  }

  const today = ymd(now);
  const nextUp = (Array.isArray(handwritten) ? handwritten : [])
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
  if (!nextUp.length) return none;
  return {
    source: 'handwritten',
    meta: 'races & events, hand-written for now',
    nextUp,
    hasNextUp: true,
    week: [],
    hasWeek: false,
    hasAny: true,
  };
}

// ---------------------------------------------------------------------------
// Assembly

/**
 * @param {{ index: any, roundups?: any[], events?: any[], calendar?: any, unavailable?: boolean, now?: Date }} input
 *   `events` is the hand-written list (fallback only); `calendar` the events.json object or null.
 */
export function buildLifeModel({ index, roundups = [], events = [], calendar = null, unavailable = false, now = new Date() }) {
  const idx = index || { activities: [], roundups: [], profile: null, streaks: { currentWeeks: 0, longestWeeks: 0 } };
  const entries = Array.isArray(idx.activities) ? idx.activities.filter((e) => e && typeof e.slug === 'string') : [];
  const sorted = [...entries].sort(
    (a, b) => (parse(b.startTime)?.getTime() || 0) - (parse(a.startTime)?.getTime() || 0),
  );
  const summaries = Array.isArray(idx.roundups) ? idx.roundups.filter((r) => r && typeof r.key === 'string') : [];
  const latestSummary = summaries[0] || null;
  const latestFile = latestSummary ? roundups.find((f) => f?.key === latestSummary.key) : undefined;

  const available = !unavailable && entries.length > 0;
  return {
    available,
    hasData: entries.length > 0,
    week: available ? buildWeek(idx, roundups, now) : null,
    activities: sorted.slice(0, CARD_COUNT).map(buildCard),
    hasActivities: sorted.length > 0,
    activityCount: entries.length,
    moreActivities: Math.max(0, entries.length - CARD_COUNT),
    roundup: available ? buildRoundupTeaser(latestSummary, latestFile) : null,
    roundupsHref: ROUNDUPS_HREF,
    roundupCount: summaries.length,
    hasRoundups: summaries.length > 0,
    stats: available ? buildStats(idx) : null,
    calendar: buildCalendar(calendar, events, now),
  };
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
        `${fitnessLife.calendar.week.reduce((a, d) => a + d.count, 0)} sessions this week)`,
      );
      return { fitnessLife };
    },
  };
}
