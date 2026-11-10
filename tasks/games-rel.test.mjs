// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stickersOf, binsView, labelsView, criticsView, endcapView, studiosView } from './games-rel.mjs';

const tile = (key, extra = {}) => ({ key, name: `Game ${key}`, art: '', ink: 0, tilt: 0, hours: '', hoursN: 0, idle: false, ...extra });
/** A gamesView wall row: the tile plus its stickers. */
const row = (key, t = {}, extra = {}) => ({ ...tile(key, extra), ...stickersOf(t) });

test('stickers: Metacritic tiers and must-play, Steam verdict, foil from a major prize, the small print', () => {
  const s = stickersOf({ metacritic: 95, reviews: { pct: 99, n: 1000, verdict: 'Overwhelmingly Positive' }, bin: 'Puzzle',
    developer: 'A Studio', released: 2011,
    awards: [{ award: 'steam', won: 1, noms: 1, best: 'Labor of Love' }, { award: 'bafta', won: 2, noms: 4, best: 'Best Game' }] });
  assert.equal(s.metacritic, 95);
  assert.equal(s.mcTier, 'good');
  assert.equal(s.mustPlay, true);
  assert.equal(s.verdict, 'Overwhelmingly Positive');
  assert.equal(s.foil?.label, 'BAFTA', 'a major prize leads even when listed second');
  assert.equal(s.prizeLine, '1 Steam Award, 2 BAFTAs');
  assert.equal(s.madeLine, 'Puzzle, A Studio, 2011');
  assert.equal(stickersOf({ metacritic: 60 }).mcTier, 'mixed');
  assert.equal(stickersOf({ metacritic: 40 }).mcTier, 'bad');
  assert.equal(stickersOf({ metacritic: 74 }).mustPlay, false);
  const odd = stickersOf({ metacritic: 400, reviews: { pct: 50, verdict: 'Great' }, awards: [{ award: 'nobel', won: 1, noms: 1 }], released: 3 });
  assert.equal(odd.metacritic, null);
  assert.equal(odd.verdict, '');
  assert.deepEqual(odd.awards, []);
  assert.equal(odd.released, null);
  assert.equal(stickersOf({ awards: [{ award: 'tga', won: 0, noms: 2 }] }).prizeLine, 'nominated for 2 Game Awards');
  assert.equal(stickersOf(null).metacritic, null);
});

test('bins: in the export order (hours), boxes from the wall, idle never stands in a bin, three bins or none', () => {
  const wall = [row('a', {}, { art: 'x' }), row('b'), row('c', {}, { idle: true }), row('d')];
  const v = binsView([{ bin: 'Strategy', games: 3, hours: 400, share: 60, keys: ['a', 'c', 'b'] },
    { bin: 'Puzzle', games: 1, hours: 100, share: 15, keys: ['d'] }, { bin: 'Action', games: 1, hours: 4, share: 1, keys: [] }], wall);
  assert.ok(v);
  assert.deepEqual(v.bins.map((b) => b.bin), ['Strategy', 'Puzzle', 'Action']);
  assert.deepEqual(v.bins[0].boxes.map((b) => b.key), ['b', 'a'], 'the most played stands second, in front');
  assert.equal(v.bins[0].fill, 100);
  assert.equal(v.bins[1].fill, 50, 'by area: the square root of a quarter');
  assert.equal(v.bins[2].fill, 18, 'a tiny bin still shows its boxes');
  assert.equal(v.bins[0].hours, '400h');
  assert.equal(v.bins[0].games, '3 games');
  assert.equal(v.hours, '504');
  assert.equal(binsView([{ bin: 'A', games: 1, hours: 1, keys: [] }], wall), null);
});

test('labels: sized against the biggest, the first three names', () => {
  const wall = [row('a'), row('b')];
  const v = labelsView([{ tag: 'Sci-fi', n: 20, keys: ['a', 'b'] }, { tag: 'Space', n: 12, keys: [] }, { tag: 'Co-op', n: 8, keys: [] },
    { tag: 'Physics', n: 3, keys: [] }, { tag: 'Lonely', n: 1, keys: [] }], wall);
  assert.ok(v);
  assert.deepEqual(v.map((l) => [l.tag, l.size]), [['Sci-fi', 4], ['Space', 3], ['Co-op', 2], ['Physics', 1]]);
  assert.equal(v[0].names, 'Game a, Game b');
  assert.equal(labelsView([{ tag: 'A', n: 3 }], wall), null);
});

test('critics: the means, darlings by hours, mine, bounced, the Steam tally', () => {
  const wall = [
    row('a', { metacritic: 95, reviews: { pct: 98, n: 900, verdict: 'Overwhelmingly Positive' } }, { hoursN: 50 }),
    row('b', { metacritic: 91 }, { hoursN: 80 }),
    row('c', { metacritic: 70, reviews: { pct: 75, n: 90, verdict: 'Mostly Positive' } }, { hoursN: 40 }),
    row('d', { metacritic: 88 }, { hoursN: 0.5 }),
    row('e', { metacritic: 99 }, { hoursN: 900, idle: true }),
  ];
  const v = criticsView({ games: 4, metacritic: 4, mean: 86, meanByHours: 88 }, wall);
  assert.ok(v);
  assert.deepEqual(v.darlings.map((d) => d.key), ['b', 'a'], 'idle left out, most played first');
  assert.equal(v.mustAll, 2);
  assert.deepEqual(v.mine.map((d) => [d.key, d.why]), [['c', 'Metacritic 70']]);
  assert.deepEqual(v.bounced.map((d) => d.key), ['d']);
  assert.match(v.gapLine, /better reviewed/);
  assert.deepEqual(v.tally.map((t) => [t.verdict, t.n, t.good]), [['Overwhelmingly Positive', 1, true], ['Mostly Positive', 1, true]]);
  assert.equal(criticsView(null, wall), null);
  assert.equal(criticsView({ mean: null, meanByHours: 80 }, wall), null);
});

test('endcap: a shelf per ceremony with a winner, in the ceremonies order, the most decorated', () => {
  const wall = [
    row('a', { awards: [{ award: 'bafta', won: 2, noms: 3, best: 'Best Game' }, { award: 'tga', won: 0, noms: 1 }] }),
    row('b', { awards: [{ award: 'tga', won: 1, noms: 1, best: 'Best Indie' }] }),
    row('c'),
  ];
  const v = endcapView(wall);
  assert.ok(v);
  assert.deepEqual(v.shelves.map((s) => [s.key, s.wins, s.noms, s.boxes.length]), [['tga', 1, 2, 1], ['bafta', 2, 3, 1]]);
  assert.equal(v.shelves[1].boxes[0].haul, '×2');
  assert.equal(v.winners, 2);
  assert.equal(v.nominated, 2);
  assert.equal(v.games, 3);
  assert.equal(v.most?.name, 'Game a');
  assert.equal(endcapView([row('z')]), null);
});

test('studios: three boxes or more', () => {
  const wall = [row('a'), row('b'), row('c')];
  const v = studiosView([{ name: 'Valve', keys: ['a', 'b', 'c'], hours: 70 }, { name: 'Two', keys: ['a', 'b'] }], wall);
  assert.deepEqual(v?.map((s) => [s.name, s.boxes.length, s.hours]), [['Valve', 3, '70h']]);
  assert.equal(studiosView([], wall), null);
});
