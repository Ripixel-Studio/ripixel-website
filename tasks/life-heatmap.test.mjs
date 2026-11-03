// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { projectSegments, lifeHeatmapTask } from './life-heatmap.mjs';
import { runSkierTasks } from './skier-test-runner.mjs';

// Synthetic, invented coordinates.
const bounds = [51.0, -1.0, 51.2, -0.6];
const segments = [
  [[51.0, -1.0], [51.1, -0.8], [51.2, -0.6]],
  [[51.05, -0.9], [51.15, -0.7]],
];
const nums = (/** @type {string} */ d) => [...d.matchAll(/[ML]\s*(-?[\d.]+)[ ,](-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);

test('projects into viewBox', () => {
  const r = projectSegments(segments, bounds);
  const [, , w, h] = r.viewBox.split(' ').map(Number);
  for (const p of r.paths) {
    const pts = nums(p);
    assert.ok(pts.length >= 2);
    for (const [x, y] of pts) {
      assert.ok(x >= 0 && x <= w, `x ${x}`);
      assert.ok(y >= 0 && y <= h, `y ${y}`);
    }
  }
});

test('aspect follows latitude', () => {
  const r = projectSegments(segments, bounds, 1000);
  const [, , w, h] = r.viewBox.split(' ').map(Number);
  assert.equal(w, 1000);
  const expected = (0.2 / (0.4 * Math.cos((51.1 * Math.PI) / 180))) * 1000;
  assert.ok(Math.abs(h - expected) < 0.02, `${h} vs ${expected}`);
  // y flipped: northmost point at y=0, southmost at y=h
  const first = nums(r.paths[0]);
  assert.equal(first[0][1], h);
  assert.equal(first[2][1], 0);
  assert.equal(first[0][0], 0);
  assert.equal(first[2][0], 1000);
});

test('no doc gives null', async () => {
  const g = await runSkierTasks([lifeHeatmapTask()], { lifeHeatmap: null });
  assert.equal(g.lifeHeatmapView, null);
  const g2 = await runSkierTasks([lifeHeatmapTask()], {});
  assert.equal(g2.lifeHeatmapView, null);
});

test('one path per segment', async () => {
  assert.equal(projectSegments(segments, bounds).paths.length, 2);
  const g = await runSkierTasks([lifeHeatmapTask()], { lifeHeatmap: { schemaVersion: 1, activities: 7, segments, bounds } });
  const v = /** @type {any} */ (g.lifeHeatmapView);
  assert.equal(v.paths.length, 2);
  assert.equal(v.count, 7);
  assert.match(v.viewBox, /^0 0 1000 /);
});

test('degenerate input never throws', () => {
  assert.deepEqual(projectSegments([], bounds).paths, []);
  const r = projectSegments([[[51, -1], [51, -1]]], [51, -1, 51, -1]);
  assert.equal(r.paths.length, 1);
});

test('fixture doc projects', async () => {
  const doc = JSON.parse(await fs.readFile(new URL('../fixtures/fitness/life/heatmap.json', import.meta.url), 'utf8'));
  const g = await runSkierTasks([lifeHeatmapTask()], { lifeHeatmap: doc });
  const v = /** @type {any} */ (g.lifeHeatmapView);
  assert.equal(v.paths.length, doc.segments.length);
});

test('fixture doc has the schema shape: flat bounds and an activity count', async () => {
  const doc = JSON.parse(await fs.readFile(new URL('../fixtures/fitness/life/heatmap.json', import.meta.url), 'utf8'));
  assert.equal(doc.bounds.length, 4);
  assert.ok(doc.bounds.every((/** @type {unknown} */ n) => typeof n === 'number'));
  const g = await runSkierTasks([lifeHeatmapTask()], { lifeHeatmap: doc });
  assert.equal(/** @type {any} */ (g.lifeHeatmapView).count, doc.activities);
});

test('flat and nested bounds project the same', () => {
  const nested = [[bounds[0], bounds[1]], [bounds[2], bounds[3]]];
  assert.deepEqual(projectSegments(segments, nested), projectSegments(segments, bounds));
});

test('count falls back to the number of segments', async () => {
  const g = await runSkierTasks([lifeHeatmapTask()], { lifeHeatmap: { schemaVersion: 1, segments, bounds } });
  assert.equal(/** @type {any} */ (g.lifeHeatmapView).count, segments.length);
});
