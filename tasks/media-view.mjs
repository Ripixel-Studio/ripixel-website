// @ts-check
/**
 * /life/watching and /life/games drawn as the things they are (data only; the templates draw):
 *
 *   tvView(wall, year)           the telly: the newest five posters as channels the screen flicks through (one,
 *                                still, with fewer), and the
 *                                set-top box's count of everything on the wall.
 *   rackView(wall)               the rental wall: a rack per year with RACK_MIN tiles or more, newest first. A film is a DVD case; a series
 *                                is a box set whose spine is as fat as its seasons; a cinema trip has its ticket
 *                                stub tucked in; a film watched again is a worn case; the reason, when there is
 *                                one, is the staff-pick card clipped to the shelf.
 *   boxesView(wall, completion)  the big-box shelf: the wall's weight is the box (4 a big box, 3 a box, 2 a DVD
 *                                case, 1 a jewel case), achievements give a completion sticker.
 *   shelvesOf(boxes)             a shelf per kind of box, so each is as tall as its boxes.
 *   monitorView(boxes)           the monitor: the four most recently played as a launcher's library, cycling
 *                                one to the next (one, still, with fewer).
 *
 * Every input is the already-sanitised view row (life-hub.mjs wallView / gamesView), so URLs are safe here.
 */

/** @typedef {{key: string, title: string, kind: string, series: boolean, poster: string, bigScreen: boolean,
 *   stamp: any, reason: string, month: string, monthLabel: string, firstLabel?: string, seasonsLabel: string,
 *   seasonCount?: number, spine?: string, episodes: string, weight: number, tilt: number, ink: number}} WallTile */

const CHANNELS = 5;
const MONITOR = 4;
const SPINE_MIN = 12;        // px: a one-season box set is still fatter than a DVD case
const SPINE_PER = 7;         // px per season, to SPINE_SEASONS
const SPINE_SEASONS = 8;
/** A year's rack needs this many tiles to be drawn (this year always is): before 2022 the accounts were barely
 * used, so those racks were a handful of cases. Their tiles still count everywhere else (the set-top box, the strip). */
export const RACK_MIN = 12;

/** @param {WallTile[]} wall @param {string} year YYYY, this year */
export function tvView(wall, year) {
  const all = wall.filter((t) => t.poster);
  if (!all.length) return null;
  // the screen's cycle is timed for exactly CHANNELS; with fewer it holds the newest, still
  const lit = all.length >= CHANNELS ? all.slice(0, CHANNELS) : all.slice(0, 1);
  return {
    channels: lit.map((t, i) => ({
      ...t, ch: String(i + 1).padStart(2, '0'), i,
      // the on-screen display: what is on, and when
      osd: [t.series ? t.seasonsLabel : '', t.monthLabel].filter(Boolean).join(' · '),
    })),
    n: lit.length,
    count: wall.length,
    thisYear: wall.filter((t) => t.month.startsWith(year)).length,
    year,
  };
}

/** @param {WallTile[]} wall @param {number} [min] tiles a past year's rack needs */
export function rackView(wall, min = RACK_MIN) {
  /** @type {{year: string, count: number, films: number, series: number, cases: any[]}[]} */
  const racks = [];
  for (const t of wall) {
    const y = /^\d{4}/.test(t.month) ? t.month.slice(0, 4) : '';
    let rack = racks.at(-1);
    if (!rack || rack.year !== y) racks.push(rack = { year: y, count: 0, films: 0, series: 0, cases: [] });
    rack.count += 1;
    rack[t.series ? 'series' : 'films'] += 1;
    const seasons = Math.max(1, Math.min(SPINE_SEASONS, t.seasonCount || 1));
    rack.cases.push({
      ...t,
      depth: t.series ? SPINE_MIN + SPINE_PER * (seasons - 1) : 0,
      worn: !t.series && t.weight === 2 && /^watched /.test(t.reason),
      pick: t.reason,
    });
  }
  return racks.filter((r, i) => i === 0 || r.count >= min);
}

/** Which box a weight is: the shelf sets each one's size. */
const BOX = /** @type {Record<number, string>} */ ({ 4: 'big', 3: 'box', 2: 'dvd', 1: 'jewel' });

