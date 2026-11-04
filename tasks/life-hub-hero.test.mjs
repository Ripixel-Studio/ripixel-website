// @ts-check
// The hero hub (C8): heroes, card sizes, the layout classes and the fallback to the rows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generatePagesTask } from 'skier';
import { buildHub, heroCards, heroView, isoWeekMonday, routeSketch, lifeInsights } from './life-hub.mjs';
import { runSkierTasks } from './skier-test-runner.mjs';
import { templateHelpers } from './life-pages.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = JSON.parse(await fs.readFile(path.join(REPO, 'fixtures/fitness/life/index.json'), 'utf8'));
const now = new Date('2026-11-03T08:00:00Z');
const fitnessLife = { stats: { strip: [{ value: '614', unit: '', label: 'activities' }] } };
const rowOf = (/** @type {string} */ name) => fixture.hub.rows.find((/** @type {any} */ r) => r.section === name);

test('ISO week labels become Monday dates', () => {
  assert.equal(isoWeekMonday('2026-W45'), '2026-11-02');
  assert.equal(isoWeekMonday('2026-W34'), '2026-08-17');
  assert.equal(isoWeekMonday('2026-W01'), '2025-12-29');
  assert.equal(isoWeekMonday('2026-W53'), '2026-12-28'); // 2026 starts on a Thursday: 53 weeks
  assert.equal(isoWeekMonday('2025-W53'), ''); // 2025 has 52
  for (const bad of ['2026-11-02', '2026-W00', '2026-W54', 'W45', null, 45]) assert.equal(isoWeekMonday(bad), '', String(bad));
});

test('image hero: https or a site path, lazy, with alt', () => {
  assert.deepEqual(heroView({ type: 'image', src: 'https://cdn.example.com/a.jpg', alt: 'Space Farm' }, 'Games'),
    { type: 'image', image: true, src: 'https://cdn.example.com/a.jpg', alt: 'Space Farm' });
  assert.equal(heroView({ type: 'image', src: '/card_life.png' }, 'Games')?.alt, 'Games');
  for (const src of ['http://x.example/a.jpg', 'javascript:alert(1)', '//evil.example/a.jpg', '/\\evil.example/x.png', '/a\\b.png', 'https://x.example\\@evil.example/a.png', 'https://x.example/a b.jpg', '', null]) {
    assert.equal(heroView({ type: 'image', src, alt: 'x' }), null, String(src));
  }
});

test('spark hero: week labels on the shared line chart, compact', () => {
  const h = heroView(rowOf('body').hero, 'Body');
  assert.equal(h?.type, 'spark');
  const c = /** @type {any} */ (h).chart;
  assert.equal(c.h, 90);
  assert.equal(c.label, 'sleep');
  assert.equal(c.unit, 'h');
  assert.deepEqual(c.xTicks.map((/** @type {any} */ t) => t.label), ['17 Aug', '21 Sep', '2 Nov']);
  assert.equal(c.end.label, '7.1');
  assert.ok(c.yTicks.length >= 2 && c.d.startsWith('M'));
  // out of order and junk labels: sorted, dropped
  const mixed = heroView({ type: 'spark', points: [['2026-W45', 3], ['nope', 9], ['2026-W44', 2]], label: 'x', unit: '' });
  assert.match(/** @type {any} */ (mixed).chart.summary, /2 weeks: 2 to 3$/);
  // across a 53-week year end, in the export's "YYYY-Www" form
  const ny = /** @type {any} */ (heroView({ type: 'spark', points: [['2026-W52', 1], ['2026-W53', 2], ['2027-W01', 3], ['2027-W02', 2.5]], label: 'x', unit: 'kg' })).chart;
  assert.deepEqual(ny.xTicks.map((/** @type {any} */ t) => t.label), ['21 Dec', '28 Dec', '11 Jan']);
  assert.equal(ny.end.label, '2.5');
  assert.equal(heroView({ type: 'spark', points: [['2026-W45', 3]] }), null);
  assert.equal(heroView({ type: 'spark', points: 'x' }), null);
});

