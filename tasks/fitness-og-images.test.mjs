// @ts-check
// Run with `npm test`. The render tests go through sharp for real (a card ≈ 50–150 ms).
// Share cards (F5.4): models (fitness-share-models), drawing (scripts/share-cards),
// scope, backgrounds, rendering, cache and manifest (fitness-og-images).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

import { renderFitnessCards, fitnessOgImagesTask, cardJobs, isFullScope, variantsFor } from './fitness-og-images.mjs';
import { activityShareModel, roundupShareModel, parkrunHistory, parseClock, splitsOf, topSets, prBoxes, roundupCalendar } from './fitness-share-models.mjs';
import { buildShareSVG, fitDisplay, clipMono, monoW, antonW, SHAPES, SHAPE_ORDER, lighten, shortSegment, watermark, cardTheme } from '../scripts/share-cards.mjs';
import { buildSectionSVG, woffToSfnt, ensureFonts, getSharp, PAGES } from '../scripts/generate-og-images.mjs';
import { TYPE_INKS } from './fitness-theme.mjs';
import { loadFitnessData } from './fitness-fetch.mjs';
import { resolveNeighbours } from './fitness-roundup-views.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = path.join(REPO, 'fixtures', 'fitness');
const require = createRequire(import.meta.url);
/** The fixtures are from 12–18 Oct 2026; "now" a few days later keeps them all recent. */
const NOW = Date.parse('2026-10-20T12:00:00Z');

async function fixtures() {
  return loadFitnessData({ env: {}, source: 'fixtures', fixturesDir: FIXTURES });
}
/** @param {any[]} acts @param {string} slug */
const find = (acts, slug) => acts.find((a) => a.slug === slug);
/** @param {any[]} roundups */
const roundupCtx = (roundups) => ({ byKey: new Map(roundups.map((f) => [f.key, f])), neighbours: resolveNeighbours(roundups), activitySlugs: new Set(), showPhotoGallery: true });

describe('theme', () => {
  test('TYPE_INKS match fitness-types.css (--type, --type-on, --type-text)', async () => {
    const css = await fs.readFile(path.join(REPO, 'personal/assets/styles/main/fitness-types.css'), 'utf8');
    for (const [key, ink] of Object.entries(TYPE_INKS)) {
      const m = new RegExp(`\\.fit-type--${key}\\s*\\{([^}]*)\\}`).exec(css);
      assert.ok(m, `.fit-type--${key} in the CSS`);
      const v = (/** @type {string} */ name) => new RegExp(`--${name}:\\s*([^;]+);`).exec(m[1])?.[1].trim().toUpperCase();
      assert.equal(v('type'), ink.type, `${key} --type`);
      assert.equal(v('type-text'), ink.text, `${key} --type-text`);
      const on = v('type-on') === 'VAR(--INK)' ? '#171311' : v('type-on') === '#FFF' ? '#FFFFFF' : v('type-on');
      assert.equal(on, ink.on, `${key} --type-on`);
    }
  });
  test('lighten mixes toward white; the photo theme lightens the ink for text, the ink theme uses --type-on', () => {
    assert.equal(lighten('#000000', 0.5), '#808080');
    assert.equal(cardTheme('photo', TYPE_INKS.yoga).accent, lighten('#7C3AED', 0.3));
    assert.equal(cardTheme('ink', TYPE_INKS.crossfit).fg, '#171311');
    assert.equal(cardTheme('ink', TYPE_INKS.run).fg, '#F5EFDF', 'white --type-on reads as paper');
  });
});

