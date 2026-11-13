// @ts-check
// The one tag system: every activity gets one of ten tags plus a Race marker, decided once
// (the export's `tag`/`isRace`, else siteTagOf), and every view reads the same answer.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TAGS, TYPE_INKS, isTag, normTag, siteTagOf, tagOf, tagTheme, themeOf, stampTag } from './fitness-theme.mjs';
import { assemble } from './fitness-fetch.mjs';
import { buildActivityView } from './fitness-activity-views.mjs';
import { buildCard, doneEntry, dominantTypes } from './fitness-life.mjs';
import { buildSessionPages } from './fitness-sessions.mjs';
import { tagBreakdown } from './fitness-roundup-views.mjs';
import { tagOfTitle } from './life-clock.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** A full activity file as the export writes it. */
function file(slug, type, title, extra = {}) {
  const { sets, distance = 0, race, tag, isRace, entryTag } = /** @type {any} */ (extra);
  const sessions = sets ? [{ strengthSets: sets, totalDistance: distance }] : [{ totalDistance: distance }];
  const entry = { showcaseId: slug, title, activityType: `ACTIVITY_TYPE_${type}`, startTime: '2026-10-20T18:00:00Z', distanceMeters: distance, durationSeconds: 3600, totalSets: sets ? sets.length : 0 };
  if (entryTag) Object.assign(entry, entryTag);
  /** @type {any} */
  const f = { slug, activity: { title, activityType: `ACTIVITY_TYPE_${type}`, startTime: entry.startTime, activityData: { sessions } }, entry };
  if (race) f.race = race;
  if (tag !== undefined) f.tag = tag;
  if (isRace !== undefined) f.isRace = isRace;
  return f;
}

const lift = (name, reps, kg) => ({ exerciseName: name, reps, weightKg: kg, durationSeconds: 0, distanceMeters: 0 });
const station = (name, m) => ({ exerciseName: name, reps: 0, weightKg: 0, durationSeconds: 240, distanceMeters: m });
const HYROX_RACE = { raceType: 'hyrox', isSimulation: false, event: 'Birmingham', segments: [] };

describe('siteTagOf: the one fallback', () => {
  // Real-style titles and the types FitGlue files them under.
  const table = [
    ['RUN', 'Evening Run', {}, 'run', false],
    ['RUN', 'Newark Parkrun (#34)', {}, 'run', true],
    ['RUN', 'Lancaster Park Run', {}, 'run', true],
    ['RUN', 'Richmond Park 10k', {}, 'run', true],
    ['RUN', 'Newark Half Marathon', {}, 'run', true],
    ['TRAIL_RUN', 'Spartan Race', {}, 'run', true],
    ['RUN', 'Zone 2 5km Run', {}, 'run', false],
    ['RUN', 'Sunday Running Club', {}, 'run', false],
    ['RUN', 'Run to Pilates', {}, 'run', false],
    ['RUN', 'Hyrox Class & Run', {}, 'run', false],
    ['VIRTUAL_RUN', 'Treadmill', {}, 'run', false],
    ['RIDE', 'Morning Ride', { distance: 32000 }, 'ride', false],
    ['RIDE', 'Spinning Class', {}, 'spin', false],
    ['RIDE', 'Afternoon workout', {}, 'spin', false],
    ['CROSSFIT', 'Spinning', {}, 'spin', false],
    ['CROSSFIT', 'Hybrid Spinning Class', {}, 'spin', false],
    ['CROSSFIT', 'Hyrox Class', {}, 'hybrid', false],
    ['CROSSFIT', 'Hybrid Class', {}, 'hybrid', false],
    ['CROSSFIT', 'Push Focused Hyrox PT', {}, 'hybrid', false],
    ['WEIGHT_TRAINING', 'Half Hyrox PT', { sets: [lift('Bench Press', 8, 60)] }, 'hybrid', false],
    ['CROSSFIT', "Hyrox Birmingham - Open Men's Solo", { race: HYROX_RACE }, 'hybrid', true],
    ['CROSSFIT', 'Hyrox Sim', { race: { ...HYROX_RACE, isSimulation: true } }, 'hybrid', false],
    ['CROSSFIT', 'Bootcamp', {}, 'class', false],
    ['HIGH_INTENSITY_INTERVAL_TRAINING', 'Circuit Training', {}, 'class', false],
    ['STAIR_STEPPER', 'Step Class', {}, 'class', false],
    ['WORKOUT', 'Box Fit', {}, 'class', false],
    ['WORKOUT', "Instructor's Choice", {}, 'class', false],
    ['WEIGHT_TRAINING', 'Long Intervals PT', { sets: [station('Row', 500), station('Ski', 500)] }, 'class', false],
    ['WEIGHT_TRAINING', 'Lower Body PT', { sets: [lift('Squat', 5, 100), lift('Deadlift', 5, 120)] }, 'strength', false],
    ['WEIGHT_TRAINING', 'PT', {}, 'strength', false],
    ['WORKOUT', 'Bedtime Core', {}, 'strength', false],
    ['WORKOUT', '100 Press Ups (#10)', {}, 'strength', false],
    ['WEIGHT_TRAINING', 'Leeds Marathon', { sets: [{ exerciseName: 'Running', reps: 0, weightKg: 0, durationSeconds: 18000, distanceMeters: 42200 }] }, 'run', true],
    ['PILATES', 'Tower Pilates', {}, 'pilates', false],
    ['PILATES', 'Slow Flow Reformer Pilates', {}, 'pilates', false],
    ['PILATES', 'Flexibility Pilates Class', {}, 'pilates', false],
    ['YOGA', 'Hotpod Yoga', {}, 'yoga', false],
    ['WALK', 'Recovery', {}, 'walk', false],
    ['HIKE', 'Peak District', {}, 'walk', false],
    ['TENNIS', 'Padel', {}, 'other', false],
    ['SOMETHING_NEW', 'Mystery', {}, 'other', false],
  ];
  for (const [type, title, extra, tag, isRace] of table) {
    test(`${type} "${title}" → ${tag}${isRace ? ' + Race' : ''}`, () => {
      assert.deepEqual(siteTagOf(file('s', type, title, extra)), { tag, isRace });
    });
  }

  test('a bare index entry works too (no sets: weights stay strength)', () => {
    assert.deepEqual(siteTagOf({ activityType: 'ACTIVITY_TYPE_WEIGHT_TRAINING', title: 'Upper Body PT', totalSets: 18 }), { tag: 'strength', isRace: false });
    assert.deepEqual(siteTagOf({ activityType: 'ACTIVITY_TYPE_PILATES', title: 'Glutes & Core Pilates' }), { tag: 'pilates', isRace: false });
  });

  test('every answer is one of the ten tags', () => {
    for (const [type, title, extra] of table) assert.ok(isTag(siteTagOf(file('s', type, title, extra)).tag));
    assert.deepEqual(Object.keys(TAGS), ['run', 'ride', 'spin', 'hybrid', 'class', 'strength', 'pilates', 'yoga', 'walk', 'other']);
  });

  test('a calendar title guesses over the same ten keys', () => {
    for (const t of ['Hyrox Class', 'Spin', 'Tower Pilates', 'Hotpod Yoga', 'Bootcamp', 'Lower Body PT', 'Newark parkrun', 'Sunday ride', 'Walk', 'Dentist']) {
      assert.ok(isTag(tagOfTitle(t)), t);
    }
  });
});