test('stat hero: the big number', () => {
  assert.deepEqual(heroView(rowOf('code').hero), { type: 'stat', stat: true, value: '212', unit: '', label: 'commits this month' });
  assert.equal(heroView({ type: 'stat', value: 12345, unit: 'km', label: 'x' })?.value, '12,345');
  assert.equal(heroView({ type: 'stat', value: 7.14, label: 'x' })?.value, '7.1');
  assert.equal(heroView({ type: 'stat', value: '4:59', label: '5K PB' })?.value, '4:59');
  assert.equal(heroView({ type: 'stat', value: null, label: 'x' }), null);
});

test('route hero: a mini SVG inside its box, linked to the activity', () => {
  const h = /** @type {any} */ (heroView(rowOf('fitness').hero));
  assert.equal(h.type, 'route');
  assert.equal(h.href, '/life/activity/evening-ride-to-the-reservoir-2026-10-15');
  assert.match(h.d, /^M[\d.]+,[\d.]+( L[\d.]+,[\d.]+)+$/);
  const xy = [...h.d.matchAll(/([\d.]+),([\d.]+)/g)].map((m) => [+m[1], +m[2]]);
  assert.equal(xy.length, rowOf('fitness').hero.points.length);
  assert.ok(xy.every(([x, y]) => x >= 0 && x <= h.w && y >= 0 && y <= h.h));
  // north is up: the route heads north-east, so it ends higher and further right than it starts
  assert.ok(h.end.y < h.start.y && h.end.x > h.start.x);
  assert.equal(heroView({ type: 'route', slug: '../x', points: rowOf('fitness').hero.points })?.href, '');
  assert.equal(heroView({ type: 'route', slug: 'a', points: [[52.9, -1.2]] }), null);
  assert.equal(heroView({ type: 'route', slug: 'a', points: [[0, 0], [52.9, -1.2]] }), null);
  // a dead-straight east-west line still fits
  const flat = /** @type {any} */ (routeSketch([[52.9, -1.2], [52.9, -1.1]]));
  assert.equal(flat.start.y, flat.end.y);
  assert.ok(flat.start.x >= 0 && flat.end.x <= flat.w);
});

test('bars hero: the life-split items', () => {
  const h = /** @type {any} */ (heroView(rowOf('reading').hero));
  assert.equal(h.type, 'bars');
  assert.deepEqual(h.items.map((/** @type {any} */ i) => [i.key, i.label, i.pct]), [['sci-fi', 'Sci-fi', 48], ['fantasy', 'Fantasy', 30], ['non-fiction', 'Non-fiction', 22]]);
  const t = /** @type {any} */ (heroView({ type: 'bars', items: [{ label: 'TypeScript', pct: 91.6 }, { label: 'CSS', pct: 8.4 }, { label: '', pct: 5 }, { label: 'Go', pct: 0 }] }));
  assert.deepEqual(t.items.map((/** @type {any} */ i) => [i.label, i.pct, i.narrow]), [['TypeScript', 92, false], ['CSS', 8, true]]);
  assert.equal(heroView({ type: 'bars', items: [] }), null);
});

test('unknown hero types draw nothing', () => {
  for (const h of [null, {}, { type: 'video', src: 'https://x.example/a.mp4' }, 'stat']) assert.equal(heroView(h), null);
});

test('hero cards: export order, sizes, zig-zag and headlines', () => {
  const hub = buildHub(fixture, fitnessLife, now);
  const cards = hub.hero;
  assert.deepEqual(cards.map((c) => c.name), fixture.hub.rows.map((/** @type {any} */ r) => r.section));
  assert.deepEqual(cards.map((c) => c.size), ['lg', 'lg', 'md', 'md', 'md', 'sm', 'sm', 'sm']);
  assert.deepEqual(cards.map((c) => c.side), ['left', 'right', '', '', '', '', '', '']);
  assert.deepEqual(cards.map((c) => c.hero?.type ?? null), ['route', 'stat', 'spark', 'image', 'bars', 'stat', null, null]);
  // the section's own headline, as the rows had it
  const byName = Object.fromEntries(hub.cards.map((c) => [c.name, c]));
  for (const c of cards) if (byName[c.name]) assert.deepEqual(c.headline, byName[c.name].headline, c.name);
  assert.equal(cards[0].headline?.value, '614');
  assert.equal(cards.find((c) => c.name === 'live')?.title, 'Live');
  assert.equal(cards.find((c) => c.name === 'live')?.headline?.value, '3');
  // outings has its own page like the rest (the export's href is /life/live)
  assert.equal(cards.find((c) => c.name === 'live')?.href, '/life/live');
  assert.equal(cards[0].href, '/life/fitness');
  assert.equal(cards[0].caption, '6.2 km of fresh line, legs mostly intact.');
});

