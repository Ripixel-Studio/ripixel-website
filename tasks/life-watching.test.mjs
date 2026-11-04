// @ts-check
// /life/watching: the poster wall, the year by month, the YouTube channels and the estimated hours.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { buildSection, buildHub, heroView, safeMedia } from './life-hub.mjs';

const fixture = JSON.parse(await fs.readFile(new URL('../fixtures/fitness/life/index.json', import.meta.url), 'utf8'));
const now = new Date('2026-11-03T08:00:00Z');
const w = () => /** @type {any} */ (buildSection('watching', fixture.sections.watching, now));

test('media images only from TMDB and YouTube image hosts', () => {
  for (const ok of ['https://image.tmdb.org/t/p/w342/a.jpg', 'https://i.ytimg.com/vi/abcdefghij1/mqdefault.jpg',
    'https://yt3.ggpht.com/AbC_1-x=s176-c-k-c0x00ffffff-no-rj', 'https://yt3.googleusercontent.com/x=s176']) {
    assert.equal(safeMedia(ok), ok, ok);
  }
  for (const bad of ['http://image.tmdb.org/a.jpg', 'https://evil.example/a.jpg', 'https://image.tmdb.org.evil.example/a.jpg',
    'https://i.ytimg.com/vi/x"onerror=1/a.jpg', 'javascript:alert(1)', '', null, 7]) {
    assert.equal(safeMedia(bad), '', String(bad));
  }
});

test('the wall: films and series as posters, newest first, big screen and binges marked', () => {
  const v = w();
  assert.ok(v.wall.length >= 12, 'a full wall from the fixture');
  assert.deepEqual(v.wall.slice(0, 2).map((/** @type {any} */ t) => t.title), ['Lanterns of the Quiet Coast', 'The Invented Harbour']);
  const big = v.wall.find((/** @type {any} */ t) => t.bigScreen);
  assert.ok(big && big.kind === 'film');
  const binged = v.wall.find((/** @type {any} */ t) => t.title === 'Lanterns of the Quiet Coast');
  assert.equal(binged.weight, 2);
  assert.equal(binged.reason, 'binged season 1 in 4 days');
  assert.equal(binged.seasonsLabel, 'season 1');
  assert.equal(binged.monthLabel, 'Nov 2026');
  const two = v.wall.find((/** @type {any} */ t) => t.title === 'Sample Precinct');
  assert.equal(two.seasonsLabel, 'seasons 7–8');
  // a poster from anywhere else is dropped and the tile is set in type
  const typed = v.wall.find((/** @type {any} */ t) => t.title === 'A Film With No Poster');
  assert.equal(typed.poster, '');
  assert.ok(v.wall.every((/** @type {any} */ t) => typeof t.tilt === 'number' && t.ink >= 0 && t.ink < 5));
});

test('the year by month: twelve months, mini posters by key, quiet months flagged', () => {
  const v = w();
  assert.equal(v.strip.length, 12);
  assert.equal(v.strip.at(-1).label, 'Nov');
  const oct = v.strip.find((/** @type {any} */ m) => m.month === '2026-10');
  assert.ok(oct.posters.length >= 1 && oct.posters.length <= 3);
  assert.ok(oct.posters.every((/** @type {any} */ p) => p.title));
  assert.equal(oct.counts, '1 film · 27 episodes · 100 videos');
  assert.ok(oct.epPct > 0 && oct.epPct <= 100 && oct.vidPct > 0 && oct.vidPct <= 100);
  const quiet = v.strip.find((/** @type {any} */ m) => !m.films && !m.episodes && !m.videos);
  assert.ok(quiet && quiet.quiet === true);
});

