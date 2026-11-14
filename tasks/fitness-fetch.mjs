// @ts-check
/**
 * Fitness data fetch task.
 *
 * Downloads the FitGlue showcase export (see jarvis-memory
 * specs/ripixel-website/fitness-zine.md, "Data contract (S0)") and exposes it
 * to templates as globals. The export lives on a public GCS bucket:
 *
 *   <base>/index.json
 *   <base>/activity/<showcaseId>.json
 *   <base>/roundup/<periodKey>.json
 *   <base>/events.json          (S2.6: the Fitness calendars, written by the box)
 *   <base>/life/index.json      (life hub export, plan 2; schema in jarvis docs/domains/lifehub.md)
 *   <base>/life/heatmap.json    (trimmed route segments, plan 3 Task 2)
 *   <base>/life/period/<periodKey>.json  (per-roundup sidecar, plan 4; optional, one per roundup key)
 *
 * Source order is live → cache → fixtures → empty, unless FITNESS_DATA_SOURCE
 * forces one. Live is tried twice (the second time with a longer timeout) before
 * it counts as failed. Without a forced source the build never fails because of
 * fitness data: the worst case is `fitnessUnavailable: true` with empty lists.
 * With a forced source (the box deploys with FITNESS_DATA_SOURCE=live) a failure
 * fails the build, so a deploy leaves the live site as it was instead of
 * publishing one with no activities (2026-11-04 21:54: a slow link timed the
 * index out and an empty /life went live for 21 minutes).
 *
 * Globals written (names are the spec's, do not rename):
 *   fitnessIndex        the index.json object (an empty skeleton when unavailable)
 *   fitnessActivities   full activity files, newest first, each + `indexEntry`
 *   fitnessRoundups     full roundup files, newest first
 *   fitnessEvents       the events.json object ({generatedAt, events[]}) or null when
 *                       the source has none — the life page then falls back to the
 *                       hand-written list
 *   lifeIndex           the validated life/index.json or null (optional, like events)
 *   lifeHeatmap         the validated life/heatmap.json or null
 *   lifePeriods         { [roundup key]: validated life/period doc }; {} when there are none
 *   fitnessUnavailable  boolean
 *   fitnessSource       'live' | 'cache' | 'fixtures' | 'none'
 */
import { stampTag } from './fitness-theme.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_BASE_URL =
  'https://storage.googleapis.com/fitglue-server-prod-showcase-assets/site/james';
export const DEFAULT_CACHE_DIR = '.cache/fitness';
export const DEFAULT_FIXTURES_DIR = 'fixtures/fitness';
export const DEFAULT_CONCURRENCY = 8;
export const DEFAULT_TIMEOUT_MS = 20_000;
/** The second live attempt waits this long first and gets RETRY_TIMEOUT_FACTOR × the timeout. */
export const DEFAULT_RETRY_DELAY_MS = 5_000;
const RETRY_TIMEOUT_FACTOR = 3;

const SOURCES = /** @type {const} */ (['live', 'cache', 'fixtures']);
const META_FILE = '.meta.json';
/** Slugs and period keys become file paths; only allow what the exporter can mint. */
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/;

/** @typedef {'live'|'cache'|'fixtures'} Source */
/** @typedef {{ info(m: string): void, warn(m: string): void, error(m: string): void, debug(m: string): void }} Logger */
/**
 * @typedef {object} LoadOptions
 * @property {string} [baseUrl]
 * @property {string} [cacheDir]
 * @property {string} [fixturesDir]
 * @property {Source|null} [source]      forced source; null/undefined = fallback chain
 * @property {number} [concurrency]
 * @property {number} [timeoutMs]
 * @property {number} [retryDelayMs]
 * @property {typeof fetch} [fetchImpl]
 * @property {Logger} [logger]
 * @property {Record<string, string|undefined>} [env]  defaults to process.env
 */
/**
 * @typedef {object} FitnessData
 * @property {any} index
 * @property {any[]} activities
 * @property {any[]} roundups
 * @property {any|null} events
 * @property {any|null} lifeIndex
 * @property {any|null} lifeHeatmap
 * @property {Record<string, any>} lifePeriods
 * @property {Source|'none'} source
 * @property {boolean} unavailable
 * @property {string|null} forced  the source FITNESS_DATA_SOURCE / config forced, else null
 * @property {string[]} notes   one line per source tried and why it was passed over
 */

