// @ts-check
// Run with `npm test`. The render tests go through sharp for real (one card ≈ 100 ms).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

import { activityCard, roundupCard, renderFitnessCards, fitnessOgImagesTask } from './fitness-og-images.mjs';
import { fitTitle, buildFitnessCardSVG, buildSectionSVG, woffToSfnt, ensureFonts, PAGES, CARD_W, CARD_H } from '../scripts/generate-og-images.mjs';
import { loadFitnessData } from './fitness-fetch.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = path.join(REPO, 'fixtures', 'fitness');
const require = createRequire(import.meta.url);

async function fixtures() {
  return loadFitnessData({ env: {}, source: 'fixtures', fixturesDir: FIXTURES });
}

describe('card content', () => {
  test('activity: page title, type · date · location kicker, the four anchor cells, PR stamp', async () => {
    const { activities, index } = await fixtures();
    const c = activityCard(activities.find((a) => a.slug === 'colwick-parkrun-2026-10-17'), index);
    assert.ok(c);
    assert.equal(c.id, 'colwick-parkrun-2026-10-17');
    assert.equal(c.kind, 'activity');
    assert.equal(c.card.kicker, 'RUN · SAT 17 OCT 2026 · COLWICK PARK, NOTTINGHAM');
    assert.equal(c.card.title, 'Colwick parkrun #87');
    assert.deepEqual(c.card.stats.map((s) => `${s.value}${s.unit ? ' ' + s.unit : ''}|${s.label}`), ['5.01 km|distance', '19:52|time', '3:58 /km|avg pace', '171 bpm|avg hr']);
    assert.equal(c.card.footnote, '+1 PERSONAL RECORD');
    assert.equal(c.card.pill, 'FITNESS');
  });
  test('activity: no PRs → VIA <source> stamp; strength cells; unsafe slug → null', async () => {
    const { activities, index } = await fixtures();
    const ride = activityCard(activities.find((a) => a.slug === 'evening-ride-to-the-reservoir-2026-10-15'), index);
    assert.equal(ride?.card.footnote, 'VIA STRAVA');
    const push = activityCard(activities.find((a) => a.slug === 'push-day-2026-10-13'), index);
    assert.deepEqual(push?.card.stats.map((s) => s.label), ['sets', 'volume moved', 'duration', 'personal records']);
    assert.equal(activityCard({ slug: '../escape', activity: {}, entry: {} }, index), null);
  });
  test('roundup: period kicker + range, big period title, the 4-up totals', async () => {
    const { roundups } = await fixtures();
    const c = roundupCard(roundups[0]);
    assert.ok(c);
    assert.equal(c.id, 'week-42-2026');
    assert.equal(c.kind, 'roundup');
    assert.equal(c.card.kicker, 'WEEKLY ROUNDUP · 12 OCT — 18 OCT 2026');
    assert.equal(c.card.title, 'WEEK 42');
    assert.deepEqual(c.card.stats.map((s) => s.label), ['sessions logged', 'total time', 'distance covered', 'calories burned']);
    assert.equal(c.card.footnote, '+3 PERSONAL RECORDS');
    assert.equal(c.card.pill, 'ROUNDUP');
  });
  test('roundup: year title reads "<year> IN REVIEW"; bad key → null', () => {
    const c = roundupCard({ key: 'year-2026', roundup: { periodType: 'ROUNDUP_PERIOD_TYPE_YEAR', periodStart: '2026-01-01T00:00:00Z', periodEnd: '2027-01-01T00:00:00Z', totalActivities: 300, totalDurationSeconds: 3600 } });
    assert.equal(c?.card.title, '2026 IN REVIEW');
    assert.equal(c?.card.footnote, '');
    assert.equal(roundupCard({ key: 'month-2026-10', roundup: {} }), null);
    assert.equal(roundupCard(null), null);
  });
});

describe('drawing', () => {
  test('fitTitle: one line when it fits, two lines when it must, ellipsis beyond that', () => {
    assert.deepEqual(fitTitle('PUSH DAY'), { size: 150, lines: ['PUSH DAY'] });
    assert.equal(fitTitle('COLWICK PARKRUN #87').lines.length, 1);
    const two = fitTitle('EVENING RIDE TO THE RESERVOIR');
    assert.equal(two.lines.length, 2);
    assert.ok(two.size <= 112);
    const long = fitTitle('A VERY LONG TITLE THAT GOES ON AND ON AND ON AND ON AND ON AND ON AND ON AND ON AND ON AND ON');
    assert.equal(long.lines.length, 2);
    assert.match(long.lines[1], /…$/);
    assert.deepEqual(fitTitle('   '), { size: 150, lines: ['ACTIVITY'] });
  });
  test('buildFitnessCardSVG escapes text, uppercases the title, draws ≤ 4 cells and the optional stamp', () => {
    const svg = buildFitnessCardSVG({ kicker: 'run · <today>', title: 'Tom & Jerry 5k', stats: [{ value: '5.0', unit: 'km', label: 'distance' }, { value: '—', label: 'nothing' }, { value: '1', label: 'a' }, { value: '2', label: 'b' }, { value: '3', label: 'c' }, { value: '4', label: 'd' }] });
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 1200 630"/);
    assert.match(svg, />TOM &amp; JERRY 5K</);
    assert.match(svg, />RUN · &lt;TODAY&gt;</);
    assert.equal((svg.match(/font-size="64"/g) || []).length, 4, 'four stat cells, the dash dropped');
    assert.match(svg, />DISTANCE</);
    assert.doesNotMatch(svg, /stroke-width="2"\/>\n  <text[^>]*text-anchor="middle"/, 'no stamp without a footnote');
    assert.doesNotMatch(svg, /<[^>]*\bTom\b/);
    const stamped = buildFitnessCardSVG({ kicker: 'k', title: 't', stats: [], footnote: '+2 personal records' });
    assert.match(stamped, /text-anchor="middle"[^>]*>\+2 PERSONAL RECORDS</);
  });
  test('buildSectionSVG keeps the committed cards\' treatment', () => {
    const svg = buildSectionSVG(PAGES.find((p) => p.id === 'life'));
    assert.match(svg, />FITNESS\.</);
    assert.match(svg, /running, riding &amp; generally trying to stay alive\./);
    assert.match(svg, /font-size="280" fill="#7C3AED" opacity="0.09">△</);
  });
});

