// @ts-check
// Run with `npm test` (node:test, no extra dependencies).
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadFitnessData, fetchFitnessTask, emptyIndex, validatePeriod } from './fitness-fetch.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = path.join(REPO, 'fixtures', 'fitness');
const BASE = 'https://example.test/site/james';

/** Build a fetch stub that serves files from a directory (default: the repo fixtures). */
function fakeFetch({ dir = FIXTURES, status = 200, etag = '"v1"', fail = /** @type {string[]} */ ([]) } = {}) {
  /** @type {{ url: string, headers: Record<string, string> }[]} */
  const calls = [];
  /** @type {typeof fetch} */
  const impl = async (input, init) => {
    const url = String(input);
    const headers = Object.fromEntries(
      Object.entries((init && init.headers) || {}).map(([k, v]) => [k.toLowerCase(), String(v)]),
    );
    calls.push({ url, headers });
    const rel = url.slice(BASE.length + 1);
    if (fail.includes(rel)) throw new Error(`network down for ${rel}`);
    if (status !== 200) return new Response('nope', { status });
    let body;
    try {
      body = await fs.readFile(path.join(dir, rel), 'utf8');
    } catch {
      return new Response('missing', { status: 404 }); // a real server 404s before it considers If-None-Match
    }
    if (headers['if-none-match'] === etag) return new Response(null, { status: 304 });
    return new Response(body, { status: 200, headers: { etag, 'content-type': 'application/json' } });
  };
  return { impl, calls };
}

