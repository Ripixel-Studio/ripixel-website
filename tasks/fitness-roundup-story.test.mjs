// @ts-check
// Run with `npm test` (node:test). The week / month / year layouts' data.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { buildStory, storyContext } from './fitness-roundup-story.mjs';

function entry(slug, startTime, type, extra = {}) {
  return { slug, showcaseId: slug, title: slug, activityType: `ACTIVITY_TYPE_${type}`, startTime, distanceMeters: 0, durationSeconds: 3000, photoUrls: [], ...extra };
}

const entries = [
  entry('pilates-1', '2026-10-05T07:00:00Z', 'PILATES'),
  entry('parkrun-41', '2026-10-10T08:00:00Z', 'RUN', { title: 'Newark Parkrun (#41)', distanceMeters: 5000, durationSeconds: 1479, photoUrls: ['https://x.test/p41.jpg'] }),
  entry('long-run', '2026-10-18T08:30:00Z', 'RUN', { title: 'Morning Run', distanceMeters: 42500, durationSeconds: 15600, photoUrls: ['https://x.test/york.jpg'] }),
  entry('pt-1', '2026-10-19T10:00:00Z', 'WEIGHT_TRAINING', { title: 'Lower body', totalWeightKg: 3900 }),
  entry('pt-2', '2026-10-20T10:00:00Z', 'WEIGHT_TRAINING', { title: 'Upper body', totalWeightKg: 2100 }),
  entry('pt-3', '2026-10-21T10:00:00Z', 'WEIGHT_TRAINING', { title: 'Intervals' }),
  entry('pt-4', '2026-10-22T10:00:00Z', 'WEIGHT_TRAINING', { title: 'Strength' }),
  entry('march', '2026-03-14T10:00:00Z', 'RUN', { distanceMeters: 5000 }),
];
const files = entries.map((e) => ({ slug: e.slug, entry: e, activity: { title: e.title, activityType: e.activityType, startTime: e.startTime, enrichments: {} } }));
const past = [{ calendar: 'events', title: 'Yorkshire Marathon', start: '2026-10-18T09:30:00+01:00', kind: 'race' }];
const roundupFiles = [
  { key: 'week-42-2026', roundup: { periodStart: '2026-10-12T00:00:00Z', periodEnd: '2026-10-19T00:00:00Z', totalActivities: 1 } },
  { key: 'week-43-2026', roundup: { periodStart: '2026-10-19T00:00:00Z', periodEnd: '2026-10-26T00:00:00Z', totalActivities: 4 } },
  { key: 'month-10-2026', roundup: { periodStart: '2026-10-01T00:00:00Z', periodEnd: '2026-11-01T00:00:00Z', totalActivities: 7 } },
  { key: 'month-03-2026', roundup: { periodStart: '2026-03-01T00:00:00Z', periodEnd: '2026-04-01T00:00:00Z', totalActivities: 1 } },
  { key: 'year-2026', roundup: { periodStart: '2026-01-01T00:00:00Z', periodEnd: '2027-01-01T00:00:00Z', totalActivities: 8 } },
];
const ctx = storyContext({ files, entries, past, roundupFiles });

