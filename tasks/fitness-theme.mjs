// @ts-check
/**
 * The site's one activity taxonomy (the tag), shared by every /life page.
 *
 * Every activity gets exactly one tag, decided once, and every colour, label, glyph,
 * filter chip and per-type stat on the site comes from it:
 *
 *   run  ride  spin  hybrid  class  strength  pilates  yoga  walk  other
 *
 * plus an independent Race marker (`isRace`): a badge on top of the tag, never a tag of
 * its own, so a Hyrox race is a Hybrid tag with a Race badge and a parkrun is
 * a Run with a Race badge.
 *
 * Source of truth: the FitGlue export's top-level `tag` and `isRace` on each activity
 * file (and on its `entry`). When an activity has no valid `tag`, `siteTagOf` decides it
 * locally (the one fallback). `assemble` in tasks/fitness-fetch.mjs stamps the decision
 * onto the file, its `entry` and the index entry, so every view reads the same answer
 * through `tagOf` / `themeOf`. Calendar entries with no activity yet use `tagOfTitle`
 * (tasks/life-clock.mjs, which the page also runs in the browser), over the same keys.
 *
 * The inks live in CSS as `.fit-type--<tag>` (personal/assets/styles/main/fitness-types.css),
 * each setting `--type`, `--type-on` and `--type-text`; `TYPE_INKS` repeats them as hex for
 * drawings that cannot read CSS (the share cards), kept in step by a test.
 */
import { activityKind } from './fitness-activity-kinds.mjs';
import { tagOfTitle } from './life-clock.mjs';

/** @typedef {'run'|'ride'|'spin'|'hybrid'|'class'|'strength'|'pilates'|'yoga'|'walk'|'other'} Tag */
/** @typedef {Tag} TypeKey */

/** Tag → label, glyph and what goes in it, in the order the filter chips and the key show them. */
export const TAGS = /** @type {Record<Tag, { label: string, glyph: string, note: string }>} */ ({
  run: { label: 'Run', glyph: 'RUN', note: 'runs, parkruns, the treadmill' },
  ride: { label: 'Ride', glyph: 'RDE', note: 'out on the bike' },
  spin: { label: 'Spin', glyph: 'SPN', note: 'spin classes, the indoor bike' },
  hybrid: { label: 'Hybrid', glyph: 'HYB', note: 'Hyrox, DEKA, ATHX and Spartan races, plus hybrid classes, sims and PT' },
  class: { label: 'Class', glyph: 'CLS', note: 'bootcamp, circuits, HIIT and the rest' },
  strength: { label: 'Strength', glyph: 'GYM', note: 'weights, PT and the home workouts' },
  pilates: { label: 'Pilates', glyph: 'PIL', note: 'mat and reformer' },
  yoga: { label: 'Yoga', glyph: 'YOG', note: 'yoga, mostly hot' },
  walk: { label: 'Walk', glyph: 'WLK', note: 'walks and hikes' },
  other: { label: 'Other', glyph: 'ETC', note: 'everything else' },
});

/** @param {unknown} k @returns {k is Tag} */
export function isTag(k) {
  return typeof k === 'string' && Object.prototype.hasOwnProperty.call(TAGS, k);
}

/** Tags an older export (or cached data) may still carry, and the tag each became. */
const LEGACY_TAGS = /** @type {Record<string, Tag>} */ ({ hyrox: 'hybrid' });

/**
 * A tag as the site knows it: a current tag as is, a legacy one (`hyrox`) as its
 * successor, anything else undefined.
 * @param {unknown} k @returns {Tag | undefined}
 */
export function normTag(k) {
  if (isTag(k)) return k;
  return typeof k === 'string' && Object.prototype.hasOwnProperty.call(LEGACY_TAGS, k) ? LEGACY_TAGS[k] : undefined;
}

/** `ACTIVITY_TYPE_TRAIL_RUN` → `TRAIL_RUN` @param {unknown} t */
const bare = (t) => String(t ?? '').replace(/^ACTIVITY_TYPE_/, '');

