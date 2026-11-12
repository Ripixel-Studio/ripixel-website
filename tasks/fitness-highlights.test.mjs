// @ts-check
// Run with `npm test` (node:test). The roundup highlights: what made a week, a month, a year.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildMoments, momentsIn, pickHighlights, dayStreak, matchCalendar, parkrunInfo, raceStamp,
} from './fitness-highlights.mjs';

/** A minimal activity file (entry + activity) as the export ships it. */
function act(slug, startTime, type, extra = {}) {
  const { enrichments, description, race, ...entry } = extra;
  const e = { slug, showcaseId: slug, title: slug, activityType: `ACTIVITY_TYPE_${type}`, startTime, distanceMeters: 0, durationSeconds: 3000, photoUrls: [], ...entry };
  return {
    file: { slug, entry: e, activity: { title: e.title, activityType: e.activityType, startTime, description: description || '', enrichments: enrichments || {} }, ...(race ? { race } : {}) },
    entry: e,
  };
}

/** Six months of easy history first, so "firsts" and "longest" have something to beat. */
function history() {
  const out = [];
  for (let i = 0; i < 26; i++) {
    const d = new Date(Date.UTC(2026, 0, 5 + i * 7, 8));
    out.push(act(`easy-run-${i}`, d.toISOString(), 'RUN', { title: 'Easy Run', distanceMeters: 5000, durationSeconds: 1800 }));
    out.push(act(`pilates-${i}`, new Date(d.getTime() + 864e5).toISOString(), 'PILATES', { title: 'Slow Flow Pilates' }));
  }
  return out;
}

function hyroxRace(division, total, event) {
  return {
    totalSeconds: total, event, division: { key: division, label: division === 'men_doubles' ? "Open Men's Doubles" : "Open Men's Solo" },
    segments: [{ key: 'run_1', durationSeconds: 300 }, { key: 'ski_erg', durationSeconds: 250 }],
  };
}

function data() {
  const list = history();
  list.push(
    act('morning-run-2026-10-18', '2026-10-18T08:31:00Z', 'RUN', { title: 'Morning Run', distanceMeters: 42500, durationSeconds: 15600, photoUrls: ['https://x.test/m.jpg'] }),
    act('newark-parkrun-23-2026-07-11', '2026-07-11T08:00:00Z', 'RUN', {
      title: 'Newark Parkrun (#23)', distanceMeters: 5000, durationSeconds: 1361,
      description: 'Parkrun Results:\n• Position: 16th · New all-time PB!\n• Time: 22:41 · New all-time PB!\n• Location: Newark Parkrun, 18th Parkrun here (23 total)\n\nlovely',
    }),
    act('sherwood-pines-parkrun-40-2026-10-03', '2026-10-03T08:00:00Z', 'RUN', {
      title: 'Sherwood Pines Parkrun (#40)', distanceMeters: 5100, durationSeconds: 1691,
      enrichments: { parkrun: { eventName: 'Sherwood Pines Parkrun', position: 104, finishTime: '28:11', totalParkruns: 40, isTimePb: false } },
      description: 'Parkrun Results:\n• Position: 104th\n• Location: Sherwood Pines Parkrun, 1st Parkrun here (40 total) · First time at this location!\n',
    }),
    act('hx-doubles-2026-10-27', '2026-10-27T12:10:00Z', 'CROSSFIT', { title: "Hyrox Birmingham - Open Men's Doubles", race: hyroxRace('men_doubles', 4529, 'Birmingham'), photoUrls: ['https://x.test/d.jpg'] }),
    act('hx-solo-2026-10-28', '2026-10-28T08:20:00Z', 'CROSSFIT', { title: "Hyrox Birmingham - Open Men's Solo", race: hyroxRace('men_open', 5382, 'Birmingham') }),
    act('tempo-2026-07-14', '2026-07-14T18:00:00Z', 'RUN', {
      title: 'Tempo', distanceMeters: 10000, durationSeconds: 2700,
      enrichments: { personalRecords: { records: [
        { recordType: 'fastest_10k', newValue: 2650, unit: 'seconds', previousValue: 2700 },
        { recordType: 'fastest_400m', newValue: 90, unit: 'seconds', previousValue: 92 },
        { recordType: 'fastest_1k', newValue: 230, unit: 'seconds' }, // first ever: not a PB
      ] } },
    }),
    act('yoga-2026-08-01', '2026-08-01T10:00:00Z', 'YOGA', { title: 'Hotpod Yoga' }),
  );
  const past = [
    { calendar: 'events', title: 'Yorkshire Marathon', start: '2026-10-18T09:30:00+01:00', kind: 'race' },
    { calendar: 'events', title: "Hyrox Birmingham - Open Men's Doubles", start: '2026-10-27T12:10:00+00:00', kind: 'race' },
    { calendar: 'events', title: "Hyrox Birmingham - Open Men's Solo", start: '2026-10-28T08:20:00+00:00', kind: 'race' },
    { calendar: 'events', title: 'VO2 Max Test', start: '2026-09-02T09:00:00+01:00', kind: 'other' },
  ];
  return { files: list.map((x) => x.file), entries: list.map((x) => x.entry), past };
}

