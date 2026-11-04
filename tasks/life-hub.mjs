// @ts-check
/**
 * The /life hub, its eight section pages and the personal bits (LH3.4, R2c.2): data only.
 * Pure functions shape `lifeIndex` (the public life export) and `fitnessLife`
 * into view models; the templates only loop and test. No HTML strings here.
 * The only computed strings are chart models from `chart-axes.mjs` (SVG path
 * data and tick labels).
 *
 * Globals set by `lifeHubTask()`:
 *   lifeHub       { cards[{name, href, title, headline, latest, note, staleLabel, empty}], live[],
 *                   hero[{name, title, size, side, href, headline, staleLabel, caption, hero}] (C8; [] → the old rows) }
 *   lifeSections  { [name]: view }
 *   lifePersonal  [{ key, label, value, tone }]
 *   lifeFacts     { [key]: value }
 *   lifeInsights  [{ id, text, href }]  (C5, at most 6)
 *
 * NOTE for Task 7: the `work` section is not part of this task. Its view
 * (`workView`) must carry a salary table (role, salary, delta) shown only when
 * `work.salary` exists in the export (ruling F9).
 */

import { lineChart, stackedShare, clockBars, columnBars } from './chart-axes.mjs';
import { cleanPoints } from './route-map.mjs';
import { commitGrid, projectCards } from './code-view.mjs';

export const SECTION_ORDER = ['fitness', 'body', 'games', 'code', 'watching', 'listening', 'reading', 'live'];
/** @param {string} name */
export const SECTION_HREF = (name) => '/life/' + name;

const TITLES = {
  fitness: 'Fitness', body: 'Body', games: 'Games',
  code: 'Code', watching: 'Watching', listening: 'Listening', reading: 'Reading', live: 'Live',
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** @param {number|null|undefined} days */
export function staleLabel(days) {
  if (typeof days !== 'number' || !Number.isFinite(days) || days < 2) return '';
  return `last updated ${Math.floor(days)} days ago`;
}

/** 'Oct 2026' from YYYY-MM; '' when unusable. @param {string} month */
export function monthLabel(month) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
  if (!m || +m[2] < 1 || +m[2] > 12) return '';
  return `${MONTHS[+m[2] - 1]} ${m[1]}`;
}

/** @param {string} month YYYY-MM */
export function sawLabel(month) {
  const label = monthLabel(month);
  return label ? `saw in ${label}` : '';
}

const num = (/** @type {unknown} */ n) => (typeof n === 'number' && Number.isFinite(n) ? n : null);
const group = (/** @type {number} */ n) => Math.round(n).toLocaleString('en-GB');
const one = (/** @type {number} */ n) => (Math.round(n * 10) / 10).toFixed(1);
const hm = (/** @type {number} */ min) => `${Math.floor(min / 60)}h ${String(Math.round(min % 60)).padStart(2, '0')}m`;
const row = (/** @type {string} */ label, /** @type {string} */ value, unit = '') => ({ label, value, unit });

/** @param {any} h */
function headlineOf(h) {
  if (!h || typeof h !== 'object' || h.value == null) return null;
  const v = num(h.value);
  // A duration in minutes reads as hours and minutes ("7h 24m"), as the section's own rows do.
  if (v != null && String(h.unit || '') === 'min') return { value: hm(v), unit: '', label: String(h.label || '') };
  return { value: v == null ? String(h.value) : (Number.isInteger(v) ? group(v) : one(v)), unit: String(h.unit || ''), label: String(h.label || '') };
}

/** A section whose export gives no headline still leads with its own figure where it has one. @param {string} name @param {any} sec */
function fallbackHeadline(name, sec) {
  if (name === 'games' && num(sec.hoursTotal) != null) return { value: group(num(/** @type {number} */ (sec.hoursTotal))), unit: 'h', label: 'played, all time' };
  return null;
}

/** Newest notable by month (the first of equals). @param {any[]|undefined} list */
function latestOf(list) {
  let best = null;
  for (const n of Array.isArray(list) ? list : []) {
    if (!n || typeof n !== 'object') continue;
    if (!best || String(n.month || '') > String(best.month || '')) best = n;
  }
  return best;
}

/** @param {any} n */
function notableView(n) {
  return {
    key: String(n.key || ''), kind: String(n.kind || ''), title: String(n.title || ''),
    by: n.by || '', season: n.season ?? '', year: n.year ?? '', provider: n.provider || '',
    month: String(n.month || ''), monthLabel: monthLabel(n.month), reason: String(n.reason || ''), poster: n.poster || '',
    bigScreen: n.bigScreen === true,
  };
}

/** Notables newest month first, stable. @param {any[]} list */
function sortedNotables(list) {
  return (Array.isArray(list) ? list : [])
    .filter((n) => n && typeof n === 'object' && n.title)
    .map((n, i) => ({ n, i }))
    .sort((a, b) => String(b.n.month || '').localeCompare(String(a.n.month || '')) || a.i - b.i)
    .map((x) => notableView(x.n));
}

/** Non-empty: a non-null scalar, a non-empty string/array, or an object with a non-empty value. @param {any} v @returns {boolean} */
function filled(v) {
  if (v == null) return false;
  if (Array.isArray(v)) return v.some(filled);
  if (typeof v === 'object') return Object.values(v).some(filled);
  if (typeof v === 'string') return v.trim() !== '';
  return true;
}

/**
 * A section has data when its headline OR anything else beyond the bookkeeping
 * keys (lists, totals, single figures) is non-empty. A null headline with a
 * populated list (games: wall, recent, backlog...) is still data.
 * @param {any} sec
 */
function hasData(sec) {
  if (!sec || typeof sec !== 'object' || Array.isArray(sec)) return false;
  if (sec.headline && sec.headline.value != null) return true;
  return Object.entries(sec).some(([k, v]) => k !== 'updated' && k !== 'staleDays' && k !== 'headline' && filled(v));
}

/** One weekly column, gaps kept as null (the chart breaks its line there). @param {any[]} weekly @param {string} key */
const column = (weekly, key) => (Array.isArray(weekly) ? weekly : []).map((w) => num(w?.[key]));

/** A weekly line chart (axes from chart-axes.mjs), or null with fewer than 2 values. */
function weeklyChart(/** @type {any[]} */ weekly, /** @type {string} */ key, /** @type {string} */ label, /** @type {string} */ unit, decimals = 0, scale = 1) {
  const rows = Array.isArray(weekly) ? weekly.filter((w) => w && typeof w === 'object') : [];
  const values = column(rows, key).map((v) => (v == null ? null : v / scale));
  return lineChart(values, { label, unit, decimals, x: { kind: 'weeks', weeks: rows.map((w) => String(w.week || '')) } });
}

/** A stat row, or false when the number is missing (no zeros from nowhere). */
const stat = (/** @type {string} */ label, /** @type {unknown} */ v, /** @type {(n: number) => string} */ fmt, unit = '') => (num(v) != null ? row(label, fmt(/** @type {number} */ (v)), unit) : false);

/** A block view, or null when it has nothing to show. @param {any} v */
const block = (v) => (v.stats.length || v.charts.length ? v : null);

