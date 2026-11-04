// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {
  SECTION_ORDER, SECTION_HREF, staleLabel, sawLabel, monthLabel, hubNote, buildSection, buildHub, personalBits, lifeFacts, lifeHubTask, lifeInsights, championName,
} from './life-hub.mjs';
import { runSkierTasks } from './skier-test-runner.mjs';
import { templateHelpers } from './life-pages.mjs';
import { generatePagesTask } from 'skier';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
  assert.equal(hub.cards.slice(1).length, 7);
  assert.ok(hub.cards.slice(1).every((c) => c.empty && c.headline === null && c.latest === null));
  assert.deepEqual(hub.live, []);
});

test('the live list carries every year, not only the last two months', () => {
  const old = { key: 'o1', kind: 'gig', title: 'Invented Old Act', month: '2023-05' };
  const recent = { key: 'o2', kind: 'gig', title: 'Invented Recent Film', month: '2026-10' };
  const sec = { ...fixture.sections.live, notable: [recent], years: { 2026: [recent], 2023: [old] } };
  const hub = buildHub({ ...fixture, sections: { ...fixture.sections, live: sec } }, fitnessLife, now);
  assert.deepEqual(hub.live.map((n) => n.title).sort(), ['Invented Old Act', 'Invented Recent Film']);
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

test('gigs join listening, cinema films are watching rows with a big-screen flag', () => {
  const gig = fixture.sections.live.notable[0];
  const hub = buildHub({ ...fixture, sections: { ...fixture.sections, live: { ...fixture.sections.live, notable: [gig], years: { 2026: [gig] } } } }, fitnessLife, now);
  assert.equal(hub.live.length, 1);
  const film = { key: 'f', kind: 'film', title: 'Invented Premiere', month: '2026-10', bigScreen: true };
  const w = buildSection('watching', { staleDays: 0, headline: { value: 1, unit: '', label: 'x' }, notable: [film],
    totals: { year: { films: 3, cinema: 1, episodes: 0, videos: 0, hours: 5 }, month: {} } }, now, [gig]);
  assert.equal(w.notable[0].bigScreen, true);
  assert.equal(w.hasSaw, false);
  assert.equal(w.stats[0].items.find((r) => r.label === 'At the cinema')?.value, '1');
  const l = buildSection('listening', fixture.sections.listening, now, [gig]);
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
    { key: 'games.silly', label: 'x', value: 'Sample Tactics', unit: '', tone: 'neutral' },
    { key: 'personal.salary', label: 'Salary', value: 1, visibility: 'private' },
    { key: 'personal.desk', label: 'Desk', value: 'standing', visibility: 'private' },
    { key: 'fx.films', label: 'Films', value: 42 },
  ];
  const bits = personalBits(facts);
  assert.deepEqual(bits.map((b) => b.key), ['personal.height', 'personal.likes', 'body.weight_kg']);
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
  assert.equal(buildSection('code', fixture.sections.code, now).active[1].url, '');
  assert.deepEqual(buildSection('games', fixture.sections.games, now).stats.map((r) => r.label), ['League this year', 'Steam, last 2 weeks', 'All time', 'Multiplayer', 'Backlog']);
  assert.equal(buildSection('reading', fixture.sections.reading, now).current[0].percent, 40);
});

test('task sets globals', async () => {
  const g = await runSkierTasks([lifeHubTask()], { lifeIndex: fixture, fitnessLife });
  assert.equal(g.lifeHub.cards.length, 8);
  assert.deepEqual(Object.keys(g.lifeSections), SECTION_ORDER.slice(1));
  assert.ok(g.lifePersonal.length === 0 || Array.isArray(g.lifePersonal));
  assert.equal(g.lifeFacts['fx.films'], 42);
  const none = await runSkierTasks([lifeHubTask()], { lifeIndex: null, fitnessLife: null });
  assert.equal(none.lifeHub.cards.every((c) => c.empty), true);
  assert.deepEqual(none.lifePersonal, []);
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
  assert.deepEqual(notes.games, { label: 'League', value: 'Gold II · 54 LP', href: '' });
  const noLeague = buildSection('games', { ...fixture.sections.games, league: null }, now);
  assert.deepEqual(hubNote('games', noLeague), { label: 'Recently', value: 'Sample Tactics', href: '' });
  assert.deepEqual(notes.code, { label: 'Newest project', value: 'sample-tool', href: 'https://github.com/Ripixel-Studio/sample-tool' });
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
  const games = { updated: '2026-11-03', staleDays: 0, headline: null, hoursYear: null, wall: [{ key: '1', name: 'Idle Fixture', art: '', weight: 4, source: 'steam', quip: null }], recent: [], league: null, backlog: 74 };
  const v = buildSection('games', games);
  assert.equal(v.empty, false);
  assert.equal(v.headline, null);
  assert.equal(v.wall[0].name, 'Idle Fixture');
  assert.equal(buildSection('games', { headline: null, backlog: 3 }).empty, false);
  assert.equal(buildSection('reading', { headline: null, totals: { year: { books: 0 } } }).empty, false);
  assert.equal(buildSection('games', { updated: '2026-11-03', staleDays: 2, headline: null, wall: [], recent: [], achievements: {}, league: null }).empty, true);
});

test('games with a null headline leads with total hours', () => {
  const v = buildSection('games', { headline: null, hoursTotal: 2625, wall: [{ name: 'A', weight: 1 }] });
  assert.deepEqual(v.headline, { value: '2,625', unit: 'h', label: 'played, all time' });
});

// ─── Round 2: one /life/body, seven sections (R2c.2) ───

test('eight sections', () => {
  const order = ['fitness', 'body', 'games', 'code', 'watching', 'listening', 'reading', 'live'];
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

test('Renpho collector keys get plain labels, units and axes', () => {
  const sec = structuredClone(fixture.sections.body);
  const row = (key, unit, a, b) => ({ key, unit, first: { date: '2026-08-11', value: a }, latest: { date: '2026-10-30', value: b },
    change: Number((b - a).toFixed(1)), weekly: [{ week: '2026-08-10', value: a }, { week: '2026-10-26', value: b }] });
  sec.measurements = { tape: [row('armLCm', 'cm', 34, 34.6), row('abdomenCm', 'cm', 91, 89.5)],
    scale: [row('musclePct', '%', 44.1, 45), row('metabolicAgeYears', 'yrs', 36, 34), row('leanMassKg', 'kg', 61.2, 62),
      row('bmrKcal', 'kcal', 1790, 1815)] };
  const b = buildSection('body', sec, now);
  assert.deepEqual(b.measurements.rows.map((r) => r.label),
    ['Left arm', 'Abdomen', 'Muscle', 'Metabolic age', 'Lean mass', 'BMR']);
  const age = b.measurements.rows.find((r) => r.label === 'Metabolic age');
  assert.deepEqual({ value: age.value, unit: age.unit, change: age.change, since: age.since },
    { value: '34', unit: 'yrs', change: '−2', since: '11 Aug 2026' });
  assert.equal(b.measurements.charts.length, 6);
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
  assert.equal(g.lifeHub.cards.length, 8);
});

test('code commits chart has axes', () => {
  const c = buildSection('code', fixture.sections.code, now);
  assert.equal(c.commits.label, 'Commits');
  assert.deepEqual(c.commits.xTicks.map((t) => t.label), ['Sep ’26', 'Oct ’26']);
});

test('lifeInsights filters', () => {
  const out = lifeInsights({ insights: [{ text: '' }, { text: 'x'.repeat(161) }, { text: 'ok', section: 'body', id: 'a' }, { text: 1 }] });
  assert.deepEqual(out, [{ id: 'a', text: 'ok', href: '/life/body' }]);
});

test('lifeInsights: hrefs, cap of 6, order', () => {
  const rows = Array.from({ length: 8 }, (_, i) => ({ id: 'i' + i, text: 't' + i, section: i === 1 ? 'fitness' : 'games' }));
  const out = lifeInsights({ insights: rows });
  assert.equal(out.length, 6);
  assert.equal(out[0].href, '/life');
  assert.equal(out[1].href, '/life/fitness');
  assert.equal(out[5].id, 'i5');
});

test('no insights', () => {
  assert.deepEqual(lifeInsights({}), []);
  assert.deepEqual(lifeInsights(null), []);
  assert.deepEqual(lifeInsights({ insights: 'x' }), []);
});

// ─── Round 2: the games page reads C6 (R2d.5) ───

test('games view', () => {
  const g = buildSection('games', fixture.sections.games, now);
  assert.equal(g.league.rankLabel, 'Gold II · 54 LP');
  assert.equal(g.wall[0].league, true);
  assert.equal(g.wall[0].weight, 4);
  assert.ok(g.wall.slice(1).every((t) => t.league === false));
  // tilt is a pure function of the name: the same across calls and builds, within ±2.4°
  const again = buildSection('games', structuredClone(fixture.sections.games), now);
  assert.deepEqual(g.wall.map((t) => t.tilt), again.wall.map((t) => t.tilt));
  assert.ok(g.wall.every((t) => Math.abs(t.tilt) <= 2.4 && Math.round(t.tilt / 0.8 * 10) % 10 === 0));
  assert.ok(new Set(g.wall.map((t) => t.tilt)).size > 1, 'tilts vary');
  assert.deepEqual(g.league.mains.map((m) => Object.keys(m).sort()), g.league.mains.map(() => ['art', 'champion', 'level', 'points']));
  assert.equal(g.league.recent.games, 20);
  assert.equal(g.league.lifetime.sinceLabel, 'Mar 2019');
  assert.ok(g.rarest.length > 0 && g.rarest.every((r) => /^\d+\.\d$/.test(r.pct)));
  assert.ok(g.completion.length > 0 && g.completion.every((c) => Number.isInteger(c.pct)));
  assert.ok(g.recent[0].name);
  // quips ride on their tile, and nowhere else
  assert.ok(g.wall.some((t) => t.quip));
});

test('art validated', () => {
  const sec = structuredClone(fixture.sections.games);
  const bad = ['javascript:alert(1)', 'https://evil.example/x.jpg', 'http://shared.akamai.steamstatic.com/x.jpg',
    'https://shared.akamai.steamstatic.com.evil.example/x.jpg', "https://shared.akamai.steamstatic.com/x.jpg') ; x:url('y", 42, null];
  sec.wall = bad.map((art, i) => ({ key: String(i), name: `Bad Art ${i}`, art, weight: 2, source: 'steam', quip: null }));
  sec.recent = [{ name: 'Bad Recent', hours: 1, art: 'javascript:void 0' }];
  sec.league.mains[0].splash = 'https://ddragon.example/x.jpg';
  const g = buildSection('games', sec, now);
  assert.ok(g.wall.every((t) => t.art === ''), JSON.stringify(g.wall.map((t) => t.art)));
  assert.equal(g.recent[0].art, '');
  assert.equal(g.league.mains[0].art, '');
  const ok = buildSection('games', fixture.sections.games, now);
  assert.match(ok.wall[0].art, /^https:\/\/ddragon\.leagueoflegends\.com\//);
  assert.ok(ok.wall.some((t) => /^https:\/\/shared\.akamai\.steamstatic\.com\//.test(t.art)));
});

test('no serious/silly', () => {
  const g = buildSection('games', { ...fixture.sections.games, serious: 'Fixture Quest', silly: 'Sample Tactics' }, now);
  assert.doesNotMatch(JSON.stringify(g), /"(serious|silly)"/);
  assert.ok(!('mostPlayed' in g));
  const bits = personalBits([
    { key: 'games.serious', value: 'Fixture Quest', tone: 'neutral' },
    { key: 'games.silly', value: 'Sample Tactics', tone: 'neutral' },
    { key: 'games.quip.100001', value: 'a quip', tone: 'neutral' },
  ]);
  assert.deepEqual(bits.filter((b) => b.key.startsWith('games.')), []);
});

test('no league', async () => {
  const sec = { ...structuredClone(fixture.sections.games), league: null };
  sec.wall = sec.wall.filter((/** @type {any} */ t) => t.source !== 'league');
  const g = buildSection('games', sec, now);
  assert.equal(g.league, null);
  assert.ok(g.wall.length > 0 && g.wall.every((t) => t.league === false));

  // and the page renders it: a wall of named Steam tiles, no League block
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'games-page-'));
  try {
    const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const pages = path.join(tmp, 'pages');
    await fs.mkdir(pages);
    await fs.copyFile(path.join(REPO, 'personal/pages/life/games.html'), path.join(pages, 'games.html'));
    const render = async (/** @type {any} */ section) => {
      const out = path.join(tmp, 'out-' + Math.random().toString(36).slice(2));
      await runSkierTasks([generatePagesTask({
        pagesDir: pages, partialsDir: path.join(REPO, 'personal/partials'), outDir: out, helpers: templateHelpers,
        additionalVarsFn: () => ({ page: 'life', section }),
      })], { siteUrl: 'https://james.ripixel.co.uk', cacheHash: 'test', year: 2026 }, []);
      return fs.readFile(path.join(out, 'games.html'), 'utf8');
    };
    const html = await render(g);
    assert.doesNotMatch(html, /games-league/);
    const wall = /<ol class="games-wall"[\s\S]*?<\/ol>/.exec(html)?.[0] || '';
    assert.equal((wall.match(/<li class="games-tile/g) || []).length, g.wall.length);
    for (const t of g.wall) assert.ok(wall.includes(t.name.replace(/'/g, '&#x27;')), t.name);
    // an art tile is a lazy image named for the game; a tile without art is the name in type
    const img = /<img [^>]*alt="Fixture Quest"[^>]*>/.exec(wall)?.[0] || '';
    assert.match(img, /loading="lazy"/);
    assert.match(img, /width="600" height="900"/);
    assert.match(wall, /games-tile--type/);
    assert.doesNotMatch(wall, /<svg/);

    const full = await render(buildSection('games', fixture.sections.games, now));
    assert.ok(full.indexOf('games-league') > 0 && full.indexOf('games-league') < full.indexOf('games-wall'), 'League comes first');
    assert.match(full, /Gold II · 54 LP/);
    assert.match(full, /1\.2 % of players/);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}, { timeout: 60_000 });

test('League champion names, not Data Dragon ids', () => {
  assert.equal(championName('Miss Fortune'), 'Miss Fortune');
  assert.equal(championName('MissFortune'), 'Miss Fortune');
  assert.equal(championName('JarvanIV'), 'Jarvan IV');
  assert.equal(championName('MonkeyKing'), 'Wukong');
  assert.equal(championName('Khazix'), "Kha'Zix");
  assert.equal(championName('Jhin'), 'Jhin');
  const sec = structuredClone(fixture.sections.games);
  sec.league.mains[0].champion = 'MissFortune';
  sec.league.recent.pool[0].champion = 'TwistedFate';
  const g = buildSection('games', sec, now);
  assert.equal(g.league.mains[0].champion, 'Miss Fortune');
  assert.equal(g.league.recent.pool[0].champion, 'Twisted Fate');
});

// ─── Round 2: the code page reads C7 (R2e.6) ───

test('code view splits', () => {
  const c = buildSection('code', fixture.sections.code, now);
  assert.deepEqual(c.active.map((p) => p.name), ['sample-tool', 'quiet-ledger']);
  assert.ok(!('retired' in c));
  assert.ok(!c.active.some((p) => ['paper-lantern', 'old-orbit'].includes(p.name)), 'status: retired rows are filtered out');
  const [tool, ledger] = c.active;
  assert.deepEqual(tool, {
    name: 'sample-tool', description: 'A small invented command-line helper that tidies folders of sample files.',
    years: '2025–now', lastCommit: 'Oct 2026', commits: '1,212', commitsUnit: 'commits', languages: ['Python', 'Shell'],
    url: 'https://github.com/Ripixel-Studio/sample-tool', started: '2025-08-02',
  });
  // the private one: no link, and no placeholder description
  assert.equal(ledger.url, '');
  assert.equal(ledger.description, '');
  assert.equal(ledger.years, '2024–now');
  const one = structuredClone(fixture.sections.code);
  one.projects[0].commits = 1;
  assert.equal(buildSection('code', one, now).active[0].commitsUnit, 'commit');
  assert.ok(!('projects' in c) && !('languagesByYear' in c));
});

test('url validated', () => {
  const sec = structuredClone(fixture.sections.code);
  const bad = ['https://evil.example/x', 'http://github.com/ripixel/x', 'https://github.com/someone-else/x',
    'https://github.com/ripixel/x/tree/main', 'https://github.com/ripixel/x?y=1', 'javascript:alert(1)', 'https://github.com.evil.example/ripixel/x', 42, null];
  sec.projects = bad.map((url, i) => ({ name: `bad-${i}`, status: 'active', fromYear: 2025, toYear: null, started: '2025-01-01', lastCommit: '2026-10', commits: 1, languages: [], url }));
  const c = buildSection('code', sec, now);
  assert.equal(c.active.length, bad.length);
  assert.ok(c.active.every((p) => p.url === ''), JSON.stringify(c.active.map((p) => p.url)));
  sec.projects = [{ ...sec.projects[0], url: 'https://github.com/Ripixel-Studio/some.repo-name_2' }];
  assert.equal(buildSection('code', sec, now).active[0].url, 'https://github.com/Ripixel-Studio/some.repo-name_2');
});

test('languages chart', () => {
  const c = buildSection('code', fixture.sections.code, now);
  assert.ok(c.languages);
  assert.ok(c.languages.series.length <= 6);
  assert.deepEqual(c.languages.yTicks.map((t) => t.label), ['100%', '50%', '0%']);
  assert.equal(c.languages.series.at(-1).key, 'Other');
  assert.deepEqual(c.languages.years.map((y) => y.label), ['2022', '2023', '2024', '2025', '2026']);
  assert.deepEqual(c.languagesNow, ['Python', 'TypeScript', 'Go']);
  assert.equal(buildSection('code', { ...fixture.sections.code, languagesByYear: { '2026': { Go: 100 } } }, now).languages, null);
});

test('old export: projects without status are active, and the page renders', async () => {
  const sec = structuredClone(fixture.sections.code);
  sec.projects = [
    { name: 'example-site', started: '2024-03-14', languages: ['JavaScript', 'CSS'], url: 'https://github.com/ripixel/example-site' },
    { name: 'sample-tool', started: '2025-08-02', languages: ['Python'], url: null },
  ];
  const c = buildSection('code', sec, now);
  assert.deepEqual(c.active.map((p) => p.name), ['example-site', 'sample-tool']);
  assert.equal(c.active[0].years, '2024–now');
  assert.equal(c.active[0].lastCommit, '');
  assert.equal(c.active[0].description, '');
  assert.deepEqual(hubNote('code', c), { label: 'Newest project', value: 'sample-tool', href: '' });

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'code-page-'));
  try {
    const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const pages = path.join(tmp, 'pages');
    await fs.mkdir(pages);
    await fs.copyFile(path.join(REPO, 'personal/pages/life/code.html'), path.join(pages, 'code.html'));
    const render = async (/** @type {any} */ section) => {
      const out = path.join(tmp, 'out-' + Math.random().toString(36).slice(2));
      await runSkierTasks([generatePagesTask({
        pagesDir: pages, partialsDir: path.join(REPO, 'personal/partials'), outDir: out, helpers: templateHelpers,
        additionalVarsFn: () => ({ page: 'life', section }),
      })], { siteUrl: 'https://james.ripixel.co.uk', cacheHash: 'test', year: 2026 }, []);
      return fs.readFile(path.join(out, 'code.html'), 'utf8');
    };
    const old = await render(c);
    assert.match(old, /example-site/);
    assert.doesNotMatch(old, /class="life-langs[" _]/);

    // the full fixture: chart, active, then the shelf; private repo unlinked; no empty descriptions
    const full = await render(buildSection('code', fixture.sections.code, now));
    assert.match(full, /class="chart chart--stack"/);
    assert.match(full, /<title>Python 39.5%<\/title>/);
    assert.ok(full.indexOf('sample-tool') > 0);
    assert.doesNotMatch(full, /retired/i);
    assert.doesNotMatch(full, /old-orbit|paper-lantern/);
    assert.match(full, /<a href="https:\/\/github.com\/Ripixel-Studio\/sample-tool"/);
    assert.doesNotMatch(full, /href="[^"]*quiet-ledger/);
    assert.equal((full.match(/class="life-project__desc"/g) || []).length, 1);
    assert.doesNotMatch(full, /life-project__desc">\s*</);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

// ─── games: honest year, time of day, the year by week, the League numbers ───

test('games stats say what each number covers', () => {
  const g = buildSection('games', fixture.sections.games, now);
  const by = Object.fromEntries(g.stats.map((r) => [r.label, r]));
  assert.equal(by['League this year'].value, '148');
  assert.match(by['League this year'].sub, /231 games/);
  assert.equal(by['League this year'].sub, '231 games · + 10h Steam since 20 Oct');
  const early = buildSection('games', { ...fixture.sections.games, year: { ...fixture.sections.games.year, steamSinceTracking: 0.4 } }, now);
  assert.equal(early.stats[0].sub, '231 games', 'under 1h of tracked Steam is not shown');
  assert.equal(by['All time'].sub, 'Steam lifetime 1,228h + League 612h since Mar 2019');
  assert.equal(by['Steam, last 2 weeks'].value, '6.5');
  assert.ok(!('This year' in by), 'no blended year total');
});

test('games time of day: weekday daytime is one block, shared scale', () => {
  const g = buildSection('games', fixture.sections.games, now);
  const [wd, we] = g.clock.charts;
  assert.equal(wd.label, 'Weekdays');
  assert.equal(we.label, 'Weekends');
  const merged = wd.bars.filter((b) => b.merged);
  assert.equal(merged.length, 1);
  assert.equal(wd.bars.length, 24 - 8 + 1);
  assert.ok(!wd.bars.some((b) => /^(9am|10am|11am|12pm|1pm|2pm|3pm|4pm)$/.test(b.label)), 'no daytime hour bars');
  assert.match(merged[0].title, /daytime, 9am to 5pm: 6 h in all/);
  assert.equal(we.bars.length, 24);
  assert.deepEqual(wd.yTicks, we.yTicks, 'one scale for both');
  assert.ok(wd.xTicks.some((t) => t.label === 'daytime'));
  assert.match(g.clock.note, /since Mar 2019/);
});

test('games year chart is cumulative and labelled', () => {
  const g = buildSection('games', fixture.sections.games, now);
  assert.ok(g.yearChart.chart.d.startsWith('M'));
  assert.equal(g.yearChart.chart.xTicks[0].label, '1 Jan');
  assert.match(g.yearChart.note, /Steam counted from 20 Oct 2026/);
});

test('games fun numbers', () => {
  const g = buildSection('games', fixture.sections.games, now);
  assert.deepEqual(g.fun.facts.map((f) => f.label), ['Longest session', 'Biggest League day', 'Longest game']);
  assert.equal(g.fun.facts[2].sub, 'Miss Fortune, won · 3 Jun 2026');
  assert.equal(g.fun.champs[0].month, 'Nov 2026');
  assert.equal(g.fun.modes[0].mode, 'ARAM');
  assert.equal(g.fun.bands[0].label, 'Daytime, 9am–5pm');
  const bare = buildSection('games', { ...fixture.sections.games, clock: null, yearWeeks: [], fun: null }, now);
  assert.equal(bare.clock, null);
  assert.equal(bare.yearChart, null);
  assert.equal(bare.fun, null);
});

// ─── /life/live ───
test('live view: counts, stats and chart from synthetic months', () => {
  const n = (/** @type {string} */ title, /** @type {string} */ month) => ({ key: title, kind: 'gig', title, by: null, season: null, year: null, provider: null, month, reason: 'gig', poster: null });
  const list = [n('Band A', '2024-03'), n('Band B', '2024-03'), n('Band C', '2024-07'), n('Band D', '2025-02'), n('Band E', '2026-05')];
  const v = /** @type {any} */ (buildSection('live', { headline: { value: 1, unit: '', label: 'live events this year' }, notable: [list[4]] }, new Date('2026-06-01'), list));
  assert.equal(v.total, 5);
  const by = Object.fromEntries(v.stats.map((/** @type {any} */ r) => [r.label, r]));
  assert.equal(by['Seen live'].value, '5');
  assert.equal(by['Busiest month'].value, 'Mar 2024');
  assert.equal(by['Busiest month'].sub, '2 events');
  assert.equal(by['Longest gap'].value, '14'); // Mar 2025 .. Apr 2026
  assert.equal(by['Longest gap'].sub, 'March 2025 to April 2026');
  assert.equal(by['Busiest year'].value, '2024');
  assert.deepEqual(v.yearRows.map((/** @type {any} */ y) => [y.year, y.total]), [['2026', 1], ['2025', 1], ['2024', 3]]);
  assert.equal(v.charts.length, 1);
  assert.deepEqual(v.charts[0].xTicks.map((/** @type {any} */ t) => t.label), ['2024', '2025', '2026']);
  assert.ok(v.charts[0].yTicks.every((/** @type {any} */ t) => /^\d+$/.test(t.label)));
  assert.doesNotMatch(JSON.stringify(v), /\d{4}-\d{2}-\d{2}/);
  // no form in an older export: a gig is a gig
  assert.deepEqual(v.kinds.map((/** @type {any} */ k) => [k.key, k.count, k.pct]), [['gig', 5, 100]]);
});

test('live view: ticket stubs, newest first, numbered from the first ever', () => {
  const n = (/** @type {string} */ title, /** @type {string} */ month, /** @type {any} */ extra = {}) => ({ key: title, kind: 'gig', title, month, poster: null, ...extra });
  const list = [
    n('Invented Musical', '2025-10', { form: 'musical', poster: 'https://storage.googleapis.com/b/site/james/life/live/0123456789abcdef.jpg', posterCredit: 'A Photographer, CC BY-SA 4.0', posterSource: 'commons' }),
    n('Invented Band', '2025-03', { form: 'gig', poster: 'javascript:alert(1)' }),
    n('Invented Comic', '2024-11', { form: 'comedy' }),
    n('Invented Play', '2025-10', { form: 'theatre', poster: 'https://x.example/p.jpg', posterSource: 'mail' }),
    n('Invented Thing', '2024-02', { form: 'weird' }),
  ];
  const v = /** @type {any} */ (buildSection('live', { headline: { value: 3, unit: '', label: 'x' } }, new Date('2026-06-01'), list));
  const y25 = v.yearRows.find((/** @type {any} */ y) => y.year === '2025');
  assert.deepEqual(y25.stubs.map((/** @type {any} */ s) => s.title), ['Invented Musical', 'Invented Play', 'Invented Band']);
  const m = y25.stubs[0];
  assert.equal(m.kind, 'musical');
  assert.equal(m.kindLabel, 'Musical');
  assert.equal(m.stamp, 'Oct 2025');
  assert.equal(m.no, '005', 'numbered in the order seen, first ever is 001');
  assert.equal(m.poster, 'https://storage.googleapis.com/b/site/james/life/live/0123456789abcdef.jpg');
  assert.equal(m.credit, 'Photo: A Photographer, CC BY-SA 4.0');
  assert.equal(typeof m.tilt, 'number');
  assert.equal(y25.stubs[1].credit, '', 'a picture from the booking mail carries no credit line');
  assert.equal(y25.stubs[2].poster, '', 'an unsafe poster is dropped');
  assert.equal(y25.stubs[2].hasPoster, false);
  const all = v.yearRows.flatMap((/** @type {any} */ y) => y.stubs);
  assert.equal(all.find((/** @type {any} */ s) => s.title === 'Invented Thing').kind, 'other', 'an unknown form is other');
  assert.equal(all.find((/** @type {any} */ s) => s.title === 'Invented Thing').no, '001');
  // the breakdown by kind: biggest first, shares sum to 100, every kind has its own ink key
  assert.equal(v.kinds.reduce((/** @type {number} */ a, /** @type {any} */ k) => a + k.pct, 0), 100);
  assert.deepEqual(v.kinds.map((/** @type {any} */ k) => k.count), [1, 1, 1, 1, 1]);
  assert.ok(v.kinds.every((/** @type {any} */ k) => /^(musical|theatre|gig|comedy|festival|classical|other)$/.test(k.key)));
  assert.deepEqual(y25.kinds.map((/** @type {any} */ k) => k.key).sort(), ['gig', 'musical', 'theatre']);
  assert.ok(v.stats.some((/** @type {any} */ r) => r.label === 'Pictured' && r.value === '2'));
});

test('live hub note names the latest night and its kind', () => {
  const list = [{ key: 'a', kind: 'gig', title: 'Invented Band', month: '2025-03', form: 'gig' }, { key: 'b', kind: 'gig', title: 'Invented Musical', month: '2026-10', form: 'musical' }];
  const v = buildSection('live', { headline: { value: 1, unit: '', label: 'x' } }, now, list);
  assert.deepEqual(hubNote('live', v), { label: 'Latest musical', value: 'Invented Musical', href: '' });
});

test('listening keeps concerts, not musicals or plays', () => {
  const list = [{ key: 'a', kind: 'gig', title: 'Invented Band', month: '2026-10', form: 'gig' },
    { key: 'b', kind: 'gig', title: 'Invented Musical', month: '2026-10', form: 'musical' },
    { key: 'c', kind: 'gig', title: 'Invented Old Act', month: '2026-09' }];
  const v = /** @type {any} */ (buildSection('listening', fixture.sections.listening, now, list));
  assert.deepEqual(v.saw.map((/** @type {any} */ s) => s.title).sort(), ['Invented Band', 'Invented Old Act']);
});

test('the live page draws a stub per event, with or without a picture', async () => {
  const list = [
    { key: 'a', kind: 'gig', title: 'Invented Musical', month: '2025-10', form: 'musical', poster: 'https://storage.googleapis.com/b/site/james/life/live/0123456789abcdef.jpg', posterCredit: 'A Photographer, CC BY-SA 4.0', posterSource: 'commons' },
    { key: 'b', kind: 'gig', title: "Invented Band's Night", month: '2024-03', form: 'gig' },
  ];
  const sec = buildSection('live', { headline: { value: 1, unit: '', label: 'live events this year' } }, new Date('2026-06-01'), list);
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'live-page-'));
  try {
    const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const pages = path.join(tmp, 'pages');
    await fs.mkdir(pages);
    await fs.copyFile(path.join(REPO, 'personal/pages/life/live.html'), path.join(pages, 'live.html'));
    const out = path.join(tmp, 'out');
    await runSkierTasks([generatePagesTask({
      pagesDir: pages, partialsDir: path.join(REPO, 'personal/partials'), outDir: out, helpers: templateHelpers,
      additionalVarsFn: () => ({ page: 'life', section: sec }),
    })], { siteUrl: 'https://james.ripixel.co.uk', cacheHash: 'test', year: 2026 }, []);
    const html = await fs.readFile(path.join(out, 'live.html'), 'utf8');
    assert.equal((html.match(/<li class="stub stub--/g) || []).length, 2);
    const img = /<img [^>]*class="stub__img"[^>]*>/.exec(html)?.[0] || '';
    assert.match(img, /alt="Invented Musical"/);
    assert.match(img, /loading="lazy"/);
    assert.match(html, /Photo: A Photographer, CC BY-SA 4\.0/);
    assert.match(html, /stub--gig[\s\S]*?stub__glyph/, 'no picture: the kind in type');
    assert.match(html, /Invented Band&#x27;s Night/);
    assert.match(html, /class="live-kinds/);
    assert.doesNotMatch(html, /\d{4}-\d{2}-\d{2}/);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}, { timeout: 60_000 });

test('live view: nothing seen is an empty list, not a crash', () => {
  const v = /** @type {any} */ (buildSection('live', { headline: { value: 0, unit: '', label: 'live events this year' } }, new Date(), []));
  assert.equal(v.total, 0);
  assert.deepEqual(v.yearRows, []);
});
