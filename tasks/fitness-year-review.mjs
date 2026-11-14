// @ts-check
/**
 * The year in review: the annual issue of the fitness zine, /life/roundup/year-<YYYY>.
 *
 * A story in chapters, every figure from the export (no hand-written data):
 *
 *   cover     the year, a scatter of the year's best photos, the cover lines, a sticker
 *   numbers   the big totals, each with a comparison you can picture (marathons, buses, pizzas)
 *   arc       the year's shape: hours per week as one line, its highs and lows pinned on it
 *   days      every day of the year, one square each, in the day's ink
 *   months    twelve short chapters: the month's best moment, its picture, a high and a low
 *   races     every race as a ticket; the parkruns as one strip
 *   pbs       every PB of the year: the headline ones as followable progressions, a ticker,
 *             and the full ledger (every exercise, how often it went up, from what to what)
 *   out there places, weather, every route drawn
 *   awards    the year's superlatives
 *   next      the races already booked for next year
 *
 * Lows are facts, said kindly: the quietest weeks, the longest gap, a race slower than its PB.
 */
import { momentsIn, pickHighlights, dayStreak, parkrunInfo } from './fitness-highlights.mjs';
import { TAGS, tagOf, tagTheme } from './fitness-theme.mjs';
import { cardPicture, km, clock } from './fitness-life.mjs';
import { recordLabel } from './fitness-records.mjs';
import { buildRacePbs } from './fitness-race-pbs.mjs';
import { ymd } from './life-clock.mjs';
import { buildRaceYear } from './fitness-year-races.mjs';
import { awardIcon } from './fitness-year-icons.mjs';

