// @ts-check
// Run with `npm test`. Share overlays: transparent PNGs of an activity's numbers and charts
// (scripts/share-overlays.mjs), their scope, rendering, cache, page entry and manifest
// (tasks/fitness-og-images.mjs).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderFitnessCards, cardJobs, isOverlayScope, OVERLAY_DAYS } from './fitness-og-images.mjs';
import { buildOverlaySVGs, overlayPieces, overlayLayout, TONES } from '../scripts/share-overlays.mjs';
import { buildShareSVG, cardTheme, SHAPES } from '../scripts/share-cards.mjs';
import { getSharp } from '../scripts/generate-og-images.mjs';
import { TYPE_INKS } from './fitness-theme.mjs';
import { loadFitnessData } from './fitness-fetch.mjs';
import { ROUNDUP_INK } from './fitness-share-models.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = path.join(REPO, 'fixtures', 'fitness');
const NOW = Date.parse('2026-10-20T12:00:00Z');
const fixtures = () => loadFitnessData({ env: {}, source: 'fixtures', fixturesDir: FIXTURES });

const race = {
  template: 'race', kind: 'activity', id: 'r', ink: TYPE_INKS.hybrid, pill: 'HYROX', kicker: 'HYROX · <Open>', title: 'Hyrox & Friends', dateLine: 'WED',
  total: '1:29:42', badge: { kind: 'pb', text: 'New PB · was 1:30:00' }, ranks: [{ value: '#1', label: 'overall' }], runs: '43:10', stations: '39:16', roxzone: '7:24', avgHr: 168,
  rows: Array.from({ length: 16 }, (_, i) => ({ key: i % 2 ? 'skierg' : `run_${i / 2 + 1}`, label: i % 2 ? 'SkiErg' : `Run ${i / 2 + 1}`, isRun: !(i % 2), seconds: 300 + i, duration: '5:00', avgHr: 160 + i, delta: i ? '+0:01' : '', deltaTone: 'loss', isPB: i === 3 })),
};
const event = {
  template: 'event', kind: 'event', id: 'e', ink: TYPE_INKS.hybrid, pill: 'RACE WEEKEND', kicker: 'RACE WEEKEND', title: 'Hyrox Birmingham', raceCount: 2, totalTime: '2:45:11', pbCount: 0, divisionCount: 2,
  races: [{ date: '27 Oct', division: 'Doubles', total: '1:15:29', badge: { kind: 'gap', tone: 'loss', text: '+2:55 vs PB 1:12:34' }, ranks: [], partner: 'Stephen', avgHr: '167' }],
};

describe('overlay themes', () => {
  test('light is white with an ink shadow, dark is ink with a white halo; a roundup uses its accent, not paper', () => {
    const light = cardTheme('overlay-light', TYPE_INKS.run);
    const dark = cardTheme('overlay-dark', TYPE_INKS.run);
    assert.equal(light.fg, '#FFFFFF');
    assert.equal(light.shade, '#171311');
    assert.equal(dark.fg, '#171311');
    assert.equal(dark.shade, '#FFFFFF');
    assert.equal(cardTheme('overlay-dark', ROUNDUP_INK).fill, ROUNDUP_INK.accent);
    assert.equal(cardTheme('photo', TYPE_INKS.run).shade, '#171311', 'the photo cards keep their ink');
  });
});

describe('overlay pieces', () => {
  test('each template gets its own pieces, ids stable, in both tones', async () => {
    const data = await fixtures();
    const byId = Object.fromEntries(cardJobs({ ...data, now: NOW }).map((j) => [j.model.id, j.model]));
    const ids = (/** @type {any} */ m) => overlayPieces(m, 'light').map((o) => o.id);
    assert.deepEqual(ids(byId['colwick-parkrun-2026-10-17']), ['title', 'stats', 'badge', 'parkrun', 'route']);
    assert.deepEqual(ids(byId['evening-ride-to-the-reservoir-2026-10-15']), ['title', 'stats', 'hr', 'route']);
    assert.deepEqual(ids(byId['push-day-2026-10-13']), ['title', 'stats', 'badge', 'sets', 'prs']);
    assert.deepEqual(ids(byId['week-42-2026']), ['title', 'stats', 'sports', 'calendar', 'prs']);
    assert.deepEqual(ids(race), ['title', 'total', 'stats', 'splits', 'chart', 'badge']);
    assert.deepEqual(ids(event), ['title', 'races']);
    for (const m of [...Object.values(byId), race, event]) {
      for (const tone of TONES) {
        const all = buildOverlaySVGs(m, tone);
        assert.deepEqual(all.slice(0, 2).map((o) => o.id), ['layout-story', 'layout-square']);
        for (const o of all) {
          assert.match(o.svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/, `${m.id} ${o.id}`);
          assert.match(o.svg, /<filter id="halo"/);
          assert.doesNotMatch(o.svg, /NaN|undefined/, `${m.id} ${o.id} ${tone}`);
          assert.doesNotMatch(o.svg, /id="scrim"|james\.ripixel\.co\.uk/, 'no ground, no frame');
        }
      }
    }
    assert.match(overlayPieces(race, 'light').find((o) => o.id === 'title')?.svg || '', />HYROX &amp; FRIENDS</, 'escaped');
  });
  test('a layout is the shape\'s size and untrimmed; pieces are 1080 wide and trimmed later', () => {
    const l = overlayLayout(race, 'story', 'dark');
    assert.deepEqual([l.w, l.h, l.trim], [SHAPES.story.w, SHAPES.story.h, false]);
    for (const p of overlayPieces(race, 'dark').filter((o) => o.id !== 'route')) assert.deepEqual([p.w, p.trim], [1080, true]);
  });
  test('the cards are untouched by the overlay themes', () => {
    assert.doesNotMatch(buildShareSVG(race, 'story', 'photo'), /halo/);
    assert.match(buildShareSVG(race, 'story', 'photo'), /id="scrim"/);
  });
});

