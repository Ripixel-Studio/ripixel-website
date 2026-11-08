// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boxesView, shelvesOf, monitorView, tvView } from './media-view.mjs';

const art = (n) => `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${n}/c.jpg`;
const WALL = [
  { name: 'League of Legends', art: art(0), weight: 4, league: true, last: '', hours: '280h' },
  { name: 'Big One', art: art(1), weight: 4, league: false, last: '2026-03', lastLabel: 'Mar 2026' },
  { name: 'Middling', art: art(2), weight: 3, league: false, last: '2026-09', lastLabel: 'Sep 2026' },
  { name: 'Dabble', art: '', weight: 2, league: false, last: '2024-01' },
  { name: 'Barely', art: art(4), weight: 1, league: false, last: '' },
];
const DONE = [{ game: 'Big One', pct: 62, count: '31 of 50' }];

test('boxes: the weight is the box, League always the big box, completion as a sticker', () => {
  const b = boxesView(WALL, DONE);
  assert.deepEqual(b.map((x) => x.box), ['big', 'big', 'box', 'dvd', 'jewel']);
  assert.equal(b[1].doneLabel, '62%');
  assert.equal(b[1].count, '31 of 50');
  assert.equal(b[2].done, null);
  assert.deepEqual(boxesView(null, null), []);
});

test('shelves: one per kind of box, in order', () => {
  const s = shelvesOf(boxesView(WALL, DONE));
  assert.deepEqual(s.map((x) => [x.box, x.boxes.length]), [['big', 2], ['box', 1], ['dvd', 1], ['jewel', 1]]);
});

test('monitor: the most recently played with art leads, undated games after', () => {
  const m = monitorView(boxesView(WALL, DONE));
  assert.equal(m?.lead.name, 'Middling');
  assert.deepEqual(m?.row.map((x) => x.name), ['Middling', 'Big One', 'League of Legends', 'Barely']);
  assert.equal(m?.row[0].on, true);
  assert.equal(m?.n, 4);
  assert.equal(monitorView(boxesView(WALL.slice(0, 2), []))?.n, 1, 'fewer than four: one, still');
  assert.equal(monitorView([]), null);
});

test('telly: five channels or one, never a part cycle', () => {
  const tile = (i) => ({ title: `T${i}`, poster: 'https://image.tmdb.org/t/p/w342/x.jpg', month: '2026-0' + (9 - i), series: false, seasonsLabel: '', monthLabel: 'x' });
  assert.equal(tvView([0, 1, 2, 3, 4, 5].map(tile), '2026')?.n, 5);
  assert.equal(tvView([0, 1, 2].map(tile), '2026')?.n, 1);
  assert.equal(tvView([{ ...tile(0), poster: '' }], '2026'), null);
});
