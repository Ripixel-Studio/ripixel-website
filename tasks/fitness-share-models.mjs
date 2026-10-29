// @ts-check
/**
 * Share cards (F5.4): what goes on each card — data only.
 *
 * One model per activity, race weekend and roundup, built from the same view models
 * the pages render (buildActivityView, buildEventView, buildRoundupView), so a card
 * never disagrees with its page. scripts/share-cards.mjs draws a model in each shape;
 * tasks/fitness-og-images.mjs picks backgrounds, renders and caches.
 *
 * Templates:
 *   event     a race weekend: every race with its total, division, PB badge or gap
 *   race      a Hyrox (hybrid) race: splits as interleaved runs/stations with avg HR
 *   parkrun   a run plus position, parkrun count, age grade, PB or the gap to it
 *   run       distance, time, pace, HR, km splits, the route
 *   strength  sets, volume, top sets, the session's PBs (heaviest lifts first)
 *   other     rides, walks, classes: the page's four numbers and the HR trace
 *   roundup   week / month / year: totals, sport donut, calendar heatmap, PR wall, vs last
 */
import { buildActivityView, fmtPace, prValue } from './fitness-activity-views.mjs';
import { buildEventView } from './fitness-event-views.mjs';
import { buildRoundupView, calendarDays } from './fitness-roundup-views.mjs';
import { TYPE_INKS, FAMILIES, typeKeyOf } from './fitness-theme.mjs';
import { recordLabel } from './fitness-records.mjs';
import { clock, deltaClock } from './fitness-hyrox.mjs';

/** Roundups are not one activity type: paper ground, the /life section violet as the accent. */
export const ROUNDUP_INK = { type: '#F5EFDF', on: '#171311', text: '#7C3AED', accent: '#7C3AED' };

/** @param {unknown} v */
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
/** @param {unknown} u */
const httpsUrl = (u) => (typeof u === 'string' && /^https:\/\//.test(u) ? u : '');

/** "24:39" / "1:02:03" → seconds (0 when unparsable). @param {unknown} s */
export function parseClock(s) {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(s ?? '').trim());
  if (!m) return 0;
  return m[3] !== undefined ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : Number(m[1]) * 60 + Number(m[2]);
}

/**
 * Every parkrun on record, oldest first, for "PB" / "the gap to the PB" on a parkrun
 * card (the export's isTimePb says whether this one was a PB, not what the PB was).
 * @param {any[]} activities  fitnessActivities
 * @returns {{ slug: string, date: number, seconds: number }[]}
 */
export function parkrunHistory(activities) {
  return (Array.isArray(activities) ? activities : [])
    .map((f) => ({ slug: String(f?.slug ?? ''), date: Date.parse(f?.activity?.startTime ?? f?.entry?.startTime ?? '') || 0, seconds: parseClock(f?.activity?.enrichments?.parkrun?.finishTime) }))
    .filter((p) => p.slug && p.date && p.seconds > 0)
    .sort((a, b) => a.date - b.date);
}

/** The photos a card may sit on: the activity's own (https, first three), else its AI banner. @param {any} act */
function photosOf(act) {
  const list = (act.photos || []).map(httpsUrl).filter(Boolean);
  if (!list.length && httpsUrl(act.bannerUrl)) list.push(act.bannerUrl);
  return list.slice(0, 3);
}

/** @param {any} race  buildRaceView() output @returns {import('../scripts/share-cards.mjs').Badge} */
function raceBadge(race) {
  if (!race) return { kind: '', text: '' };
  if (race.isTotalPB) return { kind: 'pb', text: race.totalPbTime ? `New PB · was ${race.totalPbTime}` : 'New PB' };
  if (race.isFirst) return { kind: 'first', text: `PB · first ${race.divisionLabel || 'race'}` };
  if (race.totalDelta) return { kind: 'gap', tone: race.totalTone === 'gain' ? 'gain' : race.totalTone === 'loss' ? 'loss' : '', text: `${race.totalDelta} vs PB ${race.totalPbTime}` };
  if (race.isSimulation) return { kind: 'sim', text: 'Simulation' };
  return { kind: '', text: '' };
}

