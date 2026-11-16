// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayGrid } from './year-days.mjs';

test('53 or 54 columns, Monday lead blanks, month labels once', () => {
  const g = dayGrid(2026, (day) => ({ mark: day.slice(5) }), '2026-12-31');
  assert.ok(g.cols.length === 53 || g.cols.length === 54);
  // 1 Jan 2026 is a Thursday: three blanks lead the first column.
  assert.deepEqual(g.cols[0].cells.slice(0, 3).map((c) => c.blank), [true, true, true]);
  assert.equal(g.cols[0].cells[3].day, '2026-01-01');
  assert.equal(g.cols[0].cells[3].dow, 3);
  const real = g.cols.flatMap((c) => c.cells).filter((c) => !c.blank);
  assert.equal(real.length, 365);
  assert.equal(real[10].mark, '01-11');
  assert.equal(real[10].i, 10);
  const months = g.cols.map((c) => c.month).filter(Boolean);
  assert.deepEqual(months, ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']);
});

test('days after lastDay are future', () => {
  const g = dayGrid(2026, () => ({}), '2026-06-30');
  const real = g.cols.flatMap((c) => c.cells).filter((c) => !c.blank);
  assert.equal(real.find((c) => c.day === '2026-06-30').future, false);
  assert.equal(real.find((c) => c.day === '2026-07-01').future, true);
});

test('a leap year has 366 days', () => {
  const g = dayGrid(2024, () => ({}), '2024-12-31');
  assert.equal(g.cols.flatMap((c) => c.cells).filter((c) => !c.blank).length, 366);
});
