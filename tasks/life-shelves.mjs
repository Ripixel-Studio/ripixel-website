/**
 * /life/reading and /life/listening as things to look at, not lists (2026-11-07).
 *
 * Reading: the shelf (a plank per year, a spine per finished audiobook cut from its own
 * cover), the books on the go, authors and series as fanned covers, the year in hours,
 * and a few odd facts on index cards. Listening: the chart (top artists), the crate (CD
 * jewel cases), the loves poster (artist names set by how many of their songs I liked),
 * the mixtape (latest likes on a cassette J-card) and the months in my ears.
 *
 * The export (jarvis lifehub/shelves.py) does the counting and the privacy screening;
 * this only shapes rows for the templates. Images are hotlinked from the hosts below only.
 */

import { readingRelView, readingRelFacts } from './reading-rel.mjs';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Audible covers, YouTube Music art and artist photos, video stills. */
const ART = /^https:\/\/(m\.media-amazon\.com\/images\/I\/|yt3\.googleusercontent\.com\/|lh3\.googleusercontent\.com\/|yt3\.ggpht\.com\/|i\.ytimg\.com\/vi\/|assets\.hardcover\.app\/(?:editions?|external_data|books)\/)[A-Za-z0-9._~%/+=-]*$/;
/** @param {unknown} u */
// podcast covers: YouTube's are signed and expire within a day, so the export hosts a copy, named by its hash
const PODCAST_ART = /^https:\/\/storage\.googleapis\.com\/fitglue-server-prod-showcase-assets\/site\/james\/life\/podcasts\/[0-9a-f]{16}\.jpg$/;
/**
 * A picture James chose himself (the box's Needs-you "Pictures for the site", jarvis lifehub/art.py):
 * any row's poster, cover or photo where nothing was found, re-encoded and hosted by its hash.
 */
export const OWN_ART = /^https:\/\/storage\.googleapis\.com\/fitglue-server-prod-showcase-assets\/site\/james\/life\/art\/[0-9a-f]{16}\.jpg$/;
export const shelfArt = (u) => (typeof u === 'string' && (ART.test(u) || PODCAST_ART.test(u) || OWN_ART.test(u)) ? u : '');

const num = (/** @type {unknown} */ n) => (typeof n === 'number' && Number.isFinite(n) ? n : null);
const group = (/** @type {number} */ n) => Math.round(n).toLocaleString('en-GB');
const str = (/** @type {unknown} */ s) => (typeof s === 'string' ? s.trim() : '');
const list = (/** @type {unknown} */ a) => (Array.isArray(a) ? a.filter((x) => x && typeof x === 'object') : []);
const plural = (/** @type {number} */ n, /** @type {string} */ a, /** @type {string} */ b) => `${group(n)} ${n === 1 ? a : b}`;
/** @param {string} s */
const hash = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const monthOf = (/** @type {unknown} */ m) => (/^\d{4}-(0[1-9]|1[0-2])$/.test(String(m)) ? `${MONTHS[+String(m).slice(5) - 1]} ${String(m).slice(0, 4)}` : '');
const hoursLabel = (/** @type {unknown} */ h) => {
  const v = num(h);
  return v == null || v <= 0 ? '' : `${v < 10 ? v.toFixed(1) : group(v)} h`;
};
/** "Spiral Wars 4" / "Culture" (no number) / "". @param {any} b */
const seriesLabel = (b) => (str(b.series) ? `${str(b.series)}${str(b.seq) ? ` ${str(b.seq)}` : ''}` : '');
/** "The Final Empire (Mistborn, Book 1)" keeps its words but loses the brackets on a spine. @param {string} t */
const spineTitle = (t) => t.replace(/\s*\(Part (\d+) of \d+\)/gi, ' pt $1').replace(/\s*\((?:Dramati[sz]ed Adaptation|Unabridged)\)\s*/gi, ' ').replace(/\s*\[[^\]]*\]\s*/g, ' ').replace(/\s+/g, ' ').trim();

/** @param {unknown} a @param {number} max */
const arts = (a, max) => (Array.isArray(a) ? a : []).map(shelfArt).filter(Boolean).slice(0, max).map((src, n) => ({ src, n }));

// ─── reading ───

