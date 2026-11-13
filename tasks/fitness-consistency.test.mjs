// @ts-check
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildConsistency, mondayOf, WEEKS } from './fitness-consistency.mjs';

const NOW = new Date('2026-11-13T12:00:00Z'); // a Friday; this week began Mon 9 Nov

describe('consistency strip', () => {
  test('weeks start on Monday in the site timezone', () => {
    assert.equal(mondayOf('2026-11-13'), '2026-11-09');
    assert.equal(mondayOf('2026-11-09'), '2026-11-09');
    assert.equal(mondayOf('2026-11-08'), '2026-11-02');
  });

  test('a year of columns: height is time, colour is the tag mix, missed weeks are empty', () => {
    const entries = [
      { slug: 'a', startTime: '2026-11-03T07:00:00Z', durationSeconds: 3600, tag: 'strength' },
      { slug: 'b', startTime: '2026-11-04T07:00:00Z', durationSeconds: 1800, tag: 'run', isRace: true },
      { slug: 'c', startTime: '2026-11-05T07:00:00Z', durationSeconds: 1800, tag: 'pilates' },
      // Sunday 23:30 in London (BST is over, so UTC): still the week of 2 Nov.
      { slug: 'd', startTime: '2026-11-08T23:30:00Z', durationSeconds: 1800, tag: 'strength' },
      { slug: 'e', startTime: '2026-11-10T07:00:00Z', durationSeconds: 900, tag: 'yoga' },
      { slug: 'pr', startTime: '2026-10-24T08:00:00Z', durationSeconds: 1400, tag: 'run', isRace: true, title: 'Newark parkrun' },
      { slug: 'old', startTime: '2025-01-01T07:00:00Z', durationSeconds: 99999, tag: 'run' },
    ];
    const roundups = [{ key: 'week-45-2026', periodType: 'ROUNDUP_PERIOD_TYPE_WEEK', periodStart: '2026-11-02T00:00:00Z' }];
    const c = buildConsistency(entries, roundups, (k) => `/life/roundup/${k}`, NOW);
    assert.equal(c.weeks.length, WEEKS);
    const [prev, now] = c.weeks.slice(-2);
    assert.equal(prev.height, '100.0%', 'the biggest week is full height; the out-of-range run does not count');
    assert.equal(prev.href, '/life/roundup/week-45-2026');
    assert.equal(prev.race, true);
    assert.deepEqual(prev.segments.map((s) => [s.typeClass, s.share]), [
      ['fit-type--run', '20.0%'], ['fit-type--strength', '60.0%'], ['fit-type--pilates', '20.0%'],
    ]);
    assert.match(prev.title, /^w\/c 2 Nov · 2h 30m · 1 run, 2 strength, 1 pilates · race week$/);
    assert.equal(c.weeks[c.weeks.length - 3].race, false, 'a parkrun week wears no race mark');
    assert.equal(now.current, true);
    assert.match(now.title, /\(so far\)/);
    assert.equal(c.weeks[0].active, false);
    assert.equal(c.weeks[0].height, '0.0%');
    assert.match(c.weeks[0].title, /missed$/);
    assert.deepEqual(c.key.map((k) => k.label), ['Run', 'Strength', 'Pilates', 'Yoga']);
    assert.equal(c.peak, '2h 30m');
    assert.ok(c.months.length >= 11 && c.months.every((m) => m.col > 1));
  });

  test('nothing in the year: no strip', () => {
    assert.equal(buildConsistency([], [], undefined, NOW).hasWeeks, false);
  });
});
