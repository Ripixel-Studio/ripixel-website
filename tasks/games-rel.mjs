// @ts-check
/**
 * /life/games relations: what the shelf's games are, beyond the hours (jarvis lifehub gamerel). Data only; the
 * templates draw:
 *
 *   stickersOf(tile)             a box's stickers and the back of the box: the Metacritic score (a "must-play" star
 *                                at 90 and over), Steam's review verdict, the award foil, its kind, maker and year.
 *   binsView(bins, wall)         the bargain bins: a wire bin per kind of game, most hours first, the most played
 *                                boxes standing up in it (taller the fuller the bin), a price card with the hours.
 *   labelsView(labels, wall)     the label gun: the themes Steam players tag my games with, a sticker each, as big
 *                                as the number of games behind it.
 *   criticsView(critics, wall)   the review pages: the average score by game and by hour, the critics' darlings, the
 *                                ones I rate higher than they did, and the ones I bounced off.
 *   endcapView(wall)             the prize endcap: a shelf per ceremony, the winners on it with their haul.
 *   studiosView(studios, wall)   the studios I keep going back to.
 *
 * Every input is the export (or gamesView's sanitised wall), checked here: unknown keys and odd numbers drop out.
 */

/** The ceremonies, in the endcap's order. */
export const PRIZES = /** @type {Record<string, {one: string, many: string, major: boolean}>} */ ({
  tga: { one: 'Game Award', many: 'Game Awards', major: true },
  bafta: { one: 'BAFTA', many: 'BAFTAs', major: true },
  joystick: { one: 'Golden Joystick', many: 'Golden Joysticks', major: true },
  gdc: { one: 'GDC Award', many: 'GDC Awards', major: true },
  dice: { one: 'D.I.C.E. Award', many: 'D.I.C.E. Awards', major: true },
  igf: { one: 'IGF Award', many: 'IGF Awards', major: false },
  steam: { one: 'Steam Award', many: 'Steam Awards', major: false },
});
/** What each ceremony is, said once under its shelf. */
const PRIZE_NOTE = /** @type {Record<string, string>} */ ({
  tga: 'The Game Awards, every December', bafta: 'BAFTA Games Awards', joystick: 'Golden Joysticks, voted by players',
  gdc: 'Game Developers Choice, voted by developers', dice: 'D.I.C.E., the Academy of Interactive Arts & Sciences',
  igf: 'Independent Games Festival', steam: 'Steam Awards, voted by Steam players',
});
/** Steam's review summaries, best first (anything else is not shown). */
export const VERDICTS = ['Overwhelmingly Positive', 'Very Positive', 'Positive', 'Mostly Positive', 'Mixed',
  'Mostly Negative', 'Negative', 'Very Negative', 'Overwhelmingly Negative'];
const VERDICT_SHORT = /** @type {Record<string, string>} */ ({
  'Overwhelmingly Positive': 'Overwhelmingly +', 'Very Positive': 'Very +', Positive: 'Positive', 'Mostly Positive': 'Mostly +',
  Mixed: 'Mixed', 'Mostly Negative': 'Mostly −', Negative: 'Negative', 'Very Negative': 'Very −', 'Overwhelmingly Negative': 'Overwhelmingly −',
});

const n0 = (/** @type {unknown} */ v) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 1e7 ? v : 0);
const many = (/** @type {number} */ n, /** @type {string} */ a, /** @type {string} */ b) => `${n.toLocaleString('en-GB')} ${n === 1 ? a : b}`;
const str = (/** @type {unknown} */ v, max = 60) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Metacritic's own colours: green 75 and over, yellow 50 to 74, red under. @param {number} s */
const tierOf = (s) => (s >= 75 ? 'good' : s >= 50 ? 'mixed' : 'bad');

/** @param {any} t an export wall tile */
export function stickersOf(t) {
  const mc = n0(t?.metacritic);
  const metacritic = mc > 0 && mc <= 100 ? mc : null;
  const rv = t?.reviews && typeof t.reviews === 'object' ? t.reviews : null;
  const verdict = rv && VERDICTS.includes(rv.verdict) ? String(rv.verdict) : '';
  const reviewPct = verdict && n0(rv.pct) <= 100 ? n0(rv.pct) : null;
  const awards = (Array.isArray(t?.awards) ? t.awards : [])
    .filter((a) => a && Object.hasOwn(PRIZES, a.award) && n0(a.noms) > 0)
    .map((a) => ({ award: String(a.award), won: Math.min(n0(a.won), n0(a.noms)), noms: n0(a.noms), best: str(a.best, 80) }));
  const won = awards.filter((a) => a.won > 0);
  const lead = won.find((a) => PRIZES[a.award].major) || won[0];
  const prizeLine = won.length ? won.map((a) => many(a.won, PRIZES[a.award].one, PRIZES[a.award].many)).join(', ')
    : awards.length ? `nominated for ${awards.map((a) => many(a.noms, PRIZES[a.award].one, PRIZES[a.award].many)).join(', ')}` : '';
  const bin = str(t?.bin, 30);
  const developer = str(t?.developer, 50);
  const released = n0(t?.released) >= 1970 && n0(t?.released) <= 2100 ? n0(t?.released) : null;
  return {
    metacritic, mcTier: metacritic ? tierOf(metacritic) : '', mustPlay: metacritic != null && metacritic >= 90,
    verdict, verdictShort: VERDICT_SHORT[verdict] || '', reviewPct, reviewN: verdict ? n0(rv.n) : 0,
    awards, prizeLine,
    foil: lead ? { award: lead.award, label: PRIZES[lead.award].one, best: lead.best } : null,
    bin, developer, released,
    // the back of the box's small print: "Strategy, Valve, 2011"
    madeLine: [bin, developer, released ? String(released) : ''].filter(Boolean).join(', '),
  };
}

