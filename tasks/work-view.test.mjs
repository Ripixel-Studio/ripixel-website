// @ts-check
// /work (LH3.7): the view model, and the built page from the committed fixtures.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generatePagesTask } from 'skier';

import { fetchFitnessTask } from './fitness-fetch.mjs';
import { workViewTask, buildWorkView } from './work-view.mjs';
import { templateHelpers } from './life-pages.mjs';
import { runSkierTasks } from './skier-test-runner.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = JSON.parse(await fs.readFile(path.join(REPO, 'fixtures/fitness/life/index.json'), 'utf8'));
const work = fixture.sections.work;

/** @param {string} out @param {any} [workOverride] */
async function build(out, workOverride) {
  /** @type {Record<string, any>} */
  const globals = { siteUrl: 'https://james.ripixel.co.uk', cacheHash: 'test', year: 2026 };
  await runSkierTasks([fetchFitnessTask({ source: 'fixtures', fixturesDir: path.join(REPO, 'fixtures', 'fitness') })], globals, []);
  if (workOverride) globals.lifeIndex = { ...globals.lifeIndex, sections: { ...globals.lifeIndex.sections, work: workOverride } };
  await runSkierTasks(
    [
      workViewTask(),
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
  return globals;
}

describe('buildWorkView', () => {
  test('stats from data', () => {
    const v = /** @type {any} */ (buildWorkView(work));
    assert.deepEqual(v.stats, [
      { num: '11', label: 'years shipping' },
      { num: '4', label: 'employers' },
      { num: '1', label: 'contracting stint' },
      { num: String(work.stats.technologies), label: 'technologies' },
    ]);
    const two = /** @type {any} */ (buildWorkView({ ...work, stats: { ...work.stats, contracting: 2 } }));
    assert.equal(two.stats[2].label, 'contracting stints');
  });

  test('badges run 001 = newest, current is the open role', () => {
    const v = /** @type {any} */ (buildWorkView(work));
    assert.equal(v.roles.length, 7);
    assert.equal(v.roles[0].badge, '001');
    assert.equal(v.roles[6].badge, '007');
    assert.deepEqual(v.roles.map((r) => r.current), [true, false, false, false, false, false, false]);
    // the same company keeps one ink
    const sky = v.roles.filter((r) => r.company.startsWith('Sky'));
    assert.equal(sky.length, 2);
    assert.equal(sky[0].ink, sky[1].ink);
  });

  test('education says studied, not completed', () => {
    const v = /** @type {any} */ (buildWorkView(work));
    assert.equal(v.education.status, 'studied, not completed');
    assert.equal(buildWorkView({ ...work, education: { ...work.education, completed: true } })?.education?.status, 'completed');
  });

  test('roster marks current and lapsed', () => {
    const v = /** @type {any} */ (buildWorkView({ ...work, roster: [{ name: 'go', current: true }, { name: 'php', current: false }] }));
    assert.deepEqual(v.roster.map((t) => t.mark), ['★', '☆']);
  });

  test('no work section, no view', () => {
    assert.equal(buildWorkView(null), null);
    assert.equal(buildWorkView({ roles: [] }), null);
  });

  test('salary table only when work.salary exists, matched by id', () => {
    assert.equal(/** @type {any} */ (buildWorkView(work)).salary, null);
    const salary = [
      { id: 'fx-role-7', gbp: 100000, delta: 10000, deltaPct: 11.1 },
      { id: 'fx-role-6', gbp: 90000, delta: -5000, deltaPct: -5.3 },
      { id: 'nope', gbp: 1, delta: 0, deltaPct: 0 },
    ];
    const v = /** @type {any} */ (buildWorkView({ ...work, salary }));
    assert.equal(v.salary.length, 2);
    assert.equal(v.salary[0].company, 'Monzo');
    assert.equal(v.salary[0].salary, '£100,000');
    assert.equal(v.salary[0].delta, '+£10,000');
    assert.equal(v.salary[0].deltaPct, '+11.1%');
    assert.equal(v.salary[1].delta, '−£5,000');
    assert.equal(v.salary[1].dir, 'down');
  });
});

describe('built /work page', () => {
  /** @type {string} */ let out;
  /** @type {string} */ let html;
  before(async () => {
    out = await fs.mkdtemp(path.join(os.tmpdir(), 'work-'));
    await build(out);
    html = await fs.readFile(path.join(out, 'work.html'), 'utf8');
  }, { timeout: 120_000 });
  after(() => fs.rm(out, { recursive: true, force: true }));

  test('stats beside their labels', () => {
    assert.match(html, /stat-strip__num">4<\/div>\s*<div class="stat-strip__label">employers/);
    assert.match(html, /stat-strip__num">11<\/div>\s*<div class="stat-strip__label">years shipping/);
  });

  test('sky split: two role cards say SKY BETTING', () => {
    const cards = html.split('<article class="role-card').slice(1).filter((c) => c.includes('SKY BETTING'));
    assert.equal(cards.length, 2);
  });

  test('no on-call, no NTU, no BSc, no meetings joke; Sheffield is there', () => {
    for (const s of ['on-call', 'on call', 'Nottingham Trent', 'BSc', 'meetings about meetings']) {
      assert.ok(!html.includes(s), s);
    }
    assert.ok(html.includes('University of Sheffield'));
    assert.ok(html.includes('studied, not completed'));
    assert.ok(!html.includes('minimalist'));
  });

  test('roster from evidence: a lapsed tech renders ☆', () => {
    assert.match(html, /☆/);
    assert.match(html, /★/);
  });

  test('no salary table by default', () => {
    assert.ok(!html.includes('work-salary'));
  });

  test('nav links /work and not /profile', async () => {
    const index = await fs.readFile(path.join(out, 'index.html'), 'utf8');
    assert.ok(index.includes('href="/work"'));
    assert.ok(!index.includes('/profile'));
    assert.ok(!html.includes('/profile'));
  });
});

describe('/work with salary rows', () => {
  /** @type {string} */ let out;
  before(async () => {
    out = await fs.mkdtemp(path.join(os.tmpdir(), 'work-sal-'));
    await build(out, { ...work, salary: [
      { id: 'fx-role-7', gbp: 100000, delta: 10000, deltaPct: 11.1 },
      { id: 'fx-role-6', gbp: 90000, delta: 5000, deltaPct: 5.9 },
    ] });
  }, { timeout: 120_000 });
  after(() => fs.rm(out, { recursive: true, force: true }));

  test('the table renders', async () => {
    const html = await fs.readFile(path.join(out, 'work.html'), 'utf8');
    assert.ok(html.includes('work-salary'));
    assert.ok(html.includes('£100,000'));
    assert.ok(html.includes('+11.1%'));
  });
});
