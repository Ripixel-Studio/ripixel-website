// @ts-check
/**
 * Photo dimensions for the /life hero layout (F5.5).
 *
 * An activity's hero is laid out by the shape of its picture: a portrait photo sits
 * beside the title block, a landscape or square one runs full width above it. The
 * export carries photo URLs only, so the build reads each hero picture's size here:
 * the first 128 KB of the JPEG (a Range request; the header with the size is in the
 * first few KB even behind EXIF) through sharp's metadata, EXIF orientation applied.
 *
 * Sizes are cached in .cache/photo-dims.json by URL (photos never change under a
 * URL), so a rebuild fetches only new photos. Offline, or with FITNESS_PHOTO_DIMS=off,
 * it uses the cache alone; a picture with no known size gets the landscape layout and
 * the page's own fallback script (activity-hero.html) re-lays it out from the loaded
 * image.
 *
 * Global written: fitnessPhotoDims — { [url]: { w, h } }.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

export const DEFAULT_CACHE_FILE = '.cache/photo-dims.json';
const HEAD_BYTES = 128 * 1024;
const DEFAULT_CONCURRENCY = 8;
const DEFAULT_TIMEOUT_MS = 15_000;

/** @typedef {{ w: number, h: number }} Dims */

/**
 * The pictures a /life page leads with: each activity's AI banner and first photo.
 * @param {any[]} activities  fitnessActivities
 * @returns {string[]}
 */
export function heroImageUrls(activities) {
  const urls = new Set();
  for (const file of Array.isArray(activities) ? activities : []) {
    const banner = file?.activity?.enrichments?.aiBanner?.imageUrl;
    if (typeof banner === 'string' && /^https:\/\//.test(banner)) urls.add(banner);
    const first = Array.isArray(file?.activity?.photoUrls) ? file.activity.photoUrls[0] : '';
    if (typeof first === 'string' && /^https:\/\//.test(first)) urls.add(first);
  }
  return [...urls];
}

/**
 * Shape of a picture: 'portrait' (taller by 10% or more), 'landscape' (wider by 10%
 * or more), 'square' in between, '' when unknown.
 * @param {Dims|undefined|null} d
 * @returns {'portrait'|'landscape'|'square'|''}
 */
export function orientationOf(d) {
  if (!d || !(d.w > 0) || !(d.h > 0)) return '';
  const r = d.h / d.w;
  if (r >= 1.1) return 'portrait';
  if (r <= 1 / 1.1) return 'landscape';
  return 'square';
}

/**
 * Width/height of an image from its first bytes, EXIF orientation applied.
 * @param {Buffer} buf
 * @returns {Promise<Dims|null>}
 */
export async function dimsFromBytes(buf) {
  try {
    const m = await sharp(buf).metadata();
    if (!m.width || !m.height) return null;
    const rotated = (m.orientation ?? 1) >= 5; // 5–8: stored rotated by 90°
    return rotated ? { w: m.height, h: m.width } : { w: m.width, h: m.height };
  } catch {
    return null;
  }
}

/**
 * @param {string} url
 * @param {typeof fetch} fetchImpl
 * @param {number} timeoutMs
 * @returns {Promise<Dims|null>}
 */
async function probe(url, fetchImpl, timeoutMs) {
  for (const range of [`bytes=0-${HEAD_BYTES - 1}`, '']) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { headers: range ? { Range: range } : {}, signal: ctrl.signal });
      if (!res.ok) return null;
      const dims = await dimsFromBytes(Buffer.from(await res.arrayBuffer()));
      if (dims) return dims;
      if (res.status !== 206) return null; // already the whole file
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

/**
 * Sizes for urls: cached ones from cacheFile, the rest probed (unless offline) and
 * added to the cache.
 * @param {string[]} urls
 * @param {{ cacheFile?: string, fetchImpl?: typeof fetch, offline?: boolean, concurrency?: number, timeoutMs?: number }} [opts]
 * @returns {Promise<{ dims: Record<string, Dims>, probed: number, cached: number, missing: number }>}
 */
export async function loadPhotoDims(urls, opts = {}) {
  const cacheFile = opts.cacheFile || DEFAULT_CACHE_FILE;
  /** @type {Record<string, Dims>} */
  let cache = {};
  try {
    cache = JSON.parse(await fs.readFile(cacheFile, 'utf8')) || {};
  } catch {
    cache = {};
  }
  /** @type {Record<string, Dims>} */
  const dims = {};
  const todo = [];
  for (const u of urls) {
    if (cache[u]?.w > 0 && cache[u]?.h > 0) dims[u] = cache[u];
    else todo.push(u);
  }
  const cached = Object.keys(dims).length;
  let probed = 0;
  if (!opts.offline && todo.length) {
    const fetchImpl = opts.fetchImpl || fetch;
    const queue = [...todo];
    const workers = Array.from({ length: Math.min(opts.concurrency || DEFAULT_CONCURRENCY, queue.length) }, async () => {
      for (let u = queue.shift(); u; u = queue.shift()) {
        const d = await probe(u, fetchImpl, opts.timeoutMs || DEFAULT_TIMEOUT_MS);
        if (d) {
          dims[u] = d;
          cache[u] = d;
          probed++;
        }
      }
    });
    await Promise.all(workers);
    if (probed) {
      await fs.mkdir(path.dirname(cacheFile), { recursive: true });
      await fs.writeFile(cacheFile, JSON.stringify(cache));
    }
  }
  return { dims, probed, cached, missing: urls.length - Object.keys(dims).length };
}

/**
 * The Skier task: after fetch-fitness, before the activity and event pages.
 * @param {{ cacheFile?: string }} [config]
 */
export function fitnessPhotoDimsTask(config = {}) {
  return {
    name: 'fitness-photo-dims',
    title: 'Read hero photo sizes for the /life hero layout',
    config,
    run: async (/** @type {any} */ cfg, /** @type {any} */ ctx) => {
      const urls = heroImageUrls(ctx.globals.fitnessActivities);
      const env = process.env;
      const offline = env.FITNESS_PHOTO_DIMS === 'off' || ctx.globals.fitnessSource === 'fixtures' || ctx.globals.fitnessSource === 'none';
      const r = await loadPhotoDims(urls, { cacheFile: cfg.cacheFile, offline });
      ctx.logger.info(`Photo sizes: ${r.cached} cached, ${r.probed} read, ${r.missing} unknown (${urls.length} hero pictures)`);
      return { fitnessPhotoDims: r.dims };
    },
  };
}