/** @param {any[]} anchors */
function statsOf(anchors) {
  return (anchors || []).filter((a) => a && a.value && a.value !== '—' && a.label !== 'activity type').map((a) => ({ value: String(a.value), unit: a.unit || '', label: a.label }));
}

/** @param {...string} bits */
const joinDot = (...bits) => bits.filter(Boolean).join(' · ');

/**
 * Km splits for the column chart. A short last split (a partial km) is dropped.
 * @param {any[]} kmSplits
 */
export function splitsOf(kmSplits) {
  const list = (Array.isArray(kmSplits) ? kmSplits : []).filter((s) => num(s?.durationSeconds) > 0 && num(s?.km) > 0);
  if (list.length < 2) return [];
  const sorted = list.map((s) => num(s.durationSeconds)).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const kept = list.filter((s, i) => !(i === list.length - 1 && num(s.durationSeconds) < median * 0.6));
  return kept.map((s) => ({ km: num(s.km), seconds: num(s.durationSeconds), pace: fmtPace(num(s.durationSeconds)) }));
}

/** The heaviest set of each exercise, by volume, as list rows. @param {any[]} sets  every session's strengthSets @param {Set<string>} prExercises */
export function topSets(sets, prExercises = new Set()) {
  /** @type {Map<string, { name: string, volume: number, best: any }>} */
  const by = new Map();
  for (const s of Array.isArray(sets) ? sets : []) {
    const name = String(s?.exerciseName ?? '').trim();
    if (!name) continue;
    const e = by.get(name) || { name, volume: 0, best: null };
    e.volume += num(s.reps) * num(s.weightKg);
    const better = !e.best
      || num(s.weightKg) > num(e.best.weightKg)
      || (num(s.weightKg) === num(e.best.weightKg) && (num(s.reps) > num(e.best.reps) || num(s.durationSeconds) > num(e.best.durationSeconds) || num(s.distanceMeters) > num(e.best.distanceMeters)));
    if (better) e.best = s;
    by.set(name, e);
  }
  const fmtKg = (/** @type {number} */ kg) => (kg % 1 === 0 ? String(kg) : kg.toFixed(1));
  return [...by.values()]
    .sort((a, b) => b.volume - a.volume)
    .map((e) => {
      const b = e.best;
      let value;
      if (num(b.weightKg) > 0 && num(b.reps) > 0) value = `${fmtKg(num(b.weightKg))} kg × ${num(b.reps)}`;
      else if (num(b.durationSeconds) > 0) value = clock(num(b.durationSeconds)) + (num(b.weightKg) > 0 ? ` × ${fmtKg(num(b.weightKg))} kg` : '');
      else if (num(b.distanceMeters) > 0) value = `${Math.round(num(b.distanceMeters))} m` + (num(b.weightKg) > 0 ? ` × ${fmtKg(num(b.weightKg))} kg` : '');
      else value = `${num(b.reps)} reps`;
      return { name: e.name, value, tag: prExercises.has(e.name.toLowerCase()) ? 'PB' : '' };
    });
}

const PR_ORDER = ['heaviest', '1rm', 'fastest', 'longest', 'set_volume', 'volume', 'reps', 'elevation', 'best'];

/**
 * An activity's records as PR-wall boxes, heaviest lifts and fastest times first.
 * @param {any[]} records  enrichments.personalRecords.records ({ recordType, newValue, previousValue, unit })
 */
export function prBoxes(records) {
  return (Array.isArray(records) ? records : [])
    .filter((r) => r && typeof r.recordType === 'string')
    .map((r) => {
      const label = recordLabel(r.recordType);
      const v = prValue(r.newValue ?? r.value, r.unit);
      const prev = r.previousValue;
      let delta = '';
      if (typeof prev === 'number' && prev > 0) {
        const d = num(r.newValue ?? r.value) - prev;
        if (r.unit === 'seconds' && d < 0) delta = deltaClock(d);
        else if (r.unit !== 'seconds' && d > 0) delta = `+${Number.isInteger(d) ? d : d.toFixed(1)}${r.unit === 'kg' ? ' kg' : ''}`;
      } else delta = 'NEW';
      return { name: label.name, metric: label.metric, value: v.val, unit: v.unit, delta, order: PR_ORDER.indexOf(label.metricKey) };
    })
    .sort((a, b) => (a.order === -1 ? 99 : a.order) - (b.order === -1 ? 99 : b.order));
}