const silentLogger = /** @type {Logger} */ ({
  info() {},
  warn() {},
  error() {},
  debug() {},
});

/** The shape templates can rely on when nothing could be loaded. */
export function emptyIndex() {
  return {
    schemaVersion: 1,
    generatedAt: null,
    siteSlug: null,
    profile: null,
    streaks: { currentWeeks: 0, longestWeeks: 0 },
    activities: [],
    roundups: [],
  };
}

/**
 * Read env + overrides into a full options object.
 * `FITNESS_DATA_BASE` is the documented name; `FITNESS_DATA_BASE_URL` (the
 * spec's wording) is accepted too.
 * @param {Record<string, string|undefined>} env
 * @param {LoadOptions} [overrides]
 * @param {Logger} [logger]
 */
export function resolveOptions(env = process.env, overrides = {}, logger = silentLogger) {
  const envSource = (env.FITNESS_DATA_SOURCE || '').trim().toLowerCase();
  /** @type {Source|null} */
  let source = overrides.source ?? null;
  if (!source && envSource) {
    if (SOURCES.includes(/** @type {Source} */ (envSource))) {
      source = /** @type {Source} */ (envSource);
    } else {
      logger.warn(
        `FITNESS_DATA_SOURCE='${envSource}' is not one of ${SOURCES.join('|')}; ignoring it`,
      );
    }
  }
  const baseUrl = (
    overrides.baseUrl ||
    env.FITNESS_DATA_BASE ||
    env.FITNESS_DATA_BASE_URL ||
    DEFAULT_BASE_URL
  ).replace(/\/+$/, '');
  return {
    baseUrl,
    cacheDir: overrides.cacheDir || DEFAULT_CACHE_DIR,
    fixturesDir: overrides.fixturesDir || DEFAULT_FIXTURES_DIR,
    source,
    concurrency: Math.max(1, Math.min(overrides.concurrency || DEFAULT_CONCURRENCY, 8)),
    timeoutMs: overrides.timeoutMs || DEFAULT_TIMEOUT_MS,
    retryDelayMs: overrides.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS,
    fetchImpl: overrides.fetchImpl || globalThis.fetch,
    logger,
  };
}

// ---------------------------------------------------------------------------
// Small helpers

/** @param {any} index */
function validateIndex(index) {
  if (!index || typeof index !== 'object') throw new Error('index.json is not an object');
  if (!Array.isArray(index.activities)) throw new Error('index.json has no activities[]');
  if (!Array.isArray(index.roundups)) throw new Error('index.json has no roundups[]');
  return index;
}

/** events.json is optional: anything that is not `{events: []}` counts as absent. @param {any} doc */
export function validateEvents(doc) {
  return doc && typeof doc === 'object' && Array.isArray(doc.events) ? doc : null;
}

/**
 * life/index.json is optional: a wrong schemaVersion or no sections object counts as absent.
 * @param {any} doc @param {Logger} [logger]
 */
export function validateLife(doc, logger = silentLogger) {
  if (doc && typeof doc === 'object' && doc.schemaVersion === 1 && doc.sections &&
      typeof doc.sections === 'object' && !Array.isArray(doc.sections)) return doc;
  logger.warn('life/index.json ignored: expected schemaVersion 1 and a sections object');
  return null;
}

/**
 * life/heatmap.json is optional: segments must be arrays of [number, number] points.
 * @param {any} doc @param {Logger} [logger]
 */
export function validateHeatmap(doc, logger = silentLogger) {
  const ok =
    doc && typeof doc === 'object' && Array.isArray(doc.segments) &&
    doc.segments.every(
      (/** @type {any} */ seg) =>
        Array.isArray(seg) &&
        seg.every(
          (/** @type {any} */ p) =>
            Array.isArray(p) && p.length === 2 && p.every((/** @type {any} */ n) => typeof n === 'number' && Number.isFinite(n)),
        ),
    );
  if (ok) return doc;
  logger.warn('life/heatmap.json ignored: segments must be arrays of [number, number]');
  return null;
}

/**
 * life/period/<key>.json is optional: schemaVersion 1 and a `key` equal to the file name, else dropped.
 * @param {any} doc @param {string} key @param {Logger} [logger]
 */