describe('roundup story', () => {
  test('a week is seven days of sessions, rest days included, highlights marked', () => {
    const s = buildStory(roundupFiles[0], 'week', ctx);
    assert.equal(s.days.length, 7);
    assert.deepEqual(s.days.map((d) => d.label), ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']);
    assert.deepEqual(s.days.map((d) => d.num), ['12', '13', '14', '15', '16', '17', '18']);
    const sun = s.days[6];
    assert.equal(sun.sessions.length, 1);
    assert.equal(sun.sessions[0].mark, 'MARATHON');
    assert.equal(sun.sessions[0].href, '/life/activity/long-run');
    assert.equal(s.days[0].rest, true);
    assert.equal(s.lead.title, 'Yorkshire Marathon');
    assert.equal(s.cover.url, 'https://x.test/york.jpg');
  });

  test('period facts: a run of active days and the busiest week of the year join the highlights', () => {
    const s = buildStory(roundupFiles[1], 'week', ctx);
    const titles = s.highlights.map((h) => h.title);
    assert.ok(titles.includes('4 days in a row'), titles.join(' / '));
    assert.ok(titles.includes('Biggest week of 2026'), titles.join(' / '));
  });

  test('a month is a wall calendar with session dots and week bars linking the week roundups', () => {
    const s = buildStory(roundupFiles[2], 'month', ctx);
    const cells = s.calendar.weeks.flatMap((w) => w.cells);
    assert.equal(cells.filter((c) => !c.blank).length, 31);
    assert.equal(s.calendar.weeks[0].cells.findIndex((c) => !c.blank), 3, 'October 2026 starts on a Thursday');
    const d18 = cells.find((c) => c.num === '18');
    assert.equal(d18.mark, 'MARATHON');
    assert.equal(d18.dots.length, 1);
    assert.equal(d18.dots[0].typeClass, 'fit-type--run');
    const w43 = s.weekBars.find((w) => w.key === 'week-43-2026');
    assert.equal(w43.href, '/life/roundup/week-43-2026');
    assert.equal(w43.sessions, 4);
    assert.equal(s.weekBars.find((w) => w.key === 'week-41-2026').href, null, 'no roundup, no link');
    assert.deepEqual(s.coverLines.map((c) => c.title).slice(0, 1), ['Yorkshire Marathon']);
  });

  test('a training day with no photo is filled: its inks by time, its glyph, its figure; rest days stay empty', () => {
    const s = buildStory(roundupFiles[2], 'month', ctx);
    const cells = s.calendar.weeks.flatMap((w) => w.cells);
    const d19 = cells.find((c) => c.num === '19');
    assert.equal(d19.photo, '');
    assert.deepEqual(d19.fill?.bands.map((b) => [b.typeClass, b.share]), [['fit-type--strength', '100.0%']]);
    assert.equal(d19.fill?.glyph, 'GYM');
    assert.equal(d19.fill?.stat, '3.9 t');
    assert.equal(cells.find((c) => c.num === '18').fill, null, 'a photo day draws its photo');
    assert.equal(cells.find((c) => c.num === '1').fill, null, 'a rest day stays empty');
  });

  test('a calendar day shows any session photo, not only a marked moment', () => {
    const es = entries.map((e) => (e.slug === 'pt-2' ? { ...e, photoUrls: ['https://x.test/gym.jpg'] } : e));
    const fs = es.map((e) => ({ slug: e.slug, entry: e, activity: { title: e.title, activityType: e.activityType, startTime: e.startTime, enrichments: {} } }));
    const s = buildStory(roundupFiles[2], 'month', storyContext({ files: fs, entries: es, past, roundupFiles }));
    const cells = s.calendar.weeks.flatMap((w) => w.cells);
    const d20 = cells.find((c) => c.num === '20');
    assert.equal(d20.mark, '', 'an ordinary PT day');
    assert.equal(d20.photo, 'https://x.test/gym.jpg');
    assert.equal(cells.find((c) => c.num === '18').photo, 'https://x.test/york.jpg', 'a marked day keeps its own photo');
  });

  test('a year is twelve months, each linking its roundup, stacked by type, plus its races in order', () => {
    const s = buildStory(roundupFiles[4], 'year', ctx);
    assert.equal(s.months.length, 12);
    const oct = s.months[9];
    assert.equal(oct.label, 'OCT');
    assert.equal(oct.sessions, 7);
    assert.equal(oct.href, '/life/roundup/month-10-2026');
    assert.equal(s.months[0].href, null);
    assert.ok(oct.stack.some((x) => x.typeClass === 'fit-type--strength'));
    assert.equal(oct.cover, 'https://x.test/york.jpg');
    assert.deepEqual(s.races.map((r) => r.title), ['Yorkshire Marathon']);
    assert.ok(s.photos.length >= 2);
    assert.equal(s.photos[0].url, 'https://x.test/york.jpg', 'highlight photos lead the mosaic');
  });
});

describe('pictures', () => {
  test('the lead ticket does not repeat the cover photo; a moment without a photo draws its route', () => {
    const two = [
      entry('race-a', '2026-10-27T12:00:00Z', 'RUN', { title: 'Big 10k', distanceMeters: 10000, durationSeconds: 2900, photoUrls: ['https://x.test/a1.jpg', 'https://x.test/a2.jpg'] }),
      entry('route-run', '2026-10-28T12:00:00Z', 'RUN', { title: 'Hilly one', distanceMeters: 12000, durationSeconds: 4000 }),
    ];
    const pts = Array.from({ length: 20 }, (_, i) => [52.9 + i * 0.001, -0.9 + (i % 5) * 0.001]);
    const fs2 = two.map((e) => ({ slug: e.slug, entry: e, activity: { title: e.title, activityType: e.activityType, startTime: e.startTime, enrichments: {} }, routePoints: e.slug === 'route-run' ? pts : [] }));
    const c = storyContext({ files: [...files, ...fs2], entries: [...entries, ...two], past: [{ calendar: 'events', title: 'Big 10k', start: '2026-10-27T12:00:00+00:00', kind: 'race' }], roundupFiles: [] });
    const s = buildStory({ key: 'week-44-2026', roundup: { periodStart: '2026-10-26T00:00:00Z', periodEnd: '2026-11-02T00:00:00Z' } }, 'week', c);
    assert.equal(s.cover.url, 'https://x.test/a1.jpg');
    assert.equal(s.lead.photo, 'https://x.test/a2.jpg');
    const hilly = s.highlights.find((h) => /longest/i.test(h.title) || h.title === 'Hilly one');
    if (hilly) assert.ok(hilly.route?.d, 'a photo-less moment carries its route');
    assert.ok(s.routes.length >= 1 && s.routes[0].d);
  });
});

test('showPhotoGallery off: no photos anywhere in the story, routes still draw', () => {
  const c = storyContext({ files, entries, past, roundupFiles, showPhotos: false });
  const s = buildStory(roundupFiles[2], 'month', c);
  assert.equal(s.photos.length, 0);
  assert.equal(s.cover, null);
  assert.ok(s.highlights.every((h) => !h.photo));
});
