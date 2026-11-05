// @ts-check
/**
 * Per-kind activity pages: which page an activity gets and the pieces each kind draws.
 *
 * A run, a Hyrox race, a Hyrox/hybrid class, a lifting session and a pilates class each
 * celebrate something different, so /life/activity/<slug> is laid out by `kind`:
 *
 *   race      any activity with race data (Hyrox): the result, the splits, the weekend
 *   run       run / trail / treadmill: the route, km splits, elevation, best efforts
 *   ride      a ride with distance: route, speed, elevation
 *   walk      walk / hike: light
 *   strength  lifting: every set as a bar, the heaviest marked, versus last time, PRs
 *   class     crossfit, HIIT, bootcamp, spin, Hyrox/hybrid PT: the engine and the work
 *   mind      pilates / yoga / mobility: calm, the practice and its streak
 *   other     anything else
 *
 * Everything here is data only; tasks/fitness-activity-views.mjs puts it on the page and
 * tasks/fitness-activity-kinds.test.mjs covers it. `buildActivityHistory` indexes every
 * activity once per build (best efforts, exercises, practice dates) so a page can compare
 * itself with what came before it — never with what came after.
 */
import { lineChart } from './chart-axes.mjs';
import { foodComparison } from './fitness-calories.mjs';
import { fmtClock, fmtNumber, fmtPace, prValue, prDelta, activityUrl } from './fitness-activity-views.mjs';

/** @typedef {'race'|'run'|'ride'|'walk'|'strength'|'class'|'mind'|'other'} Kind */

/** @param {unknown} v */
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
/** @param {unknown} t */
const bare = (t) => String(t ?? '').replace(/^ACTIVITY_TYPE_/, '');

const RUN_TYPES = new Set(['RUN', 'TRAIL_RUN', 'VIRTUAL_RUN']);
const WALK_TYPES = new Set(['WALK', 'HIKE', 'SNOWSHOE']);
const RIDE_TYPES = new Set(['RIDE', 'GRAVEL_RIDE', 'MOUNTAIN_BIKE_RIDE', 'EBIKE_RIDE', 'EMOUNTAIN_BIKE_RIDE', 'VIRTUAL_RIDE', 'VELOMOBILE', 'HANDCYCLE']);
const MIND_TYPES = new Set(['PILATES', 'YOGA']);
const CLASS_TYPES = new Set(['CROSSFIT', 'HIGH_INTENSITY_INTERVAL_TRAINING', 'ELLIPTICAL', 'STAIR_STEPPER']);
const LIFT_TYPES = new Set(['WEIGHT_TRAINING', 'WORKOUT']);
const MIND_TITLE = /\b(pilates|yoga|mobility)\b/i;
/** A PT or workout named like a class is one, whatever Hevy filed it under (Half Hyrox PT, Long Intervals PT). */
const CLASS_TITLE = /\b(hyrox|hybrid|bootcamp|crossfit|hiit|stations?|compromised|intervals?|amrap|emom|circuits?|class|spin|spinning|metcon|ergshit)\b/i;
/** Hevy's names for a run logged as a set. */
const RUN_EXERCISE = /^(running|trail running|treadmill|outdoor run)$/i;

/** @param {any} file */
function setsOf(file) {
  const sessions = Array.isArray(file?.activity?.activityData?.sessions) ? file.activity.activityData.sessions : [];
  return sessions.flatMap((s) => (Array.isArray(s?.strengthSets) ? s.strengthSets : []));
}

/** A set done for distance or time with no reps: a station (sled, erg, treadmill, plank). @param {any} s */
const isStation = (s) => num(s?.reps) === 0 && (num(s?.distanceMeters) > 0 || num(s?.durationSeconds) > 0);

/**
 * Which page an activity gets.
 * @param {any} file  an element of `fitnessActivities`
 * @returns {Kind}
 */
export function activityKind(file) {
  if (file?.race) return 'race';
  const activity = file?.activity ?? {};
  const t = bare(activity.activityType ?? file?.entry?.activityType);
  const title = String(activity.title ?? file?.entry?.title ?? '');
  if (RUN_TYPES.has(t)) return 'run';
  if (WALK_TYPES.has(t)) return 'walk';
  if (RIDE_TYPES.has(t)) {
    const sessions = Array.isArray(activity.activityData?.sessions) ? activity.activityData.sessions : [];
    const distance = sessions.reduce((s, x) => s + num(x?.totalDistance), 0) || num(file?.entry?.distanceMeters);
    const routed = Array.isArray(file?.routePoints) && file.routePoints.length >= 2;
    return distance > 0 || routed ? 'ride' : 'class';
  }
  if (MIND_TYPES.has(t) || MIND_TITLE.test(title)) return 'mind';
  if (CLASS_TYPES.has(t)) return 'class';
  if (LIFT_TYPES.has(t)) {
    const sets = setsOf(file);
    // A race or long run filed as a workout with one running set (Leeds Marathon).
    if (sets.length && sets.every((s) => RUN_EXERCISE.test(String(s?.exerciseName ?? '')) && num(s?.distanceMeters) > 0)) return 'run';
    if (CLASS_TITLE.test(title)) return 'class';
    // No sets, or the session logged as one block of cardio: led by heart rate, like a class.
    if (!sets.length || (sets.length === 1 && isStation(sets[0]))) return 'class';
    // A lone warm-up station first (five minutes on the bike) does not make it a class.
    const first = sets[0];
    const body = isStation(first) && sets.filter((s) => s?.exerciseName === first?.exerciseName).length === 1 ? sets.slice(1) : sets;
    const stations = body.filter(isStation).length;
    const lifts = body.filter((s) => num(s?.reps) > 0).length;
    return stations + lifts > 0 && stations / (stations + lifts) > 0.5 ? 'class' : 'strength';
  }
  return 'other';
}

// ---------------------------------------------------------------------------
// Location

const NATIONS = /^(united kingdom|uk|great britain|england|scotland|wales|northern ireland)$/i;
const REGIONS = /^(east midlands|west midlands|north east|north west|south east|south west|east of england|yorkshire and the humber|greater london|london)$/i;
const POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;

