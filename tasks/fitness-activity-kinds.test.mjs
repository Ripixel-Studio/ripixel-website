// @ts-check
// Per-kind activity pages: which page an activity gets, and the pieces each kind draws.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  activityKind,
  shortLocation,
  isCurrentAiSummary,
  zoneOf,
  inferMaxHr,
  effortRibbon,
  zoneSplit,
  runSplits,
  elevationProfile,
  buildActivityHistory,
  bestEffortBadges,
  lifetimeProgress,
  liftCards,
  classStations,
  practiceStats,
  focusWords,
  steadyHeart,
  finePrint,
  prList,
  kindAnchors,
} from './fitness-activity-kinds.mjs';

/** A minimal export file. */
function file({ slug = 'x', type = 'RUN', title = 'Thing', start = '2026-10-01T08:00:00Z', sets = [], distance = 0, route = 0, race = null, series = {}, enrichments = {}, entry = {} } = {}) {
  return {
    slug,
    race,
    routePoints: Array.from({ length: route }, (_, i) => [53 + i / 1000, -1]),
    series,
    entry: { showcaseId: slug, startTime: start, distanceMeters: distance, ...entry },
    activity: {
      title, activityType: `ACTIVITY_TYPE_${type}`, startTime: start, enrichments,
      activityData: { sessions: [{ totalDistance: distance, strengthSets: sets }] },
    },
  };
}
const lift = (exerciseName, reps, weightKg, extra = {}) => ({ exerciseName, reps, weightKg, durationSeconds: 0, distanceMeters: 0, supersetId: '', ...extra });
const station = (exerciseName, distanceMeters, durationSeconds = 0, weightKg = 0, extra = {}) => ({ exerciseName, reps: 0, weightKg, durationSeconds, distanceMeters, supersetId: '', ...extra });

describe('activityKind', () => {
  test('a race is any activity carrying race data, whatever its type', () => {
    assert.equal(activityKind(file({ type: 'CROSSFIT', race: { division: { key: 'open-men-solo' } } })), 'race');
    assert.equal(activityKind(file({ type: 'CROSSFIT', title: 'Hyrox Simulation - Open Mens Doubles' })), 'class', 'no race data: a class');
  });
  test('runs, walks and rides by type; an indoor ride (spin) is a class', () => {
    assert.equal(activityKind(file({ type: 'RUN' })), 'run');
    assert.equal(activityKind(file({ type: 'TRAIL_RUN' })), 'run');
    assert.equal(activityKind(file({ type: 'VIRTUAL_RUN' })), 'run');
    assert.equal(activityKind(file({ type: 'WALK' })), 'walk');
    assert.equal(activityKind(file({ type: 'HIKE' })), 'walk');
    assert.equal(activityKind(file({ type: 'RIDE', distance: 18000, route: 50 })), 'ride');
    assert.equal(activityKind(file({ type: 'RIDE', title: 'Spinning Class', sets: [station('Spinning', 0, 2100)] })), 'class');
  });
  test('pilates and yoga are the calm kind', () => {
    assert.equal(activityKind(file({ type: 'PILATES', title: 'Tower Pilates', sets: [station('Pilates', 0, 3000)] })), 'mind');
    assert.equal(activityKind(file({ type: 'YOGA', title: 'Hotpod Yoga' })), 'mind');
    assert.equal(activityKind(file({ type: 'WORKOUT', title: 'Morning Mobility' })), 'mind');
  });
  test('classes: crossfit, HIIT and the like, plus Hyrox/hybrid PT sessions logged as weight training', () => {
    assert.equal(activityKind(file({ type: 'CROSSFIT', title: 'Bootcamp' })), 'class');
    assert.equal(activityKind(file({ type: 'HIGH_INTENSITY_INTERVAL_TRAINING', title: 'Lift Class', sets: [lift('Goblet Squat', 10, 16)] })), 'class');
    assert.equal(activityKind(file({ type: 'STAIR_STEPPER', title: 'Step Class' })), 'class');
    assert.equal(activityKind(file({ type: 'WEIGHT_TRAINING', title: 'Half Hyrox PT', sets: [station('Treadmill', 1000, 277), station('Sled Pull', 50, 0, 102)] })), 'class');
    assert.equal(activityKind(file({ type: 'WEIGHT_TRAINING', title: 'Push Focused Hyrox PT', sets: [lift('Bench Press (Barbell)', 8, 60)] })), 'class');
    assert.equal(activityKind(file({ type: 'WEIGHT_TRAINING', title: 'Long Intervals PT', sets: [lift('Wall Ball', 20, 6)] })), 'class');
  });
  test('weight training is strength unless it is mostly stations or has no sets at all', () => {
    const squats = [lift('Squat (Barbell)', 8, 50), lift('Squat (Barbell)', 8, 50), lift('Bulgarian Split Squat', 8, 24)];
    assert.equal(activityKind(file({ type: 'WEIGHT_TRAINING', title: 'Lower Body Strength PT', sets: [station('Spinning', 0, 300), ...squats, station('Sled Push', 30)] })), 'strength');
    assert.equal(activityKind(file({ type: 'WEIGHT_TRAINING', title: 'Strength & ERGs PT', sets: [station('Rowing Machine', 1000, 240), station('SkiErg', 1000, 250), station('Rowing Machine', 500, 110), lift('Deadlift (Trap Bar)', 6, 100)] })), 'class');
    assert.equal(activityKind(file({ type: 'WEIGHT_TRAINING', title: 'PT with Box Fit' })), 'class', 'no sets: an HR-led session');
    assert.equal(activityKind(file({ type: 'WORKOUT', title: '100 Press Ups (#18)', sets: [lift('Push Up', 100, 0)] })), 'strength');
    assert.equal(activityKind(file({ type: 'WORKOUT', title: 'Bedtime Core', sets: [station('Plank', 0, 60), lift('Dead Bug', 12, 0), lift('Sit Up', 15, 0)] })), 'strength');
  });
  test('a run logged in Hevy as one running set is a run; one cardio block is a class', () => {
    assert.equal(activityKind(file({ type: 'WEIGHT_TRAINING', title: 'Leeds Marathon', sets: [station('Running', 42726, 18751)] })), 'run');
    assert.equal(activityKind(file({ type: 'WORKOUT', title: 'HIIT', sets: [station('Other Cardio', 0, 1896)] })), 'class');
  });
  test('anything else is other', () => {
    assert.equal(activityKind(file({ type: 'TENNIS', title: 'Padel' })), 'other');
    assert.equal(activityKind({}), 'other');
  });
});