/** @param {any[]} wall gamesView's wall @param {any[]} completion gamesView's completion */
export function boxesView(wall, completion) {
  const done = new Map((Array.isArray(completion) ? completion : []).map((c) => [String(c.game), c]));
  return (Array.isArray(wall) ? wall : []).map((g) => {
    const c = done.get(String(g.name));
    return {
      ...g,
      box: g.league ? 'big' : BOX[g.weight] || 'jewel',
      done: c ? c.pct : null,
      doneLabel: c ? `${c.pct}%` : '',
      count: c ? c.count : '',
    };
  });
}

/** The shelves: one per kind of box, in the wall's order, so each shelf is as tall as its boxes. @param {any[]} boxes */
export function shelvesOf(boxes) {
  /** @type {{box: string, boxes: any[]}[]} */
  const out = [];
  for (const b of boxes) {
    const last = out.at(-1);
    if (last && last.box === b.box) last.boxes.push(b);
    else out.push({ box: b.box, boxes: [b] });
  }
  return out;
}

/** @param {any[]} boxes boxesView rows */
export function monitorView(boxes) {
  const lit = boxes.filter((b) => b.art);
  if (!lit.length) return null;
  const dated = lit.filter((b) => b.last).sort((a, b) => (a.last < b.last ? 1 : a.last > b.last ? -1 : 0));
  const all = dated.length ? [...dated, ...lit.filter((b) => !b.last)] : lit;
  // the screen cycles through exactly MONITOR games (timed in CSS); with fewer it holds the newest, still
  const row = all.length >= MONITOR ? all.slice(0, MONITOR) : all.slice(0, 1);
  return { lead: row[0], n: row.length, row: row.map((b, i) => ({ ...b, i, on: i === 0 })) };
}

// ─── /life/watching relations: what the wall is, beyond that I watched it (jarvis lifehub watchrel) ───
//
//   awardsOf(list)               a tile's awards (the export's [{award, won, noms, best}]) as the case's laurel and
//                                its back-cover line.
//   aislesView(aisles, wall)     the genre aisles: a hanging sign each, the aisle's titles as a run of spines (as long
//                                as the aisle is full, on one scale), its best-rated cases face out, its shelf-talkers.
//   talkersView(tags, makers, wall)  the shelf-talker board: a card per recurring theme, three titles on each, and the
//                                directors and creators I keep coming back to.
//   crowdView(crowd, wall)       the crowd's verdict: every rated title as a tape on a stack by its TMDB score, then
//                                the top shelf (their favourites), the bargain bin (their least) and my staff picks.
//   cabinetView(wall)            the awards cabinet: a shelf per ceremony, the winners on it with their haul.
//
// A show on the wall as several runs counts once (its newest tile): titles are told apart by IMDb id, else title.

/** The ceremonies, in the cabinet's order: what one is called, and many. */
export const CEREMONIES = /** @type {Record<string, {one: string, many: string, major: boolean}>} */ ({
  oscar: { one: 'Oscar', many: 'Oscars', major: true },
  bafta: { one: 'BAFTA', many: 'BAFTAs', major: true },
  globe: { one: 'Golden Globe', many: 'Golden Globes', major: true },
  emmy: { one: 'Emmy', many: 'Emmys', major: true },
  palme: { one: "Palme d'Or", many: "Palmes d'Or", major: true },
  annie: { one: 'Annie', many: 'Annies', major: false },
  hugo: { one: 'Hugo', many: 'Hugos', major: false },
  game: { one: 'games-press prize', many: 'games-press prizes', major: false },
});
const n0 = (/** @type {unknown} */ v) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 1000 ? v : 0);
const many = (/** @type {number} */ n, /** @type {string} */ a, /** @type {string} */ b) => `${n} ${n === 1 ? a : b}`;

