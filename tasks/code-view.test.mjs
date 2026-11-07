// @ts-check
// /life/code: the daily commit grid and the project cards (code-view.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { commitGrid, projectCards, languageSlots, yearsView, weekdaysView, sparkOf } from './code-view.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = JSON.parse(await fs.readFile(path.join(REPO, 'fixtures/fitness/life/index.json'), 'utf8'));

test('grid: 53 Monday-first weeks ending on the export day', () => {
  const g = commitGrid([{ day: '2026-11-03', n: 2 }, { day: '2026-11-02', n: 5 }], '2026-11-03');
  assert.ok(g);
  assert.equal(g.weeks, 53);
  // 2026-11-03 is a Tuesday: the last column has Mon and Tue only
  const last = g.cells.filter((c) => c.col === 52);
  assert.deepEqual(last.map((c) => c.row), [0, 1]);
  assert.equal(g.cells[0].day, '2025-11-03'); // the Monday 52 weeks before the last Monday
  assert.equal(g.cells.length, 52 * 7 + 2);
  const tue = g.cells.at(-1);
  assert.equal(tue.n, 2);
  assert.equal(tue.title, '2 commits, Tue 3 Nov 2026');
  assert.equal(g.cells.at(-2).title, '5 commits, Mon 2 Nov 2026');
  assert.equal(g.cells[0].title, 'No commits, Mon 3 Nov 2025');
  assert.equal(g.cells[0].level, 0);
});

test('grid: four levels by quartile of the busy days, counts outside the window ignored', () => {
  const days = [1, 2, 3, 4, 5, 6, 7, 8].map((n, i) => ({ day: `2026-10-${String(i + 1).padStart(2, '0')}`, n }));
  days.push({ day: '2024-01-01', n: 99 }, { day: 'nope', n: 3 }, { day: '2026-10-20', n: -1 });
  const g = commitGrid(days, '2026-11-03');
  assert.ok(g);
  const lv = Object.fromEntries(g.cells.filter((c) => c.n).map((c) => [c.n, c.level]));
  assert.deepEqual(lv, { 1: 1, 2: 1, 3: 2, 4: 2, 5: 3, 6: 3, 7: 4, 8: 4 });
  assert.equal(g.total, 36);
});

test('grid: stats say what the year looked like', () => {
  const days = [
    { day: '2026-10-01', n: 3 }, { day: '2026-10-02', n: 1 }, { day: '2026-10-03', n: 9 },
    { day: '2026-10-10', n: 2 },
  ];
  const g = commitGrid(days, '2026-11-03');
  assert.ok(g);
  const by = Object.fromEntries(g.stats.map((s) => [s.label, s]));
  assert.equal(by['Commits'].value, '15');
  assert.equal(by['Days with a commit'].value, '4');
  assert.equal(by['Longest run'].value, '3');
  assert.equal(by['Longest run'].unit, 'days');
  assert.equal(by['Busiest day'].value, '9');
  assert.equal(by['Busiest day'].sub, 'Sat 3 Oct 2026');
});

test('grid: month labels, never two crowded together', () => {
  const g = commitGrid([{ day: '2026-11-03', n: 1 }], '2026-11-03');
  assert.ok(g);
  const labels = g.months.map((m) => m.label);
  assert.ok(labels.includes('Jan') && labels.includes('Nov'), labels.join(','));
  for (let i = 1; i < g.months.length; i++) assert.ok(g.months[i].col - g.months[i - 1].col >= 3);
  assert.ok(g.months.every((m) => m.col <= 50), 'no label runs off the right edge');
  assert.deepEqual(g.dayLabels.map((d) => d.label), ['Mon', 'Wed', 'Fri']);
  assert.equal(g.legend.length, 5);
});

test('grid: nothing to draw without daily counts', () => {
  assert.equal(commitGrid(undefined, '2026-11-03'), null);
  assert.equal(commitGrid([], '2026-11-03'), null);
});

test('language slots: chart series first, then the next most-used, the rest grey', () => {
  const projects = [
    { languages: ['Go', 'HCL', 'Shell'], languageShare: [60, 30, 10] },
    { languages: ['Elm', 'Zig'], languageShare: [50, 50] },
  ];
  const slots = languageSlots(projects, ['TypeScript', 'Go']);
  assert.equal(slots.get('TypeScript'), 1);
  assert.equal(slots.get('Go'), 2);
  // HCL (30), Elm (50), Zig (50), Shell (10): the two biggest get the extra inks 7 and 8
  assert.equal(slots.get('Elm'), 7);
  assert.equal(slots.get('Zig'), 8);
  assert.equal(slots.get('HCL'), 9);
  assert.equal(slots.get('Shell'), undefined);
});

