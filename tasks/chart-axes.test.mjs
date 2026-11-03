// @ts-check
// Run with `npm test` (node:test). chart-axes (R2c.1): the one model behind
// every /life line chart — nice y ticks, x tick labels, gapped paths.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { niceTicks, formatTick, lineChart } from './chart-axes.mjs';

const WEEKS = ['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02'];
const weeks = (n) => ({ kind: /** @type {const} */ ('weeks'), weeks: WEEKS.slice(0, n) });
const opts = (n, extra = {}) => ({ label: 'Weight', unit: 'kg', x: weeks(n), ...extra });

describe('niceTicks', () => {
  test('steps from {1, 2, 2.5, 5} × 10^k, covering the range', () => {
    assert.deepEqual(niceTicks(78.2, 81.9), [78, 80, 82]);
    assert.deepEqual(niceTicks(0, 9400), [0, 5000, 10000]);
  });

  test('a flat series pads one step either side', () => {
    const t = niceTicks(80, 80);
    assert.equal(new Set(t).size, 3);
    assert.ok(t[0] < 80 && t[t.length - 1] > 80 && t.includes(80));
  });

  test('no float dust', () => {
    for (const v of niceTicks(0.1, 0.7)) assert.equal(String(v).length < 6, true, String(v));
  });
});

describe('formatTick', () => {
  test('compact from 1,000 up', () => {
    assert.equal(formatTick(12500, 0), '12.5K');
    assert.equal(formatTick(10000, 0), '10K');
    assert.equal(formatTick(1000, 0), '1K');
  });

  test('decimals, with no trailing .0', () => {
    assert.equal(formatTick(1.9, 1), '1.9');
    assert.equal(formatTick(80, 1), '80');
    assert.equal(formatTick(999, 0), '999');
  });
});

describe('lineChart', () => {
  test('fewer than 2 finite values is null', () => {
    assert.equal(lineChart([5], opts(1)), null);
    assert.equal(lineChart([null, 5], opts(2)), null);
    assert.equal(lineChart(/** @type {any} */ (undefined), opts(0)), null);
  });

  test('a flat series has a drawable path', () => {
    const m = lineChart([80, 80], opts(2));
    assert.ok(m);
    assert.doesNotMatch(m.d, /NaN/);
    assert.doesNotMatch(m.area, /NaN/);
  });

  test('gaps break the line', () => {
    const m = lineChart([1, null, 3, 4], opts(4));
    assert.ok(m);
    assert.equal((m.d.match(/M/g) || []).length, 2);
  });

  test('y ticks: top pct 0, bottom pct 100, labels formatted', () => {
    const m = lineChart([78.2, 80, 81.9], opts(3));
    assert.ok(m);
    assert.equal(m.yTicks[0].pct, 0);
    assert.equal(m.yTicks[m.yTicks.length - 1].pct, 100);
    assert.deepEqual(m.yTicks.map((t) => t.label), ['82', '80', '78']);
  });

  test('the path is scaled into the tick domain', () => {
    const m = lineChart([78, 82], { ...opts(2), w: 100, h: 50 });
    assert.ok(m);
    assert.equal(m.d, 'M0,50 L100,0');
  });

  test('weeks: first, middle, last as "6 Oct"', () => {
    const m = lineChart([1, 2, 3, 4, 5], opts(5));
    assert.ok(m);
    assert.deepEqual(m.xTicks.map((t) => t.label), ['5 Oct', '19 Oct', '2 Nov']);
    assert.deepEqual(m.xTicks.map((t) => t.pct), [0, 50, 100]);
  });

  test('months: "Oct ’26"', () => {
    const m = lineChart([1, 2, 3], { label: 'Commits', unit: '', x: { kind: 'months', months: ['2026-09', '2026-10', '2026-11'] } });
    assert.ok(m);
    assert.deepEqual(m.xTicks.map((t) => t.label), ['Sep ’26', 'Oct ’26', 'Nov ’26']);
  });

  test('clock: m:ss under an hour, h:mm from an hour', () => {
    const a = lineChart([1, 2, 3], { label: 'Heart rate', unit: 'bpm', x: { kind: 'clock', seconds: 3300 } });
    assert.ok(a);
    assert.equal(a.xTicks[a.xTicks.length - 1].label, '55:00');
    assert.equal(a.xTicks[0].label, '0:00');
    const b = lineChart([1, 2, 3], { label: 'Heart rate', unit: 'bpm', x: { kind: 'clock', seconds: 5400 } });
    assert.ok(b);
    assert.equal(b.xTicks[b.xTicks.length - 1].label, '1:30');
  });

  test('days: every label', () => {
    const labels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
    const m = lineChart([1, 2, 3, 4, 5, 6, 7], { label: 'Steps', unit: 'steps', x: { kind: 'days', labels } });
    assert.ok(m);
    assert.deepEqual(m.xTicks.map((t) => t.label), labels);
  });

  test('summary is the aria text', () => {
    const m = lineChart([81, 80, null, 79], { ...opts(4), x: weeks(4) });
    assert.ok(m);
    assert.equal(m.summary, 'Weight in kg, 4 weeks: 81 to 79');
  });
});