/**
 * A reverse geocode ("Fernwood CP, Newark and Sherwood, Nottinghamshire, East Midlands,
 * England, United Kingdom") as place and town ("Fernwood CP, Newark"): postcode, nation,
 * region and county dropped, the district's "and ..." tail cut. Short names pass through.
 * @param {unknown} raw
 */
export function shortLocation(raw) {
  const parts = String(raw ?? '').split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length <= 2) return parts.join(', ');
  const kept = parts.filter((p) => !POSTCODE.test(p) && !NATIONS.test(p) && !REGIONS.test(p));
  if (kept.length >= 3) kept.pop(); // the county
  if (kept.length <= 1) return kept[0] ?? parts[0];
  const place = kept[0];
  const town = kept[kept.length - 1].replace(/\s+and\s+.*$/i, '');
  return place === town ? place : `${place}, ${town}`;
}

// ---------------------------------------------------------------------------
// AI summary

/**
 * FitGlue's AI companion moved from Gemini to Claude in James's voice with fitglue-server
 * PR #103 (merged 2026-11-03 23:39 UTC). The export's `aiSummary.model` and `generatedAt`
 * are empty for every summary, so until they are filled the activity's own date decides.
 */
export const AI_VOICE_SINCE = '2026-11-04T00:00:00Z';

/**
 * Whether an activity's AI summary is the current (Claude) one, which the page shows;
 * older Gemini ones are hidden.
 * @param {{ model?: string|null, generatedAt?: string|null }|null|undefined} ai
 * @param {string|undefined|null} startTime
 */
export function isCurrentAiSummary(ai, startTime) {
  const since = Date.parse(AI_VOICE_SINCE);
  const model = String(ai?.model ?? '');
  if (model) return /claude/i.test(model);
  const gen = Date.parse(String(ai?.generatedAt ?? ''));
  if (Number.isFinite(gen)) return gen >= since;
  const start = Date.parse(String(startTime ?? ''));
  return Number.isFinite(start) && start >= since;
}

// ---------------------------------------------------------------------------
// Heart-rate zones (FitGlue heart_rate_zones: fractions of max HR, zone 0 below 50 %)

export const ZONE_NAMES = ['rest', 'recovery', 'endurance', 'tempo', 'threshold', 'max'];
const ZONE_EDGES = [0.5, 0.6, 0.7, 0.8, 0.9];
/** FitGlue's default when the athlete has not set one. */
export const DEFAULT_MAX_HR = 190;

/** Zone 0–5 for a bpm, -1 when there is no reading. @param {unknown} bpm @param {number} maxHr */
export function zoneOf(bpm, maxHr) {
  const b = num(bpm);
  if (b <= 0 || !(maxHr > 0)) return -1;
  const p = b / maxHr;
  let z = 0;
  for (const edge of ZONE_EDGES) if (p >= edge) z++;
  return z;
}

/** Minutes per zone from a series. @param {number[]} hr @param {number[]} elapsed @param {number} maxHr */
function zoneMinutesOf(hr, elapsed, maxHr) {
  const out = [0, 0, 0, 0, 0, 0];
  for (let i = 1; i < hr.length; i++) {
    const z = zoneOf(hr[i], maxHr);
    if (z < 0) continue;
    out[z] += (num(elapsed[i]) - num(elapsed[i - 1])) / 60;
  }
  return out;
}

/**
 * The max HR FitGlue's zones were cut with. The export carries the minutes per zone but
 * not the max, so it is the whole-bpm value (170–210) whose zones best match those minutes
 * over every activity with a heart-rate series; FitGlue's default 190 without any.
 * @param {any[]} files
 */
export function inferMaxHr(files) {
  const usable = (Array.isArray(files) ? files : []).filter((f) =>
    Array.isArray(f?.series?.heartRate) && Array.isArray(f?.series?.elapsedS) && Array.isArray(f?.entry?.hrZoneMinutes) && f.entry.hrZoneMinutes.length === 6);
  if (!usable.length) return DEFAULT_MAX_HR;
  let best = DEFAULT_MAX_HR;
  let bestErr = Infinity;
  for (let mx = 170; mx <= 210; mx++) {
    let err = 0;
    for (const f of usable) {
      const z = zoneMinutesOf(f.series.heartRate, f.series.elapsedS, mx);
      for (let i = 0; i < 6; i++) err += Math.abs(z[i] - num(f.entry.hrZoneMinutes[i]));
    }
    // Ties go to the value nearer FitGlue's default.
    if (err < bestErr - 1e-9 || (Math.abs(err - bestErr) <= 1e-9 && Math.abs(mx - DEFAULT_MAX_HR) < Math.abs(best - DEFAULT_MAX_HR))) {
      best = mx;
      bestErr = err;
    }
  }
  return best;
}

/** @param {number} v */
const pc = (v) => Math.round(v * 100) / 100;

/**
 * The effort ribbon: the session's heart rate as a line over bands coloured by zone.
 * `bands` are {x, w, zone} in percent of the plot; `chart` is the line with its axes.
 * @param {any} series @param {number} maxHr @param {number} seconds
 */
export function effortRibbon(series, maxHr, seconds) {
  const hr = Array.isArray(series?.heartRate) ? series.heartRate : null;
  if (!hr || hr.length < 2) return null;
  const chart = lineChart(hr, { label: 'Heart rate', unit: 'bpm', h: 180, x: { kind: 'clock', seconds } });
  if (!chart) return null;
  const n = hr.length;
  /** @type {{ x: number, w: number, zone: number, name: string }[]} */
  const bands = [];
  let last = -2;
  for (let i = 0; i < n; i++) {
    const z = typeof hr[i] === 'number' ? zoneOf(hr[i], maxHr) : -1;
    if (z < 0) { last = -2; continue; }
    const from = Math.max(0, (i - 0.5) / (n - 1)) * 100;
    const to = Math.min(1, (i + 0.5) / (n - 1)) * 100;
    const prev = bands[bands.length - 1];
    if (prev && last === z) prev.w = pc(to - prev.x);
    else bands.push({ x: pc(from), w: pc(to - from), zone: z, name: ZONE_NAMES[z] });
    last = z;
  }
  return { chart, bands, zonesSeen: [...new Set(bands.map((b) => b.zone))].sort().map((z) => ({ zone: z, label: `Z${z}`, name: ZONE_NAMES[z] })) };
}