test('a row without a usable hero drops to a slim row', () => {
  const idx = { ...fixture, hub: { rows: [
    { section: 'games', size: 'lg', href: '/life/games', hero: { type: 'image', src: 'http://insecure.example/a.jpg', caption: 'x' } },
    { section: 'code', size: 'huge', href: '/life/code', hero: { type: 'stat', value: 3, label: 'y', caption: 'z' } },
    { section: 'code', size: 'lg', href: '/life/code', hero: null },
    { section: 'reading', size: 'md', href: 'https://evil.example', hero: null, caption: 'ignored' },
    { section: '<b>', size: 'lg', hero: null },
  ] } };
  const cards = heroCards(idx, buildHub(fixture, fitnessLife, now).cards, now);
  assert.deepEqual(cards.map((c) => [c.name, c.size, c.side]), [['games', 'sm', ''], ['code', 'md', ''], ['reading', 'sm', '']]);
  assert.equal(cards[2].href, '/life/reading');
  assert.equal(cards[2].caption, '');
  assert.equal(cards[0].caption, '', 'a rejected hero leaves no orphan caption');
  assert.equal(cards[1].caption, 'z');
});

test('a caption is plain text, and an over-long one is dropped', () => {
  const rows = [
    { section: 'code', size: 'md', hero: { type: 'stat', value: 1, label: 'x', caption: '  <b>bold</b>\n claim ' } },
    { section: 'body', size: 'md', hero: { type: 'stat', value: 1, label: 'x', caption: 'a'.repeat(241) } },
  ];
  const cards = heroCards({ ...fixture, hub: { rows } }, [], now);
  assert.equal(cards[0].caption, '<b>bold</b> claim'); // escaped by the template, never trusted as markup
  assert.equal(cards[1].caption, '');
});

test('no hub key (an older export): no hero cards', () => {
  const { hub: _drop, ...old } = fixture;
  assert.deepEqual(buildHub(old, fitnessLife, now).hero, []);
  assert.deepEqual(buildHub(null, fitnessLife, now).hero, []);
  assert.deepEqual(buildHub({ ...fixture, hub: { rows: 'x' } }, fitnessLife, now).hero, []);
});

