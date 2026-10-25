// @ts-check
/**
 * Fitness Atom feed task (S2.5): /life/feed.xml.
 *
 * Activities (from `fitnessActivities`) and roundups (from the pages S2.4
 * actually wrote, `fitnessRoundupPages`, with the AI summary pulled from
 * `fitnessRoundups`) interleaved newest first, capped at 50 entries. Each
 * entry carries the page title, its link, a plain-text summary — headline
 * numbers for an activity, the totals line plus the AI summary for a roundup
 * — and `published` / `updated`.
 *
 * Skier's generateFeedTask writes fixed filenames (rss.xml / atom.xml /
 * json.json) next to the thoughts feed, so this writes Atom directly; it is
 * forty lines of escaping and the feed stays one file where the spec put it.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

import { buildActivityView } from './fitness-activity-pages.mjs';
import { periodLabels, parsePeriodKey, fmtKm, fmtDuration } from './fitness-roundup-pages.mjs';

export const FEED_PATH = '/life/feed.xml';
export const FEED_LIMIT = 50;
export const DEFAULT_OUT_DIR = 'public/personal';
export const DEFAULT_SITE_URL = 'https://james.ripixel.co.uk';
export const FEED_TITLE = 'James King — fitness';
export const FEED_SUBTITLE = 'Every showcased session and roundup from /life.';

/** @param {unknown} s */
export function xmlEsc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** RFC 3339 UTC or '' for anything unparseable. @param {unknown} iso */
export function rfc3339(iso) {
  const t = Date.parse(String(iso ?? ''));
  return Number.isFinite(t) ? new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z') : '';
}

/** @param {unknown} v */
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/**
 * @typedef {{ kind: 'activity'|'roundup', id: string, title: string, link: string, summary: string, published: string, updated: string, sortKey: number }} FeedItem
 */

/**
 * One feed item per activity: title, link, "Run · 5.0 km · 19:52 · 3:58 /km ·
 * 171 bpm · Colwick Park" plus the athlete's description / AI summary text.
 * @param {any} file   an element of `fitnessActivities`
 * @param {any} index  `fitnessIndex`
 * @param {string} siteUrl
 * @returns {FeedItem | null}
 */
export function activityItem(file, index, siteUrl) {
  const view = buildActivityView(file, index, { siteUrl });
  const act = view.act;
  if (!act.slug || !act.dateIso) return null;
  const published = rfc3339(act.dateIso);
  if (!published) return null;
  const entry = file?.entry ?? file?.indexEntry ?? {};
  const updated = rfc3339(entry.createdAt) || published;
  const type = String(act.typeLabel || '');
  const bits = [type.charAt(0) + type.slice(1).toLowerCase()];
  for (const a of act.anchors) {
    if (!a.value || a.value === '—' || a.label === 'activity type' || a.label === 'personal records') continue;
    if (a.unit) bits.push(`${a.value} ${a.unit}`);
    else if (a.label === 'time' || a.label === 'duration') bits.push(String(a.value));
    else bits.push(`${a.value} ${a.label}`);
  }
  if (act.prCount > 0) bits.push(`${act.prCount} PR${act.prCount === 1 ? '' : 's'}`);
  const location = String(file?.activity?.enrichments?.location?.locationName ?? entry.locationName ?? '').trim();
  if (location) bits.push(location);
  let summary = bits.filter(Boolean).join(' · ');
  const blurb = String(act.description || '').trim() || (act.aiSummaryHtml ? act.ogDescription : '');
  if (blurb) summary += `. ${blurb}`;
  return {
    kind: 'activity',
    id: act.slug,
    title: act.title,
    link: act.canonical,
    summary,
    published,
    updated,
    sortKey: Date.parse(published),
  };
}

/**
 * One feed item per roundup page: "Week 42 · 2026 — 3 sessions, 2h 29m,
 * 37.4 km, 2 PRs." followed by the AI summary text when there is one.
 * @param {{ key: string, url: string, title?: string, generatedAt?: string, periodEnd?: string }} page  an element of `fitnessRoundupPages`
 * @param {any} file  the matching element of `fitnessRoundups` (may be undefined)
 * @param {string} siteUrl
 * @returns {FeedItem | null}
 */
export function roundupItem(page, file, siteUrl) {
  if (!page || !parsePeriodKey(page.key)) return null;
  const r = file?.roundup ?? {};
  const labels = periodLabels(page.key, r);
  const generated = rfc3339(page.generatedAt || r.generatedAt) || rfc3339(page.periodEnd || r.periodEnd);
  if (!generated) return null;
  const sessions = num(r.totalActivities);
  const bits = [`${sessions} session${sessions === 1 ? '' : 's'}`];
  if (num(r.totalDurationSeconds) > 0) bits.push(fmtDuration(num(r.totalDurationSeconds)));
  if (num(r.totalDistanceMeters) > 500) bits.push(`${fmtKm(num(r.totalDistanceMeters))} km`);
  const prs = Array.isArray(r.prsAchieved) ? r.prsAchieved.length : 0;
  if (prs) bits.push(`${prs} PR${prs === 1 ? '' : 's'}`);
  const ai = typeof r.aiSummary === 'string' ? r.aiSummary.trim() : '';
  const title = `${labels.kicker.charAt(0)}${labels.kicker.slice(1).toLowerCase()}: ${labels.short}`;
  const link = `${siteUrl.replace(/\/+$/, '')}${page.url}`;
  return {
    kind: 'roundup',
    id: page.key,
    title,
    link,
    summary: `${labels.short} — ${bits.join(', ')}.${ai ? ` ${ai}` : ''}`,
    published: generated,
    updated: generated,
    sortKey: Date.parse(generated),
  };
}