describe('tag and isRace from the export win', () => {
  test('a valid file tag overrides the fallback, and isRace with it', () => {
    const f = file('s', 'CROSSFIT', 'Bootcamp', { tag: 'hybrid', isRace: true });
    assert.deepEqual(tagOf(f), { tag: 'hybrid', isRace: true });
    assert.equal(themeOf(f).typeClass, 'fit-type--hybrid');
  });
  test('a legacy hyrox tag (an older export, cached data) reads as hybrid', () => {
    const f = file('s', 'CROSSFIT', 'Bootcamp', { tag: 'hyrox', isRace: true });
    assert.deepEqual(tagOf(f), { tag: 'hybrid', isRace: true });
    assert.equal(themeOf(f).typeClass, 'fit-type--hybrid');
    assert.equal(themeOf(f).tagLabel, 'Hybrid');
    assert.deepEqual(tagOf(file('s', 'RUN', 'Evening Run', { entryTag: { tag: 'hyrox', isRace: false } })), { tag: 'hybrid', isRace: false });
    assert.equal(tagTheme('hyrox').typeKey, 'hybrid');
    assert.equal(normTag('hyrox'), 'hybrid');
    assert.equal(normTag('crossfit'), undefined);
    assert.equal(isTag('hyrox'), false);
    const g = file('g', 'CROSSFIT', 'Bootcamp', { tag: 'hyrox', isRace: false });
    stampTag(g);
    assert.equal(g.tag, 'hybrid');
    assert.equal(g.entry.tag, 'hybrid');
  });
  test('hybrid race titles without race data fall back to hybrid', () => {
    for (const t of ['DEKA Fit', 'ATHX Manchester', 'Spartan Sprint', 'Hybrid Sim', 'Hyrox PT']) {
      assert.equal(siteTagOf(file('s', 'CROSSFIT', t)).tag, 'hybrid', t);
      assert.equal(tagOfTitle(t), 'hybrid', t);
    }
  });
  test('the entry tag counts when the file has none', () => {
    const f = file('s', 'RUN', 'Evening Run', { entryTag: { tag: 'walk', isRace: false } });
    assert.deepEqual(tagOf(f), { tag: 'walk', isRace: false });
  });
  test('isRace: false from the data beats a parkrun title', () => {
    assert.deepEqual(tagOf(file('s', 'RUN', 'Newark Parkrun', { tag: 'run', isRace: false })), { tag: 'run', isRace: false });
  });
  test('an unknown tag is ignored, the fallback decides', () => {
    assert.deepEqual(tagOf(file('s', 'PILATES', 'Tower Pilates', { tag: 'crossfit' })), { tag: 'pilates', isRace: false });
  });
  test('assemble stamps the decision on the file, its entry and the index entry', () => {
    const f = file('p', 'PILATES', 'Tower Pilates');
    const indexEntry = { slug: 'p', title: 'Tower Pilates', activityType: 'ACTIVITY_TYPE_PILATES', startTime: '2026-10-20T18:00:00Z' };
    const out = assemble({ index: { activities: [indexEntry], roundups: [] }, activityFiles: new Map([['p', f]]), roundupFiles: new Map() });
    assert.equal(out.activities[0].tag, 'pilates');
    assert.equal(out.activities[0].entry.tag, 'pilates');
    assert.equal(indexEntry.tag, 'pilates');
    assert.equal(/** @type {any} */ (indexEntry).isRace, false);
  });
});

