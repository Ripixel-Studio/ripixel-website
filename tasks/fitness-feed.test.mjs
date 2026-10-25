// @ts-check
// Run with `npm test` (node:test, no extra dependencies).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  FEED_PATH,
  FEED_LIMIT,
  rfc3339,
  xmlEsc,
  activityItem,
  roundupItem,
  feedItems,
  buildAtom,
  fitnessFeedTask,
} from './fitness-feed.mjs';
import { loadFitnessData } from './fitness-fetch.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = path.join(REPO, 'fixtures', 'fitness');
const SITE = 'https://james.ripixel.co.uk';

async function fixtures() {
  return loadFitnessData({ env: {}, source: 'fixtures', fixturesDir: FIXTURES });
}
/** The `fitnessRoundupPages` entry S2.4's task returns for the fixture roundup. */
const WEEK_PAGE = { key: 'week-42-2026', url: '/life/roundup/week-42-2026', title: 'Week 42 · 2026', periodType: 'week', periodStart: '2026-10-12T00:00:00Z', periodEnd: '2026-10-19T00:00:00Z', generatedAt: '2026-10-19T00:05:12Z' };

/**
 * Minimal well-formedness check: every element closes in order, no raw `<`/`&` in text.
 * @param {string} xml
 */
function assertBalanced(xml) {
  const body = xml.replace(/^<\?xml[^>]*\?>\s*/, '');
  const stack = [];
  const re = /<(\/?)([A-Za-z][\w:-]*)([^<>]*?)(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(body))) {
    if (m[5] !== undefined) {
      assert.doesNotMatch(m[5], /&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/, `unescaped & in ${JSON.stringify(m[5].slice(0, 40))}`);
      continue;
    }
    if (m[4]) continue; // self-closing
    if (m[1]) assert.equal(stack.pop(), m[2], `mismatched </${m[2]}>`);
    else stack.push(m[2]);
  }
  assert.deepEqual(stack, [], 'unclosed elements');
}

describe('helpers', () => {
  test('rfc3339 normalises to second precision UTC and rejects junk', () => {
    assert.equal(rfc3339('2026-10-17T08:00:00Z'), '2026-10-17T08:00:00Z');
    assert.equal(rfc3339('2026-10-17T09:00:00+01:00'), '2026-10-17T08:00:00Z');
    assert.equal(rfc3339(new Date(1700000000123)), '2023-11-14T22:13:20Z');
    assert.equal(rfc3339('nope'), '');
    assert.equal(rfc3339(undefined), '');
  });
  test('xmlEsc escapes the five characters', () => {
    assert.equal(xmlEsc(`a & b < c > "d"`), 'a &amp; b &lt; c &gt; &quot;d&quot;');
  });
});

describe('item mapping', () => {
  test('activity: title, page link, headline-stats summary, published = start, updated = showcased', async () => {
    const { activities, index } = await fixtures();
    const it = activityItem(activities.find((a) => a.slug === 'colwick-parkrun-2026-10-17'), index, SITE);
    assert.ok(it);
    assert.equal(it.kind, 'activity');
    assert.equal(it.id, 'colwick-parkrun-2026-10-17');
    assert.equal(it.title, 'Colwick parkrun #87');
    assert.equal(it.link, `${SITE}/life/activity/colwick-parkrun-2026-10-17/`);
    assert.match(it.summary, /^Run · 5\.01 km · 19:52 · 3:58 \/km · 171 bpm · 1 PR · Colwick Park, Nottingham\. Went out hard/);
    assert.equal(it.published, '2026-10-17T08:00:00Z');
    assert.equal(it.updated, rfc3339(activities[0].entry.createdAt));
    assert.equal(it.sortKey, Date.parse('2026-10-17T08:00:00Z'));
  });
  test('activity: strength summary names sets/volume once and the PR count once', async () => {
    const { activities, index } = await fixtures();
    const it = activityItem(activities.find((a) => a.slug === 'push-day-2026-10-13'), index, SITE);
    assert.ok(it);
    assert.match(it.summary, /^Weight training · 18 sets · 6,286 kg · 57 min · 2 PRs\. Bench finally moved/);
    assert.doesNotMatch(it.summary, /\+2|personal records/);
  });
  test('activity: no start time → no item', async () => {
    const { index } = await fixtures();
    assert.equal(activityItem({ slug: 'x', activity: { title: 'X' }, entry: {} }, index, SITE), null);
  });
  test('roundup: kicker title, totals line then the AI summary, dated by generatedAt', async () => {
    const { roundups } = await fixtures();
    const it = roundupItem(WEEK_PAGE, roundups[0], SITE);
    assert.ok(it);
    assert.equal(it.kind, 'roundup');
    assert.equal(it.id, 'week-42-2026');
    assert.equal(it.title, 'Weekly roundup: Week 42 · 2026');
    assert.equal(it.link, `${SITE}/life/roundup/week-42-2026`);
    assert.match(it.summary, /^Week 42 · 2026 — 3 sessions, 2h 30m, 37\.4 km, 3 PRs\. Three sessions, three different shapes/);
    assert.equal(it.published, '2026-10-19T00:05:12Z');
    assert.equal(it.updated, '2026-10-19T00:05:12Z');
  });
  test('roundup: no AI summary → totals only; no generatedAt → periodEnd; bad key → null', () => {
    const page = { key: 'month-10-2026', url: '/life/roundup/month-10-2026', periodEnd: '2026-11-01T00:00:00Z' };
    const it = roundupItem(page, { key: 'month-10-2026', roundup: { periodType: 'ROUNDUP_PERIOD_TYPE_MONTH', periodStart: '2026-10-01T00:00:00Z', periodEnd: '2026-11-01T00:00:00Z', totalActivities: 1, totalDurationSeconds: 1800, totalDistanceMeters: 100 } }, SITE);
    assert.ok(it);
    assert.equal(it.title, 'Monthly roundup: October 2026');
    assert.equal(it.summary, 'October 2026 — 1 session, 30m.');
    assert.equal(it.published, '2026-11-01T00:00:00Z');
    assert.equal(roundupItem({ key: '../x', url: '/x' }, undefined, SITE), null);
  });
});

