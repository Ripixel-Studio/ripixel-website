// @ts-check
/**
 * Relations across the /life pages (jarvis lifehub crossrel). Data only; the templates draw:
 *
 *   afterShowView(live)        /life/live "after the show": the nights out that turn up on another page. A stub,
 *                              and beside it what happened next: an artist's plays a month across the whole
 *                              record with the night punched into it, or the film, show, channel or book.
 *   encoresView(live)          /life/live "encore": the acts and shows seen more than once, stubs stapled together.
 *   connectsView(connects)     the hub's corkboard: the genres that run through several pages (each as a share of
 *                              its own page) and the threads, one title pinned on two or more pages.
 *
 * Every input is the export, checked here: unknown pages, odd months and non-https pictures drop out.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
/** Each page's name, address and ink (life.css `life-ink--<page>`). */
export const PAGES = /** @type {Record<string, {name: string, href: string}>} */ ({
  watching: { name: 'Watching', href: '/life/watching' },
  listening: { name: 'Listening', href: '/life/listening' },
  reading: { name: 'Reading', href: '/life/reading' },
  games: { name: 'Games', href: '/life/games' },
  live: { name: 'Live', href: '/life/live' },
});
const FORMS = /** @type {Record<string, string>} */ ({
  gig: 'Gig', musical: 'Musical', theatre: 'Theatre', comedy: 'Comedy', festival: 'Festival', classical: 'Classical', other: 'Other',
});
const OF = /** @type {Record<string, string>} */ ({
  watching: 'films and shows', games: 'games', reading: 'books', live: 'nights out',
});

