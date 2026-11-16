// @ts-check
/**
 * Life in <year>: the annual scrapbook, /life/annual/<YYYY>, and its taped-in cover on /life.
 *
 * Lifehub publishes life/annual-<year>.json (days, moments, highlight picks, collage lists,
 * firsts, connections, hours, totals, the letter). This merges it with the FitGlue sessions
 * for the fitness side: the session days on the cover, photos, and James's own words as
 * captions. Every string comes from the doc or the fitness files.
 *
 *   cover       the year's day grid (tasks/year-days.mjs), each day in what it was mostly about,
 *               plus the headline numbers
 *   months      twelve spreads: the highlight, polaroids, ticket stubs, captions, margin notes
 *   collages    shelf, mixtape, telly, games, medals; placed between months (`placements`)
 *   firsts, hours, fitness, letter
 *   linkCover   the /life cover: large through January (and on a preview), then a slim strip
 */
import { tagOf, tagTheme } from './fitness-theme.mjs';
import { athleteWords } from './fitness-words.mjs';
import { cleanTitle } from './fitness-year-races.mjs';
import { rand } from './fitness-year-review.mjs';
import { storyContext } from './fitness-roundup-story.mjs';
import { ymd } from './life-clock.mjs';
import { dayGrid } from './year-days.mjs';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MON = MONTH_NAMES.map((m) => m.slice(0, 3));
/** Life kinds on the cover, after race, live and a fitness session, in priority order. */
const LIFE_INKS = /** @type {const} */ ([['live', 'live'], ['book', 'reading'], ['gaming', 'games'], ['code', 'code'], ['screen', 'watching']]);
const INK = Object.fromEntries(LIFE_INKS.map(([k, ink]) => [k, `life-ink--${ink}`]));
/** Each collage goes after this month (01–12). */
const PLACEMENT = /** @type {const} */ ([['shelf', 3], ['mixtape', 6], ['telly', 8], ['games', 10], ['medals', 12]]);
const COLLAGE_MIN = 3;
const POLAROIDS = 6;
const CAPTIONS = 3;
const CAPTION_CHARS = 140;
const HOURS = ['reading', 'listening', 'watching', 'playing', 'training'];
const COVER_NUMBERS = ['live', 'books', 'films', 'series', 'artists', 'gameHours', 'sessions', 'races', 'commits'];

const num = (/** @type {unknown} */ v) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);
const https = (/** @type {unknown} */ u) => (typeof u === 'string' && /^https:\/\//i.test(u) ? u : '');
const str = (/** @type {unknown} */ s) => (typeof s === 'string' ? s : '');
const arr = (/** @type {unknown} */ a) => (Array.isArray(a) ? a : []);
const round = (/** @type {number} */ v, d = 1) => Math.round(v * 10 ** d) / 10 ** d;
const tilt = (/** @type {string} */ s, spread = 5) => round((rand(s) - 0.5) * spread, 2);
/** `2026-03-09` → `9 Mar` @param {string} day */
const dayLabel = (day) => { const [, m, d] = day.split('-').map(Number); return m && d ? `${d} ${MON[m - 1]}` : ''; };
/** `2026-11-30` → `30 November 2026` @param {string} day */
const longDay = (day) => { const [y, m, d] = day.split('-').map(Number); return y && m && d ? `${d} ${MONTH_NAMES[m - 1]} ${y}` : day; };
const monthAnchor = (/** @type {string} */ key) => `m-${key}`;
const hrefOf = (/** @type {string} */ slug) => `/life/activity/${slug}`;

/**
 * Text cut to `max` characters at a word boundary, an ellipsis marking the cut.
 * @param {string} s @param {number} max
 */
export function trimWords(s, max) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const at = cut.lastIndexOf(' ');
  return `${(at > max / 2 ? cut.slice(0, at) : cut.slice(0, max - 1)).replace(/[\s,;:–—-]+$/, '')}…`;
}

/** James's own words on a session, trimmed for a caption. @param {any} file */
const captionOf = (file) => trimWords(athleteWords(str(file?.activity?.description)), CAPTION_CHARS);

/**
 * @param {any} doc  a validated life/annual-<year>.json
 * @param {{ list: { e: any, t: number }[], files: Map<string, any>, keys?: Set<string>, showPhotos: boolean }} ctx  storyContext
 * @param {{ now?: number }} [opts]
 */
