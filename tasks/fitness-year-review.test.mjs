// @ts-check
// Run with `npm test` (node:test, no extra dependencies).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildYearReview } from './fitness-year-review.mjs';
import { storyContext } from './fitness-roundup-story.mjs';

/** @param {string} slug @param {string} startTime @param {any} [extra] */
const entry = (slug, startTime, extra = {}) => ({ slug, showcaseId: slug, title: slug, activityType: 'ACTIVITY_TYPE_RUN', tag: 'run', startTime, durationSeconds: 3600, distanceMeters: 5000, photoUrls: [], ...extra });
const entries = [
  entry('jan-run', '2026-01-03T09:00:00Z', { locationName: 'Newark, Nottinghamshire, England, United Kingdom', tempC: -2 }),
  entry('jan-gym', '2026-01-04T09:00:00Z', { tag: 'strength', activityType: 'ACTIVITY_TYPE_WEIGHT_TRAINING', distanceMeters: 0, totalWeightKg: 5000 }),
  entry('race-10k', '2026-03-08T09:00:00Z', { title: 'Town 10k', isRace: true, distanceMeters: 10000, durationSeconds: 2865, weatherDescription: 'Light rain', tempC: 8 }),
  entry('summer', '2026-07-09T18:00:00Z', { tempC: 31, locationName: 'Bingham, Nottinghamshire, England, United Kingdom' }),
];
const files = entries.map((e) => ({
  slug: e.slug, entry: e, isRace: Boolean(e.isRace),
  activity: { title: e.title, activityType: e.activityType, startTime: e.startTime, enrichments: e.slug === 'jan-gym' ? { personalRecords: { records: [
    { recordType: 'deadlift_1rm', newValue: 120, previousValue: 110, unit: 'kg' },
    { recordType: 'hybrid_race_hyrox_wall_balls', newValue: 200, unit: 'seconds' },
  ] } } : {} },
}));
const year = { key: 'year-2026', roundup: { periodType: 'ROUNDUP_PERIOD_TYPE_YEAR', periodStart: '2026-01-01T00:00:00Z', periodEnd: '2027-01-01T00:00:00Z' } };

describe('year in review', () => {
  const ctx = storyContext({ files, entries, roundupFiles: [year] });
  const r = buildYearReview(year, ctx, { upcoming: [{ title: 'Big Race', start: '2027-02-01T09:00:00Z', kind: 'race' }, { title: 'Gym', start: '2027-01-02T09:00:00Z', kind: 'session' }] });

  test('the numbers come from the sessions', () => {
    const n = Object.fromEntries(r.numbers.map((x) => [x.key, x.display]));
    assert.equal(n.sessions, '4');
    assert.equal(n.tonnes, '5');
    assert.equal(n.races, '1');
  });
  test('every day of the year has a square; the race day is starred', () => {
    const days = r.days.cols.flatMap((c) => c.cells).filter((c) => !c.blank);
    assert.equal(days.length, 365);
    assert.equal(days.find((d) => d.day === '2026-03-08').race, true);
  });
  test('twelve months; a month with nothing yet is still being written', () => {
    assert.equal(r.months.length, 12);
    assert.equal(r.months[0].sessions, 2);
    assert.equal(r.months[11].empty, true);
  });
  test('PBs: division-less hybrid race keys are left out; the ledger names the lift', () => {
    assert.equal(r.pbs.total, 1);
    assert.equal(r.pbs.ledger[0].rows[0].name, 'Deadlift');
  });
  test('weather and places from the sessions; next year lists only races', () => {
    assert.equal(r.out.weather.hot, 31);
    assert.equal(r.out.weather.cold, -2);
    assert.equal(r.out.weather.rain, 1);
    assert.equal(r.out.places[0].name, 'Newark');
    assert.deepEqual(r.upcoming.map((u) => u.title), ['Big Race']);
  });
  test('the letter speaks from the same figures', () => {
    assert.match(r.letter[0], /4 sessions/);
  });
});

test('the year review stylesheet nests nothing by accident', async () => {
  const { readFile } = await import('node:fs/promises');
  const css = (await readFile(new URL('../personal/assets/styles/main/fitness-year-review.css', import.meta.url), 'utf8'))
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/'[^']*'|"[^"]*"/g, '""');
  let depth = 0;
  const atDepth = [];
  for (let i = 0; i < css.length; i++) {
    if (css[i] === '{') {
      const head = css.slice(Math.max(css.lastIndexOf('}', i), css.lastIndexOf('{', i - 1), css.lastIndexOf(';', i)) + 1, i).trim();
      if (head.startsWith('@media') || head.startsWith('@container')) atDepth.push(depth);
      depth++;
    } else if (css[i] === '}') {
      depth--;
      assert.ok(depth >= 0, `a stray } at offset ${i}`);
    }
  }
  assert.equal(depth, 0, 'an unclosed {');
  assert.deepEqual(atDepth.filter((d) => d > 0), [], 'a media query inside another block');
});
