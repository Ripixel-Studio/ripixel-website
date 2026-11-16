// @ts-check
// Run with `npm test` (node:test, no extra dependencies).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildLifeAnnual, lifeAnnualTask } from './life-annual.mjs';
import { storyContext } from './fitness-roundup-story.mjs';

const PIC = (/** @type {string} */ s) => `https://img.test/${s}.jpg`;
/** @param {string} slug @param {string} startTime @param {any} [extra] */
const entry = (slug, startTime, extra = {}) => ({ slug, showcaseId: slug, title: slug, activityType: 'ACTIVITY_TYPE_RUN', tag: 'run', startTime, durationSeconds: 3600, distanceMeters: 5000, photoUrls: [], ...extra });
const LONG = 'Went out hard on the first lap and somehow held it all the way round, which I did not expect at all after the week I had had, and the crowd at the finish line carried me home.';
const entries = [
  entry('race-10k', '2026-03-08T09:00:00Z', { title: 'Town 10k', isRace: true, distanceMeters: 10000, photoUrls: [PIC('race')] }),
  entry('mar-gym', '2026-03-10T09:00:00Z', { tag: 'strength', activityType: 'ACTIVITY_TYPE_WEIGHT_TRAINING', distanceMeters: 0, photoUrls: [PIC('gym')] }),
  entry('mar-walk', '2026-03-12T09:00:00Z', { tag: 'walk' }),
  ...Array.from({ length: 8 }, (_, i) => entry(`apr-${i}`, `2026-04-${String(i + 2).padStart(2, '0')}T09:00:00Z`, { photoUrls: [PIC(`apr-${i}`)] })),
  entry('dec-race', '2026-12-05T09:00:00Z', { title: 'Late 5k', isRace: true }),
];
const files = entries.map((e) => ({
  slug: e.slug, entry: e, isRace: Boolean(e.isRace),
  activity: { title: e.title, startTime: e.startTime, description: e.slug === 'race-10k' ? `${LONG}\n\nPosted via FitGlue 💪` : '' },
}));
const yearFile = { key: 'year-2026', roundup: { periodStart: '2026-01-01T00:00:00Z' } };
const ctx = storyContext({ files, entries, roundupFiles: [yearFile] });

/** @param {any} [over] */
const annualDoc = (over = {}) => ({
  schemaVersion: 1, year: 2026, through: '2026-11-30', final: false, generatedAt: '2026-11-30T03:00:00Z',
  days: { '2026-03-08': ['live'], '2026-03-09': ['live', 'book'], '2026-03-12': ['book'], '2026-03-20': ['gaming', 'screen'] },
  moments: [
    { id: 'fitness:race-10k', kind: 'fitness', day: '2026-03-08', month: '2026-03', title: 'Town 10k', sub: '10 km', image: PIC('race'), href: '/life/activity/race-10k', score: 115, race: true, photo: true },
    { id: 'live:band', kind: 'live', day: '2026-03-09', month: '2026-03', title: 'The Band', sub: 'live', image: '', href: '/life/live', score: 70, race: false, photo: false, venue: 'The Hall' },
    { id: 'live:other', kind: 'live', day: '2026-03-14', month: '2026-03', title: 'Another Act', sub: 'live', image: '', href: '/life/live', score: 70, race: false, photo: false },
    { id: 'book:b', kind: 'book', day: '2026-04-20', month: '2026-04', title: 'A Book', sub: 'An Author', image: PIC('book'), href: '/life/reading', score: 40, race: false, photo: false },
  ],
  highlights: { '2026-03': { pick: 'fitness:race-10k', by: 'jarvis', alternatives: ['live:band'] }, '2026-04': { pick: 'book:b', by: 'james', alternatives: [] } },
  collage: {
    shelf: [{ title: 'A', creator: 'X', cover: PIC('a'), day: '2026-01-02' }, { title: 'B', creator: 'Y', cover: PIC('b'), day: '2026-02-02' }, { title: 'C', creator: 'Z', cover: PIC('c'), day: '2026-03-02' }],
    mixtape: { artists: [{ name: 'One', minutes: 300, image: '' }, { name: 'Two', minutes: 200, image: '' }], minutes: 500 },
    telly: [{ title: 'T1', poster: PIC('t1'), kind: 'film' }, { title: 'T2', poster: PIC('t2'), kind: 'series' }, { title: 'T3', poster: PIC('t3'), kind: 'film' }],
    games: [],
  },
  firsts: [{ id: 'first:1', day: '2026-03-09', kind: 'venue', text: 'First night at The Hall.', momentId: 'live:band', venue: 'The Hall' }],
  connections: [{ month: '2026-03', kind: 'soundtrack', text: 'The race month ran on The Band.', by: 'code' }],
  hours: { reading: 30, listening: 50, watching: 20, playing: 0, training: 100, commits: 900 },
  totals: { live: 2, books: 3, films: 2, series: 1, artists: 2, commits: 900, gameHours: 0, sessions: 11, races: 1 },
  letter: { lines: ['A good year to write down.'], predictions: [{ key: 'books', text: 'Four books.', target: 4 }], approved: false },
  ...over,
});