/**
 * Minutes per zone as one 100 % bar (the life-split partial). Null without minutes.
 * @param {unknown} zoneMinutes  the entry's hrZoneMinutes, zone 0 first
 */
export function zoneSplit(zoneMinutes) {
  if (!Array.isArray(zoneMinutes) || zoneMinutes.length !== 6) return null;
  const total = zoneMinutes.reduce((s, m) => s + num(m), 0);
  if (!total) return null;
  return zoneMinutes
    .map((m, i) => ({ key: `z${i}`, short: `Z${i}`, label: `Z${i} ${ZONE_NAMES[i]}`, minutes: num(m), pct: Math.round((num(m) / total) * 100) }))
    .filter((z) => z.minutes > 0)
    .map((z) => ({ ...z, narrow: z.pct < 12 }));
}

// ---------------------------------------------------------------------------
// Runs

/** Seconds → "+0:48" / "−0:32". @param {number} s */
function signedClock(s) {
  const r = Math.round(Math.abs(s));
  const body = `${Math.floor(r / 60)}:${String(r % 60).padStart(2, '0')}`;
  return r === 0 ? '0:00' : `${s < 0 ? '−' : '+'}${body}`;
}

/**
 * Per-km splits, each against the run's own average pace: `pct` is the bar's length as a
 * share of the biggest gap from the average, `faster` which side it sits. From the distance
 * series when there is one (a final part-km over 100 m included at its pace), else from the
 * pace enrichment's whole-km splits. Null with fewer than two.
 * @param {any} series
 * @param {any} pace  enrichments.pace
 * @param {any[]} [kmSplits]  the export's per-km HR
 */
export function runSplits(series, pace, kmSplits = []) {
  /** @type {{ label: string, km: number, secs: number, perKm: number, partial: boolean }[]} */
  let rows = [];
  let avgPerKm = 0;
  const dist = Array.isArray(series?.distanceM) ? series.distanceM : null;
  const el = Array.isArray(series?.elapsedS) ? series.elapsedS : null;
  if (dist && el && dist.length === el.length && dist.length >= 2 && num(dist[dist.length - 1]) >= 1000) {
    const total = num(dist[dist.length - 1]);
    const end = num(el[el.length - 1]);
    const at = (/** @type {number} */ m) => {
      for (let i = 1; i < dist.length; i++) {
        if (num(dist[i]) >= m) {
          const d0 = num(dist[i - 1]);
          const span = num(dist[i]) - d0;
          return num(el[i - 1]) + (span > 0 ? ((m - d0) / span) * (num(el[i]) - num(el[i - 1])) : 0);
        }
      }
      return end;
    };
    let prev = 0;
    for (let k = 1; k * 1000 <= total; k++) {
      const t = at(k * 1000);
      rows.push({ label: String(k), km: k, secs: t - prev, perKm: t - prev, partial: false });
      prev = t;
    }
    const rem = total - rows.length * 1000;
    if (rem >= 100) rows.push({ label: (rem / 1000).toFixed(1), km: rows.length + 1, secs: end - prev, perKm: (end - prev) / (rem / 1000), partial: true });
    avgPerKm = end / (total / 1000);
  } else if (Array.isArray(pace?.splits)) {
    rows = pace.splits.filter((s) => num(s?.seconds) > 0).map((s) => ({ label: String(s.km), km: num(s.km), secs: num(s.seconds), perKm: num(s.seconds), partial: false }));
    avgPerKm = rows.length ? rows.reduce((a, r) => a + r.secs, 0) / rows.length : 0;
  }
  if (rows.length < 2 || !(avgPerKm > 0)) return null;
  const whole = rows.filter((r) => !r.partial);
  const fastest = whole.reduce((m, r) => (r.perKm < m ? r.perKm : m), Infinity);
  const maxGap = rows.reduce((m, r) => Math.max(m, Math.abs(r.perKm - avgPerKm)), 0) || 1;
  const hrByKm = new Map((Array.isArray(kmSplits) ? kmSplits : []).map((k) => [num(k?.km), num(k?.avgHr)]));
  return {
    avg: fmtPace(avgPerKm),
    rows: rows.map((r) => ({
      label: r.label,
      partial: r.partial,
      pace: fmtPace(r.perKm),
      delta: signedClock(r.perKm - avgPerKm),
      faster: r.perKm < avgPerKm,
      fastest: !r.partial && r.perKm === fastest,
      pct: Math.max(2, Math.round((Math.abs(r.perKm - avgPerKm) / maxGap) * 100)),
      hr: hrByKm.get(r.km) ? String(Math.round(/** @type {number} */ (hrByKm.get(r.km)))) : '',
    })),
    hasHr: rows.some((r) => hrByKm.get(r.km)),
  };
}

/**
 * Altitude over distance, resampled evenly by distance so the x axis is true km. Null when
 * there is no altitude series or it moves less than 3 m (treadmill, flat track).
 * @param {any} series
 * @param {any} elevation  enrichments.elevation
 */
export function elevationProfile(series, elevation) {
  const alt = Array.isArray(series?.altitudeM) ? series.altitudeM : null;
  const dist = Array.isArray(series?.distanceM) ? series.distanceM : null;
  if (!alt || !dist || alt.length !== dist.length || alt.length < 2) return null;
  const pts = alt.map((a, i) => [num(dist[i]), a]).filter(([, a]) => typeof a === 'number' && Number.isFinite(a));
  if (pts.length < 2) return null;
  const vals = pts.map((p) => /** @type {number} */ (p[1]));
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  if (hi - lo < 3) return null;
  const total = pts[pts.length - 1][0];
  if (!(total > 0)) return null;
  const N = 80;
  const out = [];
  let j = 1;
  for (let k = 0; k <= N; k++) {
    const m = (total * k) / N;
    while (j < pts.length - 1 && pts[j][0] < m) j++;
    const [d0, a0] = pts[j - 1];
    const [d1, a1] = pts[j];
    out.push(d1 > d0 ? a0 + ((m - d0) / (d1 - d0)) * (a1 - a0) : a1);
  }
  let gain = num(elevation?.totalGainM);
  let loss = num(elevation?.totalLossM);
  if (!gain && !loss) {
    for (let i = 1; i < vals.length; i++) {
      const d = vals[i] - vals[i - 1];
      if (d > 0) gain += d; else loss -= d;
    }
  }
  const chart = lineChart(out, { label: 'Elevation', unit: 'm', h: 120, x: { kind: 'distance', meters: total } });
  if (!chart) return null;
  return { chart, gain: String(Math.round(gain)), loss: String(Math.round(loss)), high: String(Math.round(hi)), low: String(Math.round(lo)) };
}

