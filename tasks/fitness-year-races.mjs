// @ts-check
/**
 * The year in review's race chapters (tasks/fitness-year-review.mjs):
 *
 *   tour    every race of the year as one fixture list, the back of a tour T-shirt: date,
 *           race, where, the result, a PB mark. Parkruns are left to their own series.
 *   series  the races that came round more than once, each drawn its own way:
 *             hyrox    every race on one time axis, segment by segment (runs, stations and
 *                      the roxzone gaps between), and the best time at each station
 *             parkrun  every Saturday on a faster-is-higher plot, the courses, the averages
 *             a run    (any title prefix seen three times or more: Rasselbock Run, Gordon
 *                      Whelbourn Race) one card per edition, its route or photo, with a pace bar
 */
import { tagOf, tagTheme } from './fitness-theme.mjs';
import { cardPicture, km, clock } from './fitness-life.mjs';
import { recordLabel } from './fitness-records.mjs';
import { parkrunInfo } from './fitness-highlights.mjs';
import { ymd } from './life-clock.mjs';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const num = (/** @type {unknown} */ v) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);
const round = (/** @type {number} */ v, d = 1) => Math.round(v * 10 ** d) / 10 ** d;
const https = (/** @type {unknown} */ u) => (typeof u === 'string' && /^https:\/\//i.test(u) ? u : '');
/** `14 Mar` @param {number} t */
const dm = (t) => { const [, m, d] = ymd(new Date(t)).split('-').map(Number); return `${d} ${MON[m - 1]}`; };
const PARKRUN = /park ?run/i;

/** A race title without its emoji, its result or its run number. @param {string} s */
export function cleanTitle(s) {
  return String(s || '')
    .replace(/\p{Extended_Pictographic}|\u{FE0F}/gu, '')
    .replace(/\s*-\s*\d{1,2}:\d{2}(:\d{2})?\s*$/, '')
    .replace(/\s*\(#?\d+\)\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** `m:ss` per km. @param {number} secs @param {number} metres */
const pace = (secs, metres) => (metres > 500 ? `${clock(secs / (metres / 1000))}/km` : '');

/**
 * Whether a session broke a racing record (a distance, a hyrox time, a parkrun PB).
 * @param {any} f the activity file
 */
function racePb(f) {
  const recs = f?.activity?.enrichments?.personalRecords?.records;
  if (Array.isArray(recs) && recs.some((r) => { const l = recordLabel(String(r?.recordType || '')); return (l.group === 'run' && l.metricKey === 'fastest') || (l.group === 'hyrox' && l.division); })) return true;
  return Boolean(parkrunInfo(f)?.isPb);
}

/**
 * @param {{ e: any, t: number }[]} inYear  the year's sessions, oldest first
 * @param {(slug: string) => any} fileOf
 * @param {any[]} moments  the year's moments (their titles name races Strava calls "Morning Run")
 * @param {{ showPhotos: boolean, start: number, end: number }} o
 */
export function buildRaceYear(inYear, fileOf, moments, o) {
  const hrefOf = (/** @type {string} */ slug) => `/life/activity/${slug}`;
  /** The moment's name for a race, when there is one (it knows the event's real name). */
  const momentTitle = new Map();
  for (const m of moments) for (const s of (m.slugs || [m.slug])) if (s && m.kind !== 'weekend') momentTitle.set(s, m.title);

  const races = inYear.filter((x) => x.e.isRace || fileOf(x.e.slug)?.isRace).map((x) => {
    const f = fileOf(x.e.slug) || {};
    const hy = f.race?.raceType === 'hyrox' ? f.race : null;
    const secs = num(hy?.totalSeconds) || num(x.e.durationSeconds);
    const metres = num(x.e.distanceMeters);
    const parts = String(x.e.locationName || '').split(',').map((p) => p.trim()).filter(Boolean);
    const named = /^(morning|afternoon|evening|lunch|night) /i.test(x.e.title || '') ? momentTitle.get(x.e.slug) : '';
    const title = hy?.event ? `Hyrox ${hy.event}` : cleanTitle(named || x.e.title);
    const tag = tagOf(x.e).tag;
    const theme = tagTheme(tag);
    return {
      t: x.t, slug: x.e.slug, title, sub: hy?.division?.label || (metres > 500 ? `${km(metres)} km` : ''),
      date: dm(x.t), month: MON[new Date(x.t).getUTCMonth()], day: Number(ymd(new Date(x.t)).slice(8)),
      place: hy?.event || parts[0] || '', time: clock(secs), secs, metres, pace: pace(secs, metres),
      pb: racePb(f), href: hrefOf(x.e.slug), typeClass: theme.typeClass, tagLabel: theme.tagLabel,
      parkrun: PARKRUN.test(x.e.title || ''), hyrox: hy, file: f, e: x.e,
    };
  });

  // ---- the tour: every race but the parkruns ----------------------------------------
  const tourRows = races.filter((r) => !r.parkrun).map((r) => ({
    date: r.date, month: r.month, day: r.day, title: r.title, sub: r.sub, place: r.place === r.title.split(' ')[1] ? '' : r.place,
    time: r.time, pace: r.pace, pb: r.pb, href: r.href, typeClass: r.typeClass, tagLabel: r.tagLabel,
  }));
  const tourPlaces = new Set(races.filter((r) => !r.parkrun).map((r) => r.place).filter(Boolean));
  const tour = {
    rows: tourRows, count: tourRows.length, pbs: tourRows.filter((r) => r.pb).length, places: tourPlaces.size,
    raced: races.length, parkruns: races.filter((r) => r.parkrun).length,
  };

  // ---- the series --------------------------------------------------------------------
  const series = [];
  const hy = hyroxSeries(races.filter((r) => r.hyrox && Array.isArray(r.hyrox.segments) && r.hyrox.segments.length));
  if (hy) series.push(hy);
  const pk = parkrunSeries(inYear, fileOf, o, hrefOf);
  if (pk) series.push(pk);
  series.push(...namedSeries(races.filter((r) => !r.parkrun && !r.hyrox), fileOf, o));
  return { tour, series, hasSeries: series.length > 0 };
}

/**
 * Hyrox: each race a lane on one shared time axis; the segments sit where they started, so
 * the gaps between them are the roxzone.
 * @param {any[]} list
 */
function hyroxSeries(list) {
  if (list.length < 2) return null;
  const longest = Math.max(...list.map((r) => num(r.hyrox.totalSeconds) || r.secs));
  /** @type {Map<string, { label: string, secs: number, where: string, isRun: boolean, n: number }>} */
  const best = new Map();
  const lanes = list.map((r) => {
    const h = r.hyrox;
    const total = num(h.totalSeconds) || r.secs;
    for (const s of h.segments) {
      const d = num(s.durationSeconds);
      if (!d || s.isRun) continue;
      const cur = best.get(s.key);
      if (!cur || d < cur.secs) best.set(s.key, { label: s.label, secs: d, where: r.title.replace(/^Hyrox /, ''), isRun: false, n: (cur?.n || 0) + 1 });
      else cur.n += 1;
    }
    const runs = h.segments.filter((/** @type {any} */ s) => s.isRun).map((/** @type {any} */ s) => num(s.durationSeconds)).filter(Boolean);
    return {
      title: r.title, sub: r.sub, date: r.date, time: clock(total), href: r.href, pb: r.pb,
      run: clock(num(h.runSeconds)), stations: clock(num(h.stationSeconds)), rox: clock(num(h.roxzoneSeconds)),
      runAvg: runs.length ? clock(runs.reduce((a, b) => a + b, 0) / runs.length) : '',
      width: round((total / longest) * 100, 2),
      segs: h.segments.map((/** @type {any} */ s) => ({
        label: s.label, isRun: Boolean(s.isRun), time: clock(num(s.durationSeconds)),
        left: round((num(s.startOffsetSeconds) / longest) * 100, 2), w: round((num(s.durationSeconds) / longest) * 100, 2),
      })),
    };
  });
  const fastest = [...list].sort((a, b) => (num(a.hyrox.totalSeconds) || a.secs) - (num(b.hyrox.totalSeconds) || b.secs))[0];
  const ticks = [];
  for (let m = 15; m * 60 < longest; m += 15) ticks.push({ label: `${m}′`, left: round(((m * 60) / longest) * 100, 2) });
  return {
    kind: 'hyrox', key: 'hyrox', name: 'Hyrox', count: list.length, typeClass: 'fit-type--hybrid',
    blurb: `${list.length} races, 8 km and 8 stations each time. Fastest: ${fastest.title.replace(/^Hyrox /, '')}, ${clock(num(fastest.hyrox.totalSeconds) || fastest.secs)}${fastest.sub ? ` (${fastest.sub})` : ''}.`,
    lanes, ticks,
    stations: [...best.values()].map((s) => ({ label: s.label, time: clock(s.secs), where: s.where })),
  };
}

/**
 * Parkrun: every Saturday of the year (raced or not), faster is higher; the courses; the
 * averages. A walk round with the kids sits on the floor of the plot, hollow.
 * @param {{ e: any, t: number }[]} inYear @param {(slug: string) => any} fileOf @param {{ start: number, end: number }} o
 * @param {(slug: string) => string} hrefOf
 */
function parkrunSeries(inYear, fileOf, o, hrefOf) {
  const runs = inYear.filter((x) => PARKRUN.test(x.e.title || '')).map((x) => {
    const f = fileOf(x.e.slug);
    const info = f ? parkrunInfo(f) : null;
    const secs = info?.time ? String(info.time).split(':').map(Number).reduce((a, b) => a * 60 + b, 0) : num(x.e.durationSeconds);
    const course = cleanTitle(x.e.title).replace(/\s*parkrun.*$/i, '').replace(/^NYD$/i, 'New Year\'s Day').trim() || 'parkrun';
    return { t: x.t, secs, time: clock(secs), date: dm(x.t), href: hrefOf(x.e.slug), course, pb: Boolean(info?.isPb), raced: Boolean(x.e.isRace) };
  }).filter((p) => p.secs > 600 && p.secs < 3600);
  if (runs.length < 3) return null;
  const best = Math.min(...runs.map((p) => p.secs));
  const floor = Math.min(Math.max(...runs.map((p) => p.secs)), best * 1.33);
  /** @type {Map<string, number>} */
  const courses = new Map();
  for (const p of runs) courses.set(p.course, (courses.get(p.course) || 0) + 1);
  const raced = runs.filter((p) => p.secs <= floor);
  const avg = raced.reduce((s, p) => s + p.secs, 0) / Math.max(1, raced.length);
  const bestRun = runs.find((p) => p.secs === best);
  const months = MON.map((label, i) => ({ label, left: round(((Date.UTC(new Date(o.start).getUTCFullYear(), i, 1) - o.start) / (o.end - o.start)) * 100, 2) }));
  return {
    kind: 'parkrun', key: 'parkrun', name: 'parkrun', count: runs.length, typeClass: 'fit-type--run',
    blurb: `${runs.length} Saturday mornings, ${courses.size} course${courses.size === 1 ? '' : 's'}, ${km(runs.length * 5000)} km of 5 km.`,
    best: clock(best), bestWhen: bestRun ? `${bestRun.course} · ${bestRun.date}` : '', avg: clock(avg), slow: clock(floor),
    courses: [...courses.entries()].sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, n })),
    dots: runs.map((p, i) => ({
      ...p, i, left: round(((p.t - o.start) / (o.end - o.start)) * 100, 2),
      bottom: round(floor === best ? 50 : Math.max(0, ((floor - p.secs) / (floor - best)) * 100), 1),
      best: p.secs === best, off: p.secs > floor,
    })),
    hasOff: runs.some((p) => p.secs > floor), hasPb: runs.some((p) => p.pb && p.secs !== best),
    months, avgBottom: round(floor === best ? 50 : ((floor - avg) / (floor - best)) * 100, 1),
  };
}

/** The words two titles start with. @param {string[]} titles */
function commonPrefix(titles) {
  const words = titles.map((t) => t.split(' '));
  const out = [];
  for (let i = 0; i < words[0].length; i++) {
    const w = words[0][i];
    if (words.every((ws) => ws[i] && ws[i].toLowerCase() === w.toLowerCase())) out.push(w); else break;
  }
  return out.join(' ').replace(/[\s-–]+$/, '');
}

/**
 * Any other race that came round three times or more (the same first word in its title):
 * one card per edition, with its route or photo and a pace bar against the series' best.
 * @param {any[]} races @param {(slug: string) => any} fileOf @param {{ showPhotos: boolean }} o
 */
function namedSeries(races, fileOf, o) {
  /** @type {Map<string, any[]>} */
  const groups = new Map();
  for (const r of races) {
    const k = r.title.split(' ')[0].toLowerCase().replace(/[^a-z]/g, '');
    if (k.length < 3) continue;
    groups.set(k, [...(groups.get(k) || []), r]);
  }
  return [...groups.entries()].filter(([, l]) => l.length >= 3).map(([k, list]) => {
    const name = commonPrefix(list.map((r) => r.title)) || list[0].title;
    const paces = list.map((r) => (r.metres > 500 ? r.secs / (r.metres / 1000) : 0)).filter(Boolean);
    const fastest = Math.min(...paces), slowest = Math.max(...paces);
    const totalKm = list.reduce((s, r) => s + r.metres, 0);
    const editions = list.map((r) => {
      const f = fileOf(r.slug);
      const photo = o.showPhotos ? https(r.e.photoUrls?.[0]) : '';
      const pic = photo ? null : cardPicture({ ...(f?.entry || r.e), photoUrls: [], routeThumbnailUrl: '' }, f);
      const p = r.metres > 500 ? r.secs / (r.metres / 1000) : 0;
      const edition = r.title.slice(name.length).replace(/^[\s\-–:]+/, '').replace(/\s*\b20\d\d\b\s*/, ' ').trim() || r.date;
      return {
        edition: /^\d+$/.test(edition) ? `No. ${edition}` : edition, date: r.date, time: r.time, dist: r.metres > 500 ? `${km(r.metres)} km` : '',
        pace: r.pace, href: r.href, pb: r.pb, photo, route: pic?.route || null, typeClass: r.typeClass,
        bar: p && slowest > fastest ? round(100 - ((p - fastest) / (slowest - fastest)) * 60, 1) : 100, quickest: p === fastest,
      };
    });
    return {
      kind: 'run', key: k, name, count: list.length, typeClass: list[0].typeClass,
      blurb: `${list.length} editions, ${km(totalKm)} km between them. Quickest pace: ${clock(fastest)}/km.`,
      editions,
    };
  });
}
