// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {
  SECTION_ORDER, SECTION_HREF, staleLabel, sawLabel, monthLabel, hubNote, buildSection, buildHub, personalBits, lifeFacts, lifeHubTask,
} from './life-hub.mjs';
import { runSkierTasks } from './skier-test-runner.mjs';

const fixture = JSON.parse(await fs.readFile(new URL('../fixtures/fitness/life/index.json', import.meta.url), 'utf8'));
const now = new Date('2026-11-03T08:00:00Z');
const fitnessLife = { stats: { strip: [{ value: '120', unit: '', label: 'activities' }] } };

test('hub has every section in order', () => {
  const hub = buildHub(fixture, fitnessLife, now);
  assert.deepEqual(hub.cards.map((c) => c.name), SECTION_ORDER);
  assert.equal(hub.cards[1].href, SECTION_HREF('body'));
  assert.ok(hub.cards.every((c) => !c.empty));
  assert.deepEqual(hub.cards[0].headline, { value: '120', unit: '', label: 'activities' });
});

test('hub without life export', () => {
  const hub = buildHub(null, fitnessLife, now);
  assert.equal(hub.cards[0].empty, false);
  assert.equal(hub.cards[0].headline.value, '120');
  assert.equal(hub.cards.slice(1).length, 6);
  assert.ok(hub.cards.slice(1).every((c) => c.empty && c.headline === null && c.latest === null));
  assert.deepEqual(hub.outings, []);
});

test('stale label, and a stale section keeps its numbers', () => {
  assert.equal(staleLabel(3), 'last updated 3 days ago');
  assert.equal(staleLabel(2), 'last updated 2 days ago');
  for (const d of [1, 0, null]) assert.equal(staleLabel(d), '');
  const v = buildSection('reading', fixture.sections.reading, now);
  assert.equal(v.staleLabel, 'last updated 4 days ago');
  assert.equal(v.headline.value, '9');
  assert.equal(buildSection('body', fixture.sections.body, now).staleLabel, '');
});

test('latest notable is newest', () => {
  const a = { key: 'a', kind: 'film', title: 'Older', month: '2026-09' };
  const b = { key: 'b', kind: 'film', title: 'Newer', month: '2026-10' };
  const v = buildSection('watching', { staleDays: 0, headline: { value: 2, unit: 'films', label: 'x' }, notable: [b, a] }, now);
  assert.equal(v.latest.month, '2026-10');
  const v2 = buildSection('watching', { staleDays: 0, headline: { value: 2, unit: 'films', label: 'x' }, notable: [a, b] }, now);
  assert.equal(v2.latest.title, 'Newer');
  assert.equal(v2.notable[0].title, 'Newer');
});

test('cinema joins watching, gigs join listening', () => {
  const cinema = { key: 'c', kind: 'cinema', title: 'Invented Premiere', month: '2026-10' };
  const gig = fixture.sections.outings.notable[0];
  const hub = buildHub({ ...fixture, sections: { ...fixture.sections, outings: { ...fixture.sections.outings, notable: [gig, cinema] } } }, fitnessLife, now);
  assert.equal(hub.outings.length, 2);
  const outs = [gig, cinema];
  const w = buildSection('watching', fixture.sections.watching, now, outs);
  const l = buildSection('listening', fixture.sections.listening, now, outs);
  assert.deepEqual(w.saw.map((s) => s.title), ['Invented Premiere']);
  assert.equal(w.saw[0].sawLabel, 'saw in Oct 2026');
  assert.deepEqual(l.saw.map((s) => s.title), ['Sample Band Live']);
  assert.equal(sawLabel('2026-10'), 'saw in Oct 2026');
  assert.equal(sawLabel('nope'), '');
});

test('watching totals say watched, never finished', () => {
  const w = buildSection('watching', fixture.sections.watching, now);
  assert.equal(w.stats[0].items[0].label, 'Films watched');
  assert.ok(!JSON.stringify(w).includes('inished'));
});

