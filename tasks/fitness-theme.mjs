// @ts-check
/**
 * Activity-type theme, shared by every /life page (F5.3).
 *
 * One place that says what colour, glyph and label an activity type gets, so
 * the /life index, /life/sessions, the calendar strip and (when they want it)
 * the activity and roundup pages agree. The colours live in CSS as
 * `.fit-type--<key>` classes (personal/assets/styles/main/fitness-types.css),
 * each setting `--type` (the ink) and `--type-on` (text on a solid `--type`
 * fill); a view model only carries `typeKey` / `typeClass`.
 *
 * The grouping is FitGlue's showcase family map (fitglue-web, deleted in
 * e333c4c: src/showcase/utils/activityFamily.ts), and the hues are its Aurora
 * tokens (pink #ff3da6, cyan #22d3ee, violet #8b5cf6, rose, gold, lime) moved
 * to riso-ink weights that hold contrast on the zine's cream paper. Where the
 * web app's two maps disagreed (the dashboard RunRow: run pink, ride cyan,
 * pilates/yoga/weights violet; the showcase stamps: strength pink, crossfit
 * rose, hiit gold, yoga violet, run/ride/hike plain paper), run and ride take
 * RunRow's colours and strength moves off pink so run and strength differ.
 */

/**
 * @typedef {'run'|'ride'|'swim'|'hike'|'strength'|'crossfit'|'hiit'|'yoga'|'sport'|'paddle'|'other'} TypeKey
 */

/** FitGlue `ActivityType` → family key (fitglue-web activityFamily.ts FAMILY_MAP). */
export const TYPE_FAMILY = /** @type {Record<string, TypeKey>} */ ({
  RUN: 'run', TRAIL_RUN: 'run', VIRTUAL_RUN: 'run',
  RIDE: 'ride', GRAVEL_RIDE: 'ride', MOUNTAIN_BIKE_RIDE: 'ride', EBIKE_RIDE: 'ride',
  EMOUNTAIN_BIKE_RIDE: 'ride', VIRTUAL_RIDE: 'ride', VELOMOBILE: 'ride', HANDCYCLE: 'ride', ROLLER_SKI: 'ride',
  SWIM: 'swim',
  HIKE: 'hike', WALK: 'hike', SNOWSHOE: 'hike',
  WEIGHT_TRAINING: 'strength', WORKOUT: 'strength',
  CROSSFIT: 'crossfit',
  HIGH_INTENSITY_INTERVAL_TRAINING: 'hiit', ELLIPTICAL: 'hiit', STAIR_STEPPER: 'hiit',
  YOGA: 'yoga', PILATES: 'yoga',
  TENNIS: 'sport', TABLE_TENNIS: 'sport', BADMINTON: 'sport', RACQUETBALL: 'sport', SQUASH: 'sport',
  PICKLEBALL: 'sport', SOCCER: 'sport', GOLF: 'sport', ROCK_CLIMBING: 'sport',
  STAND_UP_PADDLING: 'paddle', KAYAKING: 'paddle', CANOEING: 'paddle', ROWING: 'paddle', VIRTUAL_ROW: 'paddle',
  SURFING: 'paddle', WINDSURF: 'paddle', KITESURF: 'paddle', SAIL: 'paddle',
});

/** Family key → filter label and glyph, in the order the filter chips show them. */
export const FAMILIES = /** @type {Record<TypeKey, { label: string, glyph: string }>} */ ({
  run: { label: 'Run', glyph: '🏃' },
  ride: { label: 'Ride', glyph: '🚴' },
  crossfit: { label: 'CrossFit & Hyrox', glyph: '🔥' },
  strength: { label: 'Strength', glyph: '🏋️' },
  hiit: { label: 'HIIT', glyph: '⚡' },
  yoga: { label: 'Pilates & Yoga', glyph: '🧘' },
  swim: { label: 'Swim', glyph: '🏊' },
  paddle: { label: 'On the water', glyph: '🚣' },
  hike: { label: 'Walk & Hike', glyph: '🚶' },
  sport: { label: 'Sport', glyph: '🎾' },
  other: { label: 'Other', glyph: '✦' },
});

/** `ACTIVITY_TYPE_TRAIL_RUN` → `TRAIL_RUN` @param {unknown} t */
function bare(t) {
  return String(t || '').replace(/^ACTIVITY_TYPE_/, '');
}

