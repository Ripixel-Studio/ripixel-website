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
 *
 * Source order is live → cache → fixtures → empty, unless FITNESS_DATA_SOURCE
 * forces one. The build never fails because of fitness data: the worst case is
 * `fitnessUnavailable: true` with empty lists.
 *
 * Globals written (names are the spec's, do not rename):
 *   fitnessIndex        the index.json object (an empty skeleton when unavailable)
 *   fitnessActivities   full activity files, newest first, each + `indexEntry`
 *   fitnessRoundups     full roundup files, newest first
 *   fitnessEvents       the events.json object ({generatedAt, events[]}) or null when
 *                       the source has none — the life page then falls back to the
 *                       hand-written list
 *   fitnessUnavailable  boolean
 *   fitnessSource       'live' | 'cache' | 'fixtures' | 'none'
 */
import fs from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_BASE_URL =
  'https://storage.googleapis.com/fitglue-server-prod-showcase-assets/site/james';
export const DEFAULT_CACHE_DIR = '.cache/fitness';
export const DEFAULT_FIXTURES_DIR = 'fixtures/fitness';
export const DEFAULT_CONCURRENCY = 8;
export const DEFAULT_TIMEOUT_MS = 20_000;

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
 * @property {Source|'none'} source
 * @property {boolean} unavailable
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

/** @typedef {{ index: any, activityFiles: Map<string, any>, roundupFiles: Map<string, any>, events: any|null }} RawSet */

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
  return { index, activityFiles, roundupFiles, events };
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
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${rel}`);
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
   * One retry, then the cached copy if there is one, else undefined.
   * @param {string} rel
   */
  const getFileLenient = async (rel) => {
    let lastErr;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await getFile(rel);
      } catch (e) {
        lastErr = e;
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

  const activityFiles = new Map();
  const roundupFiles = new Map();
  for (const r of results) {
    if (r.data === undefined) continue;
    (r.kind === 'activity' ? activityFiles : roundupFiles).set(r.id, r.data);
  }

  await fs.mkdir(cacheDir, { recursive: true });
  await fs.writeFile(path.join(cacheDir, 'index.json'), indexText);
  await writeJson(path.join(cacheDir, META_FILE), meta);
  logger.debug(
    `live: ${stats.fetched} fetched, ${stats.reused} reused from cache, ${stats.failed} failed`,
  );
  return { index, activityFiles, roundupFiles, events, ...stats };
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
  const { index, activityFiles, roundupFiles, events = null } = raw;
  const activities = [];
  for (const entry of index.activities) {
    const file = entry && activityFiles.get(entry.slug);
    if (!file) continue;
    activities.push({ ...file, indexEntry: entry });
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

  return { index, activities, roundups, events };
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
      if (source === 'live') raw = await readLive(opts);
      else if (source === 'cache') raw = await readFromDir(opts.cacheDir, logger);
      else raw = await readFromDir(opts.fixturesDir, logger);
      const { index, activities, roundups, events } = assemble(raw);
      return { index, activities, roundups, events, source, unavailable: false, notes };
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
    source: 'none',
    unavailable: true,
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
          source: 'none',
          unavailable: true,
          notes: [errMsg(e)],
        };
      }
      const summary = `${data.activities.length} activities, ${data.roundups.length} roundups, ` +
        (data.events ? `${data.events.events.length} calendar entries` : 'no calendar');
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
        fitnessUnavailable: data.unavailable,
        fitnessSource: data.source,
      };
    },
  };
}