/** "audio" (an audiobook: square art) or "print" (a book: book-shaped). @param {any} b */
const formatOf = (b) => (b && (b.format === 'print' || b.format === 'ebook') ? 'print' : 'audio');
/** "Mar 2021", or "2018" for a book known only to the year it was read (Hardcover). @param {unknown} f */
const finishedLabel = (f) => monthOf(f) || (/^\d{4}$/.test(String(f)) ? String(f) : '');
/** "459 pages" for a book on paper. @param {unknown} p */
const pagesLabel = (p) => (num(p) ? `${group(/** @type {number} */ (num(p)))} pages` : '');
/** How long a book is, in its own unit: hours for an audiobook, pages for a book on paper. @param {any} b */
const lengthLabel = (b) => (formatOf(b) === 'print' ? pagesLabel(b.pages) || hoursLabel(b.hours) : hoursLabel(b.hours));
/** How many times a book was finished, when it was more than once. @param {any} b */
const timesOf = (b) => Math.max(2, num(b.reads) ?? 2);

// The spine's type has to carry the whole title: Anton is condensed, about this wide a
// character for its size, and the spine gives it SPINE_TEXT of its height (the rest is the
// author and the format mark). Checked against the rendered page (scrollHeight per spine).
const CHAR_EM = 0.47;
const SPINE_SHELF = 198;            // the shelf's inner height on a desktop, px (--shelf-h less the plank)
const SPINE_FOOT = 58;              // padding, the author, the format mark
const FONT_MAX = 17;
const FONT_MIN = 9;

/** Lines a greedy word wrap needs, or Infinity when a word will not fit a line. @param {string} t @param {number} cap */
function wrapLines(t, cap) {
  let lines = 1;
  let used = 0;
  for (const w of t.split(' ')) {
    if (w.length > cap) return Infinity;
    if (!used) used = w.length;
    else if (used + 1 + w.length <= cap) used += 1 + w.length;
    else { lines += 1; used = w.length; }
  }
  return lines;
}

/**
 * The biggest type that sets the whole title on the spine, wrapping into columns across its
 * width; a title too long for that at the smallest size widens the spine instead.
 * @param {string} t @param {number} width @param {number} height percent of the shelf
 */
export function fitSpine(t, width, height) {
  const len = (SPINE_SHELF * height) / 100 - SPINE_FOOT;
  for (let f = FONT_MAX; f >= FONT_MIN; f -= 0.5) {
    const cols = Math.max(1, Math.floor((width - 8) / (f * 1.05)));
    if (wrapLines(t, Math.floor(len / (f * CHAR_EM))) <= cols) return { font: f, width };
  }
  const need = wrapLines(t, Math.floor(len / (FONT_MIN * CHAR_EM)));
  return { font: FONT_MIN, width: Math.ceil(need * FONT_MIN * 1.05 + 9) };
}

/** @param {any} b @param {number} i */
function spine(b, i) {
  const title = str(b.title);
  // a book on paper is as thick as its pages: about 30 to the hour of an audiobook
  const hours = num(b.hours) ?? (num(b.pages) ? /** @type {number} */ (num(b.pages)) / 30 : 10);
  const h = hash(title);
  const set = spineTitle(title);
  // a thick book is a fat spine: 3 h is a pamphlet, 40 h a doorstop
  const height = 80 + (h % 21);       // percent of the shelf's height (unitless: the CSS multiplies)
  const fit = fitSpine(set, Math.round(Math.min(58, Math.max(22, 16 + hours * 1.15))), height);
  const format = formatOf(b);
  return {
    key: str(b.key), title, spineTitle: set, by: str(b.by), cover: shelfArt(b.cover),
    series: seriesLabel(b), monthLabel: finishedLabel(b.finished), hours: lengthLabel(b), genre: str(b.genre),
    times: timesOf(b), againLabel: num(b.reads) && /** @type {number} */ (num(b.reads)) >= 2 ? `finished ${timesOf(b)} times` : 'heard more than once',
    printed: num(b.printed) ? String(b.printed) : '',
    width: fit.width, font: fit.font, height, format, audio: format === 'audio', again: b.again === true,
    lean: i % 9 === 4 ? (h % 2 ? 4 : -4) : 0,
    ink: h % 5, pos: 20 + (h % 60),   // which strip of the cover the spine shows
  };
}

