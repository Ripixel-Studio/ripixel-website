// @ts-check
/**
 * Fitness OG images task (S2.5).
 *
 * One 1200×630 card per activity and roundup page, drawn by
 * scripts/generate-og-images.mjs (the same frame as the section cards) and
 * written to public/personal/life/og/{activity,roundup}/<id>.png. Cards are
 * cached in .cache/og/ keyed by a hash of their SVG, so a rebuild only
 * rasterises what changed.
 *
 * Runs BEFORE the page tasks: it returns `fitnessOgImages`
 * ({ activity: { [slug]: url }, roundup: { [key]: url } }) and the activity /
 * roundup page tasks read that to set `og:image`. A page whose card is missing
 * (sharp unavailable, a render error) falls back to its banner / photo /
 * card_life.png — the build never fails here.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

import { buildFitnessCardSVG, rasterise } from '../scripts/generate-og-images.mjs';
import { buildActivityView } from './fitness-activity-pages.mjs';
import { buildHyroxHistory } from './fitness-hyrox.mjs';
import { buildRoundupView, parsePeriodKey } from './fitness-roundup-pages.mjs';

export const DEFAULT_OUT_DIR = 'public/personal/life/og';
export const DEFAULT_CACHE_DIR = '.cache/og';
export const DEFAULT_URL_BASE = '/life/og';
export const DEFAULT_CONCURRENCY = 4;

/** Same shape the page tasks accept; ids become file names. */
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/;

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

// ---------------------------------------------------------------------------
// What goes on each card

/**
 * Card content for one activity file: the page's own title, type + date +
 * location as the kicker, and its four hero anchor cells as the numbers.
 * @param {any} file   an element of `fitnessActivities`
 * @param {any} index  `fitnessIndex`
 * @param {import('./fitness-hyrox.mjs').HyroxHistory|null} [hyrox]  for Hyrox races: PBs per division
 * @returns {{ id: string, kind: 'activity', card: import('../scripts/generate-og-images.mjs').FitnessCard } | null}
 */
export function activityCard(file, index, hyrox = null) {
  const view = buildActivityView(file, index, { hyrox });
  const act = view.act;
  if (!SAFE_ID.test(act.slug)) return null;
  if (act.race) return raceCard(act);
  const kickerBits = [act.typeLabel, act.dateStamp];
  if (act.locationName) kickerBits.push(act.locationName);
  const stats = act.anchors.filter((a) => a.value && a.value !== '—').map((a) => ({ value: String(a.value), unit: a.unit || '', label: a.label }));
  return {
    id: act.slug,
    kind: 'activity',
    card: {
      kicker: kickerBits.filter(Boolean).join(' · '),
      title: act.title,
      stats,
      pill: 'FITNESS',
      footnote: act.prCount > 0 ? `+${act.prCount} PERSONAL RECORD${act.prCount === 1 ? '' : 'S'}` : (act.source ? `VIA ${String(act.source).toUpperCase()}` : ''),
    },
  };
}

/**
 * A Hyrox race's card: the division in the kicker, finish time and placings as the
 * numbers, and the PB badge (or the gap to the division PB) as the footnote.
 * @param {any} act  buildActivityView().act with a race
 */
export function raceCard(act) {
  const r = act.race;
  const kicker = ['HYROX', r.divisionLabel, act.dateStamp, act.locationName || String(r.event || '').toUpperCase()].filter(Boolean).join(' · ');
  const stats = act.anchors.filter((a) => a.value && a.value !== '—').map((a) => ({ value: String(a.value), unit: a.unit || '', label: a.label }));
  let footnote = '';
  if (r.isTotalPB) footnote = `NEW ${r.divisionLabel.toUpperCase()} PB${r.totalPbTime ? ` · PREVIOUS ${r.totalPbTime}` : ''}`;
  else if (r.isFirst) footnote = `FIRST ${r.divisionLabel.toUpperCase()} RACE`;
  else if (r.totalDelta) footnote = `${r.totalDelta.replace('−', '-')} VS ${r.divisionLabel.toUpperCase()} PB ${r.totalPbTime}`;
  else if (r.isSimulation) footnote = 'SIMULATION';
  return {
    id: act.slug,
    kind: /** @type {const} */ ('activity'),
    card: { kicker, title: act.title, stats, pill: r.isTotalPB ? 'PB' : 'HYROX', footnote },
  };
}

/**
 * Card content for one roundup file: period kicker + date range, the big
 * period title, and the page's adaptive 4-up totals.
 * @param {any} file  an element of `fitnessRoundups`
 * @returns {{ id: string, kind: 'roundup', card: import('../scripts/generate-og-images.mjs').FitnessCard } | null}
 */
export function roundupCard(file) {
  if (!file || !parsePeriodKey(file.key)) return null;
  const view = buildRoundupView(file, { byKey: new Map(), neighbours: new Map(), activitySlugs: new Set(), showPhotoGallery: false });
  const kicker = [view.kicker, view.dateRange].filter(Boolean).join(' · ');
  const prs = view.prCount > 0 ? `+${view.prCount} PERSONAL RECORD${view.prCount === 1 ? '' : 'S'}` : '';
  return {
    id: file.key,
    kind: 'roundup',
    card: {
      kicker,
      title: view.type === 'year' ? `${view.title} IN REVIEW` : view.title,
      stats: view.totals.filter((t) => t.value && t.value !== '—').map((t) => ({ value: String(t.value), unit: t.unit || '', label: t.label })),
      pill: 'ROUNDUP',
      footnote: prs,
    },
  };
}

