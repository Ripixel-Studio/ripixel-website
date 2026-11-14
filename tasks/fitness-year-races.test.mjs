// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRaceYear, cleanTitle } from './fitness-year-races.mjs';
import { familyOf } from './fitness-year-review.mjs';
import { awardIcon, AWARD_ICON_STAMPS } from './fitness-year-icons.mjs';

const start = Date.UTC(2026, 0, 1), end = Date.UTC(2027, 0, 1);
/** @param {string} slug @param {string} day @param {string} title @param {any} extra */
const s = (slug, day, title, extra = {}) => ({ t: Date.parse(`${day}T09:00:00Z`), e: { slug, title, isRace: true, tag: 'run', durationSeconds: 1500, distanceMeters: 5000, ...extra } });

test('cleanTitle drops emoji, a trailing result and a run number', () => {
  assert.equal(cleanTitle('Hyrox - London Olympia 25/26 - 1:23:47 \u{1F389}'), 'Hyrox - London Olympia 25/26');
  assert.equal(cleanTitle('Newark Parkrun (#23)'), 'Newark Parkrun');
});

test('the tour leaves parkruns out; a title seen three times becomes a series', () => {
  const list = [
    s('a', '2026-01-11', 'Rasselbock Run - Winter 2026', { distanceMeters: 43000, durationSeconds: 21000 }),
    s('b', '2026-04-11', 'Rasselbock Run - Spring 2026', { distanceMeters: 30000, durationSeconds: 11000 }),
    s('c', '2026-07-05', 'Rasselbock Run - Summer 2026', { distanceMeters: 24000, durationSeconds: 9000 }),
    s('d', '2026-02-07', 'Newark Parkrun (#20)'), s('e', '2026-02-14', 'Newark Parkrun (#21)'), s('f', '2026-02-21', 'Newark Parkrun (#22)'),
    s('g', '2026-05-10', 'Leeds Marathon', { distanceMeters: 42500, durationSeconds: 18000 }),
  ];
  const r = buildRaceYear(list, () => null, [], { showPhotos: false, start, end });
  assert.equal(r.tour.count, 4);
  assert.equal(r.tour.parkruns, 3);
  const ras = r.series.find((x) => x.name === 'Rasselbock Run');
  assert.ok(ras);
  assert.deepEqual(ras.editions.map((e) => e.edition), ['Winter', 'Spring', 'Summer']);
  const pk = r.series.find((x) => x.kind === 'parkrun');
  assert.equal(pk?.count, 3);
  assert.ok(!r.series.some((x) => x.name === 'Leeds Marathon'));
});

test('hyrox races line up on one clock', () => {
  const seg = (key, isRun, off, d) => ({ key, label: key, isRun, startOffsetSeconds: off, durationSeconds: d });
  const race = (slug, day, event, total) => ({ slug, file: { isRace: true, race: { raceType: 'hyrox', event, totalSeconds: total, runSeconds: 100, stationSeconds: 100, roxzoneSeconds: 10, division: { label: 'Open' }, segments: [seg('run_1', true, 0, 300), seg('skierg', false, 310, 240)] } }, day });
  const rs = [race('h1', '2026-03-28', 'London', 5000), race('h2', '2026-09-27', 'Rome', 4400)];
  const files = new Map(rs.map((x) => [x.slug, x.file]));
  const list = rs.map((x) => s(x.slug, x.day, `Hyrox ${x.file.race.event}`, { durationSeconds: x.file.race.totalSeconds, distanceMeters: 0 }));
  const r = buildRaceYear(list, (slug) => files.get(slug), [], { showPhotos: false, start, end });
  const hy = r.series.find((x) => x.kind === 'hyrox');
  assert.equal(hy.lanes.length, 2);
  assert.equal(hy.lanes[0].width, 100);
  assert.equal(hy.stations[0].time, '4:00');
  assert.match(hy.blurb, /Fastest: Rome/);
});

test('gym exercises go in the right drawer', () => {
  assert.equal(familyOf('Deadlift'), 'legs');
  assert.equal(familyOf('Leg Press'), 'legs');
  assert.equal(familyOf('Lateral Raise'), 'push');
  assert.equal(familyOf('Incline Chest Press (Machine)'), 'push');
  assert.equal(familyOf('Lat Pulldown'), 'pull');
  assert.equal(familyOf('Crunch'), 'core');
  assert.equal(familyOf('Hip Adduction (Machine)'), 'legs');
  assert.equal(familyOf('Wall Ball'), 'engine');
});

test('every award has a drawing, unknown ones a star', () => {
  for (const k of AWARD_ICON_STAMPS) assert.match(awardIcon(k), /^<svg class="yr-award__icon"/);
  assert.match(awardIcon('SOMETHING NEW'), /<path class="f"/);
});