/** One 100 % bar from whole-number shares; null without at least two positive parts. */
function shares(/** @type {any} */ src, /** @type {[string, string, string][]} */ parts) {
  if (!src || typeof src !== 'object') return null;
  const out = parts.map(([key, field, label]) => ({ key, label, pct: num(src[field]) }))
    .filter((p) => p.pct != null && p.pct > 0)
    .map((p) => ({ ...p, pct: Math.round(/** @type {number} */ (p.pct)), narrow: /** @type {number} */ (p.pct) < 12 }));
  return out.length >= 2 ? out : null;
}

const MEASURE_LABELS = /** @type {Record<string, string>} */ ({
  waistCm: 'Waist', chestCm: 'Chest', hipsCm: 'Hips', neckCm: 'Neck', shoulderCm: 'Shoulders',
  armLCm: 'Left arm', armRCm: 'Right arm', thighLCm: 'Left thigh', thighRCm: 'Right thigh', calfLCm: 'Left calf', calfRCm: 'Right calf',
  muscleKg: 'Muscle mass', waterPct: 'Body water', boneKg: 'Bone mass', visceral: 'Visceral fat', bmrKcal: 'BMR',
  metabolicAge: 'Metabolic age', subcutaneousPct: 'Subcutaneous fat', skeletalMusclePct: 'Skeletal muscle', proteinPct: 'Protein',
  // the keys the Renpho collector writes (R2b.2b)
  musclePct: 'Muscle', metabolicAgeYears: 'Metabolic age', leanMassKg: 'Lean mass', fatFreeKg: 'Fat-free mass',
  abdomenCm: 'Abdomen', armCm: 'Arm', thighCm: 'Thigh', calfCm: 'Calf',
});

/** `armRCm` → `Arm r`: a readable label for a measure this site has not named yet. */
const humanKey = (/** @type {string} */ k) => {
  const t = k.replace(/(Cm|Kg|Pct|Kcal|Years)$/, '').replace(/([A-Z])/g, ' $1').trim().toLowerCase();
  return t ? t[0].toUpperCase() + t.slice(1) : k;
};

/** Signed change with a real minus: `+0.7`, `−2.5`, `0`. */
const signed = (/** @type {number} */ n, /** @type {number} */ d) => {
  const r = Number(n.toFixed(d));
  return r === 0 ? '0' : `${r > 0 ? '+' : '−'}${Math.abs(r).toFixed(d)}`;
};

/** `2026-08-11` → `11 Aug 2026`. */
const dayLabel = (/** @type {unknown} */ iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
  return m ? `${+m[3]} ${MONTHS[+m[2] - 1]} ${m[1]}` : '';
};

/** The Renpho block: tape and scale measures, each with change since its first reading. */
function measurementsView(/** @type {any} */ m) {
  if (!m || typeof m !== 'object') return null;
  const list = [...(Array.isArray(m.tape) ? m.tape : []), ...(Array.isArray(m.scale) ? m.scale : [])]
    .filter((x) => x && typeof x.key === 'string' && num(x.latest?.value) != null);
  const rows = [];
  const charts = [];
  for (const x of list) {
    const label = MEASURE_LABELS[x.key] || humanKey(x.key);
    const unit = String(x.unit || '');
    const d = Number.isInteger(x.latest.value) && (num(x.first?.value) == null || Number.isInteger(x.first.value)) ? 0 : 1;
    rows.push({
      key: x.key, label, unit, value: d ? one(x.latest.value) : group(x.latest.value),
      change: num(x.change) != null ? signed(x.change, d) : '',
      since: dayLabel(x.first?.date),
    });
    const c = weeklyChart(x.weekly, 'value', label, unit, d);
    if (c) charts.push(c);
  }
  return rows.length ? { rows, charts } : null;
}

/** The merged /life/body view (R2c.2): measures, sleep, food, movement, and Renpho measurements. */
function bodyView(/** @type {any} */ sec) {
  const l = sec.latest || {};
  const weekly = Array.isArray(sec.weekly) ? sec.weekly : [];
  const measures = {
    stats: [
      stat('Weight', l.weightKg, one, 'kg'),
      stat('Body fat', l.bodyFatPct, one, '%'),
      stat('BMI', l.bmi, one),
      stat('Lean mass', l.leanMassKg, one, 'kg'),
      stat('Resting heart rate', l.restingHr, group, 'bpm'),
      stat('HRV', l.hrvMs, group, 'ms'),
      stat('VO₂ max', l.vo2Max, one, 'ml/kg/min'),
      stat('SpO₂', l.spo2Pct, one, '%'),
      stat('Breathing rate', l.breathsPerMin, one, '/min'),
    ].filter(Boolean),
    charts: [
      weeklyChart(weekly, 'weightKg', 'Weight', 'kg', 1),
      weeklyChart(weekly, 'bodyFatPct', 'Body fat', '%', 1),
      weeklyChart(weekly, 'restingHr', 'Resting heart rate', 'bpm'),
      weeklyChart(weekly, 'hrvMs', 'HRV', 'ms'),
      weeklyChart(weekly, 'vo2Max', 'VO₂ max', 'ml/kg/min', 1),
      weeklyChart(weekly, 'spo2Pct', 'SpO₂', '%', 1),
      weeklyChart(weekly, 'breathsPerMin', 'Breathing rate', 'breaths/min', 1),
    ].filter(Boolean),
  };

  const s = sec.sleep && typeof sec.sleep === 'object' ? sec.sleep : null;
  const sleep = s && block({
    stats: [
      stat('Last 30 nights', s.avgMinutes30, hm),
      stat('Last 90 nights', s.avgMinutes90, hm),
      stat('Consistency', s.consistencyMinutes, (n) => `±${group(n)}`, 'min'),
      s.best?.date && num(s.best.minutes) != null && { ...row('Best night', hm(s.best.minutes)), sub: String(s.best.date) },
      s.worst?.date && num(s.worst.minutes) != null && { ...row('Shortest night', hm(s.worst.minutes)), sub: String(s.worst.date) },
    ].filter(Boolean),
    charts: [weeklyChart(s.weekly, 'avgMinutes', 'Sleep, weekly average', 'h', 1, 60)].filter(Boolean),
    stages: shares(s.stages30, [['deep', 'deepPct', 'Deep'], ['light', 'lightPct', 'Light'], ['rem', 'remPct', 'REM'], ['wake', 'wakePct', 'Awake']]),
  });

  const f = sec.food && typeof sec.food === 'object' ? sec.food : null;
  const food = f && block({
    stats: [
      stat('Protein per kg', f.proteinPerKg30, one, 'g/kg'),
      stat('Energy', f.avgKcal30, group, 'kcal'),
      stat('Protein', f.avgProteinG30, group, 'g'),
      stat('Carbs', f.avgCarbsG30, group, 'g'),
      stat('Fat', f.avgFatG30, group, 'g'),
      stat('Fibre', f.avgFibreG30, group, 'g'),
      stat('Logging streak', f.loggedStreakDays, group, 'days'),
      stat('Protein target streak', f.proteinStreakDays, group, 'days'),
    ].filter(Boolean),
    charts: [
      weeklyChart(f.weekly, 'avgKcal', 'Energy, daily average', 'kcal'),
      weeklyChart(f.weekly, 'avgProteinG', 'Protein, daily average', 'g'),
    ].filter(Boolean),
    split: shares(f.split30, [['protein', 'proteinPct', 'Protein'], ['carbs', 'carbsPct', 'Carbs'], ['fat', 'fatPct', 'Fat']]),
  });

  const mv = sec.movement && typeof sec.movement === 'object' ? sec.movement : null;
  const movement = mv && block({
    stats: [
      stat('Steps a day', mv.avgSteps30, group),
      stat('Active zone minutes a week', mv.avgAzmWeek4, group, 'min'),
    ].filter(Boolean),
    charts: [
      weeklyChart(mv.weekly, 'avgSteps', 'Steps, daily average', 'steps'),
      weeklyChart(mv.weekly, 'azmMinutes', 'Active zone minutes', 'min'),
    ].filter(Boolean),
  });

  return { measures, sleep: sleep || null, food: food || null, movement: movement || null, measurements: measurementsView(sec.measurements) };
}

