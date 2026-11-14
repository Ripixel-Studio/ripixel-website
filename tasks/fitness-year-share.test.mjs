// @ts-check
// Run with `npm test`. The year in review, shareable (tasks/fitness-year-share.mjs): the
// deck model, the story card drawing (scripts/year-story-cards.mjs), the year card's
// numbers, rendering with a cache, and the video's ffmpeg command (encoded for real when
// ffmpeg is on the box).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { yearDeckModel, monthBlocks, withYearReview, pickTickets, pickProgressions, videoArgs, findFfmpeg, renderYearDeck, inkOf, VIDEO } from './fitness-year-share.mjs';
import { buildYearStorySVG, footerBandSVG, scalePath, onInk, SAFE, BAND, STORY } from '../scripts/year-story-cards.mjs';
import { buildYearReview } from './fitness-year-review.mjs';
import { storyContext } from './fitness-roundup-story.mjs';
import { getSharp } from '../scripts/generate-og-images.mjs';
import { TYPE_INKS } from './fitness-theme.mjs';
import { cardJobs } from './fitness-og-images.mjs';

/** @param {string} slug @param {string} startTime @param {any} [extra] */
const entry = (slug, startTime, extra = {}) => ({ slug, showcaseId: slug, title: slug, activityType: 'ACTIVITY_TYPE_RUN', tag: 'run', startTime, durationSeconds: 3600, distanceMeters: 5000, photoUrls: [], ...extra });
const entries = [
  entry('jan-run', '2026-01-03T09:00:00Z', { locationName: 'Testville, Shire, England, United Kingdom', tempC: -2 }),
  entry('jan-gym', '2026-01-04T09:00:00Z', { tag: 'strength', activityType: 'ACTIVITY_TYPE_WEIGHT_TRAINING', distanceMeters: 0, totalWeightKg: 5000 }),
  entry('race-10k', '2026-03-08T09:00:00Z', { title: 'Town 10k & Fun Run', isRace: true, distanceMeters: 10000, durationSeconds: 2865, photoUrls: ['https://photos.test/race.jpg'] }),
  entry('summer', '2026-07-09T18:00:00Z', { tempC: 31, photoUrls: ['https://photos.test/summer.jpg'] }),
];
const files = entries.map((e) => ({
  slug: e.slug, entry: e, isRace: Boolean(e.isRace),
  activity: { title: e.title, activityType: e.activityType, startTime: e.startTime, enrichments: e.slug === 'jan-gym' ? { personalRecords: { records: [
    { recordType: 'deadlift_1rm', newValue: 120, previousValue: 110, unit: 'kg' },
  ] } } : {} },
}));
const yearFile = { key: 'year-2026', roundup: { periodType: 'ROUNDUP_PERIOD_TYPE_YEAR', periodStart: '2026-01-01T00:00:00Z', periodEnd: '2027-01-01T00:00:00Z' } };
const review = buildYearReview(yearFile, storyContext({ files, entries, roundupFiles: [yearFile], showPhotos: true }), {
  upcoming: [{ title: 'Big Race', start: '2027-02-01T09:00:00Z', kind: 'race' }],
});

/** Text elements outside translated groups (the polaroids and the sticker draw in local co-ordinates). @param {string} svg */
function pageTexts(svg) {
  const flat = svg.replace(/<g transform="translate\([^"]*\)[^"]*">[\s\S]*?<\/g>/g, '');
  return [...flat.matchAll(/<text x="([-\d.]+)" y="([-\d.]+)"[^>]*font-size="([\d.]+)"[^>]*>([^<]*)<\/text>/g)]
    .map((m) => ({ x: Number(m[1]), y: Number(m[2]), size: Number(m[3]), text: m[4] }));
}

/** The review with a race ticket and a parkrun strip (a four-session year has neither of its own). */
const withRaces = { ...review, races: { ...review.races, tickets: [{ title: 'Town 10k & Fun Run', value: '47:45', unit: '', date: 'Sun 8 Mar', pb: true, stamp: '10K', typeClass: 'fit-type--run' }], parkrun: { count: 3, best: '22:10', courses: 1 } } };

