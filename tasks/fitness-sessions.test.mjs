// @ts-check
// Run with `npm test` (node:test, no extra dependencies).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadFitnessData } from './fitness-fetch.mjs';
import { buildSessions, fitnessSessionsPageTask, PAGE_SIZE } from './fitness-sessions.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('/life/sessions', () => {
  test('newest first, grouped by month, one filter per family present', () => {
    const acts = [
      { slug: 'a', title: 'A', activityType: 'ACTIVITY_TYPE_RUN', startTime: '2026-09-30T08:00:00Z', distanceMeters: 5000 },
      { slug: 'b', title: 'B', activityType: 'ACTIVITY_TYPE_PILATES', startTime: '2026-10-02T07:00:00Z', durationSeconds: 3000 },
      { slug: 'c', title: 'C', activityType: 'ACTIVITY_TYPE_TRAIL_RUN', startTime: '2026-10-20T07:00:00Z', distanceMeters: 12000 },
      { title: 'no slug' },
    ];
    const s = buildSessions({ activities: acts });
    assert.equal(s.total, 3);
    assert.equal(s.totalLabel, '3 sessions');
    assert.deepEqual(s.months.map((m) => `${m.title} ${m.countLabel}`), ['OCTOBER 2026 2 sessions', 'SEPTEMBER 2026 1 session']);
    assert.deepEqual(s.months[0].items.map((i) => i.slug), ['c', 'b']);
    assert.deepEqual(s.filters.map((f) => `${f.key}:${f.count}`), ['run:2', 'yoga:1']);
    assert.equal(s.hasFilters, true);
    assert.equal(s.months[0].items[0].keyStat.value, '12');
    assert.equal(s.pageSize, PAGE_SIZE);
  });

  test('the task writes life/sessions.html with every session and the filter chips', async () => {
    const d = await loadFitnessData({ source: 'fixtures', fixturesDir: path.join(REPO, 'fixtures', 'fitness') });
    const out = await fs.mkdtemp(path.join(os.tmpdir(), 'sessions-'));
    const logs = [];
    const task = fitnessSessionsPageTask({
      outDir: out,
      template: path.join(REPO, 'personal/templates/sessions.html'),
      partialsDir: path.join(REPO, 'personal/partials'),
    });
    await task.run(task.config, {
      globals: { fitnessIndex: d.index, fitnessActivities: d.activities, siteUrl: 'https://james.ripixel.co.uk' },
      logger: { info: (m) => logs.push(m), warn() {}, error() {}, debug() {} },
    });
    const html = await fs.readFile(path.join(out, 'life', 'sessions.html'), 'utf8');
    assert.equal((html.match(/class="fit-tile /g) || []).length, d.index.activities.length);
    assert.match(html, /data-filter="run"/);
    assert.match(html, /<link rel="canonical" href="https:\/\/james\.ripixel\.co\.uk\/life\/sessions" \/>/);
    assert.match(html, /href="\/life\/activity\/colwick-parkrun-2026-10-17"/);
    assert.match(logs.join('\n'), /Sessions page: 3 sessions/);
    await fs.rm(out, { recursive: true, force: true });
  });
});
