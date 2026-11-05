// @ts-check
// Run with `npm test` (node:test, no extra dependencies).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadFitnessData } from './fitness-fetch.mjs';
import { buildSessionPages, fitnessSessionsViewTask, sessionsOutPath, PAGE_SIZE } from './fitness-sessions.mjs';
import { lifePageTasks } from './life-pages.mjs';
import { runSkierTasks } from './skier-test-runner.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** n sessions, a day apart, newest first by date, alternating run / pilates. */
function many(n) {
  return Array.from({ length: n }, (_, i) => {
    const t = new Date(Date.UTC(2026, 9, 31, 8) - i * 864e5);
    const run = i % 2 === 0;
    return {
      slug: `s-${i}`, title: run ? `Run ${i}` : `Pilates ${i}`, activityType: run ? 'ACTIVITY_TYPE_RUN' : 'ACTIVITY_TYPE_PILATES',
      startTime: t.toISOString(), distanceMeters: run ? 5000 : 0, durationSeconds: 1800, photoUrls: i === 0 ? ['https://x.test/0.jpg'] : [],
    };
  });
}

describe('/life/sessions', () => {
  test('pages: all + one set per family, newest first, PAGE_SIZE at a time, linked both ways', () => {
    const pages = buildSessionPages({ activities: many(PAGE_SIZE * 2 + 5) });
    const all = pages.filter((p) => p.fitnessSessions.filter === 'all');
    assert.equal(all.length, 3);
    assert.deepEqual(all.map((p) => p.fitnessSessions.href), ['/life/sessions', '/life/sessions/2', '/life/sessions/3']);
    assert.equal(all[0].fitnessSessions.nextHref, '/life/sessions/2');
    assert.equal(all[0].fitnessSessions.prevHref, null);
    assert.equal(all[2].fitnessSessions.nextHref, null);
    assert.equal(all[1].fitnessSessions.prevHref, '/life/sessions');
    assert.equal(all[0].fitnessSessions.months[0].items[0].slug, 's-0');
    const shown = all.flatMap((p) => p.fitnessSessions.months.flatMap((m) => m.items));
    assert.equal(shown.length, PAGE_SIZE * 2 + 5, 'every session on exactly one page');
    const runs = pages.filter((p) => p.fitnessSessions.filter === 'run');
    assert.equal(runs[0].fitnessSessions.href, '/life/sessions/run');
    assert.ok(runs.flatMap((p) => p.fitnessSessions.months.flatMap((m) => m.items)).every((c) => c.typeKey === 'run'));
    assert.deepEqual(all[0].fitnessSessions.filters.map((f) => [f.key, f.href, f.current]), [
      ['all', '/life/sessions', true], ['run', '/life/sessions/run', false], ['yoga', '/life/sessions/yoga', false],
    ]);
  });

  test('a month split across pages carries its full count and its key, so the pages stitch together', () => {
    const pages = buildSessionPages({ activities: many(PAGE_SIZE + 10) });
    const [p1, p2] = pages.filter((p) => p.fitnessSessions.filter === 'all');
    const lastOf1 = p1.fitnessSessions.months.at(-1);
    const firstOf2 = p2.fitnessSessions.months[0];
    if (lastOf1.key === firstOf2.key) assert.equal(lastOf1.countLabel, firstOf2.countLabel);
    const oct = p1.fitnessSessions.months[0];
    assert.equal(oct.key, '2026-10');
    assert.match(oct.countLabel, /^31 sessions/);
    assert.ok(oct.stack.length === 2, 'a month shows its type mix');
  });

  test('sessionsOutPath maps the hrefs onto files', () => {
    assert.equal(sessionsOutPath('/life/sessions'), 'life/sessions.html');
    assert.equal(sessionsOutPath('/life/sessions/2'), 'life/sessions/2.html');
    assert.equal(sessionsOutPath('/life/sessions/run/3'), 'life/sessions/run/3.html');
    assert.throws(() => sessionsOutPath('/life/../x'));
  });

  test('cards: photo or route or ink placeholder, key stat, and a highlight stamp from the moments', () => {
    const acts = many(3);
    const pages = buildSessionPages({ activities: acts }, [], { past: [{ calendar: 'events', title: 'Halloween 5k', start: acts[0].startTime, kind: 'race' }] });
    const card = pages[0].fitnessSessions.months[0].items[0];
    assert.equal(card.photo, 'https://x.test/0.jpg');
    assert.equal(card.mark, '5K');
    assert.equal(card.feature, true, 'a highlighted session gets the big card');
    assert.equal(card.keyStat.value, '5');
  });

  test('Skier renders the first page, a later page and a family page, with the scroll-loader and the no-JS pager', async () => {
    const d = await loadFitnessData({ source: 'fixtures', fixturesDir: path.join(REPO, 'fixtures', 'fitness') });
    const out = await fs.mkdtemp(path.join(os.tmpdir(), 'sessions-'));
    try {
      const tasks = lifePageTasks({ outDir: out, siteUrl: 'https://james.ripixel.co.uk', partialsDir: path.join(REPO, 'personal/partials'), templatesDir: path.join(REPO, 'personal/templates') });
      const sessionsTask = tasks.find((t) => t.config?.template?.endsWith('sessions.html'));
      assert.ok(sessionsTask, 'lifePageTasks renders the sessions template');
      const globals = { fitnessIndex: d.index, fitnessActivities: d.activities, siteUrl: 'https://james.ripixel.co.uk' };
      await runSkierTasks([fitnessSessionsViewTask(), sessionsTask], globals);
      const html = await fs.readFile(path.join(out, 'life', 'sessions.html'), 'utf8');
      assert.equal((html.match(/class="ss-card /g) || []).length, d.index.activities.length);
      assert.match(html, /href="\/life\/sessions\/run"/);
      assert.match(html, /<link rel="canonical" href="https:\/\/james\.ripixel\.co\.uk\/life\/sessions" \/>/);
      assert.match(html, /href="\/life\/activity\/colwick-parkrun-2026-10-17"/);
      assert.match(html, /<title>[^<]*sessions/);
      assert.match(html, /IntersectionObserver/);
      const run = await fs.readFile(path.join(out, 'life', 'sessions', 'run.html'), 'utf8');
      assert.match(run, /aria-current="page"[^>]*>Run|href="\/life\/sessions\/run"[^>]*aria-current="page"/);
    } finally {
      await fs.rm(out, { recursive: true, force: true });
    }
  });
});
