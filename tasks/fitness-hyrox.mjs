// @ts-check
/**
 * Hyrox race views (F5.2) — everything a /life activity or event page shows about a
 * Hyrox race, built from the export's derived `race` key (FitGlue siteexport §3.4:
 * official splits, division, placings, per-segment heart rate).
 *
 * Per-activity facts come from the export; anything that spans races is computed here,
 * across the whole history the build has loaded:
 *
 *   - PBs per division (total, every run, every station, Roxzone), as they stood
 *     before each race, so a page shows "vs PB" the way it was on race day;
 *   - PB progression per division (the chart);
 *   - race weekends: several races at the same event within a few days become one
 *     event page (any number of races, any divisions).
 *
 * Simulations ("Hyrox Sim") render their splits but never set or chase a PB.
 */

/** Days within which races at the same event count as one weekend. */
export const EVENT_WINDOW_DAYS = 4;
export const EVENT_BASE_PATH = '/life/event';

const STATION_ICONS = /** @type {Record<string, string>} */ ({
  skierg: '⛷️', sled_push: '🛷', sled_pull: '🛷', burpee_broad_jump: '🐸', rowing: '🚣',
  farmers_carry: '🧳', sandbag_lunges: '🎒', wall_balls: '🏐',
});

/** @param {unknown} v */
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** Seconds → "5:39" / "1:29:42". */
export function clock(s) {
  const v = Math.round(num(s));
  if (v <= 0) return '';
  const h = Math.floor(v / 3600);
  const m = Math.floor((v % 3600) / 60);
  const sec = v % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

/** Signed delta in seconds → "+5:55" / "−0:12" / "±0:00". */
export function deltaClock(d) {
  const v = Math.round(num(d));
  if (v === 0) return '±0:00';
  const a = Math.abs(v);
  const body = a >= 3600 ? clock(a) : `${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')}`;
  return `${v > 0 ? '+' : '−'}${body}`;
}

/**
 * The export's race, or null when the file has none usable.
 * @param {any} file
 */
export function raceOf(file) {
  const r = file?.race;
  if (!r || !Array.isArray(r.segments) || r.segments.length < 2) return null;
  return r;
}

/**
 * The categories one race contributes: total_time, run_N, the station keys, roxzone.
 * @param {any} race
 * @returns {Record<string, number>}
 */
export function raceValues(race) {
  /** @type {Record<string, number>} */
  const out = {};
  if (num(race.totalSeconds) > 0) out.total_time = race.totalSeconds;
  for (const s of race.segments) if (s?.key && num(s.durationSeconds) > 0) out[s.key] = s.durationSeconds;
  if (num(race.roxzoneSeconds) > 0) out.roxzone = race.roxzoneSeconds;
  return out;
}

/** @param {any} file */
function startOf(file) {
  return String(file?.activity?.startTime ?? file?.entry?.startTime ?? '');
}

/** @param {any} file */
function slugOf(file) {
  return String(file?.slug ?? file?.entry?.showcaseId ?? '');
}

/** @param {any} file */
function titleOf(file) {
  return String(file?.activity?.title ?? file?.entry?.title ?? '');
}

/**
 * @typedef {{ seconds: number, slug: string, title: string, date: string, splitSource: string }} Best
 * @typedef {{ slug: string, date: string, title: string, event: string, total: number, isPB: boolean, isFirst: boolean }} DivisionRace
 * @typedef {{ key: string, label: string, races: DivisionRace[], best: Record<string, Best> }} DivisionHistory
 * @typedef {{ division: { key: string, label: string }, values: Record<string, number>, before: Record<string, Best>, pbs: Set<string>, isFirst: boolean, isSimulation: boolean }} RaceStanding
 * @typedef {{ slug: string, url: string, title: string, date: string, total: string, totalSeconds: number, divisionKey: string, divisionLabel: string, isSimulation: boolean, isPB: boolean, file: any }} RaceInfo
 * @typedef {{ divisions: DivisionHistory[], byDivision: Map<string, DivisionHistory>, bySlug: Map<string, RaceStanding>, races: Map<string, RaceInfo>, events: EventGroup[], eventBySlug: Map<string, EventGroup> }} HyroxHistory
 * @typedef {{ slug: string, name: string, start: string, end: string, slugs: string[] }} EventGroup
 */

/**
 * PB history and race weekends across every loaded activity.
 * @param {any[]} activities  `fitnessActivities`
 * @returns {HyroxHistory}
 */
export function buildHyroxHistory(activities) {
  const list = (Array.isArray(activities) ? activities : [])
    .map((file) => ({ file, race: raceOf(file), slug: slugOf(file), date: startOf(file), title: titleOf(file) }))
    .filter((r) => r.race && r.slug && r.date)
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));

  /** @type {Map<string, DivisionHistory>} */
  const byDivision = new Map();
  /** @type {Map<string, RaceStanding>} */
  const bySlug = new Map();

  for (const r of list) {
    const race = r.race;
    const div = race.division;
    const values = raceValues(race);
    if (race.isSimulation || !div?.key) {
      // Splits still render; compared against the division's PBs as they stood, never counted.
      const hist = div?.key ? byDivision.get(div.key) : undefined;
      bySlug.set(r.slug, { division: div ? { key: div.key, label: div.label } : { key: '', label: '' }, values, before: hist ? { ...hist.best } : {}, pbs: new Set(), isFirst: false, isSimulation: !!race.isSimulation });
      continue;
    }
    let hist = byDivision.get(div.key);
    if (!hist) {
      hist = { key: div.key, label: div.label, races: [], best: {} };
      byDivision.set(div.key, hist);
    }
    const before = { ...hist.best };
    const isFirst = hist.races.length === 0;
    const pbs = new Set();
    for (const [cat, secs] of Object.entries(values)) {
      if (!before[cat] || secs < before[cat].seconds) pbs.add(cat);
    }
    bySlug.set(r.slug, { division: { key: div.key, label: div.label }, values, before, pbs, isFirst, isSimulation: false });
    hist.races.push({ slug: r.slug, date: r.date, title: r.title, event: String(race.event || ''), total: num(race.totalSeconds), isPB: pbs.has('total_time'), isFirst });
    for (const cat of pbs) hist.best[cat] = { seconds: values[cat], slug: r.slug, title: r.title, date: r.date, splitSource: String(race.splitSource || '') };
  }

  /** @type {Map<string, RaceInfo>} */
  const races = new Map();
  for (const r of list) {
    const st = bySlug.get(r.slug);
    races.set(r.slug, {
      slug: r.slug, url: `/life/activity/${r.slug}`, title: r.title, date: r.date,
      total: clock(r.race.totalSeconds), totalSeconds: num(r.race.totalSeconds),
      divisionKey: String(r.race.division?.key ?? ''), divisionLabel: String(r.race.division?.label ?? ''),
      isSimulation: !!r.race.isSimulation, isPB: !!st && !st.isSimulation && st.pbs.has('total_time'), file: r.file,
    });
  }

  const events = groupEvents(list.filter((r) => !r.race.isSimulation).map((r) => ({ slug: r.slug, date: r.date, event: String(r.race.event || ''), location: String(r.file?.activity?.enrichments?.location?.locationName ?? '') })));
  /** @type {Map<string, EventGroup>} */
  const eventBySlug = new Map();
  for (const e of events) for (const s of e.slugs) eventBySlug.set(s, e);

  return { divisions: [...byDivision.values()], byDivision, bySlug, races, events, eventBySlug };
}

