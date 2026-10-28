// @ts-check
// Run with `npm test` (node:test, no extra dependencies).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runSkierTasks } from './skier-test-runner.mjs';

import {
  activityOutPath,
  activityUrl,
  fmtKm,
  fmtDistance,
  fmtClock,
  fmtDuration,
  fmtPace,
  fmtWeight,
  fmtNumber,
  fmtDateStamp,
  typeLabel,
  typeIcon,
  sourceLabel,
  descriptionPreamble,
  sanitizeAiHtml,
  stripTags,
  sparklinePath,
  routePath,
  hrZoneBars,
  groupStrengthSets,
  setChip,
  boosterTimeline,
  parseRecordType,
  topPR,
  prValue,
  prDelta,
  anchorStats,
  moduleOrderFor,
  buildModule,
  buildActivityView,
  deriveCategory,
  fitnessActivityViewsTask,
} from './fitness-activity-views.mjs';
import { loadFitnessData } from './fitness-fetch.mjs';
import { lifePageTasks } from './life-pages.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = path.join(REPO, 'fixtures', 'fitness');

/** @param {string} slug */
async function fixture(slug) {
  return JSON.parse(await fs.readFile(path.join(FIXTURES, 'activity', `${slug}.json`), 'utf8'));
}
async function fixtureIndex() {
  return JSON.parse(await fs.readFile(path.join(FIXTURES, 'index.json'), 'utf8'));
}

describe('slug → path', () => {
  test('maps a showcase id to life/activity/<slug>/index.html under the output dir (served at /life/activity/<slug>)', () => {
    assert.equal(activityOutPath('colwick-parkrun-2026-10-17'), 'life/activity/colwick-parkrun-2026-10-17/index.html');
    assert.equal(activityUrl('colwick-parkrun-2026-10-17'), '/life/activity/colwick-parkrun-2026-10-17');
  });
  test('rejects anything that could escape the directory', () => {
    for (const bad of ['', '../etc', 'a/b', 'a\\b', '.hidden', 'a..b', 42, null, undefined, 'x'.repeat(202)]) {
      assert.throws(() => activityOutPath(/** @type {any} */ (bad)), new RegExp('unusable activity slug'), String(bad));
    }
  });
});

describe('unit formatting', () => {
  test('distance', () => {
    assert.equal(fmtKm(5010), '5.01');
    assert.equal(fmtKm(42195), '42.2');
    assert.equal(fmtKm(0), '');
    assert.equal(fmtDistance(850), '850 m');
    assert.equal(fmtDistance(1609), '1.61 km');
    assert.equal(fmtDistance(21100), '21.1 km');
  });
  test('time', () => {
    assert.equal(fmtClock(1192), '19:52');
    assert.equal(fmtClock(3735), '1:02:15');
    assert.equal(fmtClock(0), '');
    assert.equal(fmtDuration(3735), '1h 2m');
    assert.equal(fmtDuration(2700), '45m');
    assert.equal(fmtDuration(30), '30s');
  });
  test('pace, weight, numbers', () => {
    assert.equal(fmtPace(237.9), '3:58');
    assert.equal(fmtPace(239.6), '4:00');
    assert.equal(fmtPace(0), '');
    assert.equal(fmtWeight(2560), '2.6 t');
    assert.equal(fmtWeight(640), '640 kg');
    assert.equal(fmtNumber(4812.3, 1), '4,812.3');
  });
  test('dates are UTC like the export', () => {
    assert.equal(fmtDateStamp('2026-10-17T08:00:00Z'), 'SAT 17 OCT 2026');
    assert.equal(fmtDateStamp('2026-10-17T23:30:00Z'), 'SAT 17 OCT 2026');
    assert.equal(fmtDateStamp('nope'), '');
  });
  test('enum labels', () => {
    assert.equal(typeLabel('ACTIVITY_TYPE_TRAIL_RUN'), 'TRAIL RUN');
    assert.equal(typeLabel(undefined), 'ACTIVITY');
    assert.equal(typeIcon('ACTIVITY_TYPE_RIDE'), '🚴');
    assert.equal(typeIcon('ACTIVITY_TYPE_SOMETHING_NEW'), '🏅');
    assert.equal(sourceLabel('SOURCE_PARKRUN_RESULTS'), 'Parkrun Results');
    assert.equal(sourceLabel('SOURCE_FILE_UPLOAD'), 'FIT Upload');
    assert.equal(sourceLabel(''), '');
  });
});

