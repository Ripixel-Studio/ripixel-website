// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  parsePeriodKey,
  keyToPath,
  keyToUrl,
  periodLabels,
  resolveNeighbours,
  calendarDays,
  buildEffortStrip,
  buildRecordGroups,
  buildDeltas,
  buildRoundupView,
  buildIndexView,
  fitnessRoundupViewsTask,
  fmtKm,
  fmtDuration,
  fmtWeight,
} from './fitness-roundup-views.mjs';
import { lifePageTasks } from './life-pages.mjs';
import { runSkierTasks } from './skier-test-runner.mjs';

const FIXTURES = path.resolve('fixtures/fitness');

/** A weekly roundup file shaped like the contract, with overrides. */
function weekFile(key, start, end, extra = {}) {
  return {
    schemaVersion: 1,
    key,
    exportedAt: end,
    previousKey: extra.previousKey ?? null,
    roundup: {
      periodType: 'ROUNDUP_PERIOD_TYPE_WEEK',
      periodKey: key,
      periodStart: start,
      periodEnd: end,
      totalActivities: 3,
      totalDurationSeconds: 3600,
      totalDistanceMeters: 10000,
      totalCaloriesKcal: 500,
      activityTypeBreakdowns: [],
      prsAchieved: [],
      dayEntries: [],
      ...(extra.roundup || {}),
    },
  };
}

// ---------------------------------------------------------------------------
// key → path / url

test('parsePeriodKey accepts the three contract shapes and rejects the rest', () => {
  assert.deepEqual(parsePeriodKey('week-42-2026'), { type: 'week', week: 42, year: 2026 });
  assert.deepEqual(parsePeriodKey('month-10-2026'), { type: 'month', month: 10, year: 2026 });
  assert.deepEqual(parsePeriodKey('year-2026'), { type: 'year', year: 2026 });
  assert.equal(parsePeriodKey('month-2026-10'), null, 'the earlier draft shape is not a key');
  assert.equal(parsePeriodKey('month-13-2026'), null);
  assert.equal(parsePeriodKey('week-4-2026'), null, 'weeks are zero-padded');
  assert.equal(parsePeriodKey('../etc/passwd'), null);
  assert.equal(parsePeriodKey(undefined), null);
});

test('keyToPath and keyToUrl map a key onto /life/roundup/<key>', () => {
  assert.equal(keyToPath('week-42-2026'), 'life/roundup/week-42-2026.html');
  assert.equal(keyToPath('year-2026'), 'life/roundup/year-2026.html');
  assert.equal(keyToUrl('month-10-2026'), '/life/roundup/month-10-2026');
  assert.throws(() => keyToPath('nope'), /not a period key/);
});

// ---------------------------------------------------------------------------
// period labels

test('periodLabels: week', () => {
  const l = periodLabels('week-42-2026', { periodStart: '2026-10-12T00:00:00Z', periodEnd: '2026-10-19T00:00:00Z' });
  assert.equal(l.type, 'week');
  assert.equal(l.title, 'WEEK 42');
  assert.equal(l.short, 'Week 42 · 2026');
  assert.equal(l.kicker, 'WEEKLY ROUNDUP');
  assert.equal(l.word, 'Week');
  assert.equal(l.dateRange, '12 OCT — 18 OCT 2026', 'periodEnd is exclusive');
  assert.equal(l.year, 2026);
});

test('periodLabels: month and year', () => {
  const m = periodLabels('month-10-2026', { periodType: 'ROUNDUP_PERIOD_TYPE_MONTH', periodStart: '2026-10-01T00:00:00Z', periodEnd: '2026-11-01T00:00:00Z' });
  assert.equal(m.title, 'OCTOBER');
  assert.equal(m.short, 'October 2026');
  assert.equal(m.kicker, 'MONTHLY ROUNDUP');
  assert.equal(m.dateRange, '1 OCT — 31 OCT 2026');

  const y = periodLabels('year-2026', { periodType: 'ROUNDUP_PERIOD_TYPE_YEAR', periodStart: '2026-01-01T00:00:00Z', periodEnd: '2027-01-01T00:00:00Z' });
  assert.equal(y.title, '2026');
  assert.equal(y.short, '2026');
  assert.equal(y.kicker, 'YEAR IN REVIEW');
  assert.equal(y.dateRange, '1 JAN — 31 DEC 2026');
});

