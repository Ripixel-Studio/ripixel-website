// @ts-check
// Run with `npm test` (node:test, no extra dependencies).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { buildRacePbs, raceTime, absorbedEfforts, RACE_PBS_HREF } from './fitness-race-pbs.mjs';
import { buildLifeModel, personalBestsModel } from './fitness-life.mjs';

let n = 0;
/**
 * A race file the way the export writes one.
 * @param {{ type: string, variant: string, date: string, secs: number, metres?: number, tag?: string, title?: string, extra?: any, activity?: any }} o
 */
function race(o) {
  const slug = `race-${++n}-${o.date}`;
  return {
    slug, tag: o.tag || 'run', isRace: true, raceType: o.type, raceVariant: o.variant,
    activity: { startTime: `${o.date}T09:00:00Z`, title: o.title || `Race ${n}`, ...(o.activity || {}) },
    entry: { showcaseId: slug, title: o.title || `Race ${n}`, startTime: `${o.date}T09:00:00Z`, durationSeconds: o.secs, distanceMeters: o.metres ?? 0, tag: o.tag || 'run', isRace: true },
    ...(o.extra || {}),
  };
}

/** A Hyrox `race` key with an official total. @param {number} total */
const hyroxRace = (total) => ({
  race: { totalSeconds: total, division: { key: 'open_men_single', label: 'Open Men Single' }, segments: [{ key: 'run_1', durationSeconds: 300 }, { key: 'skierg', durationSeconds: 280 }] },
});