const cell = (/** @type {any} */ v, /** @type {string} */ day) => v.cover.days.cols.flatMap((/** @type {any} */ c) => c.cells).find((/** @type {any} */ c) => c.day === day);

describe('life annual view', () => {
  const v = buildLifeAnnual(annualDoc(), ctx, { now: Date.parse('2026-11-30T12:00:00Z') });

  test('cover priority race over live', () => {
    const race = cell(v, '2026-03-08');
    assert.equal(race.race, true);
    assert.equal(race.ink, 'fit-type--run');
    assert.equal(race.href, '#m-2026-03');
    assert.equal(cell(v, '2026-03-09').ink, 'life-ink--live');
    assert.equal(cell(v, '2026-03-10').ink, 'fit-type--strength');
    assert.equal(cell(v, '2026-03-12').ink, 'fit-type--walk', 'a session beats a book');
    assert.equal(cell(v, '2026-03-20').ink, 'life-ink--games', 'gaming beats screen');
    assert.equal(cell(v, '2026-03-21').rest, true);
    assert.equal(cell(v, '2026-03-21').ink, '');
  });

  test('fitness after through is not drawn', () => {
    const late = cell(v, '2026-12-05');
    assert.equal(late.future, true);
    assert.equal(late.race, false);
    assert.equal(late.ink, '');
    assert.deepEqual(v.collages.medals, null, 'one race in range is under 3 medals');
    assert.equal(v.fitness.numbers.find((/** @type {any} */ n) => n.key === 'races').value, 1);
  });

  test('month without moments renders empty page', () => {
    assert.equal(v.months.length, 12);
    const may = v.months[4];
    assert.equal(may.key, '2026-05');
    assert.equal(may.anchor, 'm-2026-05');
    assert.equal(may.label, 'May');
    assert.equal(may.highlight, null);
    assert.equal(may.empty, true);
    assert.deepEqual([may.polaroids, may.stubs, may.captions, may.notes], [[], [], [], []]);
  });

  test('fitness highlight gets photo and trimmed caption', () => {
    const mar = v.months[2];
    assert.equal(mar.empty, false);
    const h = mar.highlight;
    assert.equal(h.photo, PIC('race'));
    assert.equal(h.title, 'Town 10k');
    assert.equal(h.href, '/life/activity/race-10k');
    assert.ok(h.caption.length <= 140, h.caption);
    assert.ok(h.caption.endsWith('…'));
    assert.ok(LONG.startsWith(h.caption.slice(0, -1)), 'cut at a word boundary');
    assert.equal(LONG[h.caption.length - 1], ' ', 'the next char in the source is a space');
    assert.doesNotMatch(h.caption, /FitGlue/);
    // the rest of March: the gym photo as a polaroid (not the highlight's), both live stubs with day and venue, the note
    assert.deepEqual(mar.polaroids.map((/** @type {any} */ p) => p.photo), [PIC('gym')]);
    assert.deepEqual(mar.stubs.map((/** @type {any} */ s) => [s.title, s.dayLabel, s.venue]), [['The Band', '9 Mar', 'The Hall'], ['Another Act', '14 Mar', '']]);
    assert.deepEqual(mar.notes.map((/** @type {any} */ n) => n.text), ['The race month ran on The Band.']);
    // April: a book highlight; eight photos capped at six
    assert.equal(v.months[3].highlight.title, 'A Book');
    assert.equal(v.months[3].polaroids.length, 6);
  });

  test('a fitness moment takes its title and photo from FitGlue (the doc carries none)', () => {
    // lifehub's fitness moments have no title; one without its activity file falls back to the index entry
    const untitled = (/** @type {any} */ m) => { const { title, ...rest } = m; return rest; };
    const doc = annualDoc();
    doc.moments = doc.moments.map((/** @type {any} */ m) => (m.kind === 'fitness' ? untitled(m) : m));
    doc.moments.push({ id: 'fitness:mar-gym', kind: 'fitness', day: '2026-03-10', month: '2026-03', image: '', href: '/life/activity/mar-gym', score: 55, race: false, photo: true });
    doc.highlights['2026-03'] = { pick: 'fitness:mar-gym', by: 'jarvis', alternatives: ['fitness:race-10k'] };
    const noGymFile = storyContext({ files: files.filter((f) => f.slug !== 'mar-gym'), entries, roundupFiles: [yearFile] });
    const w = buildLifeAnnual(doc, noGymFile);
    const h = w.months[2].highlight;
    assert.equal(h.title, 'mar-gym', 'from the index entry when the activity file is missing');
    assert.equal(h.photo, PIC('gym'));
    assert.equal(h.href, '/life/activity/mar-gym');
    assert.equal(h.typeClass, 'fit-type--strength');
    const withFile = buildLifeAnnual({ ...doc, highlights: { '2026-03': { pick: 'fitness:race-10k', by: 'jarvis', alternatives: [] } } }, ctx);
    assert.equal(withFile.months[2].highlight.title, 'Town 10k', 'from the activity file');
    assert.equal(withFile.fitness.photo, PIC('race'));
  });

  test('collage under 3 items dropped', () => {
    assert.equal(v.collages.shelf.items.length, 3);
    assert.equal(v.collages.mixtape, null);
    assert.equal(v.collages.games, null);
    assert.equal(v.collages.telly.items.length, 3);
    assert.deepEqual(v.placements, [{ after: '2026-03', key: 'shelf' }, { after: '2026-08', key: 'telly' }]);
    assert.deepEqual(v.months[2].after.map((/** @type {any} */ c) => c.key), ['shelf']);
  });

  test('hours, firsts, fitness and the draft letter', () => {
    assert.deepEqual(v.hours.segments.map((/** @type {any} */ s) => [s.key, s.share]), [['reading', '15%'], ['listening', '25%'], ['watching', '10%'], ['training', '50%']]);
    assert.equal(v.hours.commits, 900);
    assert.deepEqual(v.firsts.map((/** @type {any} */ f) => [f.text, f.href]), [['First night at The Hall.', '#m-2026-03']]);
    assert.equal(v.fitness.photo, PIC('race'));
    assert.equal(v.fitness.href, '/life/roundup/year-2026');
    assert.equal(v.fitness.numbers.length, 3);
    assert.equal(v.letter.draft, true);
    assert.equal(v.letter.to, 2027, 'the letter is to next year');
    assert.equal(buildLifeAnnual(annualDoc({ letter: null }), ctx).letter, null);
  });

  test('cover large in January and in preview, slim in March', () => {
    const at = (/** @type {string} */ iso, over = {}) => buildLifeAnnual(annualDoc(over), ctx, { now: Date.parse(iso) }).linkCover;
    assert.equal(at('2027-01-15T12:00:00Z').size, 'large');
    assert.equal(at('2027-03-01T12:00:00Z').size, 'slim');
    assert.equal(at('2027-03-01T12:00:00Z', { preview: true }).size, 'large');
    const c = at('2027-03-01T12:00:00Z');
    assert.equal(c.year, 2026);
    assert.equal(c.href, '/life/annual/2026');
    assert.ok(c.thumbs.length >= 52);
  });
});