test('periodLabels falls back to the key prefix when periodType is missing', () => {
  assert.equal(periodLabels('month-02-2026').type, 'month');
  assert.equal(periodLabels('month-02-2026').dateRange, '');
});

// ---------------------------------------------------------------------------
// previous / next

test('resolveNeighbours: exact previousKey drives prev and comparison; next is the roundup that names us', () => {
  const files = [
    weekFile('week-42-2026', '2026-10-12T00:00:00Z', '2026-10-19T00:00:00Z', { previousKey: 'week-41-2026' }),
    weekFile('week-41-2026', '2026-10-05T00:00:00Z', '2026-10-12T00:00:00Z', { previousKey: 'week-40-2026' }),
    weekFile('week-40-2026', '2026-09-28T00:00:00Z', '2026-10-05T00:00:00Z', { previousKey: 'week-39-2026' }),
  ];
  const n = resolveNeighbours(files);
  assert.deepEqual(n.get('week-42-2026'), { prev: 'week-41-2026', next: null, comparison: 'week-41-2026' });
  assert.deepEqual(n.get('week-41-2026'), { prev: 'week-40-2026', next: 'week-42-2026', comparison: 'week-40-2026' });
  assert.deepEqual(n.get('week-40-2026'), { prev: null, next: 'week-41-2026', comparison: null }, 'week 39 was never generated');
});

test('resolveNeighbours: a gap skips to the nearest older roundup for navigation but not for comparison', () => {
  const files = [
    weekFile('week-42-2026', '2026-10-12T00:00:00Z', '2026-10-19T00:00:00Z', { previousKey: 'week-41-2026' }),
    weekFile('week-40-2026', '2026-09-28T00:00:00Z', '2026-10-05T00:00:00Z', { previousKey: 'week-39-2026' }),
  ];
  const n = resolveNeighbours(files);
  assert.deepEqual(n.get('week-42-2026'), { prev: 'week-40-2026', next: null, comparison: null });
  assert.deepEqual(n.get('week-40-2026'), { prev: null, next: 'week-42-2026', comparison: null });
});

test('resolveNeighbours keeps period types apart and ignores unusable keys', () => {
  const files = [
    weekFile('week-42-2026', '2026-10-12T00:00:00Z', '2026-10-19T00:00:00Z'),
    { key: 'month-10-2026', previousKey: 'month-09-2026', roundup: { periodType: 'ROUNDUP_PERIOD_TYPE_MONTH', periodStart: '2026-10-01T00:00:00Z', periodEnd: '2026-11-01T00:00:00Z' } },
    { key: 'month-09-2026', previousKey: 'month-08-2026', roundup: { periodType: 'ROUNDUP_PERIOD_TYPE_MONTH', periodStart: '2026-09-01T00:00:00Z', periodEnd: '2026-10-01T00:00:00Z' } },
    { key: 'bogus', roundup: {} },
  ];
  const n = resolveNeighbours(files);
  assert.deepEqual(n.get('week-42-2026'), { prev: null, next: null, comparison: null });
  assert.equal(n.get('month-10-2026').prev, 'month-09-2026');
  assert.equal(n.get('month-09-2026').next, 'month-10-2026');
  assert.equal(n.has('bogus'), false);
});

// ---------------------------------------------------------------------------
// effort strip

test('calendarDays fills every day of [start, end) with level 0 where absent', () => {
  const days = calendarDays('2026-10-12T00:00:00Z', '2026-10-19T00:00:00Z', [
    { date: '2026-10-13', effortLevel: 1, activityCount: 1 },
    { date: '2026-10-17', effortLevel: 4, activityCount: 1 },
    { date: '2026-10-25', effortLevel: 9, activityCount: 1 }, // outside the period: ignored
  ]);
  assert.equal(days.length, 7);
  assert.deepEqual(days.map((d) => d.level), [0, 1, 0, 0, 0, 4, 0]);
  assert.equal(days[0].iso, '2026-10-12');
});

