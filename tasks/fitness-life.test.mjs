// @ts-check
// Run with `npm test` (node:test, no extra dependencies).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadFitnessData } from './fitness-fetch.mjs';
import {
  buildLifeModel, buildWeek, buildCard, buildPr, buildRoundupTeaser, buildCalendar, countdown,
  effortLevelOf, fitnessLifeTask, km, clock, duration, rangeLabel, stripDays, buildPbBoard, cardPicture,
} from './fitness-life.mjs';
import { latestRecords, recordLabel } from './fitness-records.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NOW = new Date('2026-10-25T10:00:00Z');

async function fixtures() {
  const d = await loadFitnessData({ source: 'fixtures', fixturesDir: path.join(REPO, 'fixtures', 'fitness') });
  assert.equal(d.unavailable, false);
  return d;
}

describe('formatting', () => {
  test('km, clock, duration', () => {
    assert.equal(km(5010), '5');
    assert.equal(km(32400), '32.4');
    assert.equal(km(4812300), '4,812');
    assert.equal(clock(1192), '19:52');
    assert.equal(clock(4380), '1:13:00');
    assert.equal(duration(3420), '57m');
    assert.equal(duration(4380), '1h 13m');
    assert.equal(duration(1942800), '540h');
  });

  test('rangeLabel uses the exclusive end', () => {
    assert.equal(rangeLabel(new Date('2026-10-12T00:00:00Z'), new Date('2026-10-19T00:00:00Z')), '12 – 18 OCT 2026');
    assert.equal(rangeLabel(new Date('2026-09-28T00:00:00Z'), new Date('2026-10-05T00:00:00Z')), '28 SEP – 4 OCT 2026');
  });
});

describe('effort levels (§6 rule)', () => {
  test('zone-based when Σ Z1–5 > 10 min', () => {
    assert.equal(effortLevelOf({ hrZoneMinutes: [0, 0, 2, 5, 9, 4], durationSeconds: 1192 }), 4); // 20% Z5
    assert.equal(effortLevelOf({ hrZoneMinutes: [0, 8, 31, 24, 10, 0], durationSeconds: 4380 }), 2);
    assert.equal(effortLevelOf({ hrZoneMinutes: [0, 20, 30, 5, 0, 0], durationSeconds: 3600 }), 1); // 91% Z1+2
    assert.equal(effortLevelOf({ hrZoneMinutes: [0, 5, 10, 10, 10, 0], durationSeconds: 3600 }), 3); // 28% Z4+5
  });
  test('duration-based otherwise', () => {
    assert.equal(effortLevelOf({ hrZoneMinutes: [12, 30, 15, 0, 0, 0], durationSeconds: 3420 }), 1); // 45/45 Z1+2 → 1
    assert.equal(effortLevelOf({ hrZoneMinutes: [], durationSeconds: 7300 }), 4);
    assert.equal(effortLevelOf({ hrZoneMinutes: [], durationSeconds: 4600 }), 3);
    assert.equal(effortLevelOf({ hrZoneMinutes: [], durationSeconds: 1900 }), 2);
    assert.equal(effortLevelOf({ hrZoneMinutes: [], durationSeconds: 60 }), 1);
    assert.equal(effortLevelOf({ durationSeconds: 0 }), 0);
  });
});

