// @ts-check
// Run with `npm test` (node:test, no extra dependencies).
//
// The /life URL inventory (LH3.6). /life became the hub and the zine moved to
// /life/fitness; every URL that existed before still builds, and the hub links
// all nine sections. Builds the /life pages from the committed fixtures into a
// temp dir with the same Skier builtins the site uses (lifePageTasks plus a
// personal-pages generatePagesTask), so it never races life-links.test.mjs,
// which builds the whole site into public/personal.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generatePagesTask } from 'skier';

import { fetchFitnessTask } from './fitness-fetch.mjs';
import { lifeHeatmapTask } from './life-heatmap.mjs';
import { fitnessLifeTask } from './fitness-life.mjs';
import { lifeHubTask, SECTION_ORDER } from './life-hub.mjs';
import { fitnessActivityViewsTask } from './fitness-activity-views.mjs';
import { fitnessEventViewsTask, eventOutPath } from './fitness-event-views.mjs';
import { fitnessSessionsViewTask } from './fitness-sessions.mjs';
import { fitnessRoundupViewsTask } from './fitness-roundup-views.mjs';
import { fitnessFeedItemsTask } from './fitness-feed-items.mjs';
import { lifePageTasks, templateHelpers } from './life-pages.mjs';
import { runSkierTasks } from './skier-test-runner.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://james.ripixel.co.uk';
const SECTIONS = SECTION_ORDER.filter((n) => n !== 'fitness');

/** @param {string} out @param {Record<string, unknown>} [extra] globals to set before the page tasks */
async function build(out, extra = {}) {
  /** @type {Record<string, any>} */
  const globals = { siteUrl: SITE, cacheHash: 'test', year: 2026 };
  const logs = /** @type {string[]} */ ([]);
  await runSkierTasks([fetchFitnessTask({ source: 'fixtures', fixturesDir: path.join(REPO, 'fixtures', 'fitness') })], globals, logs);
  Object.assign(globals, extra);
  await runSkierTasks(
    [
      lifeHeatmapTask(),
      fitnessLifeTask(),
      lifeHubTask(),
      fitnessActivityViewsTask(),
      fitnessEventViewsTask(),
      fitnessSessionsViewTask(),
      fitnessRoundupViewsTask(),
      fitnessFeedItemsTask(),
      ...lifePageTasks({
        outDir: out,
        siteUrl: SITE,
        pagesDir: path.join(REPO, 'personal/pages/life'),
        partialsDir: path.join(REPO, 'personal/partials'),
        templatesDir: path.join(REPO, 'personal/templates'),
      }),
      generatePagesTask({
        pagesDir: path.join(REPO, 'personal/pages'),
        partialsDir: path.join(REPO, 'personal/partials'),
        outDir: out,
        helpers: templateHelpers,
        additionalVarsFn: ({ currentPage }) => ({ page: currentPage === 'index' ? 'home' : currentPage }),
      }),
    ],
    globals,
    logs,
  );
  return globals;
}

describe('/life URL inventory', () => {
  /** @type {string} */ let out;
  /** @type {Record<string, any>} */ let g;
  const read = (/** @type {string} */ rel) => fs.readFile(path.join(out, rel), 'utf8');
  const exists = (/** @type {string} */ rel) => fs.access(path.join(out, rel)).then(() => true, () => false);

  before(async () => {
    out = await fs.mkdtemp(path.join(os.tmpdir(), 'life-urls-'));
    g = await build(out);
  }, { timeout: 120_000 });
  after(() => fs.rm(out, { recursive: true, force: true }));

  test('every old URL still built', async () => {
    const slug = g.fitnessIndex.activities[0].slug;
    const key = g.fitnessIndex.roundups[0].key;
    // The fixtures hold no Hyrox race weekend, so no event page builds from them; the
    // event route is pinned by its path builder instead (fitness-hyrox.test.mjs
    // renders a synthetic weekend).
    const ev = g.fitnessEventPages[0]?.ev?.slug;
    assert.equal(eventOutPath('x'), 'life/event/x/index.html');
    for (const rel of [
      'life.html',
      'life/roundups.html',
      'life/sessions.html',
      `life/activity/${slug}/index.html`,
      `life/roundup/${key}.html`,
      ...(ev ? [`life/event/${ev}/index.html`] : []),
      'life/feed.xml',
    ]) {
      assert.ok(await exists(rel), rel);
    }
  });

  test('every new section page built', async () => {
    for (const name of ['fitness', ...SECTIONS]) assert.ok(await exists(`life/${name}.html`), name);
  });

  test('hub links every section', async () => {
    const hub = await read('life.html');
    for (const name of SECTION_ORDER) assert.ok(hub.includes(`href="/life/${name}"`), name);
  });

  test('fitness keeps the zine', async () => {
    const html = await read('life/fitness.html');
    const title = g.fitnessLife.activities[0].title;
    assert.ok(html.includes(title), title);
    assert.match(html, /<svg[^>]*class="life-heatmap__map"/);
  });

  test('stale label rendered', async () => {
    assert.equal(g.lifeIndex.sections.reading.staleDays, 4);
    assert.match(await read('life/reading.html'), /last updated 4 days ago/);
    assert.match(await read('life.html'), /last updated 4 days ago/);
  });

  test('a section page has its chart, its numbers and its own title', async () => {
    const html = await read('life/body.html');
    assert.match(html, /<title>[^<]*body/i);
    assert.match(html, /<path d="M0 [^"]+"/);
    assert.match(html, /80\.1/);
  });

  test('the old zine links point at /life/fitness', async () => {
    const slug = g.fitnessIndex.activities[0].slug;
    assert.match(await read(`life/activity/${slug}/index.html`), /href="\/life\/fitness"/);
  });
});

describe('/life without a life export', () => {
  test('the hub and every section say plainly that nothing has come through', async () => {
    const out = await fs.mkdtemp(path.join(os.tmpdir(), 'life-urls-empty-'));
    try {
      await build(out, { lifeIndex: null, lifeHeatmap: null });
      const hub = await fs.readFile(path.join(out, 'life.html'), 'utf8');
      for (const name of SECTION_ORDER) assert.ok(hub.includes(`href="/life/${name}"`), name);
      for (const name of SECTIONS) {
        const html = await fs.readFile(path.join(out, 'life', `${name}.html`), 'utf8');
        assert.match(html, /No [a-z]+ data yet/, name);
      }
      assert.doesNotMatch(await fs.readFile(path.join(out, 'life', 'fitness.html'), 'utf8'), /class="life-heatmap__map"/);
    } finally {
      await fs.rm(out, { recursive: true, force: true });
    }
  });
});
