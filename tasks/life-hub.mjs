// @ts-check
/**
 * The /life hub, its nine section pages and the personal bits (LH3.4): data only.
 * Pure functions shape `lifeIndex` (the public life export) and `fitnessLife`
 * into view models; the templates only loop and test. No HTML strings here.
 * The only computed strings are SVG path data (`sparkPath`), as `routePath()` is.
 *
 * Globals set by `lifeHubTask()`:
 *   lifeHub       { cards[{name, href, title, headline, latest, note, staleLabel, empty}], outings[] }
 *   lifeSections  { [name]: view }
 *   lifePersonal  [{ key, label, value, tone }]
 *   lifeFacts     { [key]: value }
 *
 * NOTE for Task 7: the `work` section is not part of this task. Its view
 * (`workView`) must carry a salary table (role, salary, delta) shown only when
 * `work.salary` exists in the export (ruling F9).
 */

export const SECTION_ORDER = ['fitness', 'body', 'sleep', 'food', 'games', 'code', 'watching', 'listening', 'reading'];
/** @param {string} name */
export const SECTION_HREF = (name) => '/life/' + name;

const TITLES = {
  fitness: 'Fitness', body: 'Body', sleep: 'Sleep', food: 'Food', games: 'Games',
  code: 'Code', watching: 'Watching', listening: 'Listening', reading: 'Reading',
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

/**
 * An SVG path `d` through the values, scaled into w x h. '' for fewer than 2 numbers.
 * @param {number[]} values @param {number} w @param {number} h
 */
export function sparkPath(values, w, h) {
  const v = (Array.isArray(values) ? values : []).filter((x) => typeof x === 'number' && Number.isFinite(x));
  if (v.length < 2) return '';
  const lo = Math.min(...v);
  const hi = Math.max(...v);
  const span = hi - lo || 1;
  return v
    .map((y, i) => {
      const px = (i / (v.length - 1)) * w;
      const py = hi === lo ? h / 2 : h - ((y - lo) / span) * h;
      return `${i ? 'L' : 'M'}${+px.toFixed(1)} ${+py.toFixed(1)}`;
    })
    .join(' ');
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

/** @param {any} sec */
function hasData(sec) {
  if (!sec || typeof sec !== 'object' || Array.isArray(sec)) return false;
  if (sec.headline && sec.headline.value != null) return true;
  return ['latest', 'weekly', 'notable', 'projects', 'mostPlayed', 'recent', 'totals', 'avgMinutes30', 'avgKcal30', 'current']
    .some((k) => {
      const v = sec[k];
      return Array.isArray(v) ? v.length > 0 : v != null && typeof v !== 'object' ? true : v != null && Object.keys(v).length > 0;
    });
}

/** @param {any[]} weekly @param {string} key */
const series = (weekly, key) => (Array.isArray(weekly) ? weekly : []).map((w) => num(w?.[key])).filter((x) => x != null);

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

/**
 * One section's page view. `sec` is the export's section, or the fitness card
 * source; a missing or empty one gives `empty: true` and no numbers at all.
 * @param {string} name @param {any} sec @param {Date} [now]
 * @param {any[]} [outingNotables] outings notables (cinema/gig split here)
 */
export function buildSection(name, sec, now = new Date(), outingNotables = []) {
  const base = { name, href: SECTION_HREF(name), title: /** @type {any} */ (TITLES)[name] || name };
  if (!hasData(sec)) return { ...base, staleLabel: '', empty: true, headline: null, latest: null };
  const view = { ...base, staleLabel: staleLabel(sec.staleDays), updated: String(sec.updated || ''), empty: false, headline: headlineOf(sec.headline), latest: /** @type {any} */ (null) };
  const weekly = sec.weekly;
  switch (name) {
    case 'body': {
      const l = sec.latest || {};
      return {
        ...view,
        stats: [
          num(l.weightKg) != null && row('Weight', one(l.weightKg), 'kg'),
          num(l.bodyFatPct) != null && row('Body fat', one(l.bodyFatPct), '%'),
          num(l.restingHr) != null && row('Resting heart rate', group(l.restingHr), 'bpm'),
          num(l.hrvMs) != null && row('HRV', group(l.hrvMs), 'ms'),
        ].filter(Boolean),
        charts: [
          { key: 'weight', label: 'Weight', path: sparkPath(series(weekly, 'weightKg'), 240, 48) },
          { key: 'bodyFat', label: 'Body fat', path: sparkPath(series(weekly, 'bodyFatPct'), 240, 48) },
          { key: 'restingHr', label: 'Resting heart rate', path: sparkPath(series(weekly, 'restingHr'), 240, 48) },
          { key: 'hrv', label: 'HRV', path: sparkPath(series(weekly, 'hrvMs'), 240, 48) },
        ].filter((c) => c.path),
      };
    }
    case 'sleep':
      return {
        ...view,
        stats: [
          num(sec.avgMinutes30) != null && row('Last 30 nights', hm(sec.avgMinutes30)),
          num(sec.avgMinutes90) != null && row('Last 90 nights', hm(sec.avgMinutes90)),
          num(sec.consistencyMinutes) != null && row('Consistency', `±${group(sec.consistencyMinutes)}`, 'min'),
          sec.best?.date && num(sec.best.minutes) != null && { ...row('Best night', hm(sec.best.minutes)), sub: String(sec.best.date) },
          sec.worst?.date && num(sec.worst.minutes) != null && { ...row('Shortest night', hm(sec.worst.minutes)), sub: String(sec.worst.date) },
        ].filter(Boolean),
        charts: [{ key: 'sleep', label: 'Weekly average', path: sparkPath(series(weekly, 'avgMinutes'), 240, 48) }].filter((c) => c.path),
      };
    case 'food':
      return {
        ...view,
        stats: [
          num(sec.avgKcal30) != null && row('Energy, 30-day average', group(sec.avgKcal30), 'kcal'),
          num(sec.avgProteinG30) != null && row('Protein, 30-day average', group(sec.avgProteinG30), 'g'),
          num(sec.loggedStreakDays) != null && row('Logging streak', group(sec.loggedStreakDays), 'days'),
          num(sec.proteinStreakDays) != null && row('Protein target streak', group(sec.proteinStreakDays), 'days'),
        ].filter(Boolean),
        charts: [
          { key: 'kcal', label: 'Energy', path: sparkPath(series(weekly, 'avgKcal'), 240, 48) },
          { key: 'protein', label: 'Protein', path: sparkPath(series(weekly, 'avgProteinG'), 240, 48) },
        ].filter((c) => c.path),
      };
    case 'games': {
      const a = sec.achievements || {};
      const names = (/** @type {any} */ l) => (Array.isArray(l) ? l : typeof l === 'string' && l ? [l] : []).map((g) => (typeof g === 'string' ? { name: g, hours: null } : { name: String(g?.name || ''), hours: num(g?.hours) })).filter((g) => g.name);
      return {
        ...view,
        stats: [
          num(sec.hoursYear) != null && row('This year', group(sec.hoursYear), 'h'),
          num(sec.hoursTotal) != null && row('All time', group(sec.hoursTotal), 'h'),
          num(a.unlocked) != null && num(a.total) != null && row('Achievements', `${group(a.unlocked)} / ${group(a.total)}`),
          num(sec.backlog) != null && row('Backlog', group(sec.backlog), 'games'),
        ].filter(Boolean),
        mostPlayed: names(sec.mostPlayed), recent: names(sec.recent), serious: names(sec.serious), silly: names(sec.silly),
      };
    }
    case 'code': {
      const byYear = sec.languagesByYear || {};
      return {
        ...view,
        projects: (Array.isArray(sec.projects) ? sec.projects : []).map((p) => ({
          name: String(p?.name || ''), started: String(p?.started || ''), languages: Array.isArray(p?.languages) ? p.languages : [],
          url: typeof p?.url === 'string' && /^https:\/\//.test(p.url) ? p.url : '',
        })).filter((p) => p.name),
        languagesNow: Array.isArray(sec.languagesNow) ? sec.languagesNow : [],
        languagesByYear: Object.keys(byYear).sort().map((y) => ({
          year: y,
          languages: Object.entries(byYear[y] || {}).sort((a, b) => Number(b[1]) - Number(a[1]))
            .map(([lang, share]) => ({ name: lang, pct: Math.round(Number(share) * 10) / 10 })),
        })),
        commits: { months: (Array.isArray(sec.commitsByMonth) ? sec.commitsByMonth : []).map((m) => ({ month: String(m?.month || ''), n: num(m?.n) ?? 0 })),
          path: sparkPath((Array.isArray(sec.commitsByMonth) ? sec.commitsByMonth : []).map((m) => num(m?.n) ?? 0), 240, 48) },
      };
    }
    case 'watching': {
      const m = mediaView(sec, outingNotables.filter((n) => n.kind === 'cinema'));
      const y = m.totals.year, mo = m.totals.month;
      return { ...view, ...m, latest: latestOf(sec.notable),
        stats: [
          ['This year', y], ['This month', mo],
        ].map(([label, t]) => /** @type {any} */ (t) && Object.keys(/** @type {any} */ (t)).length ? ({
          label, // "watched", never "finished"
          items: [row('Films watched', group(num(t.films) ?? 0)), row('Episodes', group(num(t.episodes) ?? 0)), row('Videos', group(num(t.videos) ?? 0)), row('Hours', group(num(t.hours) ?? 0), 'h')],
        }) : null).filter(Boolean) };
    }
    case 'listening': {
      const m = mediaView(sec, outingNotables.filter((n) => n.kind === 'gig'));
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
  const stat = (/** @type {string} */ label) => {
    const r = (Array.isArray(v.stats) ? v.stats : []).find((x) => x && x.label === label);
    return r ? { label: r.label, value: r.unit ? `${r.value}${r.unit === '%' ? '' : ' '}${r.unit}` : String(r.value), href: '' } : null;
  };
  const latest = (/** @type {any} */ n) => (n && n.title ? { label: 'Latest', value: n.by ? `${n.title}, ${n.by}` : n.title, href: '' } : null);
  switch (name) {
    case 'body': return stat('Body fat') || stat('Resting heart rate');
    case 'sleep': return stat('Best night');
    case 'food': return stat('Energy, 30-day average');
    case 'games': return v.recent?.[0] ? { label: 'Recently', value: v.recent[0].name, href: '' } : null;
    case 'code': {
      const p = [...(v.projects || [])].sort((a, b) => b.started.localeCompare(a.started))[0];
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
function outingNotables(lifeIndex) {
  const o = lifeIndex?.sections?.outings;
  return Array.isArray(o?.notable) ? o.notable.filter((n) => n && n.title) : [];
}

/**
 * The hub: one card per section in order, then the outings list.
 * @param {any} lifeIndex @param {any} fitnessLife @param {Date} now
 */
export function buildHub(lifeIndex, fitnessLife, now = new Date()) {
  const sections = lifeIndex?.sections && typeof lifeIndex.sections === 'object' ? lifeIndex.sections : {};
  const outs = outingNotables(lifeIndex);
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
    outings: sortedNotables(outs).map((n) => ({ ...n, sawLabel: sawLabel(n.month) })),
  };
}

const BIT_LABELS = {
  'personal.height': 'Height', 'personal.likes': 'Likes', 'personal.boardgames': 'Board games', 'personal.desk': 'Desk',
  'body.weight_kg': 'Weight', 'games.serious': 'Serious games', 'games.silly': 'Silly games',
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

export function lifeHubTask(config = {}) {
  return {
    name: 'life-hub',
    title: 'Build the /life hub, section and personal-bits view models',
    config,
    run: async (/** @type {any} */ cfg, /** @type {any} */ ctx) => {
      const g = ctx.globals || {};
      const now = cfg.now instanceof Date ? cfg.now : new Date();
      const idx = g.lifeIndex || null;
      const outs = outingNotables(idx);
      const lifeSections = Object.fromEntries(
        SECTION_ORDER.filter((n) => n !== 'fitness').map((n) => [n, buildSection(n, idx?.sections?.[n], now, outs)]),
      );
      const lifeHub = buildHub(idx, g.fitnessLife, now);
      ctx.logger.info(`Life hub: ${lifeHub.cards.filter((c) => !c.empty).length}/${lifeHub.cards.length} sections have data`);
      return { lifeHub, lifeSections, lifePersonal: personalBits(idx?.facts), lifeFacts: lifeFacts(idx?.facts) };
    },
  };
}