describe('shortLocation', () => {
  test('a reverse geocode becomes place and town', () => {
    assert.equal(shortLocation('Fernwood CP, Newark and Sherwood, Nottinghamshire, East Midlands, England, United Kingdom'), 'Fernwood CP, Newark');
    assert.equal(shortLocation('Code Fitness, William Hall Way, Fernwood CP, Balderton, Newark and Sherwood, Nottinghamshire, East Midlands, England, NG24 3NG, United Kingdom'), 'Code Fitness, Newark');
    assert.equal(shortLocation('Bingham, Rushcliffe, Nottinghamshire, East Midlands, England, United Kingdom'), 'Bingham, Rushcliffe');
    assert.equal(shortLocation('West Bridgford, Rushcliffe, Nottinghamshire, East Midlands, England, NG2 6BT, United Kingdom'), 'West Bridgford, Rushcliffe');
  });
  test('short names are left alone', () => {
    assert.equal(shortLocation('Romans Quarter'), 'Romans Quarter');
    assert.equal(shortLocation('Colwick Park, Nottingham'), 'Colwick Park, Nottingham');
    assert.equal(shortLocation('Newark and Sherwood'), 'Newark and Sherwood');
    assert.equal(shortLocation(''), '');
    assert.equal(shortLocation(undefined), '');
  });
});

describe('isCurrentAiSummary', () => {
  test('the export carries no model or date, so the activity date decides: Claude from 4 Nov 2026', () => {
    assert.equal(isCurrentAiSummary({ model: '', generatedAt: null }, '2026-11-03T11:02:17Z'), false);
    assert.equal(isCurrentAiSummary({ model: '', generatedAt: null }, '2026-11-04T11:01:26Z'), true);
  });
  test('a model or generation date wins when the export starts carrying one', () => {
    assert.equal(isCurrentAiSummary({ model: 'claude-haiku-4-5' }, '2026-01-01T00:00:00Z'), true);
    assert.equal(isCurrentAiSummary({ model: 'gemini-2.5-flash' }, '2026-12-01T00:00:00Z'), false);
    assert.equal(isCurrentAiSummary({ generatedAt: '2026-11-05T10:00:00Z' }, '2026-01-01T00:00:00Z'), true);
    assert.equal(isCurrentAiSummary({ generatedAt: '2026-10-05T10:00:00Z' }, '2026-12-01T00:00:00Z'), false);
  });
});