// ─── games (C6) ───

/** Art is hotlinked from Steam's CDN or Riot's Data Dragon only, and only as a plain URL. */
const ART = /^https:\/\/(shared\.akamai\.steamstatic\.com|ddragon\.leagueoflegends\.com)\/[A-Za-z0-9._~%/+=&?-]*$/;
/** @param {unknown} u */
export const safeArt = (u) => (typeof u === 'string' && ART.test(u) ? u : '');

/** FNV-1a, 32-bit unsigned: a stable number per game name. @param {string} s */
function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** A tile's tilt in degrees, −2.4 to 2.4 in steps of 0.8, the same on every build. @param {string} name */
export const tiltOf = (name) => Number((((hash(name) % 7) - 3) * 0.8).toFixed(1));

const APEX = new Set(['MASTER', 'GRANDMASTER', 'CHALLENGER']);
const titleCase = (/** @type {string} */ t) => (t ? t[0].toUpperCase() + t.slice(1).toLowerCase() : '');
/** 412345 → `412k`; 1.2M; under 1,000 as is. @param {number} n */
const compact = (n) => (n >= 1e6 ? `${one(n / 1e6)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : group(n));
/** Hours: one decimal under 10, whole above. @param {number} h */
const hours = (h) => (h < 10 ? one(h) : group(h));

/** Data Dragon ids whose display name is not just the id split at its capitals. */
const CHAMPION_NAMES = /** @type {Record<string, string>} */ ({
  MonkeyKing: 'Wukong', Chogath: "Cho'Gath", Kaisa: "Kai'Sa", Khazix: "Kha'Zix", KogMaw: "Kog'Maw", Velkoz: "Vel'Koz",
  Belveth: "Bel'Veth", KSante: "K'Sante", RekSai: "Rek'Sai", DrMundo: 'Dr. Mundo', Nunu: 'Nunu & Willump',
  Renata: 'Renata Glasc', Leblanc: 'LeBlanc', FiddleSticks: 'Fiddlesticks',
});
/** A champion's display name: the export's name as is, or an id ("MissFortune") made readable ("Miss Fortune"). @param {unknown} c */
export function championName(c) {
  const s = String(c ?? '').trim();
  if (!s || /\s/.test(s)) return s;
  return CHAMPION_NAMES[s] || s.replace(/([a-z])([A-Z])/g, '$1 $2');
}

/** `Gold II · 54 LP`; apex tiers have no division; '' unranked. @param {any} r */
function rankLabel(r) {
  if (!r || typeof r !== 'object' || typeof r.tier !== 'string' || !r.tier) return '';
  const tier = r.tier.toUpperCase();
  const div = !APEX.has(tier) && typeof r.division === 'string' && r.division ? ` ${r.division}` : '';
  const lp = num(r.lp) != null ? ` · ${group(r.lp)} LP` : '';
  return `${titleCase(tier)}${div}${lp}`;
}

/** The League block, or null without one. Champions only: never a player. @param {any} lg */
function leagueView(lg) {
  if (!lg || typeof lg !== 'object') return null;
  const r = lg.rank && typeof lg.rank === 'object' ? lg.rank : null;
  const w = num(r?.wins), l = num(r?.losses);
  const rec = lg.recent && typeof lg.recent === 'object' ? lg.recent : {};
  const life = lg.lifetime && typeof lg.lifetime === 'object' ? lg.lifetime : {};
  return {
    rankLabel: rankLabel(r),
    queueLabel: r ? (r.queue === 'flex' ? 'Ranked flex' : 'Ranked solo/duo') : '',
    record: w != null && l != null ? `${group(w)}W ${group(l)}L` : '',
    seasonWinRate: w != null && l != null && w + l > 0 ? Math.round((w / (w + l)) * 100) : null,
    mains: (Array.isArray(lg.mains) ? lg.mains : []).filter((m) => m && m.champion).slice(0, 5).map((m) => ({
      champion: championName(m.champion), level: num(m.level), points: num(m.points) != null ? compact(m.points) : '', art: safeArt(m.splash),
    })),
    recent: num(rec.games) ? {
      games: num(rec.games), winRate: num(rec.winRate), kda: num(rec.kda) != null ? rec.kda.toFixed(2) : '',
      pool: (Array.isArray(rec.pool) ? rec.pool : []).filter((p) => p && p.champion)
        .map((p) => ({ champion: championName(p.champion), games: num(p.games) ?? 0, winRate: num(p.winRate) })),
    } : null,
    lifetime: num(life.games) ? { games: group(life.games), hours: num(life.hours) != null ? group(life.hours) : '', sinceLabel: monthLabel(life.since) } : null,
  };
}

/** Hours with an h: one decimal under 10, whole above. @param {number} h */
const hoursText = (h) => `${h < 10 ? one(h) : group(h)}h`;

const BAND_LABELS = /** @type {Record<string, string>} */ ({
  daytime: 'Daytime, 9am–5pm', evening: 'Evening, 5pm–10pm', late: 'Late, 10pm–2am', small: 'Small hours, 2am–9am',
});

/**
 * Time of day: weekday and weekend columns on one shared scale; weekday 9am–5pm is one
 * "daytime" block, never hour by hour. Null without any play. @param {any} c
 */
function clockView(c) {
  if (!c || typeof c !== 'object') return null;
  const arr = (/** @type {any} */ a) => (Array.isArray(a) && a.length === 24 ? a.map((v) => num(v)) : null);
  const wd = arr(c.weekday), we = arr(c.weekend);
  if (!wd && !we) return null;
  const day = num(c.weekdayDaytime) ?? 0;
  const max = Math.max(0, ...[...(wd || []), ...(we || [])].filter((v) => v != null).map(Number), day / 8);
  const weekday = wd ? clockBars(wd, { label: 'Weekdays', unit: 'hours played, by hour', max, merged: { from: 9, to: 17, total: day, label: 'daytime' } }) : null;
  const weekend = we ? clockBars(we, { label: 'Weekends', unit: 'hours played, by hour', max }) : null;
  if (!weekday && !weekend) return null;
  const parts = [];
  if (monthLabel(c.leagueSince)) parts.push(`League from every match since ${monthLabel(c.leagueSince)}`);
  if (dayLabel(c.steamSince)) parts.push(`Steam sampled hourly since ${dayLabel(c.steamSince)}`);
  return { charts: [weekday, weekend].filter(Boolean), note: parts.join('; ') };
}

/** Cumulative hours this year, week by week (League + Steam since tracking). @param {any[]} weeks @param {any} year */
function yearChart(weeks, year) {
  const rows = (Array.isArray(weeks) ? weeks : []).filter((w) => w && typeof w === 'object' && /^\d{4}-\d{2}-\d{2}$/.test(String(w.week)));
  const chart = lineChart(rows.map((w) => num(w.total)), { label: 'This year, cumulative', unit: 'hours', x: { kind: 'weeks', weeks: rows.map((w) => String(w.week)) } });
  if (!chart) return null;
  const since = dayLabel(year?.steamSince);
  return { chart, note: since ? `League from every match; Steam counted from ${since}, when tracking began` : 'League from every match; Steam not counted (no day-by-day history yet)' };
}

/** The fun numbers, each a row; null without any. @param {any} f */
function funView(f) {
  if (!f || typeof f !== 'object') return null;
  const facts = [];
  const s = f.longestSession;
  if (s && num(s.games) && num(s.hours) != null) {
    facts.push({ label: 'Longest session', value: `${group(s.games)} games`, sub: `${hoursText(s.hours)} back to back, ${num(s.wins) ?? 0} won${dayLabel(s.day) ? ` · ${dayLabel(s.day)}` : ''}` });
  }
  const b = f.biggestDay;
  if (b && num(b.hours) != null && dayLabel(b.day)) facts.push({ label: 'Biggest League day', value: hoursText(b.hours), sub: `${group(num(b.games) ?? 0)} games · ${dayLabel(b.day)}` });
  const g = f.longestGame;
  if (g && num(g.minutes)) facts.push({ label: 'Longest game', value: `${group(g.minutes)} min`, sub: `${championName(g.champion)}, ${g.won ? 'won' : 'lost'}${dayLabel(g.day) ? ` · ${dayLabel(g.day)}` : ''}` });
  const modes = (Array.isArray(f.modes) ? f.modes : []).filter((m) => m && m.mode && num(m.games));
  const total = modes.reduce((t, m) => t + m.games, 0);
  const champs = (Array.isArray(f.championByMonth) ? f.championByMonth : []).filter((c) => c && c.champion && monthLabel(c.month) && num(c.games))
    .map((c) => ({ month: monthLabel(c.month), champion: championName(c.champion), games: group(c.games), of: num(c.of) != null ? group(c.of) : '' }))
    .reverse();
  const bands = (Array.isArray(f.winByBand) ? f.winByBand : []).filter((x) => x && BAND_LABELS[x.band] && num(x.games))
    .map((x) => ({ label: BAND_LABELS[x.band], games: group(x.games), winRate: num(x.winRate), pct: Math.max(0, Math.min(100, num(x.winRate) ?? 0)) }));
  const view = {
    facts,
    modes: modes.map((m) => ({ mode: String(m.mode), games: group(m.games), hours: num(m.hours) != null ? hoursText(m.hours) : '', pct: total ? Math.round((m.games / total) * 100) : 0 })),
    champs, bands,
  };
  return facts.length || view.modes.length || champs.length || bands.length ? view : null;
}

/** The headline numbers: League this year, Steam's fortnight, all time (with what it covers). @param {any} sec */
function gamesStats(sec) {
  const y = sec.year && typeof sec.year === 'object' ? sec.year : {};
  const at = sec.allTime && typeof sec.allTime === 'object' ? sec.allTime : null;
  const lgSince = monthLabel(at?.leagueSince);
  const all = num(sec.hoursTotal) != null ? {
    ...row('All time', group(/** @type {number} */ (num(sec.hoursTotal))), 'h'),
    sub: at ? `Steam lifetime ${group(num(at.steam) ?? 0)}h + League ${group(num(at.league) ?? 0)}h${lgSince ? ` since ${lgSince}` : ''}` : '',
  } : false;
  // Steam's tracked hours join the line only once they amount to something (a 0h reads as a glitch).
  const tracked = num(y.steamSinceTracking);
  const since = dayLabel(y.steamSince).replace(/ \d{4}$/, '');
  const steamYear = tracked != null && tracked >= 1 && since ? `+ ${group(tracked)}h Steam since ${since}` : '';
  return [
    num(y.league) != null ? { ...row('League this year', group(y.league), 'h'), sub: [num(y.leagueGames) != null ? `${group(y.leagueGames)} games` : '', steamYear].filter(Boolean).join(' · ') } : false,
    num(sec.steam2Weeks) != null ? { ...row('Steam, last 2 weeks', hours(sec.steam2Weeks), 'h'), sub: "Steam's own two-week figure" } : false,
    all,
    // 0 means not counted yet (no multiplayer flags collected), not "never online"
    num(sec.multiplayerHours) ? row('Multiplayer', group(sec.multiplayerHours), 'h') : false,
    stat('Backlog', sec.backlog, group, 'games'),
  ].filter(Boolean);
}

/** /life/games from C6: the cover wall, League, recently played, the rarest achievements. @param {any} sec */
function gamesView(sec) {
  const a = sec.achievements && typeof sec.achievements === 'object' ? sec.achievements : {};
  const list = (/** @type {any} */ l) => (Array.isArray(l) ? l.filter((x) => x && typeof x === 'object') : []);
  const wall = list(sec.wall).filter((t) => typeof t.name === 'string' && t.name.trim()).map((t, i) => ({
    name: t.name, art: safeArt(t.art), weight: Math.min(4, Math.max(1, Math.round(num(t.weight) ?? 1))), tilt: tiltOf(t.name),
    quip: typeof t.quip === 'string' ? t.quip.trim() : '', league: t.source === 'league',
    // the typographic tile's ink (shown when there is no art, or it fails to load): cycled, so neighbours differ
    ink: i % 5,
  }));
  return {
    stats: gamesStats(sec),
    clock: clockView(sec.clock),
    yearChart: yearChart(sec.yearWeeks, sec.year),
    fun: funView(sec.fun),
    wall,
    league: leagueView(sec.league),
    recent: list(sec.recent).filter((g) => g.name).map((g) => ({ name: String(g.name), hours: num(g.hours) != null ? hours(g.hours) : '', art: safeArt(g.art) })),
    achieved: num(a.unlocked) != null && num(a.total) ? `${group(a.unlocked)} of ${group(a.total)}` : '',
    rarest: list(a.rarest).filter((r) => r.name && r.game && num(r.pct) != null).map((r) => ({ game: String(r.game), name: String(r.name), pct: one(r.pct) })),
    completion: list(a.completion).filter((c) => c.game && num(c.pct) != null).map((c) => ({ game: String(c.game), pct: Math.max(0, Math.min(100, Math.round(c.pct))) })),
  };
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const plural = (/** @type {number} */ n, /** @type {string} */ one_, /** @type {string} */ many) => `${group(n)} ${n === 1 ? one_ : many}`;
/** Kind codes the box sends for live events -> plural words (anything else reads as "other"). */
const LIVE_KINDS = /** @type {Record<string, [string, string]>} */ ({ gig: ['gig', 'gigs'], theatre: ['show', 'shows'], comedy: ['comedy night', 'comedy nights'], sport: ['match', 'matches'] });

/**
 * /life/live: every gig and live event seen, by year then month (month precision only, as the
 * export holds it), per-year counts, a few computed stats and a per-year chart.
 * @param {any[]} notables every live event, de-duplicated (liveNotables)
 */
function liveView(notables) {
  const items = notables
    .filter((n) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(n.month || '')))
    .map((n) => ({ title: String(n.title), month: String(n.month), kind: LIVE_KINDS[String(n.kind)] ? String(n.kind) : 'other' }))
    .sort((a, b) => b.month.localeCompare(a.month) || a.title.localeCompare(b.title));
  if (!items.length) return null;
  const kinds = [...new Set(items.map((i) => i.kind))];
  const kindWord = (/** @type {string} */ k, /** @type {number} */ n) => (LIVE_KINDS[k] ? LIVE_KINDS[k][n === 1 ? 0 : 1] : n === 1 ? 'other event' : 'other events');
  const monthIdx = (/** @type {string} */ m) => +m.slice(0, 4) * 12 + (+m.slice(5, 7) - 1);
  const label = (/** @type {number} */ idx) => `${MONTH_NAMES[idx % 12]} ${Math.floor(idx / 12)}`;

  /** @type {Map<string, number>} */
  const perMonth = new Map();
  for (const i of items) perMonth.set(i.month, (perMonth.get(i.month) || 0) + 1);
  // busiest month: most events, the newest of equals
  const busiest = /** @type {[string, number]} */ ([...perMonth.entries()].sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))[0]);
  // longest gap: the most whole months in a row with nothing, between two events
  const months = [...perMonth.keys()].map(monthIdx).sort((a, b) => a - b);
  let gap = { n: 0, from: 0, to: 0 };
  for (let k = 1; k < months.length; k++) {
    const n = months[k] - months[k - 1] - 1;
    if (n > gap.n) gap = { n, from: months[k - 1] + 1, to: months[k] - 1 };
  }

  const years = [...new Set(items.map((i) => i.month.slice(0, 4)))].sort((a, b) => b.localeCompare(a));
  const yearRows = years.map((y) => {
    const mine = items.filter((i) => i.month.startsWith(y));
    const byMonth = [...new Set(mine.map((i) => i.month))].map((m) => ({
      label: MONTH_NAMES[+m.slice(5, 7) - 1],
      items: mine.filter((i) => i.month === m).map((i) => ({ title: i.title, kindLabel: kinds.length > 1 ? kindWord(i.kind, 1) : '' })),
    }));
    return { year: y, total: mine.length, countLabel: plural(mine.length, 'event', 'events'), months: byMonth };
  });

  // chart: one column per year, empty years in between kept as zeros
  const first = +years[years.length - 1], last = +years[0];
  const span = Array.from({ length: last - first + 1 }, (_, k) => String(first + k));
  const charts = [
    columnBars(span, span.map((y) => items.filter((i) => i.month.startsWith(y)).length), { label: 'Live events', unit: 'per year', noun: 'events' }),
  ].filter(Boolean);

  const stats = [
    row('Seen live', group(items.length)),
  ];
  // with one event in every month there is no busiest one to name
  if (busiest[1] > 1) stats.push(Object.assign(row('Busiest month', `${MONTHS[+busiest[0].slice(5, 7) - 1]} ${busiest[0].slice(0, 4)}`), { sub: plural(busiest[1], 'event', 'events') }));
  if (gap.n > 0) {
    stats.push(Object.assign(row('Longest gap', group(gap.n), gap.n === 1 ? 'month' : 'months'), { sub: gap.from === gap.to ? label(gap.from) : `${label(gap.from)} to ${label(gap.to)}` }));
  }
  const busyYear = [...yearRows].sort((a, b) => b.total - a.total || b.year.localeCompare(a.year))[0];
  stats.push(Object.assign(row('Busiest year', busyYear.year), { sub: plural(busyYear.total, 'event', 'events') }));
  if (kinds.length > 1) {
    for (const k of kinds) stats.push(row(kindWord(k, 2)[0].toUpperCase() + kindWord(k, 2).slice(1), group(items.filter((i) => i.kind === k).length)));
  }

  return { total: items.length, stats, charts, yearRows };
}

/** @param {any} sec @param {any[]} outings notables of the matching outing kind */
function mediaView(sec, outings) {
  const yearTotals = sec.totals?.year || {};
  const monthTotals = sec.totals?.month || {};
  return {
    notable: sortedNotables(sec.notable),
    years: Object.fromEntries(Object.entries(sec.years || {}).map(([y, l]) => [y, sortedNotables(/** @type {any[]} */ (l))])),
    yearList: Object.keys(sec.years || {}).sort().reverse(),
    totals: { month: monthTotals, year: yearTotals },
    saw: outings.map((n) => ({ ...notableView(n), sawLabel: sawLabel(n.month) })),
    hasSaw: outings.length > 0,
  };
}

/** A project link only when it is a repo under James's own GitHub accounts. */
const REPO_URL = /^https:\/\/github\.com\/(ripixel|Ripixel-Studio)\/[\w.-]+$/;

/**
 * The code page (C7, R2e.6): active projects, the commits line chart and the
 * languages-by-year stacked shares. Retired rows are dropped; an old export without `status` reads as all active.
 * @param {any} sec
 */
function codeView(sec) {
  const year = (/** @type {unknown} */ y) => (Number.isInteger(y) ? String(y) : '');
  const projects = (Array.isArray(sec.projects) ? sec.projects : []).filter((p) => p && typeof p === 'object' && p.name)
    .map((/** @type {any} */ p) => {
      const started = /^\d{4}-\d{2}-\d{2}/.test(String(p.started || '')) ? String(p.started).slice(0, 10) : '';
      const from = year(p.fromYear) || started.slice(0, 4);
      return {
        retired: p.status === 'retired',
        raw: p,
        view: {
          name: String(p.name),
          description: typeof p.description === 'string' ? p.description.trim() : '',
          years: from ? `${from}–now` : '',
          lastCommit: monthLabel(String(p.lastCommit || '')),
          commits: num(p.commits) != null ? group(p.commits) : '',
          commitsUnit: p.commits === 1 ? 'commit' : 'commits',
          languages: (Array.isArray(p.languages) ? p.languages : []).filter((l) => typeof l === 'string' && l),
          url: typeof p.url === 'string' && REPO_URL.test(p.url) ? p.url : '',
          started,
        },
      };
    });
  const months = (Array.isArray(sec.commitsByMonth) ? sec.commitsByMonth : []).filter((m) => m && typeof m === 'object');
  const byYear = sec.languagesByYear && typeof sec.languagesByYear === 'object' ? sec.languagesByYear : {};
  const languages = stackedShare(byYear);
  const endDay = /^\d{4}-\d{2}-\d{2}$/.test(String(sec.updated || '')) ? String(sec.updated) : new Date().toISOString().slice(0, 10);
  const live = projects.filter((p) => !p.retired);
  const drawn = projectCards(live.map((p) => p.raw), (languages?.series || []).map((/** @type {any} */ s) => s.key), endDay);
  return {
    languagesNow: Array.isArray(sec.languagesNow) ? sec.languagesNow : [],
    commits: lineChart(months.map((m) => num(m.n) ?? 0), { label: 'Commits', unit: 'a month', x: { kind: 'months', months: months.map((m) => String(m.month || '')) } }),
    languages,
    grid: commitGrid(sec.commitsByDay, endDay),
    timeline: { axis: drawn.axis, nowPct: drawn.nowPct },
    active: live.map((p, i) => ({ ...p.view, card: drawn.cards[i] })),
  };
}

/**
 * One section's page view. `sec` is the export's section, or the fitness card
 * source; a missing or empty one gives `empty: true` and no numbers at all.
 * @param {string} name @param {any} sec @param {Date} [now]
 * @param {any[]} [liveNotables] outings notables (cinema/gig split here)
 */
export function buildSection(name, sec, now = new Date(), liveNotables = []) {
  const base = { name, href: SECTION_HREF(name), title: /** @type {any} */ (TITLES)[name] || name };
  if (!hasData(sec)) return { ...base, staleLabel: '', empty: true, headline: null, latest: null };
  const view = { ...base, staleLabel: staleLabel(sec.staleDays), updated: String(sec.updated || ''), empty: false, headline: headlineOf(sec.headline) ?? fallbackHeadline(name, sec), latest: /** @type {any} */ (null) };
  const weekly = sec.weekly;
  switch (name) {
    case 'body':
      return { ...view, ...bodyView(sec) };
    case 'games':
      return { ...view, ...gamesView(sec) };
    case 'code':
      return { ...view, ...codeView(sec) };
    case 'watching': {
      const m = mediaView(sec, []);
      const y = m.totals.year, mo = m.totals.month;
      return { ...view, ...m, latest: latestOf(sec.notable),
        stats: [
          ['This year', y], ['This month', mo],
        ].map(([label, t]) => /** @type {any} */ (t) && Object.keys(/** @type {any} */ (t)).length ? ({
          label, // "watched", never "finished"
          items: [row('Films watched', group(num(t.films) ?? 0)), ...(num(t.cinema) != null ? [row('At the cinema', group(num(t.cinema) ?? 0))] : []), row('Episodes', group(num(t.episodes) ?? 0)), row('Videos', group(num(t.videos) ?? 0)), row('Hours', group(num(t.hours) ?? 0), 'h')],
        }) : null).filter(Boolean) };
    }
    case 'listening': {
      const m = mediaView(sec, liveNotables.filter((n) => n.kind === 'gig'));
      return { ...view, ...m, latest: latestOf(sec.notable),
        stats: [['This year', m.totals.year], ['This month', m.totals.month]].map(([label, t]) => /** @type {any} */ (t) && Object.keys(/** @type {any} */ (t)).length ? ({
          label,
          items: [row('Tracks', group(num(t.tracks) ?? 0)), row('Podcast episodes', group(num(t.podcastEpisodes) ?? 0)), row('Audiobook', group(num(t.audiobookHours) ?? 0), 'h')],
        }) : null).filter(Boolean) };
    }
    case 'reading': {
      const m = mediaView(sec, []);
      return { ...view, ...m, latest: latestOf(sec.notable),
        current: (Array.isArray(sec.current) ? sec.current : []).map((c) => ({ title: String(c?.title || ''), by: c?.by || '', percent: Math.round((num(c?.progress) ?? 0) * 100) })).filter((c) => c.title),
        stats: [['This year', m.totals.year], ['This month', m.totals.month]].map(([label, t]) => /** @type {any} */ (t) && Object.keys(/** @type {any} */ (t)).length ? ({
          label, items: [row('Books', group(num(t.books) ?? 0)), row('Pages', group(num(t.pages) ?? 0))],
        }) : null).filter(Boolean) };
    }
    case 'live':
      return { ...view, ...(liveView(liveNotables) || { total: 0, stats: [], charts: [], yearRows: [] }) };
    default:
      return view;
  }
  void now;
}

/**
 * The hub's second line for a section: its latest notable thing, or the one number
 * after the headline that says the most. `{label, value, href}` or null.
 * @param {string} name @param {any} v the section view (buildSection)
 */
export function hubNote(name, v) {
  if (!v || v.empty) return null;
  // body keeps its rows in blocks; the sleep average is named as the hub note reads it
  const rows = name === 'body'
    ? [...(v.sleep?.stats || []).map((/** @type {any} */ r) => (r.label === 'Last 30 nights' ? { ...r, label: 'Sleep, last 30 nights' } : r)), ...(v.measures?.stats || [])]
    : (Array.isArray(v.stats) ? v.stats : []);
  const stat = (/** @type {string} */ label) => {
    const r = rows.find((/** @type {any} */ x) => x && x.label === label);
    return r ? { label: r.label, value: r.unit ? `${r.value}${r.unit === '%' ? '' : ' '}${r.unit}` : String(r.value), href: '' } : null;
  };
  const latest = (/** @type {any} */ n) => (n && n.title ? { label: 'Latest', value: n.by ? `${n.title}, ${n.by}` : n.title, href: '' } : null);
  switch (name) {
    case 'body': return stat('Sleep, last 30 nights') || stat('Body fat') || stat('Resting heart rate');
    case 'games':
      if (v.league?.rankLabel) return { label: 'League', value: v.league.rankLabel, href: '' };
      return v.recent?.[0] ? { label: 'Recently', value: v.recent[0].name, href: '' } : null;
    case 'code': {
      const p = [...(v.active || [])].sort((a, b) => b.started.localeCompare(a.started))[0];
      return p ? { label: 'Newest project', value: p.name, href: p.url || '' } : null;
    }
    case 'reading': {
      const c = v.current?.[0];
      return latest(v.latest) || (c ? { label: 'Reading now', value: c.by ? `${c.title}, ${c.by}` : c.title, href: '' } : null);
    }
    case 'watching':
    case 'listening':
      return latest(v.latest);
    default:
      return null;
  }
}

/** @param {any} lifeIndex */
function liveNotables(lifeIndex) {
  const o = lifeIndex?.sections?.live;
  // Outings keep month precision and are few: the list carries every year the export holds
  // (`years`), not only the last two months (`notable`), de-duplicated by key and month.
  const all = [...(Array.isArray(o?.notable) ? o.notable : []), ...Object.values(o?.years || {}).flatMap((l) => (Array.isArray(l) ? l : []))];
  const seen = new Set();
  return all.filter((n) => {
    if (!n || !n.title) return false;
    const id = `${n.key}|${n.month}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/**
 * The hub: one card per section in order, then the outings list.
 * @param {any} lifeIndex @param {any} fitnessLife @param {Date} now
 */
export function buildHub(lifeIndex, fitnessLife, now = new Date()) {
  const sections = lifeIndex?.sections && typeof lifeIndex.sections === 'object' ? lifeIndex.sections : {};
  const outs = liveNotables(lifeIndex);
  const cards = SECTION_ORDER.map((name) => {
    if (name === 'fitness') {
      const first = fitnessLife?.stats?.strip?.[0];
      const empty = !first;
      const act = fitnessLife?.activities?.[0];
      return {
        name, href: SECTION_HREF(name), title: TITLES.fitness, empty, staleLabel: '', latest: null,
        headline: empty ? null : { value: String(first.value), unit: String(first.unit || ''), label: String(first.label || '') },
        note: act && act.title ? { label: 'Latest session', value: String(act.title), href: String(act.href || '') } : null,
      };
    }
    const v = /** @type {any} */ (buildSection(name, sections[name], now, outs));
    return { name, href: v.href, title: v.title, headline: v.empty ? null : v.headline, latest: v.empty ? null : v.latest, staleLabel: v.staleLabel, empty: v.empty, note: hubNote(name, v) };
  });
  return {
    cards,
    live: sortedNotables(outs).map((n) => ({ ...n, sawLabel: sawLabel(n.month) })),
    hero: heroCards(lifeIndex, cards, now),
  };
}

/* ─── The hero hub (C8): `hub.rows` → cards with one hero each ─────────────── */

export const HERO_SIZES = ['lg', 'md', 'sm'];
/** Activity pages live here (fitness-activity-views.mjs ACTIVITY_BASE_PATH; a literal to keep this module light). */
const ACTIVITY_PATH = '/life/activity';
const CAPTION_MAX = 240;

/**
 * Monday of an ISO week, `2026-W45` → `2026-11-02`; '' when unusable. The hub's spark points
 * carry week labels while the rest of the export uses Monday dates.
 * @param {unknown} label
 */
export function isoWeekMonday(label) {
  const m = /^(\d{4})-W(\d{2})$/.exec(String(label ?? ''));
  if (!m) return '';
  const year = +m[1];
  const week = +m[2];
  if (week < 1 || week > 53) return '';
  // Week 1 holds 4 January; its Monday is the start of the ISO year.
  const jan4 = Date.UTC(year, 0, 4);
  const dow = (new Date(jan4).getUTCDay() + 6) % 7; // Mon 0 … Sun 6
  const monday = new Date(jan4 - dow * 864e5 + (week - 1) * 7 * 864e5);
  // A year has a week 53 only when it ends on that week's Thursday or later.
  if (week === 53 && isoWeekMonday(`${year + 1}-W01`) <= monday.toISOString().slice(0, 10)) return '';
  return monday.toISOString().slice(0, 10);
}

/**
 * A mini route: the published points projected (equirectangular, scaled by cos(lat)) into a
 * w×h box, centred, with a margin. SVG path data plus the start and finish points. Null with
 * fewer than 2 points.
 * @param {any} points `[[lat, lng], …]` @param {number} [w] @param {number} [h]
 */
export function routeSketch(points, w = 320, h = 200) {
  const pts = cleanPoints(points);
  if (pts.length < 2) return null;
  const k = Math.cos((pts.reduce((s, p) => s + p[0], 0) / pts.length) * Math.PI / 180);
  const xy = pts.map(([lat, lng]) => [lng * k, -lat]);
  const xs = xy.map((p) => p[0]);
  const ys = xy.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const pad = 14;
  const span = Math.max(x1 - x0, y1 - y0) || 1;
  const scale = Math.min((w - 2 * pad) / (x1 - x0 || span), (h - 2 * pad) / (y1 - y0 || span));
  const ox = (w - (x1 - x0) * scale) / 2;
  const oy = (h - (y1 - y0) * scale) / 2;
  const at = (/** @type {number[]} */ p) => ({ x: +(ox + (p[0] - x0) * scale).toFixed(1), y: +(oy + (p[1] - y0) * scale).toFixed(1) });
  const drawn = xy.map(at);
  return {
    w, h,
    d: drawn.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' '),
    start: drawn[0],
    end: drawn[drawn.length - 1],
  };
}

