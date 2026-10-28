// @ts-check
/**
 * Personal-record names and grouping, shared by the /life pages (F5.3).
 *
 * FitGlue exports a PR as its raw store key (`recordType`), not a display
 * name: `fastest_5k`, `deadlift_1rm`, `leg_press_horizontal_(machine)_1rm`,
 * `seated_cable_row_-_bar_grip_heaviest_weight`, `hybrid_race_hyrox_wall_balls`.
 * The key grammar is FitGlue's personal_records provider (records.go +
 * formatRecordTypeForDisplay in personal_records.go); this module is the
 * site's label map for it. `recordLabel` names one key; `latestRecords` merges
 * PR lists (profile.topPrs, every roundup's prsAchieved) into the current best
 * per key.
 */

/** Strength suffixes, longest first so `_set_volume` wins over `_volume`. */
const STRENGTH = /** @type {const} */ ([
  ['_heaviest_weight', 'heaviest', 'HEAVIEST LIFT'],
  ['_set_volume', 'set_volume', 'BEST SET'],
  ['_volume', 'volume', 'SESSION VOLUME'],
  ['_1rm', '1rm', 'EST. 1RM'],
  ['_reps', 'reps', 'MOST REPS'],
]);

/** Distance keys (after `fastest_` / `fastest_ride_`) → label, in distance order. */
export const DISTANCES = /** @type {Record<string, string>} */ ({
  '100m': '100 M', '200m': '200 M', '400m': '400 M', '500m': '500 M',
  '1k': '1K', '1_mile': '1 MILE', '2k': '2K', '2_mile': '2 MILES', '5k': '5K', '5_mile': '5 MILES',
  '10k': '10K', '10_mile': '10 MILES', '15_mile': '15 MILES', '20k': '20K', 'half_marathon': 'HALF MARATHON',
  '20_mile': '20 MILES', '25_mile': '25 MILES', '30k': '30K', '30_mile': '30 MILES', '40k': '40K',
  'marathon': 'MARATHON', '50k': '50K', 'ultra_marathon': 'ULTRA', '100k': '100K',
});
const DISTANCE_ORDER = Object.keys(DISTANCES);

/** Hybrid-race stations, in race order. */
export const STATIONS = /** @type {Record<string, string>} */ ({
  total_time: 'TOTAL TIME',
  run: 'RUNNING', running: 'RUNNING',
  ski_erg: 'SKIERG', skierg: 'SKIERG',
  sled_push: 'SLED PUSH',
  sled_pull: 'SLED PULL',
  burpee_broad_jump: 'BURPEE BROAD JUMPS', burpee_broad_jumps: 'BURPEE BROAD JUMPS',
  row: 'ROW', rowing: 'ROW',
  farmers_carry: 'FARMERS CARRY', farmers_walk: 'FARMERS CARRY',
  sandbag_lunges: 'SANDBAG LUNGES', sandbag_lunge: 'SANDBAG LUNGES',
  wall_balls: 'WALL BALLS', wall_ball: 'WALL BALLS',
  roxzone: 'ROXZONE',
});
const STATION_ORDER = Object.keys(STATIONS);

/** FitGlue pkg/hyrox division keys (per-division records since fitglue#96), longest first. */
export const HYROX_DIVISIONS = /** @type {[string, string][]} */ ([
  ['women_pro_doubles', "Pro Women's Doubles"], ['men_pro_doubles', "Pro Men's Doubles"],
  ['mixed_doubles', 'Mixed Doubles (Open)'], ['women_doubles', "Open Women's Doubles"], ['men_doubles', "Open Men's Doubles"],
  ['women_open', "Open Women's Solo"], ['men_open', "Open Men's Solo"], ['women_pro', "Pro Women's Solo"], ['men_pro', "Pro Men's Solo"],
]);

/**
 * `leg_press_horizontal_(machine)` → `Leg Press Horizontal (Machine)`;
 * `seated_cable_row_-_bar_grip` → `Seated Cable Row – Bar Grip`.
 * @param {string} s
 */