describe('models', () => {
  test('parkrun: position, count, age grade; the PB badge; splits and route carried', async () => {
    const { activities, index } = await fixtures();
    const m = activityShareModel(find(activities, 'colwick-parkrun-2026-10-17'), index, { parkruns: parkrunHistory(activities) });
    assert.equal(m?.template, 'parkrun');
    assert.equal(m?.pill, 'PARKRUN');
    assert.equal(m?.kicker, 'parkrun · Colwick parkrun');
    assert.deepEqual(m?.stats.map((s) => s.label), ['distance', 'time', 'avg pace', 'avg hr']);
    assert.equal(m?.parkrun.position.startsWith('#'), true);
    assert.equal(m?.isPB, true);
    assert.equal(m?.badge.kind, 'pb');
    assert.ok(m?.route.length > 10);
    assert.deepEqual(m?.photos, ['https://storage.googleapis.com/fitglue-server-prod-showcase-assets/activity_photos/kQ2v9bX1ZtNcR4mL8pW6yHdE3aF7/act_01JA9W3K2QX7/finish-funnel_p.jpg']);
  });
  test('parkrun: not a PB → the gap to the best earlier parkrun', async () => {
    const { activities, index } = await fixtures();
    const f = structuredClone(find(activities, 'colwick-parkrun-2026-10-17'));
    f.activity.enrichments.parkrun.isTimePb = false;
    f.activity.enrichments.personalRecords = { records: [] };
    const history = [{ slug: 'older', date: Date.parse('2026-09-01T09:00:00Z'), seconds: 19 * 60 + 30 }, ...parkrunHistory([f])];
    const m = activityShareModel(f, index, { parkruns: history });
    assert.deepEqual(m?.badge, { kind: 'gap', tone: 'loss', text: '+0:22 vs PB 19:30' });
  });
  test('strength (Hevy): top sets heaviest first by volume, the session PBs heaviest-lift first', async () => {
    const { activities, index } = await fixtures();
    const m = activityShareModel(find(activities, 'push-day-2026-10-13'), index);
    assert.equal(m?.template, 'strength');
    assert.ok(m?.topSets.length >= 2);
    assert.match(m?.topSets[0].value, /kg × \d+|reps|:/);
    assert.equal(m?.topSets.find((/** @type {any} */ s) => /bench/i.test(s.name))?.tag, 'PB');
    assert.deepEqual(m?.prs.map((/** @type {any} */ p) => [p.name, p.metric, p.value, p.unit, p.delta]), [
      ['Bench Press (Barbell)', 'EST. 1RM', '100', 'kg', '+2.5 kg'],
      ['Bench Press (Barbell)', 'BEST SET', '640', 'kg', '+40 kg'],
    ]);
  });
  test('a ride is "other": four numbers, the route', async () => {
    const { activities, index } = await fixtures();
    const m = activityShareModel(find(activities, 'evening-ride-to-the-reservoir-2026-10-15'), index);
    assert.equal(m?.template, 'other');
    assert.equal(m?.stats.length, 4);
    assert.ok(m?.route.length > 10);
    assert.equal(m?.isPB, false);
  });
  test('roundup: totals, sport families, a week of calendar cells, the comparison', async () => {
    const { roundups } = await fixtures();
    const m = roundupShareModel(roundups[0], roundupCtx(roundups));
    assert.equal(m.template, 'roundup');
    assert.equal(m.title, 'WEEK 42');
    assert.equal(m.pill, 'WEEKLY ROUNDUP');
    assert.equal(m.calendar.type, 'week');
    assert.equal(m.calendar.days.length, 7);
    assert.ok(m.sports.length >= 1 && m.sports.every((s) => /^#[0-9A-F]{6}$/.test(s.ink)));
    assert.equal(m.sports.reduce((s, x) => s + x.count, 0), m.sessions);
    assert.ok(m.totals.length >= 2);
  });
  test('helpers: parseClock, splitsOf drops a short last km, topSets formats, prBoxes NEW, calendar columns', () => {
    assert.equal(parseClock('24:39'), 1479);
    assert.equal(parseClock('1:02:03'), 3723);
    assert.equal(parseClock('nope'), 0);
    const splits = splitsOf([{ km: 1, durationSeconds: 300 }, { km: 2, durationSeconds: 310 }, { km: 3, durationSeconds: 60 }]);
    assert.deepEqual(splits.map((s) => s.pace), ['5:00', '5:10']);
    assert.deepEqual(splitsOf([{ km: 1, durationSeconds: 300 }]), []);
    assert.deepEqual(topSets([
      { exerciseName: 'Row', reps: 0, weightKg: 0, distanceMeters: 500 },
      { exerciseName: 'Squat', reps: 5, weightKg: 100 }, { exerciseName: 'Squat', reps: 8, weightKg: 80 },
      { exerciseName: 'Plank', durationSeconds: 60 },
    ], new Set(['squat'])), [
      { name: 'Squat', value: '100 kg × 5', tag: 'PB' },
      { name: 'Row', value: '500 m', tag: '' },
      { name: 'Plank', value: '1:00', tag: '' },
    ]);
    assert.equal(prBoxes([{ recordType: 'deadlift_heaviest_weight', newValue: 170, unit: 'kg' }])[0].delta, 'NEW');
    assert.equal(prBoxes([{ recordType: 'fastest_5k', newValue: 1192, previousValue: 1206, unit: 'seconds' }])[0].delta, '−0:14');
    const cal = roundupCalendar('month', { periodStart: '2026-10-01T00:00:00Z', periodEnd: '2026-11-01T00:00:00Z', dayEntries: [{ date: '2026-10-05', effortLevel: 3 }] });
    assert.equal(cal.days.length, 31);
    assert.equal(cal.days[0].dow, 3, '1 Oct 2026 is a Thursday');
    assert.equal(cal.days.find((d) => d.level === 3)?.col, 1);
  });
});

describe('scope and backgrounds', () => {
  test('all three shapes: recent, races, PBs, race weekends, year roundups; else Landscape only', () => {
    const old = '2026-01-01T00:00:00Z';
    assert.equal(isFullScope({ kind: 'activity', date: '2026-10-10T00:00:00Z' }, NOW), true);
    assert.equal(isFullScope({ kind: 'activity', date: old }, NOW), false);
    assert.equal(isFullScope({ kind: 'activity', date: old, template: 'race' }, NOW), true);
    assert.equal(isFullScope({ kind: 'activity', date: old, isPB: true }, NOW), true);
    assert.equal(isFullScope({ kind: 'event', date: old }, NOW), true);
    assert.equal(isFullScope({ kind: 'roundup', id: 'year-2025', date: old }, NOW), true);
    assert.equal(isFullScope({ kind: 'roundup', id: 'week-2-2026', date: old }, NOW), false);
  });
  test('variants: collage first for a weekend, every photo for races, photo + colour otherwise, the one default when old', () => {
    const ids = (/** @type {any[]} */ v) => v.map((x) => x.id);
    assert.deepEqual(ids(variantsFor({ kind: 'event', collage: ['a', 'b'], photos: ['a', 'b', 'c'] }, true)), ['collage', 'photo-1', 'photo-2', 'photo-3', 'ink']);
    assert.deepEqual(ids(variantsFor({ kind: 'activity', template: 'race', photos: ['a', 'b'] }, true)), ['photo-1', 'photo-2', 'ink']);
    assert.deepEqual(ids(variantsFor({ kind: 'activity', template: 'run', photos: ['a', 'b'] }, true)), ['photo-1', 'ink']);
    assert.deepEqual(ids(variantsFor({ kind: 'activity', template: 'run', photos: [] }, true)), ['ink']);
    assert.deepEqual(ids(variantsFor({ kind: 'activity', template: 'run', photos: ['a'] }, false)), ['photo-1']);
    assert.deepEqual(ids(variantsFor({ kind: 'activity', template: 'run', photos: [] }, false)), ['ink']);
    assert.equal(variantsFor({ kind: 'roundup', photos: [] }, true)[0].label, 'Paper');
  });
  test('cardJobs: one job per activity and roundup, shapes by scope', async () => {
    const data = await fixtures();
    const jobs = cardJobs({ ...data, now: NOW });
    assert.deepEqual(jobs.map((j) => `${j.model.kind}:${j.model.id}:${j.shapes.join('/')}`).sort(), [
      'activity:colwick-parkrun-2026-10-17:story/square/landscape',
      'activity:evening-ride-to-the-reservoir-2026-10-15:story/square/landscape',
      'activity:push-day-2026-10-13:story/square/landscape',
      'roundup:week-42-2026:story/square/landscape',
    ]);
    const later = cardJobs({ ...data, now: Date.parse('2027-06-01T00:00:00Z') });
    assert.deepEqual(later.find((j) => j.model.id === 'evening-ride-to-the-reservoir-2026-10-15')?.shapes, ['landscape'], 'old, no PB');
    assert.equal(later.find((j) => j.model.id === 'push-day-2026-10-13')?.full, true, 'a PB session stays in full');
  });
});

describe('drawing', () => {
  test('fitDisplay: one line when it fits, two when it must, an ellipsis past that', () => {
    assert.deepEqual(fitDisplay('Push day', 900, { max: 140, min: 60 }), { size: 140, lines: ['PUSH DAY'] });
    const two = fitDisplay('Evening ride to the reservoir and back again', 900, { max: 140, min: 60, max2: 104 });
    assert.equal(two.lines.length, 2);
    assert.ok(two.lines.every((l) => antonW(l, two.size) <= 900));
    const cut = fitDisplay('word '.repeat(60), 500, { max: 100, min: 60 });
    assert.equal(cut.lines.length, 2);
    assert.match(cut.lines[1], /…$/);
    assert.equal(fitDisplay('one two three four five six seven', 400, { max: 100, min: 60, lines: 1 }).lines.length, 1);
  });
  test('clipMono cuts to width with an ellipsis', () => {
    assert.equal(clipMono('short', 1000, 20), 'short');
    const c = clipMono('a much longer label than fits', 200, 20);
    assert.match(c, /…$/);
    assert.ok(monoW(c, 20) <= 200);
  });
  test('shortSegment names the columns', () => {
    assert.equal(shortSegment({ key: 'run_3', label: 'Run 3' }), 'R3');
    assert.equal(shortSegment({ key: 'wall_balls', label: 'Wall Balls' }), 'WALL');
    assert.equal(shortSegment({ key: 'mystery_station', label: 'Mystery' }), 'MYSTE');
  });
  test('every template draws in every shape and look, escaped, at the shape\'s size', async () => {
    const data = await fixtures();
    const jobs = cardJobs({ ...data, now: NOW });
    const race = { template: 'race', kind: 'activity', id: 'r', ink: TYPE_INKS.crossfit, pill: 'HYROX', kicker: 'HYROX · <Open>', title: 'Hyrox & Friends', dateLine: 'WED', total: '1:29:42', badge: { kind: 'pb', text: 'New PB · was 1:30:00' }, ranks: [{ value: '#1', label: 'overall' }], runs: '43:10', stations: '39:16', roxzone: '7:24', avgHr: 168, rows: Array.from({ length: 16 }, (_, i) => ({ key: i % 2 ? 'skierg' : `run_${i / 2 + 1}`, label: i % 2 ? 'SkiErg' : `Run ${i / 2 + 1}`, isRun: !(i % 2), seconds: 300 + i, duration: '5:00', avgHr: 160 + i, delta: i ? '+0:01' : '', deltaTone: 'loss', isPB: i === 3 })) };
    const event = { template: 'event', kind: 'event', id: 'e', ink: TYPE_INKS.crossfit, pill: 'RACE WEEKEND', kicker: 'RACE WEEKEND', title: 'Hyrox Birmingham', raceCount: 2, totalTime: '2:45:11', pbCount: 0, divisionCount: 2, races: [{ date: '27 Oct', division: 'Doubles', total: '1:15:29', badge: { kind: 'gap', tone: 'loss', text: '+2:55 vs PB 1:12:34' }, ranks: [], partner: 'Stephen', avgHr: '167' }, { date: '28 Oct', division: 'Solo', total: '1:29:42', badge: { kind: '', text: '' }, ranks: [{ value: '#270', label: 'overall' }], partner: '', avgHr: '' }] };
    const models = [...jobs.map((j) => j.model), race, event];
    for (const m of models) {
      for (const shape of SHAPE_ORDER) {
        for (const mode of /** @type {const} */ (['photo', 'ink'])) {
          const svg = buildShareSVG(m, shape, mode);
          const { w, h } = SHAPES[shape];
          assert.match(svg, new RegExp(`^<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"`), `${m.template} ${shape} ${mode}`);
          assert.doesNotMatch(svg, /NaN|undefined/, `${m.template} ${shape} ${mode} has no NaN/undefined`);
          assert.match(svg, /james\.ripixel\.co\.uk\/life/);
        }
      }
    }
    const svg = buildShareSVG(race, 'story', 'photo');
    assert.match(svg, />HYROX · &lt;OPEN&gt;</);
    assert.match(svg, />HYROX &amp; FRIENDS</);
    assert.match(svg, />WALL BALLS<|>SKIERG</);
    assert.match(svg, /id="scrim"/, 'photo cards carry the scrim');
    assert.doesNotMatch(buildShareSVG(race, 'story', 'ink'), /id="scrim"/);
    assert.match(buildShareSVG(event, 'story', 'ink'), /fill-opacity="0.13"/, 'the ink look fills its free space with the poster word');
  });
  test('watermark: nothing in a sliver, the word fitted to the box', () => {
    const th = cardTheme('ink', TYPE_INKS.run);
    assert.equal(watermark(th, 'HYROX', 0, 0, 900, 60), '');
    assert.match(watermark(th, '2 races', 0, 0, 900, 600), />2 RACES<|>2<\/text>/);
  });
  test('buildSectionSVG keeps the committed cards\' treatment', () => {
    const svg = buildSectionSVG(PAGES.find((p) => p.id === 'life'));
    assert.match(svg, />FITNESS\.</);
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
      assert.equal(ensureFonts('/should/not/be/used'), conf, 'a FONTCONFIG_FILE already set wins');
    } finally {
      if (prev === undefined) delete process.env.FONTCONFIG_FILE; else process.env.FONTCONFIG_FILE = prev;
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});

describe('rendering', () => {
  /** A fake photo host: every URL is the same small JPEG; `fail` URLs 404. */
  async function photoHost(fail = /never/) {
    const sharp = await getSharp();
    const jpeg = await sharp({ create: { width: 300, height: 400, channels: 3, background: '#3a6' } }).jpeg().toBuffer();
    /** @type {string[]} */
    const hits = [];
    const fetchImpl = /** @type {typeof fetch} */ (/** @type {unknown} */ (async (/** @type {string} */ url) => {
      hits.push(String(url));
      if (fail.test(String(url))) return new Response('nope', { status: 404 });
      return new Response(jpeg, { status: 200, headers: { 'content-type': 'image/jpeg' } });
    }));
    return { fetchImpl, hits };
  }

  test('renders every shape and background, returns the URL maps and the manifest, and hits the cache on a rebuild', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'share-render-'));
    try {
      const data = await fixtures();
      const host = await photoHost();
      const opts = { ...data, now: NOW, outDir: path.join(tmp, 'out'), cacheDir: path.join(tmp, 'cache'), siteUrl: 'https://james.ripixel.co.uk/', fetchImpl: host.fetchImpl };
      const first = await renderFitnessCards(opts);
      // parkrun, roundup: its photo + colour; ride: its AI banner + colour; push day: colour only — × 3 shapes
      assert.deepEqual({ rendered: first.rendered, cached: first.cached, failed: first.failed, images: first.images }, { rendered: 21, cached: 0, failed: 0, images: 21 });
      assert.equal(first.urls.activity['colwick-parkrun-2026-10-17'], 'https://james.ripixel.co.uk/life/share/activity/colwick-parkrun-2026-10-17/landscape-photo-1.jpg');
      assert.equal(first.urls.roundup['week-42-2026'], 'https://james.ripixel.co.uk/life/share/roundup/week-42-2026/landscape-photo-1.jpg');
      assert.equal(first.urls.activity['push-day-2026-10-13'], 'https://james.ripixel.co.uk/life/share/activity/push-day-2026-10-13/landscape-ink.png');
      const entry = first.cards.activity['colwick-parkrun-2026-10-17'];
      assert.deepEqual(entry.shapes.map((s) => `${s.shape}:${s.variants.map((v) => v.id).join('/')}`), ['story:photo-1/ink', 'square:photo-1/ink', 'landscape:photo-1/ink']);
      assert.equal(entry.shapes[0].variants[0].file, 'colwick-parkrun-2026-10-17-story.jpg');
      assert.equal(entry.shapes[0].variants[1].file, 'colwick-parkrun-2026-10-17-story-ink.png');
      assert.equal(host.hits.length, 2, 'two distinct pictures (the parkrun photo, also the roundup\'s; the ride banner), each fetched once');

      const sharp = await getSharp();
      const story = await sharp(path.join(tmp, 'out', 'activity', 'colwick-parkrun-2026-10-17', 'story-photo-1.jpg')).metadata();
      assert.deepEqual([story.format, story.width, story.height], ['jpeg', 1080, 1920]);
      const sq = await sharp(path.join(tmp, 'out', 'activity', 'push-day-2026-10-13', 'square-ink.png')).metadata();
      assert.deepEqual([sq.format, sq.width, sq.height], ['png', 1080, 1080]);
      const og = await sharp(path.join(tmp, 'out', 'roundup', 'week-42-2026', 'landscape-ink.png')).metadata();
      assert.equal(og.format, 'png');
      assert.deepEqual([og.width, og.height], [1200, 630]);

      const manifest = JSON.parse(await fs.readFile(path.join(tmp, 'out', 'index.json'), 'utf8'));
      assert.equal(manifest.schemaVersion, 1);
      assert.equal(manifest.siteUrl, 'https://james.ripixel.co.uk');
      const pk = manifest.cards.find((/** @type {any} */ c) => c.id === 'activity:colwick-parkrun-2026-10-17');
      assert.deepEqual({ ...pk, hash: typeof pk.hash }, {
        id: 'activity:colwick-parkrun-2026-10-17', kind: 'activity', slug: 'colwick-parkrun-2026-10-17', template: 'parkrun',
        title: 'Colwick parkrun #87', label: 'parkrun', date: '2026-10-17T08:00:00Z',
        page: 'https://james.ripixel.co.uk/life/activity/colwick-parkrun-2026-10-17#share',
        image: 'https://james.ripixel.co.uk/life/share/activity/colwick-parkrun-2026-10-17/story-photo-1.jpg',
        race: false, pb: true, hash: 'string',
      });
      assert.deepEqual(manifest.cards.map((/** @type {any} */ c) => c.date), [...manifest.cards.map((/** @type {any} */ c) => c.date)].sort().reverse(), 'newest first');

      await fs.rm(path.join(tmp, 'out'), { recursive: true, force: true });
      const second = await renderFitnessCards(opts);
      assert.deepEqual({ rendered: second.rendered, cached: second.cached }, { rendered: 0, cached: 21 });
      assert.equal(host.hits.length, 2, 'a cached card needs no photo');
      assert.equal(second.manifest.find((c) => c.slug === 'colwick-parkrun-2026-10-17')?.hash, pk.hash, 'stable hash');
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  test('a photo that will not load drops its variant; an old card left with nothing falls back to colour', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'share-fail-'));
    try {
      const data = await fixtures();
      const host = await photoHost(/finish-funnel/);
      const only = (/** @type {any} */ j) => j.model.id === 'colwick-parkrun-2026-10-17';
      const r = await renderFitnessCards({ ...data, only, now: NOW, outDir: path.join(tmp, 'out'), cacheDir: path.join(tmp, 'cache'), fetchImpl: host.fetchImpl });
      assert.deepEqual(r.cards.activity['colwick-parkrun-2026-10-17'].shapes.map((s) => s.variants.map((v) => v.id).join('/')), ['ink', 'ink', 'ink']);
      assert.equal(r.dropped, 3);
      const old = await renderFitnessCards({ ...data, only, now: NOW, offline: true, outDir: path.join(tmp, 'out2'), cacheDir: path.join(tmp, 'cache2') });
      assert.ok(old.urls.activity['colwick-parkrun-2026-10-17'].endsWith('/landscape-ink.png'), 'offline: colour, never a missing OG image');
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  test('fitnessOgImagesTask with no data returns empty maps and warns', async () => {
    const warnings = [];
    const task = fitnessOgImagesTask({ outDir: '/nonexistent/should-not-be-written' });
    const out = await task.run(task.config, { debug: false, globals: {}, logger: { info() {}, warn: (m) => warnings.push(m), error() {}, debug() {} } });
    assert.deepEqual(out, { fitnessOgImages: { activity: {}, event: {}, roundup: {} }, fitnessShareCards: { activity: {}, event: {}, roundup: {} } });
    assert.equal(warnings.length, 1);
  });
});