/** "London Olympia" → "london-olympia". */
export function slugify(s) {
  return String(s ?? '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-');
}

/**
 * Group races by event (name, else venue) when they fall within EVENT_WINDOW_DAYS of
 * the previous race at that event. Only groups of two or more become events.
 * @param {{ slug: string, date: string, event: string, location: string }[]} races  oldest first
 * @returns {EventGroup[]}
 */
export function groupEvents(races) {
  /** @type {Map<string, { name: string, groups: { start: string, end: string, slugs: string[] }[] }>} */
  const byName = new Map();
  for (const r of races) {
    const name = r.event || r.location;
    const key = slugify(name);
    if (!key) continue;
    let entry = byName.get(key);
    if (!entry) {
      entry = { name, groups: [] };
      byName.set(key, entry);
    }
    const last = entry.groups[entry.groups.length - 1];
    if (last && Date.parse(r.date) - Date.parse(last.end) <= EVENT_WINDOW_DAYS * 86400e3) {
      last.slugs.push(r.slug);
      last.end = r.date;
    } else {
      entry.groups.push({ start: r.date, end: r.date, slugs: [r.slug] });
    }
  }
  /** @type {EventGroup[]} */
  const out = [];
  for (const [key, entry] of byName) {
    for (const g of entry.groups) {
      if (g.slugs.length < 2) continue;
      out.push({ slug: `hyrox-${key}-${g.start.slice(0, 10)}`, name: entry.name, start: g.start, end: g.end, slugs: g.slugs });
    }
  }
  return out.sort((a, b) => Date.parse(b.start) - Date.parse(a.start));
}