describe('heart-rate zones', () => {
  test('FitGlue zones are fractions of max HR: <50 % is zone 0, 90 %+ is zone 5', () => {
    assert.equal(zoneOf(90, 186), 0);
    assert.equal(zoneOf(100, 186), 1);
    assert.equal(zoneOf(150, 186), 4);
    assert.equal(zoneOf(170, 186), 5);
    assert.equal(zoneOf(0, 186), -1);
  });
  test('max HR is inferred from the exported zone minutes; 190 (FitGlue default) without data', () => {
    const hr = [100, 120, 140, 160, 175, 150, 130, 110];
    const elapsedS = hr.map((_, i) => i * 60);
    const minutes = [0, 0, 0, 0, 0, 0];
    for (let i = 1; i < hr.length; i++) minutes[zoneOf(hr[i], 186)] += 1;
    const files = [file({ series: { heartRate: hr, elapsedS }, entry: { hrZoneMinutes: minutes } })];
    const got = inferMaxHr(files);
    assert.ok(got >= 183 && got <= 188, String(got));
    assert.equal(inferMaxHr([]), 190);
  });
  test('the effort ribbon colours the session by zone, merging runs of the same zone', () => {
    const r = effortRibbon({ heartRate: [100, 100, 170, 170, null, 150], elapsedS: [0, 60, 120, 180, 240, 300] }, 186, 300);
    assert.ok(r);
    assert.deepEqual(r.bands.map((b) => b.zone), [1, 5, 4]);
    assert.equal(r.bands[0].x, 0);
    assert.ok(r.bands.every((b) => b.w > 0));
    assert.ok(r.chart.yTicks.length >= 2, 'it is a chart with a bpm axis');
    assert.equal(r.chart.xTicks.at(-1).label, '5:00');
    assert.equal(effortRibbon({ heartRate: [] }, 186, 0), null);
  });
  test('zone split: minutes per zone as shares of the whole, empty zones dropped', () => {
    const s = zoneSplit([3, 4, 1, 8, 36, 10]);
    assert.deepEqual(s.map((z) => z.key), ['z0', 'z1', 'z2', 'z3', 'z4', 'z5']);
    assert.equal(s.reduce((a, z) => a + z.minutes, 0), 62);
    assert.equal(s.find((z) => z.key === 'z4')?.pct, 58);
    assert.equal(s.find((z) => z.key === 'z4')?.short, 'Z4');
    assert.deepEqual(zoneSplit([0, 0, 5, 0, 0, 5]).map((z) => z.key), ['z2', 'z5']);
    assert.equal(zoneSplit(null), null);
    assert.equal(zoneSplit([0, 0, 0, 0, 0, 0]), null);
  });
});