describe('fonts', () => {
  test('woffToSfnt unpacks the @fontsource WOFF into a TrueType sfnt', async () => {
    const woff = await fs.readFile(path.join(path.dirname(require.resolve('@fontsource/anton/package.json')), 'files/anton-latin-400-normal.woff'));
    const ttf = woffToSfnt(woff);
    assert.equal(ttf.readUInt32BE(0), 0x00010000, 'TrueType flavor');
    assert.equal(ttf.readUInt16BE(4), woff.readUInt16BE(12), 'same table count');
    assert.ok(ttf.length > woff.length, 'inflated');
    assert.throws(() => woffToSfnt(Buffer.from('not a font')), /WOFF/);
  });
  test('ensureFonts writes the TTFs and a fonts.conf and points FONTCONFIG_FILE at it', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'og-fonts-'));
    const prev = process.env.FONTCONFIG_FILE;
    delete process.env.FONTCONFIG_FILE;
    try {
      const conf = ensureFonts(tmp);
      assert.equal(conf, path.join(tmp, 'fonts.conf'));
      assert.equal(process.env.FONTCONFIG_FILE, conf);
      const files = (await fs.readdir(tmp)).sort();
      assert.deepEqual(files, ['anton-latin-400-normal.ttf', 'fonts.conf', 'jetbrains-mono-latin-400-normal.ttf', 'jetbrains-mono-latin-700-normal.ttf']);
      assert.match(await fs.readFile(conf, 'utf8'), new RegExp(`<dir>${tmp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</dir>`));
      assert.equal(ensureFonts('/should/not/be/used'), conf, 'a FONTCONFIG_FILE already set wins');
    } finally {
      if (prev === undefined) delete process.env.FONTCONFIG_FILE; else process.env.FONTCONFIG_FILE = prev;
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});

describe('rendering', () => {
  test('renderFitnessCards writes 1200×630 PNGs, returns the URL map, and hits the cache on a rebuild', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'og-render-'));
    try {
      const data = await fixtures();
      const opts = { activities: data.activities, roundups: data.roundups, index: data.index, outDir: path.join(tmp, 'out'), cacheDir: path.join(tmp, 'cache'), fontCacheDir: path.join(tmp, 'fonts'), siteUrl: 'https://james.ripixel.co.uk/' };
      const first = await renderFitnessCards(opts);
      assert.deepEqual({ rendered: first.rendered, cached: first.cached, failed: first.failed, total: first.total }, { rendered: 4, cached: 0, failed: 0, total: 4 });
      assert.equal(first.urls.activity['colwick-parkrun-2026-10-17'], 'https://james.ripixel.co.uk/life/og/activity/colwick-parkrun-2026-10-17.png');
      assert.equal(first.urls.roundup['week-42-2026'], 'https://james.ripixel.co.uk/life/og/roundup/week-42-2026.png');
      const png = await fs.readFile(path.join(tmp, 'out', 'activity', 'colwick-parkrun-2026-10-17.png'));
      assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'PNG signature');
      assert.equal(png.readUInt32BE(16), CARD_W);
      assert.equal(png.readUInt32BE(20), CARD_H);
      assert.ok(png.length < 150_000, `palette PNG stays small (${png.length} bytes)`);

      await fs.rm(path.join(tmp, 'out'), { recursive: true, force: true });
      const second = await renderFitnessCards(opts);
      assert.deepEqual({ rendered: second.rendered, cached: second.cached }, { rendered: 0, cached: 4 });
      assert.ok((await fs.stat(path.join(tmp, 'out', 'roundup', 'week-42-2026.png'))).size > 0);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
  test('fitnessOgImagesTask with no data returns empty maps and warns', async () => {
    const warnings = [];
    const task = fitnessOgImagesTask({ outDir: '/nonexistent/should-not-be-written' });
    const out = await task.run(task.config, { debug: false, globals: {}, logger: { info() {}, warn: (m) => warnings.push(m), error() {}, debug() {} } });
    assert.deepEqual(out, { fitnessOgImages: { activity: {}, roundup: {} } });
    assert.equal(warnings.length, 1);
  });
});
