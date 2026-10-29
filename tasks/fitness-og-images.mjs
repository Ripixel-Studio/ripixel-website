// @ts-check
/**
 * Share cards and OG images (S2.5 → F5.4).
 *
 * Every /life activity, race weekend and roundup gets pre-rendered share cards: Story
 * 1080×1920, Square 1080×1080 and Landscape 1200×630, the landscape one doubling as the
 * page's og:image. The content is tasks/fitness-share-models.mjs, the drawing
 * scripts/share-cards.mjs; this task decides the scope and the backgrounds, renders
 * with sharp, caches, and writes the manifest.
 *
 * Scope: all three shapes for activities from the last FULL_DAYS days, every race,
 * every PB activity, every race weekend, and roundups whose period ended in the last
 * FULL_DAYS days (plus every year). Everything older gets the Landscape card only
 * (its OG image). Backgrounds (variants): his photo when there is one (with a scrim),
 * else the activity family's ink; a race weekend leads with a collage of its races'
 * photos. Full-scope cards also get the ink version, and races / race weekends every
 * photo (up to three), so the page's picker has a choice. Nothing renders in the
 * browser.
 *
 * Files: public/personal/life/share/<kind>/<id>/<shape>-<variant>.(jpg|png) — photo
 * cards are JPEG, ink cards palette PNG. Each is cached in .cache/og/ under the same
 * path, keyed by a hash of its SVG, its background URLs and RENDER_VERSION, so a
 * rebuild only rasterises what changed. Photos are fetched once into .cache/og/photos/
 * (a photo never changes under its URL). A photo that cannot be fetched drops that
 * variant; a card that fails to render is logged and left out — the build never fails
 * here.
 *
 * Globals returned (the view tasks run after this one):
 *   fitnessOgImages    { activity, event, roundup: { [id]: absolute landscape URL } }
 *   fitnessShareCards  { activity, event, roundup: { [id]: ShareEntry } } — the Share
 *                      button's data (personal/partials/share-button.html)
 * and public/personal/life/share/index.json: the full-scope cards, for Jarvis's
 * "your card is ready" push (jarvis gateway/domains/sharecards.py).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

import { getSharp } from '../scripts/generate-og-images.mjs';
import { buildShareSVG, SHAPES, SHAPE_ORDER, PAPER, INK } from '../scripts/share-cards.mjs';
import { buildHyroxHistory } from './fitness-hyrox.mjs';
import { parsePeriodKey, resolveNeighbours } from './fitness-roundup-views.mjs';
import { activityShareModel, eventShareModel, roundupShareModel, parkrunHistory } from './fitness-share-models.mjs';

export const DEFAULT_OUT_DIR = 'public/personal/life/share';
export const DEFAULT_CACHE_DIR = '.cache/og';
export const DEFAULT_URL_BASE = '/life/share';
export const DEFAULT_CONCURRENCY = 6;
export const FULL_DAYS = 90;
/** Bump when the drawing changes in a way the SVG hash would not see (compositing, encoders). */
export const RENDER_VERSION = 'f54.1';
const PHOTO_TIMEOUT_MS = 20_000;
const GUTTER = 8;

/** Same shape the view tasks accept; ids become directory names. */
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/;

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };
/** @param {unknown} e */
const errMsg = (e) => (e instanceof Error ? e.message : String(e));
/** @param {string} s */
const sha = (s) => crypto.createHash('sha1').update(s).digest('hex');

/**
 * @typedef {'story'|'square'|'landscape'} Shape
 * @typedef {{ id: string, label: string, mode: 'photo'|'ink', bg: string[] }} Variant
 * @typedef {{ model: any, full: boolean, variants: Variant[], shapes: Shape[] }} Job
 * @typedef {{ id: string, label: string, url: string, file: string }} RenderedVariant
 * @typedef {{ kind: string, id: string, title: string, label: string, template: string, date: string, page: string,
 *   isRace: boolean, isPB: boolean, full: boolean, hash: string,
 *   shapes: { shape: Shape, label: string, w: number, h: number, variants: RenderedVariant[] }[] }} ShareEntry
 */

// ---------------------------------------------------------------------------
// Scope and backgrounds