describe('one activity, one tag, on every view', () => {
  const cases = [
    file('hyrox-pt', 'WEIGHT_TRAINING', 'Push Focused Hyrox PT', { sets: [lift('Bench Press', 8, 60)] }),
    file('pilates', 'PILATES', 'Slow Flow Pilates'),
    file('spin', 'RIDE', 'Spinning Class'),
    file('race', 'CROSSFIT', "Hyrox Birmingham - Open Men's Solo", { race: HYROX_RACE }),
    file('parkrun', 'RUN', 'Newark Parkrun (#40)', { distance: 5000 }),
    file('given', 'CROSSFIT', 'Bootcamp', { tag: 'yoga', isRace: false }),
  ];
  for (const f0 of cases) {
    test(f0.slug, () => {
      const f = stampTag({ ...f0, indexEntry: { ...f0.entry, slug: f0.slug } });
      const e = f.indexEntry;
      const want = `fit-type--${f.tag}`;
      const label = TAGS[/** @type {keyof typeof TAGS} */ (f.tag)].label;
      const page = buildActivityView(f, {}).act;
      const card = buildCard(e, f);
      const done = doneEntry(e);
      const sessions = buildSessionPages({ activities: [e] }, [f])[0].fitnessSessions.months[0].items[0];
      const breakdown = tagBreakdown({ periodStart: '2026-10-19T00:00:00Z', periodEnd: '2026-10-26T00:00:00Z' }, [e]);
      const strip = dominantTypes({ activities: [e] });
      assert.equal(page.typeClass, want, 'activity page');
      assert.equal(card.typeClass, want, '/life card');
      assert.equal(done.typeClass, want, 'calendar strip');
      assert.equal(sessions.typeClass, want, '/life/sessions');
      assert.equal(breakdown[0].tag, f.tag, 'roundup breakdown');
      assert.equal([...strip.values()][0], f.tag, 'effort strip');
      assert.equal(page.typeLabel, label.toUpperCase());
      assert.equal(card.typeLabel, label.toUpperCase());
      assert.equal(page.isRace, f.isRace);
      assert.equal(card.isRace, f.isRace);
    });
  }
});

describe('Pilates is never Yoga', () => {
  test('label, glyph, ink, page, card and breakdown', () => {
    const f = stampTag(file('p', 'PILATES', 'Tower Pilates'));
    assert.equal(TAGS.pilates.label, 'Pilates');
    assert.notEqual(TAGS.pilates.glyph, TAGS.yoga.glyph);
    assert.notEqual(TYPE_INKS.pilates.type, TYPE_INKS.yoga.type);
    const page = buildActivityView(f, {}).act;
    assert.equal(page.typeLabel, 'PILATES');
    assert.equal(page.tagGlyph, 'PIL');
    assert.doesNotMatch(JSON.stringify({ l: page.typeLabel, g: page.tagGlyph, c: page.typeClass }), /yoga|YOG/i);
    const card = buildCard({ ...f.entry, slug: 'p' }, f);
    assert.doesNotMatch(`${card.typeLabel} ${card.glyph} ${card.typeClass} ${card.pictureWord}`, /yoga|YOG/i);
    const rows = tagBreakdown({ activityTypeBreakdowns: [{ activityType: 'ACTIVITY_TYPE_PILATES', activityCount: 3 }] });
    assert.equal(rows[0].tag, 'pilates');
  });
});

describe('inks', () => {
  test('one ink per tag, in CSS and TYPE_INKS, and no retired family classes', async () => {
    assert.deepEqual(Object.keys(TYPE_INKS).sort(), Object.keys(TAGS).sort());
    const css = await fs.readFile(path.join(REPO, 'personal/assets/styles/main/fitness-types.css'), 'utf8');
    for (const k of Object.keys(TAGS)) assert.match(css, new RegExp(`\\.fit-type--${k}\\s*\\{`));
    for (const old of ['crossfit', 'hiit', 'hike', 'swim', 'paddle', 'sport']) assert.doesNotMatch(css, new RegExp(`fit-type--${old}\\b`));
    assert.equal(new Set(Object.values(TYPE_INKS).map((i) => i.type)).size, Object.keys(TAGS).length, 'every tag its own ink');
  });
});
