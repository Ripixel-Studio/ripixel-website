// @ts-check
/**
 * Roundup highlights: what made a week, a month, a year worth remembering — data only.
 *
 * One pass over every activity on the record (oldest first) finds the *moments*:
 *
 *   weekend   two or more Hyrox races at one venue (fitness-hyrox groupEvents) → /life/event/<slug>
 *   race      a Fitness Events calendar entry (events.json `past`, written by Jarvis'
 *             fitness_calendar_export.py) matched to the activity that day; the name comes
 *             from the calendar ("Yorkshire Marathon"), the numbers from the activity
 *             ("Morning Run", 42.5 km). A Hyrox race with no calendar entry is a race too.
 *   event     a calendar one-off that is not a race (a long trail day, a fitness test)
 *   parkrun   position, time, PB, first visit, from the parkrun enrichment or the
 *             "Parkrun Results" lines FitGlue writes into the description
 *   pb        a personal record that beat an earlier one (FitGlue personalRecords)
 *   longest   the longest run yet (10 km and up)
 *   heaviest  the most weight moved in one session yet
 *   first     the first session of a kind never done before
 *   milestone lifetime running distance past each 500 km, every 100th session
 *   streak    10, 26, 52, 78, 104 weeks in a row with at least one session
 *
 * Firsts and bests only count once there are FIRSTS_AFTER_DAYS of history, so the first
 * weeks of the export are not wall-to-wall "firsts". Several moments on one activity fold
 * into the strongest; the others become its `tags`. A roundup takes the moments inside its
 * period (momentsIn) and ranks them (pickHighlights).
 */
import { buildHyroxHistory, clock, eventUrl } from './fitness-hyrox.mjs';
import { recordLabel } from './fitness-records.mjs';
import { activityTheme, typeKeyOf } from './fitness-theme.mjs';
import { ymd } from './life-clock.mjs';

export const FIRSTS_AFTER_DAYS = 60;
export const HIGHLIGHT_CAP = { week: 5, month: 8, year: 14 };
const DAY = 864e5;
const STREAK_MILESTONES = [10, 26, 52, 78, 104, 156];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * @typedef {object} Moment
 * @property {string} id
 * @property {string} kind      weekend | race | event | parkrun | pb | longest | heaviest | first | milestone | streak
 * @property {string} stamp     the label on the ticket: MARATHON, PARKRUN, PB, FIRST, ...
 * @property {string} title
 * @property {string} value     the headline number ("4:20:00", "28:11", "1,000")
 * @property {string} unit
 * @property {string} sub       one line of context
 * @property {number} t         ms since the epoch
 * @property {string} date      "Sat 24 Oct"
 * @property {string|null} href
 * @property {string} photo
 * @property {string} typeKey
 * @property {string} typeClass
 * @property {number} score
 * @property {string} slug      the activity it hangs on ('' for none)
 * @property {string[]} slugs   every activity it covers
 * @property {string[]} tags    other stamps folded into it
 * @property {string} [tag]   how it reads when folded into another moment
 * @property {boolean} [lead]
 */