test('project cards: strip, commits bar, shared timeline', () => {
  const sec = fixture.sections.code;
  const active = sec.projects.filter((/** @type {any} */ p) => p.status === 'active');
  const v = projectCards(active, ['Python', 'TypeScript', 'Go', 'JavaScript', 'Rust'], '2026-11-03');
  assert.equal(v.cards.length, active.length);
  const tool = v.cards.find((c) => c.name === 'sample-tool');
  assert.ok(tool);
  assert.deepEqual(tool.strip.map((s) => [s.name, s.pct, s.slot]), [['Python', 78, 1], ['Shell', 22, 7]]);
  assert.equal(tool.strip[1].left, 78);
  assert.equal(tool.bar, 100); // the most commits
  assert.equal(tool.commits, '1,212');
  const ledger = v.cards.find((c) => c.name === 'quiet-ledger');
  assert.ok(ledger);
  assert.equal(ledger.bar, 28.1);
  // the axis runs from the earliest start's year to the export year, whole years
  assert.equal(v.axis.from, 2021);
  assert.equal(v.axis.to, 2026);
  assert.deepEqual(v.axis.ticks.map((t) => t.label), ['2021', '2022', '2023', '2024', '2025', '2026']);
  // sample-tool: Aug 2025 to the end of Oct 2026, of Jan 2021 to Dec 2026 (72 months)
  assert.equal(tool.span.left, 76.4);
  assert.equal(tool.span.width, 20.8);
  assert.equal(tool.live, true);
  const bus = v.cards.find((c) => c.name === 'night-bus');
  assert.equal(bus?.live, false, 'last commit in June: not live in November');
  assert.equal(bus?.when, 'Nov 2024 – Jun 2026');
  assert.equal(tool.when, 'Aug 2025 – now');
  assert.equal(v.nowPct, 97.4);
});

test('project cards: the leftover share is drawn as other', () => {
  const v = projectCards([{ name: 'x', started: '2025-01-01', lastCommit: '2026-10', commits: 3, languages: ['Go'], languageShare: [70] }], ['Go'], '2026-11-03');
  assert.deepEqual(v.cards[0].strip.map((s) => [s.name, s.pct, s.slot]), [['Go', 70, 1], ['other', 30, 6]]);
});

test('project cards: no languages, no strip', () => {
  const v = projectCards([{ name: 'x', started: '2025-01-01', languages: [], languageShare: [] }], ['Go'], '2026-11-03');
  assert.deepEqual(v.cards[0].strip, []);
});

test('project cards: an old export without shares splits evenly, without numbers', () => {
  const v = projectCards([{ name: 'x', started: '2025-01-01', languages: ['Go', 'CSS'] }], ['Go'], '2026-11-03');
  const s = v.cards[0].strip;
  assert.deepEqual(s.map((x) => x.pct), [50, 50]);
  assert.ok(s.every((x) => x.label === x.name));
  assert.equal(v.cards[0].bar, 0);
  assert.equal(v.cards[0].when, 'since Jan 2025');
  assert.equal(v.cards[0].live, false);
});

test('the boom: every year to now, empty ones kept, this year against all before', () => {
  const v = /** @type {any} */ (yearsView([{ month: '2016-03', n: 1 }, { month: '2020-01', n: 60 }, { month: '2025-05', n: 140 }, { month: '2026-02', n: 3000 }], '2026-11-07'));
  assert.equal(v.cols.length, 11);
  assert.deepEqual(v.cols.filter((/** @type {any} */ c) => c.none).map((/** @type {any} */ c) => c.year), ['2017', '2018', '2019', '2021', '2022', '2023', '2024']);
  assert.equal(v.cols.at(-1).now, true);
  assert.equal(v.times, '14.9×');
  assert.equal(yearsView([{ month: '2026-01', n: 3 }], '2026-11-07'), null);
});

test('the week: Monday first, the busiest marked', () => {
  const days = Array.from({ length: 21 }, (_, i) => ({ day: `2026-10-${String(i + 1).padStart(2, '0')}`, n: i % 7 === 6 ? 10 : 1 }));
  const v = /** @type {any} */ (weekdaysView(days));
  assert.equal(v.days[0].label, 'Mon');
  assert.equal(v.busiest, 'Wednesday');      // 2026-10-07, 14, 21 are Wednesdays
  assert.equal(v.days.filter((/** @type {any} */ d) => d.top).length, 1);
  assert.equal(weekdaysView(days.slice(0, 5)), null);
});

test('a project spark: 12 months against its own busiest, a quiet month empty', () => {
  const s = /** @type {any} */ (sparkOf([0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 20, 40]));
  assert.equal(s.length, 12);
  assert.equal(s[11].h, 100);
  assert.equal(s[9].h, 6);
  assert.equal(s[0].h, 0);
  assert.equal(sparkOf([0, 0]), null);
  assert.equal(sparkOf(Array(12).fill(0)), null);
});
