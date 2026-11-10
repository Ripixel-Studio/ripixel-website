// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { afterShowView, encoresView, connectsView, playsLine, playsStrip, stamp } from './life-rel.mjs';

const ART = 'https://example.org/a.jpg';

const LIVE = {
  playsSpan: { from: '2019-01', to: '2019-06' },
  afterShow: [
    { title: 'Lantern Musical', month: '2024-02', form: 'musical', art: ART,
      elsewhere: [{ page: 'watching', kind: 'film', title: 'Lantern', art: ART }] },
    { title: 'Copper Kites', month: '2019-03', form: 'gig', art: 'http://insecure.example/x.jpg',
      elsewhere: [{ page: 'listening', kind: 'artist', title: 'Copper Kites', plays: 9, before: 2, during: 1, after: 6, months: [1, 1, 1, 0, 3, 3] }] },
    { title: 'Dot Pemberton', month: '2023-01', form: 'comedy',
      elsewhere: [{ page: 'reading', kind: 'book', title: "Dot Pemberton's Notebook", by: 'Dot Pemberton' }] },
    { title: 'Bad Month', month: '2023-13', elsewhere: [{ page: 'watching', kind: 'film', title: 'X' }] },
    { title: 'Nowhere', month: '2023-01', elsewhere: [{ page: 'nope', title: 'X' }] },
  ],
  encores: [
    { title: 'Hollow Choir', nights: [{ title: 'Hollow Choir', month: '2025-12', form: 'musical' }, { title: 'Hollow Choir', month: '2026-04', form: 'musical', art: ART }] },
    { title: 'Once', nights: [{ title: 'Once', month: '2025-01' }] },
  ],
};

test('after the show: music first, odd rows out, pictures https only', () => {
  const v = afterShowView(LIVE);
  assert.deepEqual(v.map((r) => r.title), ['Copper Kites', 'Lantern Musical', 'Dot Pemberton']);
  assert.equal(v[0].art, '');
  assert.equal(v[0].links[0].line, '2 plays before the night, 6 since.');
  assert.equal(v[0].links[0].strip.mark, 2 * 3 + 1);
  assert.equal(v[1].links[0].line, 'Lantern, the film, on the rental wall');
  assert.equal(v[2].links[0].line, "Dot Pemberton's Notebook, on the bookshelf");
  assert.equal(v[2].kindLabel, 'Comedy');
});

test('plays lines say what happened, honestly', () => {
  const p = { name: 'A', plays: 0, from: '2018-11' };
  assert.match(playsLine({ ...p, before: null, during: 0, after: 8 }), /^Seen before the plays were counted \(from Nov 2018\)\. 8 plays of A since\.$/);
  assert.equal(playsLine({ ...p, before: 0, during: 5, after: 31 }), 'Never played before the night. 36 plays since.');
  assert.equal(playsLine({ ...p, before: 36, during: 0, after: 0 }), '36 plays before the night. Not one since.');
  assert.equal(playsLine({ ...p, before: 30, during: 30, after: 48 }), '30 plays the month I went, 30 before, 48 since.');
  assert.equal(playsStrip([1], '2019-01', '2019-01'), null);
  const early = playsStrip([0, 4, 1], '2019-01', '2016-03');
  assert.equal(early?.early, true);
  assert.equal(early?.mark, 1);
  assert.equal(early?.bars.length, 2);
});

test('encores: two nights or more', () => {
  const v = encoresView(LIVE);
  assert.equal(v.length, 1);
  assert.equal(v[0].times, 'Twice');
  assert.deepEqual(v[0].nights.map((n) => n.stamp), ['Dec 2025', 'Apr 2026']);
  assert.equal(stamp('2016-03'), 'Mar 2016');
});

test('connects: genres need two pages, threads two cards', () => {
  const v = connectsView({
    genres: [
      { genre: 'Comedy', shelves: [{ page: 'watching', n: 76, of: 181, share: 42, eg: 'Some Film' }, { page: 'games', n: 48, of: 228 }, { page: 'live', n: 99, of: 3 }] },
      { genre: 'Lonely', shelves: [{ page: 'reading', n: 2, of: 9 }] },
    ],
    threads: [
      { title: 'Rift Duel', elsewhere: [{ page: 'games', kind: 'game', hours: 281, art: ART }, { page: 'listening', kind: 'soundtrack', plays: 627 }] },
      { title: 'Star Barge', elsewhere: [{ page: 'reading', kind: 'book' }, { page: 'watching', kind: 'film', month: '2021-10', bigScreen: true }] },
      { title: 'Half', elsewhere: [{ page: 'games' }, { page: 'nowhere' }] },
    ],
  });
  assert.ok(v);
  assert.deepEqual(v.genres.map((g) => g.genre), ['Comedy']);
  assert.deepEqual(v.genres[0].shelves.map((s) => [s.page, s.share, s.what]), [['watching', 42, 'films and shows'], ['games', 21, 'games']]);
  assert.deepEqual(v.threads.map((t) => t.title), ['Rift Duel', 'Star Barge']);
  assert.deepEqual(v.threads[0].cards.map((c) => c.say), ['281 hours played', '627 plays of the soundtrack']);
  assert.equal(v.threads[1].cards[1].say, 'watched Oct 2021, big screen');
  assert.equal(connectsView(null), null);
  assert.equal(connectsView({ genres: [], threads: [] }), null);
});
