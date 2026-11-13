// @ts-check
/**
 * The consistency strip on /life/fitness: the last WEEKS weeks (Monday to Sunday, site
 * timezone), one column per week.
 *
 *   - height: time trained that week, against the biggest week on the strip;
 *   - colour: the week split by tag (tasks/fitness-theme.mjs), in proportion to the time
 *     each tag took, stacked in TAGS order so the same colour always sits in the same place;
 *   - a missed week is an empty dashed slot; a week with a race carries a race mark
 *     (parkruns are races but weekly, so they do not: the mark would be on every week);
 *   - each week links to its weekly roundup when there is one, and always says what it held.
 *
 * Built from the index entries themselves (tag, startTime, durationSeconds, isRace), so it
 * agrees with every other view. The headline count stays FitGlue's streakHistory.
 */
import { TAGS, tagOf, tagTheme } from './fitness-theme.mjs';
import { ymd, fmt } from './life-clock.mjs';

export const WEEKS = 52;
/** A week that happened but logged no time still shows this much of the full height. */
const MIN_SHARE = 0.08;
const DAY = 86400000;

/** The Monday (`YYYY-MM-DD`) of the week a site-timezone date falls in. @param {string} day */
export function mondayOf(day) {
  const t = Date.parse(`${day}T00:00:00Z`);
  const dow = (new Date(t).getUTCDay() + 6) % 7;
  return new Date(t - dow * DAY).toISOString().slice(0, 10);
}

/** `3 Nov` @param {string} day */
const short = (day) => fmt(new Date(`${day}T12:00:00Z`), { day: 'numeric', month: 'short' });

/** `7h 53m` @param {number} s */
function hm(s) {
  const m = Math.round(s / 60);
  const h = Math.floor(m / 60);
  return h ? (m % 60 ? `${h}h ${m % 60}m` : `${h}h`) : `${m}m`;
}

/**
 * @param {any[]} entries  index activity entries
 * @param {any[]} [roundups]  index roundup summaries (weekly ones give a week its link)
 * @param {(key: string) => string} [roundupHref]
 * @param {Date} [now]
 */
export function buildConsistency(entries, roundups = [], roundupHref = (k) => k, now = new Date()) {
  const thisWeek = mondayOf(ymd(now));
  const start = Date.parse(`${thisWeek}T00:00:00Z`) - (WEEKS - 1) * 7 * DAY;
  /** @type {{ monday: string, seconds: number, count: number, race: boolean, byTag: Map<string, { seconds: number, count: number }> }[]} */
  const weeks = Array.from({ length: WEEKS }, (_, i) => ({
    monday: new Date(start + i * 7 * DAY).toISOString().slice(0, 10), seconds: 0, count: 0, race: false, byTag: new Map(),
  }));
  const index = new Map(weeks.map((w, i) => [w.monday, i]));

  for (const e of Array.isArray(entries) ? entries : []) {
    const t = Date.parse(String(e?.startTime ?? ''));
    if (Number.isNaN(t)) continue;
    const i = index.get(mondayOf(ymd(new Date(t))));
    if (i === undefined) continue;
    const w = weeks[i];
    const { tag, isRace } = tagOf(e);
    const secs = Math.max(0, Number(e.durationSeconds) || 0);
    const b = w.byTag.get(tag) || { seconds: 0, count: 0 };
    b.seconds += secs; b.count += 1;
    w.byTag.set(tag, b);
    w.seconds += secs; w.count += 1;
    if (isRace && e.raceType !== 'parkrun' && !/parkrun/i.test(String(e.title ?? ''))) w.race = true;
  }

  /** @type {Map<string, string>} */
  const links = new Map();
  for (const r of Array.isArray(roundups) ? roundups : []) {
    if (r?.periodType !== 'ROUNDUP_PERIOD_TYPE_WEEK' || !r.key || !r.periodStart) continue;
    links.set(String(r.periodStart).slice(0, 10), roundupHref(String(r.key)));
  }

  const peak = Math.max(1, ...weeks.map((w) => w.seconds));
  const order = Object.keys(TAGS);
  const used = new Set();
  let lastMonth = '';
  const cols = weeks.map((w, i) => {
    const current = w.monday === thisWeek;
    const tags = [...w.byTag.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
    tags.forEach(([t]) => used.add(t));
    const mix = tags.map(([t, b]) => `${b.count} ${TAGS[/** @type {keyof typeof TAGS} */ (t)]?.label.toLowerCase() ?? t}`).join(', ');
    const when = `w/c ${short(w.monday)}`;
    const title = w.count
      ? `${when}${current ? ' (so far)' : ''} · ${hm(w.seconds)} · ${mix}${w.race ? ' · race week' : ''}`
      : `${when} · ${current ? 'nothing yet' : 'missed'}`;
    // A month label sits over the first week that starts in it.
    const month = fmt(new Date(`${w.monday}T12:00:00Z`), { month: 'short' });
    const label = month !== lastMonth && i > 0 ? month : '';
    lastMonth = month;
    const height = w.count ? Math.max(MIN_SHARE, w.seconds / peak) : 0;
    return {
      title, href: links.get(w.monday) || '', active: w.count > 0, current, race: w.race,
      height: `${(height * 100).toFixed(1)}%`,
      segments: tags.map(([t, b]) => ({
        typeClass: tagTheme(t).typeClass,
        share: `${((w.seconds ? b.seconds / w.seconds : b.count / w.count) * 100).toFixed(1)}%`,
      })),
      month: label, col: i + 1,
    };
  });

  return {
    weeks: cols,
    // `old`: in the first half year, which phones leave out.
    months: cols.filter((c) => c.month).map((c) => ({ label: c.month, col: c.col, old: c.col <= WEEKS / 2 })),
    key: order.filter((t) => used.has(t)).map((t) => ({ label: TAGS[/** @type {keyof typeof TAGS} */ (t)].label, typeClass: tagTheme(t).typeClass })),
    peak: hm(peak),
    hasWeeks: cols.some((c) => c.active),
  };
}