/**
 * Whether a card gets all three shapes (else Landscape only).
 * @param {any} model @param {number} now ms
 */
export function isFullScope(model, now) {
  if (model.kind === 'event') return true;
  if (model.template === 'race' || model.isRace || model.isPB) return true;
  if (model.kind === 'roundup' && /^year-/.test(model.id)) return true;
  const t = Date.parse(model.date || '');
  return Number.isFinite(t) && now - t <= FULL_DAYS * 86_400_000;
}

/**
 * The backgrounds a card is rendered on, default first. Photo variants carry their
 * source URLs; the ink one carries none.
 * @param {any} model @param {boolean} full
 * @returns {Variant[]}
 */
export function variantsFor(model, full) {
  const photos = Array.isArray(model.photos) ? model.photos : [];
  /** @type {Variant[]} */
  const out = [];
  if (model.kind === 'event' && Array.isArray(model.collage) && model.collage.length >= 2) {
    out.push({ id: 'collage', label: 'Collage', mode: 'photo', bg: model.collage.slice(0, 4) });
  }
  const many = model.kind === 'event' || model.template === 'race';
  const photoCount = !full ? (out.length ? 0 : 1) : many ? 3 : 1;
  photos.slice(0, photoCount).forEach((u, i) => out.push({ id: `photo-${i + 1}`, label: `Photo ${i + 1}`, mode: 'photo', bg: [u] }));
  if (full || !out.length) out.push({ id: 'ink', label: model.kind === 'roundup' ? 'Paper' : 'Colour', mode: 'ink', bg: [] });
  return full ? out : out.slice(0, 1);
}

/**
 * Every card job for the data: activities, race weekends, roundups.
 * @param {{ activities?: any[], roundups?: any[], index?: any, now?: number, photoDims?: any, logger?: any }} opts
 * @returns {Job[]}
 */
export function cardJobs(opts) {
  const logger = opts.logger || silentLogger;
  const now = opts.now ?? Date.now();
  const activities = opts.activities || [];
  const index = opts.index || {};
  const hyrox = buildHyroxHistory(activities);
  const parkruns = parkrunHistory(activities);
  /** @type {any[]} */
  const models = [];
  for (const file of activities) {
    try {
      const m = activityShareModel(file, index, { hyrox, parkruns, photoDims: opts.photoDims });
      if (m && SAFE_ID.test(m.id)) models.push(m);
    } catch (e) {
      logger.warn(`share card skipped for activity ${JSON.stringify(file?.slug)}: ${errMsg(e)}`);
    }
  }
  for (const event of hyrox.events) {
    try {
      if (SAFE_ID.test(event.slug)) models.push(eventShareModel(event, hyrox, index, { photoDims: opts.photoDims }));
    } catch (e) {
      logger.warn(`share card skipped for event ${JSON.stringify(event?.slug)}: ${errMsg(e)}`);
    }
  }
  const roundups = (opts.roundups || []).filter((f) => f && parsePeriodKey(f.key));
  const ctx = {
    byKey: new Map(roundups.map((f) => [f.key, f])),
    neighbours: resolveNeighbours(roundups),
    activitySlugs: new Set((index.activities || []).map((/** @type {any} */ a) => a?.slug).filter(Boolean)),
    showPhotoGallery: !!index.profile?.showPhotoGallery,
  };
  for (const file of roundups) {
    try {
      models.push(roundupShareModel(file, ctx));
    } catch (e) {
      logger.warn(`share card skipped for roundup ${JSON.stringify(file?.key)}: ${errMsg(e)}`);
    }
  }
  return models.map((model) => {
    const full = isFullScope(model, now);
    return { model, full, variants: variantsFor(model, full), shapes: full ? [...SHAPE_ORDER] : ['landscape'] };
  });
}

// ---------------------------------------------------------------------------
// Photos and compositing

/** @param {string} p */
async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

/** @type {Map<string, Promise<Buffer>>} */
const photoLoads = new Map();

/**
 * A photo's bytes, from .cache/og/photos or the network (then cached).
 * @param {string} url @param {string} dir @param {{ fetchImpl?: typeof fetch, offline?: boolean }} [o]
 */