describe('overlay scope', () => {
  test('recent pages, every race and race weekend; old sessions and old roundups not', () => {
    const day = 86_400_000;
    assert.equal(isOverlayScope({ kind: 'activity', date: new Date(NOW - 2 * day).toISOString() }, NOW), true);
    assert.equal(isOverlayScope({ kind: 'activity', date: new Date(NOW - (OVERLAY_DAYS + 1) * day).toISOString() }, NOW), false);
    assert.equal(isOverlayScope({ kind: 'activity', template: 'race', date: '2024-01-01T00:00:00Z' }, NOW), true);
    assert.equal(isOverlayScope({ kind: 'event', date: '2024-01-01T00:00:00Z' }, NOW), true);
    assert.equal(isOverlayScope({ kind: 'roundup', id: 'year-2025', date: '2026-01-01T00:00:00Z' }, NOW), false);
    assert.equal(isOverlayScope({ kind: 'activity', isPB: true, date: '2025-01-01T00:00:00Z' }, NOW), false, 'an old PB keeps its cards but gets no overlays');
  });
});

describe('overlay rendering', () => {
  test('transparent PNGs, trimmed pieces, full-size layouts; on the entry and in the manifest; cached on a rebuild', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'share-overlays-'));
    try {
      const data = await fixtures();
      const only = (/** @type {any} */ j) => j.model.id === 'colwick-parkrun-2026-10-17';
      const opts = { ...data, only, now: NOW, offline: true, outDir: path.join(tmp, 'out'), cacheDir: path.join(tmp, 'cache'), siteUrl: 'https://james.ripixel.co.uk/' };
      const first = await renderFitnessCards(opts);
      // 2 layouts + 5 pieces, × 2 tones
      assert.equal(first.overlays, 14);
      assert.equal(first.failed, 0);
      const entry = first.cards.activity['colwick-parkrun-2026-10-17'];
      assert.deepEqual(entry.overlays.map((o) => o.id), ['layout-story', 'layout-square', 'title', 'stats', 'badge', 'parkrun', 'route']);
      const stats = entry.overlays.find((o) => o.id === 'stats');
      assert.deepEqual(stats?.tones.map((t) => t.tone), ['light', 'dark']);
      assert.equal(stats?.tones[0].url, '/life/share/activity/colwick-parkrun-2026-10-17/overlay/stats-light.png');
      assert.equal(stats?.tones[0].file, 'colwick-parkrun-2026-10-17-overlay-stats-light.png');

      const sharp = await getSharp();
      const file = path.join(tmp, 'out', 'activity', 'colwick-parkrun-2026-10-17', 'overlay', 'stats-light.png');
      const meta = await sharp(file).metadata();
      assert.equal(meta.format, 'png');
      assert.equal(meta.hasAlpha, true, 'transparent');
      assert.ok(meta.width && meta.width < 1080, 'trimmed to its ink');
      assert.deepEqual([meta.width, meta.height], [stats?.tones[0].w, stats?.tones[0].h], 'the entry carries the real size');
      const { data: px, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      assert.equal(px[3], 0, 'the corner is clear');
      assert.ok(info.channels === 4);
      const layout = await sharp(path.join(tmp, 'out', 'activity', 'colwick-parkrun-2026-10-17', 'overlay', 'layout-story-dark.png')).metadata();
      assert.deepEqual([layout.width, layout.height, layout.hasAlpha], [1080, 1920, true]);

      const manifest = JSON.parse(await fs.readFile(path.join(tmp, 'out', 'index.json'), 'utf8'));
      const pk = manifest.cards.find((/** @type {any} */ c) => c.id === 'activity:colwick-parkrun-2026-10-17');
      assert.equal(pk.overlays.length, 14);
      assert.deepEqual(pk.overlays.find((/** @type {any} */ o) => o.piece === 'route' && o.tone === 'dark'), {
        piece: 'route', label: 'Route', tone: 'dark', url: 'https://james.ripixel.co.uk/life/share/activity/colwick-parkrun-2026-10-17/overlay/route-dark.png',
        w: entry.overlays.find((o) => o.id === 'route')?.tones[1].w, h: entry.overlays.find((o) => o.id === 'route')?.tones[1].h,
      });

      await fs.rm(path.join(tmp, 'out'), { recursive: true, force: true });
      const second = await renderFitnessCards(opts);
      assert.equal(second.overlays, 14);
      assert.equal(second.rendered, 0, 'everything from the cache');
      assert.deepEqual(second.cards.activity['colwick-parkrun-2026-10-17'].overlays, entry.overlays, 'sizes come back from the cache');
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
  test('an old page gets cards but no overlays; overlays:false turns them off', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'share-overlays-old-'));
    try {
      const data = await fixtures();
      const only = (/** @type {any} */ j) => j.model.id === 'push-day-2026-10-13';
      const later = await renderFitnessCards({ ...data, only, now: Date.parse('2027-06-01T00:00:00Z'), offline: true, outDir: path.join(tmp, 'a'), cacheDir: path.join(tmp, 'ca') });
      assert.equal(later.overlays, 0);
      assert.deepEqual(later.cards.activity['push-day-2026-10-13'].overlays, []);
      const off = await renderFitnessCards({ ...data, only, now: NOW, offline: true, overlays: false, outDir: path.join(tmp, 'b'), cacheDir: path.join(tmp, 'cb') });
      assert.equal(off.overlays, 0);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});