describe('lifeAnnualTask', () => {
  /** @param {Record<string, any>} lifeAnnuals */
  const run = (lifeAnnuals) => lifeAnnualTask().run({}, {
    globals: { lifeAnnuals, fitnessIndex: { activities: entries, profile: { showPhotoGallery: true } }, fitnessActivities: files, fitnessRoundups: [yearFile] },
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  });

  test('non-final non-preview doc has no page', async () => {
    const none = await run({ 2026: annualDoc() });
    assert.deepEqual([none.lifeAnnualPages, none.lifeAnnualCovers], [[], []]);
    const r = await run({ 2025: annualDoc({ year: 2025, final: true, through: '2025-12-31' }), 2026: annualDoc({ preview: true }) });
    assert.deepEqual(r.lifeAnnualPages.map((/** @type {any} */ p) => p.annual.year), [2025, 2026]);
    assert.deepEqual(r.lifeAnnualCovers.map((/** @type {any} */ c) => c.year), [2026, 2025]);
  });
});

describe('the annual page', () => {
  /** Renders /life/annual/2026 from `doc` with the real templates; returns the HTML. @param {any} doc */
  const render = async (doc) => {
    const { default: os } = await import('node:os');
    const { default: fs } = await import('node:fs/promises');
    const { default: path } = await import('node:path');
    const { lifePageTasks } = await import('./life-pages.mjs');
    const { runSkierTasks } = await import('./skier-test-runner.mjs');
    const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'annual-page-'));
    try {
      const pages = lifePageTasks({ outDir, siteUrl: 'https://james.ripixel.co.uk' }).find((t) => /lifeAnnualPages/.test(JSON.stringify(t.config)));
      assert.ok(pages, 'lifePageTasks renders lifeAnnualPages');
      const logs = /** @type {string[]} */ ([]);
      await runSkierTasks([lifeAnnualTask(), pages], {
        cacheHash: 'test', year: 2026, siteUrl: 'https://james.ripixel.co.uk', lifeAnnuals: { 2026: doc },
        fitnessIndex: { activities: entries, profile: { showPhotoGallery: true } }, fitnessActivities: files, fitnessRoundups: [yearFile],
      }, logs);
      assert.ok(!logs.some((l) => l.startsWith('ERROR')), logs.join('\n'));
      return await fs.readFile(path.join(outDir, 'life', 'annual', '2026', 'index.html'), 'utf8');
    } finally {
      await fs.rm(outDir, { recursive: true, force: true });
    }
  };

  test('page renders a month anchor per month', async () => {
    const html = await render(annualDoc({ preview: true }));
    const anchors = [...html.matchAll(/<article [^>]*id="(m-2026-\d\d)"/g)].map((m) => m[1]);
    assert.deepEqual(anchors, Array.from({ length: 12 }, (_, i) => `m-2026-${String(i + 1).padStart(2, '0')}`));
    const tabs = [...html.matchAll(/class="la-tab[^"]*" href="#(m-2026-\d\d)"/g)].map((m) => m[1]);
    assert.deepEqual(tabs, anchors, 'a tab per month');
    assert.match(html, /href="#m-2026-03"/, 'cover days jump to their month');
    assert.match(html, /Nothing taped in yet\./, 'a blank month is a torn page');
    assert.match(html, /Preview: built as if the year ended on 30 November 2026/);
    assert.match(html, /<title>James King \| life \| life in 2026<\/title>/);
    assert.doesNotMatch(html, /\{\{|\}\}/, 'no unrendered tags');
  });

  test('stub without venue has no venue line', async () => {
    const html = await render(annualDoc({ preview: true }));
    const stubs = [...html.matchAll(/<li class="la-stub[^"]*"[\s\S]*?<\/li>/g)].map((m) => m[0]);
    const band = stubs.find((s) => s.includes('The Band'));
    const other = stubs.find((s) => s.includes('Another Act'));
    assert.ok(band && other, 'both stubs render');
    assert.match(band, /class="la-stub__venue">The Hall</);
    assert.doesNotMatch(other, /la-stub__venue/);
  });

  test('draft stamp only when draft', async () => {
    const draft = await render(annualDoc({ preview: true }));
    assert.match(draft, /class="la-letter__draft"/);
    const approved = await render(annualDoc({ preview: true, letter: { lines: ['A good year to write down.'], predictions: [], approved: true } }));
    assert.match(approved, /Dear 2027,/);
    assert.match(approved, /A good year to write down\./);
    assert.doesNotMatch(approved, /class="la-letter__draft"/);
    const final = await render(annualDoc({ final: true }));
    assert.doesNotMatch(final, /Preview: built as if/, 'the banner is the preview only');
  });
});