describe('text helpers', () => {
  test('description preamble strips the FitGlue footer and AI sections', () => {
    assert.equal(
      descriptionPreamble('Out along the Trent.\n\n🌤️ Conditions:\nClear, 11°C.\n\nPosted via FitGlue 💪'),
      'Out along the Trent.',
    );
    assert.equal(descriptionPreamble('Just words.\n\nPosted via FitGlue 💪'), 'Just words.');
    assert.equal(descriptionPreamble('🏃 Splits:\n4:00, 4:01'), '', 'emoji header on the first line → nothing before it');
    assert.equal(descriptionPreamble('Easy one.\n\n🏃 Splits: 4:00, 4:01'), 'Easy one.', 'single-line section after a blank line');
    assert.equal(descriptionPreamble(''), '');
    assert.equal(descriptionPreamble(undefined), '');
  });
  test('AI summary html is reduced to the allowed tags', () => {
    const html = '<h2>Colwick</h2>AI Summary: <p class="x" onclick="evil()">A <b>5K</b> <a href="https://evil">best</a><script>alert(1)</script></p><div>plain</div>';
    assert.equal(sanitizeAiHtml(html), '<p>A <b>5K</b> best</p>plain');
    assert.equal(sanitizeAiHtml('<P>Line<BR/>two</P>'), '<p>Line<br>two</p>');
    assert.equal(sanitizeAiHtml(''), '');
    assert.equal(stripTags('<p>A <b>5K</b> &amp; more</p>'), 'A 5K & more');
  });
});

describe('inline SVG maths', () => {
  test('sparkline: fits the box, breaks on nulls, keeps the baseline', () => {
    const p = sparklinePath([10, 20, null, 30], { w: 100, h: 50, pad: 0 });
    assert.ok(p);
    assert.equal(p.min, 10);
    assert.equal(p.max, 30);
    assert.match(p.d, /^M0,50 L33\.3,25 M100,0$/);
    assert.match(p.area, /Z$/);
    assert.equal(sparklinePath([5]), null);
    assert.equal(sparklinePath([null, null]), null);
    assert.equal(sparklinePath(/** @type {any} */ (undefined)), null);
  });
  test('sparkline: invert puts faster pace higher', () => {
    const a = sparklinePath([100, 200], { w: 10, h: 10, pad: 0 });
    const b = sparklinePath([100, 200], { w: 10, h: 10, pad: 0, invert: true });
    assert.equal(a?.d, 'M0,10 L10,0');
    assert.equal(b?.d, 'M0,0 L10,10');
  });
  test('route: fits lat/lng into a box, longer side = size, first/last kept', () => {
    const r = routePath([[52.0, -1.0], [52.0, -0.5], [52.1, -0.5]], { size: 200, pad: 0 });
    assert.ok(r);
    assert.equal(r.w, 200);
    assert.ok(r.h < 200 && r.h > 0);
    assert.match(r.d, /^M0,[\d.]+ L200,[\d.]+ L200,0$/);
    assert.deepEqual(r.start, { x: 0, y: r.h });
    assert.deepEqual(r.end, { x: 200, y: 0 });
    assert.equal(routePath([[0, 0], [0, 0]]), null);
    assert.equal(routePath([[52, -1]]), null);
  });
  test('hr zones: Z1–Z5 only, widths scaled to the busiest zone', () => {
    const z = hrZoneBars([0, 0, 2, 5, 9, 4]);
    assert.ok(z);
    assert.equal(z.total, 20);
    assert.deepEqual(z.bars.map((b) => b.label), ['Z1', 'Z2', 'Z3', 'Z4', 'Z5']);
    assert.equal(z.bars[3].w, 236);
    assert.equal(z.bars[0].w, 0);
    assert.equal(z.bars[4].pct, 20);
    assert.equal(hrZoneBars([0, 0, 0, 0, 0, 0]), null);
    const named = hrZoneBars([{ minutes: 9 }, { name: 'Zone 1 (Recovery)', minutes: 3, percentage: 50 }, { minutes: 3, percentage: 50 }, {}, {}, {}]);
    assert.equal(named?.bars[0].name, 'Zone 1 (Recovery)');
    assert.equal(named?.total, 6);
  });
});

