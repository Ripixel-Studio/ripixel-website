import test from 'node:test';
import assert from 'node:assert/strict';
import { readingView, listeningView, shelfArt } from './life-shelves.mjs';

const COVER = 'https://m.media-amazon.com/images/I/51HIZdnqASL._SL500_.jpg';

test('shelfArt: only the known image hosts, as plain URLs', () => {
  assert.equal(shelfArt(COVER), COVER);
  assert.equal(shelfArt('https://i.ytimg.com/vi/QOZpqXnM-Os/hqdefault.jpg'), 'https://i.ytimg.com/vi/QOZpqXnM-Os/hqdefault.jpg');
  assert.equal(shelfArt('https://evil.example/x.jpg'), '');
  assert.equal(shelfArt("https://m.media-amazon.com/images/I/x.jpg');background:url(x"), '');
  assert.equal(shelfArt(null), '');
});

test('readingView: one bookcase, a bookend before each year, spines sized by length', () => {
  const v = readingView({
    bookStats: { finished: 3, hours: 40, authors: 2, owned: 5, unstarted: 2, pileHours: 30, since: '2024' },
    shelf: [
      { key: 'a', title: 'Long (Dramatized Adaptation)', by: 'X', cover: COVER, hours: 40, finished: '2026-03' },
      { key: 'b', title: 'Short', by: 'Y', cover: 'https://evil.example/c.jpg', hours: 3, finished: '2026-01' },
      { key: 'c', title: 'Old', by: 'Y', hours: 9, finished: '2024-05' },
    ],
    byYear: [{ year: '2024', books: 1, hours: 9 }, { year: '2026', books: 2, hours: 43 }],
    longest: { title: 'Long', by: 'X', value: 40 },
    slowBurn: { title: 'Old', value: 800 },
  });
  assert.deepEqual(v.shelf.map((s) => (s.bookend ? `[${s.year}]` : s.key)), ['[2026]', 'a', 'b', '[2024]', 'c']);
  const [, long, short] = v.shelf;
  assert.ok(long.width > short.width);
  assert.equal(long.spineTitle, 'Long');
  assert.equal(short.cover, '');                     // a foreign host never reaches a style attribute
  assert.equal(v.facts.find((f) => f.kicker === 'the slow burn').big, '2 yrs');
  assert.equal(v.numbers[0].value, '3');
});

test('listeningView: lately until a song comes back on a second day, then on repeat', () => {
  const base = { music: { loves: 10, plays: 4 }, onRepeat: [{ title: 'T', by: 'A', days: 1 }] };
  assert.equal(listeningView(base).repeatTitle, 'lately');
  assert.equal(listeningView({ ...base, repeatDays: 3, onRepeat: [{ title: 'T', by: 'A', days: 3 }] }).repeatTitle, 'on repeat');
  const v = listeningView({ ...base, lovedArtists: [{ name: 'Big', loves: 30 }, { name: 'Small', loves: 3 }],
    topArtists: [{ name: 'A', plays: 8 }, { name: 'B', plays: 2 }] });
  assert.equal(v.poster.find((p) => p.name === 'Big').size, 5);
  assert.equal(v.poster.find((p) => p.name === 'Small').size, 1);
  assert.deepEqual(v.chart.map((c) => c.pct), [100, 25]);
});

test('hub notes: the last book finished, the most loved artist', async () => {
  const { buildSection, hubNote } = await import('./life-hub.mjs');
  const r = buildSection('reading', { updated: '2026-11-07', staleDays: 0, headline: { value: 1, unit: '', label: 'x' }, notable: [],
    totals: { year: { books: 1 } }, shelf: [{ title: 'Newest', by: 'Ann', finished: '2026-11', hours: 9 }] });
  assert.deepEqual(hubNote('reading', r), { label: 'Last finished', value: 'Newest, Ann', href: '' });
  const l = buildSection('listening', { updated: '2026-11-07', staleDays: 0, headline: { value: 1, unit: '', label: 'x' }, notable: [],
    totals: { year: { tracks: 1 } }, lovedArtists: [{ name: 'Small', loves: 3 }, { name: 'Big', loves: 30 }] });
  assert.deepEqual(hubNote('listening', l), { label: 'Most loved', value: 'Big, 30 songs liked', href: '' });
});