/** The exercise names (lower-case) that a record names. @param {any[]} records */
function prExerciseNames(records) {
  return new Set((records || []).map((r) => recordLabel(r?.recordType).name.toLowerCase()).filter(Boolean));
}

/**
 * The model for one activity, or null when it has no usable slug.
 * @param {any} file  an element of fitnessActivities
 * @param {any} index  fitnessIndex
 * @param {{ hyrox?: any, parkruns?: ReturnType<typeof parkrunHistory>, photoDims?: any }} [opts]
 */
export function activityShareModel(file, index, opts = {}) {
  const view = buildActivityView(file, index, { hyrox: opts.hyrox ?? null, photoDims: opts.photoDims });
  const act = view.act;
  if (!act.slug) return null;
  const typeKey = act.typeKey;
  const ink = TYPE_INKS[typeKey] || TYPE_INKS.other;
  const en = file?.activity?.enrichments || {};
  const records = Array.isArray(en.personalRecords?.records) ? en.personalRecords.records : [];
  const base = {
    kind: 'activity',
    id: act.slug,
    url: act.url,
    pageTitle: act.title,
    date: act.dateIso,
    typeKey,
    ink,
    photos: photosOf(act),
    dateLine: joinDot(act.dateStamp, act.locationName),
  };

  if (act.race) {
    const race = act.race;
    const segs = Array.isArray(file?.race?.segments) ? file.race.segments : [];
    const brand = act.typeLabel || 'HYROX';
    return {
      ...base,
      template: 'race',
      pill: brand,
      watermark: race.event ? String(race.event) : brand,
      label: brand === 'HYROX' ? 'Hyrox' : brand,
      isRace: !race.isSimulation,
      isPB: !!(race.isTotalPB || race.isFirst) || race.prCount > 0,
      kicker: joinDot(brand, race.isSimulation ? 'simulation' : race.divisionLabel),
      title: race.event ? `${brand} ${race.event}` : act.title,
      total: race.total || '—',
      badge: raceBadge(race),
      ranks: race.ranks,
      partner: race.partner,
      runs: race.runs,
      stations: race.stations,
      roxzone: race.roxzone,
      avgHr: num(Number(act.anchors.find((/** @type {any} */ a) => a.label === 'avg hr')?.value)) || 0,
      rows: race.rows.map((/** @type {any} */ r, /** @type {number} */ i) => ({ ...r, seconds: num(segs[i]?.durationSeconds) })),
    };
  }

  const prs = prBoxes(records);
  const prBadge = prs.length
    ? { kind: /** @type {const} */ ('pb'), text: prs.length === 1 ? `PB · ${prs[0].metric.toLowerCase()} ${prs[0].name}` : `${prs.length} personal records` }
    : { kind: /** @type {const} */ (''), text: '' };

  if (act.parkrun) {
    const pk = act.parkrun;
    const me = parseClock(pk.finishTime);
    const t = Date.parse(act.dateIso) || 0;
    const before = (opts.parkruns || []).filter((p) => p.date < t && p.slug !== act.slug);
    const best = before.length ? Math.min(...before.map((p) => p.seconds)) : 0;
    let badge = prBadge;
    if (pk.isTimePb) badge = { kind: 'pb', text: best ? `New parkrun PB · was ${clock(best)}` : 'New parkrun PB' };
    else if (best && me) badge = { kind: 'gap', tone: me <= best ? 'gain' : 'loss', text: `${deltaClock(me - best)} vs PB ${clock(best)}` };
    const splits = splitsOf(file?.kmSplits);
    return {
      ...base,
      template: 'parkrun',
      pill: 'PARKRUN',
      watermark: pk.totalParkruns ? `No. ${pk.totalParkruns}` : 'parkrun',
      label: 'parkrun',
      isRace: false,
      isPB: !!pk.isTimePb || prs.length > 0,
      kicker: joinDot('parkrun', pk.eventName),
      title: act.title,
      badge,
      stats: statsOf(act.anchors),
      parkrun: { position: pk.position !== '—' ? pk.position : '', number: pk.totalParkruns || '', ageGrade: pk.ageGrade !== '—' ? pk.ageGrade : '' },
      splits,
      splitNote: splits.length ? `fastest ${fmtPace(Math.min(...splits.map((s) => s.seconds)))} /km` : '',
      route: Array.isArray(file?.routePoints) ? file.routePoints : [],
    };
  }

  if (typeKey === 'run') {
    const splits = splitsOf(file?.kmSplits);
    return {
      ...base,
      template: 'run',
      pill: act.typeLabel === 'RUN' ? 'RUN' : act.typeLabel,
      label: 'run',
      isRace: false,
      isPB: prs.length > 0,
      kicker: joinDot(act.typeLabel, act.source ? `via ${act.source}` : ''),
      title: act.title,
      badge: prBadge,
      stats: statsOf(act.anchors),
      splits,
      splitNote: splits.length ? `fastest ${fmtPace(Math.min(...splits.map((s) => s.seconds)))} /km` : '',
      route: Array.isArray(file?.routePoints) ? file.routePoints : [],
    };
  }

  const sessions = Array.isArray(file?.activity?.activityData?.sessions) ? file.activity.activityData.sessions : [];
  const sets = sessions.flatMap((/** @type {any} */ s) => (Array.isArray(s?.strengthSets) ? s.strengthSets : []));
  if (act.category === 'strength' && sets.length) {
    const top = topSets(sets, prExerciseNames(records));
    return {
      ...base,
      template: 'strength',
      pill: act.source === 'Hevy' ? 'HEVY' : 'STRENGTH',
      label: act.source === 'Hevy' ? 'Hevy' : 'strength',
      isRace: false,
      isPB: prs.length > 0,
      kicker: joinDot(act.typeLabel, act.source ? `via ${act.source}` : ''),
      title: act.title,
      badge: prBadge,
      stats: statsOf(act.anchors).filter((s) => s.label !== 'personal records' || s.value !== '—'),
      topSets: top,
      exerciseCount: top.length,
      prs,
    };
  }

  const hr = Array.isArray(file?.series?.heartRate) ? file.series.heartRate : [];
  return {
    ...base,
    template: 'other',
    pill: FAMILIES[typeKey]?.label.toUpperCase().replace(/ & .*/, '') || 'FITNESS',
    label: (act.typeLabel || 'session').toLowerCase(),
    isRace: false,
    isPB: prs.length > 0,
    kicker: joinDot(act.typeLabel, act.source ? `via ${act.source}` : ''),
    title: act.title,
    badge: prBadge,
    stats: statsOf(act.anchors),
    hr,
    route: Array.isArray(file?.routePoints) && act.category === 'cardio-distance' ? file.routePoints : [],
  };
}

