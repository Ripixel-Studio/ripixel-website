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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Audible covers, YouTube Music art and artist photos, video stills. */
const ART = /^https:\/\/(m\.media-amazon\.com\/images\/I\/|yt3\.googleusercontent\.com\/|lh3\.googleusercontent\.com\/|yt3\.ggpht\.com\/|i\.ytimg\.com\/vi\/)[A-Za-z0-9._~%/+=-]*$/;
/** @param {unknown} u */
export const shelfArt = (u) => (typeof u === 'string' && ART.test(u) ? u : '');

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
const spineTitle = (t) => t.replace(/\s*\((?:Part \d+ of \d+|Dramati[sz]ed Adaptation|Unabridged)\)\s*/gi, ' ').replace(/\s*\[[^\]]*\]\s*/g, ' ').replace(/\s+/g, ' ').trim();

/** @param {unknown} a @param {number} max */
const arts = (a, max) => (Array.isArray(a) ? a : []).map(shelfArt).filter(Boolean).slice(0, max).map((src, n) => ({ src, n }));

// ─── reading ───

/** @param {any} b @param {number} i */
function spine(b, i) {
  const title = str(b.title);
  const hours = num(b.hours) ?? 10;
  const h = hash(title);
  return {
    key: str(b.key), title, spineTitle: spineTitle(title), by: str(b.by), cover: shelfArt(b.cover),
    series: seriesLabel(b), monthLabel: monthOf(b.finished), hours: hoursLabel(b.hours), genre: str(b.genre),
    // a thick book is a fat spine: 3 h is a pamphlet, 40 h a doorstop
    width: Math.round(Math.min(58, Math.max(22, 16 + hours * 1.15))),
    height: 80 + (h % 21),            // percent of the shelf's height (unitless: the CSS multiplies)
    lean: i % 9 === 4 ? (h % 2 ? 4 : -4) : 0,
    ink: h % 5, pos: 20 + (h % 60),   // which strip of the cover the spine shows
  };
}

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
    { bookend: true, year, count: plural(num(yearOf(year).books) ?? spines.length, 'book', 'books'), hours: hoursLabel(yearOf(year).hours) },
    ...spines,
  ]);

  const maxBooks = Math.max(1, ...years.map((r) => num(r.books) ?? 0));
  const yearBars = years.map((r) => ({
    year: String(r.year), books: num(r.books) ?? 0, hours: hoursLabel(r.hours),
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
    sec.narrator && str(sec.narrator.name) ? { kicker: 'the voice in my head', big: String(num(sec.narrator.books) ?? ''), line: `books read to me by ${str(sec.narrator.name)}, more than anyone else.`, ink: 3 } : null,
    topGenre && finished ? { kicker: 'the habit', big: `${Math.round(((num(topGenre.books) ?? 0) / finished) * 100)}%`, line: `of everything I have finished is ${str(topGenre.name).toLowerCase()}.`, ink: 4 } : null,
    num(st.unstarted) ? { kicker: 'the pile', big: String(num(st.unstarted)), line: `bought and not started: ${hoursLabel(st.pileHours)} of listening, or ${Math.round((num(st.pileHours) ?? 0) / 24)} days without sleeping.`, ink: 0 } : null,
    busiest ? { kicker: 'the big month', big: hoursLabel(busiest.hours), line: `in ${monthOf(busiest.month)}, my most listened month on record.`, ink: 1 } : null,
  ].filter(Boolean);

  return {
    numbers: [
      { value: group(finished), label: 'books finished', sub: st.since ? `since ${st.since}` : '' },
      { value: `≈${group(hours)}`, label: 'hours listened', sub: `about ${group(hours / 24)} days, end to end` },
      { value: group(num(st.authors) ?? 0), label: 'authors', sub: '' },
      { value: group(num(st.owned) ?? 0), label: 'in the library', sub: num(st.unstarted) ? `${group(/** @type {number} */ (num(st.unstarted)))} still waiting` : '' },
    ],
    midway: list(sec.midway).filter((b) => str(b.title)).map((b) => ({
      title: str(b.title), by: str(b.by), cover: shelfArt(b.cover), series: seriesLabel(b),
      percent: Math.max(1, Math.round((num(b.progress) ?? 0) * 100)), hours: hoursLabel(b.hours),
    })),
    shelf,
    authors: list(sec.topAuthors).filter((a) => str(a.name)).slice(0, 8).map((a, i) => ({
      name: str(a.name), books: plural(num(a.books) ?? 0, 'book', 'books'), hours: hoursLabel(a.hours), rank: i + 1,
      covers: arts(a.covers, 4),
    })),
    series: list(sec.series).filter((s) => str(s.title)).slice(0, 6).map((s) => ({
      title: str(s.title), by: str(s.by), books: plural(num(s.books) ?? 0, 'book', 'books'),
      covers: arts(s.covers, 6),
    })),
    yearBars, monthBars, hasMonths: monthBars.some((m) => m.pct > 0),
    genres: genres.filter((g) => (num(g.books) ?? 0) >= 2).slice(0, 5).map((g) => ({ name: str(g.name), books: num(g.books) ?? 0, pct: Math.round(((num(g.books) ?? 0) / Math.max(1, finished)) * 100) })),
    facts,
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
  const months = list(sec.earMonths);
  const maxBook = Math.max(1, ...months.map((x) => num(x.bookHours) ?? 0));
  const crate = list(sec.crate).filter((c) => str(c.title));
  return {
    numbers: [
      { value: group(num(m.loves) ?? 0), label: 'songs liked', sub: num(m.lovedArtists) ? `by ${group(/** @type {number} */ (num(m.lovedArtists)))} artists` : '' },
      { value: group(num(m.albums) ?? 0), label: 'albums saved', sub: '' },
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
    crate: crate.map((c) => ({
      title: str(c.title), by: str(c.by), year: num(c.year) ?? '', art: shelfArt(c.art), saved: c.saved === true,
      plays: (num(c.plays) ?? 0) > 0 ? plural(/** @type {number} */ (num(c.plays)), 'play', 'plays') : '',
      tilt: ((hash(str(c.title)) % 5) - 2) * 0.7, ink: hash(str(c.title)) % 5,
    })),
    mixtape: list(sec.latestLoves).filter((t) => str(t.title)).slice(0, 12).map((t, i) => ({
      n: i + 1, side: i < 6 ? 'A' : 'B', title: str(t.title), by: str(t.by), art: shelfArt(t.art),
    })),
    monthBars: months.map((x) => {
      const mo = String(x.month || '');
      return { label: MONTHS[+mo.slice(5) - 1]?.[0] || '', newYear: mo.endsWith('-01'), year: mo.slice(0, 4),
        title: `${monthOf(mo)}: ${hoursLabel(x.bookHours) || '0 h'} of audiobooks`,
        pct: Math.round(((num(x.bookHours) ?? 0) / maxBook) * 100) };
    }),
  };
}