test('YouTube channels: the habit, avatar or initials, thumbnails, rhythm, plain reasons', () => {
  const v = w();
  assert.ok(v.channels.length >= 4);
  const lead = v.channels[0];
  assert.equal(lead.lead, true);
  assert.equal(lead.title, 'Shed Days');
  assert.equal(lead.reason, 'watched most weeks since March');
  assert.equal(lead.ruleLabel, 'habit');
  assert.ok(lead.avatar.startsWith('https://yt3.'));
  assert.equal(lead.thumbs.length, 3);
  assert.deepEqual(lead.stats, ['68 days', '74 videos', '5% of my YouTube']);
  assert.equal(lead.rhythm.length, 26);
  assert.ok(lead.rhythm.every((/** @type {any} */ r) => r.level >= 0 && r.level <= 3));
  const bare = v.channels.find((/** @type {any} */ c) => !c.avatar);
  assert.ok(bare && bare.initials.length >= 1 && bare.initials.length <= 2);
  const fresh = v.channels.find((/** @type {any} */ c) => c.ruleLabel === 'new');
  assert.ok(fresh, 'a new obsession in the fixture');
  assert.ok(!JSON.stringify(v.channels).includes('sustained'));
});

test('hours: an estimate from runtimes, or no row at all; YouTube is days, never hours', () => {
  const v = w();
  const year = v.stats[0].items;
  const hours = year.find((/** @type {any} */ r) => r.label === 'Film and TV');
  assert.ok(hours && hours.value.startsWith('≈') && hours.unit === 'h' && /estimate/i.test(hours.sub));
  assert.ok(year.some((/** @type {any} */ r) => r.label === 'YouTube days'));
  const noHours = /** @type {any} */ (buildSection('watching', { ...fixture.sections.watching,
    totals: { year: { films: 2, hours: null }, month: { films: 0, hours: 0 } } }, now));
  assert.ok(!JSON.stringify(noHours.stats).includes('Film and TV'));
  assert.ok(!/\b0 ?h\b/.test(JSON.stringify(noHours.stats)));
});

test('an older export without the wall still renders its notables', () => {
  const old = /** @type {any} */ (buildSection('watching', { staleDays: 0, headline: { value: 1, unit: '', label: 'x' },
    notable: [{ key: 'k', kind: 'film', title: 'Old Shape', month: '2026-10', poster: null }], totals: { year: { films: 1 }, month: {} } }, now));
  assert.deepEqual(old.wall, []);
  assert.deepEqual(old.channels, []);
  assert.equal(old.notable[0].title, 'Old Shape');
});

test('posters hero: three or four safe posters fanned, else nothing', () => {
  const h = /** @type {any} */ (heroView({ type: 'posters', items: [
    { src: 'https://image.tmdb.org/t/p/w342/a.jpg', alt: 'One' }, { src: 'https://image.tmdb.org/t/p/w342/b.jpg', alt: 'Two' },
    { src: 'https://image.tmdb.org/t/p/w342/c.jpg', alt: 'Three' }] }, 'Watching'));
  assert.equal(h.type, 'posters');
  assert.equal(h.posters, true);
  assert.deepEqual(h.items.map((/** @type {any} */ i) => i.alt), ['One', 'Two', 'Three']);
  assert.equal(heroView({ type: 'posters', items: [{ src: 'https://evil.example/a.jpg', alt: 'x' },
    { src: 'https://image.tmdb.org/t/p/w342/b.jpg', alt: 'Two' }, { src: 'https://image.tmdb.org/t/p/w342/c.jpg', alt: 'Three' }] }), null);
  const hub = buildHub(fixture, { stats: { strip: [{ value: '1', unit: '', label: 'x' }] } }, now);
  const card = hub.hero.find((/** @type {any} */ c) => c.name === 'watching');
  assert.equal(card?.hero?.type, 'posters');
});

test('the wall as laid out: a year card leads each year, cinema tiles do not repeat the stamp', () => {
  const v = w();
  const marks = v.wallTiles.filter((/** @type {any} */ t) => t.yearMark);
  assert.deepEqual(marks.map((/** @type {any} */ m) => m.year), ['2026', '2025', '2024', '2021']);
  assert.equal(v.wallTiles[0].yearMark, true);
  assert.equal(marks[0].count, v.wall.filter((/** @type {any} */ t) => t.month.startsWith('2026')).length);
  const big = v.wall.find((/** @type {any} */ t) => t.bigScreen);
  assert.equal(big.reason, '');
});