describe('run pieces', () => {
  const series = {
    distanceM: [0, 500, 1000, 1500, 2000, 2500, 3000, 3300],
    elapsedS: [0, 150, 300, 440, 580, 760, 940, 1030],
    altitudeM: [20, 22, 25, 30, 28, 24, 21, 20],
  };
  test('splits per km from the distance series, diverging from the run average', () => {
    const s = runSplits(series, null);
    assert.ok(s);
    assert.deepEqual(s.rows.map((r) => r.label), ['1', '2', '3', '0.3']);
    assert.deepEqual(s.rows.map((r) => r.pace), ['5:00', '4:40', '6:00', '5:00']);
    assert.equal(s.avg, '5:12');
    assert.equal(s.rows[1].faster, true);
    assert.equal(s.rows[1].fastest, true);
    assert.equal(s.rows[2].faster, false);
    assert.equal(s.rows[2].delta, '+0:48');
    assert.equal(s.rows[1].delta, '−0:32');
    assert.equal(Math.max(...s.rows.map((r) => r.pct)), 100);
  });
  test('splits fall back to the pace enrichment, and need at least two', () => {
    const s = runSplits({}, { splits: [{ km: 1, seconds: 300 }, { km: 2, seconds: 280 }] });
    assert.deepEqual(s?.rows.map((r) => r.pace), ['5:00', '4:40']);
    assert.equal(runSplits({}, { splits: [{ km: 1, seconds: 300 }] }), null);
  });
  test('elevation profile over distance, skipped when flat', () => {
    const e = elevationProfile(series, { totalGainM: 12, totalLossM: 10 });
    assert.ok(e);
    assert.equal(e.chart.xTicks.at(-1).label, '3.3 km');
    assert.equal(e.gain, '12');
    assert.equal(elevationProfile({ ...series, altitudeM: series.altitudeM.map(() => 20) }, null), null);
    assert.equal(elevationProfile({}, null), null);
  });
  test('best efforts are ranked against earlier runs; FitGlue PRs say PB', () => {
    const efforts = (t) => ({ bestEfforts: [{ distanceKey: '1k', display: '1K', distanceM: 1000, timeSeconds: t }] });
    const files = [
      file({ slug: 'a', start: '2026-01-01T08:00:00Z', entry: efforts(300) }),
      file({ slug: 'b', start: '2026-02-01T08:00:00Z', entry: efforts(280) }),
      file({ slug: 'c', start: '2026-03-01T08:00:00Z', entry: efforts(290) }),
      file({ slug: 'd', start: '2026-04-01T08:00:00Z', entry: efforts(270) }),
    ];
    const h = buildActivityHistory(files);
    assert.equal(bestEffortBadges(files[2].entry.bestEfforts, [], h, '2026-03-01T08:00:00Z')[0].badge, '2nd best');
    const d = bestEffortBadges(files[3].entry.bestEfforts, [{ recordType: 'fastest_1k' }], h, '2026-04-01T08:00:00Z')[0];
    assert.equal(d.badge, 'PB');
    assert.equal(d.time, '4:30');
    assert.equal(d.was, '4:40');
    assert.equal(bestEffortBadges(files[0].entry.bestEfforts, [], h, '2026-01-01T08:00:00Z')[0].badge, 'first');
    assert.equal(bestEffortBadges(files[3].entry.bestEfforts, [], h, '2026-04-01T08:00:00Z')[0].badge, 'fastest yet');
  });
  test('lifetime progress towards the next milestone', () => {
    const p = lifetimeProgress({ lifetimeDistanceKm: 957.8485, nextMilestoneKm: 1000, milestoneKm: 0, activityTypeLabel: 'running' });
    assert.equal(p?.km, '957.8');
    assert.equal(p?.next, '1,000');
    assert.equal(p?.toGo, '42.2');
    assert.equal(p?.pct, 96);
    assert.equal(lifetimeProgress(null), null);
  });
});

describe('strength pieces', () => {
  const sets = [
    lift('Squat (Barbell)', 8, 20), lift('Squat (Barbell)', 8, 50), lift('Squat (Barbell)', 8, 50), lift('Squat (Barbell)', 4, 50),
    lift('Push Up', 12, 0), lift('Push Up', 10, 0),
    station('Sled Pull', 30, 0, 102), station('Sled Pull', 15, 0, 102),
    station('Plank', 0, 60),
  ];
  test('each set is a bar scaled within its exercise; the heaviest set is marked', () => {
    const cards = liftCards(sets, { history: null, date: '2026-11-03T11:00:00Z' });
    assert.deepEqual(cards.map((c) => c.name), ['Squat (Barbell)', 'Push Up', 'Sled Pull', 'Plank']);
    const squat = cards[0];
    assert.equal(squat.mode, 'load');
    assert.deepEqual(squat.bars.map((b) => b.top), ['20', '50', '50', '50']);
    assert.deepEqual(squat.bars.map((b) => b.bottom), ['×8', '×8', '×8', '×4']);
    assert.deepEqual(squat.bars.map((b) => b.pct), [40, 100, 100, 100]);
    assert.deepEqual(squat.bars.map((b) => b.heaviest), [false, true, false, false], 'first of the heaviest');
    assert.equal(squat.topSet, '50 kg × 8');
    assert.equal(squat.volume, '1,160 kg');
    assert.equal(cards[1].mode, 'reps');
    assert.deepEqual(cards[1].bars.map((b) => b.top), ['12', '10']);
    assert.equal(cards[1].topSet, '12 reps');
    assert.equal(cards[2].mode, 'distance');
    assert.deepEqual(cards[2].bars.map((b) => b.top), ['30 m', '15 m']);
    assert.equal(cards[2].few, true);
    assert.equal(squat.few, false);
    assert.deepEqual(cards[2].bars.map((b) => b.bottom), ['102 kg', '102 kg']);
    assert.equal(cards[3].mode, 'time');
    assert.deepEqual(cards[3].bars.map((b) => b.top), ['1:00']);
  });
  test('versus the last session with the same exercise', () => {
    const earlier = file({ slug: 'legs-1', type: 'WEIGHT_TRAINING', start: '2026-10-21T11:00:00Z', sets: [lift('Squat (Barbell)', 8, 45), lift('Push Up', 12, 0)] });
    const later = file({ slug: 'legs-3', type: 'WEIGHT_TRAINING', start: '2026-11-10T11:00:00Z', sets: [lift('Squat (Barbell)', 8, 60)] });
    const h = buildActivityHistory([earlier, later]);
    const cards = liftCards(sets, { history: h, date: '2026-11-03T11:00:00Z' });
    assert.equal(cards[0].vsLast?.text, '+5 kg on the top set');
    assert.equal(cards[0].vsLast?.tone, 'up');
    assert.equal(cards[0].vsLast?.url, '/life/activity/legs-1');
    assert.equal(cards[0].vsLast?.date, '21 Oct');
    assert.equal(cards[1].vsLast?.text, 'same top set');
    assert.equal(cards[2].vsLast, null, 'never done before');
  });
  test('PRs from the records enrichment, in plain words (never its emoji message)', () => {
    const list = prList([
      { recordType: 'squat_heaviest_weight', newValue: 50, unit: 'kg', previousValue: 45, displayMessage: '\u{1F3CB}️ Squat Heaviest Weight: 50kg' },
      { recordType: 'bench_press_(barbell)_1rm', newValue: 70, unit: 'kg' },
    ]);
    assert.deepEqual(list.map((r) => r.primary), ['Squat · heaviest weight', 'Bench Press (barbell) · 1RM']);
    assert.equal(list[0].secondary, '50 kg');
    assert.equal(list[0].tertiary, '+5 kg');
  });
});

