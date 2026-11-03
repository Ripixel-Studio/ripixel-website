// @ts-check
// LH3.8: the §2.5 corrections. Pages are built from the committed fixtures, whose FitGlue
// `profile.subtitle` still carries the old HotPod text and whose facts hold site.started_year
// (2019) and a FitGlue start of 2023-05-14.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { generatePagesTask } from 'skier';

import { fetchFitnessTask } from './fitness-fetch.mjs';
import { fitnessLifeTask, whatIDo } from './fitness-life.mjs';
import { lifeHubTask } from './life-hub.mjs';
import { workViewTask } from './work-view.mjs';
import { templateHelpers } from './life-pages.mjs';
import { runSkierTasks } from './skier-test-runner.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixturesDir = path.join(REPO, 'fixtures', 'fitness');

/** @param {string} dir @returns {Promise<string[]>} */
async function htmlFiles(dir) {
  const out = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await htmlFiles(p)));
    else if (e.name.endsWith('.html')) out.push(p);
  }
  return out;
}

/** @type {string} */ let out;
/** @type {Map<string,string>} */ const pages = new Map();
/** @type {Record<string, any>} */ let globals;

before(async () => {
  out = await fs.mkdtemp(path.join(os.tmpdir(), 'corrections-'));
  globals = { siteUrl: 'https://james.ripixel.co.uk', cacheHash: 'test', year: 2026 };
  await runSkierTasks(
    [
      fetchFitnessTask({ source: 'fixtures', fixturesDir }),
      fitnessLifeTask({ now: new Date('2026-10-19T12:00:00Z') }),
      workViewTask(),
      lifeHubTask(),
      generatePagesTask({
        pagesDir: path.join(REPO, 'personal/pages'),
        partialsDir: path.join(REPO, 'personal/partials'),
        outDir: out,
        helpers: templateHelpers,
        additionalVarsFn: ({ currentPage }) => ({ page: currentPage === 'index' ? 'home' : currentPage }),
      }),
    ],
    globals,
    [],
  );
  for (const f of await htmlFiles(out)) pages.set(path.relative(out, f), await fs.readFile(f, 'utf8'));
});
after(async () => { await fs.rm(out, { recursive: true, force: true }); });

/** @param {RegExp} re */
const hits = (re) => [...pages].filter(([, html]) => re.test(html)).map(([f]) => f);

describe('corrections', () => {
  test('pages were built', () => {
    assert.ok(pages.has('index.html') && pages.has('projects.html'));
  });

  test('no HotPod', () => {
    assert.deepEqual(hits(/HotPod/i), []);
  });

  test('what I do is recent', () => {
    const now = new Date('2026-10-19T12:00:00Z');
    const day = 86_400_000;
    const at = (/** @type {number} */ n) => new Date(now.getTime() - n * day).toISOString();
    const acts = [
      ...Array.from({ length: 10 }, (_, i) => ({ activityType: 'ACTIVITY_TYPE_RUN', startTime: at(i + 1) })),
      ...Array.from({ length: 4 }, (_, i) => ({ activityType: 'ACTIVITY_TYPE_WEIGHT_TRAINING', startTime: at(i + 2) })),
      ...Array.from({ length: 5 }, (_, i) => ({ activityType: 'ACTIVITY_TYPE_YOGA', startTime: at(120 + i) })),
      { activityType: 'ACTIVITY_TYPE_SWIM', startTime: at(3) },
    ];
    const got = whatIDo(acts, now);
    assert.equal(got[0], 'Run');
    assert.ok(!got.includes('Yoga'), 'old yoga is gone');
    assert.ok(!got.includes('Swim'), 'one session is under the minimum');
    assert.deepEqual(got, ['Run', 'Weight Training']);
    assert.deepEqual(whatIDo([], now), []);
    assert.ok(whatIDo(Array.from({ length: 8 }, (_, k) => Array.from({ length: 2 }, (_, i) => ({ activityType: `ACTIVITY_TYPE_T${k}`, startTime: at(i + 1) }))).flat(), now).length <= 5);
  });

  test('what I do reaches the fitness page', () => {
    assert.ok(Array.isArray(globals.fitnessLife.stats.whatIDo));
    assert.equal('subtitle' in globals.fitnessLife.stats, false);
  });

  test('no false dates', () => {
    assert.deepEqual(hits(/est\. 2015|ESTABLISHED 2024/), []);
    assert.match(/** @type {string} */ (pages.get('index.html')), /site est\. 2019/);
  });

  test('no minimalist', () => {
    assert.deepEqual(hits(/minimalis/i), []);
  });

  test('fitglue year from git', () => {
    for (const f of ['index.html', 'projects.html']) {
      const html = /** @type {string} */ (pages.get(f));
      assert.match(html, /built 2023/, f);
      assert.doesNotMatch(html, /2024/, f);
    }
    assert.equal(globals.latestProjectDate, '2023 → present');
  });

  test('missing facts drop the claims rather than invent them', async () => {
    const g = { ...globals, lifeIndex: { ...globals.lifeIndex, facts: [] } };
    await runSkierTasks([lifeHubTask()], g, []);
    assert.equal(g.latestProjectDate, '');
    assert.equal(g.fitglueStartedYear, '');
  });

  test('orphans gone', () => {
    const files = execFileSync('git', ['ls-files', 'personal/items/life'], { cwd: REPO, encoding: 'utf8' }).split('\n').filter(Boolean);
    assert.deepEqual(files, ['personal/items/life/fitness.json']);
  });
});