/**
 * The model for one race weekend.
 * @param {any} event  an element of buildHyroxHistory().events
 * @param {any} history
 * @param {any} index
 * @param {{ photoDims?: any }} [opts]
 */
export function eventShareModel(event, history, index, opts = {}) {
  const page = buildEventView(event, history, index, { photoDims: opts.photoDims });
  const ev = page.ev;
  const races = ev.cards.map((/** @type {any} */ c) => ({
    date: c.date,
    division: c.division,
    total: c.total,
    badge: c.isPB ? { kind: 'pb', text: c.totalPbTime ? `New PB · was ${c.totalPbTime}` : 'New PB' }
      : c.isFirst ? { kind: 'first', text: c.firstLabel || 'PB · first race' }
        : c.totalDelta ? { kind: 'gap', tone: c.totalTone === 'gain' ? 'gain' : c.totalTone === 'loss' ? 'loss' : '', text: `${c.totalDelta} vs PB ${c.totalPbTime}` }
          : { kind: '', text: '' },
    ranks: c.ranks,
    partner: c.partner,
    avgHr: c.avgHr,
  }));
  const collage = ev.collage.map((/** @type {any} */ c) => httpsUrl(c.src)).filter(Boolean);
  const more = ev.cards.flatMap((/** @type {any} */ c) => c.photos || []).map(httpsUrl).filter((u) => u && !collage.includes(u));
  return {
    kind: 'event',
    id: ev.slug,
    url: `/life/event/${ev.slug}`,
    pageTitle: ev.name,
    date: event.start,
    template: 'event',
    watermark: `${ev.raceCount} races`,
    typeKey: ev.typeKey,
    ink: TYPE_INKS[/** @type {keyof typeof TYPE_INKS} */ (ev.typeKey)] || TYPE_INKS.crossfit,
    pill: 'RACE WEEKEND',
    label: 'race weekend',
    isRace: true,
    isPB: ev.pbCount > 0 || ev.cards.some((/** @type {any} */ c) => c.isFirst),
    kicker: joinDot('race weekend', ev.range, ev.venue),
    title: ev.name,
    races,
    raceCount: ev.raceCount,
    totalTime: ev.totalTime,
    pbCount: ev.pbCount,
    divisionCount: ev.divisionCount,
    collage,
    photos: [...collage, ...more].slice(0, 3),
  };
}