/**
 * Interleave activities and roundups newest first and cap the list.
 * @param {{ activities?: any[], roundupPages?: any[], roundups?: any[], index?: any, siteUrl?: string, limit?: number, logger?: any }} opts
 * @returns {FeedItem[]}
 */
export function feedItems(opts = {}) {
  const siteUrl = opts.siteUrl || DEFAULT_SITE_URL;
  const limit = opts.limit ?? FEED_LIMIT;
  const warn = opts.logger?.warn ? (/** @type {string} */ m) => opts.logger.warn(m) : () => {};
  /** @type {FeedItem[]} */
  const items = [];
  for (const file of opts.activities || []) {
    try {
      const it = activityItem(file, opts.index, siteUrl);
      if (it) items.push(it);
    } catch (e) {
      warn(`feed: activity ${JSON.stringify(file?.slug)} skipped: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const byKey = new Map((opts.roundups || []).filter((f) => f && typeof f.key === 'string').map((f) => [f.key, f]));
  for (const page of opts.roundupPages || []) {
    try {
      const it = roundupItem(page, byKey.get(page?.key), siteUrl);
      if (it) items.push(it);
    } catch (e) {
      warn(`feed: roundup ${JSON.stringify(page?.key)} skipped: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  items.sort((a, b) => b.sortKey - a.sortKey || a.id.localeCompare(b.id));
  return items.slice(0, limit);
}

/**
 * Serialise an Atom 1.0 feed.
 * @param {FeedItem[]} items
 * @param {{ siteUrl?: string, title?: string, subtitle?: string, now?: Date }} [opts]
 */
export function buildAtom(items, opts = {}) {
  const siteUrl = (opts.siteUrl || DEFAULT_SITE_URL).replace(/\/+$/, '');
  const self = `${siteUrl}${FEED_PATH}`;
  const home = `${siteUrl}/life`;
  const latest = items.reduce((m, i) => Math.max(m, Date.parse(i.updated) || 0), 0);
  const updated = rfc3339(latest ? new Date(latest) : (opts.now || new Date()));
  const entries = items
    .map((i) => `  <entry>
    <id>${xmlEsc(i.link)}</id>
    <title>${xmlEsc(i.title)}</title>
    <link rel="alternate" type="text/html" href="${xmlEsc(i.link)}"/>
    <published>${xmlEsc(i.published)}</published>
    <updated>${xmlEsc(i.updated)}</updated>
    <category term="${i.kind}" label="${i.kind === 'activity' ? 'Activity' : 'Roundup'}"/>
    <summary type="text">${xmlEsc(i.summary)}</summary>
  </entry>`)
    .join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>${xmlEsc(home)}/</id>
  <title>${xmlEsc(opts.title || FEED_TITLE)}</title>
  <subtitle>${xmlEsc(opts.subtitle || FEED_SUBTITLE)}</subtitle>
  <link rel="self" type="application/atom+xml" href="${xmlEsc(self)}"/>
  <link rel="alternate" type="text/html" href="${xmlEsc(home)}"/>
  <updated>${updated}</updated>
  <author>
    <name>James King</name>
    <uri>${xmlEsc(siteUrl)}/</uri>
  </author>
  <generator uri="https://github.com/Ripixel-Studio/ripixel-website">ripixel-website</generator>
${entries}
</feed>
`;
}

/**
 * The Skier task. Runs after the activity and roundup page tasks.
 * @param {{ outDir?: string, limit?: number }} [config]
 */
export function fitnessFeedTask(config = {}) {
  return {
    name: 'fitness-feed',
    title: `Generate the fitness Atom feed (${FEED_PATH})`,
    config,
    run: async (/** @type {any} */ cfg, /** @type {any} */ ctx) => {
      const g = ctx.globals;
      const outDir = cfg.outDir || DEFAULT_OUT_DIR;
      const siteUrl = g.siteUrl || DEFAULT_SITE_URL;
      const items = feedItems({
        activities: g.fitnessActivities,
        roundupPages: g.fitnessRoundupPages,
        roundups: g.fitnessRoundups,
        index: g.fitnessIndex,
        siteUrl,
        limit: cfg.limit,
        logger: ctx.logger,
      });
      const outPath = path.join(outDir, ...FEED_PATH.split('/').filter(Boolean));
      await fs.mkdir(path.dirname(outPath), { recursive: true });
      await fs.writeFile(outPath, buildAtom(items, { siteUrl }));
      const kinds = items.reduce((m, i) => ({ ...m, [i.kind]: (m[i.kind] || 0) + 1 }), /** @type {Record<string, number>} */ ({}));
      ctx.logger.info(`Fitness feed: ${items.length} entries (${kinds.activity || 0} activities, ${kinds.roundup || 0} roundups) → ${outPath}`);
      return { fitnessFeedPath: FEED_PATH, fitnessFeedCount: items.length };
    },
  };
}