const num = (/** @type {unknown} */ v) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);
const https = (/** @type {unknown} */ u) => (typeof u === 'string' && /^https:\/\//i.test(u) ? u : '');

/** "Sat 24 Oct" in the site timezone. @param {number} t */
function dayLabel(t) {
  const [y, m, d] = ymd(new Date(t)).split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${DOW[dow]} ${d} ${MONTHS[m - 1]}`;
}

/** Metres → "42.5 km" / "5.06 km". @param {number} m */
function kmText(m) {
  const k = m / 1000;
  return `${k >= 10 ? k.toFixed(1) : k.toFixed(2)} km`;
}

/** 16 → "16th". @param {number} n */
function ordinal(n) {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] || 'th';
  return `${n}${s}`;
}

/**
 * The stamp and weight for a race, from its name and (when known) the distance run.
 * @param {string} title @param {number} metres
 * @returns {{ stamp: string, score: number }}
 */
export function raceStamp(title, metres = 0) {
  const t = String(title || '').toLowerCase();
  if (/\bhyrox\b/.test(t)) return /\bsim/.test(t) ? { stamp: 'HYROX SIM', score: 55 } : { stamp: 'HYROX', score: 95 };
  if (metres > 43000 || /\bultra\b/.test(t)) return { stamp: 'ULTRA', score: 100 };
  if (/\bhalf\b/.test(t)) return { stamp: 'HALF MARATHON', score: 90 };
  if (/\bmarathon\b/.test(t) || metres >= 41500) return { stamp: 'MARATHON', score: 100 };
  if (metres >= 20500) return { stamp: 'HALF MARATHON', score: 88 };
  if (/\b10 ?k(m)?\b/.test(t) || (metres >= 9500 && metres <= 10800)) return { stamp: '10K', score: 70 };
  if (/\b5 ?k(m)?\b/.test(t)) return { stamp: '5K', score: 60 };
  return { stamp: 'RACE', score: 65 };
}

const STOP = new Set(['the', 'and', 'run', 'race', 'open', 'men', 'mens', 'with', 'for']);
/** @param {string} s */
function words(s) {
  return new Set(String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w)));
}

/**
 * The activity a calendar entry was, among that local day's activities: the one whose title
 * shares the most words with the calendar's, else the longest (a marathon logged as
 * "Morning Run"). Null when nothing happened that day.
 * @param {{ title: string, start: string }} cal @param {any[]} dayEntries
 */
export function matchCalendar(cal, dayEntries) {
  if (!dayEntries.length) return null;
  const want = words(cal.title);
  let best = null;
  let bestKey = [-1, -1];
  for (const e of dayEntries) {
    const have = words(e.title);
    let shared = 0;
    for (const w of want) if (have.has(w)) shared++;
    const key = [shared, num(e.distanceMeters) * 10 + num(e.durationSeconds)];
    if (key[0] > bestKey[0] || (key[0] === bestKey[0] && key[1] > bestKey[1])) {
      best = e;
      bestKey = key;
    }
  }
  return best;
}

/**
 * A parkrun's result, from the parkrun enrichment or FitGlue's "Parkrun Results" lines.
 * @param {any} file @returns {{ position: number, time: string, isPb: boolean, firstHere: boolean, number: number } | null}
 */
export function parkrunInfo(file) {
  const title = String(file?.entry?.title ?? file?.activity?.title ?? '');
  if (!/park ?run/i.test(title)) return null;
  const pk = file?.activity?.enrichments?.parkrun || null;
  const desc = String(file?.activity?.description ?? '');
  const block = /Parkrun Results:\n([\s\S]*?)(?:\n\n|$)/i.exec(desc)?.[1] ?? '';
  const pos = num(pk?.position) || num(/Position:\s*(\d+)/i.exec(block)?.[1]);
  const time = String(pk?.finishTime || /Time:\s*([\d:]+)/i.exec(block)?.[1] || '');
  const isPb = Boolean(pk?.isTimePb) || /Time:[^\n]*all-time PB/i.test(block);
  const firstHere = /First time at this location/i.test(block) || /\b1st Parkrun here\b/i.test(block);
  const number = num(/\(#\s*(\d+)\)/.exec(title)?.[1]) || num(pk?.totalParkruns) || num(/\((\d+) total\)/.exec(block)?.[1]);
  return { position: pos, time, isPb, firstHere, number };
}

/** Distance records worth a headline, by how far: a 5K PB beats a 400 m one. */
const PB_DISTANCE_SCORE = /** @type {Record<string, number>} */ ({
  '5K': 60, '5 MILES': 62, '10K': 66, '10 MILES': 68, '20K': 68, 'HALF MARATHON': 75, '30K': 72, 'MARATHON': 85, '50K': 85,
});

/** @param {any} r a personalRecords record @returns {{ name: string, value: string, delta: string, score: number }} */
function pbOf(r) {
  const label = recordLabel(r.recordType);
  const v = num(r.newValue ?? r.value);
  const prev = num(r.previousValue);
  if (r.unit === 'seconds') {
    const diff = Math.round(prev - v);
    const score = label.group === 'run' ? PB_DISTANCE_SCORE[label.name] ?? 30 : label.group === 'ride' ? 40 : 30;
    const name = label.metricKey === 'fastest' ? `${label.name} PB` : `${label.name}`;
    return { name, value: clock(v), delta: diff > 0 ? `−${diff >= 60 ? clock(diff) : `${diff}s`}` : '', score };
  }
  if (r.unit === 'kg') {
    const diff = Math.round((v - prev) * 10) / 10;
    const strong = label.metricKey === '1rm' || label.metricKey === 'heaviest';
    return { name: `${label.name} ${strong ? (label.metricKey === '1rm' ? '1RM' : 'heaviest') : label.metric.toLowerCase()}`, value: `${Math.round(v * 10) / 10} kg`, delta: diff > 0 ? `+${diff} kg` : '', score: strong ? 38 : 26 };
  }
  if (r.unit === 'meters') return { name: label.name, value: kmText(v), delta: '', score: 45 };
  return { name: label.name, value: `${Math.round(v)}${r.unit ? ` ${r.unit}` : ''}`, delta: '', score: 22 };
}

/** `ACTIVITY_TYPE_TABLE_TENNIS` → `table tennis`. @param {unknown} t */
const typeWord = (t) => {
  const bare = String(t || '').replace(/^ACTIVITY_TYPE_/, '');
  return bare === 'HIGH_INTENSITY_INTERVAL_TRAINING' ? 'HIIT' : bare.toLowerCase().replace(/_/g, ' ');
};

/** @param {number} n */
const thousands = (n) => n.toLocaleString('en-GB');

/**
 * Every moment on the record, oldest first.
 * @param {{ files: any[], entries: any[], past?: any[] }} data
 *   files: the activity files (fitnessActivities); entries: index.activities; past: events.json `past`
 * @returns {Moment[]}
 */
export function buildMoments({ files, entries, past = [] }) {
  const fileBySlug = new Map((Array.isArray(files) ? files : []).filter((f) => f?.slug).map((f) => [f.slug, f]));
  const list = (Array.isArray(entries) ? entries : [])
    .filter((e) => e && typeof e.slug === 'string' && Number.isFinite(Date.parse(e.startTime || '')))
    .map((e) => ({ e, t: Date.parse(e.startTime) }))
    .sort((a, b) => a.t - b.t);
  if (!list.length) return [];
  const t0 = list[0].t;
  const settled = (/** @type {number} */ t) => t - t0 >= FIRSTS_AFTER_DAYS * DAY;
  const hyrox = buildHyroxHistory([...fileBySlug.values()]);

  /** @type {Moment[]} */
  const out = [];
  /** @param {any} e @param {Partial<Moment> & { kind: string, stamp: string, title: string, score: number }} m */
  const fromEntry = (e, m) => {
    const t = Date.parse(e.startTime);
    const theme = activityTheme(e.activityType);
    /** @type {Moment} */
    const moment = {
      id: `${m.kind}:${e.slug}`, value: '', unit: '', sub: '', t, date: dayLabel(t),
      href: `/life/activity/${e.slug}`, photo: https(e.photoUrls?.[0]), typeKey: theme.typeKey, typeClass: theme.typeClass,
      slug: e.slug, slugs: [e.slug], tags: [], ...m,
    };
    out.push(moment);
    return moment;
  };

  // --- Hyrox race weekends (one moment per weekend, races folded in)
  /** @type {Set<string>} */
  const raceSlugs = new Set();
  const entryBySlug = new Map(list.map(({ e }) => [e.slug, e]));
  for (const ev of hyrox.events) {
    const races = ev.slugs.map((s) => hyrox.races.get(s)).filter(Boolean);
    const t = Date.parse(ev.start);
    const photo = races.map((r) => https(entryBySlug.get(r?.slug)?.photoUrls?.[0])).find(Boolean) || '';
    const pbs = races.filter((r) => r?.isPB).length;
    const short = (/** @type {string} */ label) => label.replace(/^(Open|Pro)\s+(Men's|Women's)?\s*/i, '').replace(/^Mixed /, 'Mixed ') || label;
    out.push({
      id: `weekend:${ev.slug}`, kind: 'weekend', stamp: 'RACE WEEKEND', title: `Hyrox ${ev.name}`,
      value: String(races.length), unit: races.length === 1 ? 'race' : 'races',
      sub: races.map((r) => `${short(r?.divisionLabel || 'Race')} ${r?.total}${r?.isPB ? ' (PB)' : ''}`).join(' · '),
      t, date: dayLabel(t), href: eventUrl(ev.slug), photo, ...activityTheme('ACTIVITY_TYPE_CROSSFIT'),
      score: 120 + pbs * 5, slug: '', slugs: [...ev.slugs], tags: [],
    });
    for (const s of ev.slugs) raceSlugs.add(s);
  }

  // --- calendar entries that already happened, matched to the day's activity
  const byDay = new Map();
  for (const { e } of list) {
    const k = ymd(new Date(e.startTime));
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(e);
  }
  for (const cal of Array.isArray(past) ? past : []) {
    if (!cal || typeof cal.title !== 'string' || !Number.isFinite(Date.parse(cal.start || ''))) continue;
    const e = matchCalendar(cal, byDay.get(ymd(new Date(cal.start))) || []);
    if (e && raceSlugs.has(e.slug)) continue; // the weekend already says it
    const isRace = cal.kind === 'race';
    if (!e) {
      const t = Date.parse(cal.start);
      out.push({
        id: `cal:${cal.start}:${cal.title}`, kind: 'event', stamp: 'ON THE CALENDAR', title: cal.title, value: '', unit: '', sub: '',
        t, date: dayLabel(t), href: null, photo: '', typeKey: 'other', typeClass: 'fit-type--other', score: isRace ? 30 : 20, slug: '', slugs: [], tags: [],
      });
      continue;
    }
    const metres = num(e.distanceMeters);
    const hx = hyrox.races.get(e.slug);
    const rs = raceStamp(cal.title, metres);
    const stamp = isRace ? rs.stamp : metres > 43000 ? 'ULTRA' : metres >= 20000 ? 'BIG DAY OUT' : 'EVENT';
    const score = isRace ? rs.score : metres > 43000 ? 100 : metres >= 20000 ? 72 : 50;
    const value = hx?.total || clock(num(e.durationSeconds));
    const subBits = [];
    if (hx?.divisionLabel) subBits.push(hx.divisionLabel);
    if (metres > 500) subBits.push(kmText(metres));
    if (hx?.isPB) subBits.push('PB');
    fromEntry(e, { kind: isRace ? 'race' : 'event', stamp, title: cal.title.trim(), value, sub: subBits.join(' · '), score: score + (hx?.isPB ? 10 : 0) });
    if (hx) raceSlugs.add(e.slug);
  }
  // Hyrox races the calendar never named
  for (const r of hyrox.races.values()) {
    if (raceSlugs.has(r.slug) || r.isSimulation) continue;
    const e = entryBySlug.get(r.slug);
    if (!e) continue;
    fromEntry(e, { kind: 'race', stamp: 'HYROX', title: e.title || 'Hyrox', value: r.total, sub: [r.divisionLabel, r.isPB ? 'PB' : ''].filter(Boolean).join(' · '), score: 95 + (r.isPB ? 10 : 0) });
    raceSlugs.add(r.slug);
  }

  // --- the single pass: parkruns, PBs, bests, firsts, milestones, streaks
  let longestRun = 0;
  let heaviest = 0;
  let runMetres = 0;
  let sessions = 0;
  /** @type {Set<string>} */
  const familiesSeen = new Set();
  /** @type {Set<string>} */
  const weeks = new Set();
  let streak = 0;
  let lastWeek = -1;
  for (const { e, t } of list) {
    const file = fileBySlug.get(e.slug);
    const family = typeKeyOf(e.activityType);
    const metres = num(e.distanceMeters);
    const ok = settled(t);
    sessions++;

    const pk = file ? parkrunInfo(file) : null;
    if (pk) {
      const bits = [];
      if (pk.position) bits.push(`${ordinal(pk.position)} place`);
      if (pk.isPb) bits.push('parkrun PB');
      if (pk.firstHere) bits.push('first time here');
      const milestone = [10, 25, 50, 100, 250].includes(pk.number);
      if (milestone) bits.push(`parkrun no. ${pk.number}`);
      fromEntry(e, {
        kind: 'parkrun', stamp: 'PARKRUN', title: e.title || 'parkrun', value: pk.time || clock(num(e.durationSeconds)), sub: bits.join(' · '),
        score: 40 + (pk.isPb ? 35 : 0) + (pk.firstHere ? 15 : 0) + (milestone ? 30 : 0) + (pk.position && pk.position <= 20 ? 10 : 0),
      });
    }

    const recs = file?.activity?.enrichments?.personalRecords?.records;
    if (Array.isArray(recs) && !raceSlugs.has(e.slug)) {
      const beaten = recs.filter((r) => r && r.previousValue != null && !String(r.recordType || '').startsWith('hybrid_race_') && !/^longest_/.test(String(r.recordType || '')));
      const pbs = beaten.map(pbOf).sort((a, b) => b.score - a.score);
      if (pbs.length) {
        const top = pbs[0];
        const more = pbs.length - 1;
        fromEntry(e, {
          kind: 'pb', stamp: 'PB', title: top.name, value: top.value,
          sub: [top.delta, e.title, more > 0 ? `+${more} more` : ''].filter(Boolean).join(' · '),
          score: top.score + Math.min(more, 5) * 2,
        });
      }
    }

    if (family === 'run' && metres > longestRun) {
      if (ok && metres >= 10000) {
        fromEntry(e, { kind: 'longest', stamp: 'LONGEST RUN', title: 'Longest run yet', tag: 'LONGEST RUN YET', value: kmText(metres).replace(' km', ''), unit: 'km', sub: [e.title, longestRun ? `beat ${kmText(longestRun)}` : ''].filter(Boolean).join(' · '), score: Math.min(95, 50 + Math.round(metres / 1000)) });
      }
      longestRun = metres;
    }
    const kg = num(e.totalWeightKg);
    if (kg > heaviest) {
      if (ok && heaviest > 0 && kg >= 3000) {
        const v = kg >= 1000 ? `${(kg / 1000).toFixed(1)}` : String(Math.round(kg));
        fromEntry(e, { kind: 'heaviest', stamp: 'HEAVIEST', title: 'Most weight moved in a session', value: v, unit: kg >= 1000 ? 't' : 'kg', sub: e.title || '', score: 42 });
      }
      heaviest = kg;
    }
    if (!familiesSeen.has(family)) {
      if (ok && family !== 'other') {
        fromEntry(e, { kind: 'first', stamp: 'FIRST', title: `First ${typeWord(e.activityType)} on the record`, value: '', sub: e.title || '', score: 45 });
      }
      familiesSeen.add(family);
    }

    if (family === 'run') {
      const before = runMetres;
      runMetres += metres;
      const mark = Math.floor(runMetres / 500000);
      if (mark > Math.floor(before / 500000)) {
        fromEntry(e, { kind: 'milestone', stamp: 'MILESTONE', title: `${thousands(mark * 500)} km run, all time`, tag: `${thousands(mark * 500)} KM LIFETIME`, value: thousands(mark * 500), unit: 'km', sub: e.title || '', score: mark * 500 % 1000 === 0 ? 75 : 62 });
      }
    }
    if (sessions % 100 === 0) {
      fromEntry(e, { kind: 'milestone', stamp: 'MILESTONE', title: `Session no. ${sessions}`, tag: `SESSION NO. ${sessions}`, value: thousands(sessions), unit: '', sub: e.title || '', score: sessions % 500 === 0 ? 60 : 40 });
    }

    // Weekly streak: ISO weeks (Monday-based, UTC as the roundups are).
    const d = new Date(t);
    const wk = Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - ((d.getUTCDay() + 6) % 7) * DAY) / (7 * DAY));
    if (!weeks.has(String(wk))) {
      weeks.add(String(wk));
      streak = wk === lastWeek + 1 ? streak + 1 : 1;
      lastWeek = wk;
      if (STREAK_MILESTONES.includes(streak)) {
        fromEntry(e, { kind: 'streak', stamp: 'STREAK', title: `${streak} weeks in a row`, value: String(streak), unit: 'weeks', sub: 'at least one session every week', score: streak >= 52 ? 70 : 48 });
      }
    }
  }

  return foldBySlug(out).sort((a, b) => a.t - b.t);
}

const HEAD_ORDER = ['weekend', 'race', 'event', 'parkrun'];

/**
 * Several moments on one activity become one: the strongest keeps its card, the others
 * become its tags (each adds a little weight). A race weekend owns its races' moments.
 * @param {Moment[]} moments
 */
function foldBySlug(moments) {
  /** @type {Map<string, Moment[]>} */
  const groups = new Map();
  /** @type {Map<string, string>} */
  const owner = new Map();
  for (const m of moments) if (m.kind === 'weekend') for (const s of m.slugs) owner.set(s, m.id);
  /** @type {Moment[]} */
  const loose = [];
  for (const m of moments) {
    const key = m.kind === 'weekend' ? m.id : owner.get(m.slug) || m.slug;
    if (!key) {
      loose.push(m);
      continue;
    }
    if (!groups.has(key)) groups.set(key, []);
    /** @type {Moment[]} */ (groups.get(key)).push(m);
  }
  const out = [...loose];
  for (const group of groups.values()) {
    // A named thing (the weekend, a race, a calendar event, a parkrun) carries the card;
    // a PB or a "longest" on it becomes a tag.
    const rank = (/** @type {Moment} */ m) => HEAD_ORDER.indexOf(m.kind) === -1 ? HEAD_ORDER.length : HEAD_ORDER.indexOf(m.kind);
    group.sort((a, b) => rank(a) - rank(b) || b.score - a.score);
    const [head, ...rest] = group;
    for (const r of rest) {
      const tag = r.tag || (r.kind === 'pb' ? r.title.toUpperCase() : r.stamp);
      if (!head.tags.includes(tag) && tag !== head.stamp) head.tags.push(tag);
    }
    head.score = Math.max(head.score, ...rest.map((r) => r.score)) + rest.length * 4;
    if (!head.photo) head.photo = rest.map((r) => r.photo).find(Boolean) || '';
    out.push(head);
  }
  return out;
}

/** The moments inside [start, end). @param {Moment[]} moments @param {number} start @param {number} end */
export function momentsIn(moments, start, end) {
  return moments.filter((m) => m.t >= start && m.t < end);
}

/**
 * The period's highlights: strongest first (ties: earlier first), capped by period type;
 * the first is the lead.
 * @param {Moment[]} moments @param {'week'|'month'|'year'} type
 */
export function pickHighlights(moments, type) {
  const cap = HIGHLIGHT_CAP[type] ?? 5;
  // The same record set again and again (a 5K PB most Saturdays) shows once: the latest.
  const recordOf = (/** @type {Moment} */ m) => (m.kind === 'pb' ? m.title : m.tags.find((t) => / PB$/.test(t)) || '');
  /** @type {Map<string, Moment>} */
  const latest = new Map();
  for (const m of moments) {
    const r = recordOf(m);
    if (!r) continue;
    const cur = latest.get(r);
    if (!cur || m.t > cur.t || (m.kind !== 'pb' && cur.kind === 'pb' && m.t === cur.t)) latest.set(r, m);
  }
  const perKind = KIND_CAP[type] || {};
  /** @type {Record<string, number>} */
  const taken = {};
  const out = [];
  for (const m of [...moments].sort((a, b) => b.score - a.score || a.t - b.t)) {
    const r = recordOf(m);
    if (r && latest.get(r) !== m && !['weekend', 'race', 'event'].includes(m.kind)) continue;
    const limit = perKind[m.kind];
    if (limit != null && (taken[m.kind] || 0) >= limit) continue;
    taken[m.kind] = (taken[m.kind] || 0) + 1;
    out.push(m);
    if (out.length >= cap) break;
  }
  return out.map((m, i) => ({ ...m, lead: i === 0 }));
}

/** At most this many of one kind, so a long period is not all Saturdays. */
const KIND_CAP = /** @type {Record<string, Record<string, number>>} */ ({
  week: {},
  month: { parkrun: 2, pb: 3 },
  year: { parkrun: 3, pb: 3, streak: 1, milestone: 2 },
});

/**
 * The longest run of consecutive active days.
 * @param {string[]} days  YYYY-MM-DD, any order, repeats allowed
 */
export function dayStreak(days) {
  const sorted = [...new Set(days)].sort();
  let best = { days: 0, from: '', to: '' };
  let run = 0;
  let from = '';
  let prev = NaN;
  for (const d of sorted) {
    const t = Date.parse(`${d}T00:00:00Z`);
    if (t - prev === DAY) run++;
    else {
      run = 1;
      from = d;
    }
    prev = t;
    if (run > best.days) best = { days: run, from, to: d };
  }
  return best;
}