const RUN_TYPES = new Set(['RUN', 'TRAIL_RUN', 'VIRTUAL_RUN']);
const WALK_TYPES = new Set(['WALK', 'HIKE', 'SNOWSHOE']);
const RIDE_TYPES = new Set(['RIDE', 'GRAVEL_RIDE', 'MOUNTAIN_BIKE_RIDE', 'EBIKE_RIDE', 'EMOUNTAIN_BIKE_RIDE', 'VIRTUAL_RIDE', 'VELOMOBILE', 'HANDCYCLE']);
const CLASS_TYPES = new Set(['CROSSFIT', 'HIGH_INTENSITY_INTERVAL_TRAINING', 'ELLIPTICAL', 'STAIR_STEPPER']);
/** A home WORKOUT is strength unless its title names a class. */
const CLASS_WORDS = /\b(class|bootcamp|crossfit|hiit|circuits?|box ?fit|body conditioning|instructor'?s choice|lyft fit|groove|kettlebell|burn|step|amrap|emom|metcon|intervals?)\b/i;
/** A run for time: a parkrun, a marathon, a race, a 10k. */
const RUN_RACE = /\b(parkrun|park run|marathon|race|\d+(\.\d+)?\s?k|\d+(\.\d+)?\s?km|\d+\s?miles?)\b/i;
const NOT_RACE = /\b(zone|treadmill|recovery|easy|sprints?|club|training|tempo)\b/i;

/** The sets logged on the file itself (an index entry alone carries only a count). @param {any} file */
function loggedSets(file) {
  const sessions = Array.isArray(file?.activity?.activityData?.sessions) ? file.activity.activityData.sessions : [];
  return sessions.reduce((n, s) => n + (Array.isArray(s?.strengthSets) ? s.strengthSets.length : 0), 0);
}

/**
 * The one local fallback: an activity's tag and race marker from its own data, for an
 * activity the export has not tagged.
 * @param {any} x  an activity file (an element of `fitnessActivities`) or a bare index entry
 * @returns {{ tag: Tag, isRace: boolean }}
 */
export function siteTagOf(x) {
  const wrapped = x && (x.activity || x.entry || x.indexEntry || x.race) ? x : { entry: x };
  const file = wrapped.entry || !wrapped.indexEntry ? wrapped : { ...wrapped, entry: wrapped.indexEntry };
  const activity = file.activity ?? {};
  const entry = file.entry ?? {};
  const t = bare(activity.activityType ?? entry.activityType);
  const title = String(activity.title ?? entry.title ?? '');
  const tag = fallbackTag(file, t, title);
  const race = file.race;
  const isRace = race ? !race.isSimulation : tag === 'run' && RUN_RACE.test(title) && !NOT_RACE.test(title);
  return { tag, isRace };
}

/** @param {any} file @param {string} t @param {string} title @returns {Tag} */
function fallbackTag(file, t, title) {
  if (file.race) return 'hybrid';
  if (RUN_TYPES.has(t)) return 'run';
  if (WALK_TYPES.has(t)) return 'walk';
  if (t === 'PILATES') return 'pilates';
  if (t === 'YOGA') return 'yoga';
  if (RIDE_TYPES.has(t)) return activityKind(file) === 'ride' ? 'ride' : 'spin';
  // A title names what the type cannot: Hyrox PT filed as weights (hybrid), a spin class filed as crossfit.
  const hint = tagOfTitle(title);
  if (hint === 'spin' || hint === 'hybrid' || hint === 'pilates' || hint === 'yoga') return hint;
  if (CLASS_TYPES.has(t)) return 'class';
  if (t === 'WORKOUT' || t === 'WEIGHT_TRAINING') {
    if (activityKind(file) === 'run') return 'run'; // a race or long run logged as one running set
    if (CLASS_WORDS.test(title)) return 'class';
    if (t === 'WORKOUT') return 'strength';
    // Weights: a class only when the logged sets are mostly stations (activityKind reads them).
    return loggedSets(file) > 0 && activityKind(file) === 'class' ? 'class' : 'strength';
  }
  if (!t) return hint;
  return 'other';
}

/**
 * An activity's tag and race marker: the export's `tag` / `isRace` when present and valid
 * (on the file, its `entry` or the index entry; a legacy `hyrox` reads as `hybrid`), else
 * `siteTagOf`.
 * @param {any} x  an activity file or an index entry
 * @returns {{ tag: Tag, isRace: boolean }}
 */
export function tagOf(x) {
  for (const src of [x, x?.entry, x?.indexEntry]) {
    const tag = src ? normTag(src.tag) : undefined;
    if (tag) {
      return { tag, isRace: typeof src.isRace === 'boolean' ? src.isRace : siteTagOf(x).isRace };
    }
  }
  return siteTagOf(x);
}

/**
 * Theme for one tag (a legacy key reads as its successor, an unknown key is `other`).
 * @param {unknown} tag
 * @returns {{ typeKey: Tag, typeClass: string, tagLabel: string, tagGlyph: string }}
 */
export function tagTheme(tag) {
  const typeKey = normTag(tag) ?? 'other';
  return { typeKey, typeClass: `fit-type--${typeKey}`, tagLabel: TAGS[typeKey].label, tagGlyph: TAGS[typeKey].glyph };
}

/**
 * Theme for one activity: its tag's colour, label and glyph, plus the race marker.
 * @param {any} x  an activity file or an index entry
 */
export function themeOf(x) {
  const { tag, isRace } = tagOf(x);
  return { ...tagTheme(tag), isRace };
}

/**
 * Decide each activity's tag once and write it where every view reads it: the file, its
 * `entry` and its index entry. Data from the export wins; the fallback fills the rest.
 * @param {any} file  an activity file (with `indexEntry` when assembled)
 */
export function stampTag(file) {
  if (!file || typeof file !== 'object') return file;
  const { tag, isRace } = tagOf(file);
  for (const o of [file, file.entry, file.indexEntry]) {
    if (o && typeof o === 'object') { o.tag = tag; o.isRace = isRace; }
  }
  return file;
}

export { tagOfTitle };

/**
 * The tag inks as hex, for drawings that cannot read CSS (the share cards, F5.4).
 * Kept in step with personal/assets/styles/main/fitness-types.css by
 * tasks/fitness-og-images.test.mjs: `type` is --type, `on` is --type-on (ink → #171311),
 * `text` is --type-text.
 */
export const TYPE_INKS = /** @type {Record<Tag, { type: string, on: string, text: string }>} */ ({
  run: { type: '#C42A72', on: '#FFFFFF', text: '#C42A72' },
  ride: { type: '#18A9C4', on: '#171311', text: '#187384' },
  spin: { type: '#2E5BBA', on: '#FFFFFF', text: '#2E5BBA' },
  hybrid: { type: '#F2C13C', on: '#171311', text: '#806726' },
  class: { type: '#00838A', on: '#FFFFFF', text: '#00727A' },
  strength: { type: '#F25B1C', on: '#171311', text: '#B54719' },
  pilates: { type: '#7C3AED', on: '#FFFFFF', text: '#7C3AED' },
  yoga: { type: '#B79CF0', on: '#171311', text: '#6E4FC4' },
  walk: { type: '#5E8C31', on: '#171311', text: '#4B7027' },
  other: { type: '#6B6259', on: '#FFFFFF', text: '#6B6259' },
});