/** @param {unknown} list the export's tile awards */
export function awardsOf(list) {
  const awards = (Array.isArray(list) ? list : [])
    .filter((a) => a && Object.hasOwn(CEREMONIES, a.award) && n0(a.noms) > 0)
    .map((a) => ({ award: String(a.award), won: Math.min(n0(a.won), n0(a.noms)), noms: n0(a.noms),
      best: typeof a.best === 'string' ? a.best.slice(0, 80) : '' }));
  const won = awards.filter((a) => a.won > 0);
  // "7 Oscars, 5 BAFTAs"; with no win, "nominated for 3 Oscars"
  const line = won.length ? won.map((a) => many(a.won, CEREMONIES[a.award].one, CEREMONIES[a.award].many)).join(', ')
    : awards.length ? `nominated for ${awards.map((a) => many(a.noms, CEREMONIES[a.award].one, CEREMONIES[a.award].many)).join(', ')}` : '';
  const lead = won.find((a) => CEREMONIES[a.award].major) || won[0];
  return { awards, awardsLine: line, laurel: lead ? { award: lead.award, label: CEREMONIES[lead.award].one } : null };
}

/** @param {any} t */
const idOf = (t) => t.imdb || `t:${t.title}`;

/** The wall, a title once (its newest tile). @param {any[]} wall */
function titles(wall) {
  const seen = new Set();
  return wall.filter((t) => (seen.has(idOf(t)) ? false : (seen.add(idOf(t)), true)));
}

/** A small face-out case. @param {any} t */
const face = (t) => ({ key: t.key, title: t.title, poster: t.poster, ink: t.ink, series: t.series, rating: t.rating,
  ratingLabel: t.rating != null ? t.rating.toFixed(1) : '', imdb: t.imdb, laurel: t.laurel, tilt: t.tilt });

const SPINE_SCALE = 76;      // an aisle this full fills the shelf

/** @param {unknown} aisles @param {any[]} wall */
export function aislesView(aisles, wall) {
  const byKey = new Map(wall.map((t) => [t.key, t]));
  const rows = (Array.isArray(aisles) ? aisles : []).filter((a) => a && typeof a.genre === 'string' && a.genre.trim() && n0(a.n) > 0);
  const top = Math.max(SPINE_SCALE / 2, ...rows.map((a) => n0(a.n)));
  const shown = new Set();      // a title face out in one aisle steps back in the next, so each aisle shows its own
  return rows.slice(0, 8).map((a, i) => {
    const films = n0(a.films), series = n0(a.series), n = n0(a.n);
    const all = (Array.isArray(a.keys) ? a.keys : []).map((k) => byKey.get(k)).filter(Boolean);
    const fresh = all.filter((t) => !shown.has(idOf(t)));
    const cases = [...fresh, ...all.filter((t) => shown.has(idOf(t)))].slice(0, 5);
    for (const t of cases) shown.add(idOf(t));
    return {
      no: i + 1, genre: a.genre.trim(), n, films, series,
      count: [films ? many(films, 'film', 'films') : '', series ? many(series, 'series', 'series') : ''].filter(Boolean).join(' and '),
      filmPct: Math.round((films / top) * 1000) / 10, seriesPct: Math.round((series / top) * 1000) / 10,
      cases: cases.map(face),
      tags: (Array.isArray(a.tags) ? a.tags : []).filter((t) => typeof t === 'string' && t).slice(0, 3),
      ink: i % 5,
    };
  });
}

/** @param {unknown} tags @param {unknown} makers @param {any[]} wall */
export function talkersView(tags, makers, wall) {
  const byKey = new Map(wall.map((t) => [t.key, t]));
  const names = (/** @type {unknown} */ keys) => (Array.isArray(keys) ? keys : []).map((k) => byKey.get(k)).filter(Boolean).map((t) => t.title);
  const cards = (Array.isArray(tags) ? tags : []).filter((t) => t && typeof t.tag === 'string' && n0(t.n) >= 2)
    .slice(0, 12).map((t, i) => ({ tag: t.tag, n: n0(t.n), titles: names(t.keys).slice(0, 3), tilt: ((i * 7) % 5 - 2) * 0.9, ink: i % 5 }));
  const people = (Array.isArray(makers) ? makers : []).filter((m) => m && typeof m.name === 'string' && m.name.trim())
    .map((m) => ({ name: m.name.trim(), role: m.kind === 'creator' ? 'created' : m.kind === 'director' ? 'directed' : 'made',
      titles: names(m.keys) })).filter((m) => m.titles.length >= 2).slice(0, 6);
  return cards.length || people.length ? { cards, people } : null;
}

