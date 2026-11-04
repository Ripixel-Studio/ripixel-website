// @ts-check
// Run with `npm test` (node:test). chart-axes (R2c.1): the one model behind
// every /life line chart — nice y ticks, x tick labels, gapped paths.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { niceTicks, formatTick, lineChart, SECOND_MULTS, stackedShare } from './chart-axes.mjs';

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

  test('invert: low values on top, ticks ascending down the axis', () => {
    const clock = { kind: 'clock', seconds: 60 };
    const up = lineChart([300, 360], { label: 'v', unit: 'u', x: clock });
    const inv = lineChart([300, 360], { label: 'v', unit: 'u', x: clock, invert: true });
    assert.ok(up && inv);
    const ys = (m) => [...m.d.matchAll(/,([\d.]+)/g)].map((x) => +x[1]);
    assert.ok(ys(up)[0] > ys(up)[1], 'a rising series rises');
    assert.ok(ys(inv)[0] < ys(inv)[1], 'inverted: the larger value is lower');
    const labels = inv.yTicks.map((t) => +t.label);
    assert.deepEqual(labels, [...labels].sort((a, b) => a - b), 'smallest at the top');
    assert.equal(inv.yTicks[0].pct, 0);
    assert.equal(inv.yTicks.at(-1).pct, 100);
  });

  test('fmt and mults: pace ticks and end label read as m:ss on 10/15/30 s steps', () => {
    const pace = (v) => `${Math.floor(v / 60)}:${String(Math.round(v % 60)).padStart(2, '0')}`;
    const m = lineChart([312, 330, 301, 345], { label: 'Pace', unit: '/km', x: { kind: 'clock', seconds: 1200 }, invert: true, fmt: pace, mults: SECOND_MULTS });
    assert.ok(m);
    assert.deepEqual(m.yTicks.map((t) => t.label), ['5:00', '5:30', '6:00']);
    assert.equal(m.end.label, '5:45');
    assert.equal(m.summary, 'Pace in /km, over 20:00: 5:12 to 5:45');
    // The fastest sample (301 s) sits higher than the slowest (345 s).
    assert.ok(m.end.y > 0 && m.yTicks[0].label === '5:00');
  });
});