describe('strength set list', () => {
  const sets = [
    { exerciseName: 'Bench Press (Barbell)', reps: 8, weightKg: 80 },
    { exerciseName: 'Bench Press (Barbell)', reps: 8, weightKg: 80 },
    { exerciseName: 'Bench Press (Barbell)', reps: 8, weightKg: 80 },
    { exerciseName: 'Bench Press (Barbell)', reps: 1, weightKg: 100 },
    { exerciseName: 'Plank', durationSeconds: 45 },
    { exerciseName: 'Plank', durationSeconds: 45 },
    { exerciseName: 'Sled Push', distanceMeters: 1200, weightKg: 60 },
  ];
  test('groups, collapses identical consecutive sets, computes volume', () => {
    const g = groupStrengthSets(sets, new Set(['Bench Press (Barbell)']));
    assert.ok(g);
    assert.equal(g.exercises.length, 3);
    assert.deepEqual(g.exercises[0].chips, ['3×8 × 80kg', '1 × 100kg']);
    assert.equal(g.exercises[0].isPR, true);
    assert.equal(g.exercises[0].volume, 2020);
    assert.equal(g.exercises[0].summary, '4 sets · 25 reps · 2,020 kg');
    assert.deepEqual(g.exercises[1].chips, ['2×45s']);
    assert.equal(g.exercises[1].volumeLabel, '1m30s');
    assert.deepEqual(g.exercises[2].chips, ['1.2km × 60kg']);
    assert.equal(g.totalSets, 7);
    assert.equal(g.totalReps, 25);
    assert.equal(g.totalVolume, 2020);
    assert.equal(g.right, '3 exercises · 7 sets');
    assert.equal(groupStrengthSets([]), null);
  });
  test('chips', () => {
    assert.equal(setChip({ reps: 10, weightKg: 0, durationSeconds: 0, distanceMeters: 0, count: 1 }), '10');
    assert.equal(setChip({ reps: 0, weightKg: 0, durationSeconds: 3660, distanceMeters: 0, count: 1 }), '1h1m');
    assert.equal(setChip({ reps: 5, weightKg: 62.5, durationSeconds: 0, distanceMeters: 0, count: 2 }), '2×5 × 62.5kg');
  });
});

describe('boosters and PRs', () => {
  test('timeline keeps canonical order, unknown names last', () => {
    const t = boosterTimeline(['ENRICHER_PROVIDER_WEATHER', 'ENRICHER_PROVIDER_SOMETHING_ELSE', 'ENRICHER_PROVIDER_AI_BANNER', 'ENRICHER_PROVIDER_LOGIC_GATE']);
    assert.ok(t);
    assert.equal(t.count, 4);
    assert.deepEqual(t.items.map((i) => i.name), ['AI Banner', 'Logic Gate', 'Weather', 'Something Else']);
    assert.equal(t.items[1].sub, '✓ ran · no visual output');
    assert.equal(t.items[2].sub, '✓ ran');
    assert.equal(boosterTimeline([]), null);
  });
  test('record types', () => {
    assert.deepEqual(parseRecordType('Bench Press (Barbell)_1rm'), { label: 'Bench Press (Barbell)', exercise: 'Bench Press (Barbell)', prType: '1RM', isStrength: true });
    assert.equal(parseRecordType('5k').prType, '');
    assert.equal(topPR([{ recordType: 'x_set_volume' }, { recordType: 'x_1rm' }]).recordType, 'x_1rm');
    assert.equal(topPR([{ recordType: 'fastest_5k' }, { recordType: 'fastest_10k' }]).recordType, 'fastest_10k');
    assert.deepEqual(prValue(1192, 'seconds'), { val: '19:52', unit: '' });
    assert.deepEqual(prValue(1500, 'meters'), { val: '1.5', unit: 'km' });
    assert.equal(prDelta(1192, 1206, 'seconds'), '−14s');
    assert.equal(prDelta(100, 97.5, 'kg'), '+2.5 kg');
    assert.equal(prDelta(100, 0, 'kg'), '');
    assert.equal(prDelta(1300, 1206, 'seconds'), '');
  });
});