describe('class pieces', () => {
  test('stations as tiles, consecutive sets of one exercise folded together', () => {
    const tiles = classStations([
      station('Treadmill', 400, 270), station('Treadmill', 1000, 277), station('Treadmill', 1000, 277),
      station('Ski Erg', 1000, 230),
      station('Sled Pull', 50, 0, 102),
      lift('Wall Ball', 20, 6), lift('Wall Ball', 20, 6),
    ]);
    assert.deepEqual(tiles?.tiles.map((t) => t.name), ['Treadmill', 'Ski Erg', 'Sled Pull', 'Wall Ball']);
    assert.equal(tiles?.tiles[0].headline, '2.4 km');
    assert.equal(tiles?.tiles[0].sets, 3);
    assert.deepEqual(tiles?.tiles[0].chips, ['400 m in 4:30', '2×1 km in 4:37']);
    assert.deepEqual(tiles?.tiles[3].chips, ['2×20 × 6 kg']);
    assert.equal(tiles?.tiles[2].headline, '50 m');
    assert.equal(tiles?.tiles[2].load, '102 kg');
    assert.equal(tiles?.tiles[3].headline, '40 reps');
    assert.equal(tiles?.tiles[3].load, '6 kg');
  });
  test('supersets are circuits with rounds', () => {
    const t = classStations([
      lift('Burpee', 10, 0, { supersetId: 's1' }), lift('Burpee', 10, 0, { supersetId: 's1' }), lift('Burpee', 10, 0, { supersetId: 's1' }),
      lift('Wall Ball', 15, 6, { supersetId: 's1' }), lift('Wall Ball', 15, 6, { supersetId: 's1' }), lift('Wall Ball', 15, 6, { supersetId: 's1' }),
      station('SkiErg', 500, 110),
    ]);
    assert.deepEqual(t?.circuits, [{ letter: 'A', rounds: 3, names: 'Burpee + Wall Ball' }]);
    assert.equal(t?.tiles[0].circuit, 'A');
    assert.equal(t?.tiles[2].circuit, '');
  });
  test('a class logged as one block has no tiles', () => {
    assert.equal(classStations([station('Bootcamp', 0, 3000)]), null);
    assert.equal(classStations([]), null);
  });
});