// ─── R2e.5: the stacked-share column model (languages by year) ───
describe('stackedShare', () => {
  // TypeScript leads overall; Go leads 2025 alone.
  const BY_YEAR = {
    '2023': { TypeScript: 70, Python: 20, CSS: 10 },
    '2024': { TypeScript: 50, Go: 30, Python: 20 },
    '2025': { Go: 55, TypeScript: 40, Shell: 5 },
    '2026': { TypeScript: 60, Go: 25, HTML: 10, Rust: 5 },
  };

  test('stackedShare sums: each year\'s segments sum to 100', () => {
    const m = stackedShare({ '2024': { A: 33.33, B: 33.33, C: 33.34 }, '2025': { A: 1, B: 2 } });
    assert.ok(m);
    for (const y of m.years) {
      const sum = y.segments.reduce((s, g) => s + g.pct, 0);
      assert.ok(Math.abs(sum - 100) <= 0.1, `${y.label}: ${sum}`);
      const h = y.segments.reduce((s, g) => s + g.h, 0);
      assert.ok(Math.abs(h - 100) <= 0.1, `${y.label} heights: ${h}`);
    }
    const m2 = stackedShare(BY_YEAR);
    assert.ok(m2);
    for (const y of m2.years) assert.ok(Math.abs(y.segments.reduce((s, g) => s + g.pct, 0) - 100) <= 0.1);
    assert.deepEqual(m2.years.map((y) => y.label), ['2023', '2024', '2025', '2026']);
    assert.deepEqual(m2.yTicks.map((t) => t.label), ['100%', '50%', '0%']);
    assert.deepEqual(m2.yTicks.map((t) => t.pct), [0, 50, 100]);
  });

  test('slots stable: TypeScript keeps slot 1 even when Go leads a year', () => {
    const m = stackedShare(BY_YEAR);
    assert.ok(m);
    assert.equal(m.series[0].key, 'TypeScript');
    assert.equal(m.series[0].slot, 1);
    assert.equal(m.series[1].key, 'Go');
    for (const y of m.years) {
      const ts = y.segments.find((g) => g.key === 'TypeScript');
      assert.ok(ts, y.label);
      assert.equal(ts.slot, 1, y.label);
      // slot 1 sits on the baseline in every column
      assert.ok(Math.abs(ts.y + ts.h - 100) < 0.01, y.label);
    }
    // segments keep the fixed series order, not the year's rank
    const y25 = m.years.find((y) => y.label === '2025');
    assert.deepEqual(y25?.segments.map((g) => g.key), ['TypeScript', 'Go', 'Other']);
  });

  test('other bucket: a 7th language is folded into Other', () => {
    const m = stackedShare({
      '2025': { A: 30, B: 20, C: 15, D: 12, E: 10, F: 8, G: 5 },
      '2026': { A: 30, B: 20, C: 15, D: 12, E: 10, F: 8, G: 5 },
    });
    assert.ok(m);
    assert.deepEqual(m.series.map((s) => s.key), ['A', 'B', 'C', 'D', 'E', 'Other']);
    assert.deepEqual(m.series.map((s) => s.slot), [1, 2, 3, 4, 5, 6]);
    const other = m.years[0].segments.find((g) => g.key === 'Other');
    assert.equal(other?.pct, 13);
    assert.equal(other?.label, 'Other');
    // no Other series when nothing is folded
    const few = stackedShare({ '2025': { A: 60, B: 40 }, '2026': { A: 50, B: 50 } });
    assert.deepEqual(few?.series.map((s) => s.key), ['A', 'B']);
  });

  test('single year: null', () => {
    assert.equal(stackedShare({ '2026': { TypeScript: 100 } }), null);
    assert.equal(stackedShare({}), null);
    assert.equal(stackedShare(/** @type {any} */ (null)), null);
    // a year with no usable shares does not count
    assert.equal(stackedShare({ '2025': { Go: 0 }, '2026': { Go: 100 } }), null);
  });

  test('summary and x positions', () => {
    const m = stackedShare(BY_YEAR);
    assert.ok(m);
    assert.equal(m.summary, 'Languages by year, 2023 to 2026: TypeScript most in 2023, 2024, 2026; Go most in 2025');
    assert.deepEqual(m.years.map((y) => y.pct), [12.5, 37.5, 62.5, 87.5]);
    // direct labels on the latest column, for segments tall enough to hold one
    assert.deepEqual(m.ends.map((e) => e.label), ['TypeScript', 'Go', 'HTML']);
  });

  test('gap years: a missing run gets its own marked slot, not silent adjacency', () => {
    const m = stackedShare({ '2016': { Java: 100 }, '2020': { Go: 100 }, '2021': { Go: 50, Java: 50 }, '2024': { Go: 100 } });
    assert.ok(m);
    assert.deepEqual(m.years.map((y) => y.label), ['2016', '2020', '2021', '2024']);
    assert.deepEqual(m.gaps.map((g) => g.label), ['2017–2019', '2022–2023']);
    assert.deepEqual(m.gaps.map((g) => g.title), ['No code in 2017–2019', 'No code in 2022–2023']);
    // the gap sits between its neighbours on the x axis
    const [g1, g2] = m.gaps;
    assert.ok(m.years[0].pct < g1.pct && g1.pct < m.years[1].pct);
    assert.ok(m.years[2].pct < g2.pct && g2.pct < m.years[3].pct);
    // a single missing year is labelled by itself
    const one = stackedShare({ '2023': { Go: 100 }, '2025': { Go: 100 } });
    assert.deepEqual(one?.gaps.map((g) => g.label), ['2024']);
    // contiguous years: no gaps; short labels for narrow screens
    const none = stackedShare({ '2025': { Go: 100 }, '2026': { Go: 100 } });
    assert.deepEqual(none?.gaps, []);
    assert.deepEqual(none?.years.map((y) => y.short), ['’25', '’26']);
    // every slot fits inside the plot
    for (const c of [...m.years, ...m.gaps]) assert.ok(c.left >= 0 && c.left + c.width <= 100.01, JSON.stringify(c));
  });
});

test('clockBars: 24 columns, merged block at its per-hour average, labels', async () => {
  const { clockBars, hourLabel } = await import('./chart-axes.mjs');
  assert.equal(hourLabel(0), '12am');
  assert.equal(hourLabel(12), '12pm');
  assert.equal(hourLabel(21), '9pm');
  const hours = Array.from({ length: 24 }, (_, h) => (h >= 9 && h < 17 ? null : h === 21 ? 4 : 1));
  const m = clockBars(hours, { label: 'Weekdays', merged: { from: 9, to: 17, total: 8, label: 'daytime' } });
  assert.ok(m);
  assert.equal(m.bars.length, 17);
  const block = m.bars.find((b) => b.merged);
  const one = m.bars.find((b) => b.label === '12am');
  assert.equal(block.h, one.h, '8 h over 8 hours draws as 1 h a hour');
  assert.ok(block.width > one.width * 7);
  assert.equal(m.yTicks[m.yTicks.length - 1].label, '0');
  assert.match(m.summary, /busiest hour 9pm/);
  assert.equal(clockBars(Array(24).fill(0), { label: 'x' }), null);
  assert.equal(clockBars([1, 2], { label: 'x' }), null);
});