const DAY = 86400000;
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MON = MONTH_NAMES.map((m) => m.slice(0, 3));
const DOW = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const num = (/** @type {unknown} */ v) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);
const https = (/** @type {unknown} */ u) => (typeof u === 'string' && /^https:\/\//i.test(u) ? u : '');
const thousands = (/** @type {number} */ n) => Math.round(n).toLocaleString('en-GB');
/** `7h 05m` / `45m` @param {number} s */
const hm = (s) => { const m = Math.round(s / 60); const h = Math.floor(m / 60); return h ? `${h}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`; };
/** `14 Mar` @param {number} t */
const dm = (t) => { const d = new Date(Date.parse(`${ymd(new Date(t))}T12:00:00Z`)); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]}`; };
/** Monday of a site-timezone day. @param {string} day */
const mondayOf = (day) => { const t = Date.parse(`${day}T00:00:00Z`); return new Date(t - ((new Date(t).getUTCDay() + 6) % 7) * DAY).toISOString().slice(0, 10); };
/** A stable pseudo-random in [0,1) from a string, so the scatter is the same every build. @param {string} s */
function rand(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 10000) / 10000;
}
/** @param {number} v @param {number} d */
const round = (v, d = 1) => Math.round(v * 10 ** d) / 10 ** d;

/**
 * @param {any} file  the year's roundup file
 * @param {{ list: { e: any, t: number }[], files: Map<string, any>, moments: any[], keys: Set<string>, showPhotos: boolean }} ctx  storyContext
 * @param {{ upcoming?: any[], roundupHref?: (key: string) => string }} [opts]
 */
export function buildYearReview(file, ctx, opts = {}) {
  const r = file?.roundup || {};
  const start = Date.parse(r.periodStart || '');
  const year = new Date(start).getUTCFullYear();
  const end = Date.UTC(year + 1, 0, 1);
  const roundupHref = opts.roundupHref || ((k) => `/life/roundup/${k}`);
  const inYear = ctx.list.filter((x) => x.t >= start && x.t < end);
  const fileOf = (/** @type {string} */ slug) => ctx.files.get(slug);
  const photoOf = (/** @type {any} */ e) => (ctx.showPhotos ? https(e?.photoUrls?.[0]) : '');
  const hrefOf = (/** @type {string} */ slug) => `/life/activity/${slug}`;
  const moments = momentsIn(ctx.moments, start, end);

  // ---- weeks (the arc) -------------------------------------------------------------
  const firstMonday = mondayOf(`${year}-01-01`);
  const weekStarts = [];
  for (let t = Date.parse(`${firstMonday}T00:00:00Z`); t < end; t += 7 * DAY) weekStarts.push(new Date(t).toISOString().slice(0, 10));
  /** @type {Map<string, { monday: string, secs: number, n: number, slugs: string[] }>} */
  const weeks = new Map(weekStarts.map((m) => [m, { monday: m, secs: 0, n: 0, slugs: [] }]));
  /** @type {Map<string, { e: any, t: number }[]>} */
  const byDay = new Map();
  for (const x of inYear) {
    const day = ymd(new Date(x.t));
    const w = weeks.get(mondayOf(day));
    if (w) { w.secs += num(x.e.durationSeconds); w.n += 1; w.slugs.push(x.e.slug); }
    byDay.set(day, [...(byDay.get(day) || []), x]);
  }
  const lastDataDay = inYear.length ? ymd(new Date(inYear[inYear.length - 1].t)) : `${year}-12-31`;
  const weekList = [...weeks.values()].filter((w) => w.monday <= lastDataDay);

  // ---- the numbers -----------------------------------------------------------------
  const secs = inYear.reduce((s, x) => s + num(x.e.durationSeconds), 0) || num(r.totalDurationSeconds);
  const metres = inYear.reduce((s, x) => s + num(x.e.distanceMeters), 0) || num(r.totalDistanceMeters);
  const kg = inYear.reduce((s, x) => s + num(x.e.totalWeightKg), 0);
  const kcal = num(r.totalCaloriesKcal) || inYear.reduce((s, x) => s + num(x.e.caloriesKcal), 0);
  const climb = num(r.totalElevationGainMeters);
  const countryCount = new Set(inYear.map((x) => String(x.e.locationName || '').split(',').map((p) => p.trim()).filter(Boolean)).filter((p) => p.length > 1).map((p) => p[p.length - 1])).size;
  const activeDays = byDay.size;
  const streak = dayStreak([...byDay.keys()]);
  const races = inYear.filter((x) => x.e.isRace);
  const prEvents = prEventsOf(inYear, fileOf);
  const hours = secs / 3600;
  const numbers = [
    { key: 'sessions', value: inYear.length, display: thousands(inYear.length), unit: '', label: 'sessions', quip: `${round(inYear.length / 52, 1)} a week, every week` },
    { key: 'hours', value: Math.round(hours), display: thousands(hours), unit: 'h', label: 'on the clock', quip: `${round(hours / 24, 1)} days without stopping` },
    { key: 'km', value: Math.round(metres / 1000), display: thousands(metres / 1000), unit: 'km', label: 'covered', quip: `${round(metres / 42195, 1)} marathons, laid end to end` },
    kg > 0 && { key: 'tonnes', value: Math.round(kg / 1000), display: thousands(kg / 1000), unit: 't', label: 'lifted', quip: `${round(kg / 12650, 1)} double-decker buses` },
    kcal > 0 && { key: 'kcal', value: Math.round(kcal / 1000), display: thousands(kcal / 1000), unit: 'k kcal', label: 'burned', quip: `${thousands(kcal / 2000)} large pizzas' worth` },
    climb > 0 && { key: 'climb', value: Math.round(climb), display: thousands(climb), unit: 'm', label: 'climbed', quip: `${round(climb / 8849, 2)} of an Everest` },
    countryCount > 1 && { key: 'countries', value: countryCount, display: String(countryCount), unit: '', label: 'countries', quip: 'passport, trainers, go' },
    { key: 'days', value: activeDays, display: String(activeDays), unit: '', label: 'days moving', quip: `out of ${Math.floor((Math.min(Date.parse(`${lastDataDay}T12:00:00Z`), end) - start) / DAY) + 1}` },
    { key: 'streak', value: streak.days, display: String(streak.days), unit: 'days', label: 'longest streak', quip: streak.days ? `${dmIso(streak.from)} to ${dmIso(streak.to)}, not one day off` : '' },
    { key: 'pbs', value: prEvents.length, display: thousands(prEvents.length), unit: '', label: 'PBs broken', quip: `about ${round(prEvents.length / 52, 0)} a week` },
    races.length > 0 && { key: 'races', value: races.length, display: String(races.length), unit: '', label: 'races', quip: `${races.filter((x) => /parkrun/i.test(x.e.title || '')).length} of them parkruns` },
  ].filter(Boolean);

  // ---- every day -------------------------------------------------------------------
  const order = Object.keys(TAGS);
  const days = [];
  for (let t = Date.UTC(year, 0, 1); t < end; t += DAY) {
    const day = new Date(t).toISOString().slice(0, 10);
    const here = byDay.get(day) || [];
    const main = [...here].sort((a, b) => num(b.e.durationSeconds) - num(a.e.durationSeconds))[0];
    const tag = main ? tagOf(main.e).tag : '';
    const dow = (new Date(t).getUTCDay() + 6) % 7;
    days.push({
      day, dow, n: here.length, typeClass: tag ? tagTheme(tag).typeClass : '', race: here.some((x) => x.e.isRace),
      future: day > lastDataDay, href: main ? hrefOf(main.e.slug) : '',
      title: here.length ? `${dm(t)} · ${here.map((x) => x.e.title).join(', ')}` : `${dm(t)} · rest`,
      first: new Date(t).getUTCDate() === 1 ? MON[new Date(t).getUTCMonth()] : '',
    });
  }
  // Columns of weeks for the grid: pad the first week to its Monday.
  const lead = days[0].dow;
  const cells = [...Array.from({ length: lead }, () => ({ blank: true })), ...days.map((d, i) => ({ ...d, i }))];
  const dayCols = [];
  for (let i = 0; i < cells.length; i += 7) dayCols.push({ cells: cells.slice(i, i + 7), month: cells.slice(i, i + 7).find((c) => /** @type {any} */ (c).first)?.first || '' });

  // ---- the arc: hours per week, highs and lows -------------------------------------
  const W = 1000, H = 260, PAD = 18;
  const peak = Math.max(1, ...weekList.map((w) => w.secs));
  const step = weekList.length > 1 ? W / (weekStarts.length - 1) : W;
  const pt = (/** @type {number} */ i, /** @type {number} */ s) => ({ x: round(i * step, 1), y: round(H - PAD - (s / peak) * (H - PAD * 2.2), 1) });
  const pts = weekList.map((w, i) => ({ ...pt(i, w.secs), w }));
  const line = smooth(pts);
  const area = pts.length ? `${line} L${pts[pts.length - 1].x},${H} L0,${H} Z` : '';
  const weekIndex = new Map(weekList.map((w, i) => [w.monday, i]));
  const at = (/** @type {number} */ t) => { const i = weekIndex.get(mondayOf(ymd(new Date(t)))); return i === undefined ? null : pts[i]; };
  // Highs: the year's biggest moments, at most one per month, spread along the line.
  const highMoments = pickHighlights(moments, 'year').filter((m) => m.kind !== 'busiest');
  /** @type {any[]} */
  const highs = [];
  const usedMonths = new Set();
  for (const m of [...highMoments].sort((a, b) => b.score - a.score)) {
    const p = at(m.t);
    const mo = new Date(m.t).getUTCMonth();
    if (!p || usedMonths.has(mo)) continue;
    usedMonths.add(mo);
    highs.push({ x: p.x, y: p.y, stamp: m.stamp, title: m.title, value: m.value, unit: m.unit, date: dm(m.t), href: m.href, typeClass: m.typeClass });
    if (highs.length >= 7) break;
  }
  const biggestWeek = [...weekList].sort((a, b) => b.secs - a.secs)[0];
  // Lows: the quietest full weeks (not the current one), at least six weeks apart.
  const lows = [];
  // Full weeks only: not the one the year starts part-way through, not the one still running.
  const quiet = weekList.slice(0, -1).filter((w) => w.monday >= `${year}-01-01`).sort((a, b) => a.secs - b.secs);
  for (const w of quiet) {
    const i = /** @type {number} */ (weekIndex.get(w.monday));
    if (lows.some((l) => Math.abs(l.i - i) < 6)) continue;
    lows.push({ i, x: pts[i].x, y: pts[i].y, title: w.n ? `${w.n} session${w.n === 1 ? '' : 's'}, ${hm(w.secs)}` : 'a week off', date: `w/c ${dmIso(w.monday)}`, kind: w.n ? 'quiet week' : 'rest week' });
    if (lows.length >= 3) break;
  }
  const monthTicks = MON.map((label, m) => {
    const i = weekIndex.get(mondayOf(`${year}-${String(m + 1).padStart(2, '0')}-01`));
    return i === undefined ? null : { label, x: round((i / Math.max(1, weekStarts.length - 1)) * 100, 2) };
  }).filter(Boolean);
  const arc = {
    w: W, h: H, line, area, peak: hm(peak),
    highs: levels(highs.sort((a, b) => a.x - b.x), W).map((h) => ({ ...h, left: round((h.x / W) * 100, 2), top: round((h.y / H) * 100, 2), flip: h.x > W * 0.8 })),
    lows: levels(lows.sort((a, b) => a.x - b.x), W).map((l) => ({ ...l, left: round((l.x / W) * 100, 2), top: round((l.y / H) * 100, 2), flip: l.x > W * 0.8 })),
    months: monthTicks,
    biggest: biggestWeek ? { date: `w/c ${dmIso(biggestWeek.monday)}`, value: hm(biggestWeek.secs), n: biggestWeek.n } : null,
  };

  // ---- races, the tour and the series ----------------------------------------------
  const raceYear = buildRaceYear(inYear, fileOf, moments, { showPhotos: ctx.showPhotos, start, end });

  // ---- months ----------------------------------------------------------------------
  const prByMonth = Array.from({ length: 12 }, () => 0);
  for (const p of prEvents) prByMonth[new Date(p.t).getUTCMonth()] += 1;
  const raceRows = buildRacePbs(inYear.map((x) => fileOf(x.e.slug)).filter(Boolean));
  const slower = raceRows.flatMap((g) => g.rows.filter((/** @type {any} */ row) => row.latest && row.latest.gap).map((/** @type {any} */ row) => ({ type: g.label, name: row.name, ...row.latest, best: row.best })));
  const monthsSessions = MONTH_NAMES.map((_, m) => inYear.filter((x) => new Date(x.t).getUTCMonth() === m).length);
  const months = MONTH_NAMES.map((name, m) => {
    const a = Date.UTC(year, m, 1), b = Date.UTC(year, m + 1, 1);
    const here = inYear.filter((x) => x.t >= a && x.t < b);
    const key = `month-${String(m + 1).padStart(2, '0')}-${year}`;
    if (!here.length) return { name, short: MON[m], empty: true, future: a > Date.parse(`${lastDataDay}T23:59:59Z`), key };
    const best = pickHighlights(momentsIn(ctx.moments, a, b), 'month');
    const top = best[0];
    const photos = here.map((x) => photoOf(x.e)).filter(Boolean);
    const photo = (top && ctx.showPhotos && top.photo) || photos[Math.floor(photos.length / 2)] || '';
    const route = photo ? null : routeFor(here, fileOf);
    const tiles = monthTiles(here, best, fileOf, ctx.showPhotos, hrefOf);
    const events = raceYear.tour.rows.filter((row) => row.month === MON[m]);
    const parkrunsHere = here.filter((x) => /park ?run/i.test(x.e.title || '')).length;
    const monthDays = days.filter((d) => d.day.slice(5, 7) === String(m + 1).padStart(2, '0'))
      .map((d) => ({ typeClass: d.typeClass, race: d.race, title: d.title, href: d.href, rest: !d.n && !d.future, future: d.future, n: new Date(Date.parse(`${d.day}T12:00:00Z`)).getUTCDate() }));
    /** @type {Map<string, number>} */
    const fam = new Map();
    for (const x of here) fam.set(tagOf(x.e).tag, (fam.get(tagOf(x.e).tag) || 0) + num(x.e.durationSeconds));
    const famTotal = [...fam.values()].reduce((s, v) => s + v, 0) || 1;
    const mainTag = [...fam.entries()].sort((p, q) => q[1] - p[1])[0][0];
    const mSecs = here.reduce((s, x) => s + num(x.e.durationSeconds), 0);
    const mKm = here.reduce((s, x) => s + num(x.e.distanceMeters), 0) / 1000;
    const mDays = new Set(here.map((x) => ymd(new Date(x.t)))).size;
    const mStreak = dayStreak(here.map((x) => ymd(new Date(x.t))));
    // The high: the month's best moment. The low: its quietest full week, a slower race, or a gap.
    const mWeeks = weekList.filter((w) => w.monday >= ymd(new Date(a)) && w.monday < ymd(new Date(b)) && w.monday < mondayOf(lastDataDay));
    const qw = [...mWeeks].sort((p, q) => p.secs - q.secs)[0];
    const sl = slower.find((s) => { const t = Date.parse(`${s.date} 12:00`); return !Number.isNaN(t) && t >= a && t < b; });
    const gap = longestGap(here.map((x) => x.t), a, Math.min(b, Date.parse(`${lastDataDay}T23:59:59Z`)));
    // The low, only when there is one: a race slower than its PB, a real gap, or a thin week.
    const avgWeek = mWeeks.length ? mWeeks.reduce((t, w) => t + w.secs, 0) / mWeeks.length : 0;
    let low = '';
    if (sl) low = `${sl.type} ${sl.name} came in at ${sl.time}, ${sl.gap.replace('+', '')} off the PB.`;
    else if (gap >= 4) low = `${gap} days in a row without a session.`;
    else if (qw && mWeeks.length > 1 && qw.secs < avgWeek * 0.55) low = `A quiet week from ${dmIso(qw.monday)}: ${qw.n} session${qw.n === 1 ? '' : 's'}, ${hm(qw.secs)}.`;
    const rank = [...monthsSessions].sort((p, q) => q - p).indexOf(here.length) + 1;
    const lines = [
      `${here.length} sessions over ${mDays} days, ${hm(mSecs)} in all${mKm >= 1 ? `, ${km(mKm * 1000)} km on the move` : ''}.`,
      [mStreak.days >= 7 ? `A ${mStreak.days}-day streak from ${dmIso(mStreak.from)}` : '', prByMonth[m] ? `${prByMonth[m]} PB${prByMonth[m] === 1 ? '' : 's'}` : ''].filter(Boolean).join(', ') + (mStreak.days >= 7 || prByMonth[m] ? '.' : ''),
    ].filter(Boolean);
    return {
      name, short: MON[m], key, href: ctx.keys.has(key) ? roundupHref(key) : '', n: m + 1,
      photo, route, tiles, tileCount: tiles.length, events, hasEvents: events.length > 0, parkruns: parkrunsHere, pkLabel: `${parkrunsHere} parkrun${parkrunsHere === 1 ? '' : 's'}`, monthDays,
      km: mKm >= 1 ? km(mKm * 1000) : '', days: mDays, typeClass: tagTheme(mainTag).typeClass, tagLabel: tagTheme(mainTag).tagLabel,
      sessions: here.length, hours: hm(mSecs), lines, prs: prByMonth[m],
      rankLabel: rank === 1 ? 'the busiest month' : rank === 12 || here.length === Math.min(...monthsSessions.filter(Boolean)) ? 'the quietest month' : '',
      high: top ? { stamp: top.stamp, title: top.title, value: top.value, unit: top.unit, href: top.href, date: top.date, typeClass: top.typeClass } : null,
      more: best.slice(1, 3).map((h) => ({ stamp: h.stamp, title: h.title, href: h.href, typeClass: h.typeClass })),
      low,
      stack: [...fam.entries()].sort((p, q) => order.indexOf(p[0]) - order.indexOf(q[0])).map(([t, s]) => ({ typeClass: tagTheme(t).typeClass, share: `${round((s / famTotal) * 100, 1)}%`, label: TAGS[/** @type {keyof typeof TAGS} */ (t)]?.label })),
      flip: m % 2 === 1,
      tilt: round((rand(name) - 0.5) * 4, 2),
    };
  });

  // ---- races -----------------------------------------------------------------------
  const isRaceSlug = (/** @type {string} */ s) => Boolean(fileOf(s)?.isRace ?? ctx.list.find((x) => x.e.slug === s)?.e.isRace);
  const raceTickets = moments.filter((m) => ['weekend', 'race', 'event'].includes(m.kind) && !/parkrun/i.test(m.title) && (m.slugs || [m.slug]).some((sl) => sl && isRaceSlug(sl)))
    .sort((a, b) => a.t - b.t)
    .map((m) => ({ stamp: m.stamp, title: m.title, value: m.value, unit: m.unit, sub: m.sub, date: m.date, href: m.href, photo: ctx.showPhotos ? m.photo : '', typeClass: m.typeClass, pb: /PB/.test(`${m.sub} ${(m.tags || []).join(' ')}`), tilt: round((rand(m.title) - 0.5) * 5, 2) }));
  const parkruns = inYear.filter((x) => /parkrun/i.test(x.e.title || '')).map((x) => {
    const f = fileOf(x.e.slug);
    const info = f ? parkrunInfo(f) : null;
    const secsP = info?.time ? clockSecs(info.time) : num(x.e.durationSeconds);
    return { t: x.t, secs: secsP, time: clock(secsP), date: dm(x.t), href: hrefOf(x.e.slug), title: x.e.title, official: Boolean(info?.time) };
  }).filter((p) => p.secs > 600 && p.secs < 3600);
  const prBest = parkruns.length ? Math.min(...parkruns.map((p) => p.secs)) : 0;
  // The scale stops a third slower than the best: a walk round with the kids sits on the floor.
  const prWorst = parkruns.length ? Math.min(Math.max(...parkruns.map((p) => p.secs)), prBest * 1.33) : 0;
  const parkrunStrip = parkruns.length ? {
    count: parkruns.length, best: clock(prBest), courses: new Set(parkruns.map((p) => p.title.replace(/\s*\(#?\d+\)\s*$/, '').replace(/\s*parkrun.*$/i, '').trim())).size,
    dots: parkruns.map((p) => ({ ...p, left: round(((p.t - start) / (end - start)) * 100, 2), bottom: round(prWorst === prBest ? 50 : Math.max(0, ((prWorst - p.secs) / (prWorst - prBest)) * 100), 1), best: p.secs === prBest, off: p.secs > prWorst })),
    slow: clock(prWorst),
  } : null;

  // ---- PBs -------------------------------------------------------------------------
  const pbs = buildPbChapter(prEvents, start, end, prByMonth);

  // ---- out there -------------------------------------------------------------------
  const routes = [];
  const routeSeen = new Set();
  for (const x of [...inYear].sort((a, b) => num(b.e.distanceMeters) - num(a.e.distanceMeters))) {
    const f = fileOf(x.e.slug);
    if (!f || !Array.isArray(f.routePoints) || f.routePoints.length < 10) continue;
    // One drawing per course: the same start (to ~200 m) and distance (to 0.5 km) is the same route.
    const p0 = f.routePoints[0] || {};
    const lat = num(p0.lat ?? p0[0]), lng = num(p0.lng ?? p0.lon ?? p0[1]);
    const sig = `${Math.round(lat * 500)}:${Math.round(lng * 300)}:${Math.round(num(x.e.distanceMeters) / 500)}`;
    if (routeSeen.has(sig)) continue;
    routeSeen.add(sig);
    const pic = cardPicture({ ...(f.entry || x.e), photoUrls: [], routeThumbnailUrl: '' }, f);
    if (!pic.route) continue;
    routes.push({ ...pic.route, href: hrefOf(x.e.slug), title: x.e.title || '', km: num(x.e.distanceMeters) > 500 ? `${km(num(x.e.distanceMeters))} km` : '', typeClass: tagTheme(tagOf(x.e).tag).typeClass, i: routes.length });
    if (routes.length >= 96) break;
  }
  // Places, countries and weather from the sessions themselves (locationName, tempC,
  // weatherDescription), so they are right for a year FitGlue has not summed up yet.
  /** @type {Map<string, number>} */
  const placeCount = new Map();
  const countries = new Set();
  for (const x of inYear) {
    const parts = String(x.e.locationName || '').split(',').map((p) => p.trim()).filter(Boolean);
    if (!parts.length) continue;
    placeCount.set(parts[0], (placeCount.get(parts[0]) || 0) + 1);
    if (parts.length > 1) countries.add(parts[parts.length - 1]);
  }
  const placeList = [...placeCount.entries()].sort((a, b) => b[1] - a[1]);
  const places = placeList.slice(0, 8).map(([name, n]) => ({ name, n, pct: round((n / Math.max(1, placeList[0][1])) * 100, 1) }));
  const withTemp = inYear.filter((x) => typeof x.e.tempC === 'number');
  const hottest = withTemp.length ? withTemp.reduce((a, b) => (b.e.tempC > a.e.tempC ? b : a)) : null;
  const coldest = withTemp.length ? withTemp.reduce((a, b) => (b.e.tempC < a.e.tempC ? b : a)) : null;
  const rainy = inYear.filter((x) => /rain|drizzle|shower|storm|sleet/i.test(String(x.e.weatherDescription || '')));
  const weather = {
    sessions: withTemp.length, rain: rainy.length,
    hot: hottest ? round(hottest.e.tempC, 1) : null, hotWhat: hottest ? `${hottest.e.title} · ${dm(hottest.t)}` : '',
    cold: coldest ? round(coldest.e.tempC, 1) : null, coldWhat: coldest ? `${coldest.e.title} · ${dm(coldest.t)}` : '',
  };

  // ---- awards ----------------------------------------------------------------------
  const awards = buildAwards(inYear, byDay, r, fileOf, hrefOf);

  // ---- cover -----------------------------------------------------------------------
  const coverPhotos = [];
  const seen = new Set();
  for (const m of [...highMoments].sort((a, b) => b.score - a.score)) {
    if (m.photo && ctx.showPhotos && !seen.has(m.photo)) { seen.add(m.photo); coverPhotos.push({ url: m.photo, title: m.title, typeClass: m.typeClass }); }
    if (coverPhotos.length >= 10) break;
  }
  for (const x of inYear) {
    if (coverPhotos.length >= 10) break;
    const u = photoOf(x.e);
    if (u && !seen.has(u) && rand(x.e.slug) < 0.15) { seen.add(u); coverPhotos.push({ url: u, title: x.e.title, typeClass: tagTheme(tagOf(x.e).tag).typeClass }); }
  }
  const cover = {
    photos: coverPhotos.map((p, i) => ({ ...p, i, rot: round((rand(p.url) - 0.5) * 16, 1), x: [4, 30, 56, 80, 14, 42, 68, 88, 24, 60][i % 10], y: [6, 0, 8, 2, 44, 40, 46, 42, 74, 76][i % 10] })),
    lines: highMoments.filter((m) => ['weekend', 'race', 'pb', 'milestone', 'first'].includes(m.kind)).sort((a, b) => b.score - a.score).slice(0, 5)
      .map((m) => ({ stamp: m.stamp, title: m.title, typeClass: m.typeClass })),
    sticker: { value: thousands(inYear.length), label: 'sessions' },
  };
  // The cover stars: the three biggest moments with a picture, beside the editor's letter.
  const stars = [...highMoments].sort((a, b) => b.score - a.score).filter((m) => m.photo && ctx.showPhotos).slice(0, 3)
    .map((m, i) => ({ stamp: m.stamp, title: m.title, value: m.value, unit: m.unit, date: m.date, href: m.href, photo: m.photo, typeClass: m.typeClass, tilt: [-2.5, 1.8, -1.2][i] }));
  // The film strip: one frame per photographed session, in order, two reels.
  const frames = [];
  const framed = new Set();
  for (const x of inYear) {
    const u = photoOf(x.e);
    if (!u || framed.has(u)) continue;
    framed.add(u);
    frames.push({ url: u, title: cleanName(x.e.title), date: dm(x.t), href: hrefOf(x.e.slug), typeClass: tagTheme(tagOf(x.e).tag).typeClass, race: Boolean(x.e.isRace) });
  }
  // At most 48, spread evenly through the year.
  const pickN = 48;
  const strip = frames.length <= pickN ? frames : Array.from({ length: pickN }, (_, i) => frames[Math.floor((i * frames.length) / pickN)]);
  const reels = [strip.filter((_, i) => i % 2 === 0), strip.filter((_, i) => i % 2 === 1)].filter((r) => r.length);

  // ---- next year -------------------------------------------------------------------
  const upcoming = (opts.upcoming || []).filter((e) => e && e.kind === 'race' && Date.parse(e.start) >= end)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start)).slice(0, 6)
    .map((e) => ({ title: e.title, date: dm(Date.parse(e.start)), tilt: round((rand(e.title) - 0.5) * 4, 2) }));

  return {
    year, nextYear: year + 1, cover, numbers, arc, days: { cols: dayCols, active: activeDays, legend: legendOf(inYear) },
    stars, hasStars: stars.length > 0, film: { reels, count: frames.length, from: frames[0]?.date || '' }, hasFilm: frames.length >= 6,
    months, races: { tickets: raceTickets, parkrun: parkrunStrip, count: races.length, slower, tour: raceYear.tour }, series: raceYear.series, hasSeries: raceYear.hasSeries,
    pbs, out: { routes, weather, places, countries: countries.size > 1 ? countries.size : 0, placeCount: placeList.length },
    awards, upcoming, hasUpcoming: upcoming.length > 0,
    letter: editorsLetter({ year, sessions: inYear.length, hours, metres, kg, streak, prEvents, races, months, slower, pbs }),
    ticker: pbs.ticker,
  };
}

/** `2026-03-04` → `4 Mar` @param {string} iso */
function dmIso(iso) {
  const [, m, d] = String(iso).split('-').map(Number);
  return m ? `${d} ${MON[m - 1]}` : '';
}

/** `22:10` / `1:02:03` → seconds @param {string} s */
function clockSecs(s) {
  return String(s).split(':').map(Number).reduce((a, b) => a * 60 + b, 0);
}

/** The longest run of days with no session inside [a, b). @param {number[]} ts @param {number} a @param {number} b */
function longestGap(ts, a, b) {
  const days = [...new Set(ts.map((t) => Math.floor(t / DAY)))].sort((p, q) => p - q);
  if (!days.length) return 0;
  let best = days[0] - Math.floor(a / DAY);
  for (let i = 1; i < days.length; i++) best = Math.max(best, days[i] - days[i - 1] - 1);
  return Math.max(best, Math.floor(b / DAY) - days[days.length - 1] - 1);
}

/** A soft line through points (Catmull-Rom as cubic Béziers). @param {{ x: number, y: number }[]} p */
function smooth(p) {
  if (!p.length) return '';
  let d = `M${p[0].x},${p[0].y}`;
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[i - 1] || p[i], p1 = p[i], p2 = p[i + 1], p3 = p[i + 2] || p2;
    const c1x = round(p1.x + (p2.x - p0.x) / 6, 1), c1y = round(p1.y + (p2.y - p0.y) / 6, 1);
    const c2x = round(p2.x - (p3.x - p1.x) / 6, 1), c2y = round(p2.y - (p3.y - p1.y) / 6, 1);
    d += ` C${c1x},${c1y} ${c2x},${c2y} ${p2.x},${p2.y}`;
  }
  return d;
}