test('personal bits from facts only', () => {
  const facts = [
    { key: 'personal.height', label: 'Height', value: '180 cm', unit: '', tone: 'neutral' },
    { key: 'personal.likes', label: 'Likes', value: ['running', 'film'], unit: '', tone: 'neutral' },
    { key: 'body.weight_kg', label: 'Weight', value: 82.43, unit: 'kg', tone: 'neutral' },
    { key: 'games.serious', label: 'x', value: ['Fixture Quest'], unit: '', tone: 'neutral' },
    { key: 'personal.salary', label: 'Salary', value: 1, visibility: 'private' },
    { key: 'personal.desk', label: 'Desk', value: 'standing', visibility: 'private' },
    { key: 'fx.films', label: 'Films', value: 42 },
  ];
  const bits = personalBits(facts);
  assert.deepEqual(bits.map((b) => b.key), ['personal.height', 'personal.likes', 'body.weight_kg', 'games.serious']);
  const w = bits.find((b) => b.key === 'body.weight_kg');
  assert.equal(`${w.label}: ${w.value}`, 'Weight: 82.4 kg');
  assert.equal(bits[1].value, 'running, film');
  assert.deepEqual(personalBits(null), []);
  assert.equal(lifeFacts(facts)['fx.films'], 42);
  assert.ok(!('personal.desk' in lifeFacts(facts)));
});

test('empty section has no numbers', () => {
  for (const sec of [undefined, null, {}, { staleDays: 0, headline: null }]) {
    const v = buildSection('reading', sec);
    assert.equal(v.empty, true);
    assert.equal(v.headline, null);
    assert.equal(v.stats, undefined);
  }
});

test('section views from the fixture', () => {
  assert.equal(buildSection('body', fixture.sections.body, now).measures.stats[0].value, '80.1');
  assert.equal(buildSection('body', fixture.sections.body, now).sleep.stats[0].value, '7h 24m');
  assert.equal(buildSection('code', fixture.sections.code, now).projects[1].url, '');
  assert.equal(buildSection('games', fixture.sections.games, now).stats[2].value, '120 / 300');
  assert.equal(buildSection('reading', fixture.sections.reading, now).current[0].percent, 40);
});

test('task sets globals', async () => {
  const g = await runSkierTasks([lifeHubTask()], { lifeIndex: fixture, fitnessLife });
  assert.equal(g.lifeHub.cards.length, 7);
  assert.deepEqual(Object.keys(g.lifeSections), SECTION_ORDER.slice(1));
  assert.ok(g.lifePersonal.length === 0 || Array.isArray(g.lifePersonal));
  assert.equal(g.lifeFacts['fx.films'], 42);
  const none = await runSkierTasks([lifeHubTask()], { lifeIndex: null, fitnessLife: null });
  assert.equal(none.lifeHub.cards.every((c) => c.empty), true);
  assert.deepEqual(none.lifePersonal, []);
});

test('export shapes: language shares are percentages, serious/silly are strings', () => {
  const c = buildSection('code', fixture.sections.code, now);
  const y25 = c.languagesByYear.find((y) => y.year === '2025');
  assert.deepEqual(y25.languages, [{ name: 'Python', pct: 55 }, { name: 'JavaScript', pct: 45 }]);
  assert.ok(c.languagesByYear.every((y) => y.languages.every((l) => l.pct <= 100)));
  assert.equal(c.languagesByYear[1].languages[0].pct, 60.5);
  assert.equal(typeof fixture.sections.games.serious, 'string');
  const g = buildSection('games', fixture.sections.games, now);
  assert.deepEqual(g.serious, [{ name: 'Fixture Quest', hours: null }]);
  assert.deepEqual(g.silly, [{ name: 'Sample Tactics', hours: null }]);
  const none = buildSection('games', { ...fixture.sections.games, serious: null, silly: null }, now);
  assert.deepEqual(none.serious, []);
  // an array is tolerated too
  assert.equal(buildSection('games', { ...fixture.sections.games, serious: ['A'] }, now).serious[0].name, 'A');
});

test('partial totals: absent fields do not become zero rows from nowhere', () => {
  const w = buildSection('watching', { staleDays: 0, headline: { value: 1, unit: '', label: 'x' }, notable: [], totals: { year: { films: 3 }, month: {} } }, now);
  assert.equal(w.stats.length, 1);
  assert.equal(w.stats[0].items[0].value, '3');
});

test('monthLabel and notables carry it', () => {
  assert.equal(monthLabel('2026-10'), 'Oct 2026');
  assert.equal(monthLabel('2026-13'), '');
  assert.equal(monthLabel(''), '');
  assert.equal(buildSection('watching', fixture.sections.watching, now).notable[0].monthLabel, 'Oct 2026');
});