/** @param {string} slug */
export function eventUrl(slug) {
  return `${EVENT_BASE_PATH}/${slug}`;
}

// ---------------------------------------------------------------------------
// Partner credit

const NOT_A_NAME = new Set(['I', 'Hyrox', 'HYROX', 'The', 'My', 'We', 'What', 'But', 'And', 'So', 'First', 'Two', 'Run', 'Roxzone', 'Sportograf', 'Sled', 'Wall', 'OH', 'GOD', 'IT']);

/**
 * A doubles partner named in his own words or the title, or "" — only for doubles
 * divisions, only when exactly one name falls out of the usual phrasings ("Stephen's
 * first Hyrox", "with Dean", "thank you Dean for", "partner Sam").
 * @param {string} words  his description
 * @param {string} title
 * @param {any} race
 */
export function partnerName(words, title, race) {
  if (!/doubles/.test(String(race?.division?.key ?? ''))) return '';
  const exclude = new Set([...NOT_A_NAME, ...String(race?.event ?? '').split(/\s+/)]);
  const patterns = [
    /\b([A-Z][a-z]{2,})'s first\b/g,
    /\bwith (?:my (?:partner|mate|friend) )?([A-Z][a-z]{2,})\b/g,
    /\bthank(?:s| you),? ([A-Z][a-z]{2,})\b/g,
    /\bpartner,? ([A-Z][a-z]{2,})\b/g,
  ];
  const names = new Set();
  for (const text of [String(title ?? ''), String(words ?? '')]) {
    for (const re of patterns) {
      for (const m of text.matchAll(re)) if (!exclude.has(m[1])) names.add(m[1]);
    }
  }
  return names.size === 1 ? [...names][0] : '';
}

// ---------------------------------------------------------------------------
// The race card

/**
 * View model for the race breakdown on an activity page.
 * @param {any} file
 * @param {HyroxHistory|null|undefined} history
 * @param {{ words?: string }} [opts]
 */