/** The longest outdoor session's route among some sessions. @param {{ e: any }[]} here @param {(slug: string) => any} fileOf */
function routeFor(here, fileOf) {
  for (const { e } of [...here].sort((a, b) => num(b.e.distanceMeters) - num(a.e.distanceMeters))) {
    const f = fileOf(e.slug);
    if (!f || !Array.isArray(f.routePoints) || f.routePoints.length < 10) continue;
    const pic = cardPicture({ ...(f.entry || e), photoUrls: [], routeThumbnailUrl: '' }, f);
    if (pic.route) return pic.route;
  }
  return null;
}

/** A session title without emoji or a trailing result. @param {string} s */
function cleanName(s) {
  return String(s || '').replace(/\p{Extended_Pictographic}|\uFE0F/gu, '').replace(/\s*-\s*\d{1,2}:\d{2}(:\d{2})?\s*$/, '').replace(/\s+/g, ' ').trim();
}

/**
 * A month's pictures: the best moments' photos first, then the month's other photos spread
 * through it, then route drawings when there are not enough photos. Up to five.
 * @param {{ e: any, t: number }[]} here @param {any[]} best @param {(slug: string) => any} fileOf @param {boolean} showPhotos
 * @param {(slug: string) => string} hrefOf
 */
function monthTiles(here, best, fileOf, showPhotos, hrefOf) {
  const out = [];
  const seen = new Set();
  const bySlug = new Map(here.map((x) => [x.e.slug, x]));
  const add = (/** @type {{ e: any, t: number }} */ x, /** @type {string} */ url, /** @type {string} */ title) => {
    if (!url || seen.has(url) || out.length >= 5) return;
    seen.add(url);
    out.push({ photo: url, route: null, title: cleanName(title || x.e.title), date: dm(x.t), href: hrefOf(x.e.slug), typeClass: tagTheme(tagOf(x.e).tag).typeClass });
  };
  if (showPhotos) {
    for (const m of best) { const x = bySlug.get(m.slug || (m.slugs || [])[0]); if (x && m.photo) add(x, m.photo, m.title); }
    const rest = here.filter((x) => https(x.e?.photoUrls?.[0]));
    const want = 5 - out.length;
    for (let i = 0; i < rest.length && out.length < 5; i++) {
      const x = rest[Math.floor((i * rest.length) / Math.max(1, Math.min(want, rest.length)))] || rest[i];
      add(x, https(x.e.photoUrls[0]), '');
    }
  }
  if (out.length < 3) {
    const routeSeen = new Set();
    for (const x of [...here].sort((a, b) => num(b.e.distanceMeters) - num(a.e.distanceMeters))) {
      if (out.length >= 3) break;
      const f = fileOf(x.e.slug);
      if (!f || !Array.isArray(f.routePoints) || f.routePoints.length < 10) continue;
      const sig = `${cleanName(x.e.title)}:${Math.round(num(x.e.distanceMeters) / 500)}`;
      if (routeSeen.has(sig)) continue;
      routeSeen.add(sig);
      const pic = cardPicture({ ...(f.entry || x.e), photoUrls: [], routeThumbnailUrl: '' }, f);
      if (pic.route) out.push({ photo: '', route: pic.route, title: cleanName(x.e.title), date: dm(x.t), href: hrefOf(x.e.slug), typeClass: tagTheme(tagOf(x.e).tag).typeClass, km: num(x.e.distanceMeters) > 500 ? `${km(num(x.e.distanceMeters))} km` : '' });
    }
  }
  return out.map((t, i) => ({ ...t, i }));
}