/** @param {unknown} activityType @returns {TypeKey} */
export function typeKeyOf(activityType) {
  return TYPE_FAMILY[bare(activityType)] || 'other';
}

/**
 * Theme for one activity type.
 * @param {unknown} activityType  `ACTIVITY_TYPE_RUN` or `RUN`
 * @returns {{ typeKey: TypeKey, typeClass: string, familyLabel: string, familyGlyph: string }}
 */
export function activityTheme(activityType) {
  const typeKey = typeKeyOf(activityType);
  return {
    typeKey,
    typeClass: `fit-type--${typeKey}`,
    familyLabel: FAMILIES[typeKey].label,
    familyGlyph: FAMILIES[typeKey].glyph,
  };
}

/**
 * A planned calendar entry's family, guessed from its title (the calendars
 * carry no activity type). Unmatched → 'other'.
 * @param {unknown} title
 * @returns {TypeKey}
 */
export function typeKeyOfTitle(title) {
  const t = String(title || '').toLowerCase();
  if (/hyrox|crossfit|hybrid/.test(t)) return 'crossfit';
  if (/pilates|yoga|flexibility|stretch/.test(t)) return 'yoga';
  if (/strength|\bpt\b|weights|gym|lift/.test(t)) return 'strength';
  if (/\brun|parkrun|10k|5k|marathon/.test(t)) return 'run';
  if (/ride|cycl|spin|sportive|bike/.test(t)) return 'ride';
  if (/swim/.test(t)) return 'swim';
  if (/hiit|erg|circuit/.test(t)) return 'hiit';
  if (/walk|hike/.test(t)) return 'hike';
  return 'other';
}

/** Hybrid race brands, as a title or the export's `race` names them (F5.5). */
const HYBRID_RACES = /** @type {[RegExp, string][]} */ ([
  [/\bhyrox\b/i, 'HYROX'],
  [/\bathx\b/i, 'ATHX'],
  [/\bdeka\b/i, 'DEKA'],
]);

/**
 * The type word for a hybrid race or class: FitGlue types Hyrox races CROSSFIT and
 * Hyrox classes WEIGHT_TRAINING, so the chip said "CROSSFIT" on a Hyrox race. Returns
 * the brand ("HYROX") when the activity has a Hyrox race breakdown or its title names
 * one, else "".
 * @param {unknown} title
 * @param {{ hasRace?: boolean, event?: unknown }} [opts]  `hasRace`: the export carries a `race` (always Hyrox today)
 * @returns {string}
 */
export function hybridRaceLabel(title, opts = {}) {
  const text = `${String(title ?? '')} ${String(opts.event ?? '')}`;
  for (const [re, label] of HYBRID_RACES) if (re.test(text)) return label;
  return opts.hasRace ? 'HYROX' : '';
}

/**
 * The family inks as hex, for drawings that cannot read CSS (the share cards, F5.4).
 * Kept in step with personal/assets/styles/main/fitness-types.css by
 * tasks/fitness-share-cards.test.mjs: `type` is --type, `on` is --type-on (ink → #171311),
 * `text` is --type-text.
 */
export const TYPE_INKS = /** @type {Record<TypeKey, { type: string, on: string, text: string }>} */ ({
  run: { type: '#C42A72', on: '#FFFFFF', text: '#C42A72' },
  ride: { type: '#18A9C4', on: '#171311', text: '#187384' },
  swim: { type: '#2148C0', on: '#FFFFFF', text: '#2148C0' },
  paddle: { type: '#1A6F94', on: '#FFFFFF', text: '#1A6F94' },
  hike: { type: '#0B7A4B', on: '#FFFFFF', text: '#0B7A4B' },
  strength: { type: '#F25B1C', on: '#171311', text: '#B54719' },
  crossfit: { type: '#F2C13C', on: '#171311', text: '#806726' },
  hiit: { type: '#E5484D', on: '#171311', text: '#BC3D41' },
  yoga: { type: '#7C3AED', on: '#FFFFFF', text: '#7C3AED' },
  sport: { type: '#7BB52A', on: '#171311', text: '#537420' },
  other: { type: '#6B6259', on: '#FFFFFF', text: '#6B6259' },
});