export function exerciseName(s) {
  return s
    .replace(/_/g, ' ')
    .replace(/\s+-\s+/g, ' – ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/(^|[\s(\/–-])([a-z])/g, (_, pre, c) => pre + c.toUpperCase())
    .replace(/\b1rm\b/gi, '1RM');
}

/**
 * @typedef {object} RecordLabel
 * @property {'run'|'ride'|'hyrox'|'strength'|'other'} group
 * @property {string} name     display name of the thing (`5K`, `Deadlift`, `WALL BALLS`)
 * @property {string} metric   what was measured (`FASTEST`, `EST. 1RM`, `HEAVIEST LIFT`, …)
 * @property {string} metricKey  stable id of the metric (`fastest`, `1rm`, `heaviest`, …)
 * @property {string} race     hybrid races: `HYROX`, `ATHX`; else ''
 * @property {string} [division]  Hyrox per-division records: the division's label ("Open Men's Solo")
 * @property {number} order    sort position inside the group (distance / race order)
 */

/** @param {unknown} recordType @returns {RecordLabel} */
export function recordLabel(recordType) {
  const raw = String(recordType || '').trim();
  const key = raw.toLowerCase();
  const base = { race: '', order: 999 };

  for (const [suffix, metricKey, metric] of STRENGTH) {
    if (key.endsWith(suffix) && key.length > suffix.length) {
      return { ...base, group: 'strength', name: exerciseName(raw.slice(0, -suffix.length)), metric, metricKey };
    }
  }

  const hybrid = key.match(/^hybrid_race_([a-z0-9]+)_(.+)$/);
  if (hybrid) {
    let station = hybrid[2];
    let division = '';
    for (const [k, label] of HYROX_DIVISIONS) {
      if (station.startsWith(`${k}_`)) {
        division = label;
        station = station.slice(k.length + 1);
        break;
      }
    }
    const run = station.match(/^run_(\d)$/);
    const i = STATION_ORDER.indexOf(station);
    return {
      ...base, group: 'hyrox', race: hybrid[1].toUpperCase(), division,
      name: run ? `RUN ${run[1]}` : STATIONS[station] || exerciseName(station).toUpperCase(),
      metric: 'FASTEST', metricKey: 'fastest', order: run ? 100 + Number(run[1]) : i === -1 ? 500 : i,
    };
  }

  if (key === 'longest_run') return { ...base, group: 'run', name: 'LONGEST RUN', metric: 'FURTHEST', metricKey: 'longest', order: 900 };
  if (key === 'longest_ride') return { ...base, group: 'ride', name: 'LONGEST RIDE', metric: 'FURTHEST', metricKey: 'longest', order: 900 };
  if (key === 'highest_elevation_gain') return { ...base, group: 'run', name: 'MOST CLIMBING', metric: 'ELEVATION', metricKey: 'elevation', order: 950 };

  const ride = key.match(/^fastest_ride_(.+)$/);
  if (ride && DISTANCES[ride[1]]) {
    return { ...base, group: 'ride', name: DISTANCES[ride[1]], metric: 'FASTEST', metricKey: 'fastest', order: DISTANCE_ORDER.indexOf(ride[1]) };
  }
  const dist = key.replace(/^fastest_/, '');
  if (DISTANCES[dist]) {
    return { ...base, group: 'run', name: DISTANCES[dist], metric: 'FASTEST', metricKey: 'fastest', order: DISTANCE_ORDER.indexOf(dist) };
  }
  return { ...base, group: 'other', name: exerciseName(raw).toUpperCase() || 'RECORD', metric: 'BEST', metricKey: 'best' };
}

/**
 * The current record per `recordType` from any number of PR lists: the
 * latest `achievedAt` wins (a record is only re-set by beating it), ties go to
 * the later list. Input order is otherwise irrelevant.
 * @param {...(any[]|undefined|null)} lists
 * @returns {any[]}
 */
export function latestRecords(...lists) {
  /** @type {Map<string, any>} */
  const best = new Map();
  for (const list of lists) {
    for (const pr of Array.isArray(list) ? list : []) {
      if (!pr || typeof pr.recordType !== 'string' || !Number.isFinite(Number(pr.value))) continue;
      const cur = best.get(pr.recordType);
      const t = Date.parse(pr.achievedAt || '') || 0;
      const ct = cur ? Date.parse(cur.achievedAt || '') || 0 : -1;
      if (!cur || t >= ct) best.set(pr.recordType, pr);
    }
  }
  return [...best.values()];
}