describe('feedItems', () => {
  test('interleaves activities and roundups newest first', async () => {
    const data = await fixtures();
    const items = feedItems({ activities: data.activities, roundupPages: [WEEK_PAGE], roundups: data.roundups, index: data.index, siteUrl: SITE });
    assert.deepEqual(items.map((i) => `${i.kind}:${i.id}`), [
      'roundup:week-42-2026',
      'activity:colwick-parkrun-2026-10-17',
      'activity:evening-ride-to-the-reservoir-2026-10-15',
      'activity:push-day-2026-10-13',
    ]);
  });
  test('caps at 50 and skips unusable entries without throwing', async () => {
    const data = await fixtures();
    const base = data.activities[0];
    const many = Array.from({ length: 70 }, (_, i) => ({
      ...base,
      slug: `run-${i}`,
      activity: { ...base.activity, showcaseId: `run-${i}`, startTime: new Date(Date.UTC(2026, 0, 1 + i)).toISOString() },
      entry: { ...base.entry, showcaseId: `run-${i}`, startTime: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(), createdAt: undefined },
    }));
    const warnings = [];
    const items = feedItems({ activities: [...many, { slug: 'broken', activity: null, entry: null }], roundupPages: [{ key: 'bad key' }], index: data.index, siteUrl: SITE, logger: { warn: (m) => warnings.push(m) } });
    assert.equal(items.length, FEED_LIMIT);
    assert.equal(items[0].id, 'run-69');
    assert.equal(items[49].id, 'run-20');
    assert.ok(items.every((i) => i.updated === i.published), 'no createdAt → updated falls back to published');
  });
});

describe('buildAtom', () => {
  test('is balanced, escaped, newest first, with self/alternate links and feed updated = latest entry', async () => {
    const data = await fixtures();
    const items = feedItems({ activities: data.activities, roundupPages: [WEEK_PAGE], roundups: data.roundups, index: data.index, siteUrl: SITE });
    items[1].title = 'Tom & Jerry <5K> "race"';
    const xml = buildAtom(items, { siteUrl: SITE });
    assertBalanced(xml);
    assert.match(xml, /^<\?xml version="1.0" encoding="utf-8"\?>\n<feed xmlns="http:\/\/www\.w3\.org\/2005\/Atom">/);
    assert.match(xml, /<link rel="self" type="application\/atom\+xml" href="https:\/\/james\.ripixel\.co\.uk\/life\/feed\.xml"\/>/);
    assert.match(xml, /<link rel="alternate" type="text\/html" href="https:\/\/james\.ripixel\.co\.uk\/life"\/>/);
    assert.match(xml, /<title>Tom &amp; Jerry &lt;5K&gt; &quot;race&quot;<\/title>/);
    assert.equal((xml.match(/<entry>/g) || []).length, 4);
    assert.ok(xml.indexOf('week-42-2026') < xml.indexOf('colwick-parkrun'), 'roundup (generated 19 Oct) precedes the 17 Oct run');
    assert.match(xml, /<feed[^]*?<updated>2026-10-19T00:05:12Z<\/updated>/);
    assert.match(xml, /<category term="roundup" label="Roundup"\/>/);
    assert.match(xml, /<summary type="text">Run · 5\.01 km/);
    assert.doesNotMatch(xml, /fitglue\.tech/);
  });
  test('an empty feed is still a valid feed', () => {
    const xml = buildAtom([], { siteUrl: SITE, now: new Date('2026-10-25T12:00:00Z') });
    assertBalanced(xml);
    assert.match(xml, /<updated>2026-10-25T12:00:00Z<\/updated>/);
    assert.doesNotMatch(xml, /<entry>/);
  });
});

describe('fitnessFeedTask', () => {
  test('writes public/personal/life/feed.xml from the globals', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'fitness-feed-'));
    try {
      const data = await fixtures();
      const logs = [];
      const task = fitnessFeedTask({ outDir: tmp });
      const out = await task.run(task.config, {
        debug: false,
        globals: { siteUrl: SITE, fitnessIndex: data.index, fitnessActivities: data.activities, fitnessRoundups: data.roundups, fitnessRoundupPages: [WEEK_PAGE] },
        logger: { info: (m) => logs.push(m), warn: (m) => logs.push(m), error: (m) => logs.push(m), debug() {} },
      });
      assert.deepEqual(out, { fitnessFeedPath: FEED_PATH, fitnessFeedCount: 4 });
      const xml = await fs.readFile(path.join(tmp, 'life', 'feed.xml'), 'utf8');
      assertBalanced(xml);
      assert.equal((xml.match(/<entry>/g) || []).length, 4);
      assert.match(logs.join('\n'), /4 entries \(3 activities, 1 roundups\)/);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
  test('with no fitness data writes an empty, valid feed', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'fitness-feed-'));
    try {
      const task = fitnessFeedTask({ outDir: tmp });
      const out = await task.run(task.config, { debug: false, globals: {}, logger: { info() {}, warn() {}, error() {}, debug() {} } });
      assert.equal(out.fitnessFeedCount, 0);
      assertBalanced(await fs.readFile(path.join(tmp, 'life', 'feed.xml'), 'utf8'));
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});
