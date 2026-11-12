// @ts-check
/**
 * `/life/sessions` — every session on the record, newest first, filterable by type (F5.3,
 * redesigned with the roundups).
 *
 * Static pages, PAGE_SIZE sessions each, for "all" and for every type family present:
 *
 *   /life/sessions, /life/sessions/2, …              every session
 *   /life/sessions/<family>, /life/sessions/<family>/2, …   one family (run, ride, strength, …)
 *
 * Each page is a whole page on its own: the filter chips are plain links and a pager links
 * the neighbouring pages, so with JS off everything is reachable. With JS on, the page loads
 * the next page's HTML when its "older sessions" link scrolls into view
 * (IntersectionObserver) and appends its cards, stitching a month that was split across
 * the two pages, so the list grows as you scroll.
 *
 * Cards are drawn in their type's ink (fitness-types.css): the photo if there is one, else
 * the route, else the type word on a halftone. A session the roundups call out (a race, a
 * parkrun, a PB, a first: tasks/fitness-highlights.mjs) wears its stamp and gets a double
 * card. Months are dividers with their own numbers, type mix and a link to their roundup.
 *
 * The data task builds `fitnessSessionsPages` (one view per page); Skier's
 * generateDataPagesTask renders each with personal/templates/sessions.html (tasks/life-pages.mjs).
 */


import { buildCard, duration, filesBySlug, km, SESSIONS_HREF, TZ } from './fitness-life.mjs';
import { buildMoments } from './fitness-highlights.mjs';
import { TAGS } from './fitness-theme.mjs';

export const PAGE_SIZE = 60;

const num = (/** @type {unknown} */ v) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);

/** @param {Date} d */
function monthKey(d) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit' }).format(d);
}

/** @param {Date} d */
function monthTitle(d) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, month: 'long' }).format(d).toUpperCase();
}

/** The href of page `n` of a filter. @param {string} filter @param {number} n */
export function sessionsHref(filter, n) {
  const base = filter === 'all' ? SESSIONS_HREF : `${SESSIONS_HREF}/${filter}`;
  return n <= 1 ? base : `${base}/${n}`;
}

/**
 * Where a sessions page is written, relative to the output directory.
 * @param {string} href  from sessionsHref
 */