describe('the week', () => {
  test('from the latest weekly roundup: 7 bars, missing days at level 0', async () => {
    const d = await fixtures();
    const w = buildWeek(d.index, d.roundups, NOW);
    assert.ok(w);
    assert.equal(w.mode, 'roundup');
    assert.equal(w.title, 'WEEK 42');
    assert.equal(w.kicker, 'LATEST WEEK');
    assert.equal(w.href, '/life/roundup/week-42-2026');
    assert.equal(w.days.length, 7);
    assert.deepEqual(w.days.map((x) => x.key), [
      '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18',
    ]);
    assert.deepEqual(w.days.map((x) => x.level), [0, 1, 0, 2, 0, 4, 0]);
    assert.deepEqual(w.days.map((x) => x.letter), ['M', 'T', 'W', 'T', 'F', 'S', 'S']);
    assert.equal(w.activeDays, 3);
    assert.deepEqual(w.stats.map((s) => `${s.value}${s.unit}`), ['3', '2h 30m', '37.4km', '6,286kg']);
    // bars sit on the baseline and grow with level
    for (const day of w.days) assert.equal(day.y + day.h, 56);
  });

  test('says THIS WEEK when the roundup covers now', async () => {
    const d = await fixtures();
    const w = buildWeek(d.index, d.roundups, new Date('2026-10-14T12:00:00Z'));
    assert.equal(w?.kicker, 'THIS WEEK');
  });

  test('falls back to the last 7 days of activities and reproduces the roundup levels', async () => {
    const d = await fixtures();
    const w = buildWeek(d.index, [], NOW);
    assert.ok(w);
    assert.equal(w.mode, 'activities');
    assert.equal(w.href, null);
    assert.equal(w.range, '11 – 17 OCT 2026');
    assert.deepEqual(w.days.map((x) => `${x.key}:${x.level}`), [
      '2026-10-11:0', '2026-10-12:0', '2026-10-13:1', '2026-10-14:0', '2026-10-15:2', '2026-10-16:0', '2026-10-17:4',
    ]);
    assert.equal(w.stats[0].value, '3');
  });

  test('ignores monthly roundups when choosing the week source', async () => {
    const d = await fixtures();
    const monthly = { key: 'month-10-2026', roundup: { periodType: 'ROUNDUP_PERIOD_TYPE_MONTH', periodStart: '2026-10-01T00:00:00Z', periodEnd: '2026-11-01T00:00:00Z', dayEntries: [] } };
    const w = buildWeek(d.index, [monthly], NOW);
    assert.equal(w?.mode, 'activities');
  });

  test('null with no activities at all', () => {
    assert.equal(buildWeek({ activities: [] }, [], NOW), null);
  });

  test('stripDays handles multiple sessions on one day', () => {
    const levels = new Map([['2026-10-13', { level: 3, count: 2 }]]);
    const days = stripDays(new Date('2026-10-12T00:00:00Z'), levels);
    assert.equal(days[1].sessions, '2 sessions');
    assert.equal(days[1].levelClass, 'fit-strip__bar--l3');
    assert.equal(days[0].sessions, '0 sessions');
  });
});