test('buildEffortStrip: a week is seven labelled bars, a month a Mon-first grid, a year has month labels', () => {
  const week = buildEffortStrip('week', calendarDays('2026-10-12T00:00:00Z', '2026-10-19T00:00:00Z', [{ date: '2026-10-17', effortLevel: 4, activityCount: 1 }]));
  assert.equal(week.kind, 'bars');
  assert.equal(week.cells.length, 7);
  assert.deepEqual(week.cells.map((c) => c.label), ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']);
  assert.equal(week.cells[5].level, 4);
  assert.ok(week.cells[5].h > week.cells[0].h, 'a harder day is a taller bar');
  assert.match(week.cells[5].title, /17 OCT 2026: very hard · 1 session/);

  const month = buildEffortStrip('month', calendarDays('2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z', []));
  assert.equal(month.kind, 'grid');
  assert.equal(month.cells.length, 31);
  assert.equal(month.cells[0].y, month.cells[0].y, 'Thu 1 Oct sits in row 3');
  assert.equal(month.cells[0].y > month.cells[4].y, true, '1 Oct (Thu) is lower than 5 Oct (Mon)');
  assert.equal(month.cells[4].x > month.cells[0].x, true, '5 Oct starts the next column');

  const year = buildEffortStrip('year', calendarDays('2026-01-01T00:00:00Z', '2027-01-01T00:00:00Z', []));
  assert.equal(year.cells.length, 365);
  assert.ok(year.labels.length >= 11, 'month labels along the top');
  assert.equal(buildEffortStrip('week', []), null);
});

// ---------------------------------------------------------------------------
// records, deltas, formatting

test('buildRecordGroups groups strength PRs per exercise and formats cardio as clock time', () => {
  const groups = buildRecordGroups([
    { recordType: 'Bench Press (Barbell)_1rm', value: 100, unit: 'kg', achievedAt: '2026-10-13T18:41:00Z', previousValue: 97.5 },
    { recordType: 'Bench Press (Barbell)_set_volume', value: 640, unit: 'kg', achievedAt: '2026-10-13T18:14:00Z', previousValue: 600 },
    { recordType: '5k', value: 1192, unit: 'seconds', achievedAt: '2026-10-17T08:19:52Z', previousValue: 1206 },
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].label, 'Bench Press (Barbell)');
  assert.equal(groups[0].count, 2);
  assert.deepEqual(groups[0].metrics.map((m) => m.metric), ['1RM', 'SET VOLUME']);
  assert.equal(groups[0].metrics[0].delta, '+2.5 kg');
  assert.equal(groups[0].date, '13 OCT');
  assert.equal(groups[1].label, '5K');
  assert.equal(groups[1].metrics[0].value, '19:52');
  assert.equal(groups[1].metrics[0].delta, '−14s');
});

test('buildDeltas follows the contract gates', () => {
  const cur = { totalActivities: 4, totalDurationSeconds: 7200, totalDistanceMeters: 20000, totalCaloriesKcal: 0, prsAchieved: [{}] };
  const prev = { totalActivities: 2, totalDurationSeconds: 7200, totalDistanceMeters: 100, totalCaloriesKcal: 500, prsAchieved: [] };
  const d = buildDeltas(cur, prev);
  assert.deepEqual(d, [
    { label: 'Sessions', value: '+100%', dir: 'up' },
    { label: 'Time', value: '±0%', dir: 'flat' },
    { label: 'Records', value: '+1', dir: 'up' },
  ]);
});

test('formatting helpers', () => {
  assert.equal(fmtKm(37410), '37.4');
  assert.equal(fmtKm(123456), '123');
  assert.equal(fmtDuration(8992), '2h 30m');
  assert.equal(fmtDuration(1500), '25m');
  assert.deepEqual(fmtWeight(6286), { value: '6.3', unit: 't' });
  assert.deepEqual(fmtWeight(640), { value: '640', unit: 'kg' });
});

// ---------------------------------------------------------------------------
// view model from the fixture

async function fixtureCtx() {
  const index = JSON.parse(await fs.readFile(path.join(FIXTURES, 'index.json'), 'utf8'));
  const file = JSON.parse(await fs.readFile(path.join(FIXTURES, 'roundup', 'week-42-2026.json'), 'utf8'));
  return { index, file };
}

test('buildRoundupView renders the fixture week per contract §6/§8', async () => {
  const { index, file } = await fixtureCtx();
  const ctx = {
    byKey: new Map([[file.key, file]]),
    neighbours: resolveNeighbours([file]),
    activitySlugs: new Set(index.activities.map((a) => a.slug)),
    showPhotoGallery: true,
  };
  const v = buildRoundupView(file, ctx);
  assert.equal(v.url, '/life/roundup/week-42-2026');
  assert.equal(v.title, 'WEEK 42');
  assert.deepEqual(v.totals.map((t) => t.label), ['sessions logged', 'total time', 'distance covered', 'calories burned']);
  assert.deepEqual(v.totals[2], { value: '37.4', unit: 'km', label: 'distance covered' });
  assert.deepEqual(v.totals[3], { value: '1.6', unit: 'k', label: 'calories burned' });
  assert.equal(v.comparison, null, 'week-41 is not in the set');
  assert.equal(v.prevNav, null);
  assert.equal(v.callouts.length, 2);
  assert.equal(v.callouts[0].glyph, '🚴');
  assert.equal(v.callouts[0].href, '/life/activity/evening-ride-to-the-reservoir-2026-10-15');
  assert.equal(v.callouts[1].glyph, '🏆');
  assert.deepEqual(v.breakdown.map((b) => b.label), ['Run', 'Ride', 'Weight Training']);
  assert.equal(v.breakdown[2].stats, '57m · 18 sets · 6.3t moved');
  assert.equal(v.effortStrip.cells.length, 7);
  assert.equal(v.activeDays, 3);
  assert.equal(v.zones.length, 5);
  assert.equal(v.hrTracked, 138);
  assert.equal(v.zones[0].minutes, 38, 'index 0 (below Z1) is skipped');
  assert.equal(v.photos.length, 1);
  assert.equal(v.routes.length, 2);
  assert.equal(v.routes[1].km, '32.4 km');
  assert.equal(v.placesNote, '2 places · 1 country');
  assert.deepEqual(v.weather.cells.map((c) => c.label), ['coldest', 'hottest', 'sessions tracked'], 'no rain → no wet cell');
  assert.deepEqual(v.muscles.map((m) => m.name), ['Chest', 'Shoulders', 'Triceps']);
  assert.equal(v.bestEfforts[2].time, '19:50');
  assert.deepEqual(v.highlights.map((h) => h.label), ['longest session', 'highest burn rate', 'peak avg HR', 'total vertical', 'furthest session', 'biggest burn', 'heaviest session']);
  assert.equal(v.highlights[3].href, null, 'elevation is an aggregate, never linked');
  assert.equal(v.records.length, 2);
  assert.equal(v.prCount, 3);
  assert.equal(v.sources, 'Strava · Hevy');
  assert.match(v.aiSummary, /^Three sessions/);
  assert.ok(v.description.length <= 160);
});

test('buildRoundupView: photos are gated by showPhotoGallery and links by the index', async () => {
  const { file } = await fixtureCtx();
  const ctx = { byKey: new Map([[file.key, file]]), neighbours: resolveNeighbours([file]), activitySlugs: new Set(), showPhotoGallery: false };
  const v = buildRoundupView(file, ctx);
  assert.equal(v.photos.length, 0);
  assert.ok(v.callouts.every((c) => c.href === null));
  assert.ok(v.routes.every((r) => r.href === null));
  assert.ok(v.highlights.every((h) => h.href === null));
});

test('buildRoundupView: empty roundup renders placeholders rather than throwing', () => {
  const file = { key: 'month-01-2026', roundup: {} };
  const v = buildRoundupView(file, { byKey: new Map(), neighbours: new Map(), activitySlugs: new Set(), showPhotoGallery: true });
  assert.equal(v.title, 'JANUARY');
  assert.deepEqual(v.totals.map((t) => t.value), ['0', '0m', '—', '—']);
  assert.equal(v.effortStrip, null);
  assert.equal(v.zones, null);
  assert.equal(v.aiSummary, '');
  assert.equal(v.hasNav, false);
});

test('buildIndexView groups newest-first by period type with the secondary stat rule', () => {
  const files = [
    weekFile('week-41-2026', '2026-10-05T00:00:00Z', '2026-10-12T00:00:00Z', { roundup: { totalDistanceMeters: 0, activityTypeBreakdowns: [{ totalSets: 10, totalWeightKg: 1500 }] } }),
    weekFile('week-42-2026', '2026-10-12T00:00:00Z', '2026-10-19T00:00:00Z', { roundup: { prsAchieved: [{}, {}] } }),
    { key: 'year-2026', roundup: { periodType: 'ROUNDUP_PERIOD_TYPE_YEAR', periodStart: '2026-01-01T00:00:00Z', periodEnd: '2027-01-01T00:00:00Z', totalActivities: 1, totalDurationSeconds: 5400, totalDistanceMeters: 0, aiSummary: 'x' } },
  ];
  const groups = buildIndexView(files);
  assert.deepEqual(groups.map((g) => g.heading), ['WEEKS', 'YEARS']);
  assert.deepEqual(groups[0].tiles.map((t) => t.key), ['week-42-2026', 'week-41-2026']);
  assert.equal(groups[0].tiles[0].secondary, '10.0 km');
  assert.equal(groups[0].tiles[0].prs, '+2 PRS');
  assert.equal(groups[0].tiles[1].secondary, '1.5t moved');
  assert.equal(groups[1].tiles[0].secondary, '1h 30m');
  assert.equal(groups[1].tiles[0].sessionsLabel, 'session');
  assert.equal(groups[1].tiles[0].hasAiSummary, true);
});

// ---------------------------------------------------------------------------
// the task end to end, against the fixtures and the real templates

/** The roundup view task followed by the Skier tasks that render /life/roundup/<key> and /life/roundups. */
async function renderRoundups(outDir, globals) {
  const [, roundupPages, roundupsIndex] = lifePageTasks({ outDir, siteUrl: 'https://james.ripixel.co.uk' });
  const logs = [];
  await runSkierTasks([fitnessRoundupViewsTask(), roundupPages, roundupsIndex], globals, logs);
  assert.ok(!logs.some((l) => l.startsWith('ERROR')), logs.join('\n'));
  return globals;
}

test('fitnessRoundupViewsTask builds page and index view models', async () => {
  const { index, file } = await fixtureCtx();
  const logs = [];
  const task = fitnessRoundupViewsTask();
  const result = await task.run(task.config, {
    logger: { info: (m) => logs.push(m), warn: (m) => logs.push(m), error: (m) => logs.push(`ERROR ${m}`), debug() {} },
    debug: false,
    globals: {
      siteUrl: 'https://james.ripixel.co.uk', fitnessIndex: index, fitnessRoundups: [file, { key: '../nope' }], fitnessUnavailable: false,
      fitnessOgImages: { activity: {}, roundup: { 'week-42-2026': 'https://james.ripixel.co.uk/life/og/roundup/week-42-2026.png' } },
    },
  });
  assert.equal(result.fitnessRoundupPages.length, 1);
  const page = result.fitnessRoundupPages[0];
  assert.equal(page.roundup.url, '/life/roundup/week-42-2026');
  assert.equal(page.canonical, 'https://james.ripixel.co.uk/life/roundup/week-42-2026');
  assert.equal(page.ogImage, 'https://james.ripixel.co.uk/life/og/roundup/week-42-2026.png');
  assert.equal(page.subpage, '| week 42 2026 roundup');
  assert.equal(result.fitnessRoundupsIndex.roundupCountLabel, '1 issue');
  assert.equal(result.fitnessRoundupsIndex.roundupGroups[0].tiles[0].href, '/life/roundup/week-42-2026');
  assert.ok(logs.some((l) => /unusable key/.test(l)));
  assert.ok(!logs.some((l) => l.startsWith('ERROR')), logs.join('\n'));
});

test('Skier renders one page per roundup plus the index from the views', async () => {
  const { index, file } = await fixtureCtx();
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'roundup-pages-'));
  try {
    await renderRoundups(outDir, {
      cacheHash: 'test', year: 2026, siteUrl: 'https://james.ripixel.co.uk', fitnessIndex: index, fitnessRoundups: [file], fitnessUnavailable: false, fitnessSource: 'fixtures',
      fitnessOgImages: { activity: {}, roundup: { 'week-42-2026': 'https://james.ripixel.co.uk/life/og/roundup/week-42-2026.png' } },
    });

    const page = await fs.readFile(path.join(outDir, 'life', 'roundup', 'week-42-2026.html'), 'utf8');
    assert.match(page, /<title>James King \| life \| week 42 2026 roundup<\/title>/);
    assert.match(page, /class="roundup-effort roundup-effort--bars"/);
    assert.match(page, /href="\/life\/activity\/push-day-2026-10-13"/);
    assert.match(page, /Three sessions, three different shapes/);
    // Nothing on the page links to fitglue.tech (the nav points at /life since S2.5); the assets host is the one exception.
    assert.doesNotMatch(page, /https?:\/\/(?!assets\.)[a-z.]*fitglue\.tech/i, 'page never references fitglue.tech except the assets host');
    // S2.5 head overrides: OG card, canonical, article type, feed link.
    assert.match(page, /<meta property="og:image" content="https:\/\/james\.ripixel\.co\.uk\/life\/og\/roundup\/week-42-2026\.png"/);
    assert.match(page, /<link rel="canonical" href="https:\/\/james\.ripixel\.co\.uk\/life\/roundup\/week-42-2026"/);
    assert.match(page, /<meta property="og:type" content="article"/);
    assert.match(page, /<meta property="article:published_time" content="2026-10-19T00:05:12Z"/);
    assert.match(page, /<link rel="alternate" type="application\/atom\+xml" href="\/life\/feed\.xml"/);
    assert.doesNotMatch(page, /<p>Three/, 'summary is text, not markup');
    assert.match(page, /styles\.min\.test\.css/);

    const idx = await fs.readFile(path.join(outDir, 'life', 'roundups.html'), 'utf8');
    assert.match(idx, /href="\/life\/roundup\/week-42-2026"/);
    assert.match(idx, /<meta property="og:image" content="https:\/\/james\.ripixel\.co\.uk\/card_life\.png"/, 'index keeps the section card');
    assert.match(idx, /application\/atom\+xml" href="\/life\/feed\.xml"/);
    assert.match(idx, /1 issue</);
  } finally {
    await fs.rm(outDir, { recursive: true, force: true });
  }
});

test('with no data Skier writes just the index and the unavailable notice', async () => {
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'roundup-pages-'));
  try {
    const globals = await renderRoundups(outDir, { cacheHash: 'x', year: 2026, fitnessIndex: { activities: [], roundups: [], profile: null }, fitnessRoundups: [], fitnessUnavailable: true });
    assert.deepEqual(globals.fitnessRoundupPages, []);
    const idx = await fs.readFile(path.join(outDir, 'life', 'roundups.html'), 'utf8');
    assert.match(idx, /fitness data unavailable/);
    await assert.rejects(fs.access(path.join(outDir, 'life', 'roundup')));
  } finally {
    await fs.rm(outDir, { recursive: true, force: true });
  }
});