describe('hero anchors by category', () => {
  test('cardio-distance run: km / time / pace / hr', () => {
    const a = anchorStats({ category: 'cardio-distance', distanceM: 5010, durationS: 1192, avgBpm: 171, maxBpm: 186, calories: 342, pace: 237.9, speedKmh: 0, sets: 0, volumeKg: 0, prCount: 1, icon: '🏃' });
    assert.deepEqual(a.map((x) => `${x.value}${x.unit}|${x.label}`), ['5.01km|distance', '19:52|time', '3:58/km|avg pace', '171bpm|avg hr']);
  });
  test('cardio-distance ride without pace shows speed; pace falls back to duration/distance', () => {
    const ride = anchorStats({ category: 'cardio-distance', distanceM: 32900, durationS: 4452, avgBpm: 142, maxBpm: 0, calories: 0, pace: 0, speedKmh: 26.6, sets: 0, volumeKg: 0, prCount: 0, icon: '🚴' });
    assert.equal(`${ride[2].value}${ride[2].unit}`, '26.6km/h');
    const walk = anchorStats({ category: 'cardio-distance', distanceM: 2000, durationS: 1200, avgBpm: 0, maxBpm: 0, calories: 0, pace: 0, speedKmh: 0, sets: 0, volumeKg: 0, prCount: 0, icon: '🚶' });
    assert.equal(walk[2].value, '10:00');
    assert.equal(walk[3].value, '—');
  });
  test('strength and untraditional padding', () => {
    const s = anchorStats({ category: 'strength', distanceM: 0, durationS: 3300, avgBpm: 118, maxBpm: 152, calories: 410, pace: 0, speedKmh: 0, sets: 18, volumeKg: 9640, prCount: 2, icon: '🏋️' });
    assert.deepEqual(s.map((x) => x.value), ['18', '9,640', '55', '+2']);
    const u = anchorStats({ category: 'untraditional', distanceM: 0, durationS: 600, avgBpm: 0, maxBpm: 0, calories: 0, pace: 0, speedKmh: 0, sets: 0, volumeKg: 0, prCount: 0, icon: '🏅' });
    assert.deepEqual(u.map((x) => x.value), ['10', '—', '—', '—']);
  });
});

describe('module gating (§4)', () => {
  const has = (/** @type {string} */ k) => k === 'HEART_RATE_SUMMARY' || k === 'WEATHER';
  test('a module needs its enricher applied and non-empty data', () => {
    const ctx = { en: { heartRate: { avgBpm: 150, minBpm: 90, maxBpm: 180, driftBpm: 0 }, calories: { kcal: 300 } }, series: {}, has, category: 'cardio-distance', activityType: 'ACTIVITY_TYPE_RUN' };
    assert.equal(buildModule('heart-rate', ctx)?.cells.length, 3);
    assert.equal(buildModule('calories', ctx), null, 'CALORIES_BURNED not applied');
    assert.equal(buildModule('heart-rate', { ...ctx, en: { heartRate: { avgBpm: 0 } } }), null, 'avgBpm 0');
    assert.equal(buildModule('weather', { ...ctx, en: { weather: { tempC: 9 } }, category: 'strength' }), null, 'weather is cardio-distance only');
    assert.equal(buildModule('weather', { ...ctx, en: { weather: { tempC: 9, weatherCode: 2 } } })?.right, '⛅');
  });
  test('order per category', () => {
    assert.deepEqual(moduleOrderFor('strength').slice(0, 3), ['muscle-heatmap', 'set-list', 'heart-rate']);
    assert.deepEqual(moduleOrderFor('untraditional').slice(0, 2), ['heart-rate', 'calories']);
    assert.ok(moduleOrderFor('sport').includes('spotify'));
  });
  test('category derivation when the export did not carry one', () => {
    assert.equal(deriveCategory({ activityType: 'ACTIVITY_TYPE_YOGA' }), 'cardio-time');
    assert.equal(deriveCategory({ activityType: 'ACTIVITY_TYPE_WORKOUT', activityData: { sessions: [{ strengthSets: [{}] }] } }), 'strength');
    assert.equal(deriveCategory({ activityType: 'ACTIVITY_TYPE_GOLF' }), 'sport');
    assert.equal(deriveCategory({}), 'untraditional');
  });
});