describe('race PBs', () => {
  test('groups by race type in board order; road by distance, others by attempts then name', () => {
    const files = [
      race({ type: 'parkrun', variant: 'Hilltop', date: '2026-01-03', secs: 1500, metres: 5000 }),
      race({ type: 'parkrun', variant: 'Riverside', date: '2026-01-10', secs: 1400, metres: 5000 }),
      race({ type: 'parkrun', variant: 'Riverside', date: '2026-01-17', secs: 1420, metres: 5000 }),
      race({ type: 'parkrun', variant: 'Abbey', date: '2026-01-24', secs: 1450, metres: 5000 }),
      race({ type: 'road', variant: 'Marathon', date: '2026-04-01', secs: 15000, metres: 42200 }),
      race({ type: 'road', variant: 'Town 7', date: '2026-03-01', secs: 3300, metres: 11200 }),
      race({ type: 'road', variant: '10k', date: '2026-02-01', secs: 2900, metres: 10000 }),
      race({ type: 'road', variant: '5k', date: '2026-02-08', secs: 1450, metres: 5000 }),
      race({ type: 'road', variant: 'Half marathon', date: '2026-05-01', secs: 6800, metres: 21100 }),
      race({ type: 'spartan', variant: 'Sprint', date: '2026-07-11', secs: 2958, metres: 6100, tag: 'hybrid' }),
      race({ type: 'hyrox', variant: "Open Men's Single", date: '2026-03-28', secs: 5043, tag: 'hybrid', extra: hyroxRace(5027) }),
      race({ type: 'mystery', variant: 'Odd one', date: '2026-06-01', secs: 1000, tag: 'other' }),
      { slug: 'not-a-race', isRace: false, entry: { startTime: '2026-01-01T09:00:00Z', durationSeconds: 100 } },
    ];
    const groups = buildRacePbs(files);
    assert.deepEqual(groups.map((g) => g.key), ['hyrox', 'spartan', 'road', 'parkrun', 'other']);
    assert.deepEqual(groups.find((g) => g.key === 'road')?.rows.map((r) => r.name), ['5k', '10k', 'Half marathon', 'Marathon', 'Town 7']);
    assert.deepEqual(groups.find((g) => g.key === 'parkrun')?.rows.map((r) => r.name), ['Riverside', 'Abbey', 'Hilltop']);
    // Colour from the races' own tag, never a per-type map.
    assert.equal(groups[0].typeClass, 'fit-type--hybrid');
    assert.equal(groups.find((g) => g.key === 'road')?.typeClass, 'fit-type--run');
    assert.equal(groups.find((g) => g.key === 'other')?.typeClass, 'fit-type--other');
  });

  test('the official time wins over elapsed: Hyrox race total, parkrun finish time', () => {
    const hx = race({ type: 'hyrox', variant: "Open Men's Single", date: '2026-03-28', secs: 5043, tag: 'hybrid', extra: hyroxRace(5027) });
    assert.deepEqual(raceTime(hx, 'hyrox'), { seconds: 5027, official: true });
    const pk = race({ type: 'parkrun', variant: 'Riverside', date: '2026-08-01', secs: 1437, metres: 5080, title: 'Riverside parkrun', activity: { enrichments: { parkrun: { finishTime: '23:58' } } } });
    assert.deepEqual(raceTime(pk, 'parkrun'), { seconds: 23 * 60 + 58, official: true });
    const plain = race({ type: 'parkrun', variant: 'Riverside', date: '2026-08-08', secs: 1500, metres: 5000, title: 'Riverside parkrun' });
    assert.deepEqual(raceTime(plain, 'parkrun'), { seconds: 1500, official: false });
    const [g] = buildRacePbs([hx]);
    assert.equal(g.rows[0].best?.time, '1:23:47');
    assert.equal(g.rows[0].best?.source, 'official time');
  });

  test('a PB and the latest attempt’s gap to it; no gap when the latest is the PB', () => {
    const files = [
      race({ type: 'road', variant: '10k', date: '2026-01-01', secs: 3000, metres: 10000 }),
      race({ type: 'road', variant: '10k', date: '2026-02-01', secs: 2865, metres: 10050 }),
      race({ type: 'road', variant: '10k', date: '2026-03-01', secs: 2937, metres: 10100 }),
      race({ type: 'road', variant: '5k', date: '2026-01-01', secs: 1500, metres: 5000 }),
      race({ type: 'road', variant: '5k', date: '2026-02-01', secs: 1450, metres: 5000 }),
    ];
    const [road] = buildRacePbs(files);
    const tenK = /** @type {any} */ (road.rows.find((r) => r.name === '10k'));
    assert.equal(tenK.attempts, 3);
    assert.equal(tenK.attemptsLabel, '3 goes');
    assert.equal(tenK.best.time, '47:45');
    assert.match(tenK.best.url, /^\/life\/activity\/race-\d+-2026-02-01$/);
    assert.equal(tenK.best.date, '1 FEB 2026');
    assert.equal(tenK.latest.time, '48:57');
    assert.equal(tenK.latest.gap, '+1:12');
    assert.equal(tenK.latestIsPb, false);
    const fiveK = /** @type {any} */ (road.rows.find((r) => r.name === '5k'));
    assert.equal(fiveK.latest, null);
    assert.equal(fiveK.latestIsPb, true);
  });

  test('distances that differ by more than 10% claim no PB and list the attempts', () => {
    const files = [
      race({ type: 'trail', variant: 'Lapped Trail', date: '2026-01-11', secs: 21575, metres: 43176 }),
      race({ type: 'trail', variant: 'Lapped Trail', date: '2026-04-11', secs: 11425, metres: 30108 }),
      race({ type: 'trail', variant: 'Lapped Trail', date: '2026-07-05', secs: 9017, metres: 23855 }),
      race({ type: 'trail', variant: 'Fell Race', date: '2026-06-03', secs: 1427, metres: 5014 }),
      race({ type: 'trail', variant: 'Fell Race', date: '2026-07-03', secs: 1400, metres: 5300 }),
    ];
    const [trail] = buildRacePbs(files);
    const lapped = /** @type {any} */ (trail.rows[0]);
    assert.equal(lapped.name, 'Lapped Trail');
    assert.equal(lapped.varies, true);
    assert.equal(lapped.best, null);
    assert.equal(lapped.latest, null);
    assert.deepEqual(lapped.list.map((/** @type {any} */ a) => [a.date, a.distance, a.time]), [
      ['5 JUL 2026', '23.9 km', '2:30:17'], ['11 APR 2026', '30.1 km', '3:10:25'], ['11 JAN 2026', '43.2 km', '5:59:35'],
    ]);
    const fell = /** @type {any} */ (trail.rows[1]);
    assert.equal(fell.varies, false, '5.7% apart is the same course');
    assert.equal(fell.best.time, '23:20');
  });

  test('no races: no groups, and no section on the page', () => {
    assert.deepEqual(buildRacePbs([]), []);
    assert.deepEqual(buildRacePbs(/** @type {any} */ (undefined)), []);
    assert.equal(personalBestsModel([{ slug: 'a-run', isRace: false, entry: { startTime: '2026-01-01T09:00:00Z', durationSeconds: 1800 } }]), null);
    const index = { activities: [{ slug: 'a-run', startTime: '2026-01-01T09:00:00Z', title: 'Run', activityType: 'ACTIVITY_TYPE_RUN', durationSeconds: 1800 }], roundups: [], profile: {}, streaks: { currentWeeks: 0, longestWeeks: 0 } };
    assert.equal(buildLifeModel({ index, activities: [], now: new Date('2026-01-02T00:00:00Z') }).personalBests, null);
    const withRace = buildLifeModel({ index, activities: [race({ type: 'road', variant: '5k', date: '2026-01-01', secs: 1500, metres: 5000 })], now: new Date('2026-01-02T00:00:00Z') });
    assert.equal(withRace.personalBests?.groups.length, 1);
    assert.equal(withRace.personalBests?.anchor, 'race-pbs');
    assert.equal(RACE_PBS_HREF, '/life/fitness#race-pbs');
  });

  test('one section, every number once: road rows take the matching best effort, training keeps the rest', () => {
    const files = [
      race({ type: 'road', variant: '5k', date: '2026-06-03', secs: 1427, metres: 5010 }),
      race({ type: 'road', variant: 'Burghley 7', date: '2026-03-01', secs: 3299, metres: 11200 }),
    ];
    const tile = (/** @type {string} */ name, /** @type {string} */ display) => ({ name, metrics: [{ metric: 'FASTEST', display }], single: true, date: '4 APR 2026' });
    const wall = [
      { key: 'run', title: 'on foot', typeClass: 'fit-type--run', tiles: [tile('1K', '4:08'), tile('5K', '21:43'), tile('10K', '47:30'), tile('LONGEST RUN', '43.2 km')] },
      { key: 'iron', title: 'iron', typeClass: 'fit-type--strength', tiles: [tile('Deadlift', '170 kg')] },
    ];
    const m = /** @type {any} */ (personalBestsModel(files, /** @type {any} */ (wall)));
    const road = m.groups.find((/** @type {any} */ g) => g.key === 'road');
    assert.deepEqual(road.rows.map((/** @type {any} */ r) => [r.name, r.best.time, r.effort?.time ?? null]), [['5k', '23:47', '21:43'], ['Burghley 7', '54:59', null]]);
    // 10K has no road race, so it stays a training best; 5K moved to the race row.
    assert.deepEqual(m.training.map((/** @type {any} */ g) => [g.key, g.tiles.map((/** @type {any} */ t) => t.name)]), [['run', ['1K', '10K', 'LONGEST RUN']], ['iron', ['Deadlift']]]);
    assert.deepEqual([...absorbedEfforts(m.groups)], ['5k']);
  });

  test('a Hyrox division row is filed under the official division and carries its best splits', () => {
    const hx = race({ type: 'hyrox', variant: "Open Men's Single (model's word)", date: '2026-03-28', secs: 5043, tag: 'hybrid', extra: hyroxRace(5027) });
    const splits = [{ label: 'Open Men Single', stations: [{ name: 'SkiErg', display: '4:40' }], runs: [{ name: 'Run 1', display: '5:00' }] }];
    const [g] = buildRacePbs([hx], { hyroxSplits: splits });
    assert.equal(g.rows[0].name, 'Open Men Single');
    assert.deepEqual(/** @type {any} */ (g.rows[0]).splits?.stations.map((/** @type {any} */ s) => s.name), ['SkiErg']);
    const [bare] = buildRacePbs([hx]);
    assert.equal(/** @type {any} */ (bare.rows[0]).splits, null, 'no splits known: no drawer');
  });
});
