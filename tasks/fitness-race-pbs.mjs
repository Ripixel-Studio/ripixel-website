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
 * The board also takes what used to sit on the PB wall beside it, so no number shows twice:
 * a Hyrox division's row carries its best station, Roxzone and run splits (hyroxWall), and
 * a road distance's row weighs the fastest stretch of that distance inside any run
 * (Strava's best effort) and, for the 5k, his best parkrun against the race PB.
 *
 * Road rows are standard distances only (ROAD_ORDER): a road race of any other length
 * (a "Burghley 7") stays on the races list but claims no PB. A road row's headline is
 * the fastest of race, parkrun and best effort, labelled with where it came from, and
 * the others sit underneath it: a road race's time is elapsed time, not chip time, so
 * the best effort inside the same run is often quicker.
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

/** The road distances that get a PB row, in distance order. */
export const ROAD_ORDER = ['5k', '10k', '10 miles', 'half marathon', 'marathon'];

/** The classifier's other spellings of a road distance. */
const ROAD_ALIASES = /** @type {Record<string, string>} */ ({
  '5km': '5k', '10km': '10k', '10 mile': '10 miles', '10mi': '10 miles', half: 'half marathon',
  'half-marathon': 'half marathon', 'half mara': 'half marathon', '21.1k': 'half marathon', '42.2k': 'marathon',
});

/** A road variant's standard distance (lower case), or '' when it is not one. @param {string} v */
export function roadDistance(v) {
  const k = String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  const d = ROAD_ALIASES[k] || k;
  return ROAD_ORDER.includes(d) ? d : '';
}

/** Attempts further apart than this (as a share of the shortest) are not one course. */
export const DISTANCE_SPREAD = 0.1;

/** How each road distance is written on its row. */
const ROAD_LABEL = /** @type {Record<string, string>} */ ({ '5k': '5k', '10k': '10k', '10 miles': '10 miles', 'half marathon': 'Half marathon', marathon: 'Marathon' });

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
 * @typedef {{ kind: 'race' | 'parkrun' | 'effort', seconds: number, time: string, date: string, url: string, official?: boolean, where?: string }} Candidate
 */

/** The headline's label and an also-ran's label for each kind. */
const KIND_LABEL = { race: ['race PB', 'race PB'], parkrun: ['PB · parkrun', 'parkrun PB'], effort: ['PB · best effort', 'best effort'] };

/** @param {Candidate} c @param {boolean} lead */
function labelOf(c, lead) {
  const base = KIND_LABEL[c.kind][lead ? 0 : 1];
  return c.where ? `${base} · ${c.where}` : base;
}

/**
 * One row: the variant, its best (earliest on a tie), the attempts, and the latest
 * attempt's gap to the best when the latest is not the PB. `others` (a road row's parkrun
 * and best effort) compete for the headline; whichever is fastest leads (the race on a
 * tie), the rest are listed under it in `also`.
 * @param {string} name @param {Attempt[]} attempts  oldest first @param {Candidate[]} [others]
 */
function buildRow(name, attempts, others = []) {
  const latest = attempts[attempts.length - 1];
  const count = attempts.length;
  const base = { name, attempts: count, attemptsLabel: `${count} ${count === 1 ? 'go' : 'goes'}` };
  if (distancesVary(attempts)) {
    return {
      ...base, varies: true, best: null, latest: null, latestIsPb: false,
      list: [...attempts].reverse().map((a) => ({ url: a.url, date: a.date, distance: a.distance, time: a.time })),
    };
  }
  const raceBest = attempts.reduce((b, a) => (a.seconds < b.seconds ? a : b));
  const source = (/** @type {{ official?: boolean }} */ a) => (a.official ? 'official time' : 'elapsed time');
  /** @type {Candidate} */
  const race = { kind: 'race', seconds: raceBest.seconds, time: raceBest.time, date: raceBest.date, url: raceBest.url, official: raceBest.official };
  const ranked = [race, ...others.filter((c) => c.seconds > 0)]
    .sort((a, b) => a.seconds - b.seconds || (a.kind === 'race' ? -1 : b.kind === 'race' ? 1 : 0));
  const lead = ranked[0];
  const show = (/** @type {Candidate} */ c, /** @type {boolean} */ first) => ({
    kind: c.kind, url: c.url, date: c.date, time: c.time, official: !!c.official, label: labelOf(c, first),
    source: c.kind === 'effort' ? 'fastest stretch inside any run (Strava best effort)' : source(c),
  });
  // The latest race is already on the row when it is the race PB (headline or not).
  const shown = latest === raceBest;
  return {
    ...base, varies: false, list: [],
    best: show(lead, true), also: ranked.slice(1).map((c) => show(c, false)),
    latestIsPb: count > 1 && shown && lead.kind === 'race',
    latest: shown ? null : { url: latest.url, date: latest.date, time: latest.time, official: latest.official, source: source(latest), gap: deltaClock(latest.seconds - lead.seconds) },
  };
}

/**
 * The board: one group per race type he has done, in RACE_TYPES order, each with one row
 * per variant. Empty when there are no races (the page then has no section).
 *
 * A Hyrox race is filed under its official division label (the ROXFIT `race.division`)
 * when it has one, so its row lines up with the division's splits.
 * @param {any[]} activities  `fitnessActivities`
 * @param {{ hyroxSplits?: { label: string, stations: any[], runs: any[] }[], efforts?: { name: string, display: string, date: string, url?: string }[] }} [extras]
 *   hyroxSplits: hyroxWall's divisions; efforts: the wall's on-foot tiles (name `5K`, `HALF MARATHON`, ...)
 */
export function buildRacePbs(activities, extras = {}) {
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
    const division = type === 'hyrox' ? String(file.race?.division?.label || '').trim() : '';
    let variant = division || String(file.raceVariant || '').trim() || (RACE_TYPES.find(([k]) => k === type)?.[1] ?? 'Other');
    if (type === 'road') {
      const d = roadDistance(variant);
      if (!d) continue; // not a standard distance: on the races list, not the PB board
      variant = ROAD_LABEL[d];
    }
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
    const parkrunBest = key === 'road' ? bestParkrun(byType.get('parkrun')) : null;
    // The type's ink: the tag most of its races carry.
    const tags = new Map();
    for (const v of variants) for (const a of v.list) tags.set(a.tag, (tags.get(a.tag) || 0) + 1);
    const tag = [...tags.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const count = variants.reduce((n, v) => n + v.list.length, 0);
    return {
      key, label, typeClass: tagTheme(tag).typeClass,
      races: count, racesLabel: `${count} race${count === 1 ? '' : 's'}`,
      rows: variants.map((v) => withExtras(key, v.name, v.list, extras, parkrunBest)),
    };
  });
}

