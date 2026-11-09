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