export function buildLifeAnnual(doc, ctx, opts = {}) {
  const year = num(doc.year);
  const through = str(doc.through) || `${year}-12-31`;
  const now = opts.now ?? Date.now();
  const moments = arr(doc.moments).filter((m) => m && typeof m.id === 'string');
  const momentById = new Map(moments.map((m) => [m.id, m]));
  const photoOf = (/** @type {any} */ e) => (ctx.showPhotos ? https(e?.photoUrls?.[0]) : '');

  // The year's sessions, up to `through`, by site-timezone day.
  const sessions = ctx.list
    .map((x) => ({ ...x, day: ymd(new Date(x.t)) }))
    .filter((x) => x.day.startsWith(`${year}-`) && x.day <= through);
  /** @type {Map<string, typeof sessions>} */
  const byDay = new Map();
  for (const x of sessions) byDay.set(x.day, [...(byDay.get(x.day) || []), x]);
  const typeClassOf = (/** @type {any} */ e) => tagTheme(tagOf(e).tag).typeClass;
  const entryBySlug = new Map(ctx.list.map((x) => [x.e.slug, x.e]));

  // ---- cover -----------------------------------------------------------------------
  const days = dayGrid(year, (day) => {
    const here = byDay.get(day) || [];
    const kinds = new Set(arr(doc.days?.[day]));
    const race = here.find((x) => x.e.isRace);
    const main = [...here].sort((a, b) => num(b.e.durationSeconds) - num(a.e.durationSeconds))[0];
    const life = LIFE_INKS.find(([k]) => kinds.has(k));
    const ink = race ? typeClassOf(race.e)
      : kinds.has('live') ? INK.live
        : main ? typeClassOf(main.e)
          : life ? INK[life[0]] : '';
    const titles = [...here.map((x) => cleanTitle(x.e.title)), ...moments.filter((m) => m.day === day && m.kind !== 'fitness').map((m) => str(m.title))].filter(Boolean);
    return {
      ink, race: Boolean(race), rest: !ink && day <= through, href: `#${monthAnchor(day.slice(0, 7))}`,
      title: [dayLabel(day), ...titles].join(' · '),
    };
  }, through);
  const totals = doc.totals || {};
  const cover = {
    year,
    numbers: COVER_NUMBERS.filter((k) => num(totals[k]) > 0).map((k) => ({ key: k, value: num(totals[k]) })),
    days,
  };

  // ---- months ----------------------------------------------------------------------
  /** A doc moment, with a fitness one filled from its activity file. @param {any} m */
  const momentView = (m) => {
    const base = {
      id: m.id, kind: str(m.kind), title: str(m.title), sub: str(m.sub), photo: ctx.showPhotos || m.kind !== 'fitness' ? https(m.image) : '',
      href: str(m.href), day: str(m.day), dayLabel: dayLabel(str(m.day)), venue: str(m.venue), race: Boolean(m.race), first: Boolean(m.first),
      caption: '', typeClass: INK[m.kind] || '', tilt: tilt(String(m.id)),
    };
    if (m.kind !== 'fitness') return base;
    const slug = String(m.id).replace(/^fitness:/, '');
    const file = ctx.files.get(slug);
    // lifehub's fitness moments carry no title: it comes from the activity file, else the index entry
    if (!file) {
      const entry = entryBySlug.get(slug);
      if (!entry) return base;
      return { ...base, title: cleanTitle(entry.title) || base.title, photo: photoOf(entry) || base.photo, href: hrefOf(slug), typeClass: typeClassOf(entry) };
    }
    const e = file.entry || {};
    return {
      ...base, title: cleanTitle(e.title || file.activity?.title) || base.title, photo: photoOf(e) || base.photo,
      href: hrefOf(slug), caption: captionOf(file), typeClass: typeClassOf(file),
    };
  };

  const months = MONTH_NAMES.map((label, i) => {
    const key = `${year}-${String(i + 1).padStart(2, '0')}`;
    const pick = doc.highlights?.[key]?.pick;
    const picked = typeof pick === 'string' ? momentById.get(pick) : undefined;
    const highlight = picked ? momentView(picked) : null;
    const inMonth = sessions.filter((x) => x.day.startsWith(key));
    const score = (/** @type {any} */ x) => num(momentById.get(`fitness:${x.e.slug}`)?.score);
    const highSlug = picked?.kind === 'fitness' ? String(picked.id).replace(/^fitness:/, '') : '';
    // The month's photos: races and the doc's best moments first, then the rest; shown in day order.
    const withPhoto = inMonth.filter((x) => x.e.slug !== highSlug && photoOf(x.e) && photoOf(x.e) !== highlight?.photo);
    const chosen = [...withPhoto].sort((a, b) => Number(Boolean(b.e.isRace)) - Number(Boolean(a.e.isRace)) || score(b) - score(a) || a.t - b.t).slice(0, POLAROIDS);
    const polaroids = withPhoto.filter((x) => chosen.includes(x)).map((x) => ({
      photo: photoOf(x.e), title: cleanTitle(x.e.title), href: hrefOf(x.e.slug), day: x.day, dayLabel: dayLabel(x.day),
      typeClass: typeClassOf(x.e), race: Boolean(x.e.isRace), tilt: tilt(x.e.slug),
    }));
    const captions = [...chosen, ...inMonth.filter((x) => !chosen.includes(x)).sort((a, b) => score(b) - score(a))]
      .filter((x) => x.e.slug !== highSlug)
      .map((x) => ({ text: captionOf(ctx.files.get(x.e.slug)), title: cleanTitle(x.e.title), href: hrefOf(x.e.slug), dayLabel: dayLabel(x.day) }))
      .filter((c) => c.text).slice(0, CAPTIONS);
    const stubs = moments.filter((m) => m.kind === 'live' && m.month === key && m.id !== pick && str(m.day) <= through)
      .sort((a, b) => str(a.day).localeCompare(str(b.day))).map(momentView);
    const notes = arr(doc.connections).filter((c) => c?.month === key && str(c.text))
      .map((c) => ({ text: str(c.text), kind: str(c.kind), by: str(c.by), tilt: tilt(str(c.text), 4) }));
    return { key, label, anchor: monthAnchor(key), highlight, polaroids, stubs, captions, notes, empty: !highlight, after: /** @type {any[]} */ ([]) };
  });

  // ---- collages --------------------------------------------------------------------
  const col = doc.collage || {};
  const races = sessions.filter((x) => x.e.isRace).map((x) => ({
    title: cleanTitle(x.e.title), day: x.day, dayLabel: dayLabel(x.day), href: hrefOf(x.e.slug),
    family: tagOf(x.e).tag, typeClass: typeClassOf(x.e), tilt: tilt(x.e.slug, 8),
  }));
  const tilted = (/** @type {any[]} */ items) => items.map((it) => ({ ...it, tilt: tilt(str(it.title) || str(it.name), 6) }));
  /** @type {Record<string, { items: any[], minutes?: number } | null>} */
  const collages = {
    shelf: { items: tilted(arr(col.shelf)) },
    mixtape: { items: arr(col.mixtape?.artists).map((a, i) => ({ ...a, n: i + 1 })), minutes: num(col.mixtape?.minutes) },
    telly: { items: tilted(arr(col.telly)) },
    games: { items: tilted(arr(col.games)) },
    medals: { items: races },
  };
  for (const k of Object.keys(collages)) if ((collages[k]?.items.length || 0) < COLLAGE_MIN) collages[k] = null;
  const placements = [];
  for (const [k, m] of PLACEMENT) {
    if (!collages[k]) continue;
    const after = months[m - 1].key;
    placements.push({ after, key: k });
    months[m - 1].after.push({ key: k, ...collages[k] });
  }

  // ---- firsts, hours, fitness, letter ----------------------------------------------
  const firsts = arr(doc.firsts).filter((f) => f && str(f.text) && str(f.day) <= through)
    .sort((a, b) => str(a.day).localeCompare(str(b.day)))
    .map((f) => ({ id: str(f.id), kind: str(f.kind), text: str(f.text), day: str(f.day), dayLabel: dayLabel(str(f.day)), venue: str(f.venue), momentId: str(f.momentId), href: `#${monthAnchor(str(f.day).slice(0, 7))}` }));

  const h = doc.hours || {};
  const hourTotal = HOURS.reduce((s, k) => s + Math.max(0, num(h[k])), 0);
  const hours = hourTotal > 0 ? {
    total: hourTotal,
    segments: HOURS.filter((k) => num(h[k]) > 0).map((k) => ({ key: k, hours: num(h[k]), share: `${round((num(h[k]) / hourTotal) * 100, 1)}%` })),
    commits: num(h.commits),
  } : null;

  const fitMoments = moments.filter((m) => m.kind === 'fitness' && str(m.day) <= through).sort((a, b) => num(b.score) - num(a.score));
  const bestPhoto = fitMoments.map((m) => momentView(m).photo).find(Boolean)
    || sessions.filter((x) => x.e.isRace).map((x) => photoOf(x.e)).find(Boolean)
    || sessions.map((x) => photoOf(x.e)).find(Boolean) || '';
  const trained = Math.round(sessions.reduce((s, x) => s + num(x.e.durationSeconds), 0) / 3600);
  const fitness = sessions.length ? {
    photo: bestPhoto,
    numbers: [
      { key: 'sessions', value: num(totals.sessions) || sessions.length },
      { key: 'hours', value: num(h.training) || trained },
      { key: 'races', value: races.length },
    ],
    href: ctx.keys?.has(`year-${year}`) ? `/life/roundup/year-${year}` : '',
  } : null;

  const letter = doc.letter && typeof doc.letter === 'object'
    ? { ...doc.letter, to: year + 1, lines: arr(doc.letter.lines), predictions: arr(doc.letter.predictions), draft: !doc.letter.approved } : null;
  const lastLetter = doc.lastLetter && typeof doc.lastLetter === 'object' ? { predictions: arr(doc.lastLetter.predictions) } : null;

  // ---- the /life cover -------------------------------------------------------------
  const large = Boolean(doc.preview) || ymd(new Date(now)).startsWith(`${year + 1}-01`);
  const linkCover = {
    year, href: `/life/annual/${year}`, size: large ? 'large' : 'slim',
    thumbs: days.cols.map((c) => c.cells.map((/** @type {any} */ d) => ({ ink: d.ink || '', race: Boolean(d.race), blank: Boolean(d.blank) }))),
  };

  return {
    year, through, throughLabel: longDay(through), final: Boolean(doc.final), preview: Boolean(doc.preview), url: `/life/annual/${year}`,
    cover, months, collages, placements, firsts, hours, fitness, letter, lastLetter, linkCover,
  };
}

