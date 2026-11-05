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
  routePath,
  hrZoneBars,
  topPR,
  prValue,
  prDelta,
  anchorStats,
  modulesFor,
  buildModule,
  buildActivityView,
  deriveCategory,
  fitnessActivityViewsTask,
} from './fitness-activity-views.mjs';
import { loadFitnessData } from './fitness-fetch.mjs';
import { buildActivityHistory } from './fitness-activity-kinds.mjs';
import { lifePageTasks } from './life-pages.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = path.join(REPO, 'fixtures', 'fitness');
/** One activity per page kind the shared fixtures lack (pilates, a Hyrox PT class). Kept out of
 * fixtures/fitness so the feed, calendar and roundup suites keep their own fixed set. */
const KIND_FIXTURES = path.join(REPO, 'fixtures', 'fitness-kinds');
const KIND_SLUGS = ['glutes-core-pilates-2026-10-19', 'half-hyrox-pt-2026-10-21'];

/** @param {string} slug */
async function fixture(slug) {
  const dir = KIND_SLUGS.includes(slug) ? KIND_FIXTURES : path.join(FIXTURES, 'activity');
  return JSON.parse(await fs.readFile(path.join(dir, `${slug}.json`), 'utf8'));
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
    assert.equal(typeIcon('ACTIVITY_TYPE_RIDE'), 'RDE');
    assert.equal(typeIcon('ACTIVITY_TYPE_SOMETHING_NEW'), '★');
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
  test('hr zones: Z1–Z5 only, heights scaled to a nice minutes axis', () => {
    const z = hrZoneBars([0, 0, 2, 5, 9, 4]);
    assert.ok(z);
    assert.equal(z.total, 20);
    assert.deepEqual(z.bars.map((b) => b.label), ['Z1', 'Z2', 'Z3', 'Z4', 'Z5']);
    assert.equal(z.bars[0].h, 0);
    assert.ok(z.bars[3].h > z.bars[2].h && z.bars[2].h > z.bars[1].h, 'taller bar, more minutes');
    assert.equal(z.yLabel, 'min');
    assert.deepEqual(z.yTicks.map((t) => t.label), ['10', '5', '0']);
    assert.equal(z.yTicks[0].pct < z.yTicks.at(-1).pct, true, 'top tick is higher up');
    assert.equal(z.bars[4].pct, 20);
    assert.equal(hrZoneBars([0, 0, 0, 0, 0, 0]), null);
    const named = hrZoneBars([{ minutes: 9 }, { name: 'Zone 1 (Recovery)', minutes: 3, percentage: 50 }, { minutes: 3, percentage: 50 }, {}, {}, {}]);
    assert.equal(named?.bars[0].name, 'Zone 1 (Recovery)');
    assert.equal(named?.total, 6);
  });
});

describe('no vestigial showcase stats', () => {
  const slugs = ['colwick-parkrun-2026-10-17', 'evening-ride-to-the-reservoir-2026-10-15', 'push-day-2026-10-13', 'glutes-core-pilates-2026-10-19', 'half-hyrox-pt-2026-10-21'];
  /** @param {any} o @param {string} p @param {string[]} hits */
  function walk(o, p, hits) {
    if (Array.isArray(o)) o.forEach((x, i) => walk(x, `${p}[${i}]`, hits));
    else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) {
      if (/booster|destination|banner/i.test(k)) hits.push(`${p}.${k}`);
      walk(v, `${p}.${k}`, hits);
    }
  }
  for (const slug of slugs) {
    test(`${slug}: no booster/destination/banner keys, no "pushed to" stat`, async () => {
      const v = buildActivityView(await fixture(slug), await fixtureIndex());
      const hits = [];
      walk(v.act, 'act', hits);
      assert.deepEqual(hits, []);
      assert.ok(v.act.headline.every((a) => a.value && a.value !== '—'), 'no dash placeholders in the headline');
    });
  }
});