describe('view model from the fixtures', () => {
  test('parkrun run: bands, zones, map, photos (gallery on), modules in order', async () => {
    const index = await fixtureIndex();
    const v = buildActivityView(await fixture('colwick-parkrun-2026-10-17'), index, { siteUrl: 'https://james.ripixel.co.uk/' });
    const a = v.act;
    assert.equal(a.url, '/life/activity/colwick-parkrun-2026-10-17');
    assert.equal(a.canonical, 'https://james.ripixel.co.uk/life/activity/colwick-parkrun-2026-10-17');
    assert.equal(a.typeLabel, 'RUN');
    assert.equal(a.source, 'Strava');
    assert.equal(a.dateStamp, 'SAT 17 OCT 2026');
    assert.equal(a.prCount, 1);
    assert.equal(a.destinationCount, 3);
    assert.equal(a.locationName, 'COLWICK PARK, NOTTINGHAM');
    assert.equal(a.parkrun?.finishTime, '19:52');
    assert.equal(a.parkrun?.position, '#23');
    assert.equal(a.prBand?.label, '5K');
    assert.equal(a.prBand?.delta, '−14s');
    assert.equal(a.description, 'Went out hard on the first lap and somehow held it. New 5K best.');
    assert.match(a.aiSummaryHtml, /^<p>A <b>5K personal best<\/b>/);
    assert.ok(a.hrZones && a.hrZones.total === 20);
    assert.ok(a.route && a.route.d.startsWith('M'));
    assert.equal(a.routeThumbnailUrl, '');
    assert.equal(a.photos.length, 1);
    assert.equal(a.heroSpark?.label, 'heart rate · bpm');
    assert.deepEqual(a.modules.map((m) => m.key), ['heart-rate', 'zones', 'pace', 'cadence', 'elevation', 'effort', 'calories', 'training-load', 'best-efforts', 'pr-callout', 'streak', 'weather']);
    assert.equal(a.boosters?.count, 19);
    assert.deepEqual(a.footerChips, ['↗ Linked to Strava']);
    assert.equal(a.ogImage, a.photos[0]);
    assert.equal(v.description, a.description);
    // head.html overrides
    assert.equal(v.headTitle, 'Colwick parkrun #87 — James King');
    assert.equal(v.ogType, 'article');
    assert.equal(v.ogImage, a.photos[0]);
    assert.equal(v.canonical, a.canonical);
    assert.equal(v.publishedTime, '2026-10-17T08:00:00Z');
    assert.equal(v.atomFeed, '/life/feed.xml');
  });
  test('a rendered OG card (S2.5) beats banner and photo for og:image; a non-URL is ignored', async () => {
    const index = await fixtureIndex();
    const ride = await fixture('evening-ride-to-the-reservoir-2026-10-15');
    const card = 'https://james.ripixel.co.uk/life/og/activity/evening-ride-to-the-reservoir-2026-10-15.png';
    assert.equal(buildActivityView(ride, index, { ogCard: card }).ogImage, card);
    assert.match(buildActivityView(ride, index, { ogCard: 'life/og/x.png' }).ogImage, /banner\.png$/);
  });
  test('photos are gated by profile.showPhotoGallery', async () => {
    const index = await fixtureIndex();
    const file = await fixture('colwick-parkrun-2026-10-17');
    const v = buildActivityView(file, { ...index, profile: { ...index.profile, showPhotoGallery: false } });
    assert.deepEqual(v.act.photos, []);
    assert.equal(v.act.bgPhotoUrl, '');
    assert.equal(v.act.ogImage, '');
  });
  test('ride: banner, speed not pace, milestone, recovery/temperature tail', async () => {
    const v = buildActivityView(await fixture('evening-ride-to-the-reservoir-2026-10-15'), await fixtureIndex());
    const a = v.act;
    assert.match(a.bannerUrl, /banner\.png$/);
    assert.equal(a.ogImage, a.bannerUrl);
    assert.equal(a.anchors[2].label, 'avg speed');
    assert.equal(a.milestone?.toGoKm, '187.7');
    assert.equal(a.milestone?.crossedKm, '');
    assert.equal(a.prBand, null);
    assert.deepEqual(a.modules.map((m) => m.key), ['heart-rate', 'zones', 'speed', 'cadence', 'elevation', 'power', 'effort', 'calories', 'training-load', 'recovery', 'weather', 'temperature']);
    assert.equal(a.description, 'Out along the Trent, up the one proper hill, home in the dark.');
  });
  test('strength: set list with PR stamp, muscle heatmap, no map', async () => {
    const v = buildActivityView(await fixture('push-day-2026-10-13'), await fixtureIndex());
    const a = v.act;
    assert.equal(a.category, 'strength');
    assert.deepEqual(a.anchors.map((x) => x.label), ['sets', 'volume moved', 'duration', 'personal records']);
    assert.equal(a.route, null);
    assert.equal(a.routeThumbnailUrl, '');
    const keys = a.modules.map((m) => m.key);
    assert.deepEqual(keys.slice(0, 3), ['muscle-heatmap', 'set-list', 'heart-rate']);
    const setList = a.modules.find((m) => m.key === 'set-list')?.setList;
    assert.ok(setList);
    assert.equal(setList.exercises[0].name, 'Bench Press (Barbell)');
    assert.equal(setList.exercises[0].isPR, true);
    assert.equal(a.prBand?.label, 'BENCH PRESS (BARBELL)');
    assert.equal(a.prBand?.sub, '1RM · NEW PERSONAL RECORD · +1 MORE RECORD BELOW');
    assert.equal(a.boostersDidNotRun, false);
  });
  test('metadata-only activity (enrichments null, activityData null) still renders a page', () => {
    const v = buildActivityView(
      { slug: 'old-one-2025-05-01', category: 'cardio-distance', activity: { title: 'Old one', activityType: 'ACTIVITY_TYPE_RUN', source: 'SOURCE_STRAVA', startTime: '2025-05-01T07:00:00Z', activityData: null, enrichments: null, appliedEnrichments: [], tags: [], photoUrls: [] }, entry: { distanceMeters: 8000, durationSeconds: 2400, hrZoneMinutes: [], photoUrls: [] }, series: {}, routePoints: [] },
      { profile: { showPhotoGallery: true } },
    );
    assert.equal(v.act.boostersDidNotRun, true);
    assert.deepEqual(v.act.modules, []);
    assert.equal(v.act.boosters, null);
    assert.equal(v.act.anchors[0].value, '8.00');
    assert.equal(v.act.anchors[2].value, '5:00');
    assert.equal(v.act.heroSpark, null);
    assert.equal(v.act.hrZones, null);
  });
});