/** A book's face (cover) for the sections that show covers. @param {any} b */
function face(b) {
  const format = formatOf(b);
  return { title: str(b.title), by: str(b.by), cover: shelfArt(b.cover), series: seriesLabel(b), format,
    percent: Math.max(1, Math.round((num(b.progress) ?? 0) * 100)), hours: lengthLabel(b), heard: monthOf(b.heard),
    times: timesOf(b), reads: num(b.reads) ?? 0 };
}

const AGAIN = /** @type {Record<string, (b: any) => string>} */ ({
  now: (b) => `on it again now, ${b.percent}% in`,
  paused: (b) => `second listen paused ${b.percent}% in${b.heard ? `, ${b.heard}` : ''}`,
  twice: (b) => (b.reads >= 2 ? `finished ${b.times} times${b.format === 'print' ? ', on paper' : ''}` : `heard twice${b.heard ? `, again in ${b.heard}` : ''}`),
});

/** @param {any} sec */
export function readingView(sec) {
  const st = sec.bookStats && typeof sec.bookStats === 'object' ? sec.bookStats : {};
  const books = list(sec.shelf).filter((b) => str(b.title));
  /** @type {Map<string, any[]>} */
  const byYear = new Map();
  books.forEach((b, i) => {
    const y = String(b.finished || '').slice(0, 4);
    if (!/^\d{4}$/.test(y)) return;
    if (!byYear.has(y)) byYear.set(y, []);
    /** @type {any[]} */ (byYear.get(y)).push(spine(b, i));
  });
  const years = list(sec.byYear);
  const yearOf = (/** @type {string} */ y) => years.find((r) => String(r.year) === y) || {};
  // one bookcase: the spines run on from shelf to shelf, a bookend card where each year begins
  const shelf = [...byYear.entries()].flatMap(([year, spines]) => [
    { bookend: true, year, count: plural(num(yearOf(year).books) ?? spines.length, 'book', 'books'), hours: hoursLabel(yearOf(year).hours) || pagesLabel(yearOf(year).pages) },
    ...spines,
  ]);

  const maxBooks = Math.max(1, ...years.map((r) => num(r.books) ?? 0));
  const yearBars = years.map((r) => ({
    year: String(r.year), short: String(r.year).slice(2), books: num(r.books) ?? 0, hours: hoursLabel(r.hours) || pagesLabel(r.pages),
    pct: Math.round(((num(r.books) ?? 0) / maxBooks) * 100),
  }));
  const months = list(sec.monthly);
  const maxH = Math.max(1, ...months.map((m) => num(m.hours) ?? 0));
  const monthBars = months.map((m) => {
    const mo = String(m.month || '');
    return { label: MONTHS[+mo.slice(5) - 1]?.[0] || '', title: `${monthOf(mo)}: ${hoursLabel(m.hours) || '0 h'}`,
      newYear: mo.endsWith('-01'), year: mo.slice(0, 4), pct: Math.round(((num(m.hours) ?? 0) / maxH) * 100) };
  });
  const busiest = months.reduce((a, m) => ((num(m.hours) ?? 0) > (num(a?.hours) ?? -1) ? m : a), /** @type {any} */ (null));

  const finished = num(st.finished) ?? books.length;
  const hours = num(st.hours) ?? 0;
  const genres = list(sec.genres);
  const topGenre = genres[0];
  const facts = [
    sec.longest && str(sec.longest.title) ? { kicker: 'the doorstop', big: hoursLabel(sec.longest.value), line: `${str(sec.longest.title)}${sec.longest.by ? `, ${str(sec.longest.by)}` : ''}. That is ${(num(sec.longest.value) ?? 0) >= 24 ? `${((num(sec.longest.value) ?? 0) / 24).toFixed(1)} days` : 'a day'} of somebody reading to me.`, ink: 0 } : null,
    sec.shortest && str(sec.shortest.title) ? { kicker: 'the quick one', big: hoursLabel(sec.shortest.value), line: `${str(sec.shortest.title)}${sec.shortest.by ? `, ${str(sec.shortest.by)}` : ''}. Gone in an afternoon.`, ink: 1 } : null,
    sec.slowBurn && num(sec.slowBurn.value) && /** @type {number} */ (num(sec.slowBurn.value)) >= 365 ? { kicker: 'the slow burn', big: `${Math.floor(/** @type {number} */ (num(sec.slowBurn.value)) / 365)} yrs`, line: `${str(sec.slowBurn.title)} sat in my library that long before I finished it.`, ink: 2 } : null,
    sec.narrator && str(sec.narrator.name) && !list(sec.voices).length ? { kicker: 'the voice in my head', big: String(num(sec.narrator.books) ?? ''), line: `books read to me by ${str(sec.narrator.name)}, more than anyone else.`, ink: 3 } : null,
    topGenre && finished ? { kicker: 'the habit', big: `${Math.round(((num(topGenre.books) ?? 0) / finished) * 100)}%`, line: `of everything I have finished is ${str(topGenre.name).toLowerCase()}.`, ink: 4 } : null,
    num(st.unstarted) ? { kicker: 'the pile', big: String(num(st.unstarted)), line: `bought and not started: ${hoursLabel(st.pileHours)} of listening, or ${Math.round((num(st.pileHours) ?? 0) / 24)} days without sleeping.`, ink: 0 } : null,
    num(st.again) && list(sec.heardAgain)[0] ? { kicker: 'the comfort listen', big: `${group(/** @type {number} */ (num(st.again)))}`, line: `books I have gone back to for another listen. Most recently: ${str(list(sec.heardAgain)[0].title)}.`, ink: 2 } : null,
    busiest ? { kicker: 'the big month', big: hoursLabel(busiest.hours), line: `in ${monthOf(busiest.month)}, my most listened month on record.`, ink: 1 } : null,
    ...readingRelFacts(sec),
  ].filter(Boolean);

  return {
    numbers: [
      { value: group(finished), label: 'books finished', sub: st.since ? `since ${st.since}` : '' },
      { value: `≈${group(hours)}`, label: 'hours listened', sub: `about ${group(hours / 24)} days, end to end` },
      { value: group(num(st.authors) ?? 0), label: 'authors', sub: '' },
      ...(num(st.pages) ? [{ value: group(/** @type {number} */ (num(st.pages))), label: 'pages turned', sub: `${plural(num(st.print) ?? 0, 'book', 'books')} on paper` }] : []),
      ...(num(st.again) ? [{ value: group(/** @type {number} */ (num(st.again))), label: 'gone back to', sub: `${hoursLabel(st.againHours)} of going back for more` }] : []),
      { value: group(num(st.owned) ?? 0), label: 'in the library', sub: num(st.unstarted) ? `${group(/** @type {number} */ (num(st.unstarted)))} still waiting` : '' },
    ],
    onTheGo: list(sec.onTheGo).filter((b) => str(b.title)).map((b) => ({ ...face(b), again: b.again === true })),
    bookmarks: list(sec.bookmarks).filter((b) => str(b.title)).map((b) => ({ ...face(b), paused: b.paused === true })),
    heardAgain: list(sec.heardAgain).filter((b) => str(b.title) && AGAIN[b.state]).map((b) => {
      const f = face(b);
      return { ...f, state: String(b.state), label: AGAIN[b.state](f) };
    }),
    shelf,
    bothWays: list(sec.bothWays).filter((b) => str(b.title) && list(b.times).length >= 2).slice(0, 8).map((b) => ({
      title: str(b.title), by: str(b.by), cover: shelfArt(b.cover),
      times: list(b.times).map((t) => ({
        format: t.format === 'print' ? 'print' : 'audio', when: finishedLabel(t.when),
        how: t.format === 'print' ? 'on paper' : str(t.narrator) ? `read by ${str(t.narrator)}` : 'audiobook',
      })),
    })),
    authors: list(sec.topAuthors).filter((a) => str(a.name)).slice(0, 8).map((a, i) => ({
      name: str(a.name), books: plural(num(a.books) ?? 0, 'book', 'books'), hours: hoursLabel(a.hours), rank: i + 1,
      covers: arts(a.covers, 4),
    })),
    series: list(sec.series).filter((s) => str(s.title)).slice(0, 6).map((s) => ({
      title: str(s.title), by: str(s.by), books: plural(num(s.books) ?? 0, 'book', 'books'),
      covers: arts(s.covers, 6),
    })),
    yearBars, yearsMany: yearBars.length > 8, monthBars, hasMonths: monthBars.some((m) => m.pct > 0),
    genres: genres.filter((g) => (num(g.books) ?? 0) >= 2).slice(0, 5).map((g) => ({ name: str(g.name), books: num(g.books) ?? 0, pct: Math.round(((num(g.books) ?? 0) / Math.max(1, finished)) * 100) })),
    facts,
    ...readingRelView(sec),
  };
}