const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/**
 * Calendar cells for the heatmap: Monday-first, a column per week.
 * @param {'week'|'month'|'year'} type @param {any} r  the roundup
 */
export function roundupCalendar(type, r) {
  const days = calendarDays(r?.periodStart, r?.periodEnd, r?.dayEntries);
  /** @type {{ level: number, dow: number, col: number, label: string }[]} */
  const out = [];
  /** @type {{ col: number, label: string }[]} */
  const months = [];
  let col = 0;
  let lastMonth = -1;
  days.forEach((d, i) => {
    const dow = (d.date.getUTCDay() + 6) % 7;
    if (i > 0 && dow === 0) col++;
    const m = d.date.getUTCMonth();
    if (type === 'year' && m !== lastMonth) { months.push({ col, label: MONTHS[m] }); lastMonth = m; }
    out.push({ level: d.level, dow, col, label: type === 'week' ? `${DOW[dow]} ${d.date.getUTCDate()}` : '' });
  });
  return { type, days: out, months };
}

/**
 * The model for one roundup.
 * @param {any} file  an element of fitnessRoundups
 * @param {any} ctx   buildRoundupView's ctx (byKey, neighbours, activitySlugs, showPhotoGallery)
 */
export function roundupShareModel(file, ctx) {
  const view = buildRoundupView(file, ctx);
  const r = file.roundup || {};
  /** @type {Map<string, number>} */
  const fam = new Map();
  for (const b of r.activityTypeBreakdowns || []) {
    if (!b) continue;
    const k = typeKeyOf(b.activityType);
    fam.set(k, (fam.get(k) || 0) + num(b.activityCount));
  }
  const sports = [...fam.entries()].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1])
    .map(([k, count]) => ({ label: FAMILIES[/** @type {keyof typeof FAMILIES} */ (k)].label, count, ink: TYPE_INKS[/** @type {keyof typeof TYPE_INKS} */ (k)].type }));
  const prs = view.records.flatMap((/** @type {any} */ g) => g.metrics.slice(0, 1).map((/** @type {any} */ m) => ({ name: g.label, metric: m.metric || '', value: m.value, unit: m.unit, delta: m.delta })));
  const end = r.periodEnd || '';
  const type = view.type;
  const titleText = type === 'year' ? `${view.title} in review` : view.title;
  return {
    kind: 'roundup',
    id: file.key,
    url: view.url,
    pageTitle: `${view.subpage || view.title} roundup`,
    date: end,
    template: 'roundup',
    typeKey: 'other',
    ink: ROUNDUP_INK,
    pill: type === 'week' ? 'WEEKLY ROUNDUP' : type === 'month' ? 'MONTHLY ROUNDUP' : 'YEAR IN REVIEW',
    label: type === 'week' ? `${view.title.toLowerCase()} roundup` : type === 'month' ? `${view.title} roundup` : `${view.title} year`,
    isRace: false,
    isPB: view.prCount > 0,
    kicker: joinDot(view.kicker, view.dateRange),
    title: titleText,
    byline: '',
    totals: view.totals.filter((/** @type {any} */ t) => t.value && t.value !== '—'),
    sessions: num(r.totalActivities),
    sports,
    calendar: roundupCalendar(/** @type {any} */ (type), r),
    activeDays: view.activeDays,
    prs,
    prCount: view.prCount,
    vs: view.comparison && view.comparison.deltas.length ? { label: view.comparison.label, deltas: view.comparison.deltas } : null,
    photos: view.photos.map((/** @type {any} */ p) => httpsUrl(p.url)).filter(Boolean).slice(0, 3),
  };
}