// ---------------------------------------------------------------------------
// History over every activity

/** Monday 00:00 UTC of the week holding `ms`. @param {number} ms */
function weekStart(ms) {
  const d = new Date(ms);
  const day = (d.getUTCDay() + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day);
}
const WEEK = 7 * 24 * 3600 * 1000;

/** Which practice a calm session belongs to: pilates, yoga or mobility. @param {any} file */
export function practiceKey(file) {
  const t = bare(file?.activity?.activityType ?? file?.entry?.activityType);
  if (t === 'PILATES') return 'pilates';
  if (t === 'YOGA') return 'yoga';
  const m = MIND_TITLE.exec(String(file?.activity?.title ?? file?.entry?.title ?? ''));
  return m ? m[1].toLowerCase() : 'mobility';
}

/** @param {any} file */
function startOf(file) {
  return Date.parse(String(file?.activity?.startTime ?? file?.entry?.startTime ?? ''));
}

/**
 * @typedef {{ date: number, slug: string, topKg: number, topReps: number, maxReps: number, dur: number, dist: number }} ExerciseDay
 * @typedef {{ bestEfforts: Map<string, { date: number, slug: string, t: number }[]>,
 *   exercises: Map<string, ExerciseDay[]>, practice: Map<string, { date: number, slug: string }[]> }} ActivityHistory
 */

/**
 * Index every activity once: run best efforts per distance, each exercise's sessions, and
 * the dates of each calm practice. Lists are in date order.
 * @param {any[]} files
 * @returns {ActivityHistory}
 */
export function buildActivityHistory(files) {
  /** @type {ActivityHistory} */
  const h = { bestEfforts: new Map(), exercises: new Map(), practice: new Map() };
  const push = (/** @type {Map<string, any[]>} */ map, /** @type {string} */ key, /** @type {any} */ v) => {
    if (!map.has(key)) map.set(key, []);
    /** @type {any[]} */ (map.get(key)).push(v);
  };
  for (const f of Array.isArray(files) ? files : []) {
    const date = startOf(f);
    if (!Number.isFinite(date)) continue;
    const slug = String(f?.slug ?? f?.entry?.showcaseId ?? '');
    const kind = activityKind(f);
    if (kind === 'run') {
      const efforts = Array.isArray(f?.entry?.bestEfforts) && f.entry.bestEfforts.length ? f.entry.bestEfforts : f?.activity?.enrichments?.bestEfforts?.efforts;
      for (const e of Array.isArray(efforts) ? efforts : []) if (e?.distanceKey && num(e.timeSeconds) > 0) push(h.bestEfforts, e.distanceKey, { date, slug, t: num(e.timeSeconds) });
    }
    if (kind === 'mind') push(h.practice, practiceKey(f), { date, slug });
    /** @type {Map<string, ExerciseDay>} */
    const day = new Map();
    for (const s of setsOf(f)) {
      const name = String(s?.exerciseName ?? '');
      if (!name) continue;
      const d = day.get(name) ?? { date, slug, topKg: 0, topReps: 0, maxReps: 0, dur: 0, dist: 0 };
      const w = num(s.weightKg);
      const r = num(s.reps);
      if (r > 0 && (w > d.topKg || (w === d.topKg && r > d.topReps))) { d.topKg = w; d.topReps = r; }
      d.maxReps = Math.max(d.maxReps, r);
      d.dur += num(s.durationSeconds);
      d.dist += num(s.distanceMeters);
      day.set(name, d);
    }
    for (const [name, d] of day) push(h.exercises, name, d);
  }
  for (const map of [h.bestEfforts, h.exercises, h.practice]) for (const list of map.values()) list.sort((a, b) => a.date - b.date);
  return h;
}

/** @param {number} ms @param {number} [nowYear] */
function dayMonth(ms, nowYear) {
  const d = new Date(ms);
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
  return `${d.getUTCDate()} ${mon}${nowYear && nowYear !== d.getUTCFullYear() ? ` ${d.getUTCFullYear()}` : ''}`;
}

/**
 * Each best effort of this run, ranked against the same distance on every earlier run.
 * FitGlue's personal-records enrichment is the authority for "PB"; otherwise the rank on
 * this site's history: fastest yet, 2nd best, 3rd best (or "first" with nothing before).
 * @param {any[]} efforts  the entry's bestEfforts
 * @param {any[]} records  personalRecords.records
 * @param {ActivityHistory|null} history
 * @param {string} startTime
 */
export function bestEffortBadges(efforts, records, history, startTime) {
  const date = Date.parse(String(startTime ?? ''));
  const prs = new Set((Array.isArray(records) ? records : []).map((r) => String(r?.recordType ?? '')));
  return (Array.isArray(efforts) ? efforts : [])
    .filter((e) => e?.distanceKey && num(e.timeSeconds) > 0)
    .map((e) => {
      const t = num(e.timeSeconds);
      const prior = (history?.bestEfforts.get(e.distanceKey) ?? []).filter((x) => x.date < date);
      const bestPrior = prior.reduce((m, x) => Math.min(m, x.t), Infinity);
      const rank = 1 + prior.filter((x) => x.t < t).length;
      const badge = prs.has(`fastest_${e.distanceKey}`) || prs.has(String(e.distanceKey)) ? 'PB'
        : !prior.length ? 'first'
          : rank === 1 ? 'fastest yet'
            : rank === 2 ? '2nd best'
              : rank === 3 ? '3rd best' : '';
      return {
        label: String(e.display || e.distanceKey),
        time: fmtClock(t),
        badge,
        top: badge === 'PB' || badge === 'fastest yet',
        was: Number.isFinite(bestPrior) ? fmtClock(bestPrior) : '',
        of: prior.length + 1,
      };
    });
}