export function buildRaceView(file, history, opts = {}) {
  const race = raceOf(file);
  if (!race) return null;
  const slug = slugOf(file);
  const standing = history?.bySlug.get(slug);
  const before = standing?.before ?? {};
  const counts = !!standing && !standing.isSimulation && !!race.division?.key;
  const maxDur = race.segments.reduce((m, s) => Math.max(m, num(s.durationSeconds)), 0) || 1;
  const hrMax = race.segments.reduce((m, s) => Math.max(m, num(s.maxHr)), 0);
  const hasDeltas = Object.keys(before).length > 0;
  const sourcesDiffer = new Set();

  const rows = race.segments.map((s) => {
    const pb = before[s.key];
    const d = pb ? num(s.durationSeconds) - pb.seconds : 0;
    const isPB = counts && !!pb && !!standing?.pbs.has(s.key);
    if (pb && pb.splitSource && pb.splitSource !== race.splitSource) sourcesDiffer.add(pb.title);
    return {
      key: s.key,
      icon: s.isRun ? '🏃' : STATION_ICONS[s.key] || '🏋️',
      label: s.label,
      isRun: !!s.isRun,
      duration: clock(s.durationSeconds) || '—',
      pct: Math.max(2, Math.round((num(s.durationSeconds) / maxDur) * 1000) / 10),
      avgHr: num(s.avgHr) > 0 ? Math.round(s.avgHr) : 0,
      maxHr: num(s.maxHr) > 0 ? Math.round(s.maxHr) : 0,
      hrPct: hrMax > 0 && num(s.avgHr) > 0 ? Math.round((s.avgHr / hrMax) * 100) : 0,
      delta: pb ? deltaClock(d) : '',
      deltaTone: !pb ? '' : d < 0 ? 'gain' : d > 0 ? 'loss' : 'even',
      pbTime: pb ? clock(pb.seconds) : '',
      isPB,
      tooltip: [
        `${s.label}: ${clock(s.durationSeconds)}`,
        num(s.avgHr) > 0 ? `avg ${Math.round(s.avgHr)} bpm, max ${Math.round(s.maxHr)} bpm` : '',
        pb ? `PB before this race ${clock(pb.seconds)} (${pb.title}) · ${deltaClock(d)}` : '',
      ].filter(Boolean).join(' · '),
    };
  });

  const totalPb = before.total_time;
  const totalDelta = totalPb ? num(race.totalSeconds) - totalPb.seconds : 0;
  const isTotalPB = counts && !!standing?.pbs.has('total_time') && !standing?.isFirst;
  const gains = rows.filter((r) => r.deltaTone === 'gain').length;
  const losses = rows.filter((r) => r.deltaTone === 'loss').length;
  const biggestGain = rows.filter((r) => r.deltaTone === 'gain').sort((a, b) => parseDelta(a.delta) - parseDelta(b.delta))[0];
  const biggestLoss = rows.filter((r) => r.deltaTone === 'loss').sort((a, b) => parseDelta(b.delta) - parseDelta(a.delta))[0];

  const ranks = [];
  if (num(race.overallRank) > 0) ranks.push({ value: `#${race.overallRank}`, label: 'overall' });
  if (num(race.ageGroupRank) > 0) ranks.push({ value: `#${race.ageGroupRank}`, label: 'age group' });

  const notes = [];
  if (race.startsEstimated && race.hasHeartRate) {
    notes.push(race.splitSource === 'official'
      ? 'Durations are the official mat-to-mat splits. Start times are reconstructed (splits laid back to back, the Roxzone total spread evenly across the 15 transitions), so heart rate on a short station can include a few seconds of the transition either side.'
      : 'Durations are watch laps. Start times are laid back to back from the start, so heart rate per segment is approximate.');
  } else if (race.splitSource === 'official') {
    notes.push('Durations are the official mat-to-mat splits; Roxzone (transitions) is reported as one total.');
  }
  if (sourcesDiffer.size) {
    notes.push(`PB splits from ${[...sourcesDiffer].join(', ')} are watch laps that include transition time; today's are mat-to-mat, so station deltas flatter today a little.`);
  }
  if (standing?.isSimulation) notes.push('A simulation: shown against the PBs of the time, but it never counts as one.');

  return {
    divisionLabel: race.division?.label || '',
    isSimulation: !!race.isSimulation,
    event: race.event || '',
    total: clock(race.totalSeconds),
    totalDelta: totalPb ? deltaClock(totalDelta) : '',
    totalTone: !totalPb ? '' : totalDelta < 0 ? 'gain' : totalDelta > 0 ? 'loss' : 'even',
    totalPbTime: totalPb ? clock(totalPb.seconds) : '',
    totalPbTitle: totalPb ? totalPb.title : '',
    totalPbUrl: totalPb ? `/life/activity/${totalPb.slug}` : '',
    isTotalPB,
    isFirst: counts && !!standing?.isFirst,
    // A first race in a division is that division's PB on the day (F5.5).
    firstLabel: counts && standing?.isFirst ? `PB — first ${race.division?.label || 'race'}` : '',
    runs: clock(race.runSeconds),
    stations: clock(race.stationSeconds),
    roxzone: clock(race.roxzoneSeconds),
    ranks,
    rows,
    hasHr: !!race.hasHeartRate,
    hasDeltas,
    gainsLosses: hasDeltas ? `${gains} faster · ${losses} slower than PB` : '',
    biggestGain: biggestGain ? `${biggestGain.label} ${biggestGain.delta}` : '',
    biggestLoss: biggestLoss ? `${biggestLoss.label} ${biggestLoss.delta}` : '',
    partner: partnerName(opts.words || '', titleOf(file), race),
    notes,
    // PBs that beat an earlier time (a category with no earlier time is a first, not a PB).
    prCount: counts ? [...standing.pbs].filter((c) => before[c]).length : 0,
  };
}