/** @type {string} */
let tmp;
/** @type {string} */
let cacheDir;
const env = {}; // never read the shell's FITNESS_* vars in tests

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'fitness-fetch-'));
  cacheDir = path.join(tmp, 'cache');
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('loadFitnessData', () => {
  test('live success: fetches everything, fills the cache, newest first with indexEntry', async () => {
    const { impl, calls } = fakeFetch();
    const r = await loadFitnessData({ retryDelayMs: 0, env, baseUrl: BASE, cacheDir, fixturesDir: path.join(tmp, 'nope'), fetchImpl: impl });

    assert.equal(r.source, 'live');
    assert.equal(r.unavailable, false);
    assert.equal(r.activities.length, 3);
    assert.equal(r.roundups.length, 2);
    assert.deepEqual(
      r.activities.map((a) => a.slug),
      ['colwick-parkrun-2026-10-17', 'evening-ride-to-the-reservoir-2026-10-15', 'push-day-2026-10-13'],
    );
    assert.equal(r.activities[0].indexEntry.slug, 'colwick-parkrun-2026-10-17');
    assert.equal(r.activities[0].entry.showcaseId, 'colwick-parkrun-2026-10-17');
    assert.equal(r.roundups[0].key, 'week-42-2026');
    assert.equal(r.index.siteSlug, 'james');

    // index + 3 activities + 2 roundups + events.json + life/index.json + life/heatmap.json + 2 period sidecars
    assert.equal(calls.length, 11);
    assert.equal(r.events.events.length, 15);
    assert.equal(r.events.events[2].title, "Hyrox Birmingham - Open Men's Doubles");
    assert.equal(calls[0].url, `${BASE}/index.json`);
    const cached = await fs.readdir(cacheDir);
    assert.ok(cached.includes('index.json'));
    assert.ok(cached.includes('.meta.json'));
    assert.ok((await fs.readdir(path.join(cacheDir, 'activity'))).includes('push-day-2026-10-13.json'));
    assert.ok(cached.includes('events.json'));
    assert.ok((await fs.readdir(path.join(cacheDir, 'life'))).includes('index.json'));
    assert.ok((await fs.readdir(path.join(cacheDir, 'life'))).includes('heatmap.json'));
  });

  test('a missing or malformed events.json is not fatal: fitnessEvents is null', async () => {
    const dir = path.join(tmp, 'src');
    await fs.cp(FIXTURES, dir, { recursive: true });
    await fs.rm(path.join(dir, 'events.json'));
    const { impl } = fakeFetch({ dir });
    const r = await loadFitnessData({ retryDelayMs: 0, env, baseUrl: BASE, cacheDir, fixturesDir: path.join(tmp, 'nope'), fetchImpl: impl });
    assert.equal(r.source, 'live');
    assert.equal(r.events, null);
    assert.equal(r.activities.length, 3);

    await fs.writeFile(path.join(dir, 'events.json'), '{"generatedAt":"x"}');
    const r2 = await loadFitnessData({ retryDelayMs: 0, env, baseUrl: BASE, cacheDir, fixturesDir: path.join(tmp, 'nope'), fetchImpl: fakeFetch({ dir }).impl });
    assert.equal(r2.events, null);
  });

  test('a live failure on events.json alone re-uses the cached copy', async () => {
    await loadFitnessData({ retryDelayMs: 0, env, baseUrl: BASE, cacheDir, fixturesDir: path.join(tmp, 'nope'), fetchImpl: fakeFetch().impl });
    const { impl } = fakeFetch({ fail: ['events.json'] });
    const r = await loadFitnessData({ retryDelayMs: 0, env, baseUrl: BASE, cacheDir, fixturesDir: path.join(tmp, 'nope'), fetchImpl: impl });
    assert.equal(r.source, 'live');
    assert.equal(r.events.events.length, 15);
  });

  test('second live run sends If-None-Match and reuses the cache on 304', async () => {
    const first = fakeFetch();
    await loadFitnessData({ retryDelayMs: 0, env, baseUrl: BASE, cacheDir, fetchImpl: first.impl });
    const second = fakeFetch();
    const r = await loadFitnessData({ retryDelayMs: 0, env, baseUrl: BASE, cacheDir, fetchImpl: second.impl });
    assert.equal(r.source, 'live');
    assert.equal(r.activities.length, 3);
    const conditional = second.calls.filter((c) => c.headers['if-none-match'] === '"v1"');
    assert.equal(conditional.length, 10); // every file except index.json
  });

  test('live failure falls back to the cache', async () => {
    await fs.cp(FIXTURES, cacheDir, { recursive: true });
    const { impl } = fakeFetch({ status: 404 });
    const r = await loadFitnessData({ retryDelayMs: 0, env, baseUrl: BASE, cacheDir, fixturesDir: path.join(tmp, 'nope'), fetchImpl: impl });
    assert.equal(r.source, 'cache');
    assert.equal(r.unavailable, false);
    assert.equal(r.activities.length, 3);
    assert.match(r.notes[0], /^live .*HTTP 404/);
  });

  test('live failure with no cache falls back to fixtures', async () => {
    const { impl } = fakeFetch({ status: 503 });
    const r = await loadFitnessData({ retryDelayMs: 0, env, baseUrl: BASE, cacheDir, fixturesDir: FIXTURES, fetchImpl: impl });
    assert.equal(r.source, 'fixtures');
    assert.equal(r.activities.length, 3);
    assert.equal(r.roundups.length, 2);
    assert.equal(r.notes.length, 2);
  });

  test('network exception on index is handled like any other live failure', async () => {
    const { impl } = fakeFetch({ fail: ['index.json'] });
    const r = await loadFitnessData({ retryDelayMs: 0, env, baseUrl: BASE, cacheDir, fixturesDir: FIXTURES, fetchImpl: impl });
    assert.equal(r.source, 'fixtures');
  });

  test('nothing available: empty shapes and unavailable=true, never throws', async () => {
    const { impl } = fakeFetch({ status: 500 });
    const r = await loadFitnessData({ retryDelayMs: 0, env, baseUrl: BASE, cacheDir, fixturesDir: path.join(tmp, 'nope'), fetchImpl: impl });
    assert.equal(r.source, 'none');
    assert.equal(r.unavailable, true);
    assert.deepEqual(r.activities, []);
    assert.deepEqual(r.roundups, []);
    assert.deepEqual(r.index, emptyIndex());
  });

  test('forced source=fixtures never touches the network', async () => {
    const { impl, calls } = fakeFetch();
    const r = await loadFitnessData({ retryDelayMs: 0, env: { FITNESS_DATA_SOURCE: 'fixtures' }, baseUrl: BASE, cacheDir, fixturesDir: FIXTURES, fetchImpl: impl });
    assert.equal(r.source, 'fixtures');
    assert.equal(calls.length, 0);
  });

  test('forced source=live does not fall back when live fails', async () => {
    const { impl } = fakeFetch({ status: 404 });
    const r = await loadFitnessData({ retryDelayMs: 0, env: { FITNESS_DATA_SOURCE: 'live' }, baseUrl: BASE, cacheDir, fixturesDir: FIXTURES, fetchImpl: impl });
    assert.equal(r.source, 'none');
    assert.equal(r.unavailable, true);
  });

  test('live retries once before giving up (a slow link timed the index out, 2026-11-04)', async () => {
    const { impl: good } = fakeFetch();
    let indexCalls = 0;
    /** @type {typeof fetch} */
    const flaky = async (input, init) => {
      if (String(input).endsWith('/index.json') && !String(input).includes('/life/') && indexCalls++ === 0) {
        throw new Error('The operation was aborted due to timeout');
      }
      return good(input, init);
    };
    const r = await loadFitnessData({ retryDelayMs: 0, env: { FITNESS_DATA_SOURCE: 'live' }, baseUrl: BASE, cacheDir, fixturesDir: FIXTURES, fetchImpl: flaky });
    assert.equal(r.source, 'live');
    assert.equal(r.activities.length, 3);
    assert.equal(indexCalls, 2);
  });

  test('a listed file that is missing or unsafe is skipped, not fatal', async () => {
    const dir = path.join(tmp, 'src');
    await fs.cp(FIXTURES, dir, { recursive: true });
    const index = JSON.parse(await fs.readFile(path.join(dir, 'index.json'), 'utf8'));
    index.activities.push({ slug: 'ghost-2026-01-01', startTime: '2026-01-01T00:00:00Z' });
    index.activities.push({ slug: '../etc/passwd', startTime: '2026-01-01T00:00:00Z' });
    await fs.writeFile(path.join(dir, 'index.json'), JSON.stringify(index));
    const { impl, calls } = fakeFetch({ dir });
    const r = await loadFitnessData({ retryDelayMs: 0, env, baseUrl: BASE, cacheDir, fetchImpl: impl });
    assert.equal(r.source, 'live');
    assert.equal(r.activities.length, 3);
    assert.ok(!calls.some((c) => c.url.includes('passwd')));
    // the cached index still lists 5, the activity dir has 3
    assert.equal((await fs.readdir(path.join(cacheDir, 'activity'))).length, 3);
  });
});