/**
 * Lifetime distance for the type towards the next milestone (FitGlue's distance-milestone
 * enrichment). Null without it.
 * @param {any} ms  enrichments.distanceMilestone
 */
export function lifetimeProgress(ms) {
  const life = num(ms?.lifetimeDistanceKm);
  if (life <= 0) return null;
  const shown = Number(fmtNumber(life, 1).replace(/,/g, ''));
  const next = num(ms?.nextMilestoneKm);
  const ahead = next > shown;
  return {
    km: fmtNumber(shown, 1),
    next: ahead ? fmtNumber(next) : '',
    toGo: ahead ? fmtNumber(next - shown, 1) : '',
    pct: ahead ? Math.min(100, Math.round((life / next) * 100)) : 100,
    crossed: num(ms?.milestoneKm) > 0 ? fmtNumber(ms.milestoneKm) : '',
    typeLabel: String(ms?.activityTypeLabel || 'running'),
  };
}

// ---------------------------------------------------------------------------
// Strength

/** @param {number} kg */
const kg = (kg) => (kg % 1 === 0 ? String(kg) : kg.toFixed(1));
/** @param {number} m */
const metres = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1).replace(/\.0$/, '')} km` : `${Math.round(m)} m`);

/** One class set (or a run of identical ones): "400 m in 4:30", "2×20 × 6 kg", "1:00". @param {{ reps: number, weightKg: number, durationSeconds: number, distanceMeters: number, count: number }} e */
function stationChip(e) {
  const what = e.distanceMeters > 0 ? metres(e.distanceMeters) : e.reps > 0 ? String(e.reps) : '';
  const load = e.weightKg > 0 ? ` × ${kg(e.weightKg)} kg` : '';
  const time = e.durationSeconds > 0 ? (what ? ` in ${fmtClock(e.durationSeconds)}` : fmtClock(e.durationSeconds)) : '';
  const body = `${what}${load}${time}` || '1 set';
  return e.count > 1 ? `${e.count}×${body}` : body;
}

/** Exercise names compared loosely: case, spacing and underscores ignored. @param {string} s */
const normName = (s) => String(s ?? '').toLowerCase().replace(/[\s_]+/g, ' ').trim();

/**
 * One card per exercise, sets drawn as bars scaled within it: by weight when it was loaded
 * for reps, else by reps, distance or time. The first heaviest set (most reps breaking a
 * tie) is marked; `vsLast` compares with the last earlier session that had the exercise.
 * @param {any[]} sets
 * @param {{ history?: ActivityHistory|null, date?: string, prNames?: Set<string> }} [opts]
 */
export function liftCards(sets, opts = {}) {
  const list = Array.isArray(sets) ? sets : [];
  const date = Date.parse(String(opts.date ?? ''));
  const prNames = new Set([...(opts.prNames ?? [])].map(normName));
  /** @type {Map<string, any[]>} */
  const groups = new Map();
  for (const s of list) {
    const name = String(s?.exerciseName ?? '') || 'Exercise';
    if (!groups.has(name)) groups.set(name, []);
    /** @type {any[]} */ (groups.get(name)).push(s);
  }
  return [...groups].map(([name, raw]) => {
    const rows = raw.map((s) => ({ w: num(s.weightKg), r: num(s.reps), dur: num(s.durationSeconds), dist: num(s.distanceMeters) }));
    const mode = rows.some((x) => x.r > 0 && x.w > 0) ? 'load' : rows.some((x) => x.r > 0) ? 'reps' : rows.some((x) => x.dist > 0) ? 'distance' : rows.some((x) => x.dur > 0) ? 'time' : 'reps';
    const valueOf = (/** @type {typeof rows[number]} */ x) => (mode === 'load' ? x.w : mode === 'reps' ? x.r : mode === 'distance' ? x.dist : x.dur);
    const max = rows.reduce((m, x) => Math.max(m, valueOf(x)), 0) || 1;
    let heavy = 0;
    rows.forEach((x, i) => {
      const h = rows[heavy];
      if (valueOf(x) > valueOf(h) || (valueOf(x) === valueOf(h) && x.r > h.r)) heavy = i;
    });
    const bars = rows.map((x, i) => {
      const v = valueOf(x);
      const top = mode === 'load' ? kg(x.w) : mode === 'reps' ? String(x.r) : mode === 'distance' ? metres(x.dist) : fmtClock(x.dur) || '0:00';
      const bottom = mode === 'load' ? `×${x.r}` : x.w > 0 ? `${kg(x.w)} kg` : mode === 'distance' && x.dur > 0 ? fmtClock(x.dur) : '';
      return { top, bottom, pct: v > 0 ? Math.max(6, Math.round((v / max) * 100)) : 0, heaviest: i === heavy && rows.length > 1 };
    });
    const best = rows[heavy];
    const totals = {
      volume: rows.reduce((s, x) => s + x.r * x.w, 0),
      reps: rows.reduce((s, x) => s + x.r, 0),
      dist: rows.reduce((s, x) => s + x.dist, 0),
      dur: rows.reduce((s, x) => s + x.dur, 0),
    };
    const topSet = mode === 'load' ? `${kg(best.w)} kg × ${best.r}`
      : mode === 'reps' ? `${best.r} reps`
        : mode === 'distance' ? `${metres(best.dist)}${best.w > 0 ? ` @ ${kg(best.w)} kg` : ''}`
          : fmtClock(best.dur);
    const volume = mode === 'load' ? `${fmtNumber(Math.round(totals.volume))} kg`
      : mode === 'reps' ? `${totals.reps} reps`
        : mode === 'distance' ? metres(totals.dist)
          : fmtClock(totals.dur);
    // Versus the last earlier session with this exercise.
    let vsLast = null;
    const past = opts.history?.exercises.get(name)?.filter((d) => d.date < date) ?? [];
    const prev = past[past.length - 1];
    if (prev) {
      const year = Number.isFinite(date) ? new Date(date).getUTCFullYear() : undefined;
      const base = { url: activityUrl(prev.slug), date: dayMonth(prev.date, year) };
      const say = (/** @type {number} */ diff, /** @type {string} */ up, /** @type {string} */ down) =>
        (diff > 0 ? { text: up, tone: 'up' } : diff < 0 ? { text: down, tone: 'down' } : { text: 'same top set', tone: 'same' });
      if (mode === 'load') {
        const dw = best.w - prev.topKg;
        vsLast = dw !== 0
          ? { ...base, ...say(dw, `+${kg(dw)} kg on the top set`, `−${kg(-dw)} kg on the top set`) }
          : { ...base, ...say(best.r - prev.topReps, `+${best.r - prev.topReps} reps at ${kg(best.w)} kg`, `−${prev.topReps - best.r} reps at ${kg(best.w)} kg`) };
      } else if (mode === 'reps') {
        const d = best.r - prev.maxReps;
        vsLast = { ...base, ...say(d, `+${d} reps on the best set`, `−${-d} reps on the best set`) };
      } else if (mode === 'distance') {
        const d = totals.dist - prev.dist;
        vsLast = { ...base, ...(d === 0 ? { text: 'same distance', tone: 'same' } : say(d, `+${metres(d)} in all`, `−${metres(-d)} in all`)) };
      } else {
        const d = totals.dur - prev.dur;
        vsLast = { ...base, ...(d === 0 ? { text: 'same time', tone: 'same' } : say(d, `+${fmtClock(d)} in all`, `−${fmtClock(-d)} in all`)) };
      }
    }
    return {
      name,
      mode,
      bars,
      sets: rows.length,
      few: rows.length <= 2,
      topSet,
      volume,
      isPR: prNames.has(normName(name)) || [...prNames].some((p) => normName(name).startsWith(`${p} (`)),
      vsLast,
    };
  });
}

const PR_KINDS = [
  ['_heaviest_weight', 'heaviest weight'], ['_1rm', '1RM'], ['_set_volume', 'best set volume'],
  ['_max_reps', 'max reps'], ['_volume', 'total volume'], ['_reps', 'max reps'],
];

/** `bench_press_(barbell)` → `Bench Press (barbell)`. @param {string} s */
function exerciseLabel(s) {
  return s.replace(/_/g, ' ').replace(/(^|\s)([a-z])/g, (_, a, b) => a + b.toUpperCase());
}

/**
 * Personal records in plain words. FitGlue's own `displayMessage` is never used: it opens
 * with an emoji, and the site writes its own words.
 * @param {any[]} records
 */
export function prList(records) {
  return (Array.isArray(records) ? records : []).map((r) => {
    const rt = String(r?.recordType ?? '');
    const hit = PR_KINDS.find(([suffix]) => rt.endsWith(suffix));
    const primary = hit ? `${exerciseLabel(rt.slice(0, -hit[0].length))} · ${hit[1]}` : rt.charAt(0).toUpperCase() + rt.slice(1).replace(/_/g, ' ');
    const v = prValue(r?.newValue, r?.unit);
    return { primary, secondary: `${v.val}${v.unit ? ` ${v.unit}` : ''}`, tertiary: prDelta(r?.newValue, r?.previousValue, r?.unit) };
  });
}

/** Exercise names a PR was set on (the record type without its suffix). @param {any[]} records */
export function prExercises(records) {
  const out = new Set();
  for (const r of Array.isArray(records) ? records : []) {
    const rt = String(r?.recordType ?? '');
    const hit = PR_KINDS.find(([suffix]) => rt.endsWith(suffix));
    if (hit) out.add(rt.slice(0, -hit[0].length));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Classes

/**
 * The stations of a class as tiles, one per exercise in the order first done, with what
 * was covered (distance, reps or time) and the heaviest load. Supersets are circuits,
 * lettered, with rounds = the most sets any of their exercises got. Null when the class
 * was logged as a single block.
 * @param {any[]} sets
 */
export function classStations(sets) {
  const list = Array.isArray(sets) ? sets : [];
  if (!list.length) return null;
  /** @type {Map<string, any[]>} */
  const groups = new Map();
  for (const s of list) {
    const name = String(s?.exerciseName ?? '') || 'Exercise';
    if (!groups.has(name)) groups.set(name, []);
    /** @type {any[]} */ (groups.get(name)).push(s);
  }
  if (groups.size === 1 && list.length === 1) return null;
  /** @type {Map<string, { letter: string, rounds: number, names: string[] }>} */
  const circuits = new Map();
  for (const [name, raw] of groups) {
    const id = String(raw.find((s) => s?.supersetId)?.supersetId ?? '');
    if (!id) continue;
    if (!circuits.has(id)) circuits.set(id, { letter: String.fromCharCode(65 + circuits.size), rounds: 0, names: [] });
    const c = /** @type {{ letter: string, rounds: number, names: string[] }} */ (circuits.get(id));
    c.rounds = Math.max(c.rounds, raw.length);
    if (!c.names.includes(name)) c.names.push(name);
  }
  const tiles = [...groups].map(([name, raw]) => {
    const dist = raw.reduce((s, x) => s + num(x?.distanceMeters), 0);
    const reps = raw.reduce((s, x) => s + num(x?.reps), 0);
    const dur = raw.reduce((s, x) => s + num(x?.durationSeconds), 0);
    const load = raw.reduce((m, x) => Math.max(m, num(x?.weightKg)), 0);
    const id = String(raw.find((s) => s?.supersetId)?.supersetId ?? '');
    // Consecutive identical sets collapse to "3×20 × 6kg" chips.
    /** @type {any[]} */
    const combined = [];
    for (const x of raw) {
      const e = { reps: num(x?.reps), weightKg: num(x?.weightKg), durationSeconds: num(x?.durationSeconds), distanceMeters: num(x?.distanceMeters) };
      const last = combined[combined.length - 1];
      if (last && last.reps === e.reps && last.weightKg === e.weightKg && last.durationSeconds === e.durationSeconds && last.distanceMeters === e.distanceMeters) last.count++;
      else combined.push({ ...e, count: 1 });
    }
    return {
      name,
      sets: raw.length,
      headline: dist > 0 ? metres(dist) : reps > 0 ? `${reps} reps` : dur > 0 ? fmtClock(dur) : `${raw.length} sets`,
      load: load > 0 ? `${kg(load)} kg` : '',
      time: dist > 0 && dur > 0 ? fmtClock(dur) : '',
      chips: raw.length > 1 ? combined.map(stationChip) : [],
      circuit: id ? /** @type {{ letter: string }} */ (circuits.get(id)).letter : '',
    };
  });
  return {
    tiles,
    circuits: [...circuits.values()].map((c) => ({ letter: c.letter, rounds: c.rounds, names: c.names.join(' + ') })),
  };
}

// ---------------------------------------------------------------------------
// Pilates / yoga

/** @param {number} n */
function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * The practice so far: this session's place in the year, sessions this month and in all,
 * the run of consecutive weeks with a session ending this week, and the last 26 weeks as
 * a strip. Only sessions up to and including this one count.
 * @param {ActivityHistory|null} history
 * @param {any} file
 */
export function practiceStats(history, file) {
  const key = practiceKey(file);
  const date = startOf(file);
  const all = history?.practice.get(key) ?? [];
  if (!Number.isFinite(date)) return null;
  const upto = all.filter((x) => x.date <= date);
  if (!upto.length) upto.push({ date, slug: String(file?.slug ?? '') });
  const d = new Date(date);
  const y = d.getUTCFullYear();
  const mo = d.getUTCMonth();
  const inYear = upto.filter((x) => new Date(x.date).getUTCFullYear() === y);
  const inMonth = inYear.filter((x) => new Date(x.date).getUTCMonth() === mo);
  /** @type {Map<number, number>} */
  const perWeek = new Map();
  for (const x of upto) perWeek.set(weekStart(x.date), (perWeek.get(weekStart(x.date)) ?? 0) + 1);
  const thisWeek = weekStart(date);
  let streak = 0;
  for (let w = thisWeek; perWeek.has(w); w -= WEEK) streak++;
  const weeks = [];
  for (let i = 25; i >= 0; i--) {
    const w = thisWeek - i * WEEK;
    const count = perWeek.get(w) ?? 0;
    weeks.push({ count, many: count >= 2, current: i === 0, title: `week of ${dayMonth(w)}` });
  }
  return {
    practice: key,
    year: y,
    month: inMonth.length,
    monthName: MONTH_NAMES[mo],
    nthYear: inYear.length,
    nthYearLabel: ordinal(inYear.length),
    total: upto.length,
    weekStreak: streak,
    streak: streak >= 2,
    weeks,
    weeksActive: weeks.filter((w) => w.count > 0).length,
  };
}

const FOCUS = /** @type {Array<[RegExp, string, string]>} */ ([
  [/\bslow\s+flow\b/i, 'Slow flow', 'slow, held, controlled'],
  [/\bdynamic\s+flow\b/i, 'Dynamic flow', 'quicker, flowing sequences'],
  [/\bflow\b/i, 'Flow', 'one move into the next'],
  [/\btower\b/i, 'Tower', 'springs and bars on the tower'],
  [/\breformer\b/i, 'Reformer', 'on the reformer carriage'],
  [/\bglutes?\b/i, 'Glutes', 'glutes and hips'],
  [/\bcore\b/i, 'Core', 'deep core and trunk'],
  [/\babs\b/i, 'Abs', 'abs'],
  [/\bflexibility\b/i, 'Flexibility', 'length and range'],
  [/\bstretch\w*\b/i, 'Stretch', 'long holds'],
  [/\bsculpt\b/i, 'Sculpt', 'light weights, many reps'],
  [/\bsweat\b/i, 'Sweat', 'pace kept up'],
  [/\bhot\s*pod\b|\bhot\b/i, 'Hot', 'in a heated room'],
  [/\bcircuit\b/i, 'Circuit', 'station to station'],
  [/\bmat\b/i, 'Mat', 'on the mat'],
  [/\bbarre\b/i, 'Barre', 'at the barre'],
  [/\bmobility\b/i, 'Mobility', 'joints through their range'],
]);

/**
 * What a calm session worked on, read from its title in title order ("Glutes & Core
 * Pilates Class" → Glutes, Core); the class name itself is not a focus.
 * @param {unknown} title
 */
export function focusWords(title) {
  let rest = String(title ?? '');
  const found = [];
  for (const [re, word, gloss] of FOCUS) {
    const m = re.exec(rest);
    if (!m) continue;
    found.push({ word, gloss, at: m.index });
    rest = rest.slice(0, m.index) + ' '.repeat(m[0].length) + rest.slice(m.index + m[0].length);
  }
  return found.sort((a, b) => a.at - b.at).map(({ word, gloss }) => ({ word, gloss }));
}

/**
 * A calm session's heart: the average, the full range and the band the middle half of the
 * session sat in, with a quiet line chart. Null without a heart rate.
 * @param {any} series @param {any} hr  enrichments.heartRate @param {number} seconds
 */
export function steadyHeart(series, hr, seconds) {
  const vals = (Array.isArray(series?.heartRate) ? series.heartRate : []).filter((v) => typeof v === 'number' && v > 0).sort((a, b) => a - b);
  const avg = Math.round(num(hr?.avgBpm) || (vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0));
  if (!avg) return null;
  const min = Math.round(num(hr?.minBpm) || vals[0] || 0);
  const max = Math.round(num(hr?.maxBpm) || vals[vals.length - 1] || 0);
  const q = (/** @type {number} */ p) => Math.round(vals[Math.min(vals.length - 1, Math.floor(p * (vals.length - 1)))]);
  return {
    avg,
    range: min && max ? `${min}–${max}` : '',
    band: vals.length >= 4 ? `${q(0.25)}–${q(0.75)}` : '',
    chart: lineChart(Array.isArray(series?.heartRate) ? series.heartRate : [], { label: 'Heart rate', unit: 'bpm', h: 110, x: { kind: 'clock', seconds } }),
  };
}

// ---------------------------------------------------------------------------
// Fine print and anchors

/**
 * The small numbers under every page: calories (with a food comparison written here, not
 * FitGlue's), effort, training load, recovery, streak, weather. Only what the activity has;
 * a calm session keeps calories and weather.
 * @param {{ calories: { kcal: number, source: string }, en: any, has: (k: string) => boolean, kind: Kind, entry?: any }} ctx
 */
export function finePrint({ calories, en, has, kind, entry = {} }) {
  const cells = [];
  if (num(calories?.kcal) > 0) cells.push({ value: fmtNumber(calories.kcal), unit: 'kcal', label: 'calories', note: foodComparison(calories.kcal) });
  const calm = kind === 'mind';
  if (!calm && has('EFFORT_SCORE') && num(en?.effort?.score) > 0) cells.push({ value: String(Math.round(en.effort.score)), unit: '/100', label: 'effort', note: String(en.effort.band || '').toLowerCase() });
  if (!calm && has('TRAINING_LOAD') && num(en?.trainingLoad?.trimp) > 0) cells.push({ value: String(Math.round(en.trainingLoad.trimp)), unit: 'trimp', label: 'training load', note: String(en.trainingLoad.bucket || '').toLowerCase() });
  if (!calm && has('RECOVERY_ADVISOR') && num(en?.recovery?.hoursToRecover) > 0) cells.push({ value: String(Math.round(en.recovery.hoursToRecover)), unit: 'h', label: 'recover in', note: '' });
  if (!calm && has('STREAK_TRACKER') && num(en?.streak?.currentDays) >= 2) cells.push({ value: String(en.streak.currentDays), unit: 'days', label: 'active streak', note: num(en.streak.longestDays) > 0 ? `best ${en.streak.longestDays}` : '' });
  const temp = typeof en?.weather?.tempC === 'number' ? en.weather.tempC : typeof entry?.tempC === 'number' ? entry.tempC : null;
  if (temp !== null) {
    const desc = String(en?.weather?.weatherDescription ?? entry?.weatherDescription ?? '').toLowerCase();
    cells.push({ value: `${Math.round(temp)}°`, unit: 'C', label: 'weather', note: desc });
  }
  return cells;
}

/**
 * The headline numbers for a kind. Only figures the activity has: never a dash.
 * @param {Kind} kind
 * @param {{ durationS?: number, distanceM?: number, avgBpm?: number, maxBpm?: number, calories?: number,
 *   pace?: number, speedKmh?: number, sets?: number, reps?: number, volumeKg?: number, topKg?: number,
 *   hotMinutes?: number, elevationM?: number, practice?: any }} m
 */
export function kindAnchors(kind, m) {
  const dur = num(m.durationS);
  const dist = num(m.distanceM);
  const out = [];
  const minutes = () => dur > 0 && out.push({ value: String(Math.round(dur / 60)), unit: 'min', label: 'minutes' });
  const avgHr = () => num(m.avgBpm) > 0 && out.push({ value: String(Math.round(num(m.avgBpm))), unit: 'bpm', label: 'avg hr' });
  const km = () => dist > 0 && out.push({ value: dist >= 10000 ? (dist / 1000).toFixed(1) : (dist / 1000).toFixed(2), unit: 'km', label: 'distance' });
  const time = () => dur > 0 && out.push({ value: fmtClock(dur), unit: '', label: 'time' });
  if (kind === 'run' || kind === 'walk') {
    km(); time();
    const p = num(m.pace) > 0 ? num(m.pace) : dur > 0 && dist > 0 ? dur / (dist / 1000) : 0;
    if (p > 0) out.push({ value: fmtPace(p), unit: '/km', label: 'avg pace' });
    avgHr();
  } else if (kind === 'ride') {
    km(); time();
    const s = num(m.speedKmh) > 0 ? num(m.speedKmh) : dur > 0 && dist > 0 ? dist / 1000 / (dur / 3600) : 0;
    if (s > 0) out.push({ value: fmtNumber(s, 1), unit: 'km/h', label: 'avg speed' });
    if (num(m.elevationM) > 0) out.push({ value: String(Math.round(num(m.elevationM))), unit: 'm', label: 'climbed' });
    else avgHr();
  } else if (kind === 'strength') {
    if (num(m.volumeKg) > 0) out.push({ value: fmtNumber(Math.round(num(m.volumeKg))), unit: 'kg', label: 'volume moved' });
    if (num(m.topKg) > 0) out.push({ value: kg(num(m.topKg)), unit: 'kg', label: 'heaviest set' });
    if (num(m.sets) > 0) out.push({ value: String(m.sets), unit: '', label: 'sets' });
    if (num(m.reps) > 0) out.push({ value: fmtNumber(num(m.reps)), unit: '', label: 'reps' });
    minutes();
  } else if (kind === 'class') {
    minutes();
    if (num(m.hotMinutes) > 0) out.push({ value: String(Math.round(num(m.hotMinutes))), unit: 'min', label: 'in zones 4–5' });
    if (num(m.maxBpm) > 0) out.push({ value: String(Math.round(num(m.maxBpm))), unit: 'bpm', label: 'peak hr' });
    if (num(m.calories) > 0) out.push({ value: fmtNumber(num(m.calories)), unit: 'kcal', label: 'calories' });
  } else if (kind === 'mind') {
    minutes();
    const p = m.practice;
    if (p?.nthYear > 0) out.push({ value: p.nthYearLabel, unit: '', label: `${p.practice} of ${p.year}` });
    if (p?.weekStreak >= 2) out.push({ value: String(p.weekStreak), unit: 'wk', label: 'week streak' });
    avgHr();
  } else {
    minutes(); avgHr();
    if (num(m.calories) > 0) out.push({ value: fmtNumber(num(m.calories)), unit: 'kcal', label: 'calories' });
    km();
  }
  return out.slice(0, 4);
}
