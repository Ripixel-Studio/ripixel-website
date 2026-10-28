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
  htmlEsc,
  activityItem,
  roundupItem,
  roundupPageMeta,
  feedItems,
  toFeedArticles,
  feedUpdated,
  fitnessFeedItemsTask,
} from './fitness-feed-items.mjs';
import { loadFitnessData } from './fitness-fetch.mjs';
import { lifePageTasks } from './life-pages.mjs';
import { runSkierTasks } from './skier-test-runner.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = path.join(REPO, 'fixtures', 'fitness');
const SITE = 'https://james.ripixel.co.uk';

async function fixtures() {
  return loadFitnessData({ env: {}, source: 'fixtures', fixturesDir: FIXTURES });
}
/** The feed's view (`roundupPageMeta`) of the fixture roundup's page. */
const WEEK_PAGE = { key: 'week-42-2026', url: '/life/roundup/week-42-2026', generatedAt: '2026-10-19T00:05:12Z' };
/** The same roundup as an element of `fitnessRoundupPages` (page variables from fitness-roundup-views). */
const WEEK_PAGE_VARS = { page: 'life', subpage: '| week 42 2026 roundup', roundup: { ...WEEK_PAGE, short: 'Week 42 · 2026' } };

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
  test('htmlEsc escapes &, <, > and "', () => {
    assert.equal(htmlEsc(`a & b < c > "d"`), 'a &amp; b &lt; c &gt; &quot;d&quot;');
  });
  test('roundupPageMeta reads key, url and generatedAt from the page variables', () => {
    assert.deepEqual(roundupPageMeta(WEEK_PAGE_VARS), WEEK_PAGE);
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
    assert.equal(it.link, `${SITE}/life/activity/colwick-parkrun-2026-10-17`);
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

describe('toFeedArticles / feedUpdated', () => {
  test('maps items onto Skier FeedArticles: escaped text, id = link, dates, kind as category', async () => {
    const data = await fixtures();
    const items = feedItems({ activities: data.activities, roundupPages: [WEEK_PAGE], roundups: data.roundups, index: data.index, siteUrl: SITE });
    items[1].title = 'Tom & Jerry <5K> "race"';
    const articles = toFeedArticles(items);
    assert.equal(articles.length, 4);
    assert.deepEqual(articles[0].categories, [{ term: 'roundup', name: 'Roundup' }]);
    assert.deepEqual(articles[1].categories, [{ term: 'activity', name: 'Activity' }]);
    assert.equal(articles[1].title, 'Tom &amp; Jerry &lt;5K&gt; &quot;race&quot;');
    assert.equal(articles[1].id, articles[1].link);
    assert.equal(articles[0].publishedObj.toISOString(), '2026-10-19T00:05:12.000Z');
    assert.ok(articles.every((a) => a.dateObj instanceof Date && !Number.isNaN(a.dateObj.getTime())));
    assert.ok(articles.every((a) => !('body' in a)), 'summary only, no <content>');
  });
  test('feed <updated> is the latest entry, or now for an empty feed', async () => {
    const data = await fixtures();
    const items = feedItems({ activities: data.activities, roundupPages: [WEEK_PAGE], roundups: data.roundups, index: data.index, siteUrl: SITE });
    assert.equal(feedUpdated(items).toISOString(), '2026-10-19T00:05:12.000Z');
    const now = new Date('2026-10-25T12:00:00Z');
    assert.equal(feedUpdated([], now), now);
  });
});

describe('fitnessFeedItemsTask + Skier generateFeedTask', () => {
  /** Run the items task and the feed task from life-pages.mjs into a temp dir. */
  async function build(globals) {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'fitness-feed-'));
    const feedTask = lifePageTasks({ outDir: tmp, siteUrl: SITE })[3];
    const logs = [];
    await runSkierTasks([fitnessFeedItemsTask(), feedTask], globals, logs);
    return { tmp, logs, xml: await fs.readFile(path.join(tmp, 'life', 'feed.xml'), 'utf8') };
  }

  test('writes public/personal/life/feed.xml from the globals: balanced, newest first, self/alternate links', async () => {
    const data = await fixtures();
    const { tmp, xml } = await build({ siteUrl: SITE, fitnessIndex: data.index, fitnessActivities: data.activities, fitnessRoundups: data.roundups, fitnessRoundupPages: [WEEK_PAGE_VARS] });
    try {
      assertBalanced(xml.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, 'cdata'));
      assert.match(xml, /^<\?xml version="1.0" encoding="utf-8"\?>\n<feed xmlns="http:\/\/www\.w3\.org\/2005\/Atom">/);
      assert.match(xml, /<link rel="self" href="https:\/\/james\.ripixel\.co\.uk\/life\/feed\.xml"\/>/);
      assert.match(xml, /<link rel="alternate" href="https:\/\/james\.ripixel\.co\.uk\/life"\/>/);
      assert.match(xml, /<id>https:\/\/james\.ripixel\.co\.uk\/life<\/id>/);
      assert.equal((xml.match(/<entry>/g) || []).length, 4);
      assert.ok(xml.indexOf('week-42-2026') < xml.indexOf('colwick-parkrun'), 'roundup (generated 19 Oct) precedes the 17 Oct run');
      assert.match(xml, /<feed[^]*?<updated>2026-10-19T00:05:12\.000Z<\/updated>/);
      assert.match(xml, /<category label="Roundup" term="roundup"\/>/);
      assert.match(xml, /<summary type="html"><!\[CDATA\[Run · 5\.01 km/);
      assert.match(xml, /<generator>ripixel-website<\/generator>/);
      assert.doesNotMatch(xml, /fitglue\.tech/);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
  test('with no fitness data writes an empty, valid feed', async () => {
    const { tmp, xml } = await build({});
    try {
      assertBalanced(xml);
      assert.doesNotMatch(xml, /<entry>/);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});