describe('life docs', () => {
  const opts = () => ({ env, baseUrl: BASE, cacheDir, fixturesDir: path.join(tmp, 'nope') });

  test('life index read from fixtures', async () => {
    const r = await loadFitnessData({ retryDelayMs: 0, env, source: 'fixtures', fixturesDir: FIXTURES, cacheDir });
    assert.ok(r.lifeIndex.sections.watching);
    assert.ok(r.lifeIndex.sections.work);
    assert.ok(r.lifeHeatmap.segments.length > 0);
  });

  test('life docs optional: no life/ dir gives null and fitness is unchanged', async () => {
    const dir = path.join(tmp, 'src');
    await fs.cp(FIXTURES, dir, { recursive: true });
    await fs.rm(path.join(dir, 'life'), { recursive: true });
    const r = await loadFitnessData({ retryDelayMs: 0, env, source: 'fixtures', fixturesDir: dir, cacheDir });
    assert.equal(r.lifeIndex, null);
    assert.equal(r.lifeHeatmap, null);
    assert.equal(r.unavailable, false);
    assert.equal(r.activities.length, 3);
    assert.equal(r.roundups.length, 2);
    assert.equal(r.events.events.length, 15);
  });

  test('invalid life doc ignored with one warning', async () => {
    const dir = path.join(tmp, 'src');
    await fs.cp(FIXTURES, dir, { recursive: true });
    const doc = JSON.parse(await fs.readFile(path.join(dir, 'life', 'index.json'), 'utf8'));
    doc.schemaVersion = 2;
    await fs.writeFile(path.join(dir, 'life', 'index.json'), JSON.stringify(doc));
    /** @type {string[]} */
    const warns = [];
    const logger = { info() {}, warn: (m) => warns.push(m), error() {}, debug() {} };
    const r = await loadFitnessData({ retryDelayMs: 0, env, source: 'fixtures', fixturesDir: dir, cacheDir, logger });
    assert.equal(r.lifeIndex, null);
    assert.ok(r.lifeHeatmap);
    assert.equal(warns.length, 1);
  });

  test('a malformed heatmap is ignored', async () => {
    const dir = path.join(tmp, 'src');
    await fs.cp(FIXTURES, dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'life', 'heatmap.json'), '{"segments":[[[1,"x"]]]}');
    const r = await loadFitnessData({ retryDelayMs: 0, env, source: 'fixtures', fixturesDir: dir, cacheDir });
    assert.equal(r.lifeHeatmap, null);
    assert.ok(r.lifeIndex);
  });

  test('live 404 falls back to cache', async () => {
    await loadFitnessData({ retryDelayMs: 0, ...opts(), fetchImpl: fakeFetch().impl });
    // a bucket without life/ yet: every life request 404s
    const dir = path.join(tmp, 'nolife');
    await fs.cp(FIXTURES, dir, { recursive: true });
    await fs.rm(path.join(dir, 'life'), { recursive: true });
    const r = await loadFitnessData({ retryDelayMs: 0, ...opts(), fetchImpl: fakeFetch({ dir }).impl });
    assert.equal(r.source, 'live');
    assert.ok(r.lifeIndex.sections.watching);
    assert.ok(r.lifeHeatmap.segments.length > 0);
  });

  test('live 404 with no cache gives null, not a failure', async () => {
    const dir = path.join(tmp, 'nolife');
    await fs.cp(FIXTURES, dir, { recursive: true });
    await fs.rm(path.join(dir, 'life'), { recursive: true });
    const r = await loadFitnessData({ retryDelayMs: 0, ...opts(), fetchImpl: fakeFetch({ dir }).impl });
    assert.equal(r.source, 'live');
    assert.equal(r.lifeIndex, null);
    assert.equal(r.lifeHeatmap, null);
  });
});