describe('PRs', () => {
  test('record types', () => {
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
    const a = anchorStats({ category: 'cardio-distance', distanceM: 5010, durationS: 1192, avgBpm: 171, maxBpm: 186, calories: 342, pace: 237.9, speedKmh: 0, sets: 0, volumeKg: 0, prCount: 1, icon: 'RUN' });
    assert.deepEqual(a.map((x) => `${x.value}${x.unit}|${x.label}`), ['5.01km|distance', '19:52|time', '3:58/km|avg pace', '171bpm|avg hr']);
  });
  test('cardio-distance ride without pace shows speed; pace falls back to duration/distance', () => {
    const ride = anchorStats({ category: 'cardio-distance', distanceM: 32900, durationS: 4452, avgBpm: 142, maxBpm: 0, calories: 0, pace: 0, speedKmh: 26.6, sets: 0, volumeKg: 0, prCount: 0, icon: 'RDE' });
    assert.equal(`${ride[2].value}${ride[2].unit}`, '26.6km/h');
    const walk = anchorStats({ category: 'cardio-distance', distanceM: 2000, durationS: 1200, avgBpm: 0, maxBpm: 0, calories: 0, pace: 0, speedKmh: 0, sets: 0, volumeKg: 0, prCount: 0, icon: 'WLK' });
    assert.equal(walk[2].value, '10:00');
    assert.equal(walk[3].value, '—');
  });
  test('strength and untraditional padding', () => {
    const s = anchorStats({ category: 'strength', distanceM: 0, durationS: 3300, avgBpm: 118, maxBpm: 152, calories: 410, pace: 0, speedKmh: 0, sets: 18, volumeKg: 9640, prCount: 2, icon: 'GYM' });
    assert.deepEqual(s.map((x) => x.value), ['18', '9,640', '55', '+2']);
    const u = anchorStats({ category: 'untraditional', distanceM: 0, durationS: 600, avgBpm: 0, maxBpm: 0, calories: 0, pace: 0, speedKmh: 0, sets: 0, volumeKg: 0, prCount: 0, icon: '★' });
    assert.deepEqual(u.map((x) => x.value), ['10', '—', '—', '—']);
  });
});

describe('grid modules', () => {
  const has = (/** @type {string} */ k) => k === 'SPEED_SUMMARY' || k === 'CADENCE_SUMMARY';
  test('a module needs its enricher applied and non-empty data', () => {
    const ctx = { en: { speed: { avgSpeedKmh: 26.6, maxSpeedKmh: 41 }, cadence: { avgRpm: 0 } }, series: {}, has, category: 'cardio-distance', activityType: 'ACTIVITY_TYPE_RIDE' };
    assert.equal(buildModule('speed', ctx)?.cells[0].value, '26.6');
    assert.equal(buildModule('cadence', ctx), null, 'avgRpm 0');
    assert.equal(buildModule('power', ctx), null, 'POWER_SUMMARY not applied');
    assert.equal(buildModule('heart-rate', ctx), null, 'heart rate is the heart card now, not a module');
  });
  test('modules per kind', () => {
    assert.deepEqual(modulesFor('run').slice(0, 3), ['cadence', 'power', 'running-dynamics']);
    assert.deepEqual(modulesFor('mind'), ['spotify']);
    assert.ok(!modulesFor('strength').includes('set-list'));
    assert.deepEqual(modulesFor('nonsense'), modulesFor('other'));
  });
  test('category derivation when the export did not carry one', () => {
    assert.equal(deriveCategory({ activityType: 'ACTIVITY_TYPE_YOGA' }), 'cardio-time');
    assert.equal(deriveCategory({ activityType: 'ACTIVITY_TYPE_WORKOUT', activityData: { sessions: [{ strengthSets: [{}] }] } }), 'strength');
    assert.equal(deriveCategory({ activityType: 'ACTIVITY_TYPE_GOLF' }), 'sport');
    assert.equal(deriveCategory({}), 'untraditional');
  });
});