// ─── listening ───

/** @param {any} sec */
export function listeningView(sec) {
  const m = sec.music && typeof sec.music === 'object' ? sec.music : {};
  const top = list(sec.topArtists).filter((a) => str(a.name));
  const maxPlays = Math.max(1, ...top.map((a) => num(a.plays) ?? 0));
  const loved = list(sec.lovedArtists).filter((a) => str(a.name));
  const maxLoves = Math.max(1, ...loved.map((a) => num(a.loves) ?? 0));
  const repeatDays = num(sec.repeatDays) ?? 0;
  const crate = list(sec.crate).filter((c) => str(c.title));
  const ear = list(sec.earMonths).filter((x) => /^\d{4}-\d{2}$/.test(String(x.month || '')));
  const earMax = Math.max(1, ...ear.map((x) => (num(x.musicHours) ?? 0) + (num(x.podcastHours) ?? 0)));
  const pods = list(sec.podcasts).filter((x) => str(x.name));
  const podMax = Math.max(1, ...pods.map((x) => num(x.episodes) ?? 0));
  const tapes = list(sec.playlists).filter((p) => str(p.title));
  const years = list(sec.musicYears).filter((y) => num(y.year) && list(y.songs).length);
  const since = /^\d{4}-\d{2}$/.test(String(m.since || '')) ? String(m.since) : '';
  const deck = list(sec.deck).filter((d) => str(d.title)).slice(0, 4);
  const deckN = deck.length >= 4 ? 4 : Math.min(1, deck.length);
  return {
    numbers: [
      { value: group(num(m.loves) ?? 0), label: 'songs liked', sub: num(m.lovedArtists) ? `by ${group(/** @type {number} */ (num(m.lovedArtists)))} artists` : '' },
      ...(num(sec.playlistCount) ? [{ value: group(/** @type {number} */ (num(sec.playlistCount))), label: 'playlists made', sub: `${group(tapes.reduce((n, p) => n + (num(p.tracks) ?? 0), 0))} songs on them` }] : []),
      { value: group(num(m.following) ?? 0), label: 'artists followed', sub: '' },
      { value: group(num(m.plays) ?? 0), label: 'plays logged', sub: m.since ? `since ${monthOf(m.since)}` : '' },
      { value: group(num(m.artists) ?? 0), label: 'artists heard', sub: num(m.lovedHeard) ? `${Math.round(((num(m.lovedHeard) ?? 0) / Math.max(1, num(m.plays) ?? 1)) * 100)}% of plays were songs I had liked` : '' },
    ],
    chart: top.map((a, i) => ({
      rank: i + 1, name: str(a.name), art: shelfArt(a.art), plays: plural(num(a.plays) ?? 0, 'play', 'plays'),
      loves: num(a.loves) ?? 0, pct: Math.round(((num(a.plays) ?? 0) / maxPlays) * 100), lead: i === 0, ink: i % 5,
    })),
    poster: loved.map((a, i) => {
      const r = (num(a.loves) ?? 0) / maxLoves;
      return { name: str(a.name), loves: num(a.loves) ?? 0, size: r > 0.75 ? 5 : r > 0.5 ? 4 : r > 0.3 ? 3 : r > 0.18 ? 2 : 1, ink: hash(str(a.name)) % 5, n: i };
    }).sort((a, b) => (hash(a.name) % 97) - (hash(b.name) % 97)),
    repeatTitle: repeatDays >= 2 ? 'on repeat' : 'lately',
    repeatNote: repeatDays >= 2 ? 'The songs I came back to on the most different days.' : 'What has been playing this last few weeks. It becomes "on repeat" once a song comes back on a second day.',
    repeat: list(sec.onRepeat).filter((t) => str(t.title)).slice(0, 8).map((t, i) => ({
      n: String(i + 1).padStart(2, '0'), title: str(t.title), by: str(t.by), art: shelfArt(t.art), loved: t.loved === true,
      days: repeatDays >= 2 ? plural(num(t.days) ?? 0, 'day', 'days') : '',
    })),
    crate: crate.slice(0, 12).map((c) => ({
      title: str(c.title), by: str(c.by), year: num(c.year) ?? '', art: shelfArt(c.art), saved: c.saved === true,
      plays: (num(c.plays) ?? 0) > 0 ? plural(/** @type {number} */ (num(c.plays)), 'play', 'plays') : '',
      tilt: ((hash(str(c.title)) % 5) - 2) * 0.7, ink: hash(str(c.title)) % 5,
    })),
    tapes: tapes.map((p) => {
      const h = hash(str(p.title));
      const tracks = num(p.tracks) ?? 0;
      const heard = num(p.heard) ?? 0;
      return {
        title: str(p.title), tracks: plural(tracks, 'song', 'songs'), hours: hoursLabel(p.hours),
        artists: (Array.isArray(p.artists) ? p.artists : []).map(str).filter(Boolean).slice(0, 3).join(', '),
        arts: arts(p.arts, 4), loved: num(p.loved) ?? 0,
        heard: heard && tracks ? `${Math.round((heard / tracks) * 100)}% of it played` : '',
        ink: h % 5, tilt: ((h % 7) - 3) * 0.6,
      };
    }),
    years: years.map((y) => {
      const songs = list(y.songs).filter((t) => str(t.title));
      const lead = songs[0];
      const ta = y.topArtist && typeof y.topArtist === 'object' && str(y.topArtist.name) ? y.topArtist : null;
      return {
        year: String(y.year), ink: (num(y.year) ?? 0) % 5,
        lead: { rank: num(lead.rank) ?? 1, title: str(lead.title), by: str(lead.by), art: shelfArt(lead.art) },
        rest: songs.slice(1, 5).map((t) => ({ rank: num(t.rank) ?? '', title: str(t.title), by: str(t.by), art: shelfArt(t.art) })),
        leadPlays: plural(num(lead.plays) ?? 0, 'play', 'plays'),
        topArtist: ta ? `${str(ta.name)}, ${plural(num(ta.plays) ?? 0, 'play', 'plays')}` : '',
        loved: num(y.loved) ?? 0, artists: group(num(y.artists) ?? 0),
        totals: `${plural(num(y.plays) ?? 0, 'play', 'plays')}${num(y.hours) ? ` · ${hoursLabel(y.hours)}` : ''}`,
        part: since.startsWith(`${y.year}-`) && !since.endsWith('-01') ? `from ${MONTHS[+since.slice(5) - 1]}` : '',
      };
    }),
    stayers: list(sec.stayers).filter((t) => str(t.title)).slice(0, 8).map((t) => ({
      title: str(t.title), by: str(t.by), art: shelfArt(t.art),
      years: (Array.isArray(t.years) ? t.years : []).filter((v) => num(v)).join(' · '),
    })),
    deck: deck.length ? {
      n: deckN,
      items: deck.slice(0, deckN === 4 ? 4 : 1).map((d, i) => ({
        i, podcast: d.kind === 'podcast', title: str(d.title), by: str(d.by), art: shelfArt(d.art),
        plays: d.kind === 'podcast' ? plural(num(d.plays) ?? 0, 'episode', 'episodes') : plural(num(d.plays) ?? 0, 'play', 'plays'),
      })),
    } : null,
    sinceLabel: monthOf(since),
    podcasts: pods.map((x, i) => {
      const since = monthOf(x.since), last = monthOf(x.last);
      return { name: str(x.name), art: shelfArt(x.art), episodes: group(num(x.episodes) ?? 0), one: num(x.episodes) === 1, hours: hoursLabel(x.hours),
        genre: str(x.genre),
        span: since && last && since !== last ? `${since} to ${last}` : since, both: (num(x.apps) ?? 0) > 1, ink: i % 5,
        pct: Math.round(((num(x.episodes) ?? 0) / podMax) * 100) };
    }),
    earBars: ear.map((x) => {
      const mo = String(x.month), mh = num(x.musicHours) ?? 0, ph = num(x.podcastHours) ?? 0;
      return { newYear: mo.endsWith('-01'), year: mo.slice(0, 4),
        title: `${monthOf(mo)}: ${hoursLabel(mh) || '0 h'} of music${ph ? `, ${hoursLabel(ph)} of podcasts` : ''}`,
        music: Math.round((mh / earMax) * 100), podcast: Math.round((ph / earMax) * 100) };
    }),
    earPodcasts: ear.some((x) => (num(x.podcastHours) ?? 0) > 0),
    mixtape: list(sec.latestLoves).filter((t) => str(t.title)).slice(0, 12).map((t, i) => ({
      n: i + 1, side: i < 6 ? 'A' : 'B', title: str(t.title), by: str(t.by), art: shelfArt(t.art),
    })),
    ...relationsView(sec),
  };
}

