// @ts-check
// Run with `npm test` (node:test, no extra dependencies).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { athleteWords } from './fitness-words.mjs';
import { buildHyroxHistory, buildRaceView, groupEvents, partnerName, pbChase, deltaClock, clock } from './fitness-hyrox.mjs';
import { buildActivityView, createActivityRenderer } from './fitness-activity-pages.mjs';
import { buildEventView, dateRange, generateEventPagesTask } from './fitness-event-pages.mjs';
import { activityCard } from './fitness-og-images.mjs';

const STATIONS = [['skierg', 'SkiErg'], ['sled_push', 'Sled Push'], ['sled_pull', 'Sled Pull'], ['burpee_broad_jump', 'Burpee Broad Jumps'], ['rowing', 'Row'], ['farmers_carry', 'Farmers Carry'], ['sandbag_lunges', 'Sandbag Lunges'], ['wall_balls', 'Wall Balls']];

/**
 * A minimal activity file with an export `race` key: 8 runs of `run` seconds and 8
 * stations of `stn` seconds (station i gets stn + i so they differ).
 */
function raceFile({ slug, date, title, division, label, total, run, stn, event = 'Birmingham', sim = false, desc = '', hr = 160, ranks = [0, 0], roxzone = 400, photos = [] }) {
  const segments = [];
  STATIONS.forEach(([key, l], i) => {
    segments.push({ key: `run_${i + 1}`, label: `Run ${i + 1}`, isRun: true, durationSeconds: run, startOffsetSeconds: 0, avgHr: hr, maxHr: hr + 8 });
    segments.push({ key, label: l, isRun: false, durationSeconds: stn + i, startOffsetSeconds: 0, avgHr: hr + 5, maxHr: hr + 12 });
  });
  return {
    slug,
    category: 'strength',
    activity: { showcaseId: slug, title, startTime: date, activityType: 'ACTIVITY_TYPE_CROSSFIT', description: desc, appliedEnrichments: [], enrichments: {}, photoUrls: photos, activityData: { sessions: [] } },
    entry: { showcaseId: slug, title, startTime: date },
    series: {},
    routePoints: [],
    race: {
      raceType: 'hyrox', division: division ? { key: division, label, source: 'official' } : null, isSimulation: sim, event,
      totalSeconds: total, totalSource: 'elapsed', runSeconds: run * 8, stationSeconds: stn * 8 + 28, roxzoneSeconds: roxzone,
      overallRank: ranks[0], ageGroupRank: ranks[1], splitSource: 'official', startsEstimated: true, hasHeartRate: true, segments,
    },
  };
}

const olympia = raceFile({ slug: 'olympia', date: '2026-03-28T11:39:57Z', title: 'Hyrox - London Olympia', division: 'men_open', label: "Open Men's Solo", total: 5027, run: 340, stn: 300, event: 'London Olympia', roxzone: 0 });
const sim = raceFile({ slug: 'sim', date: '2026-02-01T10:56:21Z', title: 'Hyrox Sim', division: 'men_open', label: "Open Men's Solo", total: 4756, run: 330, stn: 250, event: '', sim: true });
const rome = raceFile({ slug: 'rome', date: '2026-09-27T14:50:05Z', title: 'HYROX - Rome', division: 'men_doubles', label: "Open Men's Doubles", total: 4354, run: 300, stn: 180, event: 'Rome' });
const doubles = raceFile({ slug: 'bham-doubles', date: '2026-10-27T12:10:02Z', title: "Hyrox Birmingham - Open Men's Doubles", division: 'men_doubles', label: "Open Men's Doubles", total: 4529, run: 330, stn: 170, desc: "Completed via ROXFIT\n\n🏆 Division: Doubles Men\n\nFirst of two races over two days, and Stephen's first Hyrox!\n\n✨ AI Summary:\nA demanding effort." });
const solo = raceFile({ slug: 'bham-solo', date: '2026-10-28T08:20:02Z', title: "Hyrox Birmingham - Open Men's Solo", division: 'men_open', label: "Open Men's Solo", total: 5382, run: 320, stn: 310, ranks: [270, 60], desc: 'Completed via ROXFIT\n\n🏆 Division: Open Men\n📊 Overall Rank: 270\n\n⏱️ Split Times:\nRun 1: 5:39\nRoxzone: 7:24\n\n\nTwo races within 20hrs?! WHAT WAS I THINKING??\n\n✨ AI Summary:\nGrit.' });
const all = [solo, doubles, rome, olympia, sim];