export function loadPhoto(url, dir, o = {}) {
  const key = `${dir}|${url}`;
  let p = photoLoads.get(key);
  if (!p) {
    p = (async () => {
      const file = path.join(dir, `${sha(url)}.img`);
      try { return await fs.readFile(file); } catch { /* not cached */ }
      if (o.offline) throw new Error('photo not cached (offline)');
      if (!/^https:\/\//.test(url)) throw new Error('not an https photo');
      const res = await (o.fetchImpl || fetch)(url, { signal: AbortSignal.timeout(PHOTO_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`photo HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(file, buf);
      return buf;
    })();
    photoLoads.set(key, p);
    p.catch(() => photoLoads.delete(key));
  }
  return p;
}

/**
 * The photo ground for one card: each photo cover-cropped into a column (faces kept
 * high: the crop sits 30% down), paper gutters between columns.
 * @param {Buffer[]} photos @param {number} w @param {number} h
 * @returns {Promise<Buffer>} a lossless PNG, w×h
 */
export async function photoGround(photos, w, h) {
  const sharp = await getSharp();
  const n = Math.max(1, photos.length);
  const tileW = Math.floor((w - GUTTER * (n - 1)) / n);
  const tiles = await Promise.all(photos.map(async (buf, i) => {
    const img = sharp(buf).rotate();
    const meta = await img.metadata();
    const swap = (meta.orientation || 1) >= 5;
    const iw = (swap ? meta.height : meta.width) || tileW;
    const ih = (swap ? meta.width : meta.height) || h;
    const scale = Math.max(tileW / iw, h / ih);
    const rw = Math.max(tileW, Math.ceil(iw * scale));
    const rh = Math.max(h, Math.ceil(ih * scale));
    const input = await sharp(buf).rotate().resize(rw, rh, { fit: 'fill' })
      .extract({ left: Math.floor((rw - tileW) / 2), top: Math.floor((rh - h) * 0.3), width: tileW, height: h })
      .modulate({ saturation: 0.92 })
      .toBuffer();
    return { input, left: i === n - 1 ? w - tileW : i * (tileW + GUTTER), top: 0 };
  }));
  return sharp({ create: { width: w, height: h, channels: 3, background: n > 1 ? PAPER : INK } })
    .composite(tiles).png({ compressionLevel: 0 }).toBuffer();
}

/**
 * Rasterise one card. Photo cards: the ground, then the SVG over it, as JPEG. Ink
 * cards: the SVG alone, as a palette PNG.
 * @param {string} svg @param {Shape} shape @param {Buffer[]|null} photos @param {string} outPath
 */
export async function rasteriseCard(svg, shape, photos, outPath) {
  const sharp = await getSharp();
  const { w, h } = SHAPES[shape];
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  if (photos && photos.length) {
    const ground = await photoGround(photos, w, h);
    await sharp(ground)
      .composite([{ input: Buffer.from(svg) }])
      .jpeg({ quality: 80, mozjpeg: true, chromaSubsampling: '4:2:0' })
      .toFile(outPath);
  } else {
    await sharp(Buffer.from(svg)).resize(w, h).png({ compressionLevel: 9, palette: true, quality: 92 }).toFile(outPath);
  }
}

// ---------------------------------------------------------------------------
// Rendering with a cache

/** @param {Shape} shape */
const shapeLabel = (shape) => SHAPES[shape].label;

/**
 * Render every card into `outDir`, reusing `cacheDir` where nothing changed.
 * @param {{ activities?: any[], roundups?: any[], index?: any, outDir?: string, cacheDir?: string, urlBase?: string,
 *   siteUrl?: string, fontCacheDir?: string, concurrency?: number, logger?: any, now?: number, photoDims?: any,
 *   fetchImpl?: typeof fetch, offline?: boolean, only?: (job: Job) => boolean }} opts
 */
export async function renderFitnessCards(opts = {}) {
  const started = Date.now();
  const outDir = opts.outDir || DEFAULT_OUT_DIR;
  const cacheDir = opts.cacheDir || DEFAULT_CACHE_DIR;
  const photoDir = path.join(cacheDir, 'photos');
  const urlBase = (opts.urlBase || DEFAULT_URL_BASE).replace(/\/+$/, '');
  const siteUrl = (opts.siteUrl || '').replace(/\/+$/, '');
  const concurrency = Math.max(1, opts.concurrency || DEFAULT_CONCURRENCY);
  const logger = opts.logger || silentLogger;
  if (opts.fontCacheDir) await getSharp(opts.fontCacheDir);

  let jobs = cardJobs({ ...opts, logger });
  if (opts.only) jobs = jobs.filter(opts.only);

  /** @type {{ job: Job, shape: Shape, variant: Variant }[]} */
  const work = [];
  for (const job of jobs) for (const shape of job.shapes) for (const variant of job.variants) work.push({ job, shape, variant });

  /** @type {Map<Job, Map<Shape, RenderedVariant[]>>} */
  const done = new Map();
  /** @type {Map<string, string>} */
  const hashes = new Map();
  let rendered = 0, cached = 0, failed = 0, dropped = 0;

  async function one(/** @type {typeof work[number]} */ w) {
    const { job, shape, variant } = w;
    const m = job.model;
    const ext = variant.mode === 'photo' ? 'jpg' : 'png';
    const rel = path.posix.join(m.kind, m.id, `${shape}-${variant.id}.${ext}`);
    const outPath = path.join(outDir, rel);
    const cachePath = path.join(cacheDir, rel);
    try {
      const svg = buildShareSVG(m, shape, variant.mode);
      const hash = sha([RENDER_VERSION, shape, variant.id, ...variant.bg, svg].join('\n'));
      let hit = false;
      if (await exists(cachePath)) {
        try { hit = (await fs.readFile(`${cachePath}.sha1`, 'utf8')).trim() === hash; } catch { hit = false; }
      }
      await fs.mkdir(path.dirname(outPath), { recursive: true });
      if (hit) {
        await fs.copyFile(cachePath, outPath);
        cached++;
      } else {
        let photos = null;
        if (variant.mode === 'photo') {
          try {
            photos = await Promise.all(variant.bg.map((u) => loadPhoto(u, photoDir, opts)));
          } catch (e) {
            dropped++;
            logger.debug(`share card ${rel}: background unavailable (${errMsg(e)}), variant dropped`);
            return;
          }
        }
        await rasteriseCard(svg, shape, photos, outPath);
        await fs.mkdir(path.dirname(cachePath), { recursive: true });
        await fs.copyFile(outPath, cachePath);
        await fs.writeFile(`${cachePath}.sha1`, hash);
        rendered++;
      }
      if (variant === job.variants[0] && shape === job.shapes[0]) hashes.set(`${m.kind}:${m.id}`, hash);
      let byShape = done.get(job);
      if (!byShape) { byShape = new Map(); done.set(job, byShape); }
      const list = byShape.get(shape) || [];
      list.push({ id: variant.id, label: variant.label, url: `${urlBase}/${rel}`, file: `${m.id}-${shape}${variant.id === job.variants[0].id ? '' : `-${variant.id}`}.${ext}` });
      byShape.set(shape, list);
    } catch (e) {
      failed++;
      logger.warn(`share card failed for ${rel}: ${errMsg(e)}`);
    }
  }

  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, work.length) }, async () => {
    while (next < work.length) await one(work[next++]);
  }));

  // A job whose every photo variant failed still needs an OG image: render its ink card.
  const orphans = jobs.filter((j) => !done.get(j)?.get('landscape')?.length);
  for (const job of orphans) {
    const ink = { id: 'ink', label: job.model.kind === 'roundup' ? 'Paper' : 'Colour', mode: /** @type {const} */ ('ink'), bg: [] };
    if (!job.variants.some((v) => v.id === 'ink')) job.variants.push(ink);
    for (const shape of job.shapes) await one({ job, shape, variant: job.variants.find((v) => v.id === 'ink') || ink });
  }

  /** @type {{ activity: Record<string, string>, event: Record<string, string>, roundup: Record<string, string> }} */
  const urls = { activity: {}, event: {}, roundup: {} };
  /** @type {{ activity: Record<string, ShareEntry>, event: Record<string, ShareEntry>, roundup: Record<string, ShareEntry> }} */
  const cards = { activity: {}, event: {}, roundup: {} };
  const manifest = [];
  for (const job of jobs) {
    const byShape = done.get(job);
    if (!byShape) continue;
    const m = job.model;
    const order = job.variants.map((v) => v.id);
    const shapes = job.shapes.filter((s) => byShape.get(s)?.length).map((shape) => ({
      shape, label: shapeLabel(shape), w: SHAPES[shape].w, h: SHAPES[shape].h,
      variants: /** @type {RenderedVariant[]} */ (byShape.get(shape)).sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id)),
    }));
    if (!shapes.length) continue;
    const kind = /** @type {'activity'|'event'|'roundup'} */ (m.kind);
    const landscape = shapes.find((s) => s.shape === 'landscape');
    if (landscape) urls[kind][m.id] = `${siteUrl}${landscape.variants[0].url}`;
    const entry = {
      kind, id: m.id, title: m.pageTitle, label: m.label, template: m.template, date: m.date, page: m.url,
      isRace: !!m.isRace, isPB: !!m.isPB, full: job.full, hash: hashes.get(`${kind}:${m.id}`) || '', shapes,
    };
    cards[kind][m.id] = entry;
    if (job.full) {
      const lead = shapes.find((s) => s.shape === 'story') || shapes[0];
      manifest.push({
        id: `${kind}:${m.id}`, kind, slug: m.id, template: m.template, title: m.pageTitle, label: m.label, date: m.date,
        page: `${siteUrl}${m.url}#share`, image: `${siteUrl}${lead.variants[0].url}`, race: !!m.isRace, pb: !!m.isPB, hash: entry.hash,
      });
    }
  }
  manifest.sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, 'index.json'), JSON.stringify({ schemaVersion: 1, generatedAt: new Date(opts.now ?? Date.now()).toISOString(), siteUrl, cards: manifest }, null, 1));

  const images = rendered + cached;
  return {
    urls, cards, manifest,
    rendered, cached, failed, dropped,
    total: jobs.length, full: jobs.filter((j) => j.full).length, images,
    ms: Date.now() - started,
  };
}

// ---------------------------------------------------------------------------
// The Skier task

/**
 * @param {{ outDir?: string, cacheDir?: string, urlBase?: string, concurrency?: number }} [config]
 */
export function fitnessOgImagesTask(config = {}) {
  return {
    name: 'fitness-og-images',
    title: 'Render the /life share cards (Story, Square, Landscape = OG)',
    config,
    run: async (/** @type {any} */ cfg, /** @type {any} */ ctx) => {
      const g = ctx.globals;
      const emptyUrls = { activity: {}, event: {}, roundup: {} };
      const empty = { fitnessOgImages: emptyUrls, fitnessShareCards: { activity: {}, event: {}, roundup: {} } };
      const activities = Array.isArray(g.fitnessActivities) ? g.fitnessActivities : [];
      const roundups = Array.isArray(g.fitnessRoundups) ? g.fitnessRoundups : [];
      if (!activities.length && !roundups.length) {
        ctx.logger.warn('No fitness activities or roundups — no share cards to render');
        return empty;
      }
      try {
        const r = await renderFitnessCards({
          ...cfg,
          activities,
          roundups,
          index: g.fitnessIndex,
          siteUrl: g.siteUrl,
          photoDims: g.fitnessPhotoDims,
          offline: process.env.FITNESS_DATA_SOURCE === 'fixtures' || process.env.FITNESS_SHARE_PHOTOS === 'off',
          logger: ctx.logger,
        });
        ctx.logger.info(`Share cards: ${r.images} images for ${r.total} pages (${r.full} in all three shapes) — ${r.rendered} rendered, ${r.cached} from cache, ${r.failed} failed, ${r.dropped} without their photo; ${(r.ms / 1000).toFixed(1)} s`);
        return { fitnessOgImages: r.urls, fitnessShareCards: r.cards };
      } catch (e) {
        ctx.logger.warn(`Share cards unavailable, pages fall back to banner/photo/card_life.png: ${errMsg(e)}`);
        return empty;
      }
    },
  };
}