describe('task', () => {
  /** @param {string[]} into */
  const logger = (into) => ({ info() {}, warn(/** @type {string} */ m) { into.push(m); }, error() {}, debug() {} });

  test('builds one view per activity from the fixtures and skips bad slugs', async () => {
    const data = await loadFitnessData({ env: {}, source: 'fixtures', fixturesDir: FIXTURES });
    const warnings = [];
    const task = fitnessActivityViewsTask();
    const out = await task.run(task.config, {
      debug: false,
      globals: { fitnessIndex: data.index, fitnessActivities: [...data.activities, { slug: '../escape', activity: {}, entry: {} }], siteUrl: 'https://james.ripixel.co.uk' },
      logger: logger(warnings),
    });
    assert.deepEqual(out.fitnessActivityPages.map((/** @type {any} */ p) => p.act.slug), ['colwick-parkrun-2026-10-17', 'evening-ride-to-the-reservoir-2026-10-15', 'push-day-2026-10-13']);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /unusable activity slug/);
  });

  test('Skier renders the pages from the views (the activity template, partials and helpers)', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'activity-pages-'));
    try {
      const data = await loadFitnessData({ env: {}, source: 'fixtures', fixturesDir: FIXTURES });
      const globals = {
        fitnessIndex: data.index, fitnessActivities: data.activities, fitnessRoundups: [], year: 2026, cacheHash: 'x', siteUrl: 'https://james.ripixel.co.uk',
        fitnessOgImages: { activity: { 'colwick-parkrun-2026-10-17': 'https://james.ripixel.co.uk/life/og/activity/colwick-parkrun-2026-10-17.png' }, roundup: {} },
      };
      const [activityPages] = lifePageTasks({ outDir: tmp, siteUrl: globals.siteUrl });
      await runSkierTasks([fitnessActivityViewsTask(), activityPages], globals);
      const html = await fs.readFile(path.join(tmp, 'life', 'activity', 'colwick-parkrun-2026-10-17', 'index.html'), 'utf8');
      assert.match(html, /<title>Colwick parkrun #87 — James King<\/title>/);
      assert.match(html, /<meta property="og:image" content="https:\/\/james\.ripixel\.co\.uk\/life\/og\/activity\/colwick-parkrun-2026-10-17\.png"/);
      assert.match(html, /<meta property="og:type" content="article"/);
      assert.match(html, /<link rel="canonical" href="https:\/\/james\.ripixel\.co\.uk\/life\/activity\/colwick-parkrun-2026-10-17"/);
      assert.match(html, /<link rel="alternate" type="application\/atom\+xml" href="\/life\/feed\.xml"/);
      assert.doesNotMatch(html, /activity-head/);
      assert.match(html, /class="act-zones__bar"/);
      assert.match(html, /class="act-sparkline__line"/);
      assert.match(html, /class="act-map__svg"/);
      assert.match(html, /act-band--parkrun/);
      assert.match(html, /href="\/life"/);
      assert.match(html, /<link rel="stylesheet" href="\/styles\.min\.x\.css"/);
      // No fitglue.tech page links anywhere — the masthead/tab-bar "fitness" item points at /life since S2.5.
      assert.doesNotMatch(html, /fitglue\.tech\/@/);
      assert.doesNotMatch(html, /href="https?:\/\/[^"]*fitglue\.tech/);
      assert.match(html, /class="nav-fitness" href="\/life"/);
      assert.doesNotMatch(html, /<script src="http/);
      const ride = await fs.readFile(path.join(tmp, 'life', 'activity', 'evening-ride-to-the-reservoir-2026-10-15', 'index.html'), 'utf8');
      assert.match(ride, /<meta property="og:image" content="https:\/\/[^"]*\/banner\.png"/, 'no card for this slug → the AI banner');
      const strength = await fs.readFile(path.join(tmp, 'life', 'activity', 'push-day-2026-10-13', 'index.html'), 'utf8');
      assert.match(strength, /class="exercise-item exercise-strength"/, 'exercise-item needs the eq helper');
      assert.match(strength, /4×8 × 80kg/);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  test('no activities → an empty view list and a warning', async () => {
    const warnings = [];
    const task = fitnessActivityViewsTask();
    const out = await task.run(task.config, { debug: false, globals: { fitnessActivities: [] }, logger: logger(warnings) });
    assert.deepEqual(out, { fitnessActivityPages: [] });
    assert.equal(warnings.length, 1);
  });
});