/** A small box for a list. @param {any} t a gamesView wall row */
const face = (t) => ({ key: t.key, name: t.name, art: t.art, ink: t.ink, tilt: t.tilt, metacritic: t.metacritic, mcTier: t.mcTier,
  mustPlay: t.mustPlay, hours: t.hours, hoursN: t.hoursN, foil: t.foil });

/** @param {any[]} wall */
const byKeyOf = (wall) => new Map((Array.isArray(wall) ? wall : []).filter((t) => t && t.key).map((t) => [String(t.key), t]));

const BINS = 8;
const BIN_BOXES = 4;

/** @param {unknown} bins the export's [{bin, games, hours, share, keys}] @param {any[]} wall */
export function binsView(bins, wall) {
  const byKey = byKeyOf(wall);
  const rows = (Array.isArray(bins) ? bins : []).filter((b) => b && str(b.bin) && n0(b.games) > 0).slice(0, BINS);
  if (rows.length < 3) return null;
  const top = Math.max(1, ...rows.map((b) => n0(b.hours)));
  const total = rows.reduce((s, b) => s + n0(b.hours), 0);
  return {
    bins: rows.map((b, i) => {
      const boxes = (Array.isArray(b.keys) ? b.keys : []).map((k) => byKey.get(String(k))).filter((t) => t && !t.idle).slice(0, BIN_BOXES);
      // the most played stands second, in front, with the others leaning either side of it
      const stood = boxes.length > 1 ? [boxes[1], boxes[0], ...boxes.slice(2)] : boxes;
      const fill = Math.max(0.18, Math.sqrt(n0(b.hours) / top));      // by area, so a small bin still shows its boxes
      return {
        bin: str(b.bin), games: many(n0(b.games), 'game', 'games'), hours: `${n0(b.hours).toLocaleString('en-GB')}h`,
        share: n0(b.share) <= 100 ? n0(b.share) : 0, fill: Math.round(fill * 100), ink: i % 5,
        boxes: stood.map((t, j) => ({ ...face(t), lean: ((j * 5 + i * 3) % 7 - 3) * 2.2 })),
        top: boxes[0]?.name || '',
      };
    }),
    hours: total.toLocaleString('en-GB'),
  };
}

const LABELS = 18;

/** @param {unknown} labels the export's [{tag, n, hours, keys}] @param {any[]} wall */
export function labelsView(labels, wall) {
  const byKey = byKeyOf(wall);
  const rows = (Array.isArray(labels) ? labels : []).filter((l) => l && str(l.tag) && n0(l.n) >= 2).slice(0, LABELS);
  if (rows.length < 4) return null;
  const top = Math.max(...rows.map((l) => n0(l.n)));
  return rows.map((l, i) => {
    const r = n0(l.n) / top;
    const names = (Array.isArray(l.keys) ? l.keys : []).map((k) => byKey.get(String(k))?.name).filter(Boolean).slice(0, 3);
    return { tag: str(l.tag), n: n0(l.n), size: r > 0.75 ? 4 : r > 0.5 ? 3 : r > 0.3 ? 2 : 1, ink: i % 5,
      tilt: ((i * 7) % 5 - 2) * 1.6, hours: n0(l.hours) ? `${n0(l.hours).toLocaleString('en-GB')}h` : '', names: names.join(', ') };
  });
}

const DARLINGS = 6;
const SIDE = 4;
const MUST = 90;             // Metacritic's "must-play"
const BOUNCED_H = 2;         // under two hours: I bounced off
const BOUNCED_MC = 85;
const KEPT_H = 10;           // ten hours or more: I kept at it