describe('per-division PBs', () => {
  const h = buildHyroxHistory(all);
  test('divisions are tracked separately and simulations never count', () => {
    assert.deepEqual(h.divisions.map((d) => d.key).sort(), ['men_doubles', 'men_open']);
    const open = h.byDivision.get('men_open');
    assert.deepEqual(open?.races.map((r) => r.slug), ['olympia', 'bham-solo'], 'the 1:19 sim is not a race');
    assert.equal(open?.best.total_time.seconds, 5027, 'solo PB is Olympia 1:23:47, not the doubles 1:15:29');
    assert.equal(h.byDivision.get('men_doubles')?.best.total_time.seconds, 4354, 'doubles PB is Rome');
  });
  test('the Birmingham solo is +5:55 on the Olympia PB; the doubles +2:55 on Rome', () => {
    const s = buildRaceView(solo, h);
    assert.equal(s?.totalDelta, '+5:55');
    assert.equal(s?.totalTone, 'loss');
    assert.equal(s?.isTotalPB, false);
    const d = buildRaceView(doubles, h);
    assert.equal(d?.totalDelta, '+2:55');
    assert.equal(d?.totalPbTitle, 'HYROX - Rome');
  });
  test('every run and station gets a delta to the division PB as it stood', () => {
    const s = buildRaceView(solo, h);
    const run1 = s?.rows.find((r) => r.key === 'run_1');
    assert.equal(run1?.delta, '−0:20');
    assert.equal(run1?.deltaTone, 'gain');
    assert.equal(run1?.isPB, true);
    const ski = s?.rows.find((r) => r.key === 'skierg');
    assert.equal(ski?.delta, '+0:10');
    assert.equal(ski?.isPB, false);
    assert.equal(s?.rows.length, 16);
    assert.equal(s?.ranks[0].value, '#270');
  });
  test('a first race in a division is a benchmark, not a PB, and has no deltas', () => {
    const o = buildRaceView(olympia, h);
    assert.equal(o?.isFirst, true);
    assert.equal(o?.isTotalPB, false);
    assert.equal(o?.totalDelta, '');
    assert.equal(o?.prCount, 0);
  });
  test('a faster race is a PB', () => {
    const fast = raceFile({ slug: 'manc', date: '2027-03-01T09:00:00Z', title: 'Hyrox Manchester - Open Men\'s Solo', division: 'men_open', label: "Open Men's Solo", total: 4900, run: 300, stn: 280 });
    const h2 = buildHyroxHistory([...all, fast]);
    const v = buildRaceView(fast, h2);
    assert.equal(v?.isTotalPB, true);
    assert.equal(v?.totalDelta, '−2:07');
    assert.equal(v?.totalTone, 'gain');
  });
  test('a simulation shows deltas against the PBs of its day but never claims one', () => {
    const v = buildRaceView(sim, buildHyroxHistory(all));
    assert.equal(v?.isSimulation, true);
    assert.equal(v?.prCount, 0);
  });
  test('delta clock formatting', () => {
    assert.equal(deltaClock(355), '+5:55');
    assert.equal(deltaClock(-12), '−0:12');
    assert.equal(deltaClock(0), '±0:00');
    assert.equal(clock(5382), '1:29:42');
  });
});