/** @param {unknown} s */
const str = (s) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '');
/** @param {unknown} n */
const int = (n) => (typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.round(n) : null);
/** @param {unknown} s */
const art = (s) => (typeof s === 'string' && /^https:\/\/[^\s"'<>\\]+$/.test(s) ? s : '');
/** @param {unknown} m */
export const monthOf = (m) => (typeof m === 'string' && MONTH.test(m) ? m : '');
/** 'Mar 2016'. @param {string} m */
export const stamp = (m) => (m ? `${MONTHS[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}` : '');
const group = (/** @type {number} */ n) => n.toLocaleString('en-GB');
const plays = (/** @type {number} */ n) => `${group(n)} ${n === 1 ? 'play' : 'plays'}`;
const form = (/** @type {unknown} */ f) => (FORMS[String(f)] ? String(f) : 'other');
/** The months from `a` to `b` inclusive. @param {string} a @param {string} b */
const span = (a, b) => (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(5, 7) - +a.slice(5, 7)) + 1;

/**
 * What seeing them did to the plays, said plainly. `before` is null when the night was before the record starts.
 * @param {{name: string, plays: number, before: number|null, during: number, after: number, from: string}} p
 */
export function playsLine(p) {
  const { name, before, during, after } = p;
  if (before === null) return `Seen before the plays were counted (from ${stamp(p.from)}). ${plays(during + after)} of ${name} since.`;
  if (before === 0 && during + after > 0) return `Never played before the night. ${plays(during + after)} since.`;
  if (during + after === 0) return `${plays(before)} before the night. Not one since.`;
  if (during >= 5 && during * 4 >= before + after) return `${plays(during)} the month I went, ${group(before)} before, ${group(after)} since.`;
  return `${plays(before)} before the night, ${group(after)} since.`;
}

/**
 * The plays a month as columns, the night as a punched mark. Null without a usable series.
 * @param {number[]} months @param {string} from @param {string} night
 */
export function playsStrip(months, from, night) {
  const n = months.length;
  if (n < 2 || !from) return null;
  const top = Math.max(...months, 1);
  const W = 3, H = 44;
  const bars = months.map((v, i) => (v > 0 ? { x: i * W, y: +(H - Math.max(2, (v / top) * H)).toFixed(1), w: W - 1, h: 0 } : null))
    .filter(Boolean).map((b) => ({ .../** @type {any} */ (b), h: +(H - /** @type {any} */ (b).y).toFixed(1) }));
  const at = span(from, night) - 1;               // the night's column; before the record, the left edge
  return { width: n * W, height: H, bars, mark: Math.max(0, at) * W + 1, early: at < 0, peak: top, from: stamp(from) };
}

/** @param {any} l a link to another page @param {string} from the plays' first month @param {string} night */
function linkView(l, from, night) {
  const page = String(l?.page || '');
  if (!PAGES[page]) return null;
  const title = str(l.title);
  const base = { page, href: PAGES[page].href, pageName: PAGES[page].name, art: art(l.art), title };
  if (page === 'listening' && l.kind === 'artist') {
    const months = Array.isArray(l.months) ? l.months.map((x) => int(x) ?? 0) : [];
    const p = { name: title, plays: int(l.plays) ?? 0, before: l.before === null ? null : int(l.before) ?? 0, during: int(l.during) ?? 0, after: int(l.after) ?? 0, from };
    if (!title || !p.plays) return null;
    return { ...base, music: true, plays: p.plays, line: playsLine(p), strip: playsStrip(months, from, night), total: plays(p.plays) };
  }
  if (!title) return null;
  if (page === 'watching') {
    const what = l.kind === 'channel' ? `${title}'s channel, on the Watching page` : l.kind === 'series' ? `${title}, on the rental wall` : `${title}, the film, on the rental wall`;
    return { ...base, line: what };
  }
  if (page === 'reading') {
    const by = str(l.by);   // "Peter Kay's Diary, Peter Kay" says it twice
    return { ...base, line: `${title}${by && !title.toLowerCase().replace(/[’']/g, '').includes(by.toLowerCase()) ? `, ${by}` : ''}, on the bookshelf` };
  }
  return null;
}

/** @param {any} live the export's live section */
export function afterShowView(live) {
  const sp = live?.playsSpan;
  const from = monthOf(sp?.from);
  const rows = (Array.isArray(live?.afterShow) ? live.afterShow : []).map((/** @type {any} */ r) => {
    const month = monthOf(r?.month);
    const title = str(r?.title);
    if (!month || !title) return null;
    const links = (Array.isArray(r.elsewhere) ? r.elsewhere : []).map((/** @type {any} */ l) => linkView(l, from, month)).filter(Boolean);
    if (!links.length) return null;
    const k = form(r.form);
    const most = Math.max(0, ...links.map((/** @type {any} */ l) => l.plays || 0));
    return { title, month, stamp: stamp(month), kind: k, kindLabel: FORMS[k], art: art(r.art), hasArt: Boolean(art(r.art)), links,
      music: links.some((/** @type {any} */ l) => l.music), most };
  }).filter(Boolean);
  // the music first, most played first (the plays tell the story), then the rest newest first
  return /** @type {any[]} */ (rows).sort((a, b) => Number(b.music) - Number(a.music) || b.most - a.most || b.month.localeCompare(a.month));
}

/** @param {any} live */
export function encoresView(live) {
  return (Array.isArray(live?.encores) ? live.encores : []).map((/** @type {any} */ e) => {
    const nights = (Array.isArray(e?.nights) ? e.nights : []).map((/** @type {any} */ n) => {
      const month = monthOf(n?.month);
      const k = form(n?.form);
      return month && str(n?.title) ? { title: str(n.title), stamp: stamp(month), kind: k, kindLabel: FORMS[k], art: art(n.art), hasArt: Boolean(art(n.art)) } : null;
    }).filter(Boolean);
    return nights.length > 1 && str(e.title) ? { title: str(e.title), times: nights.length === 2 ? 'Twice' : `${nights.length} times`, nights } : null;
  }).filter(Boolean);
}

/** One pinned card in a thread: the page, the picture and what it says there. @param {any} l */
function threadCard(l) {
  const page = String(l?.page || '');
  if (!PAGES[page]) return null;
  const title = str(l.title);
  const month = monthOf(l.month);
  let say = '';
  if (page === 'games') say = int(l.hours) ? `${group(/** @type {number} */ (int(l.hours)))} hours played` : 'on the games shelf';
  else if (page === 'listening') say = int(l.plays) ? (l.kind === 'soundtrack' ? `${plays(/** @type {number} */ (int(l.plays)))} of the soundtrack` : plays(/** @type {number} */ (int(l.plays)))) : 'on the deck';
  else if (page === 'watching') say = l.kind === 'channel' ? 'watched on YouTube' : month ? `watched ${stamp(month)}${l.bigScreen ? ', big screen' : ''}` : 'on the rental wall';
  else if (page === 'reading') say = 'read it';
  else if (page === 'live') say = month ? `seen live ${stamp(month)}` : 'seen live';
  return { page, pageName: PAGES[page].name, href: PAGES[page].href, art: art(l.art), title, say };
}

/** @param {any} connects the export's top-level connects */
export function connectsView(connects) {
  const genres = (Array.isArray(connects?.genres) ? connects.genres : []).map((/** @type {any} */ g) => {
    const shelves = (Array.isArray(g?.shelves) ? g.shelves : []).map((/** @type {any} */ s) => {
      const page = String(s?.page || '');
      const n = int(s?.n), of = int(s?.of);
      if (!PAGES[page] || !OF[page] || !n || !of || n > of) return null;
      return { page, pageName: PAGES[page].name, href: PAGES[page].href, n: group(n), of: group(of), what: OF[page],
        share: Math.round((100 * n) / of), eg: str(s.eg) };
    }).filter(Boolean);
    return shelves.length >= 2 && str(g.genre) ? { genre: str(g.genre), shelves } : null;
  }).filter(Boolean);
  const threads = (Array.isArray(connects?.threads) ? connects.threads : []).map((/** @type {any} */ t) => {
    const cards = (Array.isArray(t?.elsewhere) ? t.elsewhere : []).map(threadCard).filter(Boolean);
    return cards.length >= 2 && str(t.title) ? { title: str(t.title), cards } : null;
  }).filter(Boolean);
  return genres.length || threads.length ? { genres, threads } : null;
}