export function sessionsOutPath(href) {
  if (!/^\/life\/sessions(?:\/[a-z]+)?(?:\/\d+)?$/.test(href)) throw new Error(`not a sessions href: ${JSON.stringify(href)}`);
  return `${href.slice(1)}.html`.replace(/^\//, '');
}

/**
 * Every sessions page.
 * @param {{ activities: any[] }} index  index.json (activities, roundups)
 * @param {any[]} [files]  full activity files (routes, records, parkrun results)
 * @param {{ past?: any[] }} [opts]  past: events.json `past` (race names for the stamps)
 */
export function buildSessionPages(index, files = [], opts = {}) {
  const bySlug = filesBySlug(files);
  const entries = (Array.isArray(index?.activities) ? index.activities : [])
    .filter((e) => e && typeof e.slug === 'string')
    .map((e) => ({ e, t: Date.parse(e.startTime || '') }))
    .sort((a, b) => (Number.isNaN(b.t) ? 0 : b.t) - (Number.isNaN(a.t) ? 0 : a.t));

  // The stamp a session wears: its strongest moment.
  /** @type {Map<string, { stamp: string, score: number, title: string }>} */
  const marks = new Map();
  for (const m of buildMoments({ files, entries: entries.map((x) => x.e), past: opts.past || [] })) {
    for (const s of m.slugs) {
      const cur = marks.get(s);
      if (!cur || m.score > cur.score) marks.set(s, { stamp: m.stamp, score: m.score, title: m.kind === 'race' || m.kind === 'event' || m.kind === 'weekend' ? m.title : '' });
    }
  }
  const roundupKeys = new Set((Array.isArray(index?.roundups) ? index.roundups : []).map((r) => r?.key).filter(Boolean));

  const cards = entries.map(({ e, t }) => {
    const card = buildCard(e, bySlug.get(e.slug));
    const mark = marks.get(e.slug);
    const d = Number.isNaN(t) ? null : new Date(t);
    return {
      ...card,
      otherStats: card.stats.filter((x) => x !== card.keyStat).slice(0, 2),
      mark: mark?.stamp || '', markTitle: mark?.title && mark.title !== card.title ? mark.title : '',
      feature: Boolean(mark && mark.score >= 60),
      _month: d ? monthKey(d) : 'undated', _monthTitle: d ? monthTitle(d) : 'UNDATED', _year: d ? String(d.getUTCFullYear()) : '',
      _dur: num(e.durationSeconds), _dist: num(e.distanceMeters),
    };
  });

  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const c of cards) counts.set(c.typeKey, (counts.get(c.typeKey) || 0) + 1);
  const familyKeys = /** @type {(keyof typeof TAGS)[]} */ (Object.keys(TAGS)).filter((k) => counts.has(k));
  const filterList = ['all', ...familyKeys];

  const pages = [];
  for (const filter of filterList) {
    const list = filter === 'all' ? cards : cards.filter((c) => c.typeKey === filter);
    // Whole-month numbers for this filter, so a month split across pages says the same thing on both.
    /** @type {Map<string, { n: number, dur: number, dist: number, fam: Map<string, number> }>} */
    const monthStats = new Map();
    for (const c of list) {
      const s = monthStats.get(c._month) || { n: 0, dur: 0, dist: 0, fam: new Map() };
      s.n++;
      s.dur += c._dur;
      s.dist += c._dist;
      s.fam.set(c.typeKey, (s.fam.get(c.typeKey) || 0) + 1);
      monthStats.set(c._month, s);
    }
    const pageCount = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    for (let n = 1; n <= pageCount; n++) {
      const slice = list.slice((n - 1) * PAGE_SIZE, n * PAGE_SIZE);
      const months = [];
      for (const c of slice) {
        let m = months[months.length - 1];
        if (!m || m.key !== c._month) {
          const st = /** @type {any} */ (monthStats.get(c._month));
          const [y, mm] = c._month.split('-');
          const roundupKey = `month-${mm}-${y}`;
          m = {
            key: c._month, title: c._monthTitle, year: c._year,
            countLabel: `${st.n} session${st.n === 1 ? '' : 's'}`,
            stats: [duration(st.dur), st.dist > 500 ? `${km(st.dist)} km` : ''].filter(Boolean).join(' · '),
            stack: [...st.fam.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ typeClass: `fit-type--${k}`, pct: Math.round((v / st.n) * 1000) / 10, label: TAGS[/** @type {keyof typeof TAGS} */ (k)]?.label || k, n: v })),
            roundupHref: roundupKeys.has(roundupKey) ? `/life/roundup/${roundupKey}` : null,
            items: [],
          };
          months.push(m);
        }
        const { _month, _monthTitle, _year, _dur, _dist, ...card } = c;
        m.items.push(card);
      }
      const href = sessionsHref(filter, n);
      const label = filter === 'all' ? '' : TAGS[/** @type {keyof typeof TAGS} */ (filter)].label;
      pages.push({
        href,
        fitnessSessions: {
          filter, filterLabel: label, href,
          total: cards.length,
          totalLabel: `${cards.length.toLocaleString('en-GB')} session${cards.length === 1 ? '' : 's'}`,
          shownLabel: `${list.length.toLocaleString('en-GB')} ${label ? `${label.toLowerCase()} ` : ''}session${list.length === 1 ? '' : 's'}`,
          months,
          filters: filterList.map((k) => ({
            key: k, label: k === 'all' ? 'All' : TAGS[/** @type {keyof typeof TAGS} */ (k)].label,
            count: k === 'all' ? cards.length : counts.get(k), href: sessionsHref(k, 1), current: k === filter,
            typeClass: k === 'all' ? '' : `fit-type--${k}`,
          })),
          hasFilters: familyKeys.length > 1,
          // The key under the chips: every tag's colour and what goes in it.
          legend: (/** @type {(keyof typeof TAGS)[]} */ (Object.keys(TAGS))).map((k) => ({ key: k, label: TAGS[k].label, note: TAGS[k].note, typeClass: `fit-type--${k}` })),
          page: n, pageCount, isFirst: n === 1,
          prevHref: n > 1 ? sessionsHref(filter, n - 1) : null,
          nextHref: n < pageCount ? sessionsHref(filter, n + 1) : null,
          pager: pageCount > 1 ? Array.from({ length: pageCount }, (_, i) => ({ n: i + 1, href: sessionsHref(filter, i + 1), current: i + 1 === n })) : [],
        },
      });
    }
  }
  return pages;
}

/**
 * The data task: `fitnessSessionsPages`, one view per sessions page (rendered by Skier's
 * generateDataPagesTask from personal/templates/sessions.html; see tasks/life-pages.mjs).
 * After fetch-fitness.
 */
export function fitnessSessionsViewTask() {
  return {
    name: 'fitness-sessions-view',
    title: 'Build the /life/sessions pages (every session, by type, a page at a time)',
    config: {},
    run: async (/** @type {any} */ _cfg, /** @type {any} */ ctx) => {
      const g = ctx.globals || {};
      const built = buildSessionPages(g.fitnessIndex, Array.isArray(g.fitnessActivities) ? g.fitnessActivities : [], { past: g.fitnessEvents?.past });
      const siteUrl = String(g.siteUrl || '').replace(/\/+$/, '');
      const fitnessSessionsPages = built.map(({ href, fitnessSessions: s }) => ({
        page: 'life',
        subpage: `| sessions${s.filterLabel ? ` | ${s.filterLabel.toLowerCase()}` : ''}${s.page > 1 ? ` | page ${s.page}` : ''}`,
        description: s.filterLabel
          ? `Every ${s.filterLabel.toLowerCase()} session on the record — ${s.shownLabel}, newest first.`
          : `Every training session on the record — ${s.totalLabel}, newest first.`,
        canonical: siteUrl ? `${siteUrl}${href}` : '',
        fitnessSessions: s,
        fitnessUnavailable: Boolean(g.fitnessUnavailable),
      }));
      const first = built[0]?.fitnessSessions;
      ctx.logger.info(`Sessions view: ${first?.total ?? 0} sessions on ${fitnessSessionsPages.length} pages, ${(first?.filters.length ?? 1) - 1} types`);
      return { fitnessSessionsPages };
    },
  };
}