describe('race weekends', () => {
  test('races at the same event within a few days form one event, any number of divisions', () => {
    const h = buildHyroxHistory(all);
    assert.equal(h.events.length, 1);
    assert.equal(h.events[0].slug, 'hyrox-birmingham-2026-10-27');
    assert.deepEqual(h.events[0].slugs, ['bham-doubles', 'bham-solo']);
    assert.equal(h.eventBySlug.get('rome'), undefined);
  });
  test('grouping is generic: three races, a later separate visit, unnamed events', () => {
    const ev = groupEvents([
      { slug: 'a', date: '2027-05-01T09:00:00Z', event: 'London Excel', location: '' },
      { slug: 'b', date: '2027-05-02T09:00:00Z', event: 'London ExCeL', location: '' },
      { slug: 'c', date: '2027-05-04T09:00:00Z', event: 'London Excel', location: '' },
      { slug: 'd', date: '2027-11-01T09:00:00Z', event: 'London Excel', location: '' },
      { slug: 'e', date: '2027-11-01T12:00:00Z', event: '', location: 'Olympia, London' },
      { slug: 'f', date: '2027-11-02T12:00:00Z', event: '', location: 'Olympia, London' },
    ]);
    assert.deepEqual(ev.map((e) => e.slugs), [['e', 'f'], ['a', 'b', 'c']]);
  });
  test('event view: cards, splits side by side, a PB chase per division raced, a photo collage', async () => {
    const h = buildHyroxHistory(all);
    const v = buildEventView(h.events[0], h, { profile: { displayName: 'James King', showPhotoGallery: true } }, { siteUrl: 'https://example.test' });
    assert.equal(v.ev.name, 'Hyrox Birmingham');
    assert.equal(v.ev.range, '27–28 Oct 2026');
    assert.equal(v.ev.cards.length, 2);
    assert.equal(v.ev.compare.length, 16);
    assert.equal(v.ev.compare[0].cells.length, 2);
    assert.deepEqual(v.ev.chases.map((p) => p.key).sort(), ['men_doubles', 'men_open'], 'every division raced at the event');
    assert.deepEqual(v.ev.collage, [], 'no photos, no collage');
    assert.equal(v.canonical, 'https://example.test/life/event/hyrox-birmingham-2026-10-27');
    assert.equal(v.ev.cards[0].partner, 'Stephen');
  });
  test('date ranges', () => {
    assert.equal(dateRange('2026-10-27T12:00:00Z', '2026-10-28T08:00:00Z'), '27–28 Oct 2026');
    assert.equal(dateRange('2026-09-30T12:00:00Z', '2026-10-02T08:00:00Z'), '30 Sep – 2 Oct 2026');
  });
  test('the task writes one page per event and links back to every race', async () => {
    const out = await fs.mkdtemp(path.join(os.tmpdir(), 'ev-'));
    const task = generateEventPagesTask({ outDir: out });
    const logs = [];
    const res = await task.run(task.config, { globals: { fitnessActivities: all, fitnessIndex: { profile: { displayName: 'James King' } }, siteUrl: '' }, logger: { info: (m) => logs.push(m), warn: (m) => logs.push(m), debug() {}, error() {} } });
    assert.deepEqual(res.fitnessEventSlugs, ['hyrox-birmingham-2026-10-27']);
    const html = await fs.readFile(path.join(out, 'life', 'event', 'hyrox-birmingham-2026-10-27', 'index.html'), 'utf8');
    assert.match(html, /href="\/life\/activity\/bham-doubles"/);
    assert.match(html, /href="\/life\/activity\/bham-solo"/);
    assert.match(html, /splits side by side/);
  });
  test("the header is a collage of each race's photo, and the cards then carry none", async () => {
    const withPhotos = all.map((f) => (f.slug.startsWith('bham') ? { ...f, activity: { ...f.activity, photoUrls: [`https://x.test/${f.slug}.jpg`] } } : f));
    const out = await fs.mkdtemp(path.join(os.tmpdir(), 'ev-'));
    const task = generateEventPagesTask({ outDir: out });
    const quiet = { info() {}, warn() {}, debug() {}, error() {} };
    await task.run(task.config, { globals: { fitnessActivities: withPhotos, fitnessIndex: { profile: { displayName: 'James King', showPhotoGallery: true } }, siteUrl: '' }, logger: quiet });
    const html = await fs.readFile(path.join(out, 'life', 'event', 'hyrox-birmingham-2026-10-27', 'index.html'), 'utf8');
    assert.equal((html.match(/class="ev-collage__tile"/g) || []).length, 2);
    assert.doesNotMatch(html, /class="ev-race__art"/);
  });
});