describe('activity cards', () => {
  test('distance family: km / time / avg hr, PR label verbatim, thumbnail kept', async () => {
    const d = await fixtures();
    const c = buildCard(d.index.activities[0]);
    assert.equal(c.href, '/life/activity/colwick-parkrun-2026-10-17');
    assert.equal(c.date, 'SAT 17 OCT');
    assert.equal(c.typeLabel, 'RUN');
    assert.equal(c.glyph, '🏃');
    assert.deepEqual(c.stats.map((s) => s.label), ['distance', 'time', 'avg hr']);
    assert.equal(c.prLabel, '★ 5K 19:52 · −14s');
    assert.equal(c.hasThumb, true);
    assert.match(c.thumb, /^https:\/\/assets\.fitglue\.tech\//);
    assert.equal(c.source, 'Strava');
  });

  test('strength family: sets / moved / time; no thumbnail', async () => {
    const d = await fixtures();
    const c = buildCard(d.index.activities[2]);
    assert.equal(c.family, 'strength');
    assert.equal(c.typeLabel, 'WEIGHT TRAINING');
    assert.deepEqual(c.stats.map((s) => `${s.value}${s.unit}`), ['18', '6,286kg', '57m']);
    assert.equal(c.hasThumb, false);
    assert.equal(c.thumb, '');
  });

  test('other family and missing fields degrade to fewer stats', () => {
    const c = buildCard({ slug: 'yoga-2026-01-01', title: 'Yoga', activityType: 'ACTIVITY_TYPE_YOGA', startTime: '2026-01-01T07:00:00Z', durationSeconds: 1800 });
    assert.equal(c.family, 'other');
    assert.deepEqual(c.stats.map((s) => s.label), ['time']);
    assert.equal(c.prLabel, '');
    assert.equal(c.location, '');
  });

  test('a non-https thumbnail is dropped', () => {
    const c = buildCard({ slug: 'x', title: 'x', activityType: 'ACTIVITY_TYPE_RUN', startTime: '2026-01-01T07:00:00Z', routeThumbnailUrl: 'javascript:alert(1)' });
    assert.equal(c.hasThumb, false);
  });
});

describe('card pictures and type inks', () => {
  const route = Array.from({ length: 30 }, (_, i) => [52.95 + i * 0.001, -0.85 + Math.sin(i / 4) * 0.002]);
  test('first photo wins, with a +n badge for the rest', () => {
    const p = cardPicture({ photoUrls: ['https://x/a.jpg', 'https://x/b.jpg', 'http://insecure/c.jpg'], routeThumbnailUrl: 'https://x/r.png' });
    assert.equal(p.photo, 'https://x/a.jpg');
    assert.equal(p.isPhoto, true);
    assert.equal(p.photoCount, '+1');
  });
  test('then the exported route thumbnail, then a route drawn from the GPS points, then a placeholder', () => {
    assert.equal(cardPicture({ routeThumbnailUrl: 'https://x/r.png' }).photo, 'https://x/r.png');
    const drawn = cardPicture({}, { routePoints: route });
    assert.equal(drawn.photo, '');
    assert.ok(drawn.route && /^M/.test(drawn.route.d));
    assert.equal(drawn.pictureClass, 'fit-photo--route');
    const none = cardPicture({}, { routePoints: route.slice(0, 5) });
    assert.equal(none.placeholder, true);
    assert.equal(none.pictureClass, 'fit-photo--placeholder');
  });
  test('cards carry the FitGlue family ink', () => {
    const t = (activityType) => buildCard({ slug: 's', activityType }).typeClass;
    assert.equal(t('ACTIVITY_TYPE_RUN'), 'fit-type--run');
    assert.equal(t('ACTIVITY_TYPE_TRAIL_RUN'), 'fit-type--run');
    assert.equal(t('ACTIVITY_TYPE_CROSSFIT'), 'fit-type--crossfit');
    assert.equal(t('ACTIVITY_TYPE_PILATES'), 'fit-type--yoga');
    assert.equal(t('ACTIVITY_TYPE_WORKOUT'), 'fit-type--strength');
    assert.equal(t('ACTIVITY_TYPE_SOMETHING_NEW'), 'fit-type--other');
  });
  test('key stat: distance, weight moved, else time; a lone set is not a stat', () => {
    assert.equal(buildCard({ slug: 'r', activityType: 'ACTIVITY_TYPE_RUN', distanceMeters: 5100, durationSeconds: 1440 }).keyStat.label, 'distance');
    const pil = buildCard({ slug: 'p', activityType: 'ACTIVITY_TYPE_PILATES', totalSets: 1, durationSeconds: 3000 });
    assert.equal(pil.keyStat.label, 'time');
    assert.ok(!pil.stats.some((x) => x.label === 'sets'));
    assert.equal(buildCard({ slug: 'w', activityType: 'ACTIVITY_TYPE_WEIGHT_TRAINING', totalSets: 14, totalWeightKg: 5680 }).keyStat.label, 'moved');
  });
});

describe('roundup teaser', () => {
  test('weekly: labels, secondary stat, PR count, AI summary', async () => {
    const d = await fixtures();
    const t = buildRoundupTeaser(d.index.roundups[0], d.roundups[0]);
    assert.ok(t);
    assert.equal(t.href, '/life/roundup/week-42-2026');
    assert.equal(t.kindLabel, 'WEEKLY ROUNDUP');
    assert.equal(t.periodLabel, 'Week 42 · 2026');
    assert.equal(t.range, '12 – 18 OCT 2026');
    assert.equal(t.sessions, '3');
    assert.deepEqual(t.secondary, { value: '37.4', unit: 'km', label: 'covered' });
    assert.equal(t.prs, '+3 PRS');
    assert.equal(t.hasSummary, true);
    assert.match(t.summary, /^Three sessions/);
  });

  test('month and year labels; strength-only secondary; no summary without the file', () => {
    const m = buildRoundupTeaser({ key: 'month-10-2026', periodType: 'ROUNDUP_PERIOD_TYPE_MONTH', periodStart: '2026-10-01T00:00:00Z', periodEnd: '2026-11-01T00:00:00Z', totalActivities: 1, totalDistanceMeters: 0, totalWeightKg: 12000, hasStrength: true, prCount: 1 }, undefined);
    assert.equal(m?.kindLabel, 'MONTHLY ROUNDUP');
    assert.equal(m?.periodLabel, 'OCTOBER 2026');
    assert.deepEqual(m?.secondary, { value: '12', unit: 't', label: 'moved' });
    assert.equal(m?.prs, '+1 PR');
    assert.equal(m?.hasSummary, false);
    const y = buildRoundupTeaser({ key: 'year-2026', periodType: 'ROUNDUP_PERIOD_TYPE_YEAR', periodStart: '2026-01-01T00:00:00Z', periodEnd: '2027-01-01T00:00:00Z', totalActivities: 0, totalDurationSeconds: 0, prCount: 0 }, undefined);
    assert.equal(y?.kindLabel, 'YEAR IN REVIEW');
    assert.equal(y?.periodLabel, '2026');
    assert.equal(y?.prs, '');
  });
});

describe('stats and PBs', () => {
  test('PR formatting per unit, suffix grouping, deltas', () => {
    assert.deepEqual(
      (({ name, metric, display, delta, improved }) => ({ name, metric, display, delta, improved }))(
        buildPr({ recordType: 'Deadlift (Barbell)_1rm', value: 180, unit: 'kg', previousValue: 175, achievedAt: '2026-09-02T18:30:00Z' }),
      ),
      { name: 'Deadlift (Barbell)', metric: 'EST. 1RM', display: '180 kg', delta: '+5 kg', improved: true },
    );
    const five = buildPr({ recordType: '5k', value: 1192, unit: 'seconds', previousValue: 1206, achievedAt: '2026-10-17T08:19:52Z' });
    assert.equal(five.name, '5K');
    assert.equal(five.display, '19:52');
    assert.equal(five.delta, '−14s');
    assert.equal(five.improved, true);
    assert.equal(five.date, '17 OCT 2026');
    const same = buildPr({ recordType: 'Squat (Barbell)_1rm', value: 140, unit: 'kg', previousValue: 140 });
    assert.equal(same.delta, '');
    const half = buildPr({ recordType: 'half_marathon', value: 5400, unit: 'seconds' });
    assert.equal(half.name, 'HALF MARATHON');
    assert.equal(half.display, '1:30:00');
    assert.equal(half.date, '');
  });

  test('lifetime strip, streaks, consistency, zone split, strength line', async () => {
    const d = await fixtures();
    const s = buildLifeModel({ index: d.index, roundups: d.roundups, now: NOW }).stats;
    assert.ok(s);
    assert.deepEqual(s.strip.map((x) => `${x.value}${x.unit}`), ['614', '4,812km', '540h', '9wk', '24/26']);
    assert.equal(s.stripClass, 'stat-strip--5');
    assert.equal(s.consistency.weeks.length, 26);
    assert.equal(s.consistency.weeks.filter((w) => w.active).length, 24);
    assert.equal(s.zone.label, 'Pyramidal');
    assert.equal(s.zone.effortShare, '72%');
    assert.equal(s.strength.moved, '2,432 t');
    assert.equal(s.since, 'APR 2025');
    assert.deepEqual(s.prGroups.map((g) => g.key), ['run', 'iron']);
    assert.deepEqual(s.prGroups[0].tiles.map((t) => t.name), ['5K', '10K']);
    // iron: heaviest exercise first, one tile each; set volume (roundup only) is not on the wall
    assert.deepEqual(s.prGroups[1].tiles.map((t) => t.name), ['Deadlift (Barbell)', 'Squat (Barbell)', 'Bench Press (Barbell)']);
    assert.deepEqual(s.prGroups[1].tiles[0].metrics.map((m) => `${m.metric} ${m.display}`), ['EST. 1RM 180 kg']);
  });

  test('PB wall: live record keys get real names, 1RM and heaviest lift share a tile, groups by kind', () => {
    const prs = [
      { recordType: 'fastest_5k', value: 1302.8, unit: 'seconds', achievedAt: '2026-04-04T09:00:00Z', previousValue: 1330 },
      { recordType: 'fastest_400m', value: 87.5, unit: 'seconds', achievedAt: '2026-09-21T08:00:00Z' },
      { recordType: 'longest_run', value: 43176, unit: 'meters', achievedAt: '2026-01-11T09:00:00Z' },
      { recordType: 'fastest_ride_20k', value: 2625.7, unit: 'seconds', achievedAt: '2025-12-23T09:00:00Z' },
      { recordType: 'hybrid_race_hyrox_wall_balls', value: 257, unit: 'seconds', achievedAt: '2026-10-27T12:10:02Z' },
      { recordType: 'hybrid_race_hyrox_burpee_broad_jump', value: 194, unit: 'seconds', achievedAt: '2026-10-27T12:10:02Z' },
      { recordType: 'leg_press_horizontal_(machine)_1rm', value: 197.4, unit: 'kg', achievedAt: '2025-12-31T10:17:37Z', previousValue: 175 },
      { recordType: 'leg_press_1rm', value: 219.8, unit: 'kg', achievedAt: '2025-07-27T19:35:54Z' },
      { recordType: 'leg_press_heaviest_weight', value: 120, unit: 'kg', achievedAt: '2025-07-27T19:35:54Z' },
      { recordType: 'seated_cable_row_-_bar_grip_heaviest_weight', value: 58, unit: 'kg', achievedAt: '2026-10-22T10:10:21Z' },
      { recordType: 'leg_press_volume', value: 9000, unit: 'kg', achievedAt: '2025-07-27T19:35:54Z' },
    ];
    const g = buildPbBoard(prs);
    assert.deepEqual(g.map((x) => x.key), ['run', 'ride', 'iron'], 'division-less hybrid records mixed doubles with solo: not on the wall');
    assert.deepEqual(g[0].tiles.map((t) => t.name), ['5K', 'LONGEST RUN']); // 400 m is not a front-page distance
    assert.equal(g[0].tiles[1].metrics[0].display, '43.2 km');
    assert.deepEqual(g[1].tiles.map((t) => t.name), ['20K']);
    assert.deepEqual(g[2].tiles.map((t) => t.name), ['Leg Press', 'Leg Press Horizontal (Machine)', 'Seated Cable Row – Bar Grip']);
    assert.deepEqual(g[2].tiles[0].metrics.map((m) => m.metric), ['HEAVIEST LIFT', 'EST. 1RM']);
    assert.ok(!JSON.stringify(g).includes('_'), 'no raw keys reach the page');
  });

  test('latestRecords: the newest record per key wins across lists', () => {
    const r = latestRecords(
      [{ recordType: 'fastest_5k', value: 1330, unit: 'seconds', achievedAt: '2026-01-01T00:00:00Z' }],
      [{ recordType: 'fastest_5k', value: 1302, unit: 'seconds', achievedAt: '2026-04-04T00:00:00Z' }, null, { recordType: 'x' }],
    );
    assert.deepEqual(r.map((x) => x.value), [1302]);
  });

  test('recordLabel names every FitGlue key shape', () => {
    assert.deepEqual(
      ['fastest_half_marathon', 'fastest_1_mile', 'fastest_ride_10k', 'deadlift_1rm', 'bench_press_(barbell)_set_volume',
        'pull_up_reps', 'hybrid_race_hyrox_sled_push', 'hybrid_race_athx_total_time', 'highest_elevation_gain', 'odd_thing',
        'hybrid_race_hyrox_men_open_total_time', 'hybrid_race_hyrox_men_doubles_run_3', 'hybrid_race_hyrox_mixed_doubles_wall_balls']
        .map((k) => { const l = recordLabel(k); return `${l.group}|${l.name}|${l.metric}`; }),
      ['run|HALF MARATHON|FASTEST', 'run|1 MILE|FASTEST', 'ride|10K|FASTEST', 'strength|Deadlift|EST. 1RM',
        'strength|Bench Press (Barbell)|BEST SET', 'strength|Pull Up|MOST REPS', 'hyrox|SLED PUSH|FASTEST',
        'hyrox|TOTAL TIME|FASTEST', 'run|MOST CLIMBING|ELEVATION', 'other|ODD THING|BEST',
        'hyrox|TOTAL TIME|FASTEST', 'hyrox|RUN 3|FASTEST', 'hyrox|WALL BALLS|FASTEST'],
    );
    assert.deepEqual(
      ['hybrid_race_hyrox_men_open_total_time', 'hybrid_race_hyrox_men_doubles_run_3', 'hybrid_race_hyrox_men_pro_doubles_skierg'].map((k) => recordLabel(k).division),
      ["Open Men's Solo", "Open Men's Doubles", "Pro Men's Doubles"],
    );
  });

  test('a fresh profile (no streakHistory, no PRs, no zone split) still builds', () => {
    const s = buildLifeModel({
      index: { profile: { totalActivities: 1, totalDistanceMeters: 1000, totalDurationSeconds: 600 }, streaks: { currentWeeks: 0, longestWeeks: 0 }, activities: [{ slug: 'a', startTime: '2026-01-01T00:00:00Z', title: 'a', activityType: 'ACTIVITY_TYPE_RUN' }], roundups: [] },
      now: NOW,
    }).stats;
    assert.ok(s);
    assert.equal(s.strip.length, 4);
    assert.equal(s.stripClass, '');
    assert.equal(s.consistency.hasWeeks, false);
    assert.equal(s.hasPrs, false);
    assert.equal(s.zone.has, false);
    assert.equal(s.strength.has, false);
  });
});

describe('on the calendar', () => {
  // NOW is Sunday 25 Oct 2026 10:00Z (11:00 BST ends that morning → 10:00 GMT).
  const ex = (events) => ({ generatedAt: '2026-10-25T06:00:00+00:00', events });

  test('countdown wording', () => {
    const d = (s) => new Date(s);
    assert.equal(countdown(d('2026-10-25T18:00:00Z'), d('2026-10-25T19:00:00Z'), false, NOW), 'today 18:00');
    assert.equal(countdown(d('2026-10-25T09:00:00Z'), d('2026-10-25T11:00:00Z'), false, NOW), 'happening now');
    assert.equal(countdown(d('2026-10-25T00:00:00Z'), d('2026-10-26T00:00:00Z'), true, NOW), 'today');
    assert.equal(countdown(d('2026-10-26T00:00:00Z'), d('2026-10-26T01:00:00Z'), false, NOW), 'tomorrow 00:00');
    assert.equal(countdown(d('2026-10-27T12:10:00Z'), d('2026-10-27T13:40:00Z'), false, NOW), 'in 2 days');
    assert.equal(countdown(d('2027-01-30T00:00:00Z'), d('2027-01-31T00:00:00Z'), true, NOW), 'in 97 days');
  });

  test('fixtures: next five from the events calendar, stamped, past never shown', async () => {
    const d = await fixtures();
    const c = buildCalendar(d.events, [{ date: '2027-01-01', title: 'ignored: export present' }], NOW);
    assert.equal(c.source, 'calendar');
    assert.equal(c.hasAny, true);
    assert.deepEqual(c.nextUp.map((e) => e.title), [
      "Hyrox Birmingham - Open Men's Doubles", "Hyrox Birmingham - Open Men's Solo",
      'Gym induction', 'Rutland Night 10k', 'Hyrox London ExCEL - Singles',
    ]);
    assert.deepEqual(c.nextUp.map((e) => e.stamp), ['RACE', 'RACE', 'EVENT', 'RACE', 'RACE']);
    assert.equal(c.nextUp[0].when, 'in 2 days');
    assert.equal(c.nextUp[0].time, '12:10');
    assert.equal(c.nextUp[0].day, '27');
    assert.equal(c.nextUp[0].month, 'Oct 2026');
    assert.equal(c.nextUp[0].location, 'NEC, Birmingham');
    assert.equal(c.nextUp[0].dateTime, '2026-10-27T12:10:00.000Z');
    assert.equal(c.nextUp[4].allDay, true);
    assert.equal(c.nextUp[4].time, '');
    assert.equal(c.nextUp[1].description, 'Second day. Solo this time; the doubles were the warm-up.');
  });

  test('fixtures: this week is Monday to Sunday, both calendars, planned vs done', async () => {
    const d = await fixtures();
    const c = buildCalendar(d.events, [], NOW, d.index.activities);
    assert.equal(c.hasWeek, true);
    assert.equal(c.week.length, 7);
    // NOW is Sunday 25 Oct: the week is Mon 19 – Sun 25.
    assert.deepEqual(c.week.map((x) => x.dow), ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']);
    assert.deepEqual(c.week.map((x) => x.num), ['19', '20', '21', '22', '23', '24', '25']);
    assert.equal(c.weekRange, '19 – 25 OCT 2026');
    assert.equal(c.week[6].isToday, true);
    // Sunday's club run ended at 11:00Z, NOW is 10:00Z → still planned.
    assert.deepEqual(c.week[6].planned.map((s) => s.title), ['Bingham Sunday Running Club']);
    assert.equal(c.week[6].state, 'planned');
    // past days with nothing logged are rest days
    assert.equal(c.week[0].state, 'rest');
    assert.equal(c.activeDays, 0);
  });

  test('a day with a logged activity is active, even with a race or nothing planned on it', () => {
    // Tue 27 + Wed 28 Oct: the Hyrox doubles and solo, raced; the regular calendar had nothing.
    const now = new Date('2026-10-28T16:00:00Z');
    const acts = [
      { slug: 'dbl', title: "Hyrox Birmingham - Open Men's Doubles", activityType: 'ACTIVITY_TYPE_CROSSFIT', startTime: '2026-10-27T12:10:02Z' },
      { slug: 'solo', title: "Hyrox Birmingham - Open Men's Solo", activityType: 'ACTIVITY_TYPE_CROSSFIT', startTime: '2026-10-28T08:20:02Z' },
      { slug: 'old', title: 'Last week', activityType: 'ACTIVITY_TYPE_RUN', startTime: '2026-10-25T09:00:00Z' },
    ];
    const c = buildCalendar(ex([
      { id: 'c', calendar: 'regular', title: 'Hyrox Class', start: '2026-10-29T18:00:00Z', end: '2026-10-29T19:00:00Z', allDay: false, kind: 'class' },
      { id: 'r', calendar: 'events', title: 'Rutland Night 10k', start: '2026-11-01T17:30:00Z', end: '2026-11-01T18:30:00Z', allDay: false, kind: 'race' },
    ]), [], now, acts);
    assert.deepEqual(c.week.map((d) => d.state), ['rest', 'active', 'active', 'planned', 'open', 'open', 'planned']);
    assert.deepEqual(c.week[1].done.map((x) => `${x.time} ${x.typeClass} ${x.href}`), ['12:10 fit-type--crossfit /life/activity/dbl']);
    assert.equal(c.week[2].isToday, true);
    assert.equal(c.week[3].planned[0].typeClass, 'fit-type--crossfit');
    // a race from the Events calendar shows in the week and stays the big Next Up callout
    assert.deepEqual(c.week[6].planned.map((p) => `${p.kind} ${p.isEvent}`), ['race true']);
    assert.deepEqual(c.nextUp.map((e) => e.title), ['Rutland Night 10k']);
    assert.equal(c.activeDays, 2);
  });

  test('an ended session has dropped off; a day with none says so', async () => {
    const d = await fixtures();
    const c = buildCalendar(d.events, [], new Date('2026-10-25T12:00:00Z'));
    // nothing logged in the fixtures' window and the one session has ended → no strip at all
    assert.equal(c.hasWeek, false);
    assert.deepEqual(c.week, []);
  });

  test('export present but nothing upcoming → nothing rendered, no hand-written fallback', () => {
    const c = buildCalendar(ex([
      { id: 'p', calendar: 'events', title: 'Old race', start: '2026-10-01T09:00:00+01:00', end: '2026-10-01T11:00:00+01:00', allDay: false, kind: 'race' },
      { id: 'q', calendar: 'regular', title: 'Old class', start: '2026-10-24T18:00:00+01:00', end: '2026-10-24T19:00:00+01:00', allDay: false, kind: 'class' },
    ]), [{ date: '2027-01-01', title: 'hand-written' }], NOW);
    assert.equal(c.source, 'calendar');
    assert.equal(c.hasAny, false);
    assert.equal(c.hasNextUp, false);
    assert.equal(c.hasWeek, false);
    assert.deepEqual(c.week, []);
  });

  test('only regular sessions → this week without next up, and vice versa', () => {
    const only = buildCalendar(ex([
      { id: 'r', calendar: 'regular', title: 'Spin', start: '2026-10-28T18:00:00Z', end: '2026-10-28T19:00:00Z', allDay: false, kind: 'class' },
    ]), [], NOW);
    assert.equal(only.hasAny, false);
    assert.equal(only.hasNextUp, false);
    assert.equal(only.hasWeek, false); // the 28th is next week; NOW's week (19–25) has nothing
    const races = buildCalendar(ex([
      { id: 'e', calendar: 'events', title: 'Parkrun', start: '2026-11-07T09:00:00Z', end: '2026-11-07T10:00:00Z', allDay: false, kind: 'race' },
    ]), [], NOW);
    assert.equal(races.hasNextUp, true);
    assert.equal(races.hasWeek, false);
    const inWeek = buildCalendar(ex([
      { id: 'r', calendar: 'regular', title: 'Spin', start: '2026-10-25T18:00:00Z', end: '2026-10-25T19:00:00Z', allDay: false, kind: 'class' },
    ]), [], NOW);
    assert.equal(inWeek.hasWeek, true);
    assert.equal(inWeek.hasNextUp, false);
  });

  test('entries without a usable start or title are skipped', () => {
    const c = buildCalendar(ex([
      null, { calendar: 'events', title: 'no start', kind: 'race' },
      { calendar: 'events', start: '2026-11-01T09:00:00Z', end: '2026-11-01T10:00:00Z', kind: 'race' },
      { calendar: 'events', title: 'ok', start: '2026-11-01T09:00:00Z', end: 'junk', kind: 'other' },
    ]), [], NOW);
    assert.deepEqual(c.nextUp.map((e) => e.title), ['ok']);
    assert.equal(c.nextUp[0].stamp, 'EVENT');
    assert.equal(c.nextUp[0].when, 'in 7 days');
  });

  test('no export: the hand-written list, upcoming only, soonest first, race by tag', () => {
    const c = buildCalendar(null, [
      { date: '2026-04-15', day: '15', month: 'Apr 2026', title: 'Marathon', tag: 'Race • 42.2km', description: 'gone' },
      { date: '2027-01-10', title: 'Later', emoji: '🚴' },
      { date: '2026-11-01', title: 'Sooner', tag: 'Race • 5km', description: 'PB attempt' },
      { date: '2026-12-01', title: 'A thing', tag: 'Social' },
      { title: 'no date' },
      null,
    ], NOW);
    assert.equal(c.source, 'handwritten');
    assert.deepEqual(c.nextUp.map((x) => x.title), ['Sooner', 'A thing', 'Later']);
    assert.deepEqual(c.nextUp.map((x) => x.stamp), ['RACE', 'EVENT', 'EVENT']);
    assert.equal(c.nextUp[0].when, 'in 7 days');
    assert.equal(c.nextUp[0].description, 'Race • 5km — PB attempt');
    assert.equal(c.nextUp[0].allDay, true);
    assert.equal(c.hasWeek, false);
    assert.equal(c.hasAny, true);
  });

  test('no export and nothing hand-written upcoming → nothing', () => {
    const c = buildCalendar(undefined, [{ date: '2026-01-01', title: 'past' }], NOW);
    assert.equal(c.source, 'none');
    assert.equal(c.hasAny, false);
  });
});

describe('model + task', () => {
  test('unavailable: no week/roundup/stats, the hand-written calendar still renders', () => {
    const m = buildLifeModel({ index: null, unavailable: true, events: [{ date: '2027-01-01', title: 'x' }], now: NOW });
    assert.equal(m.available, false);
    assert.equal(m.week, null);
    assert.equal(m.roundup, null);
    assert.equal(m.stats, null);
    assert.deepEqual(m.activities, []);
    assert.equal(m.calendar.source, 'handwritten');
    assert.equal(m.calendar.nextUp.length, 1);
  });

  test('caps cards at six, newest first, and counts the rest', () => {
    const acts = Array.from({ length: 9 }, (_, i) => ({
      slug: `a-${i}`, title: `A ${i}`, activityType: 'ACTIVITY_TYPE_RUN', startTime: `2026-10-0${i + 1}T08:00:00Z`,
    }));
    const m = buildLifeModel({ index: { activities: acts, roundups: [], profile: {}, streaks: {} }, now: NOW });
    assert.equal(m.activities.length, 6);
    assert.equal(m.activities[0].slug, 'a-8');
    assert.equal(m.moreActivities, 3);
  });

  test('the Skier task reads the globals and the events file', async () => {
    const d = await fixtures();
    const logs = [];
    const ctx = {
      globals: {
        fitnessIndex: d.index, fitnessActivities: d.activities, fitnessRoundups: d.roundups,
        fitnessEvents: d.events, fitnessUnavailable: false,
      },
      logger: { info: (m) => logs.push(m), warn: (m) => logs.push(m), error: (m) => logs.push(m), debug() {} },
    };
    const task = fitnessLifeTask({ eventsFile: path.join(REPO, 'personal', 'items', 'life', 'fitness.json'), now: NOW });
    const out = await task.run(task.config, ctx);
    assert.equal(out.fitnessLife.available, true);
    assert.equal(out.fitnessLife.activities.length, 3);
    assert.equal(out.fitnessLife.calendar.source, 'calendar');
    assert.equal(out.fitnessLife.calendar.nextUp.length, 5);
    assert.match(
      logs.join('\n'),
      /Life page: 3 cards, week=roundup, roundup=week-42-2026, calendar=calendar \(5 next up, 1 sessions this week, 0 active\)/,
    );
  });

  test('a missing events file is a warning, not a failure', async () => {
    const logs = [];
    const task = fitnessLifeTask({ eventsFile: path.join(REPO, 'nope.json'), now: NOW });
    const out = await task.run(task.config, {
      globals: { fitnessIndex: null, fitnessUnavailable: true },
      logger: { info() {}, warn: (m) => logs.push(m), error() {}, debug() {} },
    });
    assert.equal(out.fitnessLife.available, false);
    assert.equal(out.fitnessLife.calendar.source, 'none');
    assert.equal(out.fitnessLife.calendar.hasAny, false);
    assert.match(logs.join('\n'), /nope\.json/);
  });
});
