/**
 * /life/reading's relations (2026-11-10): what the books on the shelf are, beyond that I finished them.
 *
 * The prize shelf (covers with foil seals: gold for a win, silver for a shortlist, and a "now a major
 * motion picture" ribbon where a film or show was made of it), the voices (who read the books to me),
 * the card catalogue (subject drawers with the library's own class marks) and the date-due slip (when
 * the books were first printed, a tally mark a book). The export (jarvis lifehub/bookrel.py) does the
 * matching against Wikidata and Open Library and the privacy screening; this only shapes rows.
 */
import { shelfArt } from './life-shelves.mjs';

const num = (/** @type {unknown} */ n) => (typeof n === 'number' && Number.isFinite(n) ? n : null);
const str = (/** @type {unknown} */ s) => (typeof s === 'string' ? s.trim() : '');
const list = (/** @type {unknown} */ a) => (Array.isArray(a) ? a.filter((x) => x && typeof x === 'object') : []);
const group = (/** @type {number} */ n) => Math.round(n).toLocaleString('en-GB');
const plural = (/** @type {number} */ n, /** @type {string} */ a, /** @type {string} */ b) => `${group(n)} ${n === 1 ? a : b}`;
/** @param {string} s */
const hash = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthOf = (/** @type {unknown} */ m) => (/^\d{4}-(0[1-9]|1[0-2])$/.test(String(m)) ? `${MONTHS[+String(m).slice(5) - 1]} ${String(m).slice(0, 4)}` : '');
/** "Iron Flame (Part 1 of 2) (Dramatized Adaptation)" -> "Iron Flame". @param {string} t */
export const bareTitle = (t) => t.replace(/\s*[([](?:Part \d+ of \d+|Dramati[sz]ed Adaptation|Unabridged)[)\]]/gi, '').replace(/\s+/g, ' ').trim();

/** The seal's name: [one, the tally's plural]. */
export const BOOK_PRIZES = /** @type {Record<string, [string, string]>} */ ({
  hugo: ['Hugo', 'Hugos'], nebula: ['Nebula', 'Nebulas'], booker: ['Booker', 'Bookers'], pulitzer: ['Pulitzer', 'Pulitzers'],
  clarke: ['Clarke', 'Clarke Awards'], locus: ['Locus', 'Locus Awards'], bsfa: ['BSFA', 'BSFA Awards'],
  campbell: ['Campbell', 'Campbell Awards'], pkd: ['Philip K. Dick', 'Philip K. Dicks'], wfa: ['World Fantasy', 'World Fantasy Awards'],
  bfa: ['British Fantasy', 'British Fantasy Awards'], dragon: ['Dragon', 'Dragon Awards'], goodreads: ['Goodreads', 'Goodreads Choices'],
  carnegie: ['Carnegie', 'Carnegies'], prometheus: ['Prometheus', 'Prometheus Awards'], leguin: ['Le Guin', 'Le Guin Prizes'],
  lasswitz: ['Lasswitz', 'Lasswitz Awards'], imaginaire: ['Imaginaire', 'Grands Prix de l\'Imaginaire'], seiun: ['Seiun', 'Seiun Awards'],
});
const SEALS_ON_COVER = 3;

/** @param {any} s */
function seal(s) {
  const name = (BOOK_PRIZES[str(s.prize)] || [''])[0];
  if (!name) return null;
  return { name, cat: str(s.cat), won: s.won === true, series: s.series === true,
    title: `${s.won ? 'Won' : 'Shortlisted for'} the ${name}${str(s.cat) ? ` (${s.series ? 'Best Series' : str(s.cat)})` : ''}` };
}