describe('view model from the fixtures', () => {
  test('parkrun run: the run page — route, splits, elevation, efforts, bands, one heart chart', async () => {
    const index = await fixtureIndex();
    const v = buildActivityView(await fixture('colwick-parkrun-2026-10-17'), index, { siteUrl: 'https://james.ripixel.co.uk/' });
    const a = v.act;
    assert.equal(a.kind, 'run');
    assert.deepEqual(a.is, { run: true });
    assert.equal(a.url, '/life/activity/colwick-parkrun-2026-10-17');
    assert.equal(a.canonical, 'https://james.ripixel.co.uk/life/activity/colwick-parkrun-2026-10-17');
    assert.equal(a.typeLabel, 'RUN');
    assert.equal(a.source, 'Strava');
    assert.equal(a.dateStamp, 'SAT 17 OCT 2026');
    assert.equal(a.prCount, 1);
    assert.equal(a.locationName, 'COLWICK PARK, NOTTINGHAM');
    assert.equal(a.parkrun?.finishTime, '19:52');
    assert.equal(a.parkrun?.position, '#23');
    assert.equal(a.prBand?.label, '5K');
    assert.equal(a.prBand?.delta, '−14s');
    assert.equal(a.description, 'Went out hard on the first lap and somehow held it. New 5K best.');
    assert.equal(a.aiSummaryHtml, '', 'a Gemini summary is hidden');
    assert.deepEqual(a.headline.map((x) => `${x.value}${x.unit}|${x.label}`), ['5.01km|distance', '19:52|time', '3:58/km|avg pace', '171bpm|avg hr']);
    assert.ok(a.route && a.route.d.startsWith('M'));
    assert.equal(a.routeMap?.state, 'map');
    assert.equal(JSON.parse(a.routeMap.json).kind, 'route');
    assert.ok(a.run?.splits && a.run.splits.rows.length >= 2);
    assert.ok(a.run.splits.rows.some((r) => r.fastest));
    assert.ok(a.run?.efforts.length);
    assert.equal(a.run.efforts.find((e) => e.label === '5K')?.badge, 'PB', 'FitGlue says PB');
    assert.ok(a.heart?.chart, 'the heart card carries the one HR chart');
    assert.equal(a.heart.chart.unit, 'bpm');
    assert.match(a.heart.chart.xTicks.at(-1).label, /^\d+:\d{2}$/);
    assert.ok(a.heart.zones && a.heart.zones.total === 20);
    assert.equal(a.heroChart, undefined, 'no second HR chart at the top');
    assert.equal(a.photos.length, 1);
    assert.deepEqual(a.modules.map((m) => m.key), ['cadence']);
    assert.deepEqual(a.finePrint.map((c) => c.label), ['calories', 'effort', 'training load', 'active streak', 'weather']);
    assert.ok(a.finePrint.every((c) => !/\p{Extended_Pictographic}/u.test(`${c.value}${c.note}`)));
    assert.deepEqual(a.prs, [], 'a run shows its PBs as effort badges');
    assert.deepEqual(a.footerChips, ['→ Linked to Strava']);
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
  test('a current (Claude) AI summary is shown', async () => {
    const file = await fixture('colwick-parkrun-2026-10-17');
    file.activity.enrichments.aiSummary = { ...file.activity.enrichments.aiSummary, model: 'claude-haiku-4-5' };
    assert.match(buildActivityView(file, await fixtureIndex()).act.aiSummaryHtml, /^<p>A <b>5K personal best<\/b>/);
  });
  test('a rendered OG card (S2.5) beats the photo for og:image; a non-URL is ignored', async () => {
    const index = await fixtureIndex();
    const ride = await fixture('evening-ride-to-the-reservoir-2026-10-15');
    const card = 'https://james.ripixel.co.uk/life/og/activity/evening-ride-to-the-reservoir-2026-10-15.png';
    assert.equal(buildActivityView(ride, index, { ogCard: card }).ogImage, card);
    assert.equal(buildActivityView(ride, index, { ogCard: 'life/og/x.png' }).ogImage, '');
  });
  test('photos are gated by profile.showPhotoGallery', async () => {
    const index = await fixtureIndex();
    const file = await fixture('colwick-parkrun-2026-10-17');
    const v = buildActivityView(file, { ...index, profile: { ...index.profile, showPhotoGallery: false } });
    assert.deepEqual(v.act.photos, []);
    assert.equal(v.act.bgPhotoUrl, '');
    assert.equal(v.act.ogImage, '');
  });
  test('ride: speed not pace, lifetime progress, speed/cadence/power cards', async () => {
    const v = buildActivityView(await fixture('evening-ride-to-the-reservoir-2026-10-15'), await fixtureIndex());
    const a = v.act;
    assert.equal(a.kind, 'ride');
    assert.equal(a.headline[2].label, 'avg speed');
    assert.equal(a.lifetime?.toGo, '187.7');
    assert.equal(a.lifetime?.crossed, '');
    assert.equal(a.prBand, null);
    assert.deepEqual(a.modules.map((m) => m.key), ['speed', 'cadence', 'power', 'temperature']);
    assert.ok(a.ride?.elevation);
    assert.equal(a.description, 'Out along the Trent, up the one proper hill, home in the dark.');
  });
  test('strength: every set a bar, PR marked, muscles, records in plain words, no map', async () => {
    const v = buildActivityView(await fixture('push-day-2026-10-13'), await fixtureIndex());
    const a = v.act;
    assert.equal(a.kind, 'strength');
    assert.deepEqual(a.headline.map((x) => x.label), ['volume moved', 'heaviest set', 'sets', 'reps']);
    assert.equal(a.route, null);
    assert.equal(a.routeMap, null);
    const bench = a.strength?.lifts[0];
    assert.equal(bench?.name, 'Bench Press (Barbell)');
    assert.equal(bench?.isPR, true);
    assert.equal(bench?.bars.filter((b) => b.heaviest).length, 1);
    assert.ok(a.strength?.muscles.length);
    assert.equal(a.prBand?.label, 'BENCH PRESS (BARBELL) · 1RM');
    assert.equal(a.prBand?.sub, 'NEW PERSONAL RECORD · +1 MORE RECORD BELOW');
    assert.ok(a.prs.length >= 2);
    assert.ok(a.prs.every((r) => !/\p{Extended_Pictographic}/u.test(r.primary)));
  });
  test('class: the engine (zone ribbon, minutes per zone) and the work, no lifting stats', async () => {
    const v = buildActivityView(await fixture('half-hyrox-pt-2026-10-21'), await fixtureIndex(), { maxHr: 186 });
    const a = v.act;
    assert.equal(a.kind, 'class');
    assert.deepEqual(a.headline.map((x) => x.label), ['minutes', 'in zones 4–5', 'peak hr', 'calories']);
    assert.ok(a.engine?.ribbon?.bands.some((b) => b.zone === 5));
    assert.ok(a.engine?.split?.some((z) => z.key === 'z4'));
    assert.equal(a.heart, null, 'the ribbon is the heart chart');
    assert.deepEqual(a.stations?.tiles.map((t) => t.name), ['Treadmill', 'Ski Erg', 'Sled Push', 'Sled Pull', 'Burpee Broad Jumps', 'Wall Ball', 'Farmers Carry']);
    assert.deepEqual(a.stations?.circuits, [{ letter: 'A', rounds: 3, names: 'Wall Ball + Farmers Carry' }]);
    assert.equal(a.strength, null);
    assert.equal(a.locationName, 'FERNWOOD CP, NEWARK');
    assert.equal(a.aiSummaryHtml, '', 'before the switch to Claude: hidden');
  });
  test('pilates: calm — the practice and the focus, no sets, volume or records', async () => {
    const files = [await fixture('glutes-core-pilates-2026-10-19')];
    const v = buildActivityView(files[0], await fixtureIndex(), { activityHistory: buildActivityHistory(files) });
    const a = v.act;
    assert.equal(a.kind, 'mind');
    assert.deepEqual(a.headline.map((x) => x.label), ['minutes', 'pilates of 2026', 'avg hr']);
    assert.equal(a.mind?.practice?.nthYearLabel, '1st');
    assert.deepEqual(a.mind?.focus.map((f) => f.word), ['Glutes', 'Core']);
    assert.ok(a.mind?.steady?.avg);
    assert.equal(a.prCount, 0);
    assert.equal(a.prBand, null);
    assert.deepEqual(a.prs, []);
    assert.equal(a.heart, null);
    assert.deepEqual(a.finePrint.map((c) => c.label), ['calories']);
    assert.equal(a.finePrint[0].note, '≈ 1.0 slice of pizza');
  });
  test('metadata-only activity (enrichments null, activityData null) still renders a page', () => {
    const v = buildActivityView(
      { slug: 'old-one-2025-05-01', category: 'cardio-distance', activity: { title: 'Old one', activityType: 'ACTIVITY_TYPE_RUN', source: 'SOURCE_STRAVA', startTime: '2025-05-01T07:00:00Z', activityData: null, enrichments: null, appliedEnrichments: [], tags: [], photoUrls: [] }, entry: { distanceMeters: 8000, durationSeconds: 2400, hrZoneMinutes: [], photoUrls: [] }, series: {}, routePoints: [] },
      { profile: { showPhotoGallery: true } },
    );
    assert.deepEqual(v.act.modules, []);
    assert.equal(v.act.headline[0].value, '8.00');
    assert.equal(v.act.headline[2].value, '5:00');
    assert.equal(v.act.heart, null);
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
    assert.deepEqual(out.fitnessActivityPages.map((/** @type {any} */ p) => `${p.act.slug}:${p.act.kind}`), ['colwick-parkrun-2026-10-17:run', 'evening-ride-to-the-reservoir-2026-10-15:ride', 'push-day-2026-10-13:strength']);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /unusable activity slug/);
  });

  test('Skier renders the pages from the views (the activity template, partials and helpers)', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'activity-pages-'));
    try {
      const data = await loadFitnessData({ env: {}, source: 'fixtures', fixturesDir: FIXTURES });
      const kinds = await Promise.all(KIND_SLUGS.map(fixture));
      const globals = {
        fitnessIndex: data.index, fitnessActivities: [...data.activities, ...kinds], fitnessRoundups: [], year: 2026, cacheHash: 'x', siteUrl: 'https://james.ripixel.co.uk',
        fitnessOgImages: { activity: { 'colwick-parkrun-2026-10-17': 'https://james.ripixel.co.uk/life/og/activity/colwick-parkrun-2026-10-17.png' }, roundup: {} },
        fitnessShareCards: { activity: { 'colwick-parkrun-2026-10-17': { title: 'Colwick parkrun #87', shapes: [
          { shape: 'story', label: 'Story', w: 1080, h: 1920, variants: [{ id: 'photo-1', label: 'Photo 1', url: '/life/share/activity/c/story-photo-1.jpg', file: 'c-story.jpg' }, { id: 'ink', label: 'Colour', url: '/life/share/activity/c/story-ink.png', file: 'c-story-ink.png' }] },
          { shape: 'landscape', label: 'Landscape', w: 1200, h: 630, variants: [{ id: 'photo-1', label: 'Photo 1', url: '/life/share/activity/c/landscape-photo-1.jpg', file: 'c-landscape.jpg' }] },
        ] } }, event: {}, roundup: {} },
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
      assert.equal((html.match(/aria-label="Heart rate in bpm/g) || []).length, 1, 'the HR chart once, in the heart card');
      assert.match(html, /class="act-split act-split--/);
      assert.match(html, /class="act-zones__yaxis"/);
      assert.match(html, /class="route-map__fallback act-map__svg"/);
      assert.match(html, /<div class="route-map route-map--activity" data-route-map role="region" aria-label="Route map\./);
      const mapData = html.match(/<script type="application\/json" data-route-map-data>([^<]*)<\/script>/);
      assert.ok(mapData, 'route map data');
      assert.equal(JSON.parse(mapData[1]).kind, 'route');
      assert.match(html, /<link rel="stylesheet" href="\/vendor\/leaflet-[^"]*\/leaflet\.css" \/>/);
      assert.match(html, /<script src="\/scripts\/route-map\.x\.js" defer><\/script>/);
      assert.match(html, /act-band--parkrun/);
      assert.match(html, /href="\/life"/);
      assert.match(html, /<link rel="stylesheet" href="\/styles\.min\.x\.css"/);
      // No fitglue.tech page links anywhere — the masthead/tab-bar "fitness" item points at /life since S2.5.
      assert.doesNotMatch(html, /fitglue\.tech\/@/);
      assert.doesNotMatch(html, /href="https?:\/\/[^"]*fitglue\.tech/);
      assert.match(html, /class="nav-fitness" href="\/life"/);
      assert.doesNotMatch(html, /<script src="http/);
      // F5.4 Share button: one file per shape × background, a radio per shape, the background group from the first shape.
      assert.match(html, /<div class="share" data-share data-title="Colwick parkrun #87">/);
      assert.equal((html.match(/<li data-shape=/g) || []).length, 3);
      assert.match(html, /<li data-shape="story" data-variant="ink" data-url="\/life\/share\/activity\/c\/story-ink\.png" data-file="c-story-ink\.png">/);
      assert.equal((html.match(/type="radio" name="share-shape"/g) || []).length, 2);
      assert.equal((html.match(/type="radio" name="share-variant"/g) || []).length, 2);
      assert.match(html, /<noscript><a class="share__open" href="\/life\/share\/activity\/c\/story-photo-1\.jpg" download="c-story\.jpg">/);
      assert.match(html, /<dialog class="share__dialog" id="share-dialog" aria-labelledby="share-dialog-title">/);
      const ride = await fs.readFile(path.join(tmp, 'life', 'activity', 'evening-ride-to-the-reservoir-2026-10-15', 'index.html'), 'utf8');
      assert.match(ride, /<meta property="og:image" content="https:\/\/james\.ripixel\.co\.uk\/card_[a-z]+\.png"/, 'no card, no photo → the section card');
      assert.doesNotMatch(ride, /data-share/, 'no share entry → no button');
      const slugs = ['colwick-parkrun-2026-10-17', 'evening-ride-to-the-reservoir-2026-10-15', 'push-day-2026-10-13', 'glutes-core-pilates-2026-10-19', 'half-hyrox-pt-2026-10-21'];
      for (const slug of slugs) {
        const page = await fs.readFile(path.join(tmp, 'life', 'activity', slug, 'index.html'), 'utf8');
        assert.doesNotMatch(page, /DESTINATION|BOOSTER|booster sequence|AI banner/, slug + ': no showcase stats or banner');
        assert.doesNotMatch(page, /<div class="stat-strip__num">—/, slug + ': no dash placeholder stats');
        assert.ok((page.match(/aria-label="Heart rate in bpm/g) || []).length <= 1, slug + ': the HR chart is drawn once');
        assert.doesNotMatch(page, /\u{1F355}|\u{1F3C6}/u, slug + ': none of FitGlue\'s emoji (calorie comparison, PR messages)');
      }
      const strength = await fs.readFile(path.join(tmp, 'life', 'activity', 'push-day-2026-10-13', 'index.html'), 'utf8');
      assert.match(strength, /class="act-lift act-lift--load/);
      assert.match(strength, /act-lift__set act-lift__set--top/);
      const pilates = await fs.readFile(path.join(tmp, 'life', 'activity', 'glutes-core-pilates-2026-10-19', 'index.html'), 'utf8');
      assert.match(pilates, /act-kind--mind/);
      assert.match(pilates, /the <span>practice<\/span>/);
      assert.doesNotMatch(pilates, /volume moved|personal records|act-lift/);
      const cls = await fs.readFile(path.join(tmp, 'life', 'activity', 'half-hyrox-pt-2026-10-21', 'index.html'), 'utf8');
      assert.match(cls, /class="chart__svg act-ribbon__svg"/);
      assert.match(cls, /class="act-tile/);
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
    assert.deepEqual(calorieFigure(solo), { kcal: 1346, source: 'platform' });
    const hevy = { activityData: { sessions: [{}] }, enrichments: { calories: { kcal: 310, comparisonText: '≈ 1.1 slice of pizza \u{1F355}' } } };
    assert.deepEqual(calorieFigure(hevy), { kcal: 310, source: 'estimate' }, 'FitGlue\'s text (with its emoji) never comes through');
    assert.deepEqual(calorieFigure({}, { caloriesKcal: 200 }), { kcal: 200, source: 'estimate' });
    assert.deepEqual(calorieFigure({}), { kcal: 0, source: '' });
    assert.equal(foodComparison(1346), '≈ 4.7 slice of pizza');
    assert.equal(foodComparison(40), '');
  });
  test('Hyrox races are labelled Hyrox, not CROSSFIT', () => {
    assert.equal(hybridRaceLabel("Hyrox Birmingham - Open Men's Solo"), 'HYROX');
    assert.equal(hybridRaceLabel('Morning WOD'), '');
    assert.equal(hybridRaceLabel('Race', { hasRace: true }), 'HYROX', 'a race breakdown is a Hyrox race');
  });
  test('a run filed as a workout (one running set in Hevy) is stamped and inked as a run', () => {
    const sets = [{ exerciseName: 'Running', reps: 0, weightKg: 0, durationSeconds: 18751, distanceMeters: 42726 }];
    const v = buildActivityView({ slug: 'm', activity: { title: 'Leeds Marathon', activityType: 'ACTIVITY_TYPE_WEIGHT_TRAINING', startTime: '2026-05-10T08:00:00Z', activityData: { sessions: [{ strengthSets: sets }] } }, entry: {} }, {});
    assert.equal(v.act.kind, 'run');
    assert.equal(v.act.typeLabel, 'RUN');
    assert.equal(v.act.typeClass, 'fit-type--run');
    assert.equal(v.act.headline[0].value, '42.7');
  });
  test('an activity page takes its type ink', () => {
    const v = buildActivityView({ slug: 'r', activity: { title: 'Run', activityType: 'ACTIVITY_TYPE_RUN', startTime: '2026-01-01T09:00:00Z' }, entry: {} }, {});
    assert.equal(v.act.typeClass, 'fit-type--run');
  });
});

describe('Strava and Hevy links (C4)', () => {
  test('links from export', async () => {
    const index = await fixtureIndex();
    const v = buildActivityView(await fixture('push-day-2026-10-13'), index, {});
    assert.deepEqual(v.act.links, [
      { key: 'strava', label: 'Strava', url: 'https://www.strava.com/activities/100000000002' },
      { key: 'hevy', label: 'Hevy', url: 'https://hevy.com/workout/0f3c9e2a-0000-4000-8000-000000000001' },
    ]);
    const ride = buildActivityView(await fixture('evening-ride-to-the-reservoir-2026-10-15'), index, {});
    assert.deepEqual(ride.act.links, []);
  });
  test('links validated', async () => {
    const index = await fixtureIndex();
    const base = await fixture('push-day-2026-10-13');
    const links = (l) => buildActivityView({ ...base, links: l }, index, {}).act.links;
    assert.deepEqual(links({ strava: 'javascript:alert(1)' }), []);
    assert.deepEqual(links({ strava: 'https://www.strava.com/athletes/1' }), []);
    assert.deepEqual(links({ hevy: 'https://hevy.com/workout/abc"><script>' }), []);
    assert.deepEqual(links(undefined), []);
    assert.deepEqual(links('x'), []);
  });
});