describe('period sidecars', () => {
  const opts = () => ({ env, baseUrl: BASE, cacheDir, fixturesDir: path.join(tmp, 'nope') });
  const mkLogger = (/** @type {string[]} */ warns) => ({ info() {}, warn: (m) => warns.push(m), error() {}, debug() {} });

  test('period sidecars keyed by roundup', async () => {
    // fixtures: the orphan (week-30-2026) has a file but no roundup, so it is never read
    const r = await loadFitnessData({ retryDelayMs: 0, env, source: 'fixtures', fixturesDir: FIXTURES, cacheDir });
    assert.deepEqual(Object.keys(r.lifePeriods).sort(), ['month-09-2026', 'week-42-2026']);
    assert.equal(r.lifePeriods['week-42-2026'].watching.notable[0].title, 'The Invented Harbour');
    // live: only roundup keys are requested
    const { impl, calls } = fakeFetch();
    const live = await loadFitnessData({ retryDelayMs: 0, ...opts(), fetchImpl: impl });
    assert.deepEqual(Object.keys(live.lifePeriods).sort(), ['month-09-2026', 'week-42-2026']);
    assert.deepEqual(
      calls.filter((c) => c.url.includes('/life/period/')).map((c) => c.url.slice(BASE.length + 1)).sort(),
      ['life/period/month-09-2026.json', 'life/period/week-42-2026.json'],
    );
    assert.ok((await fs.readdir(path.join(cacheDir, 'life', 'period'))).includes('week-42-2026.json'));
    // and the cache source reads them back
    const cached = await loadFitnessData({ retryDelayMs: 0, env, source: 'cache', cacheDir });
    assert.deepEqual(Object.keys(cached.lifePeriods).sort(), ['month-09-2026', 'week-42-2026']);
  });

  test('missing sidecar is fine', async () => {
    const dir = path.join(tmp, 'src');
    await fs.cp(FIXTURES, dir, { recursive: true });
    await fs.rm(path.join(dir, 'life', 'period', 'month-09-2026.json'));
    const warns = /** @type {string[]} */ ([]);
    const logger = mkLogger(warns);
    const live = await loadFitnessData({ retryDelayMs: 0, ...opts(), fetchImpl: fakeFetch({ dir }).impl, logger });
    assert.equal(live.source, 'live');
    assert.deepEqual(Object.keys(live.lifePeriods), ['week-42-2026']);
    assert.equal(live.roundups.length, 2);
    const fx = await loadFitnessData({ retryDelayMs: 0, env, source: 'fixtures', fixturesDir: dir, cacheDir, logger });
    assert.deepEqual(Object.keys(fx.lifePeriods), ['week-42-2026']);
    assert.deepEqual(warns, []);
    // no life/period dir at all: empty object, nothing else changes
    await fs.rm(path.join(dir, 'life', 'period'), { recursive: true });
    const none = await loadFitnessData({ retryDelayMs: 0, env, source: 'fixtures', fixturesDir: dir, cacheDir, logger });
    assert.deepEqual(none.lifePeriods, {});
    assert.equal(none.roundups.length, 2);
    assert.deepEqual(warns, []);
  });

  test('mismatched key rejected', async () => {
    const dir = path.join(tmp, 'src');
    await fs.cp(FIXTURES, dir, { recursive: true });
    const f = path.join(dir, 'life', 'period', 'week-42-2026.json');
    const doc = JSON.parse(await fs.readFile(f, 'utf8'));
    doc.key = 'week-41-2026';
    await fs.writeFile(f, JSON.stringify(doc));
    const warns = /** @type {string[]} */ ([]);
    const r = await loadFitnessData({ retryDelayMs: 0, env, source: 'fixtures', fixturesDir: dir, cacheDir, logger: mkLogger(warns) });
    assert.deepEqual(Object.keys(r.lifePeriods), ['month-09-2026']);
    assert.equal(warns.length, 1);
    assert.match(warns[0], /week-42-2026/);
    const live = await loadFitnessData({ retryDelayMs: 0, ...opts(), fetchImpl: fakeFetch({ dir }).impl, logger: mkLogger([]) });
    assert.deepEqual(Object.keys(live.lifePeriods), ['month-09-2026']);
  });

  test('validatePeriod needs schemaVersion 1 and the same key', () => {
    assert.equal(validatePeriod({ schemaVersion: 1, key: 'a' }, 'a')?.key, 'a');
    assert.equal(validatePeriod({ schemaVersion: 2, key: 'a' }, 'a'), null);
    assert.equal(validatePeriod(null, 'a'), null);
  });

  test('a live failure on one sidecar re-uses its cached copy', async () => {
    await loadFitnessData({ retryDelayMs: 0, ...opts(), fetchImpl: fakeFetch().impl });
    const r = await loadFitnessData({ retryDelayMs: 0, ...opts(), fetchImpl: fakeFetch({ fail: ['life/period/week-42-2026.json'] }).impl });
    assert.deepEqual(Object.keys(r.lifePeriods).sort(), ['month-09-2026', 'week-42-2026']);
  });

  test('a clean 404 on a sidecar clears its cached copy and meta entry', async () => {
    await loadFitnessData({ retryDelayMs: 0, ...opts(), fetchImpl: fakeFetch().impl });
    const cachedFile = path.join(cacheDir, 'life', 'period', 'week-42-2026.json');
    await fs.access(cachedFile);
    const dir = path.join(tmp, 'withdrawn');
    await fs.cp(FIXTURES, dir, { recursive: true });
    await fs.rm(path.join(dir, 'life', 'period', 'week-42-2026.json'));
    const warns = /** @type {string[]} */ ([]);
    const r = await loadFitnessData({ retryDelayMs: 0, ...opts(), fetchImpl: fakeFetch({ dir }).impl, logger: mkLogger(warns) });
    assert.deepEqual(Object.keys(r.lifePeriods), ['month-09-2026']);
    await assert.rejects(fs.access(cachedFile));
    const meta = JSON.parse(await fs.readFile(path.join(cacheDir, '.meta.json'), 'utf8'));
    assert.equal(meta['life/period/week-42-2026.json'], undefined);
    assert.deepEqual(warns, []);
    // the cache source no longer shows it either
    const c = await loadFitnessData({ retryDelayMs: 0, env, source: 'cache', cacheDir });
    assert.deepEqual(Object.keys(c.lifePeriods), ['month-09-2026']);
  });

  test('a 5xx on a sidecar falls back to the cached copy', async () => {
    await loadFitnessData({ retryDelayMs: 0, ...opts(), fetchImpl: fakeFetch().impl });
    const base = fakeFetch().impl;
    /** @type {typeof fetch} */
    const flaky = async (input, init) =>
      String(input).endsWith('/life/period/week-42-2026.json') ? new Response('boom', { status: 503 }) : base(input, init);
    const warns = /** @type {string[]} */ ([]);
    const r = await loadFitnessData({ retryDelayMs: 0, ...opts(), fetchImpl: flaky, logger: mkLogger(warns) });
    assert.deepEqual(Object.keys(r.lifePeriods).sort(), ['month-09-2026', 'week-42-2026']);
    assert.equal(warns.length, 1);
    await fs.access(path.join(cacheDir, 'life', 'period', 'week-42-2026.json'));
  });
});

