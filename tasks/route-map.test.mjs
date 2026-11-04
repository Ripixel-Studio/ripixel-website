// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  routeMapState, cleanPoints, activityMapData, heatmapMapData, scriptJson, boundsOf, routeMapAssetsTask, ROUTE_EMPTY_LABELS,
} from './route-map.mjs';
import { buildActivityView } from './fitness-activity-views.mjs';
import { runSkierTasks } from './skier-test-runner.mjs';

// Synthetic, invented coordinates.
const line = [[51.1, -0.5], [51.1004, -0.5003], [51.1009, -0.5011]];

test('empty states: hidden wins, GPS draws a map, distance without GPS is indoor, others get no card', () => {
  assert.equal(routeMapState({ routePoints: line, routeHidden: true, category: 'cardio-distance' }), 'hidden');
  assert.equal(routeMapState({ routePoints: [], routeHidden: true, category: 'strength' }), 'hidden');
  assert.equal(routeMapState({ routePoints: line, category: 'cardio-distance' }), 'map');
  assert.equal(routeMapState({ routePoints: [], category: 'cardio-distance' }), 'indoor');
  assert.equal(routeMapState({ routePoints: undefined, category: 'cardio-distance' }), 'indoor');
  assert.equal(routeMapState({ routePoints: [[0, 0], [0, 0]], category: 'cardio-distance' }), 'indoor');
  assert.equal(routeMapState({ routePoints: [[51, -1]], category: 'cardio-distance' }), 'indoor');
  assert.equal(routeMapState({ routePoints: line, routeHidden: 'yes', category: 'cardio-distance' }), 'map');
  assert.equal(routeMapState({ routePoints: [], category: 'strength' }), null);
  assert.equal(routeMapState({ routePoints: [], category: 'cardio-time' }), null);
  assert.equal(ROUTE_EMPTY_LABELS.indoor, 'indoor — no route');
  assert.equal(ROUTE_EMPTY_LABELS.hidden, 'route hidden near home');
});

test('cleanPoints: drops junk and 0,0 fixes, rounds to 5 dp, never adds points', () => {
  assert.deepEqual(cleanPoints([[51.1234567, -0.1234567], [0, 0], [NaN, 1], 'x', [95, 1], [51.2, -0.2, 40]]), [[51.12346, -0.12346], [51.2, -0.2]]);
  assert.deepEqual(cleanPoints(null), []);
});

test('activity map JSON: the published line and its own bounds, nothing else', () => {
  const d = activityMapData(line);
  assert.deepEqual(Object.keys(d).sort(), ['fit', 'kind', 'line']);
  assert.equal(d.kind, 'route');
  assert.deepEqual(d.line, line);
  assert.deepEqual(d.fit, [[51.1, -0.5011], [51.1009, -0.5]]);
  assert.deepEqual(JSON.parse(scriptJson(d)), d);
});

test('heatmap JSON: every segment, fit = home turf, all = every segment', () => {
  const segs = [line, [[48.85, 2.35], [48.86, 2.36]], [[51, -1]]];
  const d = heatmapMapData(segs, [51.0, -0.6, 51.2, -0.4]);
  assert.deepEqual(Object.keys(d).sort(), ['all', 'fit', 'kind', 'segments']);
  assert.equal(d.kind, 'heatmap');
  assert.equal(d.segments.length, 2, 'a one-point segment is dropped');
  assert.deepEqual(d.fit, [[51, -0.6], [51.2, -0.4]]);
  assert.deepEqual(d.all, [[48.85, -0.5011], [51.1009, 2.36]]);
  assert.deepEqual(heatmapMapData(segs, [[51.0, -0.6], [51.2, -0.4]]).fit, d.fit, 'nested bounds accepted');
  assert.deepEqual(heatmapMapData(segs, null).fit, d.all, 'no core bounds: fit everything');
  assert.equal(boundsOf([]), null);
});

test('scriptJson cannot close its script tag', () => {
  const s = scriptJson({ t: '</script><b>&\u2028' });
  assert.doesNotMatch(s, /[<>&\u2028]/);
  assert.deepEqual(JSON.parse(s), { t: '</script><b>&\u2028' });
});

const runFile = (/** @type {any} */ extra) => ({
  slug: 'x',
  category: 'cardio-distance',
  activity: { activityType: 'ACTIVITY_TYPE_RUN', title: 'Run', activityData: { sessions: [] } },
  entry: {},
  routePoints: line,
  ...extra,
});

test('activity view: routeMap for each state', () => {
  const map = buildActivityView(runFile({}), {}).act;
  assert.equal(map.routeMap.state, 'map');
  assert.ok(map.route);
  assert.deepEqual(JSON.parse(map.routeMap.json).line, line);

  const hidden = buildActivityView(runFile({ routeHidden: true }), {}).act;
  assert.deepEqual(hidden.routeMap, { state: 'hidden', label: 'route hidden near home' });
  assert.equal(hidden.route, null, 'a hidden route is never drawn, even with points');

  const indoor = buildActivityView(runFile({ routePoints: [] }), {}).act;
  assert.deepEqual(indoor.routeMap, { state: 'indoor', label: 'indoor — no route' });
  assert.equal(indoor.route, null);
});

test('assets task vendors Leaflet and the hashed script', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'route-map-'));
  const script = path.join(tmp, 'route-map.js');
  await fs.writeFile(script, '/* x */');
  const g = await runSkierTasks([routeMapAssetsTask({ outDir: path.join(tmp, 'out'), script, cacheHash: 'h1' })], {});
  assert.match(String(g.leafletVersion), /^\d+\.\d+\.\d+$/);
  const vendor = path.join(tmp, 'out', 'vendor', `leaflet-${g.leafletVersion}`);
  await fs.access(path.join(vendor, 'leaflet.js'));
  await fs.access(path.join(vendor, 'leaflet.css'));
  await fs.access(path.join(vendor, 'images', 'layers.png'));
  assert.equal(await fs.readFile(path.join(tmp, 'out', 'scripts', 'route-map.h1.js'), 'utf8'), '/* x */');
  await fs.rm(tmp, { recursive: true, force: true });
});