test('hub notes: the latest thing or the next number per section', () => {
  const hub = buildHub(fixture, { ...fitnessLife, activities: [{ title: 'Invented Run', href: '/life/activity/invented-run' }] }, now);
  const notes = Object.fromEntries(hub.cards.map((c) => [c.name, c.note]));
  assert.deepEqual(notes.fitness, { label: 'Latest session', value: 'Invented Run', href: '/life/activity/invented-run' });
  assert.deepEqual(notes.body, { label: 'Sleep, last 30 nights', value: '7h 24m', href: '' });
  const noSleep = buildSection('body', { ...fixture.sections.body, sleep: null }, now);
  assert.deepEqual(hubNote('body', noSleep), { label: 'Body fat', value: '17.2%', href: '' });
  assert.equal(notes.games.value, 'Sample Tactics');
  assert.deepEqual(notes.code, { label: 'Newest project', value: 'sample-tool', href: '' });
  assert.equal(notes.watching.value, 'The Invented Harbour');
  assert.equal(notes.listening.value, 'Sample Echoes, The Placeholders');
  assert.equal(notes.reading.value, 'A Made-Up Almanac, Ada Example');
  assert.equal(hubNote('reading', { empty: true }), null);
  const empty = buildHub(null, null, now);
  assert.ok(empty.cards.every((c) => c.note === null));
});

test('a headline in minutes reads as hours and minutes', () => {
  const sec = { staleDays: 0, headline: { value: 444, unit: 'min', label: 'average night, last 30 days' } };
  assert.deepEqual(buildSection('body', sec, now).headline, { value: '7h 24m', unit: '', label: 'average night, last 30 days' });
  assert.equal(buildSection('body', { staleDays: 0, headline: { value: 60, unit: 'min', label: 'x' } }, now).headline?.value, '1h 00m');
});

test('a section with lists but a null headline has data', () => {
  const games = { updated: '2026-11-03', staleDays: 0, headline: null, hoursYear: null, mostPlayed: [{ name: 'Revolution Idle', hours: 783 }], recent: [], serious: 'Revolution Idle', backlog: 74 };
  const v = buildSection('games', games);
  assert.equal(v.empty, false);
  assert.equal(v.headline, null);
  assert.equal(v.mostPlayed[0].name, 'Revolution Idle');
  assert.equal(buildSection('games', { headline: null, backlog: 3 }).empty, false);
  assert.equal(buildSection('reading', { headline: null, totals: { year: { books: 0 } } }).empty, false);
  assert.equal(buildSection('games', { updated: '2026-11-03', staleDays: 2, headline: null, mostPlayed: [], recent: [], achievements: {}, serious: '' }).empty, true);
});

test('games with a null headline leads with total hours', () => {
  const v = buildSection('games', { headline: null, hoursTotal: 2625, mostPlayed: [{ name: 'A', hours: 1 }] });
  assert.deepEqual(v.headline, { value: '2,625', unit: 'h', label: 'played, all time' });
});

test('silly is dropped when it equals serious (small print and games view)', () => {
  const bits = personalBits([
    { key: 'games.serious', value: 'Idle Fixture', tone: 'neutral' },
    { key: 'games.silly', value: 'idle fixture', tone: 'neutral' },
  ]);
  assert.deepEqual(bits.map((b) => b.key), ['games.serious']);
  const g = buildSection('games', { serious: 'Idle Fixture', silly: 'Idle Fixture' }, new Date('2026-11-01T00:00:00Z'));
  assert.deepEqual(g.silly, []);
  assert.deepEqual(g.serious, [{ name: 'Idle Fixture', hours: null }]);
  const differ = buildSection('games', { serious: 'A Game', silly: 'B Game' }, new Date('2026-11-01T00:00:00Z'));
  assert.equal(differ.silly.length, 1);
});

// ─── Round 2: one /life/body, seven sections (R2c.2) ───

test('seven sections', () => {
  const order = ['fitness', 'body', 'games', 'code', 'watching', 'listening', 'reading'];
  assert.deepEqual(SECTION_ORDER, order);
  assert.deepEqual(buildHub(fixture, fitnessLife, now).cards.map((c) => c.name), order);
});

