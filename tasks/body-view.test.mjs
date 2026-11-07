// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recompView, engineView, nightsView, stepsView } from './body-view.mjs';

const JOURNEY = {
  rows: [
    { key: 'weightKg', from: '2025-08', to: '2026-10', first: 76.3, now: 75.8, change: -0.5 },
    { key: 'fatMassKg', from: '2025-08', to: '2026-10', first: 18.1, now: 13.0, change: -5.1 },
    { key: 'leanMassKg', from: '2025-08', to: '2026-10', first: 58.2, now: 62.8, change: 4.6 },
    { key: 'restingHr', from: '2025-08', to: '2026-11', first: 63, now: 57, change: -6 },
    { key: 'vo2Max', from: '2025-08', to: '2026-06', first: 48.7, now: 53.6, change: 4.9 },
  ],
  monthly: [
    { month: '2025-08', fatMassKg: 18, leanMassKg: 58 },
    { month: '2025-09', restingHr: 60 },
    { month: '2026-01', fatMassKg: 12, leanMassKg: 60 },
  ],
};

test('recomp: the story, then and now, a column per month with both masses', () => {
  const r = /** @type {any} */ (recompView(JOURNEY));
  assert.deepEqual(r.story, { lead: '5.1 kg of fat', mid: 'swapped for', tail: '4.6 kg of lean' });
  assert.equal(r.then.when, 'Aug 2025');
  assert.equal(r.now.fatPct, '17.2');
  assert.equal(r.pair.length, 2);
  assert.equal(r.weightFlat, true);
  assert.deepEqual(r.monthly.map((/** @type {any} */ m) => m.label), ['Aug', 'Jan']);
  assert.equal(r.monthly[1].year, '2026');
  assert.equal(recompView({ rows: [JOURNEY.rows[0]] }), null);
});

test('engine: heartbeats a day from the resting drop, VO2 on its scale', () => {
  const e = /** @type {any} */ (engineView(JOURNEY, { vo2Max: 53.6 }));
  assert.equal(e.heart.beats, '8,640');
  assert.equal(e.heart.was, '63');
  assert.equal(e.gauge.up, '4.9');
  assert.equal(e.gauge.last, 'Jun 2026');
  assert.ok(e.gauge.firstAt < e.gauge.nowAt);
  const up = /** @type {any} */ (engineView({ rows: [{ key: 'restingHr', from: '2025-08', to: '2026-11', first: 55, now: 58, change: 3 }] }, {}));
  assert.equal(up.heart.beats, '');
  assert.equal(engineView(null, {}), null);
});

test('nights: needs a week, stages bottom-up, minutes only', () => {
  const n = Array.from({ length: 8 }, (_, i) => ({ date: `2026-11-0${i + 1}`, minutes: 400, deep: 60, light: 250, rem: 90, wake: 20 }));
  const v = /** @type {any} */ (nightsView(n));
  assert.equal(v.count, 8);
  assert.deepEqual(v.cols[0].parts.map((/** @type {any} */ p) => p.key), ['deep', 'rem', 'light', 'wake']);
  assert.equal(v.avg, '6h 40m');
  assert.match(v.cols[0].title, /^1 Nov: 6h 40m asleep/);
  assert.equal(nightsView(n.slice(0, 6)), null);
  const plain = /** @type {any} */ (nightsView(n.map((x) => ({ date: x.date, minutes: x.minutes }))));
  assert.deepEqual(plain.cols[0].parts, [{ key: 'asleep', h: 100 }]);
});

test('steps: lifetime numbers and a grid with fixed bands', () => {
  const s = /** @type {any} */ (stepsView({ since: '2025-08-11', total: 4617037, days: 445, tenK: 208, best: 53959,
    daily: { '2026-11-06': 3000, '2026-11-07': 16000 } }, '2026-11-07'));
  assert.equal(s.total, '4.6');
  assert.equal(s.totalUnit, 'million');
  assert.equal(s.since, 'Aug 2025');
  assert.equal(s.marathons, '82');
  assert.equal(s.tenKShare, 47);
  const cells = s.grid.cells.filter((/** @type {any} */ c) => c.n);
  assert.deepEqual(cells.map((/** @type {any} */ c) => c.level), [1, 4]);
  assert.match(cells[1].title, /^16,000 steps/);
  assert.equal(stepsView(null, '2026-11-07'), null);
});