/** "+5:55" → 355, "−0:12" → −12. */
function parseDelta(s) {
  const m = String(s).match(/^([+−±])(\d+(?::\d+){1,2})$/);
  if (!m) return 0;
  const secs = m[2].split(':').reduce((t, p) => t * 60 + Number(p), 0);
  return m[1] === '−' ? -secs : secs;
}

// ---------------------------------------------------------------------------
// PB chase (F5.5): a race against the PB it was chasing, point in time

/** Minute steps the axis may tick at. */
const TICK_STEPS = [60, 120, 300, 600, 900, 1800];

/**
 * The PB chase for one division: each focus race against the PB that stood before it
 * (red when slower, green when it set a PB), with the division's earlier races as
 * context, on one time axis that runs faster ← → slower. History stops at the last
 * focus race, so a page never shows races that came after it. Simulations are not
 * races and are left out.
 *
 * Positions are percentages of the track (the partial lays it out in HTML, so text
 * stays readable at phone width).
 *
 * @param {HyroxHistory|null|undefined} history
 * @param {string} divisionKey
 * @param {string[]} focusSlugs  this race (activity page) or the event's races in this division
 */
export function pbChase(history, divisionKey, focusSlugs) {
  const d = history?.byDivision.get(divisionKey);
  if (!d) return null;
  const focus = new Set(focusSlugs);
  const lastIdx = d.races.reduce((m, r, i) => (focus.has(r.slug) ? i : m), -1);
  if (lastIdx < 0) return null;
  const races = d.races.slice(0, lastIdx + 1).filter((r) => r.total > 0);
  const chased = races
    .filter((r) => focus.has(r.slug))
    .map((r) => ({ race: r, pb: history?.bySlug.get(r.slug)?.before.total_time }));
  const times = [...races.map((r) => r.total), ...chased.map((c) => c.pb?.seconds ?? 0)].filter((t) => t > 0);
  const lo = Math.min(...times), hi = Math.max(...times);
  const span = Math.max(hi - lo, 240);
  const pad = span * 0.14;
  const x0 = lo - pad, x1 = hi + pad;
  const pct = (/** @type {number} */ t) => Math.round(((t - x0) / (x1 - x0)) * 1000) / 10;
  const step = TICK_STEPS.find((st) => (x1 - x0) / st <= 6) ?? 3600;
  const ticks = [];
  for (let t = Math.ceil(x0 / step) * step; t <= x1; t += step) ticks.push({ left: pct(t), label: tickLabel(t) });
  const label = d.label;

  const context = races
    .filter((r) => !focus.has(r.slug))
    .map((r, i) => ({
      left: pct(r.total), url: `/life/activity/${r.slug}`, time: clock(r.total), isPB: r.isPB,
      // Labels above the dot (clear of the PB-to-beat marker below), alternating when crowded.
      name: shortEvent(r.event || r.title), date: shortDate(r.date), above: i % 2 === 0,
      align: pct(r.total) > 70 ? 'end' : pct(r.total) < 30 ? 'start' : 'mid',
      title: `${r.title} · ${clock(r.total)}${r.isPB ? ' · PB' : ''} · ${shortDate(r.date)}`,
    }));

  const rows = chased.map(({ race, pb }) => {
    const isPB = race.isPB;
    const delta = pb ? race.total - pb.seconds : 0;
    const tone = !pb || isPB ? 'gain' : delta > 0 ? 'loss' : 'even';
    const a = pb ? Math.min(pct(pb.seconds), pct(race.total)) : 0;
    const b = pb ? Math.max(pct(pb.seconds), pct(race.total)) : 0;
    let verdict;
    if (!pb) verdict = `PB — first ${label}`;
    else if (isPB) verdict = `New ${label} PB — ${deltaClock(delta).replace('−', '')} faster than ${clock(pb.seconds)}`;
    else if (delta === 0) verdict = `Equalled the ${label} PB, ${clock(pb.seconds)}`;
    else verdict = `${deltaClock(delta)} slower than the ${label} PB it was chasing`;
    return {
      url: `/life/activity/${race.slug}`, name: shortEvent(race.event || race.title), date: shortDate(race.date),
      time: clock(race.total), left: pct(race.total), tone, isPB, isFirst: !pb, verdict,
      delta: pb ? deltaClock(delta) : '',
      pbLeft: pb ? pct(pb.seconds) : 0, pbTime: pb ? clock(pb.seconds) : '',
      pbName: pb ? shortEvent(pb.title) : '', pbDate: pb ? shortDate(pb.date) : '', pbUrl: pb ? `/life/activity/${pb.slug}` : '',
      gapLeft: a, gapWidth: Math.max(0.6, Math.round((b - a) * 10) / 10),
      // Labels hang inward so they stay inside the track at either end.
      timeAlign: pct(race.total) > 60 ? 'end' : 'start',
      pbAlign: pb && pct(pb.seconds) > 60 ? 'end' : 'start',
    };
  });

  return {
    key: d.key, label, rows, context, ticks,
    count: races.length,
    // A division's only race has nothing to sit against: the verdict says it all.
    plot: races.length > 1,
    raceWord: races.length === 1 ? 'race' : 'races',
    multiple: rows.length > 1,
  };
}