describe('calories, the type chip and the type ink (F5.5)', async () => {
  const { calorieFigure, foodComparison } = await import('./fitness-calories.mjs');
  const { hybridRaceLabel } = await import('./fitness-theme.mjs');
  test("the platform's calories over FitGlue's estimate", () => {
    const solo = { activityData: { sessions: [{ totalCalories: 1346 }] }, enrichments: { calories: { kcal: 523, comparisonText: '≈ 1.8 slice of pizza 🍕' } } };
    assert.deepEqual(calorieFigure(solo), { kcal: 1346, source: 'platform', note: '≈ 4.7 slice of pizza 🍕' });
    const hevy = { activityData: { sessions: [{}] }, enrichments: { calories: { kcal: 310 } } };
    assert.deepEqual(calorieFigure(hevy), { kcal: 310, source: 'estimate', note: '' });
    assert.deepEqual(calorieFigure({}, { caloriesKcal: 200 }), { kcal: 200, source: 'estimate', note: '' });
    assert.deepEqual(calorieFigure({}), { kcal: 0, source: '', note: '' });
    assert.equal(foodComparison(40), '');
  });
  test('the calories module says where the figure came from', () => {
    const has = (/** @type {string} */ k) => k === 'CALORIES_BURNED';
    const activity = { source: 'SOURCE_STRAVA', activityData: { sessions: [{ totalCalories: 1132 }] }, enrichments: { calories: { kcal: 440 } } };
    const m = buildModule('calories', { en: activity.enrichments, series: {}, has, category: 'strength', activityType: 'ACTIVITY_TYPE_CROSSFIT', activity, entry: {} });
    assert.equal(m?.cells[0].value, '1,132');
    assert.equal(m?.right, 'from Strava');
  });
  test('Hyrox races are labelled Hyrox, not CROSSFIT', () => {
    assert.equal(hybridRaceLabel("Hyrox Birmingham - Open Men's Solo"), 'HYROX');
    assert.equal(hybridRaceLabel('Morning WOD'), '');
    assert.equal(hybridRaceLabel('Race', { hasRace: true }), 'HYROX', 'a race breakdown is a Hyrox race');
  });
  test('an activity page takes its type ink', () => {
    const v = buildActivityView({ slug: 'r', activity: { title: 'Run', activityType: 'ACTIVITY_TYPE_RUN', startTime: '2026-01-01T09:00:00Z' }, entry: {} }, {});
    assert.equal(v.act.typeClass, 'fit-type--run');
  });
});