describe('fetchFitnessTask', () => {
  test('a forced source that fails fails the build (2026-11-04: an empty site was deployed)', async () => {
    const task = fetchFitnessTask({ env: { FITNESS_DATA_SOURCE: 'live' }, baseUrl: BASE, cacheDir, fixturesDir: FIXTURES, fetchImpl: fakeFetch({ status: 503 }).impl, retryDelayMs: 0 });
    const ctx = { debug: false, globals: {}, logger: { info() {}, warn() {}, error() {}, debug() {} } };
    await assert.rejects(() => task.run(task.config, ctx), /FITNESS_DATA_SOURCE=live.*unavailable/);
  });

  test('without a forced source a failure still builds from the fallbacks', async () => {
    const task = fetchFitnessTask({ env: {}, baseUrl: BASE, cacheDir, fixturesDir: FIXTURES, fetchImpl: fakeFetch({ status: 503 }).impl, retryDelayMs: 0 });
    const ctx = { debug: false, globals: {}, logger: { info() {}, warn() {}, error() {}, debug() {} } };
    const out = await task.run(task.config, ctx);
    assert.equal(out.fitnessSource, 'fixtures');
  });

  test('returns exactly the nine globals and logs the source', async () => {
    const task = fetchFitnessTask({ env: { FITNESS_DATA_SOURCE: 'fixtures' }, fixturesDir: FIXTURES, cacheDir });
    /** @type {string[]} */
    const infos = [];
    const ctx = { debug: false, globals: {}, logger: { info: (m) => infos.push(m), warn() {}, error() {}, debug() {} } };
    const out = await task.run(task.config, ctx);
    assert.deepEqual(Object.keys(out).sort(), [
      'fitnessActivities', 'fitnessEvents', 'fitnessIndex', 'fitnessRoundups', 'fitnessSource', 'fitnessUnavailable',
      'lifeHeatmap', 'lifeIndex', 'lifePeriods',
    ]);
    assert.ok(out.lifeIndex.sections.watching);
    assert.ok(out.lifeHeatmap.segments.length > 0);
    assert.equal(out.fitnessEvents.events.length, 15);
    assert.equal(out.fitnessSource, 'fixtures');
    assert.equal(out.fitnessUnavailable, false);
    assert.equal(out.fitnessActivities.length, 3);
    assert.ok(infos.some((m) => m.includes('source=fixtures')));
  });
});