/** @param {string} s */
const norm = (s) => String(s ?? '').trim().toLowerCase();

/**
 * His fastest parkrun on any course, as a 5k road row's candidate.
 * @param {Map<string, Attempt[]> | undefined} courses
 * @returns {Candidate | null}
 */
function bestParkrun(courses) {
  /** @type {(Attempt & { course: string }) | null} */
  let best = null;
  for (const [course, list] of courses || []) {
    for (const a of list) if (!best || a.seconds < best.seconds) best = { ...a, course };
  }
  return best && { kind: 'parkrun', seconds: best.seconds, time: best.time, date: best.date, url: best.url, official: best.official, where: best.course };
}

/**
 * Build a row with its extras: a Hyrox division's best splits; a road distance's best
 * effort (and, for the 5k, best parkrun) competing for its headline.
 * @param {string} type @param {string} name @param {Attempt[]} list
 * @param {NonNullable<Parameters<typeof buildRacePbs>[1]>} extras
 * @param {Candidate | null} parkrunBest
 */
function withExtras(type, name, list, extras, parkrunBest) {
  if (type === 'road') {
    const e = (extras.efforts || []).find((t) => norm(t.name) === norm(name));
    /** @type {Candidate[]} */
    const others = [];
    if (e) others.push({ kind: 'effort', seconds: parseClock(e.display), time: e.display, date: e.date, url: e.url || '' });
    if (parkrunBest && norm(name) === '5k') others.push(parkrunBest);
    const row = buildRow(name, list, others);
    return { ...row, effort: e ? { time: e.display, date: e.date } : null };
  }
  const row = buildRow(name, list);
  if (type === 'hyrox') {
    const d = (extras.hyroxSplits || []).find((h) => norm(h.label) === norm(row.name));
    const has = !!d && (d.stations.length > 0 || d.runs.length > 0);
    return { ...row, splits: has ? { stations: d.stations, runs: d.runs, label: d.label } : null };
  }
  return row;
}

/**
 * The on-foot best-effort names a road race row has taken over (so the training half
 * of the board leaves them out).
 * @param {ReturnType<typeof buildRacePbs>} groups
 */
export function absorbedEfforts(groups) {
  const road = groups.find((g) => g.key === 'road');
  return new Set((road?.rows || []).filter((r) => r.effort).map((r) => norm(r.name)));
}
