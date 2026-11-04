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

  test('career timeline: one band per company, oldest first, on a shared year axis', () => {
    const v = /** @type {any} */ (buildWorkView(work));
    const t = v.timeline;
    assert.equal(t.axis.from, 2015);
    assert.equal(t.axis.to, 2026);
    assert.equal(t.axis.ticks.length, 12);
    assert.deepEqual(t.axis.ticks.slice(0, 2).map((x) => [x.label, x.short, x.left]), [['2015', '’15', 0], ['2016', '’16', 8.3]]);
    assert.deepEqual(t.rows.map((r) => r.company), ['Sky Betting & Gaming', 'Example Contracting', 'DVELP', 'Deliveroo', 'Monzo']);
    const sky = t.rows[0];
    assert.equal(sky.roles.length, 2);
    assert.deepEqual([sky.roles[0].left, sky.roles[0].width], [6.9, 16.7]); // Nov 2015 to the end of Oct 2017, of 144 months
    assert.equal(sky.roles[0].label, 'Software engineer, Nov 2015 to Oct 2017');
    assert.equal(sky.when, '2015 – 2019');
    assert.equal(sky.ink, v.roles.find((/** @type {any} */ r) => r.company === sky.company).ink);
    assert.equal(t.rows[1].contract, true);
    assert.equal(t.rows[1].roles[0].contract, true);
    const now = t.rows.at(-1);
    assert.equal(now.current, true);
    assert.equal(now.when, '2023 – now');
    assert.equal(now.roles[0].current, true);
    assert.equal(now.roles[0].label, 'Senior staff software engineer, May 2023 to now');
    assert.equal(t.nowPct, 98.7);
    assert.ok(Math.abs(now.roles[0].left + now.roles[0].width - t.nowPct) <= 0.1, 'the open role runs to now');
  });

  test('tech chart: every roster entry, grouped, bars from the roles that used it', () => {
    const v = /** @type {any} */ (buildWorkView(work));
    const groups = v.techChart.groups;
    assert.deepEqual(groups.map((g) => g.label), ['languages', 'front end', 'back end & data', 'cloud & delivery']);
    const rows = groups.flatMap((g) => g.rows);
    assert.equal(rows.length, work.roster.length);
    const go = rows.find((/** @type {any} */ r) => r.name === 'go');
    assert.equal(go.current, true);
    assert.equal(go.spans.length, 2);
    assert.deepEqual(go.spans.map((/** @type {any} */ s) => s.company), ['Deliveroo', 'Monzo']);
    assert.equal(go.years, '4 yrs');
    const php = rows.find((/** @type {any} */ r) => r.name === 'php');
    assert.equal(php.current, false);
    assert.deepEqual(php.spans.map((/** @type {any} */ s) => s.company), ['Sky Betting & Gaming', 'Sky Betting & Gaming']);
    // a fixture spelling with a space still finds its role
    assert.equal(rows.find((/** @type {any} */ r) => r.name === 'twilio flex').spans.length, 1);
    // within a group: first used first
    const langs = groups[0].rows.map((/** @type {any} */ r) => r.name);
    assert.deepEqual(langs.slice(0, 2), ['javascript', 'php']);
    assert.equal(v.techChart.axis, v.timeline.axis);
    assert.deepEqual(v.techChart.legend.map((/** @type {any} */ l) => l.company), v.timeline.rows.map((/** @type {any} */ r) => r.company));
  });

  test('tech chart: a name no group knows goes in the rest', () => {
    const roles = [{ id: 'a', company: 'Acme', title: 'Dev', kind: 'employment', from: '2020-01', to: null, tech: ['zork'] }];
    const v = /** @type {any} */ (buildWorkView({ roles, roster: [{ name: 'zork', current: true }], updated: '2026-11-03' }));
    assert.deepEqual(v.techChart.groups.map((g) => g.label), ['the rest']);
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

  test('the timeline and the stack chart render before the role detail', () => {
    assert.equal((html.match(/<div class="wt-row(?: wt-row--now)?" style="--c:/g) || []).length, 5);
    assert.match(html, /wt-band wt-band--now" style="left: 69.4%/);
    assert.equal((html.match(/<div class="wt-row wt-row--tech/g) || []).length, work.roster.length);
    assert.ok(html.indexOf('class="wt wt--tech"') < html.indexOf('<article class="role-card '));
    assert.ok(!html.includes('tech-grid'), 'the old roster grid is gone: the chart lists every technology');
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