/** The tags of the year, by sessions, for the day grid's key. @param {{ e: any }[]} inYear */
function legendOf(inYear) {
  /** @type {Map<string, number>} */
  const c = new Map();
  for (const x of inYear) c.set(tagOf(x.e).tag, (c.get(tagOf(x.e).tag) || 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => ({ ...tagTheme(t), n }));
}

/**
 * Every PB event of the year, from each session's PERSONAL_RECORDS enrichment (the value,
 * the one it beat, when). FitGlue's division-less hybrid race keys are left out: the races
 * chapter has the Hyrox results per division.
 * @param {{ e: any, t: number }[]} inYear @param {(slug: string) => any} fileOf
 */
function prEventsOf(inYear, fileOf) {
  const out = [];
  for (const x of inYear) {
    const recs = fileOf(x.e.slug)?.activity?.enrichments?.personalRecords?.records;
    if (!Array.isArray(recs)) continue;
    for (const rec of recs) {
      const key = String(rec?.recordType || '');
      const label = recordLabel(key);
      if (!key || (label.group === 'hyrox' && !label.division)) continue;
      const value = num(rec.newValue ?? rec.value);
      if (!value) continue;
      out.push({ t: x.t, slug: x.e.slug, title: x.e.title || '', key, value, prev: rec.previousValue == null ? null : num(rec.previousValue), unit: String(rec.unit || ''), label });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

/**
 * What a gym exercise works, for the ledger's drawers.
 * @param {string} name @returns {'legs'|'push'|'pull'|'core'|'engine'}
 */
export function familyOf(name) {
  const n = name.toLowerCase();
  if (/ski|erg|row machine|rowing|wall ball|burpee|sled|farmer|carry|bike|assault|treadmill|\brun\b|jump|swing|thruster|clean|snatch|sandbag|battle rope|skipping|slam|\bbox\b/.test(n)) return 'engine';
  if (/plank|crunch|sit[- ]?up|back extension|hyperextension|\babs?\b|ab wheel|ab roll|core|russian|hollow|leg raise|knee raise|v-up|dead bug|hanging|wood ?chop|pallof|oblique|twist|mountain climber|toes to bar/.test(n)) return 'core';
  if (/squat|lunge|\bleg|deadlift|hip thrust|calf|glute|step ?up|split|rdl|good morning|hack|abduct|adduct|bridge/.test(n)) return 'legs';
  if (/row|pull|\bchin|curl|\blat\b|lat pull|shrug|bicep|face pull|rear delt|reverse fly/.test(n)) return 'pull';
  return 'push';
}

/** A record's value as text. @param {number} v @param {string} unit */
function show(v, unit) {
  if (unit === 'seconds') return clock(v);
  if (unit === 'kg') return `${round(v, 1)} kg`;
  if (unit === 'meters') return v >= 1000 ? `${km(v)} km` : `${Math.round(v)} m`;
  if (unit === 'reps') return `${Math.round(v)} reps`;
  return `${round(v, 1)}${unit ? ` ${unit}` : ''}`;
}

/**
 * The PB chapter.
 *   featured: the records worth following through the year (the run distances, and the
 *     heaviest lifts by their 1RM), each as a step line from where the year started to where
 *     it ended, every break a dot;
 *   ledger: every exercise and distance that went up, grouped, with how often and from what to what;
 *   ticker: one line per PB, newest last, for the marquee.
 * @param {any[]} ev @param {number} start @param {number} end @param {number[]} byMonth
 */
function buildPbChapter(ev, start, end, byMonth) {
  /** @type {Map<string, any[]>} */
  const byKey = new Map();
  for (const e of ev) byKey.set(e.key, [...(byKey.get(e.key) || []), e]);
  const series = [...byKey.entries()].map(([key, list]) => {
    const l = list[0].label;
    // Where the year started: the first value set in it (a break's "previous" can be a stale
    // number from before the records began).
    const first = list[0].value;
    const last = list[list.length - 1].value;
    const lower = list[0].unit === 'seconds';
    return { key, list, label: l, name: l.name, metric: l.metric, metricKey: l.metricKey, group: l.group, unit: list[0].unit, first, last, count: list.length, gain: lower ? (first - last) / Math.max(1, first) : (last - first) / Math.max(1e-9, first), lower };
  });

  const runOrder = ['5K', '10K', 'HALF MARATHON', 'MARATHON', '1K', '1 MILE'];
  const featuredRun = runOrder.map((n) => series.find((s) => s.group === 'run' && s.name === n && s.metricKey === 'fastest')).filter(Boolean);
  // The lifts people know, by their estimated 1RM, the most-broken first.
  const LIFTS = /^(deadlift|squat|back squat|front squat|bench press|overhead press|leg press|hip thrust|romanian deadlift|lat pulldown|pull ?up|chin ?up|bent over row|barbell row)\b/i;
  const featuredLift = series.filter((s) => s.group === 'strength' && s.metricKey === '1rm' && s.count >= 2 && LIFTS.test(s.name))
    .sort((a, b) => b.count - a.count || b.last - a.last).slice(0, 6);
  const featured = [...featuredRun, ...featuredLift].map((s) => progression(s, start, end));

  // The ledger, in drawers: the sports, and the gym by what the lift works. Each drawer's
  // front carries its callouts (the most broken, the biggest jump, the latest) so the
  // detail can stay folded.
  const groupsDef = [
    { key: 'run', label: 'On foot', note: 'distances and paces' }, { key: 'ride', label: 'On the bike', note: '' }, { key: 'hyrox', label: 'Hyrox', note: 'per division' },
    { key: 'legs', label: 'Legs', note: 'squats, deadlifts, lunges' }, { key: 'push', label: 'Push', note: 'presses and dips' }, { key: 'pull', label: 'Pull', note: 'rows, pull-ups, curls' },
    { key: 'core', label: 'Core', note: 'planks, crunches, carries of the middle' }, { key: 'engine', label: 'Engine', note: 'ergs, sleds, wall balls, burpees' }, { key: 'other', label: 'Everything else', note: '' },
  ];
  /** @type {Map<string, any[]>} */
  const byExercise = new Map();
  for (const s of series.filter((x) => x.group === 'strength')) byExercise.set(s.name, [...(byExercise.get(s.name) || []), s]);
  const metricOrder = ['heaviest', '1rm', 'set_volume', 'volume', 'reps'];
  const metricWord = /** @type {Record<string, string>} */ ({ heaviest: 'heaviest', '1rm': '1RM', set_volume: 'best set', volume: 'volume', reps: 'reps' });
  const lastT = (/** @type {any[]} */ ss) => Math.max(...ss.map((x) => x.list[x.list.length - 1].t));
  const gymRows = [...byExercise.entries()].map(([name, ss]) => {
    const sorted = ss.sort((a, b) => metricOrder.indexOf(a.metricKey) - metricOrder.indexOf(b.metricKey));
    const head = sorted.filter((s) => s.metricKey === 'heaviest' || s.metricKey === '1rm').sort((a, b) => b.count - a.count)[0] || sorted[0];
    return {
      name, family: familyOf(name), count: ss.reduce((n, s) => n + s.count, 0), gain: head.gain, t: lastT(ss),
      from: show(head.first, head.unit), to: show(head.last, head.unit), what: metricWord[head.metricKey] || head.metric.toLowerCase(),
      metrics: sorted.map((s) => `${metricWord[s.metricKey] || s.metric.toLowerCase()} ×${s.count}`).join(' · '),
      href: `/life/activity/${head.list[head.list.length - 1].slug}`,
    };
  });
  const ledger = groupsDef.map((g) => {
    let rows;
    if (['legs', 'push', 'pull', 'core', 'engine'].includes(g.key)) {
      rows = gymRows.filter((r) => r.family === g.key);
    } else {
      rows = series.filter((s) => s.group === g.key || (g.key === 'other' && !['run', 'ride', 'hyrox', 'strength'].includes(s.group))).map((s) => ({
        name: s.name, count: s.count, gain: s.gain, t: lastT([s]), from: show(s.first, s.unit), to: show(s.last, s.unit), what: s.metric.toLowerCase(), metrics: '',
        href: `/life/activity/${s.list[s.list.length - 1].slug}`, order: s.label.order,
      }));
    }
    rows.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    if (!rows.length) return null;
    const mostBroken = rows[0];
    const leap = [...rows].filter((r) => r.gain > 0 && r.gain < 4 && r !== mostBroken).sort((a, b) => b.gain - a.gain)[0];
    const latest = [...rows].filter((r) => r !== mostBroken && r !== leap).sort((a, b) => b.t - a.t)[0];
    const callouts = [
      { kind: 'most', label: 'most broken', name: mostBroken.name, value: `×${mostBroken.count}`, href: mostBroken.href },
      leap && { kind: 'leap', label: 'biggest jump', name: leap.name, value: `${leap.from} → ${leap.to}`, href: leap.href },
      latest && { kind: 'latest', label: 'latest', name: latest.name, value: `${dm(latest.t)} · ${latest.to}`, href: latest.href },
    ].filter(Boolean);
    const n = rows.reduce((t, x) => t + x.count, 0);
    return { ...g, rows, n, records: rows.length, callouts };
  }).filter(Boolean);
  const ledgerMax = Math.max(1, ...ledger.map((/** @type {any} */ g) => g.n));
  for (const g of /** @type {any[]} */ (ledger)) g.bar = round((g.n / ledgerMax) * 100, 1);

  const most = Math.max(1, ...byMonth);
  const months = MON.map((m, i) => ({ label: m, n: byMonth[i], h: round((byMonth[i] / most) * 100, 1), top: byMonth[i] === most }));
  const bestMonth = months.find((m) => m.top);
  const biggest = series.filter((s) => s.count >= 2 && s.gain > 0 && ['1rm', 'heaviest', 'fastest'].includes(s.metricKey) && (s.group !== 'strength' || LIFTS.test(s.name)))
    .sort((a, b) => b.gain - a.gain)[0];
  return {
    total: ev.length, exercises: series.length, featured, ledger, months, bestMonth: bestMonth ? MONTH_NAMES[MON.indexOf(bestMonth.label)] : '',
    biggest: biggest ? { name: biggest.name, metric: biggest.metric.toLowerCase(), from: show(biggest.first, biggest.unit), to: show(biggest.last, biggest.unit), pct: `${Math.round(biggest.gain * 100)}%` } : null,
    ticker: ev.slice(-60).map((e) => `${dm(e.t)} · ${e.label.name} ${e.label.metric === 'FASTEST' ? '' : `${e.label.metric.toLowerCase()} `}${show(e.value, e.unit)}`),
  };
}

/**
 * One record across the year as a step line: where it stood on 1 January (the first
 * break's previous value), every break a dot, flat to the year's end.
 * @param {any} s @param {number} start @param {number} end
 */
function progression(s, start, end) {
  const W = 300, H = 120, P = 10;
  const vals = [s.first, ...s.list.map((/** @type {any} */ e) => e.value)];
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const span = hi - lo || 1;
  // Faster is better for times, so a better time sits higher.
  const y = (/** @type {number} */ v) => round(s.lower ? P + ((v - lo) / span) * (H - 2 * P) : H - P - ((v - lo) / span) * (H - 2 * P), 1);
  const x = (/** @type {number} */ t) => round(((t - start) / (end - start)) * W, 1);
  let d = `M0,${y(s.first)}`;
  const dots = [];
  for (const e of s.list) {
    d += ` H${x(e.t)} V${y(e.value)}`;
    dots.push({ x: x(e.t), y: y(e.value), label: `${dm(e.t)}: ${show(e.value, e.unit)}`, href: `/life/activity/${e.slug}` });
  }
  d += ` H${W}`;
  const change = s.lower ? `−${clock(s.first - s.last)}` : `+${show(s.last - s.first, s.unit)}`;
  return {
    name: s.name, metric: s.metric === 'FASTEST' ? 'fastest' : s.metric.toLowerCase(), group: s.group,
    typeClass: s.group === 'run' ? 'fit-type--run' : 'fit-type--strength',
    from: show(s.first, s.unit), to: show(s.last, s.unit), change, count: s.count,
    w: W, h: H, d, dots, last: dots[dots.length - 1],
    countLabel: `broken ${s.count} time${s.count === 1 ? '' : 's'}`,
  };
}

/**
 * The year's superlatives, all from the sessions themselves.
 * @param {{ e: any, t: number }[]} inYear @param {Map<string, any[]>} byDay @param {any} r
 * @param {(slug: string) => any} fileOf @param {(slug: string) => string} hrefOf
 */
function buildAwards(inYear, byDay, r, fileOf, hrefOf) {
  if (!inYear.length) return [];
  const out = [];
  const by = (/** @type {(x: any) => number} */ f) => [...inYear].sort((a, b) => f(b) - f(a))[0];
  const longest = by((x) => num(x.e.durationSeconds));
  out.push({ stamp: 'MARATHON EFFORT', title: 'Longest session', value: hm(num(longest.e.durationSeconds)), sub: `${longest.e.title} · ${dm(longest.t)}`, href: hrefOf(longest.e.slug) });
  const heavy = by((x) => num(x.e.totalWeightKg));
  if (num(heavy.e.totalWeightKg) > 0) out.push({ stamp: 'HEAVY LIFTING', title: 'Most weight in one session', value: `${round(num(heavy.e.totalWeightKg) / 1000, 1)} t`, sub: `${heavy.e.title} · ${dm(heavy.t)}`, href: hrefOf(heavy.e.slug) });
  const hr = by((x) => num(x.e.avgHeartRate));
  if (num(hr.e.avgHeartRate) > 0) out.push({ stamp: 'RED LINE', title: 'Highest average heart rate', value: `${Math.round(num(hr.e.avgHeartRate))} bpm`, sub: `${hr.e.title} · ${dm(hr.t)}`, href: hrefOf(hr.e.slug) });
  // Earliest start, in the site's own time.
  const minutes = (/** @type {number} */ t) => { const s = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(t)); const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  const early = [...inYear].filter((x) => minutes(x.t) >= 240).sort((a, b) => minutes(a.t) - minutes(b.t))[0];
  if (early) { const m = minutes(early.t); out.push({ stamp: 'ALARM CLOCK', title: 'Earliest start', value: `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`, sub: `${early.e.title} · ${dm(early.t)}`, href: hrefOf(early.e.slug) }); }
  const late = [...inYear].sort((a, b) => minutes(b.t) - minutes(a.t))[0];
  if (late) { const m = minutes(late.t); out.push({ stamp: 'NIGHT SHIFT', title: 'Latest start', value: `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`, sub: `${late.e.title} · ${dm(late.t)}`, href: hrefOf(late.e.slug) }); }
  const busiest = [...byDay.entries()].sort((a, b) => b[1].length - a[1].length)[0];
  if (busiest && busiest[1].length >= 3) out.push({ stamp: 'DOUBLE DAY', title: 'Most sessions in a day', value: String(busiest[1].length), sub: `${dmIso(busiest[0])}: ${busiest[1].map((x) => x.e.title).slice(0, 3).join(', ')}`, href: hrefOf(busiest[1][0].e.slug) });
  const dowCount = Array.from({ length: 7 }, () => 0);
  for (const x of inYear) dowCount[(new Date(Date.parse(`${ymd(new Date(x.t))}T12:00:00Z`)).getUTCDay() + 6) % 7] += 1;
  const fav = dowCount.indexOf(Math.max(...dowCount));
  const rest = dowCount.indexOf(Math.min(...dowCount));
  out.push({ stamp: 'FAVOURITE DAY', title: `${DOW[fav]}s`, value: String(dowCount[fav]), sub: `sessions on a ${DOW[fav]}; ${DOW[rest]} was the day off (${dowCount[rest]})`, href: '' });
  /** @type {Map<string, number>} */
  const titles = new Map();
  for (const x of inYear) { const t = String(x.e.title || '').replace(/\s*\(#?\d+\)\s*$/, '').trim(); if (t && !/^(morning|afternoon|evening|lunch|night) /i.test(t)) titles.set(t, (titles.get(t) || 0) + 1); }
  const regular = [...titles.entries()].sort((a, b) => b[1] - a[1])[0];
  if (regular && regular[1] >= 5) out.push({ stamp: 'REGULAR', title: regular[0], value: `×${regular[1]}`, sub: 'the session that kept coming back', href: '' });
  /** @type {Map<string, number>} */
  const pc = new Map();
  for (const x of inYear) { const p = String(x.e.locationName || '').split(',')[0].trim(); if (p) pc.set(p, (pc.get(p) || 0) + 1); }
  const place = [...pc.entries()].sort((a, b) => b[1] - a[1])[0];
  if (place) out.push({ stamp: 'SECOND HOME', title: place[0], value: String(place[1]), sub: 'sessions there this year', href: '' });
  const far = by((x) => num(x.e.distanceMeters));
  if (num(far.e.distanceMeters) > 1000) out.push({ stamp: 'FURTHEST', title: 'Furthest in one go', value: `${km(num(far.e.distanceMeters))} km`, sub: `${far.e.title} · ${dm(far.t)}`, href: hrefOf(far.e.slug) });
  return out.map((a, i) => ({ ...a, i, icon: awardIcon(a.stamp), tilt: round((rand(a.title) - 0.5) * 5, 2) }));
}

/**
 * The editor's letter that opens the issue: written from the year's own figures, so it
 * never disagrees with the pages after it.
 * @param {any} y
 */
function editorsLetter(y) {
  const busiest = y.months.filter((/** @type {any} */ m) => !m.empty).sort((/** @type {any} */ a, /** @type {any} */ b) => b.sessions - a.sessions)[0];
  const quietest = y.months.filter((/** @type {any} */ m) => !m.empty).sort((/** @type {any} */ a, /** @type {any} */ b) => a.sessions - b.sessions)[0];
  const parts = [
    `It was a year of ${thousands(y.sessions)} sessions and ${thousands(y.hours)} hours of trying to stay alive, ${y.streak.days >= 30 ? `and it started with ${y.streak.days} days without a single day off` : 'give or take'}.`,
    `There were ${y.races.length} races, ${thousands(y.prEvents.length)} personal bests${y.pbs.bestMonth ? ` (${y.pbs.bestMonth} alone was a PB factory)` : ''}, ${thousands(y.metres / 1000)} km on foot and wheel${y.kg > 0 ? `, and ${thousands(y.kg / 1000)} tonnes picked up and put back down again` : ''}.`,
    busiest ? `${busiest.name} was the busiest month${quietest && quietest !== busiest ? `; ${quietest.name} the quietest` : ''}.` : '',
    y.slower.length ? `Not everything went to plan: ${y.slower.length === 1 ? 'one race' : `${y.slower.length} races`} came in slower than the PB, and they are in here too, because a year is the lows as much as the highs.` : '',
    'Turn the page.',
  ];
  return parts.filter(Boolean);
}

/**
 * Stack labels on a line so neighbours never collide: each takes the lowest level whose
 * previous label is far enough away (about a label's width, a sixth of the chart).
 * @template {{ x: number }} T @param {T[]} list sorted by x @param {number} W
 * @returns {(T & { level: number })[]}
 */
function levels(list, W) {
  // Each label is a span of about a sixth of the chart, to the right of its point, or to
  // the left when the point sits in the last fifth (the pin flips there).
  const span = W * 0.17;
  /** @type {[number, number][][]} */
  const taken = [];
  return list.map((it) => {
    const a = it.x > W * 0.8 ? it.x - span : it.x;
    const b = a + span;
    let level = 0;
    while ((taken[level] || []).some(([p, q]) => a < q && p < b)) level++;
    (taken[level] = taken[level] || []).push([a, b]);
    return { ...it, level };
  });
}