describe('the deck model', () => {
  const deck = yearDeckModel(withRaces, { siteUrl: 'https://example.test/', url: '/life/roundup/year-2026' });

  test('the link, and every card numbered out of the deck', () => {
    assert.equal(deck.link, 'example.test/life/roundup/year-2026');
    assert.equal(deck.href, 'https://example.test/life/roundup/year-2026');
    assert.deepEqual(deck.cards.map((c) => c.n), deck.cards.map((_, i) => i + 1));
    assert.ok(deck.cards.every((c) => c.outOf === deck.cards.length));
    assert.deepEqual(deck.cards.map((c) => c.id), ['cover', 'numbers', 'arc', 'days', 'races', 'pbs', 'awards', 'next']);
    assert.equal(deck.cards[0].id, 'cover');
    assert.equal(deck.cards[deck.cards.length - 1].id, 'next');
  });
  test('the cards come from the review: numbers, races, PBs, awards, next year', () => {
    const by = Object.fromEntries(deck.cards.map((c) => [c.id, c]));
    assert.equal(by.numbers.numbers[0].display, '4');
    assert.equal(by.races.tickets[0].title, 'Town 10k & Fun Run');
    assert.equal(by.races.tickets[0].pb, true);
    assert.equal(by.races.parkrun.count, 3);
    assert.equal(by.pbs.total, '1');
    assert.ok(by.awards.awards.length >= 1 && by.awards.awards.length <= 4);
    assert.deepEqual(by.next.upcoming.map((/** @type {any} */ u) => u.title), ['Big Race']);
    assert.equal(by.next.nextYear, 2027);
  });
  test('a card with nothing to say is left out and the rest renumbered', () => {
    const quiet = yearDeckModel({ ...withRaces, races: { tickets: [], parkrun: null }, pbs: { total: 0 }, awards: [] });
    assert.deepEqual(quiet.cards.map((c) => c.id), ['cover', 'numbers', 'arc', 'days', 'next']);
    assert.equal(quiet.cards[4].n, 5);
    assert.equal(quiet.cards[4].outOf, 5);
  });
  test('every day of the year in month blocks, each month starting on its weekday', () => {
    const months = monthBlocks(review.days, 2026);
    assert.equal(months.length, 12);
    assert.equal(months.reduce((t, m) => t + m.days.length, 0), 365);
    assert.equal(months[0].lead, 3); // 1 Jan 2026 was a Thursday
    assert.equal(months[2].days[7].race, true); // 8 March
    assert.equal(months[0].days[2].ink, TYPE_INKS.run.type);
  });
  test('tickets: PBs and big races first, shown in date order; progressions: short run, long run, a lift', () => {
    const t = [{ title: 'a' }, { title: 'b', pb: true }, { title: 'c', stamp: 'MARATHON' }, { title: 'd' }];
    assert.deepEqual(pickTickets(t, 2).map((x) => x.title), ['b', 'c']);
    const f = (/** @type {string} */ name, /** @type {string} */ from) => ({ name, from, to: from, d: 'M0,0', w: 300, h: 120 });
    assert.deepEqual(pickProgressions([f('5K', '25:00'), f('10K', '50:00'), f('MARATHON', '4:00:00'), f('Squat', '80 kg')]).map((x) => x.name), ['5K', 'MARATHON', 'Squat']);
  });
  test('inks by tag class', () => {
    assert.equal(inkOf('fit-type--strength'), TYPE_INKS.strength.type);
    assert.equal(inkOf('nonsense'), TYPE_INKS.other.type);
  });
});