// ─── listening relations (jarvis lifehub/musicrel.py) ───

/** The prize a gold disc is framed for, as its plaque says it: [one, many]. */
const PRIZES = {
  grammy: ['Grammy', 'Grammys'], brit: ['Brit', 'Brits'], mercury: ['Mercury Prize', 'Mercury Prizes'],
  ivor: ['Ivor Novello', 'Ivor Novellos'], eurovision: ['Eurovision win', 'Eurovision wins'], oscar: ['Oscar', 'Oscars'],
  globe: ['Golden Globe', 'Golden Globes'], mtv: ['MTV award', 'MTV awards'], mobo: ['MOBO', 'MOBOs'],
};
const SCREEN_KIND = { film: 'film', show: 'TV', game: 'game' };
const SCREEN_PAGE = { watching: { href: '/life/watching', label: 'on my telly too' }, games: { href: '/life/games', label: 'on my games shelf too' } };

/** "3 Grammys" for wins, "2 Brit nominations" when there are none. @param {any} a */
const prizeLine = (a) => {
  const [one, many] = PRIZES[str(a.award)] || [];
  if (!one) return '';
  const won = num(a.won) ?? 0, noms = num(a.noms) ?? 0;
  if (won) return `${won} ${won === 1 ? one : many}`;
  return noms ? `${noms} ${one.replace(/ win$/, '')} ${noms === 1 ? 'nomination' : 'nominations'}` : '';
};