const ms = (iso) => Date.parse(iso);

describe('roundup highlights', () => {
  const d = data();
  const moments = buildMoments({ files: d.files, entries: d.entries, past: d.past });
  const byId = new Map(moments.map((m) => [m.slug || m.id, m]));

  test('raceStamp names the distance from the race title or the run', () => {
    assert.equal(raceStamp('Yorkshire Marathon', 42500).stamp, 'MARATHON');
    assert.equal(raceStamp('Newark Half Marathon', 21100).stamp, 'HALF MARATHON');
    assert.equal(raceStamp('Rutland Night 10k', 10100).stamp, '10K');
    assert.equal(raceStamp('Rasselbock Run - Winter 2026', 43200).stamp, 'ULTRA');
    assert.equal(raceStamp('Spartan Race', 6100).stamp, 'RACE');
    assert.ok(raceStamp('Yorkshire Marathon', 42500).score > raceStamp('Rutland Night 10k', 10100).score);
  });

  test('a calendar race takes its name from the calendar, its numbers from the run that day', () => {
    const m = byId.get('morning-run-2026-10-18');
    assert.equal(m.title, 'Yorkshire Marathon');
    assert.equal(m.stamp, 'MARATHON');
    assert.equal(m.value, '4:20:00');
    assert.match(m.sub, /42\.5 km/);
    assert.equal(m.href, '/life/activity/morning-run-2026-10-18');
    assert.equal(m.photo, 'https://x.test/m.jpg');
    assert.ok(m.tags.includes('LONGEST RUN YET'), 'longest run yet folds into the race');
  });

  test('matchCalendar prefers the activity whose title shares words, else the longest', () => {
    const day = [d.entries.find((e) => e.slug === 'hx-solo-2026-10-28')];
    assert.equal(matchCalendar({ title: "Hyrox Birmingham - Open Men's Solo", start: '2026-10-28T08:20:00+00:00' }, day)?.slug, 'hx-solo-2026-10-28');
    assert.equal(matchCalendar({ title: 'Nothing that day', start: '2026-01-01T09:00:00Z' }, []), null);
  });

  test('two Hyrox races at one venue are one race-weekend moment linking the event page', () => {
    const weekend = moments.find((m) => m.kind === 'weekend');
    assert.ok(weekend);
    assert.equal(weekend.stamp, 'RACE WEEKEND');
    assert.equal(weekend.title, 'Hyrox Birmingham');
    assert.equal(weekend.href, '/life/event/hyrox-birmingham-2026-10-27');
    assert.match(weekend.sub, /Doubles 1:15:29/);
    assert.match(weekend.sub, /Solo 1:29:42/);
    assert.equal(moments.filter((m) => m.slug === 'hx-solo-2026-10-28').length, 0, 'the races fold into the weekend');
  });

  test('parkruns: position, time, PB and a first visit, from the enrichment or the description', () => {
    assert.deepEqual(parkrunInfo(d.files.find((f) => f.slug === 'newark-parkrun-23-2026-07-11')), { position: 16, time: '22:41', isPb: true, firstHere: false, number: 23 });
    const pines = byId.get('sherwood-pines-parkrun-40-2026-10-03');
    assert.equal(pines.stamp, 'PARKRUN');
    assert.equal(pines.value, '28:11');
    assert.match(pines.sub, /104th/);
    assert.match(pines.sub, /first time here/);
    const pb = byId.get('newark-parkrun-23-2026-07-11');
    assert.match(pb.sub, /parkrun PB/);
    assert.ok(pb.score > pines.score, 'a PB outranks a first visit');
  });

  test('PBs only when there was a record to beat; the longest distance leads', () => {
    const m = byId.get('tempo-2026-07-14');
    assert.equal(m.stamp, 'PB');
    assert.equal(m.title, '10K PB');
    assert.equal(m.value, '44:10');
    assert.match(m.sub, /−50s/);
    assert.match(m.sub, /\+1 more/);
  });

  test('a first: the first session of a kind never done before', () => {
    const m = byId.get('yoga-2026-08-01');
    assert.equal(m.stamp, 'FIRST');
    assert.match(m.title, /first yoga/i);
  });

  test('a calendar one-off with no activity still shows, quietly', () => {
    const m = moments.find((x) => x.title === 'VO2 Max Test');
    assert.ok(m);
    assert.equal(m.href, null);
    assert.equal(m.stamp, 'ON THE CALENDAR');
  });

  test('momentsIn keeps a period; pickHighlights ranks and caps by period type', () => {
    const wk = momentsIn(moments, ms('2026-10-26T00:00:00Z'), ms('2026-11-02T00:00:00Z'));
    assert.deepEqual(wk.map((m) => m.kind), ['weekend']);
    const oct = pickHighlights(momentsIn(moments, ms('2026-10-01T00:00:00Z'), ms('2026-11-01T00:00:00Z')), 'month');
    assert.deepEqual(oct.map((m) => m.title), ['Hyrox Birmingham', 'Yorkshire Marathon', 'Sherwood Pines Parkrun (#40)']);
    assert.equal(oct[0].lead, true);
    const year = pickHighlights(momentsIn(moments, ms('2026-01-01T00:00:00Z'), ms('2027-01-01T00:00:00Z')), 'week');
    assert.ok(year.length <= 5, 'a week shows five at most');
  });

  test('dayStreak: the longest run of consecutive active days', () => {
    assert.deepEqual(dayStreak(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-05']), { days: 3, from: '2026-10-01', to: '2026-10-03' });
    assert.deepEqual(dayStreak([]), { days: 0, from: '', to: '' });
  });

  test('no emoji or person names leak from the machinery: stamps are plain words', () => {
    for (const m of moments) assert.match(m.stamp, /^[A-Z0-9 ]+$/);
  });
});

describe('folding and repeats', () => {
  test('a parkrun with a PB is the parkrun, tagged with the record', () => {
    const p = act('newark-parkrun-12-2025-12-20', '2025-12-20T09:00:00Z', 'RUN', {
      title: 'Newark Parkrun (#12)', distanceMeters: 5000, durationSeconds: 1572,
      enrichments: { personalRecords: { records: [{ recordType: 'fastest_5k', newValue: 1572, unit: 'seconds', previousValue: 1626 }] } },
    });
    const early = act('first-run', '2025-09-01T09:00:00Z', 'RUN', { distanceMeters: 3000 });
    const ms = buildMoments({ files: [early.file, p.file], entries: [early.entry, p.entry] });
    const m = ms.find((x) => x.slug === 'newark-parkrun-12-2025-12-20');
    assert.equal(m.kind, 'parkrun');
    assert.deepEqual(m.tags, ['5K PB']);
    assert.ok(m.score >= 60);
  });

  test('the same PB set twice in a period shows once, the latest', () => {
    const base = { kind: 'pb', stamp: 'PB', title: '5K PB', value: '', unit: '', sub: '', date: '', href: null, photo: '', typeKey: 'run', typeClass: '', slug: '', slugs: [], tags: [], score: 70 };
    const picked = pickHighlights([{ ...base, id: 'a', t: 1, value: '26:12' }, { ...base, id: 'b', t: 2, value: '25:10' }], 'year');
    assert.deepEqual(picked.map((m) => m.value), ['25:10']);
  });
});