/** @param {any} critics the export's {games, metacritic, mean, meanByHours, steam, steamMean, steamMeanByHours} @param {any[]} wall */
export function criticsView(critics, wall) {
  if (!critics || typeof critics !== 'object' || !n0(critics.mean) || !n0(critics.meanByHours)) return null;
  const games = (Array.isArray(wall) ? wall : []).filter((t) => t && !t.idle && t.key);
  const scored = games.filter((t) => t.metacritic);
  const byHours = (/** @type {any} */ a, /** @type {any} */ b) => b.hoursN - a.hoursN;
  const darlings = scored.filter((t) => t.metacritic >= MUST).sort(byHours).slice(0, DARLINGS).map(face);
  const mustAll = scored.filter((t) => t.metacritic >= MUST).length;
  // mine, not theirs: lots of hours, a score the critics (or Steam's players) were lukewarm on
  const mine = games.filter((t) => t.hoursN >= KEPT_H && ((t.metacritic && t.metacritic < 75) || (t.reviewPct != null && t.reviewPct < 80)))
    .sort(byHours).slice(0, SIDE).map((t) => ({ ...face(t), why: t.metacritic && t.metacritic < 75 ? `Metacritic ${t.metacritic}` : `Steam ${t.verdict.toLowerCase()}` }));
  const bounced = scored.filter((t) => t.metacritic >= BOUNCED_MC && t.hoursN > 0 && t.hoursN < BOUNCED_H)
    .sort((a, b) => b.metacritic - a.metacritic || a.hoursN - b.hoursN).slice(0, SIDE).map(face);
  const tally = VERDICTS.map((v) => ({ verdict: v, short: VERDICT_SHORT[v], n: games.filter((t) => t.verdict === v).length,
    good: VERDICTS.indexOf(v) < 4 })).filter((v) => v.n > 0);
  const tallyMax = Math.max(1, ...tally.map((v) => v.n));
  const mean = n0(critics.mean), byHour = n0(critics.meanByHours);
  return {
    mean, meanByHours: byHour, meanTier: tierOf(mean), byHourTier: tierOf(byHour),
    scored: n0(critics.metacritic), games: n0(critics.games),
    // what the gap says: do I stick with the good ones?
    gap: byHour - mean,
    gapLine: byHour > mean ? `The longer I play something, the better reviewed it tends to be: weighted by hours, ${byHour}.`
      : byHour < mean ? `The ones I sink hours into score lower than the ones I try: weighted by hours, ${byHour}.`
        : `Weighted by hours it is the same, ${byHour}.`,
    steamMean: n0(critics.steamMean) || null, steamByHours: n0(critics.steamMeanByHours) || null,
    darlings, mustAll, mine, bounced,
    tally: tally.map((v) => ({ ...v, pct: Math.round((v.n / tallyMax) * 100) })),
  };
}

const ENDCAP_BOXES = 6;

/** @param {any[]} wall */
export function endcapView(wall) {
  const games = (Array.isArray(wall) ? wall : []).filter((t) => t && t.key);
  const shelves = Object.entries(PRIZES).map(([key, p]) => {
    const winners = games.map((t) => ({ t, a: (t.awards || []).find((/** @type {any} */ a) => a.award === key) })).filter((x) => x.a);
    const won = winners.filter((x) => x.a.won > 0).sort((x, y) => y.a.won - x.a.won || y.a.noms - x.a.noms || y.t.hoursN - x.t.hoursN);
    return {
      key, label: p.many, one: p.one, note: PRIZE_NOTE[key] || '',
      wins: won.reduce((s, x) => s + x.a.won, 0), noms: winners.reduce((s, x) => s + x.a.noms, 0),
      nominatedOnly: winners.length - won.length,
      boxes: won.slice(0, ENDCAP_BOXES).map((x) => ({ ...face(x.t), won: x.a.won, haul: x.a.won > 1 ? `×${x.a.won}` : '', best: x.a.best })),
      more: won.length > ENDCAP_BOXES ? `and ${many(won.length - ENDCAP_BOXES, 'more', 'more')}` : '',
      games: many(won.length, 'game', 'games'),
    };
  }).filter((s) => s.boxes.length);
  if (!shelves.length) return null;
  const winners = games.filter((t) => (t.awards || []).some((/** @type {any} */ a) => a.won > 0));
  const wonOf = (/** @type {any} */ t) => t.awards.reduce((/** @type {number} */ s, /** @type {any} */ x) => s + x.won, 0);
  const most = [...winners].sort((a, b) => wonOf(b) - wonOf(a) || b.hoursN - a.hoursN)[0];
  return {
    shelves, winners: winners.length, games: games.length,
    nominated: games.filter((t) => (t.awards || []).length).length,
    most: most ? { name: most.name, line: most.prizeLine, won: many(wonOf(most), 'prize', 'prizes') } : null,
  };
}

/** @param {unknown} studios the export's [{name, keys, hours}] @param {any[]} wall */
export function studiosView(studios, wall) {
  const byKey = byKeyOf(wall);
  const rows = (Array.isArray(studios) ? studios : []).filter((s) => s && str(s.name)).map((s) => ({
    name: str(s.name), hours: n0(s.hours) ? `${n0(s.hours).toLocaleString('en-GB')}h` : '',
    boxes: (Array.isArray(s.keys) ? s.keys : []).map((k) => byKey.get(String(k))).filter(Boolean).slice(0, 4).map(face),
    games: (Array.isArray(s.keys) ? s.keys : []).length,
  })).filter((s) => s.boxes.length >= 3);
  return rows.length ? rows.slice(0, 6) : null;
}