/** Render personal/pages/life.html with the hub built from `idx`. @param {any} idx */
async function renderHub(idx) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'life-hub-page-'));
  try {
    const pages = path.join(tmp, 'pages');
    await fs.mkdir(pages);
    await fs.copyFile(path.join(REPO, 'personal/pages/life.html'), path.join(pages, 'life.html'));
    const out = path.join(tmp, 'out');
    const lifeHub = buildHub(idx, fitnessLife, now);
    await runSkierTasks([generatePagesTask({
      pagesDir: pages, partialsDir: path.join(REPO, 'personal/partials'), outDir: out, helpers: templateHelpers,
      additionalVarsFn: () => ({ page: 'life', lifeHub, lifeInsights: lifeInsights(idx), lifePersonal: [], fitnessLife }),
    })], { siteUrl: 'https://james.ripixel.co.uk', cacheHash: 'test', year: 2026 }, []);
    return await fs.readFile(path.join(out, 'life.html'), 'utf8');
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

test('the page: a card per row, sized, each hero drawn, heading and insights kept', async () => {
  const html = await renderHub(fixture);
  assert.match(html, /James, by the <span>numbers<\/span>\./);
  assert.match(html, /class="did-you-know"/);
  assert.ok(html.indexOf('did-you-know') < html.indexOf('hub-grid'));
  assert.doesNotMatch(html, /class="life-index"/);
  const cards = html.match(/<li class="hub-card [^"]*"/g) || [];
  assert.deepEqual(cards.map((c) => /hub-card--(lg|md|sm)/.exec(c)?.[1]), ['lg', 'lg', 'md', 'md', 'md', 'sm', 'sm', 'sm']);
  assert.match(cards[0], /hub-card--left hub-card--route life-ink--fitness/);
  assert.match(cards[1], /hub-card--right hub-card--stat life-ink--code/);
  // image: lazy, fixed size, alt
  assert.match(html, /<img class="hub-hero__img" src="\/card_life.png" alt="Space Farm" loading="lazy" decoding="async" width="400" height="600">/);
  // spark: the shared chart partial, with axes
  assert.match(html, /<figure class="chart">[\s\S]*?class="chart__y"[\s\S]*?class="chart__x"/);
  assert.match(html, /<li style="left:100%">2 Nov<\/li>/);
  // stat
  assert.match(html, /<b class="hub-hero__value">212<\/b> <span class="hub-hero__what">commits this month<\/span>/);
  // route: an SVG, no tiles, linked to the full map
  assert.match(html, /<a class="hub-hero__route" href="\/life\/activity\/evening-ride-to-the-reservoir-2026-10-15">\s*<svg class="hub-hero__map"/);
  assert.doesNotMatch(html, /leaflet|route-map\.js/i);
  // bars: the life-split partial
  assert.match(html, /<figure class="life-split life-split--hub">[\s\S]*?Non-fiction/);
  // captions as text, sub-page links
  assert.match(html, /<p class="hub-card__caption">Sci-fi leads the shelf at 48%.<\/p>/);
  assert.match(html, /<a class="hub-card__more" href="\/life\/reading" aria-label="More on Reading">/);
  // sm rows show no hero, only the caption
  const outings = /<li class="hub-card hub-card--sm hub-card--stat life-ink--live">[\s\S]*?<\/li>/.exec(html)?.[0] || '';
  assert.doesNotMatch(outings, /hub-hero/);
  assert.match(outings, /9 live events this year\./);
  assert.match(outings, /href="\/life\/live"/);
  assert.doesNotMatch(html, /id="life-outings-title"/);
});

test('the page escapes a caption', async () => {
  const idx = { ...fixture, hub: { rows: [{ section: 'code', size: 'md', href: '/life/code', hero: { type: 'stat', value: 1, label: 'x', caption: '<script>alert(1)</script>' } }] } };
  const html = await renderHub(idx);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('the page without a hub key: the old rows', async () => {
  const { hub: _drop, ...old } = fixture;
  const html = await renderHub(old);
  assert.match(html, /James, by the <span>numbers<\/span>\./);
  assert.match(html, /class="did-you-know"/);
  assert.doesNotMatch(html, /hub-grid|hub-card/);
  assert.equal((html.match(/<li class="life-index__entry/g) || []).length, 8);
});

test('the page keeps the stale sticker (the roundup links: life-links.test.mjs)', async () => {
  const html = await renderHub(fixture);
  const reading = html.split('<li class="hub-card ').find((c) => c.includes('life-ink--reading">')) || '';
  assert.match(reading, /<p class="life-stale">last updated 4 days ago<\/p>/);
  assert.equal(buildHub(fixture, fitnessLife, now).hero.find((c) => c.name === 'body')?.staleLabel, '');
});

test('a stat hero equal to the headline hides the small headline; a different one keeps it', () => {
  const base = buildHub(fixture, fitnessLife, now).cards.find((c) => c.name === 'code');
  assert.ok(base?.headline, 'fixture code card has a headline');
  const mk = (/** @type {any} */ value) => heroCards({ ...fixture, hub: { rows: [{ section: 'code', size: 'md', hero: { type: 'stat', value, unit: 'commits', label: 'this year' } }] } }, [base], now)[0];
  const same = Number(String(base.headline.value).replace(/,/g, ''));
  assert.equal(mk(same).headline, null, 'duplicate figure hidden');
  assert.equal(mk(same).hero.value, base.headline.value);
  assert.deepEqual(mk(same + 1).headline, base.headline, 'different figure keeps the headline');
});

test('a hidden duplicate headline is not "empty"; a section with no data is', () => {
  const base = buildHub(fixture, fitnessLife, now).cards.find((c) => c.name === 'code');
  const same = Number(String(base.headline.value).replace(/,/g, ''));
  const row = { section: 'code', size: 'md', hero: { type: 'stat', value: same, unit: 'commits', label: 'this year' } };
  const dup = heroCards({ ...fixture, hub: { rows: [row] } }, [base], now)[0];
  assert.equal(dup.headline, null);
  assert.equal(dup.empty, false, 'template must render nothing, not "No code data yet."');
  const none = heroCards({ ...fixture, hub: { rows: [{ section: 'code', size: 'sm', hero: null }] } }, [{ ...base, empty: true }], now)[0];
  assert.equal(none.empty, true);
});