describe('the drawing', () => {
  const deck = yearDeckModel(withRaces, { siteUrl: 'https://example.test' });

  test('every card: 1080×1920, the link band, its number, text escaped, all type inside Instagram\'s safe area', () => {
    for (const card of deck.cards) {
      const { svg, photos } = buildYearStorySVG(deck, card);
      assert.match(svg, /width="1080" height="1920"/);
      assert.ok(svg.includes(deck.link), `${card.id} carries the link`);
      assert.ok(svg.includes(`${String(card.n).padStart(2, '0')} / ${String(card.outOf).padStart(2, '0')}`), `${card.id} numbered`);
      assert.doesNotMatch(svg, /&(?!amp;|lt;|gt;|quot;|#)/, `${card.id} escaped`);
      for (const t of pageTexts(svg)) {
        assert.ok(t.y - t.size * 0.8 >= SAFE.top, `${card.id}: "${t.text}" clear of the top band (y ${t.y})`);
        assert.ok(t.y <= SAFE.bottom, `${card.id}: "${t.text}" clear of the bottom band (y ${t.y})`);
        assert.ok(t.x >= 0 && t.x <= STORY.w, `${card.id}: "${t.text}" on the card`);
      }
      if (card.id === 'cover') assert.deepEqual(photos, review.cover.photos.map((/** @type {any} */ p) => p.url));
      else assert.deepEqual(photos, []);
    }
  });
  test('the band sits above Instagram\'s bottom UI; the video overlay is the same band', () => {
    assert.ok(BAND.y > SAFE.top && BAND.y + BAND.h <= SAFE.bottom);
    const band = footerBandSVG(deck);
    assert.match(band, new RegExp(`height="${BAND.h + BAND.pad * 2}"`));
    assert.ok(band.includes(deck.link));
  });
  test('scalePath scales absolute paths, H and V included; onInk picks readable type', () => {
    assert.equal(scalePath('M0,10 C1,2 3,4 5,6 H10 V20 L2,2 Z', 2, 3, 100, 200), 'M100,230 C102,206 106,212 110,218 H120 V260 L104,206 Z');
    assert.equal(onInk('#F2C13C'), '#171311');
    assert.equal(onInk('#2148C0'), '#F5EFDF');
  });
});

describe('the year card and og:image', () => {
  test('withYearReview: the review\'s totals, every day on the heatmap, no stale PR wall, the cover photos', () => {
    const model = { kind: 'roundup', id: 'year-2026', totals: [{ value: '0', label: 'sessions' }], sessions: 0, activeDays: 0, prCount: 0, prs: [{ name: 'x' }], vs: { label: 'vs' }, photos: [], calendar: { type: 'year', days: [] } };
    const m = withYearReview(model, review);
    assert.deepEqual(m.totals.map((/** @type {any} */ t) => t.value), ['4', '4', '20', '1']);
    assert.equal(m.sessions, 4);
    assert.equal(m.calendar.days.length, 365);
    assert.equal(m.calendar.months.length, 12);
    assert.equal(m.calendar.days.filter((/** @type {any} */ d) => d.level > 0).length, 4);
    assert.deepEqual(m.prs, []);
    assert.equal(m.vs, null);
    assert.equal(m.photos[0], 'https://photos.test/race.jpg');
    assert.equal(withYearReview(model, null), model);
  });
  test('cardJobs: the year roundup\'s cards (and so its og:image) take the review\'s numbers', () => {
    const plain = cardJobs({ roundups: [yearFile], index: {} });
    const jobs = cardJobs({ roundups: [yearFile], index: {}, yearReviews: new Map([['year-2026', review]]) });
    assert.notEqual(plain[0].model.totals[0]?.value, '4');
    assert.equal(jobs[0].model.totals[0].value, '4');
    assert.equal(jobs[0].model.totals[0].label, 'sessions');
  });
});

describe('the video', () => {
  test('videoArgs: zoom per card, xfade offsets, the band overlaid, H.264 yuv420p 30 fps faststart', () => {
    const { args, seconds } = videoArgs(['a.png', 'b.png', 'c.png'], 'band.png', 'out.mp4');
    const fc = args[args.indexOf('-filter_complex') + 1];
    assert.equal(seconds, VIDEO.first + VIDEO.each + VIDEO.last - 2 * VIDEO.fade);
    assert.match(fc, /\[0:v\]scale=2160:3840.*zoompan=/);
    assert.match(fc, new RegExp(`xfade=transition=\\w+:duration=${VIDEO.fade}:offset=${(VIDEO.first - VIDEO.fade).toFixed(3)}\\[x1\\]`));
    assert.match(fc, new RegExp(`overlay=0:${BAND.y - BAND.pad}`));
    for (const a of ['libx264', 'yuv420p', '+faststart', 'out.mp4']) assert.ok(args.includes(a), a);
    assert.equal(args[args.indexOf('-r') + 1], '30');
  });
  test('findFfmpeg: FFMPEG wins, and a missing one is none', () => {
    assert.equal(findFfmpeg({ FFMPEG: '' }), '');
    assert.equal(findFfmpeg({ FFMPEG: '/nonexistent/ffmpeg' }), '');
    assert.equal(findFfmpeg({ FFMPEG: process.execPath }), process.execPath);
  });
});

describe('rendering', () => {
  /** @type {string[]} */
  const hits = [];
  /** @param {RegExp} fail */
  const photoHost = async (fail) => {
    const sharp = await getSharp();
    const jpeg = await sharp({ create: { width: 300, height: 400, channels: 3, background: '#3a6' } }).jpeg().toBuffer();
    return /** @type {typeof fetch} */ (/** @type {unknown} */ (async (/** @type {string} */ url) => {
      hits.push(String(url));
      return fail.test(String(url)) ? new Response('nope', { status: 404 }) : new Response(jpeg, { status: 200 });
    }));
  };

  test('renders the deck as PNGs, a photo that will not load leaves its frame, a rebuild comes from the cache', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'yrdeck-'));
    try {
      const opts = { key: 'year-2026', outDir: path.join(tmp, 'out'), cacheDir: path.join(tmp, 'cache'), siteUrl: 'https://example.test', fetchImpl: await photoHost(/summer/), video: false };
      const r = await renderYearDeck(review, opts);
      assert.equal(r.count, yearDeckModel(review).cards.length);
      assert.equal(r.rendered, r.count);
      assert.equal(r.video, null);
      assert.equal(r.cards[0].url, '/life/share/roundup/year-2026/story-01.png');
      assert.equal(r.cards[0].file, 'year-2026-01-cover.png');
      const sharp = await getSharp();
      for (const c of r.cards) {
        const meta = await sharp(path.join(tmp, 'out', 'roundup', 'year-2026', path.basename(c.url))).metadata();
        assert.deepEqual([meta.width, meta.height, meta.format], [1080, 1920, 'png']);
      }
      assert.ok(hits.some((u) => /race\.jpg/.test(u)));
      const again = await renderYearDeck(review, opts);
      assert.equal(again.cached, r.count);
      assert.equal(again.rendered, 0);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  test('no ffmpeg: no video, and no failure', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'yrdeck-'));
    try {
      const r = await renderYearDeck(review, { key: 'year-2026', outDir: path.join(tmp, 'out'), cacheDir: path.join(tmp, 'cache'), offline: true, ffmpeg: '' });
      assert.ok(r.count > 2);
      assert.equal(r.video, null);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  const ffmpeg = findFfmpeg();
  test('with ffmpeg: an MP4 beside the cards, cached by the cards', { skip: !ffmpeg && 'no ffmpeg on this machine' }, async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'yrdeck-'));
    try {
      const opts = { key: 'year-2026', outDir: path.join(tmp, 'out'), cacheDir: path.join(tmp, 'cache'), offline: true, timing: { first: 0.4, each: 0.4, last: 0.4, fade: 0.2 } };
      const r = await renderYearDeck(review, opts);
      assert.ok(r.video);
      assert.equal(r.video.url, '/life/share/roundup/year-2026/story.mp4');
      assert.equal(r.video.poster, r.cards[0].url);
      const mp4 = await fs.readFile(path.join(tmp, 'out', 'roundup', 'year-2026', 'story.mp4'));
      assert.equal(mp4.subarray(4, 8).toString(), 'ftyp');
      const t0 = Date.now();
      await renderYearDeck(review, opts);
      assert.ok(Date.now() - t0 < 3000, 'the second build reuses the encode');
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});