describe('activity page', () => {
  const h = buildHyroxHistory(all);
  test('his words, not ROXFIT\'s header, and the partner from them', () => {
    const v = buildActivityView(doubles, {}, { hyrox: h });
    assert.equal(v.act.description, "First of two races over two days, and Stephen's first Hyrox!");
    assert.equal(v.act.race?.partner, 'Stephen');
    assert.equal(v.act.eventLink?.url, '/life/event/hyrox-birmingham-2026-10-27');
    assert.equal(v.act.eventLink?.others[0].title, "Hyrox Birmingham - Open Men's Solo");
  });
  test('race anchors lead with the finish time and the official placings', () => {
    const v = buildActivityView(solo, {}, { hyrox: h });
    assert.deepEqual(v.act.anchors.slice(0, 3).map((a) => a.value), ['1:29:42', '#270', '#60']);
    assert.ok(v.act.raceDay.some((d) => d.label === 'division' && d.value === "Open Men's Solo"));
    assert.equal(v.act.chase?.key, 'men_open', "only this race's division");
  });
  test('division-less FitGlue hybrid records are dropped; a division PB gets the band', () => {
    const fast = raceFile({ slug: 'manc', date: '2027-03-01T09:00:00Z', title: "Hyrox Manchester - Open Men's Solo", division: 'men_open', label: "Open Men's Solo", total: 4900, run: 300, stn: 280 });
    fast.activity.appliedEnrichments = ['ENRICHER_PROVIDER_PERSONAL_RECORDS'];
    fast.activity.enrichments = { personalRecords: { records: [{ recordType: 'hybrid_race_hyrox_total_time', newValue: 4900, unit: 'seconds' }] } };
    const v = buildActivityView(fast, {}, { hyrox: buildHyroxHistory([...all, fast]) });
    assert.equal(v.act.prBand?.label, "OPEN MEN'S SOLO PB");
    assert.equal(v.act.prBand?.value, '1:21:40');
    assert.equal(v.act.prBand?.delta, '−2:07');
    const callout = v.act.modules.find((m) => m.key === 'pr-callout');
    assert.equal(callout, undefined, 'the stale division-less record is not listed');
  });
  test('the page renders the race card, the words, the race-day strip and the event link', async () => {
    const render = await createActivityRenderer();
    const html = render({ ...buildActivityView(solo, {}, { hyrox: h }) });
    assert.match(html, /class="act-words"/);
    assert.match(html, /act-race__row/);
    assert.match(html, /\+5:55/);
    assert.match(html, /act-eventlink/);
    assert.match(html, /PB chase · Open Men&#x27;s Solo/);
    assert.doesNotMatch(html, /Open Men&#x27;s Doubles PB chase/, 'no doubles chart on the solo page');
    assert.doesNotMatch(html, /Completed via ROXFIT/);
  });
  test('OG card: division in the kicker, total first, the PB gap as the footnote', () => {
    const c = activityCard(solo, {}, h);
    assert.match(c?.card.kicker ?? '', /^HYROX · Open Men's Solo/);
    assert.equal(c?.card.stats[0].value, '1:29:42');
    assert.equal(c?.card.footnote, "+5:55 VS OPEN MEN'S SOLO PB 1:23:47");
    assert.equal(c?.card.pill, 'HYROX');
  });
  test('the gallery opens in a lightbox, wrapping prev/next', () => {
    const f = structuredClone(solo);
    f.activity.photoUrls = ['https://x.test/1.jpg', 'https://x.test/2.jpg'];
    const v = buildActivityView(f, { profile: { showPhotoGallery: true } }, { hyrox: h });
    assert.deepEqual(v.act.gallery.map((g) => [g.id, g.prev, g.next]), [['photo-1', '#photo-2', '#photo-2'], ['photo-2', '#photo-1', '#photo-1']]);
  });
});

describe('partner credit', () => {
  const r = { division: { key: 'men_doubles' }, event: 'Rome' };
  test('falls out of the usual phrasings, only for doubles, only when unambiguous', () => {
    assert.equal(partnerName("Stephen's first Hyrox", '', r), 'Stephen');
    assert.equal(partnerName('thank you Dean for getting me through', '', r), 'Dean');
    assert.equal(partnerName('Raced with Sam today', '', r), 'Sam');
    assert.equal(partnerName("Stephen's first Hyrox, thank you Dean", '', r), '', 'two names: say nothing');
    assert.equal(partnerName("Stephen's first Hyrox", '', { division: { key: 'men_open' } }), '', 'solo');
    assert.equal(partnerName('So hot in Rome', '', r), '');
  });
});

describe('PB chase (point in time)', () => {
  const h = buildHyroxHistory(all);
  test('the Birmingham solo is red against the Olympia PB it was chasing; Olympia is context', () => {
    const c = pbChase(h, 'men_open', ['bham-solo']);
    assert.equal(c?.rows.length, 1);
    const r = c?.rows[0];
    assert.equal(r?.tone, 'loss', 'slower than the PB: red, not green');
    assert.equal(r?.delta, '+5:55');
    assert.equal(r?.pbTime, '1:23:47');
    assert.ok((r?.pbLeft ?? 0) < (r?.left ?? 0), 'faster is to the left');
    assert.deepEqual(c?.context.map((x) => x.url), ['/life/activity/olympia'], 'earlier races only; the sim is left out');
    assert.equal(c?.plot, true);
  });
  test('Olympia stops at Olympia: the later Birmingham solo is not shown, and it was a PB when run', () => {
    const c = pbChase(h, 'men_open', ['olympia']);
    assert.deepEqual(c?.context, [], 'nothing after it');
    assert.equal(c?.count, 1);
    assert.equal(c?.plot, false, 'a lone race gets the verdict, no axis');
    assert.equal(c?.rows[0].tone, 'gain');
    assert.equal(c?.rows[0].verdict, "PB — first Open Men's Solo");
    const v = buildRaceView(olympia, h);
    assert.equal(v?.firstLabel, "PB — first Open Men's Solo");
    assert.equal(v?.totalDelta, '', 'no PB stood before it');
  });
  test('Rome shows doubles only, up to Rome', () => {
    const v = buildActivityView(rome, {}, { hyrox: h });
    assert.equal(v.act.chase?.key, 'men_doubles');
    assert.deepEqual(v.act.chase?.context, []);
    assert.equal(v.act.race?.firstLabel, "PB — first Open Men's Doubles");
  });
  test('a new PB is green and measured against the PB that stood before it', () => {
    const fast = raceFile({ slug: 'manc', date: '2027-03-01T09:00:00Z', title: "Hyrox Manchester - Open Men's Solo", division: 'men_open', label: "Open Men's Solo", total: 4900, run: 300, stn: 280 });
    const c = pbChase(buildHyroxHistory([...all, fast]), 'men_open', ['manc']);
    assert.equal(c?.rows[0].tone, 'gain');
    assert.equal(c?.rows[0].pbTime, '1:23:47', 'Olympia stood before it, not itself');
    assert.match(c?.rows[0].verdict ?? '', /^New Open Men's Solo PB — 2:07 faster than 1:23:47/);
    assert.deepEqual(c?.context.map((x) => x.url), ['/life/activity/olympia', '/life/activity/bham-solo']);
  });
  test('simulations and unknown divisions get no chase', () => {
    assert.equal(pbChase(h, 'men_open', ['sim']), null);
    assert.equal(pbChase(h, 'nope', ['bham-solo']), null);
  });
});

describe('his own words (contract §3.1)', () => {
  test('ROXFIT header, split table and enricher sections are dropped', () => {
    assert.equal(athleteWords(solo.activity.description), 'Two races within 20hrs?! WHAT WAS I THINKING??');
  });
  test('Hevy set dumps and FitGlue workout summaries are dropped', () => {
    assert.equal(athleteWords('Great one this morn 😅\n\nLogged with Hevy\n\nDeadlift (Dumbbell)\nSet 1: 20 kg x 12\nSet 2: 20 kg x 12'), 'Great one this morn 😅');
    assert.equal(athleteWords('Logged with Hevy\n\nWarm Up\nSet 1: 2min 21s'), '');
    assert.equal(athleteWords('Back at it 💪\n\nWorkout Summary:\n📊 22 sets • 32340kg volume • 145 reps'), 'Back at it 💪');
    assert.equal(athleteWords('Dad\'s first 5k!\n\nOfficial time: 28:31'), "Dad's first 5k!");
  });
  test('his own headings, lists and several paragraphs stay', () => {
    assert.equal(athleteWords('🥾 Day 10\n\nRequested by the brilliant coach.\n\n🔥 Streak Tracker:\n• 3 days'), '🥾 Day 10\n\nRequested by the brilliant coach.');
    assert.equal(athleteWords("today I learned:\n* Devil's press is horrific\n* 9kg wall balls are out of reach"), "today I learned:\n* Devil's press is horrific\n* 9kg wall balls are out of reach");
    assert.equal(athleteWords('Out along the Trent.\n\n🌤️ Conditions:\nClear, 11°C.\n\nPosted via FitGlue 💪'), 'Out along the Trent.');
  });
});