describe('pilates and yoga', () => {
  const p = (slug, start, title = 'Tower Pilates') => file({ slug, type: 'PILATES', title, start });
  const files = [
    p('p1', '2025-12-30T08:00:00Z'),
    p('p2', '2026-10-05T08:00:00Z'),
    p('p3', '2026-10-13T08:00:00Z'),
    p('p4', '2026-10-21T08:00:00Z'),
    p('p4b', '2026-10-28T08:00:00Z'),
    p('p5', '2026-11-02T08:00:00Z'),
    p('p6', '2026-11-03T08:00:00Z', 'Glutes & Core Pilates'),
    file({ slug: 'y1', type: 'YOGA', title: 'Hotpod Yoga', start: '2026-11-01T08:00:00Z' }),
  ];
  const h = buildActivityHistory(files);
  test('counts this year and month up to this session, and the weekly streak', () => {
    const s = practiceStats(h, files[6]);
    assert.equal(s?.practice, 'pilates');
    assert.equal(s?.nthYear, 6);
    assert.equal(s?.nthYearLabel, '6th');
    assert.equal(s?.month, 2);
    assert.equal(s?.total, 7);
    assert.equal(s?.weekStreak, 5, 'weeks of 5, 12, 19, 26 Oct and 2 Nov');
  });
  test('the week strip ends on this week, filled where there was a session', () => {
    const s = practiceStats(h, files[6]);
    assert.equal(s?.weeks.length, 26);
    assert.equal(s?.weeks.at(-1)?.current, true);
    assert.equal(s?.weeks.at(-1)?.count, 2);
    assert.equal(s?.weeks.at(-2)?.count, 1);
    assert.equal(s?.weeks.at(-7)?.count, 0);
    assert.equal(practiceStats(h, files[1])?.weekStreak, 1, 'nothing the week before 5 Oct');
  });
  test('focus words come from the title', () => {
    assert.deepEqual(focusWords('Glutes & Core Pilates Class').map((f) => f.word), ['Glutes', 'Core']);
    assert.deepEqual(focusWords('Slow Flow Reformer Pilates').map((f) => f.word), ['Slow flow', 'Reformer']);
    assert.deepEqual(focusWords('Hotpod Yoga').map((f) => f.word), ['Hot']);
    assert.deepEqual(focusWords('Pilates'), []);
  });
  test('steady heart: average, range and where most of the session sat', () => {
    const s = steadyHeart({ heartRate: [70, 72, 74, 76, 78, 80, 72, 74, 95], elapsedS: [0, 60, 120, 180, 240, 300, 360, 420, 480] }, { minBpm: 61, avgBpm: 76, maxBpm: 97 }, 480);
    assert.equal(s?.avg, 76);
    assert.equal(s?.range, '61–97');
    assert.match(s?.band ?? '', /^\d+–\d+$/);
    assert.ok(s?.chart);
  });
});

describe('fine print and anchors', () => {
  test('fine print carries only what the activity has; food comparison without emoji', () => {
    const cells = finePrint({ calories: { kcal: 446, source: 'estimate' }, en: { effort: { score: 45, band: 'Moderate' }, trainingLoad: { trimp: 57, bucket: 'Easy' }, recovery: { hoursToRecover: 20 } }, has: () => true, kind: 'strength' });
    assert.deepEqual(cells.map((c) => c.label), ['calories', 'effort', 'training load', 'recover in']);
    assert.equal(cells[0].note, '≈ 1.6 slice of pizza');
    const calm = finePrint({ calories: { kcal: 292, source: 'estimate' }, en: { effort: { score: 26, band: 'Easy' } }, has: () => true, kind: 'mind' });
    assert.deepEqual(calm.map((c) => c.label), ['calories']);
  });
  test('anchors never pad with dashes', () => {
    const a = kindAnchors('strength', { durationS: 3000, sets: 1, reps: 0, volumeKg: 0, topKg: 0 });
    assert.ok(a.every((x) => x.value && x.value !== '—'));
    assert.deepEqual(a.map((x) => x.label), ['sets', 'minutes']);
    const m = kindAnchors('mind', { durationS: 3000, avgBpm: 76, practice: { nthYear: 34, nthYearLabel: '34th', year: 2026, practice: 'pilates', weekStreak: 6 } });
    assert.deepEqual(m.map((x) => x.label), ['minutes', 'pilates of 2026', 'week streak', 'avg hr']);
    const c = kindAnchors('class', { durationS: 3888, hotMinutes: 46, maxBpm: 179, calories: 378 });
    assert.deepEqual(c.map((x) => x.label), ['minutes', 'in zones 4–5', 'peak hr', 'calories']);
  });
});