/** A section's display number: whole numbers grouped, others to one place, strings as given. @param {unknown} v */
const heroNumber = (v) => {
  const n = num(v);
  if (n != null) return Number.isInteger(n) ? group(n) : one(n);
  return typeof v === 'string' && v.trim() ? v.trim() : '';
};

/** `Sci-fi` → `sci-fi`: a class-safe key for a bar. @param {string} s */
const slugKey = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'part';

/** An image source the page may load: https, or a path on this site. No backslashes: browsers read `\` as `/`, so `/\evil.example` would be protocol-relative. @param {unknown} src */
const safeSrc = (src) => (typeof src === 'string' && (/^https:\/\/[^\s"'<>\\]+$/.test(src) || /^\/(?![\/\\])[^\s"'<>\\]*$/.test(src)) ? src : '');

/**
 * One C8 hero as a view, or null when it cannot be drawn honestly (unknown type, missing or
 * invalid fields). The caption is plain text; the template escapes it.
 * @param {any} h @param {string} title the section title (image alt fallback)
 */
export function heroView(h, title = '') {
  if (!h || typeof h !== 'object') return null;
  switch (h.type) {
    case 'image': {
      const src = safeSrc(h.src);
      if (!src) return null;
      return { type: 'image', image: true, src, alt: String(h.alt || title || '').trim() };
    }
    case 'spark': {
      const rows = (Array.isArray(h.points) ? h.points : [])
        .filter((p) => Array.isArray(p) && isoWeekMonday(p[0]))
        .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
      const values = rows.map((p) => num(p[1]));
      const decimals = values.some((v) => v != null && !Number.isInteger(v)) ? 1 : 0;
      const chart = lineChart(values, {
        label: String(h.label || title), unit: String(h.unit || ''), decimals, w: 320, h: 90,
        x: { kind: 'weeks', weeks: rows.map((p) => isoWeekMonday(p[0])) },
      });
      return chart ? { type: 'spark', spark: true, chart } : null;
    }
    case 'stat': {
      const value = heroNumber(h.value);
      return value ? { type: 'stat', stat: true, value, unit: String(h.unit || ''), label: String(h.label || '') } : null;
    }
    case 'route': {
      const sketch = routeSketch(h.points);
      if (!sketch) return null;
      const slug = typeof h.slug === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(h.slug) ? h.slug : '';
      return { type: 'route', route: true, ...sketch, href: slug ? `${ACTIVITY_PATH}/${slug}` : '' };
    }
    case 'bars': {
      const items = (Array.isArray(h.items) ? h.items : [])
        .map((it) => ({ label: String(it?.label || '').trim(), pct: num(it?.pct) }))
        .filter((it) => it.label && it.pct != null && it.pct > 0)
        .map((it) => ({ key: slugKey(it.label), label: it.label, pct: Math.round(/** @type {number} */ (it.pct)), narrow: /** @type {number} */ (it.pct) < 12 }));
      return items.length ? { type: 'bars', bars: true, items } : null;
    }
    default:
      return null;
  }
}

/** @param {unknown} c */
const captionOf = (c) => {
  const t = typeof c === 'string' ? c.replace(/\s+/g, ' ').trim() : '';
  return t && t.length <= CAPTION_MAX ? t : '';
};

/**
 * The hero hub's cards from the export's `hub.rows`, in export order. Each keeps the section's
 * own headline (the same figure as the old rows) and gains a hero; a row whose hero is missing
 * or unusable drops to a slim (sm) row. The lg cards alternate sides, so the page zig-zags.
 * [] with no usable `hub` (an older export), and the page falls back to the rows.
 * @param {any} lifeIndex @param {any[]} cards the hub's section cards @param {Date} now
 */
export function heroCards(lifeIndex, cards, now = new Date()) {
  const rows = Array.isArray(lifeIndex?.hub?.rows) ? lifeIndex.hub.rows : [];
  const sections = lifeIndex?.sections && typeof lifeIndex.sections === 'object' ? lifeIndex.sections : {};
  const byName = new Map((cards || []).map((c) => [c.name, c]));
  const seen = new Set();
  let lg = 0;
  const out = [];
  for (const r of rows) {
    const name = typeof r?.section === 'string' && /^[a-z][a-z0-9-]*$/.test(r.section) ? r.section : '';
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const card = byName.get(name) || /** @type {any} */ (buildSection(name, sections[name], now));
    const title = String(card.title || '') === name ? name[0].toUpperCase() + name.slice(1) : String(card.title);
    const hero = heroView(r.hero, title);
    let size = HERO_SIZES.includes(r.size) ? r.size : 'md';
    if (!hero) size = 'sm';
    let href = typeof r.href === 'string' && /^\/(?!\/)/.test(r.href) ? r.href : SECTION_HREF(name);
    if (href === '/life') href = SECTION_HREF(name); // an older export pointed the row at the hub itself (outings)
    // A stat hero that shows the card's own headline figure would print the same number twice:
    // keep the hero (it is the bigger one) and drop the small headline.
    let headline = card.empty ? null : card.headline || null;
    if (headline && hero?.type === 'stat' && String(headline.value) === hero.value) headline = null;
    out.push({
      name, title, size, href,
      side: size === 'lg' ? (lg++ % 2 ? 'right' : 'left') : '',
      headline,
      empty: !!card.empty, // no data: the template shows the empty note; a hidden duplicate headline shows nothing
      staleLabel: String(card.staleLabel || ''),
      caption: hero ? captionOf(r.hero?.caption) : '', // no orphan caption for a rejected hero
      hero,
    });
  }
  return out;
}

const BIT_LABELS = {
  'personal.height': 'Height', 'personal.likes': 'Likes', 'personal.boardgames': 'Board games', 'personal.desk': 'Desk',
  'body.weight_kg': 'Weight',
};

/** @param {any} f */
const isPublic = (f) => f && typeof f === 'object' && typeof f.key === 'string' && !['private', 'sensitive'].includes(f.visibility);

/** @param {any} v */
const listText = (v) => (Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : x?.name)).filter(Boolean).join(', ') : String(v ?? ''));

/**
 * The personal bits, from public facts only.
 * @param {any[]} facts the export's `facts`
 */
export function personalBits(facts) {
  const byKey = new Map((Array.isArray(facts) ? facts : []).filter(isPublic).map((f) => [f.key, f]));
  const out = [];
  for (const [key, label] of Object.entries(BIT_LABELS)) {
    const f = byKey.get(key);
    if (!f || f.value == null || f.value === '') continue;
    let value;
    if (key === 'body.weight_kg') {
      const n = Number(f.value);
      if (!Number.isFinite(n)) continue;
      value = `${one(n)} kg`;
    } else {
      value = listText(f.value) + (f.unit && !Array.isArray(f.value) ? ` ${f.unit}` : '');
    }
    if (!value) continue;
    out.push({ key, label, value, tone: String(f.tone || 'neutral') });
  }
  return out;
}

/** @param {any[]} facts */
export function lifeFacts(facts) {
  return Object.fromEntries((Array.isArray(facts) ? facts : []).filter(isPublic).map((f) => [f.key, f.value]));
}

/**
 * FitGlue's start year: the earliest `started` across every project whose name starts with
 * "fitglue" (fitglue-server, fitglue-web, ...), from the `code.projects` rows and the matching
 * `code.project.fitglue_*.started` facts. Empty when there are none.
 * @param {any} idx the life index
 */
export function fitglueStarted(idx) {
  const facts = (Array.isArray(idx?.facts) ? idx.facts : []).filter(isPublic)
    .filter((f) => /^code\.project\.fitglue([_-][^.]*)?\.started$/i.test(f.key)).map((f) => String(f.value || ''));
  const rows = (Array.isArray(idx?.sections?.code?.projects) ? idx.sections.code.projects : [])
    .filter((p) => /^fitglue/i.test(String(p?.name || ''))).map((p) => String(p?.started || ''));
  const dates = [...facts, ...rows].filter((d) => /^\d{4}-\d{2}-\d{2}/.test(d)).sort();
  return dates.length ? dates[0].slice(0, 4) : '';
}

/**
 * The C5 insights as `[{id, text, href}]`: at most 6, export order, rows without a 1-160
 * character string `text` dropped. Plain data: the partial does the markup.
 * @param {any} idx the life export
 */
export function lifeInsights(idx) {
  const rows = Array.isArray(idx?.insights) ? idx.insights : [];
  /** @type {{id: string, text: string, href: string}[]} */
  const out = [];
  for (const r of rows) {
    if (!r || typeof r.text !== 'string' || r.text.length < 1 || r.text.length > 160) continue;
    const href = r.section === 'body' ? '/life/body' : r.section === 'fitness' ? '/life/fitness' : r.section === 'live' ? '/life/live' : '/life';
    out.push({ id: typeof r.id === 'string' ? r.id : String(out.length), text: r.text, href });
    if (out.length === 6) break;
  }
  return out;
}

/**
 * The homepage "life." card: blurb from the hub's section titles, footer from the newest outing.
 * @param {{cards: {title: string}[], live: {title: string, sawLabel?: string}[]}} hub
 */
export function homeLifeGlobals(hub) {
  const names = (hub?.cards || []).map((c) => String(c.title).toLowerCase());
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names.join('');
  const o = hub?.live?.[0];
  return {
    lifeBlurb: `James, by the numbers${list ? `: ${list}` : ''}, all gathered automatically.`,
    lifeLatest: o && o.title ? o.title : '',
    lifeLatestDate: o && o.title ? o.sawLabel || '' : '',
  };
}

export function lifeHubTask(config = {}) {
  return {
    name: 'life-hub',
    title: 'Build the /life hub, section and personal-bits view models',
    config,
    run: async (/** @type {any} */ cfg, /** @type {any} */ ctx) => {
      const g = ctx.globals || {};
      const now = cfg.now instanceof Date ? cfg.now : new Date();
      const idx = g.lifeIndex || null;
      const outs = liveNotables(idx);
      const lifeSections = Object.fromEntries(
        SECTION_ORDER.filter((n) => n !== 'fitness').map((n) => [n, buildSection(n, idx?.sections?.[n], now, outs)]),
      );
      const lifeHub = buildHub(idx, g.fitnessLife, now);
      ctx.logger.info(`Life hub: ${lifeHub.cards.filter((c) => !c.empty).length}/${lifeHub.cards.length} sections have data`);
      return { lifeHub, ...homeLifeGlobals(lifeHub), lifeSections, lifePersonal: personalBits(idx?.facts), lifeFacts: lifeFacts(idx?.facts),
        lifeInsights: lifeInsights(idx),
        // the homepage's "latest project" line and the "built <year>" badges
        fitglueStartedYear: fitglueStarted(idx),
        latestProjectDate: fitglueStarted(idx) ? `${fitglueStarted(idx)} → present` : '',
      };
    },
  };
}