/** Axis label: 5040 → "1h24", 3300 → "55 min". @param {number} t */
function tickLabel(t) {
  const m = Math.round(t / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : `${m} min`;
}

/** "Hyrox - London Olympia 25/26 - 1:23:47 🎉" / "London Olympia" → a short event name. */
export function shortEvent(s) {
  const t = String(s ?? '').replace(/^hyrox\s*[-–:]?\s*/i, '').replace(/\s*[-–]\s*\d{1,2}:\d{2}(:\d{2})?.*$/, '').replace(/\s+\d{2}\/\d{2}\b.*$/, '').trim();
  return t || String(s ?? '');
}

/** @param {string} iso */
function shortDate(iso) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const d = new Date(t);
  return `${d.getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`;
}

// ---------------------------------------------------------------------------
// The /life PB wall (F5.5): Hyrox PBs per division

/** Stations in race order, as the wall names them. */
export const WALL_STATIONS = /** @type {[string, string][]} */ ([
  ['skierg', 'SkiErg'], ['sled_push', 'Sled Push'], ['sled_pull', 'Sled Pull'], ['burpee_broad_jump', 'Burpee Broad Jumps'],
  ['rowing', 'Row'], ['farmers_carry', 'Farmers Carry'], ['sandbag_lunges', 'Sandbag Lunges'], ['wall_balls', 'Wall Balls'],
  ['roxzone', 'Roxzone'],
]);

/**
 * The Hyrox sections of the /life personal-bests wall: one per division raced, in the
 * order he first raced them. Each has the total first, then every station and Roxzone
 * in race order, then the eight runs; every PB links to the race that set it.
 *
 * Built from the same history as the race pages (the export's `race` key on every
 * loaded activity: official splits, simulations excluded), so the wall and the race
 * pages always agree. FitGlue's per-division `hybrid_race_hyrox_<division>_*` records
 * hold the same bests but do not reach the export (profile.topPrs is the 3 latest time
 * PRs and the 5 heaviest lifts).
 * @param {HyroxHistory|null|undefined} history
 */
export function hyroxWall(history) {
  if (!history) return [];
  return history.divisions
    .filter((d) => d.best.total_time || Object.keys(d.best).length)
    .map((d) => {
      /** @param {string} key @param {string} name */
      const pb = (key, name) => {
        const b = d.best[key];
        if (!b) return null;
        const info = history.races.get(b.slug);
        const where = String(info?.file?.race?.event || '') || shortEvent(b.title);
        return {
          name, display: clock(b.seconds), url: `/life/activity/${b.slug}`, where, date: shortDate(b.date),
          title: `${d.label} ${name} PB: ${clock(b.seconds)} · ${b.title} · ${shortDate(b.date)}`,
        };
      };
      const stations = WALL_STATIONS.map(([k, n]) => pb(k, n)).filter(Boolean);
      const runs = Array.from({ length: 8 }, (_, i) => pb(`run_${i + 1}`, `Run ${i + 1}`)).filter(Boolean);
      return {
        key: d.key, label: d.label, races: d.races.length, raceWord: d.races.length === 1 ? 'race' : 'races',
        total: pb('total_time', 'Total time'), stations, runs,
      };
    });
}