/** @param {any} sec */
export function relationsView(sec) {
  const racks = list(sec.racks).filter((r) => str(r.rack) && num(r.share) != null).slice(0, 10);
  const inkOf = new Map(racks.map((r, i) => [str(r.rack), i]));
  const cov = sec.relCoverage && typeof sec.relCoverage === 'object' ? sec.relCoverage : null;
  const years = list(sec.rackYears).filter((y) => num(y.year) && y.shares && typeof y.shares === 'object');
  const gold = list(sec.goldDiscs).filter((g) => str(g.name) && list(g.awards).length);
  const origins = list(sec.origins).filter((o) => str(o.name) && num(o.share) != null);
  const oMax = Math.max(1, ...origins.map((o) => num(o.share) ?? 0));
  const eras = list(sec.eras).filter((e) => num(e.decade) && num(e.share) != null);
  const eMax = Math.max(1, ...eras.map((e) => num(e.share) ?? 0));
  const screens = list(sec.screenMusic).filter((x) => str(x.title) && list(x.songs).length);
  return {
    racks: racks.map((r, i) => ({
      name: str(r.rack), share: num(r.share) ?? 0, ink: i, off: (i % 3) * 18,
      plays: plural(num(r.plays) ?? 0, 'play', 'plays'), artistsN: plural(num(r.artists) ?? 0, 'artist', 'artists'),
      top: (Array.isArray(r.top) ? r.top : []).map(str).filter(Boolean).slice(0, 4),
      // the divider stands as tall as its share of the racks, never so short its name will not fit
      height: Math.max(34, Math.round(((num(r.share) ?? 0) / Math.max(1, num(racks[0].share) ?? 1)) * 100)),
    })),
    rackYears: years.map((y) => {
      const parts = Object.entries(y.shares).filter(([k, v]) => inkOf.has(k) && num(v)).sort((a, b) => /** @type {number} */ (inkOf.get(a[0])) - /** @type {number} */ (inkOf.get(b[0])));
      const total = parts.reduce((n, [, v]) => n + /** @type {number} */ (v), 0) || 1;
      return {
        year: String(y.year), lead: str(y.lead),
        parts: parts.map(([k, v]) => ({ rack: k, ink: inkOf.get(k), pct: Math.round((/** @type {number} */ (v) / total) * 1000) / 10 })),
        title: parts.map(([k, v]) => `${k} ${v}%`).join(', '),
      };
    }),
    rackNote: cov && num(cov.artists) ? `${group(/** @type {number} */ (num(cov.artists)))} most played artists of ${group(num(cov.of) ?? 0)}, which is ${num(cov.racked) ?? num(cov.plays) ?? 0}% of every play` : '',
    gold: gold.map((g, i) => {
      const aw = list(g.awards);
      const won = num(g.won) ?? 0;
      const mine = list(g.mine).filter((m) => str(m.title))[0];
      const best = aw.find((a) => str(a.best) && (num(a.won) ?? 0) > 0);
      return {
        name: str(g.name), tier: won ? 'gold' : 'silver', n: i,
        lines: aw.map(prizeLine).filter(Boolean).slice(0, 3),
        best: best ? `${(PRIZES[str(best.award)] || [''])[0].replace(/ win$/, '')}: ${str(best.best)}` : '',
        mine: mine ? `including ${str(mine.title)}, ${plural(num(mine.plays) ?? 0, 'play', 'plays')} from me` : '',
        tilt: ((hash(str(g.name)) % 5) - 2) * 0.6,
      };
    }),
    // the wall's brass plate: how many of my artists have won each prize, the most first
    goldTally: cov && cov.wins && typeof cov.wins === 'object'
      ? Object.entries(cov.wins).filter(([k, n]) => PRIZES[k] && num(n)).sort((a, b) => /** @type {number} */ (b[1]) - /** @type {number} */ (a[1]))
        .slice(0, 6).map(([k, n]) => ({ n: group(/** @type {number} */ (n)), prize: `${['oscar', 'mtv', 'ivor'].includes(k) ? 'an' : 'a'} ${PRIZES[k][0]}` }))
      : [],
    goldNote: cov && num(cov.awarded) ? `${group(/** @type {number} */ (num(cov.awarded)))} of my ${group(num(cov.artists) ?? 0)} most played artists have a music prize or a nomination on Wikidata` : '',
    origins: origins.map((o, i) => ({
      code: str(o.code), name: str(o.name), share: num(o.share) ?? 0, ink: i % 5,
      size: Math.max(0.8, Math.sqrt((num(o.share) ?? 0) / oMax) * 2.6),
      artists: plural(num(o.artists) ?? 0, 'artist', 'artists'),
      top: (Array.isArray(o.top) ? o.top : []).map(str).filter(Boolean).slice(0, 3).join(', '),
    })),
    eras: eras.filter((e) => (num(e.share) ?? 0) >= 1).map((e) => ({
      decade: `${String(e.decade).slice(2)}s`, share: num(e.share) ?? 0, pct: Math.round(((num(e.share) ?? 0) / eMax) * 100),
      top: (Array.isArray(e.top) ? e.top : []).map(str).filter(Boolean).slice(0, 2).join(', '),
      artists: plural(num(e.artists) ?? 0, 'artist', 'artists'),
    })),
    screens: screens.map((x, i) => {
      const page = SCREEN_PAGE[str(x.page)] || null;
      const song = list(x.songs)[0];
      return {
        title: str(x.title), kind: SCREEN_KIND[str(x.kind)] || '', art: shelfArt(x.art), ink: i % 5,
        plays: plural(num(x.plays) ?? 0, 'play', 'plays'), across: (num(x.tracks) ?? 0) > 1 ? `across ${group(/** @type {number} */ (num(x.tracks)))} songs` : '',
        song: str(song.title), by: str(song.by),
        href: page ? page.href : '', tie: page ? page.label : '',
        tilt: ((hash(str(x.title)) % 5) - 2) * 0.7,
      };
    }),
  };
}
