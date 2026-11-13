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
  buildTimeline,
  fitnessRoundupViewsTask,
  fmtKm,
  fmtDuration,
  fmtWeight,
  buildRoundupLife,
  lifeHeading,
  totalsLine,
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

test('buildEffortStrip: the year is a weekday grid with month labels', () => {
  const year = buildEffortStrip(calendarDays('2026-01-01T00:00:00Z', '2027-01-01T00:00:00Z', [{ date: '2026-10-18', effortLevel: 4, activityCount: 1 }]));
  assert.equal(year.kind, 'grid');
  assert.equal(year.cells.length, 365);
  assert.ok(year.labels.length >= 11, 'month labels along the top');
  assert.match(year.cells.find((c) => c.level === 4).title, /18 OCT 2026: very hard · 1 session/);
  assert.equal(buildEffortStrip([]), null);
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
  assert.deepEqual(v.breakdown.map((b) => b.label), ['Run', 'Ride', 'Strength']);
  assert.equal(v.breakdown[2].stats, '57m · 18 sets · 6.3t moved');
  assert.equal(v.effortStrip, null, 'a week draws its own seven days (the story)');
  assert.equal(v.story, null, 'no story context, no story');
  assert.equal(v.activeDays, 3);
  assert.equal(v.placesNote, '2 places · 1 country');
  assert.deepEqual(v.weather.cells.map((c) => c.label), ['coldest', 'hottest', 'sessions tracked'], 'no rain → no wet cell');
  assert.equal(v.bestEfforts[2].time, '19:50');
  assert.deepEqual(v.highlights.map((h) => h.label), ['longest session', 'highest burn rate', 'peak avg HR', 'total vertical', 'furthest session', 'biggest burn', 'heaviest session']);
  assert.equal(v.highlights[3].href, null, 'elevation is an aggregate, never linked');
  assert.equal(v.records.length, 2);
  assert.equal(v.prCount, 3);
  assert.equal(v.sources, 'Strava · Hevy');
  assert.match(v.aiSummary, /^Three sessions/);
  assert.ok(v.description.length <= 160);
});

test('buildRoundupView: peaks link only sessions the index has', async () => {
  const { file } = await fixtureCtx();
  const ctx = { byKey: new Map([[file.key, file]]), neighbours: resolveNeighbours([file]), activitySlugs: new Set(), showPhotoGallery: false };
  const v = buildRoundupView(file, ctx);
  assert.ok(v.highlights.every((h) => h.href === null));
});

test('buildRoundupView: empty roundup renders placeholders rather than throwing', () => {
  const file = { key: 'month-01-2026', roundup: {} };
  const v = buildRoundupView(file, { byKey: new Map(), neighbours: new Map(), activitySlugs: new Set(), showPhotoGallery: true });
  assert.equal(v.title, 'JANUARY');
  assert.deepEqual(v.totals.map((t) => t.value), ['0', '0m', '—', '—']);
  assert.equal(v.effortStrip, null);
  assert.equal(v.aiSummary, '');
  assert.equal(v.hasNav, false);
});

