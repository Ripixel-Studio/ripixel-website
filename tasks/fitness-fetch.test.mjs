// @ts-check
// Run with `npm test` (node:test, no extra dependencies).
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadFitnessData, fetchFitnessTask, emptyIndex } from './fitness-fetch.mjs';

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
    if (headers['if-none-match'] === etag) return new Response(null, { status: 304 });
    try {
      const body = await fs.readFile(path.join(dir, rel), 'utf8');
      return new Response(body, { status: 200, headers: { etag, 'content-type': 'application/json' } });
    } catch {
      return new Response('missing', { status: 404 });
    }
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
    const r = await loadFitnessData({ env, baseUrl: BASE, cacheDir, fixturesDir: path.join(tmp, 'nope'), fetchImpl: impl });

    assert.equal(r.source, 'live');
    assert.equal(r.unavailable, false);
    assert.equal(r.activities.length, 3);
    assert.equal(r.roundups.length, 1);
    assert.deepEqual(
      r.activities.map((a) => a.slug),
      ['colwick-parkrun-2026-10-17', 'evening-ride-to-the-reservoir-2026-10-15', 'push-day-2026-10-13'],
    );
    assert.equal(r.activities[0].indexEntry.slug, 'colwick-parkrun-2026-10-17');
    assert.equal(r.activities[0].entry.showcaseId, 'colwick-parkrun-2026-10-17');
    assert.equal(r.roundups[0].key, 'week-42-2026');
    assert.equal(r.index.siteSlug, 'james');

    // index + 3 activities + 1 roundup + events.json
    assert.equal(calls.length, 6);
    assert.equal(r.events.events.length, 15);
    assert.equal(r.events.events[2].title, "Hyrox Birmingham - Open Men's Doubles");
    assert.equal(calls[0].url, `${BASE}/index.json`);
    const cached = await fs.readdir(cacheDir);
    assert.ok(cached.includes('index.json'));
    assert.ok(cached.includes('.meta.json'));
    assert.ok((await fs.readdir(path.join(cacheDir, 'activity'))).includes('push-day-2026-10-13.json'));
    assert.ok(cached.includes('events.json'));
  });

  test('a missing or malformed events.json is not fatal: fitnessEvents is null', async () => {
    const dir = path.join(tmp, 'src');
    await fs.cp(FIXTURES, dir, { recursive: true });
    await fs.rm(path.join(dir, 'events.json'));
    const { impl } = fakeFetch({ dir });
    const r = await loadFitnessData({ env, baseUrl: BASE, cacheDir, fixturesDir: path.join(tmp, 'nope'), fetchImpl: impl });
    assert.equal(r.source, 'live');
    assert.equal(r.events, null);
    assert.equal(r.activities.length, 3);

    await fs.writeFile(path.join(dir, 'events.json'), '{"generatedAt":"x"}');
    const r2 = await loadFitnessData({ env, baseUrl: BASE, cacheDir, fixturesDir: path.join(tmp, 'nope'), fetchImpl: fakeFetch({ dir }).impl });
    assert.equal(r2.events, null);
  });

  test('a live failure on events.json alone re-uses the cached copy', async () => {
    await loadFitnessData({ env, baseUrl: BASE, cacheDir, fixturesDir: path.join(tmp, 'nope'), fetchImpl: fakeFetch().impl });
    const { impl } = fakeFetch({ fail: ['events.json'] });
    const r = await loadFitnessData({ env, baseUrl: BASE, cacheDir, fixturesDir: path.join(tmp, 'nope'), fetchImpl: impl });
    assert.equal(r.source, 'live');
    assert.equal(r.events.events.length, 15);
  });

  test('second live run sends If-None-Match and reuses the cache on 304', async () => {
    const first = fakeFetch();
    await loadFitnessData({ env, baseUrl: BASE, cacheDir, fetchImpl: first.impl });
    const second = fakeFetch();
    const r = await loadFitnessData({ env, baseUrl: BASE, cacheDir, fetchImpl: second.impl });
    assert.equal(r.source, 'live');
    assert.equal(r.activities.length, 3);
    const conditional = second.calls.filter((c) => c.headers['if-none-match'] === '"v1"');
    assert.equal(conditional.length, 5); // every file except index.json
  });

  test('live failure falls back to the cache', async () => {
    await fs.cp(FIXTURES, cacheDir, { recursive: true });
    const { impl } = fakeFetch({ status: 404 });
    const r = await loadFitnessData({ env, baseUrl: BASE, cacheDir, fixturesDir: path.join(tmp, 'nope'), fetchImpl: impl });
    assert.equal(r.source, 'cache');
    assert.equal(r.unavailable, false);
    assert.equal(r.activities.length, 3);
    assert.match(r.notes[0], /^live .*HTTP 404/);
  });

  test('live failure with no cache falls back to fixtures', async () => {
    const { impl } = fakeFetch({ status: 503 });
    const r = await loadFitnessData({ env, baseUrl: BASE, cacheDir, fixturesDir: FIXTURES, fetchImpl: impl });
    assert.equal(r.source, 'fixtures');
    assert.equal(r.activities.length, 3);
    assert.equal(r.roundups.length, 1);
    assert.equal(r.notes.length, 2);
  });

  test('network exception on index is handled like any other live failure', async () => {
    const { impl } = fakeFetch({ fail: ['index.json'] });
    const r = await loadFitnessData({ env, baseUrl: BASE, cacheDir, fixturesDir: FIXTURES, fetchImpl: impl });
    assert.equal(r.source, 'fixtures');
  });

  test('nothing available: empty shapes and unavailable=true, never throws', async () => {
    const { impl } = fakeFetch({ status: 500 });
    const r = await loadFitnessData({ env, baseUrl: BASE, cacheDir, fixturesDir: path.join(tmp, 'nope'), fetchImpl: impl });
    assert.equal(r.source, 'none');
    assert.equal(r.unavailable, true);
    assert.deepEqual(r.activities, []);
    assert.deepEqual(r.roundups, []);
    assert.deepEqual(r.index, emptyIndex());
  });

  test('forced source=fixtures never touches the network', async () => {
    const { impl, calls } = fakeFetch();
    const r = await loadFitnessData({ env: { FITNESS_DATA_SOURCE: 'fixtures' }, baseUrl: BASE, cacheDir, fixturesDir: FIXTURES, fetchImpl: impl });
    assert.equal(r.source, 'fixtures');
    assert.equal(calls.length, 0);
  });

  test('forced source=live does not fall back when live fails', async () => {
    const { impl } = fakeFetch({ status: 404 });
    const r = await loadFitnessData({ env: { FITNESS_DATA_SOURCE: 'live' }, baseUrl: BASE, cacheDir, fixturesDir: FIXTURES, fetchImpl: impl });
    assert.equal(r.source, 'none');
    assert.equal(r.unavailable, true);
  });

  test('a listed file that is missing or unsafe is skipped, not fatal', async () => {
    const dir = path.join(tmp, 'src');
    await fs.cp(FIXTURES, dir, { recursive: true });
    const index = JSON.parse(await fs.readFile(path.join(dir, 'index.json'), 'utf8'));
    index.activities.push({ slug: 'ghost-2026-01-01', startTime: '2026-01-01T00:00:00Z' });
    index.activities.push({ slug: '../etc/passwd', startTime: '2026-01-01T00:00:00Z' });
    await fs.writeFile(path.join(dir, 'index.json'), JSON.stringify(index));
    const { impl, calls } = fakeFetch({ dir });
    const r = await loadFitnessData({ env, baseUrl: BASE, cacheDir, fetchImpl: impl });
    assert.equal(r.source, 'live');
    assert.equal(r.activities.length, 3);
    assert.ok(!calls.some((c) => c.url.includes('passwd')));
    // the cached index still lists 5, the activity dir has 3
    assert.equal((await fs.readdir(path.join(cacheDir, 'activity'))).length, 3);
  });
});

describe('fetchFitnessTask', () => {
  test('returns exactly the six globals and logs the source', async () => {
    const task = fetchFitnessTask({ env: { FITNESS_DATA_SOURCE: 'fixtures' }, fixturesDir: FIXTURES, cacheDir });
    /** @type {string[]} */
    const infos = [];
    const ctx = { debug: false, globals: {}, logger: { info: (m) => infos.push(m), warn() {}, error() {}, debug() {} } };
    const out = await task.run(task.config, ctx);
    assert.deepEqual(Object.keys(out).sort(), [
      'fitnessActivities', 'fitnessEvents', 'fitnessIndex', 'fitnessRoundups', 'fitnessSource', 'fitnessUnavailable',
    ]);
    assert.equal(out.fitnessEvents.events.length, 15);
    assert.equal(out.fitnessSource, 'fixtures');
    assert.equal(out.fitnessUnavailable, false);
    assert.equal(out.fitnessActivities.length, 3);
    assert.ok(infos.some((m) => m.includes('source=fixtures')));
  });
});