// ---------------------------------------------------------------------------
// Rendering with a cache

/** @param {string} s */
const sha = (s) => crypto.createHash('sha1').update(s).digest('hex');

/** @param {string} p */
async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

/**
 * Render every card into `outDir`, reusing `.cache/og` where the SVG has not
 * changed. Returns the URL map the page tasks consume plus counts.
 * @param {{ activities?: any[], roundups?: any[], index?: any, outDir?: string, cacheDir?: string, urlBase?: string, siteUrl?: string, fontCacheDir?: string, concurrency?: number, logger?: any }} opts
 */
export async function renderFitnessCards(opts = {}) {
  const outDir = opts.outDir || DEFAULT_OUT_DIR;
  const cacheDir = opts.cacheDir || DEFAULT_CACHE_DIR;
  const urlBase = (opts.urlBase || DEFAULT_URL_BASE).replace(/\/+$/, '');
  const siteUrl = (opts.siteUrl || '').replace(/\/+$/, '');
  const concurrency = Math.max(1, opts.concurrency || DEFAULT_CONCURRENCY);
  const logger = opts.logger || silentLogger;
  const index = opts.index || {};

  /** @type {Array<{ id: string, kind: 'activity'|'roundup', card: any }>} */
  const jobs = [];
  const hyrox = buildHyroxHistory(opts.activities || []);
  for (const file of opts.activities || []) {
    try {
      const c = activityCard(file, index, hyrox);
      if (c) jobs.push(c);
    } catch (e) {
      logger.warn(`og card skipped for activity ${JSON.stringify(file?.slug)}: ${errMsg(e)}`);
    }
  }
  for (const file of opts.roundups || []) {
    try {
      const c = roundupCard(file);
      if (c) jobs.push(c);
    } catch (e) {
      logger.warn(`og card skipped for roundup ${JSON.stringify(file?.key)}: ${errMsg(e)}`);
    }
  }

  const urls = { activity: /** @type {Record<string, string>} */ ({}), roundup: /** @type {Record<string, string>} */ ({}) };
  let rendered = 0, cached = 0, failed = 0;

  async function one(/** @type {typeof jobs[number]} */ job) {
    const svg = buildFitnessCardSVG(job.card);
    const hash = sha(svg);
    const outPath = path.join(outDir, job.kind, `${job.id}.png`);
    const cachePng = path.join(cacheDir, job.kind, `${job.id}.png`);
    const cacheKey = path.join(cacheDir, job.kind, `${job.id}.sha1`);
    try {
      await fs.mkdir(path.dirname(outPath), { recursive: true });
      let hit = false;
      if (await exists(cachePng) && await exists(cacheKey)) {
        hit = (await fs.readFile(cacheKey, 'utf8')).trim() === hash;
      }
      if (hit) {
        await fs.copyFile(cachePng, outPath);
        cached++;
      } else {
        await rasterise(svg, outPath, { fontCacheDir: opts.fontCacheDir });
        await fs.mkdir(path.dirname(cachePng), { recursive: true });
        await fs.copyFile(outPath, cachePng);
        await fs.writeFile(cacheKey, hash);
        rendered++;
      }
      urls[job.kind][job.id] = `${siteUrl}${urlBase}/${job.kind}/${job.id}.png`;
    } catch (e) {
      failed++;
      logger.warn(`og card failed for ${job.kind} ${job.id}: ${errMsg(e)}`);
    }
  }

  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
    while (next < jobs.length) await one(jobs[next++]);
  }));

  return { urls, rendered, cached, failed, total: jobs.length };
}

/** @param {unknown} e */
const errMsg = (e) => (e instanceof Error ? e.message : String(e));

// ---------------------------------------------------------------------------
// The Skier task

/**
 * @param {{ outDir?: string, cacheDir?: string, urlBase?: string, concurrency?: number }} [config]
 */
export function fitnessOgImagesTask(config = {}) {
  return {
    name: 'fitness-og-images',
    title: 'Render OG cards for fitness activity and roundup pages',
    config,
    run: async (/** @type {any} */ cfg, /** @type {any} */ ctx) => {
      const g = ctx.globals;
      const empty = { activity: {}, roundup: {} };
      const activities = Array.isArray(g.fitnessActivities) ? g.fitnessActivities : [];
      const roundups = Array.isArray(g.fitnessRoundups) ? g.fitnessRoundups : [];
      if (!activities.length && !roundups.length) {
        ctx.logger.warn('No fitness activities or roundups — no OG cards to render');
        return { fitnessOgImages: empty };
      }
      try {
        const result = await renderFitnessCards({
          ...cfg,
          activities,
          roundups,
          index: g.fitnessIndex,
          siteUrl: g.siteUrl,
          logger: ctx.logger,
        });
        ctx.logger.info(`OG cards: ${result.rendered} rendered, ${result.cached} from cache, ${result.failed} failed (${result.total} pages)`);
        return { fitnessOgImages: result.urls };
      } catch (e) {
        ctx.logger.warn(`OG cards unavailable, pages fall back to banner/photo/card_life.png: ${errMsg(e)}`);
        return { fitnessOgImages: empty };
      }
    },
  };
}