/** @param {unknown} e */
const errMsg = (e) => (e instanceof Error ? e.message : String(e));

/**
 * Builds the annual pages and the /life covers from `lifeAnnuals` (after fetch-fitness).
 * Only a final doc, or the local preview, gets a page; covers are newest first.
 */
export function lifeAnnualTask() {
  return {
    name: 'life-annual',
    title: 'Build the /life/annual/<YYYY> view models and the /life covers from lifeAnnuals',
    config: {},
    run: async (/** @type {any} */ _cfg, /** @type {any} */ ctx) => {
      const g = ctx.globals;
      const index = g.fitnessIndex || {};
      const docs = Object.values(g.lifeAnnuals || {}).filter((d) => d && (d.final || d.preview))
        .sort((a, b) => num(a.year) - num(b.year));
      const lifeAnnualPages = [];
      if (docs.length) {
        const story = storyContext({
          files: arr(g.fitnessActivities),
          entries: arr(index.activities),
          roundupFiles: arr(g.fitnessRoundups),
          showPhotos: Boolean(index.profile?.showPhotoGallery),
        });
        const siteUrl = String(g.siteUrl || '').replace(/\/+$/, '');
        for (const doc of docs) {
          try {
            const view = buildLifeAnnual(doc, story);
            lifeAnnualPages.push({
              page: 'life', subpage: `| life in ${view.year}`, annual: view, canonical: siteUrl ? `${siteUrl}${view.url}` : '',
              description: `Life in ${view.year}: the year in photos, ticket stubs, books, music, films, games and races, month by month.`,
            });
          } catch (e) {
            ctx.logger.error(`annual ${doc.year}: ${errMsg(e)}`);
          }
        }
      }
      const lifeAnnualCovers = [...lifeAnnualPages].reverse().map((p) => p.annual.linkCover);
      ctx.logger.info(`Life annuals: ${lifeAnnualPages.length} pages`);
      return { lifeAnnualPages, lifeAnnualCovers };
    },
  };
}