export function validatePeriod(doc, key, logger = silentLogger) {
  if (doc && typeof doc === 'object' && doc.schemaVersion === 1 && doc.key === key) return doc;
  logger.warn(`life/period/${key}.json ignored: expected schemaVersion 1 and key ${key}`);
  return null;
}

/**
 * Ids listed in the index, filtered to ones that are safe to use as paths.
 * @param {any[]} list
 * @param {string} field
 * @param {Logger} logger
 * @returns {string[]}
 */
function listedIds(list, field, logger) {
  /** @type {string[]} */
  const ids = [];
  for (const entry of list) {
    const id = entry && entry[field];
    if (typeof id !== 'string' || !SAFE_ID.test(id) || id.includes('..')) {
      logger.warn(`index entry with unusable ${field} ${JSON.stringify(id)} skipped`);
      continue;
    }
    ids.push(id);
  }
  return ids;
}

/** @param {string} file */
async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

/** @param {string} file @param {unknown} data */
async function writeJson(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(data));
}

/**
 * Run `fn` over `items` with at most `limit` in flight.
 * @template T, R
 * @param {T[]} items @param {number} limit @param {(item: T) => Promise<R>} fn
 * @returns {Promise<R[]>}
 */
async function pool(items, limit, fn) {
  /** @type {R[]} */
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(/** @type {T} */ (items[i]));
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// ---------------------------------------------------------------------------
// Readers. Each returns { index, activityFiles, roundupFiles } or throws when
// the source is unusable (no index). Missing individual files are skipped.

/** @typedef {{ index: any, activityFiles: Map<string, any>, roundupFiles: Map<string, any>, events: any|null, lifeIndex?: any|null, lifeHeatmap?: any|null, lifePeriods?: Record<string, any> }} RawSet */

/**
 * @param {string} dir
 * @param {Logger} logger
 * @returns {Promise<RawSet>}
 */
export async function readFromDir(dir, logger = silentLogger) {
  const index = validateIndex(await readJson(path.join(dir, 'index.json')));
  const activityFiles = new Map();
  const roundupFiles = new Map();
  for (const id of listedIds(index.activities, 'slug', logger)) {
    try {
      activityFiles.set(id, await readJson(path.join(dir, 'activity', `${id}.json`)));
    } catch (e) {
      logger.warn(`activity/${id}.json unreadable in ${dir}: ${errMsg(e)}`);
    }
  }
  for (const id of listedIds(index.roundups, 'key', logger)) {
    try {
      roundupFiles.set(id, await readJson(path.join(dir, 'roundup', `${id}.json`)));
    } catch (e) {
      logger.warn(`roundup/${id}.json unreadable in ${dir}: ${errMsg(e)}`);
    }
  }
  let events = null;
  try {
    events = validateEvents(await readJson(path.join(dir, 'events.json')));
  } catch (e) {
    logger.debug(`events.json unreadable in ${dir}: ${errMsg(e)}; no calendar`);
  }
  const lifeIndex = await readOptional(path.join(dir, 'life', 'index.json'), validateLife, logger);
  const lifeHeatmap = await readOptional(path.join(dir, 'life', 'heatmap.json'), validateHeatmap, logger);
  /** @type {Record<string, any>} */
  const lifePeriods = {};
  for (const id of roundupFiles.keys()) {
    const doc = await readOptional(path.join(dir, 'life', 'period', `${id}.json`), (d, l) => validatePeriod(d, id, l), logger);
    if (doc) lifePeriods[id] = doc;
  }
  return { index, activityFiles, roundupFiles, events, lifeIndex, lifeHeatmap, lifePeriods };
}

/**
 * Read an optional doc: a missing file is silent (debug), an invalid one warns once.
 * @param {string} file @param {(d: any, l: Logger) => any} validate @param {Logger} logger
 */
async function readOptional(file, validate, logger) {
  let doc;
  try {
    doc = await readJson(file);
  } catch (e) {
    logger.debug(`${file} unreadable: ${errMsg(e)}; skipped`);
    return null;
  }
  return validate(doc, logger);
}

/**
 * Fetch everything the live index lists, writing each file into the cache as
 * it arrives (index last, so a cached index never points at a missing file).
 * Conditional requests: ETags from previous runs are sent as If-None-Match and
 * a 304 re-uses the cached copy.
 * @param {ReturnType<typeof resolveOptions>} opts
 * @returns {Promise<RawSet & { fetched: number, reused: number, failed: number }>}
 */
export async function readLive(opts) {
  const { baseUrl, cacheDir, fetchImpl, concurrency, timeoutMs, logger } = opts;
  if (typeof fetchImpl !== 'function') throw new Error('no fetch implementation available');

  /** @type {Record<string, { etag?: string, lastModified?: string }>} */
  let meta = {};
  try {
    meta = await readJson(path.join(cacheDir, META_FILE));
    if (!meta || typeof meta !== 'object') meta = {};
  } catch {
    meta = {};
  }
  const stats = { fetched: 0, reused: 0, failed: 0 };

  /**
   * GET one file; returns parsed JSON. Writes the cache on 200, reads it on 304.
   * @param {string} rel  e.g. 'activity/foo.json'
   */
  const getFile = async (rel) => {
    const cacheFile = path.join(cacheDir, rel);
    /** @type {Record<string, string>} */
    const headers = { accept: 'application/json' };
    const known = meta[rel];
    let haveCached = false;
    if (known && (known.etag || known.lastModified)) {
      try {
        await fs.access(cacheFile);
        haveCached = true;
        if (known.etag) headers['if-none-match'] = known.etag;
        else if (known.lastModified) headers['if-modified-since'] = known.lastModified;
      } catch {
        haveCached = false;
      }
    }
    const res = await fetchImpl(`${baseUrl}/${rel}`, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'follow',
    });
    if (res.status === 304 && haveCached) {
      stats.reused++;
      return readJson(cacheFile);
    }
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status} for ${rel}`), { status: res.status });
    const text = await res.text();
    const data = JSON.parse(text);
    await fs.mkdir(path.dirname(cacheFile), { recursive: true });
    await fs.writeFile(cacheFile, text);
    const etag = res.headers.get('etag');
    const lastModified = res.headers.get('last-modified');
    if (etag || lastModified) {
      meta[rel] = {};
      if (etag) meta[rel].etag = etag;
      if (lastModified) meta[rel].lastModified = lastModified;
    } else {
      delete meta[rel];
    }
    stats.fetched++;
    return data;
  };

  /**
   * One retry, then the cached copy if there is one, else undefined. With `quiet404` (optional
   * docs) a clean 404 is authoritative: no retry, no warning, not a failure, and the cached copy
   * and its meta entry are deleted so a withdrawn doc stops showing. The cache is used only for
   * 5xx and network errors.
   * @param {string} rel
   * @param {boolean} [quiet404]
   */
  const getFileLenient = async (rel, quiet404 = false) => {
    let lastErr;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await getFile(rel);
      } catch (e) {
        lastErr = e;
        if (quiet404 && /** @type {any} */ (e)?.status === 404) {
          await fs.rm(path.join(cacheDir, rel), { force: true });
          delete meta[rel];
          return undefined;
        }
      }
    }
    try {
      const data = await readJson(path.join(cacheDir, rel));
      logger.warn(`${rel}: ${errMsg(lastErr)}; using cached copy`);
      stats.reused++;
      return data;
    } catch {
      logger.warn(`${rel}: ${errMsg(lastErr)}; skipped`);
      stats.failed++;
      return undefined;
    }
  };

  // index.json first; the index is held in memory and written to the cache
  // last, so we fetch it without going through the cache-writing path.
  const indexRes = await fetchImpl(`${baseUrl}/index.json`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'follow',
  });
  if (!indexRes.ok) throw new Error(`HTTP ${indexRes.status} for index.json`);
  const indexText = await indexRes.text();
  const index = validateIndex(JSON.parse(indexText));
  // A preview build can ask for roundups the index does not list yet (the year before it
  // ends): FITNESS_PREVIEW_ROUNDUPS=year-2026[,…]. Never set for a deploy.
  for (const key of String(process.env.FITNESS_PREVIEW_ROUNDUPS || '').split(',').map((k) => k.trim()).filter(Boolean)) {
    if (/^(week|month|year)-[\d-]+$/.test(key) && !index.roundups.some((/** @type {any} */ r) => r?.key === key)) index.roundups.push({ key });
  }

  const activityIds = listedIds(index.activities, 'slug', logger);
  const roundupIds = listedIds(index.roundups, 'key', logger);
  const jobs = [
    ...activityIds.map((id) => ({ kind: 'activity', id })),
    ...roundupIds.map((id) => ({ kind: 'roundup', id })),
  ];
  const results = await pool(jobs, concurrency, async (job) => ({
    ...job,
    data: await getFileLenient(`${job.kind}/${job.id}.json`),
  }));

  // The calendar export is not listed in the index; same lenient path (cache on 304 or failure).
  const events = validateEvents(await getFileLenient('events.json'));
  // Likewise the life docs: live, else cached, else null; validated after the fetch.
  const lifeRaw = await getFileLenient('life/index.json');
  const lifeIndex = lifeRaw === undefined ? null : validateLife(lifeRaw, logger);
  const heatRaw = await getFileLenient('life/heatmap.json');
  const lifeHeatmap = heatRaw === undefined ? null : validateHeatmap(heatRaw, logger);

  const activityFiles = new Map();
  const roundupFiles = new Map();
  for (const r of results) {
    if (r.data === undefined) continue;
    (r.kind === 'activity' ? activityFiles : roundupFiles).set(r.id, r.data);
  }
  // A previewed year FitGlue has not written yet gets a bare file: its dates. The year
  // review reads everything else from the sessions themselves.
  for (const key of String(process.env.FITNESS_PREVIEW_ROUNDUPS || '').split(',').map((k) => k.trim())) {
    const y = key.match(/^year-(\d{4})$/);
    if (!y || roundupFiles.has(key)) continue;
    roundupFiles.set(key, {
      schemaVersion: 1, key, exportedAt: new Date().toISOString(),
      roundup: { periodType: 'ROUNDUP_PERIOD_TYPE_YEAR', periodKey: key, periodStart: `${y[1]}-01-01T00:00:00Z`, periodEnd: `${Number(y[1]) + 1}-01-01T00:00:00Z`, generatedAt: new Date().toISOString(), prsAchieved: [], dayEntries: [] },
    });
    logger.info(`preview: ${key} built from its dates only`);
  }

  // Period sidecars: only for keys the index lists (an orphan sidecar is never requested),
  // through the same limiter. A missing one is normal; the roundup page is then unchanged.
  /** @type {Record<string, any>} */
  const lifePeriods = {};
  const periodResults = await pool(roundupIds, concurrency, async (id) => ({
    id,
    data: await getFileLenient(`life/period/${id}.json`, true),
  }));
  for (const r of periodResults) {
    if (r.data === undefined) continue;
    const doc = validatePeriod(r.data, r.id, logger);
    if (doc) lifePeriods[r.id] = doc;
  }

  await fs.mkdir(cacheDir, { recursive: true });
  await fs.writeFile(path.join(cacheDir, 'index.json'), indexText);
  await writeJson(path.join(cacheDir, META_FILE), meta);
  logger.debug(
    `live: ${stats.fetched} fetched, ${stats.reused} reused from cache, ${stats.failed} failed`,
  );
  return { index, activityFiles, roundupFiles, events, lifeIndex, lifeHeatmap, lifePeriods, ...stats };
}

// ---------------------------------------------------------------------------
// Assembly

/** @param {string|undefined} iso */
function ts(iso) {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Turn a raw set into the global shapes. Order follows the index (newest
 * first) and is then re-sorted by date so a badly ordered index still works.
 * @param {RawSet} raw
 */
export function assemble(raw) {
  const { index, activityFiles, roundupFiles, events = null, lifeIndex = null, lifeHeatmap = null, lifePeriods = {} } = raw;
  const activities = [];
  for (const entry of index.activities) {
    const file = entry && activityFiles.get(entry.slug);
    if (!file) {
      if (entry && typeof entry === 'object') stampTag(entry);
      continue;
    }
    // The site's one tag per activity (fitness-theme.mjs): decided here, read everywhere.
    activities.push(stampTag({ ...file, indexEntry: entry }));
  }
  activities.sort(
    (a, b) =>
      ts(b.entry?.startTime || b.indexEntry?.startTime || b.activity?.startTime) -
      ts(a.entry?.startTime || a.indexEntry?.startTime || a.activity?.startTime),
  );

  const roundups = [];
  for (const summary of index.roundups) {
    const file = summary && roundupFiles.get(summary.key);
    if (file) roundups.push(file);
  }
  roundups.sort(
    (a, b) =>
      ts(b.roundup?.periodEnd) - ts(a.roundup?.periodEnd) ||
      ts(b.roundup?.periodStart) - ts(a.roundup?.periodStart),
  );

  return { index, activities, roundups, events, lifeIndex, lifeHeatmap, lifePeriods };
}

/** @param {unknown} e */
function errMsg(e) {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Load fitness data from the first usable source.
 * @param {LoadOptions} [options]
 * @returns {Promise<FitnessData>}
 */
export async function loadFitnessData(options = {}) {
  const opts = resolveOptions(options.env || process.env, options, options.logger || silentLogger);
  const { logger } = opts;
  const order = opts.source ? [opts.source] : [...SOURCES];
  /** @type {string[]} */
  const notes = [];

  for (const source of order) {
    try {
      /** @type {RawSet} */
      let raw;
      if (source === 'live') {
        try {
          raw = await readLive(opts);
        } catch (e) {
          logger.warn(`fitness live source failed (${errMsg(e)}); retrying once with a longer timeout`);
          await new Promise((r) => setTimeout(r, opts.retryDelayMs));
          raw = await readLive({ ...opts, timeoutMs: opts.timeoutMs * RETRY_TIMEOUT_FACTOR });
        }
      }
      else if (source === 'cache') raw = await readFromDir(opts.cacheDir, logger);
      else raw = await readFromDir(opts.fixturesDir, logger);
      const { index, activities, roundups, events, lifeIndex, lifeHeatmap, lifePeriods } = assemble(raw);
      return { index, activities, roundups, events, lifeIndex, lifeHeatmap, lifePeriods, source, unavailable: false, forced: opts.source, notes };
    } catch (e) {
      const where =
        source === 'live' ? opts.baseUrl : source === 'cache' ? opts.cacheDir : opts.fixturesDir;
      notes.push(`${source} (${where}): ${errMsg(e)}`);
      logger.warn(`fitness ${source} source unusable: ${errMsg(e)}`);
    }
  }

  return {
    index: emptyIndex(),
    activities: [],
    roundups: [],
    events: null,
    lifeIndex: null,
    lifeHeatmap: null,
    lifePeriods: {},
    source: 'none',
    unavailable: true,
    forced: opts.source,
    notes,
  };
}

/**
 * The Skier task. Config keys mirror LoadOptions (all optional); env vars
 * FITNESS_DATA_BASE / FITNESS_DATA_SOURCE override at build time.
 * @param {Omit<LoadOptions, 'logger'|'fetchImpl'>} [config]
 */
export function fetchFitnessTask(config = {}) {
  return {
    name: 'fetch-fitness',
    title: 'Fetch fitness showcase data (live → cache → fixtures)',
    config,
    run: async (/** @type {any} */ cfg, /** @type {any} */ ctx) => {
      /** @type {FitnessData} */
      let data;
      try {
        data = await loadFitnessData({ ...cfg, logger: ctx.logger });
      } catch (e) {
        // loadFitnessData already swallows per-source errors; this is belt and braces.
        ctx.logger.error(`fitness data load crashed: ${errMsg(e)}`);
        data = {
          index: emptyIndex(),
          activities: [],
          roundups: [],
          events: null,
          lifeIndex: null,
          lifeHeatmap: null,
          lifePeriods: {},
          source: 'none',
          unavailable: true,
          notes: [errMsg(e)],
        };
      }
      const summary = `${data.activities.length} activities, ${data.roundups.length} roundups, ` +
        (data.events ? `${data.events.events.length} calendar entries` : 'no calendar');
      if (data.unavailable && data.forced) {
        throw new Error(
          `FITNESS_DATA_SOURCE=${data.forced} is unavailable (${data.notes.join('; ')}); ` +
          'failing the build rather than publishing a site without fitness data',
        );
      }
      if (data.unavailable) {
        ctx.logger.warn(`Fitness data: UNAVAILABLE, building without it (${data.notes.join('; ')})`);
      } else {
        const skipped = data.notes.length ? ` after: ${data.notes.join('; ')}` : '';
        ctx.logger.info(`Fitness data: source=${data.source} (${summary})${skipped}`);
      }
      return {
        fitnessIndex: data.index,
        fitnessActivities: data.activities,
        fitnessRoundups: data.roundups,
        fitnessEvents: data.events,
        lifeIndex: data.lifeIndex,
        lifeHeatmap: data.lifeHeatmap,
        lifePeriods: data.lifePeriods,
        fitnessUnavailable: data.unavailable,
        fitnessSource: data.source,
      };
    },
  };
}