const SHELF = 5;
const MIN_VOTES_SHELF = 300;     // a crowd favourite needs a crowd

/** @param {any} crowd the export's {source, titles, rated, mean} @param {any[]} wall */
export function crowdView(crowd, wall) {
  const all = titles(wall);
  const rated = all.filter((t) => t.rating != null);
  if (rated.length < 10) return null;
  // a stack per half point, each the scores nearest it (the 7 stack is 6.8 to 7.2)
  const half = (/** @type {number} */ r) => Math.round(r * 2) / 2;
  const lo = Math.max(1, half(Math.min(...rated.map((t) => t.rating))));
  const hi = Math.min(10, half(Math.max(...rated.map((t) => t.rating))));
  /** @type {{from: number, label: string, tapes: any[], major: boolean}[]} */
  const bins = [];
  for (let b = lo; b <= hi + 1e-9; b += 0.5) bins.push({ from: b, label: Number.isInteger(b) ? String(b) : b.toFixed(1), tapes: [], major: Number.isInteger(b) });
  for (const t of rated) {
    const i = Math.min(bins.length - 1, Math.max(0, Math.round((half(t.rating) - lo) * 2)));
    bins[i].tapes.push({ title: t.title, rating: t.rating.toFixed(1), series: t.series, ink: t.ink });
  }
  for (const b of bins) b.tapes.sort((x, y) => Number(x.series) - Number(y.series) || Number(y.rating) - Number(x.rating));
  const tallest = Math.max(...bins.map((b) => b.tapes.length));
  const mean = rated.reduce((s, t) => s + t.rating, 0) / rated.length;
  const byScore = [...rated].sort((a, b) => b.rating - a.rating || b.votes - a.votes);
  const crowded = byScore.filter((t) => t.votes >= MIN_VOTES_SHELF);
  // staff picks: what I went back to (a rewatch, a binge), else what I finished; the crowd's score beside my reason
  const picked = rated.filter((t) => t.weight === 2 || /^(binged|finished|watched )/.test(t.reason));
  const picks = [...picked].sort((a, b) => b.weight - a.weight || a.rating - b.rating).slice(0, SHELF)
    .map((t) => ({ ...face(t), why: t.reason }));
  const gem = [...picked].sort((a, b) => a.rating - b.rating)[0];
  return {
    bins, tallest, n: rated.length, mean: mean.toFixed(1),
    // across the floor: the first stack's centre is lo, each stack half a point wide
    meanAt: Math.round(((mean - lo + 0.25) / (bins.length * 0.5)) * 1000) / 1000,
    source: typeof crowd?.source === 'string' ? crowd.source : 'TMDB',
    top: crowded.slice(0, SHELF).map(face),
    bin: crowded.slice(-4).reverse().map(face),
    picks,
    gem: gem ? { title: gem.title, rating: gem.rating.toFixed(1), why: gem.reason } : null,
  };
}

/** @param {any[]} wall */
export function cabinetView(wall) {
  const all = titles(wall);
  const shelves = Object.entries(CEREMONIES).map(([key, c]) => {
    const winners = all.map((t) => ({ t, a: (t.awards || []).find((/** @type {any} */ a) => a.award === key) }))
      .filter((x) => x.a);
    const won = winners.filter((x) => x.a.won > 0).sort((x, y) => y.a.won - x.a.won || y.a.noms - x.a.noms);
    return {
      key, label: c.many, one: c.one,
      wins: won.reduce((s, x) => s + x.a.won, 0), noms: winners.reduce((s, x) => s + x.a.noms, 0),
      titles: winners.length, nominatedOnly: winners.length - won.length, wide: won.length > 5,
      cases: won.map((x) => ({ ...face(x.t), won: x.a.won, haul: x.a.won > 1 ? `×${x.a.won}` : '', best: x.a.best })),
    };
  }).filter((s) => s.cases.length);
  if (!shelves.length) return null;
  const nominated = all.filter((t) => (t.awards || []).length).length;
  const winners = all.filter((t) => (t.awards || []).some((/** @type {any} */ a) => a.won > 0)).length;
  return { shelves, nominated, winners, titles: all.length };
}