test('body blocks', () => {
  const b = buildSection('body', fixture.sections.body, now);
  assert.ok(b.measures.charts.length >= 4, `measures charts: ${b.measures.charts.length}`);
  assert.equal(b.sleep.stages.length, 4);
  assert.deepEqual(b.sleep.stages.map((s) => s.label), ['Deep', 'Light', 'REM', 'Awake']);
  assert.equal(b.food.split.reduce((n, s) => n + s.pct, 0), 100);
  assert.equal(b.movement.charts.length, 2);
  // every chart is an axes model (chart-axes lineChart), never a bare path
  for (const c of [...b.measures.charts, ...b.sleep.charts, ...b.food.charts, ...b.movement.charts]) {
    assert.ok(c.d && c.yTicks.length >= 2 && c.xTicks.length >= 2, c.label);
    assert.doesNotMatch(c.d, /NaN/);
  }
  const sleepChart = b.sleep.charts[0];
  assert.equal(sleepChart.unit, 'h');
  assert.equal(sleepChart.xTicks[0].label, '4 May');
  assert.deepEqual(b.movement.charts.map((c) => c.unit), ['steps', 'min']);
  assert.ok(b.food.stats.some((r) => r.label === 'Protein per kg' && r.value === '1.8' && r.unit === 'g/kg'));
  assert.deepEqual(b.food.stats.map((r) => r.label).slice(1, 6), ['Energy', 'Protein', 'Carbs', 'Fat', 'Fibre']);
  // VO₂ max is null all the way down: no row, no chart, no zero
  assert.ok(!b.measures.stats.some((r) => /VO/.test(r.label)));
  assert.ok(!b.measures.charts.some((c) => /VO/.test(c.label)));
  // height-derived figures come from the export, never typed here
  assert.ok(b.measures.stats.some((r) => r.label === 'BMI' && r.value === '25.3'));
  // Renpho: change since the first measurement, signed
  const waist = b.measurements.rows.find((r) => r.label === 'Waist');
  assert.deepEqual({ value: waist.value, unit: waist.unit, change: waist.change }, { value: '84.0', unit: 'cm', change: '−2.5' });
  assert.ok(b.measurements.charts.length >= 1);
});

test('a metric the device does report shows up', () => {
  const sec = structuredClone(fixture.sections.body);
  sec.latest.vo2Max = 47.2;
  sec.weekly.forEach((w, i) => { w.vo2Max = 45 + i / 10; });
  const b = buildSection('body', sec, now);
  assert.ok(b.measures.stats.some((r) => r.label === 'VO₂ max' && r.value === '47.2'));
  assert.ok(b.measures.charts.some((c) => c.label === 'VO₂ max'));
});

test('partial body', () => {
  const b = buildSection('body', { ...fixture.sections.body, movement: null, sleep: null, measurements: null }, now);
  assert.equal(b.movement, null);
  assert.equal(b.sleep, null);
  assert.equal(b.measurements, null);
  assert.ok(b.measures.stats.length > 0 && b.measures.charts.length > 0);
  assert.ok(b.food);
  // a block with nothing in it is null, not an empty box
  const hollow = buildSection('body', { ...fixture.sections.body, food: { avgKcal30: null, split30: null, weekly: [] }, movement: { avgSteps30: null, weekly: [] } }, now);
  assert.equal(hollow.food, null);
  assert.equal(hollow.movement, null);
  // a block's split/stages are null when absent, the rest stays
  const noSplit = buildSection('body', { ...fixture.sections.body, food: { ...fixture.sections.body.food, split30: null } }, now);
  assert.equal(noSplit.food.split, null);
  assert.ok(noSplit.food.stats.length > 0);
});

test('old-shape export', async () => {
  const old = { sections: { sleep: fixture.sections.body.sleep, food: fixture.sections.body.food, body: { latest: { weightKg: 80 }, weekly: [] } } };
  const b = buildSection('body', old.sections.body, now);
  assert.equal(b.measures.stats.length, 1);
  assert.equal(b.sleep, null);
  assert.equal(b.food, null);
  assert.equal(b.movement, null);
  const g = await runSkierTasks([lifeHubTask()], { lifeIndex: old, fitnessLife });
  assert.ok(!('sleep' in g.lifeSections));
  assert.ok(!('food' in g.lifeSections));
  assert.equal(g.lifeHub.cards.length, 7);
});

test('code commits chart has axes', () => {
  const c = buildSection('code', fixture.sections.code, now);
  assert.equal(c.commits.label, 'Commits');
  assert.deepEqual(c.commits.xTicks.map((t) => t.label), ['Sep ’26', 'Oct ’26']);
});
