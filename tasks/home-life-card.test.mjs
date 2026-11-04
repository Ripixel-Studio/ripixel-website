// @ts-check
// Homepage "life." card in "inside this issue": title, link to the hub, blurb from the hub's sections.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generatePagesTask } from 'skier';

import { fetchFitnessTask } from './fitness-fetch.mjs';
import { workViewTask } from './work-view.mjs';
import { lifeHubTask, homeLifeGlobals } from './life-hub.mjs';
import { templateHelpers } from './life-pages.mjs';
import { runSkierTasks } from './skier-test-runner.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('homeLifeGlobals: blurb lists the hub sections; footer falls back to nothing', () => {
  const g = homeLifeGlobals({ cards: [{ title: 'Fitness' }, { title: 'Body' }, { title: 'Games' }], live: [] });
  assert.equal(g.lifeBlurb, 'James, by the numbers: fitness, body and games, all gathered automatically.');
  assert.equal(g.lifeLatest, '');
  assert.ok(!/fitglue/i.test(g.lifeBlurb));
});

test('built homepage: Life card links to /life, blurb has no FitGlue', async () => {
  const out = await fs.mkdtemp(path.join(os.tmpdir(), 'home-life-'));
  try {
    /** @type {Record<string, any>} */
    const globals = { siteUrl: 'https://james.ripixel.co.uk', cacheHash: 'test', year: 2026 };
    await runSkierTasks([fetchFitnessTask({ source: 'fixtures', fixturesDir: path.join(REPO, 'fixtures', 'fitness') })], globals, []);
    await runSkierTasks([
      lifeHubTask(), workViewTask(),
      generatePagesTask({
        pagesDir: path.join(REPO, 'personal/pages'), partialsDir: path.join(REPO, 'personal/partials'), outDir: out,
        helpers: templateHelpers,
        additionalVarsFn: ({ currentPage }) => ({ page: currentPage === 'index' ? 'home' : currentPage }),
      }),
    ], globals, []);
    const html = await fs.readFile(path.join(out, 'index.html'), 'utf8');
    const m = /<a class="section-card section-card--fitness" href="([^"]*)">([\s\S]*?)<\/a>/.exec(html);
    assert.ok(m, 'life card present');
    assert.equal(m[1], '/life');
    assert.ok(m[2].includes('>life.<'));
    assert.ok(m[2].includes('△ LIFE'));
    assert.ok(m[2].includes('James, by the numbers: fitness, body, games, code, watching, listening, reading and live'));
    assert.ok(!/fitglue/i.test(m[2]));
    assert.equal((html.match(/class="section-card section-card--/g) || []).length, 4);
    assert.ok(html.includes('4 sections'));
  } finally {
    await fs.rm(out, { recursive: true, force: true });
  }
}, { timeout: 120_000 });
