// @ts-check
/**
 * The race PB board on /life/fitness: every race he has done, grouped by the export's
 * `raceType`, one row per `raceVariant` (a Hyrox division, a Spartan format, a road
 * distance, a trail event, a parkrun course).
 *
 * The time a race counts with:
 *   - Hyrox: the official total from the file's `race` key (raceOf, the ROXFIT splits);
 *   - parkrun: the official finish time from the parkrun result (parkrunInfo);
 *   - anything else, and either of those without the official time: the elapsed duration.
 *
 * A row whose attempts differ by more than DISTANCE_SPREAD in distance (a lapped trail
 * event where he chooses how far to go) claims no PB: it lists the attempts instead.
 *
 * Colours come from each type's tag (`fit-type--<tag>`, tasks/fitness-theme.mjs), read
 * off the race files themselves, so a type has no colour of its own.
 */
import { raceOf, clock, deltaClock } from './fitness-hyrox.mjs';
import { parkrunInfo } from './fitness-highlights.mjs';
import { parseClock } from './fitness-share-models.mjs';
import { tagOf, tagTheme } from './fitness-theme.mjs';
import { fmt } from './life-clock.mjs';
import { km } from './fitness-life.mjs';

export const RACE_PBS_ANCHOR = 'race-pbs';
export const RACE_PBS_HREF = `/life/fitness#${RACE_PBS_ANCHOR}`;

/** Race types in board order, with the word each one is shown under. */
export const RACE_TYPES = /** @type {[string, string][]} */ ([
  ['hyrox', 'Hyrox'], ['deka', 'DEKA'], ['athx', 'ATHX'], ['spartan', 'Spartan'], ['road', 'Road'],
  ['trail', 'Trail'], ['parkrun', 'parkrun'], ['triathlon', 'Triathlon'], ['other', 'Other'],
]);

/** Road variants in distance order; any other road variant follows these. */
export const ROAD_ORDER = ['5k', '10k', '10 miles', 'half marathon', 'marathon'];

/** Attempts further apart than this (as a share of the shortest) are not one course. */
export const DISTANCE_SPREAD = 0.1;

/** @param {unknown} v */
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** `11 JUL 2026` @param {string} iso */
function raceDate(iso) {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? '' : fmt(new Date(t), { day: 'numeric', month: 'short', year: 'numeric' }).toUpperCase();
}

/**
 * The time one race counts with, and where it came from.
 * @param {any} file  an activity file
 * @param {string} type  its raceType
 * @returns {{ seconds: number, official: boolean }}
 */
export function raceTime(file, type) {
  if (type === 'hyrox') {
    const total = num(raceOf(file)?.totalSeconds);
    if (total > 0) return { seconds: total, official: true };
  }
  if (type === 'parkrun') {
    const secs = parseClock(parkrunInfo(file)?.time);
    if (secs > 0) return { seconds: secs, official: true };
  }
  const elapsed = num(file?.entry?.durationSeconds) || num(file?.activity?.durationSeconds);
  return { seconds: elapsed, official: false };
}

/**
 * @typedef {{ slug: string, url: string, date: string, ts: number, seconds: number, time: string, official: boolean, metres: number, distance: string, tag: string }} Attempt
 */

/** @param {Attempt[]} attempts */
function distancesVary(attempts) {
  const ds = attempts.map((a) => a.metres).filter((m) => m > 0);
  if (ds.length < 2) return false;
  const lo = Math.min(...ds);
  return (Math.max(...ds) - lo) / lo > DISTANCE_SPREAD;
}

/**
 * One row: the variant, its best (earliest on a tie), the attempts, and the latest
 * attempt's gap to the best when the latest is not the PB.
 * @param {string} name @param {Attempt[]} attempts  oldest first
 */
function buildRow(name, attempts) {
  const latest = attempts[attempts.length - 1];
  const count = attempts.length;
  const base = { name, attempts: count, attemptsLabel: `${count} ${count === 1 ? 'go' : 'goes'}` };
  if (distancesVary(attempts)) {
    return {
      ...base, varies: true, best: null, latest: null, latestIsPb: false,
      list: [...attempts].reverse().map((a) => ({ url: a.url, date: a.date, distance: a.distance, time: a.time })),
    };
  }
  const best = attempts.reduce((b, a) => (a.seconds < b.seconds ? a : b));
  const show = (/** @type {Attempt} */ a) => ({ url: a.url, date: a.date, time: a.time, official: a.official, source: a.official ? 'official time' : 'elapsed time' });
  return {
    ...base, varies: false, list: [],
    best: show(best), latestIsPb: count > 1 && latest === best,
    latest: latest === best ? null : { ...show(latest), gap: deltaClock(latest.seconds - best.seconds) },
  };
}

/**
 * The board: one group per race type he has done, in RACE_TYPES order, each with one row
 * per variant. Empty when there are no races (the page then has no section).
 * @param {any[]} activities  `fitnessActivities`
 */
export function buildRacePbs(activities) {
  /** @type {Map<string, Map<string, Attempt[]>>} */
  const byType = new Map();
  const known = new Set(RACE_TYPES.map(([k]) => k));
  for (const file of Array.isArray(activities) ? activities : []) {
    if (!file?.isRace || !file.raceType) continue;
    const slug = String(file.slug ?? file.entry?.showcaseId ?? '');
    const start = String(file.activity?.startTime ?? file.entry?.startTime ?? '');
    const ts = Date.parse(start);
    if (!slug || Number.isNaN(ts)) continue;
    const type = known.has(file.raceType) ? file.raceType : 'other';
    const { seconds, official } = raceTime(file, type);
    if (seconds <= 0) continue;
    const metres = num(file.entry?.distanceMeters) || num(file.activity?.distanceMeters);
    const variant = String(file.raceVariant || '').trim() || (RACE_TYPES.find(([k]) => k === type)?.[1] ?? 'Other');
    const attempt = {
      slug, url: `/life/activity/${slug}`, date: raceDate(start), ts, seconds, time: clock(seconds), official,
      metres, distance: metres > 0 ? `${km(metres)} km` : '', tag: tagOf(file).tag,
    };
    if (!byType.has(type)) byType.set(type, new Map());
    const variants = /** @type {Map<string, Attempt[]>} */ (byType.get(type));
    variants.set(variant, [...(variants.get(variant) || []), attempt]);
  }

  return RACE_TYPES.filter(([k]) => byType.has(k)).map(([key, label]) => {
    const variants = [.../** @type {Map<string, Attempt[]>} */ (byType.get(key)).entries()]
      .map(([name, list]) => ({ name, list: list.sort((a, b) => a.ts - b.ts) }));
    /** @param {string} n */
    const roadRank = (n) => { const i = ROAD_ORDER.indexOf(n.toLowerCase()); return i < 0 ? ROAD_ORDER.length : i; };
    variants.sort((a, b) => (key === 'road' ? roadRank(a.name) - roadRank(b.name) : 0)
      || b.list.length - a.list.length || a.name.localeCompare(b.name));
    // The type's ink: the tag most of its races carry.
    const tags = new Map();
    for (const v of variants) for (const a of v.list) tags.set(a.tag, (tags.get(a.tag) || 0) + 1);
    const tag = [...tags.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const count = variants.reduce((n, v) => n + v.list.length, 0);
    return {
      key, label, typeClass: tagTheme(tag).typeClass,
      races: count, racesLabel: `${count} race${count === 1 ? '' : 's'}`,
      rows: variants.map((v) => buildRow(v.name, v.list)),
    };
  });
}
