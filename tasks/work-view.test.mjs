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
import { workViewTask, buildWorkView, homeRoleGlobals, HOME_FALLBACK } from './work-view.mjs';
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

  test('highlights: label required, optional parts only when present, https links only', () => {
    const v = /** @type {any} */ (buildWorkView(work));
    assert.equal(v.highlights.length, 4);
    assert.deepEqual(v.highlights[1], { n: '002', label: 'Fixture certificate', detail: '', year: '2021', url: '' });
    assert.equal(v.highlights[3].year, '');
    const odd = /** @type {any} */ (buildWorkView({ ...work, highlights: [{ label: 'x', url: 'http://nope', year: '99' }, { label: '' }, null] }));
    assert.equal(odd.highlights.length, 1);
    assert.equal(odd.highlights[0].url, '');
    assert.equal(odd.highlights[0].year, '');
  });

  test('no highlights, no callout data', () => {
    assert.equal(/** @type {any} */ (buildWorkView({ ...work, highlights: undefined })).highlights, null);
    assert.equal(/** @type {any} */ (buildWorkView({ ...work, highlights: [] })).highlights, null);
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
      { id: 'fx-role-7', startGbp: 101300, endGbp: 107650, delta: 12350, deltaPct: 13.9 },
      { id: 'fx-role-6', startGbp: 88700, endGbp: null, delta: -4150, deltaPct: -4.5 },
      { id: 'fx-role-5', startGbp: 61250, endGbp: 61250, delta: 0, deltaPct: 0 },
      { id: 'nope', startGbp: 1, endGbp: null, delta: 0, deltaPct: 0 },
    ];
    const v = /** @type {any} */ (buildWorkView({ ...work, salary }));
    assert.equal(v.salary.length, 3);
    assert.equal(v.salary[0].company, 'Monzo');
    assert.equal(v.salary[0].salary, '£101,300 → £107,650');
    assert.equal(v.salary[0].move, '+£12,350 (+13.9%)');
    assert.equal(v.salary[1].salary, '£88,700');
    assert.equal(v.salary[1].move, '−£4,150 (−4.5%)');
    assert.equal(v.salary[1].dir, 'down');
    assert.equal(v.salary[2].salary, '£61,250');
    assert.equal(v.salary[2].dir, 'flat');
  });

  test('eight roles: every company gets its own ink', () => {
    const extra = { id: 'fx-role-0', company: 'Example Training Co', title: 'Assistant', kind: 'employment', from: '2013-07', to: '2014-10', tech: [] };
    const v = /** @type {any} */ (buildWorkView({ ...work, roles: [...work.roles, extra] }));
    assert.equal(v.roles.length, 8);
    assert.equal(v.roles[7].badge, '008');
    assert.equal(v.roles[7].last, true);
    const companies = new Set(v.roles.map((r) => r.company));
    const inks = new Set(v.roles.map((r) => r.ink));
    assert.equal(inks.size, companies.size);
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

  test('no on-call, no NTU, no BSc, no meetings joke, no schooling block', () => {
    for (const s of ['on-call', 'on call', 'Nottingham Trent', 'BSc', 'meetings about meetings']) {
      assert.ok(!html.includes(s), s);
    }
    for (const s of ['SCHOOLING', 'Sheffield', 'studied, not completed']) assert.ok(!html.includes(s), s);
  });

  test('career highlights callout renders what is present', () => {
    assert.ok(html.includes('work-highlights'));
    assert.ok(html.includes('career highlights'));
    assert.ok(html.includes('href="https://example.com/keynote"'));
    assert.ok(html.includes('Invented talk about sample widgets'));
    assert.ok(html.includes('work-highlights__year">2018<'));
    const bare = html.split('<li class="work-highlights__item">').find((c) => c.includes('Bare highlight')) || '';
    assert.ok(!bare.split('</li>')[0].match(/__year|__detail|<a /));
  });

  test('highlights sit after the last role card', () => {
    const lastRole = html.lastIndexOf('<article class="role-card ');
    const hl = html.indexOf('class="work-highlights"');
    assert.ok(lastRole > 0 && hl > lastRole, 'highlights follow the roles');
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

describe('/work without highlights', () => {
  test('nothing drawn when the export has none', async () => {
    const out = await fs.mkdtemp(path.join(os.tmpdir(), 'work-nohl-'));
    try {
      const { highlights, ...rest } = work;
      await build(out, rest);
      const html = await fs.readFile(path.join(out, 'work.html'), 'utf8');
      assert.ok(!html.includes('work-highlights"'));
      assert.ok(!html.includes('career highlights'));
    } finally {
      await fs.rm(out, { recursive: true, force: true });
    }
  }, { timeout: 120_000 });
});

describe('/work with salary rows', () => {
  /** @type {string} */ let out;
  before(async () => {
    out = await fs.mkdtemp(path.join(os.tmpdir(), 'work-sal-'));
    await build(out, { ...work, salary: [
      { id: 'fx-role-7', startGbp: 101300, endGbp: 107650, delta: 12350, deltaPct: 13.9 },
      { id: 'fx-role-6', startGbp: 88700, endGbp: null, delta: 4150, deltaPct: 4.9 },
    ] });
  }, { timeout: 120_000 });
  after(() => fs.rm(out, { recursive: true, force: true }));

  test('the table renders', async () => {
    const html = await fs.readFile(path.join(out, 'work.html'), 'utf8');
    assert.ok(html.includes('work-salary'));
    assert.ok(html.includes('£101,300 → £107,650'));
    assert.ok(html.includes('<td>£88,700</td>'));
    assert.ok(html.includes('+£12,350 (+13.9%)'));
    assert.ok(html.includes('the move into this job'));
  });

  test('order: roles, then career highlights, then the pay table', async () => {
    const html = await fs.readFile(path.join(out, 'work.html'), 'utf8');
    const lastRole = html.lastIndexOf('<article class="role-card ');
    const hl = html.indexOf('class="work-highlights"');
    const pay = html.indexOf('class="work-salary"');
    assert.ok(lastRole > 0 && hl > lastRole, 'highlights come after the last role card');
    assert.ok(pay > hl, 'highlights come before the pay table');
  });
});

describe('homepage role from the work section', () => {
  test('globals match the first work role, blurb lists companies newest first', () => {
    const v = /** @type {any} */ (buildWorkView(work));
    const g = homeRoleGlobals(v);
    assert.equal(g.latestRole, v.roles[0].company);
    assert.equal(g.latestRoleTitle, 'Senior staff software engineer · Borrowing');
    assert.equal(g.latestRoleDate, 'may 2023 → now');
    assert.equal(g.workBlurb, 'Career history (Monzo, Deliveroo, DVELP, Example Contracting and Sky Betting & Gaming) and a long list of technologies.');
  });

  test('no export: neutral fallback', () => {
    assert.deepEqual(homeRoleGlobals(null), HOME_FALLBACK);
    assert.ok(!/Monzo|Deliveroo|Sky/.test(JSON.stringify(HOME_FALLBACK)));
  });

  test('built index shows the first role', async () => {
    const out = await fs.mkdtemp(path.join(os.tmpdir(), 'work-home-'));
    try {
      await build(out);
      const html = await fs.readFile(path.join(out, 'index.html'), 'utf8');
      assert.ok(html.includes('Monzo'));
      assert.ok(html.includes('may 2023 → now'));
      assert.ok(html.includes('Career history (Monzo, Deliveroo'));
    } finally {
      await fs.rm(out, { recursive: true, force: true });
    }
  }, { timeout: 120_000 });
});