/** @param {any} sec */
export function readingRelView(sec) {
  const screens = new Map(list(sec.onScreen).filter((s) => str(s.bookKey) && str(s.title)).map((s) => [str(s.bookKey), s]));
  /** @param {any} s */
  const ribbon = (s) => (s ? {
    title: str(s.title), year: num(s.year) ? String(s.year) : '', tv: s.kind === 'tv',
    watched: !!(s.watched && typeof s.watched === 'object'), href: s.watched ? '/life/watching' : '',
    line: s.watched ? `${s.watched.bigScreen ? 'Saw' : 'Watched'} the ${s.kind === 'tv' ? 'show' : 'film'}${monthOf(s.watched.month) ? ` in ${monthOf(s.watched.month)}` : ''}${s.watched.bigScreen ? ', on the big screen' : ''}`
      : `Now a ${s.kind === 'tv' ? 'TV show' : 'film'}${num(s.year) ? ` (${s.year})` : ''}; not seen it`,
  } : null);

  const prizes = list(sec.prizeShelf).filter((p) => str(p.title) && list(p.seals).length).map((p) => {
    const seals = list(p.seals).map(seal).filter(Boolean);
    const onCover = seals.slice(0, SEALS_ON_COVER);
    const rest = seals.slice(SEALS_ON_COVER);
    return {
      title: bareTitle(str(p.title)), by: str(p.by), cover: shelfArt(p.cover), year: num(p.year) ? String(p.year) : '',
      seals: onCover.map((s, i) => ({ ...s, n: i })), more: rest.map((s) => `${s.won ? 'won' : 'shortlisted for'} the ${s.name}${s.cat ? ` ${s.series ? 'Best Series' : s.cat}` : ''}`).join(', '),
      tilt: ((hash(str(p.title)) % 5) - 2) * 0.8, screen: ribbon(screens.get(str(p.key))),
    };
  });
  const tally = sec.prizeTally && typeof sec.prizeTally === 'object' ? sec.prizeTally : null;
  const wins = tally && tally.wins && typeof tally.wins === 'object'
    ? Object.entries(tally.wins).filter(([k, n]) => BOOK_PRIZES[k] && num(n))
      .sort((a, b) => /** @type {number} */ (b[1]) - /** @type {number} */ (a[1]) || Object.keys(BOOK_PRIZES).indexOf(a[0]) - Object.keys(BOOK_PRIZES).indexOf(b[0]))
      .slice(0, 5).map(([k, n]) => ({ n: group(/** @type {number} */ (n)), name: /** @type {number} */ (n) === 1 ? BOOK_PRIZES[k][0] : BOOK_PRIZES[k][1] }))
    : [];
  const cov = sec.relCoverage && typeof sec.relCoverage === 'object' ? sec.relCoverage : null;

  const voices = list(sec.voices).filter((v) => str(v.name) && num(v.books)).slice(0, 8);
  const vMax = Math.max(1, ...voices.map((v) => num(v.hours) ?? 0));
  const catalogue = list(sec.catalogue).filter((d) => str(d.heading) && num(d.books)).slice(0, 10);
  const printed = list(sec.printed).filter((d) => num(d.decade) && num(d.books));
  const ends = sec.printedEnds && typeof sec.printedEnds === 'object' ? sec.printedEnds : {};
  const oldest = ends.oldest && str(ends.oldest.title) ? ends.oldest : null;
  const newest = ends.newest && str(ends.newest.title) ? ends.newest : null;

  return {
    prizes,
    prizeTally: wins,
    prizeNote: tally && num(tally.winners) ? `${plural(/** @type {number} */ (num(tally.winners)), 'book', 'books')} on my shelf won a prize, and ${plural(num(tally.shortlisted) ?? 0, 'more was', 'more were')} shortlisted for one` : '',
    prizeSource: cov && num(cov.matched) ? `Wikidata knows ${group(/** @type {number} */ (num(cov.matched)))} of my ${group(num(cov.books) ?? 0)} books; the rest may have won things it has not heard of.` : '',
    voices: voices.map((v, i) => ({
      name: str(v.name), books: plural(num(v.books) ?? 0, 'book', 'books'), hours: `${group(num(v.hours) ?? 0)} h`,
      authors: (Array.isArray(v.authors) ? v.authors : []).map(str).filter(Boolean).slice(0, 3).join(', '),
      own: v.own === true, rank: i + 1, pct: Math.max(6, Math.round(Math.sqrt((num(v.hours) ?? 0) / vMax) * 100)),
      cover: (Array.isArray(v.covers) ? v.covers : []).map(shelfArt).find(Boolean) || '',
    })),
    voicesNote: cov && num(cov.voices) ? `${group(/** @type {number} */ (num(cov.voices)))} different voices have read me the books on my shelf. These are the ones I keep going back to.` : '',
    catalogue: catalogue.map((d, i) => ({
      heading: str(d.heading), mark: str(d.mark), books: num(d.books) ?? 0, n: i % 5,
      titles: (Array.isArray(d.titles) ? d.titles : []).map((t) => bareTitle(str(t))).filter(Boolean).slice(0, 3),
    })),
    printed: printed.map((d) => ({
      decade: `${d.decade}s`, books: num(d.books) ?? 0,
      // a tally mark a book, in fives
      fives: Array.from({ length: Math.floor((num(d.books) ?? 0) / 5) }, () => 1),
      ones: Array.from({ length: (num(d.books) ?? 0) % 5 }, () => 1),
      titles: (Array.isArray(d.titles) ? d.titles : []).map((t) => bareTitle(str(t))).filter(Boolean).slice(0, 2).join(', '),
      tilt: ((hash(String(d.decade)) % 7) - 3) * 0.9,
    })),
    printedNote: oldest && newest && oldest.year !== newest.year
      ? `The oldest is ${str(oldest.title)}${str(oldest.by) ? ` by ${str(oldest.by)}` : ''}, first printed in ${oldest.year}; the newest, ${str(newest.title)}, came out in ${newest.year}.` : '',
  };
}

/** The relations' index cards for the odd facts. @param {any} sec */
export function readingRelFacts(sec) {
  const crowd = sec.crowd && typeof sec.crowd === 'object' ? sec.crowd : null;
  const seen = list(sec.onScreen).find((s) => s.watched && str(s.title));
  return [
    crowd && crowd.top && str(crowd.top.title) ? { kicker: 'the crowd\'s favourite', big: `${Number(crowd.top.stars).toFixed(2)}`, line: `stars on Audible for ${bareTitle(str(crowd.top.title))}, the best rated book I have finished. My shelf averages ${Number(crowd.mean).toFixed(2)}.`, ink: 3 } : null,
    crowd && crowd.low && str(crowd.low.title) ? { kicker: 'the hard sell', big: `${Number(crowd.low.stars).toFixed(2)}`, line: `stars for ${bareTitle(str(crowd.low.title))}, the crowd's least favourite on my shelf. I finished it anyway.`, ink: 4 } : null,
    seen ? { kicker: 'read it, watched it', big: num(seen.year) ? String(seen.year) : 'both', line: `${bareTitle(str(seen.book))}: the book, then the ${seen.kind === 'tv' ? 'show' : 'film'}${seen.watched.bigScreen ? ', on the big screen' : ''}.`, ink: 1 } : null,
  ].filter(Boolean);
}