test('buildTimeline: one stream, newest first; a year leads its year, a month leads its weeks', () => {
  const view = (key, start, end, extra = {}) => ({
    key, url: `/life/roundup/${key}`, ...periodLabels(key, { periodStart: start, periodEnd: end }), totals: [{ value: '3' }, { value: '1h' }, { value: '10.0', unit: 'km', label: 'distance covered' }],
    prCount: 0, sessionCount: 3, story: { lead: null, highlights: [], cover: null, coverLines: [], collage: [], days: [], months: [] }, periodStart: start, ...extra,
  });
  const views = [
    view('week-41-2026', '2026-10-05T00:00:00Z', '2026-10-12T00:00:00Z'),
    view('week-44-2026', '2026-10-26T00:00:00Z', '2026-11-02T00:00:00Z', { story: { lead: { stamp: 'RACE WEEKEND', title: 'Hyrox Birmingham', typeClass: 'fit-type--hybrid' }, highlights: [], cover: { url: 'https://x.test/a.jpg' }, coverLines: [], collage: [], days: [{ sessions: [{ typeClass: 'fit-type--hybrid' }] }], months: [] } }),
    view('month-10-2026', '2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z'),
    view('week-45-2026', '2026-11-02T00:00:00Z', '2026-11-09T00:00:00Z'),
    view('year-2025', '2025-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
    view('month-12-2025', '2025-12-01T00:00:00Z', '2026-01-01T00:00:00Z'),
    view('week-01-2026', '2025-12-29T00:00:00Z', '2026-01-05T00:00:00Z'),
  ];
  const t = buildTimeline(views);
  assert.deepEqual(t.map((x) => x.key || x.mark), [
    '2026', 'November 2026', 'week-45-2026', 'month-10-2026', 'week-44-2026', 'week-41-2026', 'January 2026', 'week-01-2026',
    'year-2025', 'month-12-2025',
  ]);
  assert.equal(t[0].isYearMark, true, 'no year roundup yet: a plain year card, not a link');
  assert.equal(t[1].isMonthMark, true);
  assert.equal(t[3].isMonth, true);
  assert.equal(t[4].isWeek, true);
  assert.equal(t[4].top.title, 'Hyrox Birmingham');
  assert.equal(t[4].cover, 'https://x.test/a.jpg');
  assert.equal(t[7].key, 'week-01-2026', 'week 1 of 2026 has its Thursday in January');
  assert.equal(t[8].isYear, true);
  assert.equal(t[8].href, '/life/roundup/year-2025');
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
  assert.equal(result.fitnessRoundupsIndex.timeline.find((x) => x.isWeek).href, '/life/roundup/week-42-2026');
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
    assert.match(page, /class="rl-days"/, "a week is its seven days");
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

// ---------------------------------------------------------------------------
// LH4.3: watching, listening, reading and outings

const BASELINE = path.resolve('fixtures/fitness/baseline/week-42-2026.html');

async function renderWeek42(lifePeriods) {
  const { index, file } = await fixtureCtx();
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'roundup-life-'));
  try {
    await renderRoundups(outDir, {
      cacheHash: 'test', year: 2026, siteUrl: 'https://james.ripixel.co.uk', fitnessIndex: index, fitnessRoundups: [file], fitnessUnavailable: false, fitnessSource: 'fixtures',
      fitnessOgImages: { activity: {}, roundup: {} }, ...(lifePeriods ? { lifePeriods } : {}),
    });
    return await fs.readFile(path.join(outDir, 'life', 'roundup', 'week-42-2026.html'), 'utf8');
  } finally {
    await fs.rm(outDir, { recursive: true, force: true });
  }
}

async function lifeFixture(key) {
  return JSON.parse(await fs.readFile(path.join(FIXTURES, 'life', 'period', `${key}.json`), 'utf8'));
}

test('BASELINE_WRITE regenerates the committed no-sidecar baseline', { skip: !process.env.BASELINE_WRITE }, async () => {
  await fs.writeFile(BASELINE, await renderWeek42(null));
});

async function viewWithLife(lifePeriods) {
  const { index, file } = await fixtureCtx();
  return buildRoundupView(file, {
    byKey: new Map([[file.key, file]]), neighbours: resolveNeighbours([file]),
    activitySlugs: new Set(index.activities.map((a) => a.slug)), showPhotoGallery: true, lifePeriods,
  });
}

test('week roundup gains life blocks', async () => {
  const v = await viewWithLife({ 'week-42-2026': await lifeFixture('week-42-2026') });
  assert.equal(v.life.blocks[0].name, 'watching');
  assert.equal(v.life.blocks[0].heading, "This week's watching");
  assert.equal(v.life.blocks[0].items[0].title, 'The Invented Harbour');
  assert.equal(v.life.blocks[0].totalsLine, '1 film · 3 episodes · 2 videos · 5 h');
  assert.equal(v.life.blocks[1].heading, "This week's listening");
  assert.deepEqual(v.life.blocks.map((b) => b.name), ['watching', 'listening'], 'empty reading/outings blocks are dropped');
  assert.equal(v.life.count, 2);
});

test('film wording says watched, never finished', async () => {
  const doc = await lifeFixture('week-42-2026');
  doc.watching.notable[0].reason = 'film';
  const life = buildRoundupLife(doc, periodLabels('week-42-2026'));
  const item = life.blocks[0].items[0];
  assert.match(`${item.kindLabel} ${item.meta}`, /watched/i);
  assert.doesNotMatch(JSON.stringify(life), /finished/i);
});

test('month headings', async () => {
  const labels = periodLabels('month-10-2026');
  assert.equal(lifeHeading('watching', 'month', labels), 'October in films and TV');
  assert.equal(lifeHeading('listening', 'month', labels), 'October in music and podcasts');
  assert.equal(lifeHeading('reading', 'month', labels), 'October in books');
  assert.equal(lifeHeading('outings', 'month', labels), 'October, out');
  const doc = await lifeFixture('month-09-2026');
  const life = buildRoundupLife({ ...doc, key: 'month-10-2026' }, labels);
  assert.equal(life.blocks[0].heading, 'October in films and TV');
});

test('year headings', async () => {
  const labels = periodLabels('year-2026');
  assert.equal(lifeHeading('watching', 'year', labels), '2026 in films and TV');
  assert.equal(lifeHeading('listening', 'year', labels), '2026 in podcasts and music');
  assert.equal(lifeHeading('reading', 'year', labels), '2026 in books');
  assert.equal(lifeHeading('outings', 'year', labels), '2026, out');
  assert.equal(lifeHeading('outings', 'week', periodLabels('week-42-2026')), 'Out and about');
});

test('totalsLine omits zero parts', () => {
  assert.equal(totalsLine('watching', { films: 3, episodes: 14, videos: 0, hours: 22 }), '3 films · 14 episodes · 22 h');
  assert.equal(totalsLine('listening', { tracks: 80, podcastEpisodes: 1, audiobookHours: 0 }), '80 tracks · 1 podcast episode');
  assert.equal(totalsLine('reading', { books: 1, pages: 320 }), '1 book · 320 pages');
  assert.equal(totalsLine('watching', { films: 0, episodes: 0, videos: 0, hours: 0 }), '');
  assert.equal(totalsLine('outings', {}), '');
});

test('no sidecar, no change', async () => {
  const v = await viewWithLife({});
  assert.equal(v.life, null);
  assert.equal(buildRoundupLife(undefined, periodLabels('week-42-2026')), null);
  const empty = await lifeFixture('week-30-2026');
  empty.watching.totals = { films: 0, episodes: 0, videos: 0, hours: 0 };
  empty.listening.totals = { tracks: 0, podcastEpisodes: 0, audiobookHours: 0 };
  assert.equal(buildRoundupLife(empty, periodLabels('week-30-2026')), null, 'every block empty');
  const html = await renderWeek42(null);
  assert.equal(html, await fs.readFile(BASELINE, 'utf8'), 'page is byte-identical to the committed baseline');
  assert.equal(await renderWeek42({ 'week-99-2026': await lifeFixture('week-42-2026') }), html, 'a sidecar for another key changes nothing');
});

test('sidecar renders on the page', async () => {
  const html = await renderWeek42({ 'week-42-2026': await lifeFixture('week-42-2026') });
  assert.match(html, /This week&#x27;s watching|This week's watching/);
  assert.match(html, /The Invented Harbour/);
  assert.match(html, /The Placeholders/);
});

test('outings month only', async () => {
  const doc = await lifeFixture('month-09-2026');
  const life = buildRoundupLife(doc, periodLabels('month-09-2026'));
  const out = life.blocks.find((b) => b.name === 'outings');
  assert.equal(out.items[0].title, 'saw Sample Band Live');
  assert.equal(out.items[0].meta, 'September 2026');
  assert.doesNotMatch(JSON.stringify(out), /2026-09|\d{1,2}(st|nd|rd|th)/);
  assert.equal(out.totalsLine, '');
});

test('orphan sidecar mints no page', async () => {
  const { index, file } = await fixtureCtx();
  const task = fitnessRoundupViewsTask();
  const result = await task.run(task.config, {
    logger: { info() {}, warn() {}, error() {}, debug() {} }, debug: false,
    globals: {
      siteUrl: 'https://x.test', fitnessIndex: index, fitnessRoundups: [file], fitnessUnavailable: false,
      lifePeriods: { 'week-42-2026': await lifeFixture('week-42-2026'), 'week-30-2026': await lifeFixture('week-30-2026'), 'month-09-2026': await lifeFixture('month-09-2026') },
    },
  });
  assert.equal(result.fitnessRoundupPages.length, 1);
  assert.equal(result.fitnessRoundupPages[0].roundup.life.blocks[0].heading, "This week's watching");
});

test('reason and kind codes read as plain words; unknown ones render nothing', async () => {
  const doc = await lifeFixture('week-42-2026');
  const items = [
    { kind: 'season', title: 'S', season: 2, reason: 'season' },
    { kind: 'creator', title: 'C', reason: 'sustained' },
    { kind: 'film', title: 'F', year: 2024, reason: 'finished' },
    { kind: 'mystery', title: 'M', reason: 'gig' },
    { kind: 'cinema', title: 'X', reason: 'cinema', month: '2026-10' },
  ];
  doc.watching.notable = items;
  doc.outings = { notable: [items[4]] };
  const life = buildRoundupLife(doc, periodLabels('week-42-2026'));
  const w = life.blocks.find((b) => b.name === 'watching').items;
  assert.deepEqual(w.map((i) => [i.kindLabel, i.meta]), [['TV', 'season 2 · finished the season'], ['channel', 'kept coming back'], ['film', '2024'], ['', ''], ['cinema', '']]);
  assert.doesNotMatch(JSON.stringify(life), /"(sustained|outing)"|mystery/);
  const out = life.blocks.find((b) => b.name === 'outings').items[0];
  assert.deepEqual([out.title, out.kindLabel, out.meta], ['saw X', 'cinema', 'October 2026']);
});

test('a week sidecar without outings renders the other blocks', async () => {
  const doc = await lifeFixture('week-42-2026');
  assert.equal('outings' in doc, false);
  const life = buildRoundupLife(doc, periodLabels('week-42-2026'));
  assert.deepEqual(life.blocks.map((b) => b.name), ['watching', 'listening']);
});
