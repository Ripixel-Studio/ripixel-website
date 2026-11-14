// @ts-check
/**
 * The year in review, shareable: a deck of Instagram story cards (1080×1920) and one
 * video made from them, for /life/roundup/year-<YYYY>.
 *
 * Everything comes from the year review model (tasks/fitness-year-review.mjs
 * `buildYearReview`), never from FitGlue's year file, which stays empty until the year
 * ends. The deck is a run of zine pages: the cover, the numbers, the shape of the year,
 * every single day, race day, the PBs, the awards, the next issue. Every card carries the
 * page's link in a yellow band clear of Instagram's top and bottom UI bands, and is
 * numbered "3 / 8".
 *
 *   yearDeckModel   review → the deck: what goes on each card (pure; drawn by
 *                   scripts/year-story-cards.mjs)
 *   withYearReview  the year roundup's ordinary share card (and so its og:image) with the
 *                   review's numbers in place of the empty year file's zeros
 *   yearReviewsFor  the reviews for the build's year roundups, built the way the roundup
 *                   view task builds them
 *   renderYearDeck  the PNGs, cached like the other share cards (keyed by a hash of each
 *                   card's SVG and its photo URLs), then the video
 *   encodeStoryVideo  an H.264 MP4 from the deck with ffmpeg: a slow zoom per card, a
 *                   transition between cards, the link band held still over the whole
 *                   thing. No ffmpeg (FFMPEG, PATH, ~/.local/bin): logged, no video.
 *
 * Files: public/personal/life/share/roundup/year-<YYYY>/story-01.png … story-NN.png and
 * story.mp4, cached under .cache/og/ at the same paths. Nothing here fails the build.
 */
import fs from 'node:fs/promises';
import fss from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

import { getSharp } from '../scripts/generate-og-images.mjs';
import { buildYearStorySVG, footerBandSVG, STORY, BAND } from '../scripts/year-story-cards.mjs';
import { storyContext } from './fitness-roundup-story.mjs';
import { buildYearReview } from './fitness-year-review.mjs';
import { TYPE_INKS } from './fitness-theme.mjs';
import { loadPhoto } from './fitness-og-images.mjs';

/** Bump when the drawing or the encode changes in a way the SVG hash would not see. */
export const DECK_VERSION = 'yr1';
export const VIDEO_VERSION = 'yrv3';

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };
/** @param {unknown} e */
const errMsg = (e) => (e instanceof Error ? e.message : String(e));
/** @param {string} s */
const sha = (s) => crypto.createHash('sha1').update(s).digest('hex');

/** `fit-type--run` → the run ink's hex; unknown → the "other" ink. @param {unknown} typeClass */
export function inkOf(typeClass) {
  const key = String(typeClass || '').replace(/^fit-type--/, '');
  return (TYPE_INKS[/** @type {keyof typeof TYPE_INKS} */ (key)] || TYPE_INKS.other).type;
}

// ---------------------------------------------------------------------------
// The deck

/** The order the numbers card prefers, eight of them. */
const NUMBER_ORDER = ['sessions', 'hours', 'km', 'tonnes', 'days', 'streak', 'pbs', 'races', 'kcal', 'climb', 'countries'];
/** Awards worth a story, in order; the rest fill in after. */
const AWARD_ORDER = ['MARATHON EFFORT', 'ALARM CLOCK', 'SECOND HOME', 'HEAVY LIFTING', 'REGULAR', 'FURTHEST', 'FAVOURITE DAY', 'NIGHT SHIFT', 'RED LINE', 'DOUBLE DAY'];
const BIG_RACE = /MARATHON|HYROX|ULTRA|WEEKEND|BIG DAY/i;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Every day of the year as month blocks: `review.days.cols` is week columns padded to a
 * Monday, so the n-th real cell is the n-th day of the year.
 * @param {any} days @param {number} year
 * @returns {{ name: string, lead: number, days: { ink: string, race: boolean, future: boolean, rest: boolean }[] }[]}
 */
export function monthBlocks(days, year) {
  const cells = (days?.cols || []).flatMap((/** @type {any} */ c) => c?.cells || []).filter((/** @type {any} */ c) => c && !c.blank);
  /** @type {{ name: string, lead: number, days: any[] }[]} */
  const months = MON.map((name, m) => ({ name, lead: (new Date(Date.UTC(year, m, 1)).getUTCDay() + 6) % 7, days: [] }));
  cells.forEach((/** @type {any} */ c, i) => {
    const d = new Date(Date.UTC(year, 0, 1 + i));
    if (d.getUTCFullYear() !== year) return;
    months[d.getUTCMonth()].days.push({ ink: c.typeClass ? inkOf(c.typeClass) : '', race: !!c.race, future: !!c.future, rest: !c.typeClass && !c.future });
  });
  return months;
}

/** The tags a year used, most first, as legend chips. @param {any} days */
function legendOf(days) {
  if (Array.isArray(days?.legend) && days.legend.length) {
    return days.legend.filter((/** @type {any} */ l) => l && l.typeClass).map((/** @type {any} */ l) => ({ label: String(l.tagLabel || l.typeKey || ''), ink: inkOf(l.typeClass), n: Number(l.n) || 0 }));
  }
  /** @type {Map<string, number>} */
  const count = new Map();
  for (const c of (days?.cols || []).flatMap((/** @type {any} */ c) => c?.cells || [])) if (c?.typeClass) count.set(c.typeClass, (count.get(c.typeClass) || 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([tc, n]) => {
    const key = tc.replace(/^fit-type--/, '');
    return { label: key.charAt(0).toUpperCase() + key.slice(1), ink: inkOf(tc), n };
  });
}

/** Up to `n` race tickets: PBs and the big ones first, then shown in date order. @param {any[]} tickets @param {number} n */
export function pickTickets(tickets, n) {
  const list = (tickets || []).map((t, i) => ({ t, i, score: (t.pb ? 2 : 0) + (BIG_RACE.test(`${t.stamp} ${t.title}`) ? 1.5 : 0) }));
  return list.sort((a, b) => b.score - a.score || b.i - a.i).slice(0, n).sort((a, b) => a.i - b.i).map((x) => x.t);
}

/** Up to three PB progressions: the shortest run, the longest run, the top lift. @param {any[]} featured */
export function pickProgressions(featured) {
  const list = (featured || []).filter((f) => f && f.d && f.w && f.h);
  const isLift = (/** @type {any} */ f) => /kg|lb/.test(`${f.from} ${f.to}`);
  const runs = list.filter((f) => !isLift(f));
  const lifts = list.filter(isLift);
  /** @type {any[]} */
  const out = [];
  if (runs[0]) out.push(runs[0]);
  const long = runs.find((f) => /^MARATHON$/i.test(f.name)) || runs.find((f) => /HALF/i.test(f.name)) || runs[1];
  if (long && !out.includes(long)) out.push(long);
  if (lifts[0]) out.push(lifts[0]);
  for (const f of list) if (out.length < 3 && !out.includes(f)) out.push(f);
  return out.slice(0, 3);
}

/**
 * What goes on each card. Cards with nothing to say (no races, no PBs, no awards) are left
 * out and the rest renumbered.
 * @param {any} review  buildYearReview's output
 * @param {{ url?: string, siteUrl?: string }} [opts]  url: the page path (/life/roundup/year-2026)
 */
export function yearDeckModel(review, opts = {}) {
  const year = Number(review?.year) || new Date().getUTCFullYear();
  const pagePath = opts.url || `/life/roundup/year-${year}`;
  const site = String(opts.siteUrl || 'https://james.ripixel.co.uk').replace(/\/+$/, '');
  const href = `${site}${pagePath}`;
  const link = href.replace(/^https?:\/\//, '');
  const numbers = Array.isArray(review?.numbers) ? review.numbers : [];
  const byKey = new Map(numbers.map((/** @type {any} */ n) => [n.key, n]));
  const num = (/** @type {string} */ k) => byKey.get(k);
  const picked = [...NUMBER_ORDER.map((k) => num(k)).filter(Boolean), ...numbers.filter((/** @type {any} */ n) => !NUMBER_ORDER.includes(n.key))].slice(0, 8);

  /** @type {any[]} */
  const cards = [];
  const cover = review?.cover || {};
  cards.push({
    id: 'cover', label: 'Cover',
    photos: (cover.photos || []).filter((/** @type {any} */ p) => p && /^https:\/\//.test(p.url)).slice(0, 5).map((/** @type {any} */ p) => ({ url: p.url, title: String(p.title || ''), ink: inkOf(p.typeClass) })),
    sticker: cover.sticker?.value ? { value: String(cover.sticker.value), label: String(cover.sticker.label || '') } : null,
    lines: (cover.lines || []).slice(0, 3).map((/** @type {any} */ l) => ({ stamp: String(l.stamp || ''), title: String(l.title || ''), ink: inkOf(l.typeClass) })),
    strap: ['hours', 'km', 'races'].map((k) => num(k)).filter(Boolean).map((/** @type {any} */ n) => `${n.display}${n.unit && n.unit.length <= 2 ? n.unit : ''} ${n.unit && n.unit.length > 2 ? `${n.unit} ` : ''}${n.label}`.replace(/\s+/g, ' ').trim()),
  });
  if (picked.length) {
    cards.push({ id: 'numbers', label: 'The numbers', numbers: picked.map((/** @type {any} */ n) => ({ display: String(n.display), unit: String(n.unit || ''), label: String(n.label || ''), quip: String(n.quip || '') })) });
  }
  const arc = review?.arc;
  if (arc?.line && arc.w && arc.h) {
    const highs = [...(arc.highs || [])].sort((a, b) => a.y - b.y).slice(0, 3).sort((a, b) => a.x - b.x);
    const lows = [...(arc.lows || [])].sort((a, b) => b.y - a.y).slice(0, 2).sort((a, b) => a.x - b.x);
    cards.push({
      id: 'arc', label: 'The shape of the year', w: arc.w, h: arc.h, line: arc.line, area: arc.area || '', peak: String(arc.peak || ''),
      months: Array.isArray(arc.months) ? arc.months.map((/** @type {any} */ m) => ({ label: String(m.label), x: Number(m.x) })) : [],
      highs: highs.map((h) => ({ x: h.x, y: h.y, stamp: String(h.stamp || ''), title: String(h.title || ''), date: String(h.date || '') })),
      lows: lows.map((l) => ({ x: l.x, y: l.y, title: String(l.title || ''), date: String(l.date || '') })),
    });
  }
  if (review?.days?.cols?.length) {
    const active = Number(review.days.active) || 0;
    const blocks = monthBlocks(review.days, year);
    const counted = blocks.reduce((t, m) => t + m.days.filter((d) => !d.future).length, 0);
    // The numbers card's own words for it ("out of 319"), so the two cards agree.
    const outOf = /^out of \d+/.test(num('days')?.quip || '') ? num('days').quip : `out of ${counted}`;
    cards.push({ id: 'days', label: 'Every single day', active, outOfDays: outOf, months: blocks, legend: legendOf(review.days).slice(0, 8) });
  }
  const races = review?.races;
  const tickets = pickTickets(races?.tickets || [], races?.parkrun ? 5 : 6);
  if (tickets.length || races?.parkrun) {
    cards.push({
      id: 'races', label: 'Race day',
      count: num('races')?.display || String((races?.tickets || []).length), quip: num('races')?.quip || '',
      tickets: tickets.map((t) => ({ title: String(t.title || ''), value: String(t.value || ''), unit: String(t.unit || ''), date: String(t.date || ''), pb: !!t.pb, stamp: String(t.stamp || ''), ink: inkOf(t.typeClass) })),
      more: Math.max(0, (races?.tickets || []).length - tickets.length),
      parkrun: races?.parkrun ? { count: Number(races.parkrun.count) || 0, best: String(races.parkrun.best || ''), courses: Number(races.parkrun.courses) || 0 } : null,
    });
  }
  const pbs = review?.pbs;
  if (pbs && Number(pbs.total) > 0) {
    cards.push({
      id: 'pbs', label: 'Personal bests', total: String(num('pbs')?.display || pbs.total), quip: String(num('pbs')?.quip || ''),
      bestMonth: String(pbs.bestMonth || ''),
      biggest: pbs.biggest ? { name: String(pbs.biggest.name), metric: String(pbs.biggest.metric || ''), from: String(pbs.biggest.from), to: String(pbs.biggest.to), pct: String(pbs.biggest.pct || '') } : null,
      lines: pickProgressions(pbs.featured).map((f) => ({ name: String(f.name), metric: String(f.metric || ''), from: String(f.from), to: String(f.to), change: String(f.change || ''), d: String(f.d), w: Number(f.w), h: Number(f.h), dots: (f.dots || []).map((/** @type {any} */ p) => ({ x: Number(p.x), y: Number(p.y) })) })),
    });
  }
  const awards = Array.isArray(review?.awards) ? review.awards : [];
  if (awards.length) {
    const ordered = [...AWARD_ORDER.map((s) => awards.find((a) => a.stamp === s)).filter(Boolean), ...awards.filter((a) => !AWARD_ORDER.includes(a.stamp))];
    cards.push({ id: 'awards', label: 'The awards', awards: ordered.slice(0, 4).map((a) => ({ stamp: String(a.stamp || ''), title: String(a.title || ''), value: String(a.value || ''), sub: String(a.sub || '') })) });
  }
  cards.push({
    id: 'next', label: 'Next issue', nextYear: Number(review?.nextYear) || year + 1,
    upcoming: (review?.upcoming || []).slice(0, 4).map((/** @type {any} */ u) => ({ title: String(u.title || ''), date: String(u.date || '') })),
  });
  const outOf = cards.length;
  return { year, href, link, path: pagePath, cards: cards.map((c, i) => ({ ...c, n: i + 1, outOf })) };
}

// ---------------------------------------------------------------------------
// The ordinary year share card (and og:image), with the review's numbers

/**
 * The year roundup's share model with the review in place of the year file: its totals,
 * its active days and its PB count, every day on the heatmap, and the cover photos as
 * the background. Leaves the model alone when the review has nothing.
 * @param {any} model  roundupShareModel's output for a year
 * @param {any} review buildYearReview's output
 */
export function withYearReview(model, review) {
  if (!review || !Array.isArray(review.numbers) || !review.numbers.length) return model;
  const byKey = new Map(review.numbers.map((/** @type {any} */ n) => [n.key, n]));
  const totals = ['sessions', 'hours', 'km', 'pbs'].map((k) => byKey.get(k)).filter(Boolean)
    .map((/** @type {any} */ n) => ({ value: String(n.display), unit: n.unit && n.unit.length <= 3 ? n.unit : '', label: n.label }));
  // Every day of the year on the heatmap: a session is a full square, a race the same.
  const cells = (review.days?.cols || []).flatMap((/** @type {any} */ c) => c?.cells || []);
  /** @type {{ level: number, dow: number, col: number, label: string }[]} */
  const days = [];
  /** @type {{ col: number, label: string }[]} */
  const months = [];
  let lastMonth = -1;
  cells.forEach((/** @type {any} */ c, i) => {
    if (!c || c.blank) return;
    const col = Math.floor(i / 7);
    const d = new Date(Date.UTC(review.year, 0, 1 + days.length));
    if (d.getUTCMonth() !== lastMonth) { months.push({ col, label: MON[d.getUTCMonth()].toUpperCase() }); lastMonth = d.getUTCMonth(); }
    days.push({ level: c.typeClass ? (c.race ? 4 : 3) : 0, dow: i % 7, col, label: '' });
  });
  const photos = (model.photos && model.photos.length) ? model.photos
    : (review.cover?.photos || []).map((/** @type {any} */ p) => p?.url).filter((/** @type {string} */ u) => /^https:\/\//.test(u || '')).slice(0, 3);
  return {
    ...model,
    totals,
    sessions: Number(byKey.get('sessions')?.value) || model.sessions,
    activeDays: Number(review.days?.active) || model.activeDays,
    prCount: Number(review.pbs?.total) || model.prCount,
    isPB: Number(review.pbs?.total) > 0 || model.isPB,
    calendar: days.length ? { type: 'year', days, months } : model.calendar,
    photos,
    // The year file's PR list and comparison are empty or stale until FitGlue sums the year.
    prs: [],
    vs: null,
  };
}

/**
 * The year reviews for the build, keyed by roundup key: the same storyContext and options
 * the roundup view task uses (tasks/fitness-roundup-views.mjs).
 * @param {any} g  Skier globals
 * @param {any[]} yearFiles  the year roundup files
 * @returns {Map<string, any>}
 */
export function yearReviewsFor(g, yearFiles) {
  /** @type {Map<string, any>} */
  const out = new Map();
  if (!yearFiles.length) return out;
  const index = g.fitnessIndex || {};
  const story = storyContext({
    files: Array.isArray(g.fitnessActivities) ? g.fitnessActivities : [],
    entries: Array.isArray(index.activities) ? index.activities : [],
    past: Array.isArray(g.fitnessEvents?.past) ? g.fitnessEvents.past : [],
    roundupFiles: Array.isArray(g.fitnessRoundups) ? g.fitnessRoundups : [],
    showPhotos: Boolean(index.profile?.showPhotoGallery),
  });
  const upcoming = Array.isArray(g.fitnessEvents?.events) ? g.fitnessEvents.events : [];
  for (const f of yearFiles) out.set(f.key, buildYearReview(f, story, { upcoming }));
  return out;
}

// ---------------------------------------------------------------------------
// Rendering

/** @param {string} p */
async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

/**
 * A photo as a data URI small enough to embed (640 px on the long side, JPEG).
 * @param {string} url @param {string} photoDir @param {{ fetchImpl?: typeof fetch, offline?: boolean }} o
 */
async function photoData(url, photoDir, o) {
  const sharp = await getSharp();
  const buf = await loadPhoto(url, photoDir, o);
  const jpg = await sharp(buf).rotate().resize(720, 720, { fit: 'inside', withoutEnlargement: true }).modulate({ saturation: 0.92 }).jpeg({ quality: 82 }).toBuffer();
  return `data:image/jpeg;base64,${jpg.toString('base64')}`;
}

/**
 * Find ffmpeg: $FFMPEG, else `ffmpeg` on PATH, else ~/.local/bin/ffmpeg (the box's static
 * build, which a systemd-started deploy may not have on PATH). '' when there is none.
 * @param {Record<string, string|undefined>} [env]
 */
export function findFfmpeg(env = process.env) {
  if (env.FFMPEG !== undefined) return env.FFMPEG && fss.existsSync(env.FFMPEG) ? env.FFMPEG : '';
  for (const dir of String(env.PATH || '').split(path.delimiter).filter(Boolean)) {
    const p = path.join(dir, 'ffmpeg');
    try { fss.accessSync(p, fss.constants.X_OK); return p; } catch { /* next */ }
  }
  const local = path.join(os.homedir(), '.local/bin/ffmpeg');
  return fss.existsSync(local) ? local : '';
}

/** Seconds each card holds, the transition length, and the transitions in turn. */
export const VIDEO = { first: 3.4, each: 3.0, last: 4.2, fade: 0.5, fps: 30, transitions: ['slideleft', 'fade', 'wipeleft', 'smoothleft', 'slideup', 'fade', 'wipeleft', 'slideleft'] };

/**
 * The ffmpeg arguments for the story video: each card a slow zoom (in on odd cards, out
 * on even ones, from a 2× upscale so the motion does not judder), the cards joined with
 * xfade transitions, the link band overlaid still on top, H.264 yuv420p 30 fps faststart.
 * @param {string[]} cards PNG paths in order @param {string} band PNG of the link band (1080 wide)
 * @param {string} out @param {{ timing?: Partial<typeof VIDEO> }} [o]
 */
export function videoArgs(cards, band, out, o = {}) {
  const v = { ...VIDEO, ...(o.timing || {}) };
  const n = cards.length;
  const durs = cards.map((_, i) => (i === 0 ? v.first : i === n - 1 ? v.last : v.each));
  const args = ['-hide_banner', '-loglevel', 'error', '-y'];
  for (const c of cards) args.push('-i', c);
  args.push('-loop', '1', '-i', band);
  const { w, h } = STORY;
  const parts = [];
  cards.forEach((_, i) => {
    const frames = Math.round(durs[i] * v.fps);
    const zin = i % 2 === 0;
    const z = zin ? `1+0.03*on/${frames}` : `1.03-0.03*on/${frames}`;
    // The zoom's fixed point is the link band's centre, so the card's own band stays under the overlay.
    const k = ((BAND.y + BAND.h / 2) / h).toFixed(4);
    parts.push(`[${i}:v]scale=${w * 2}:${h * 2}:flags=lanczos,zoompan=z='${z}':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)*${k}':d=${frames}:s=${w}x${h}:fps=${v.fps},setsar=1,format=yuv420p[c${i}]`);
  });
  let last = 'c0';
  let offset = 0;
  for (let i = 1; i < n; i++) {
    offset += durs[i - 1] - v.fade;
    const t = v.transitions[(i - 1) % v.transitions.length];
    parts.push(`[${last}][c${i}]xfade=transition=${t}:duration=${v.fade}:offset=${offset.toFixed(3)}[x${i}]`);
    last = `x${i}`;
  }
  const total = durs.reduce((s, d) => s + d, 0) - v.fade * (n - 1);
  parts.push(`[${n}:v]format=rgba[band]`, `[${last}][band]overlay=0:${BAND.y - BAND.pad}:shortest=1,format=yuv420p[out]`);
  args.push('-filter_complex', parts.join(';'), '-map', '[out]', '-t', total.toFixed(3),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-profile:v', 'high', '-level', '4.1', '-pix_fmt', 'yuv420p',
    '-r', String(v.fps), '-movflags', '+faststart', out);
  return { args, seconds: total };
}

/** @param {string} bin @param {string[]} args @param {number} timeoutMs */
function run(bin, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err = (err + d).slice(-4000); });
    const timer = setTimeout(() => { p.kill('SIGKILL'); reject(new Error(`ffmpeg timed out after ${timeoutMs / 1000} s`)); }, timeoutMs);
    p.on('error', (e) => { clearTimeout(timer); reject(e); });
    p.on('close', (code) => { clearTimeout(timer); code === 0 ? resolve(undefined) : reject(new Error(`ffmpeg exited ${code}: ${err.trim().split('\n').slice(-3).join(' | ')}`)); });
  });
}

/**
 * Encode the deck as story.mp4 (cached by the cards' hashes).
 * @param {{ cards: string[], band: string, out: string, cachePath: string, key: string, ffmpeg?: string, logger?: any, timing?: Partial<typeof VIDEO>, timeoutMs?: number }} o
 * @returns {Promise<{ cached: boolean, seconds: number } | null>}
 */
export async function encodeStoryVideo(o) {
  const logger = o.logger || silentLogger;
  const bin = o.ffmpeg ?? findFfmpeg();
  if (!bin) { logger.warn('Year story video skipped: no ffmpeg (set FFMPEG or put ffmpeg on PATH)'); return null; }
  const hash = sha([VIDEO_VERSION, o.key, JSON.stringify(o.timing || {})].join('\n'));
  const { args, seconds } = videoArgs(o.cards, o.band, o.out, { timing: o.timing });
  await fs.mkdir(path.dirname(o.out), { recursive: true });
  if (await exists(o.cachePath)) {
    let hit = false;
    try { hit = (await fs.readFile(`${o.cachePath}.sha1`, 'utf8')).trim() === hash; } catch { hit = false; }
    if (hit) { await fs.copyFile(o.cachePath, o.out); return { cached: true, seconds }; }
  }
  try {
    await run(bin, args, o.timeoutMs ?? 300_000);
  } catch (e) {
    logger.warn(`Year story video failed: ${errMsg(e)}`);
    await fs.rm(o.out, { force: true });
    return null;
  }
  await fs.mkdir(path.dirname(o.cachePath), { recursive: true });
  await fs.copyFile(o.out, o.cachePath);
  await fs.writeFile(`${o.cachePath}.sha1`, hash);
  return { cached: false, seconds };
}

/**
 * @typedef {{ n: number, id: string, label: string, url: string, file: string, w: number, h: number }} DeckCard
 * @typedef {{ key: string, year: number, link: string, href: string, title: string, cards: DeckCard[], count: number,
 *   video: { url: string, file: string, seconds: number, poster: string } | null }} YearDeck
 */

/**
 * Render one year's deck and its video.
 * @param {any} review @param {{ key: string, url?: string, siteUrl?: string, outDir?: string, cacheDir?: string, urlBase?: string,
 *   logger?: any, fetchImpl?: typeof fetch, offline?: boolean, video?: boolean, ffmpeg?: string, timing?: Partial<typeof VIDEO> }} opts
 * @returns {Promise<YearDeck & { rendered: number, cached: number }>}
 */
export async function renderYearDeck(review, opts) {
  const logger = opts.logger || silentLogger;
  const outDir = opts.outDir || 'public/personal/life/share';
  const cacheDir = opts.cacheDir || '.cache/og';
  const urlBase = (opts.urlBase || '/life/share').replace(/\/+$/, '');
  const photoDir = path.join(cacheDir, 'photos');
  const sharp = await getSharp();
  const deck = yearDeckModel(review, { url: opts.url, siteUrl: opts.siteUrl });
  const relDir = path.posix.join('roundup', opts.key);
  let rendered = 0, cached = 0;
  /** @type {DeckCard[]} */
  const cards = [];
  /** @type {string[]} */
  const hashes = [];
  /** @type {string[]} */
  const paths = [];
  for (const card of deck.cards) {
    const name = `story-${String(card.n).padStart(2, '0')}.png`;
    const rel = path.posix.join(relDir, name);
    const outPath = path.join(outDir, rel);
    const cachePath = path.join(cacheDir, rel);
    try {
      const { svg, photos } = buildYearStorySVG(deck, card);
      const hash = sha([DECK_VERSION, svg, ...photos].join('\n'));
      let hit = false;
      if (await exists(cachePath)) {
        try { hit = (await fs.readFile(`${cachePath}.sha1`, 'utf8')).trim() === hash; } catch { hit = false; }
      }
      await fs.mkdir(path.dirname(outPath), { recursive: true });
      if (hit) {
        await fs.copyFile(cachePath, outPath);
        cached++;
      } else {
        let full = svg;
        for (let i = 0; i < photos.length; i++) {
          let data = '';
          try { data = await photoData(photos[i], photoDir, opts); } catch (e) { logger.debug(`year deck ${rel}: photo unavailable (${errMsg(e)})`); }
          full = full.split(`__PHOTO_${i}__`).join(data);
        }
        // A photo that would not load leaves its frame empty: drop the image element.
        full = full.replace(/<image [^>]*href=""[^>]*\/>/g, '');
        await sharp(Buffer.from(full)).resize(STORY.w, STORY.h).png({ compressionLevel: 9, ...(photos.length ? {} : { palette: true, quality: 92 }) }).toFile(outPath);
        await fs.mkdir(path.dirname(cachePath), { recursive: true });
        await fs.copyFile(outPath, cachePath);
        await fs.writeFile(`${cachePath}.sha1`, hash);
        rendered++;
      }
      hashes.push(hash);
      paths.push(outPath);
      cards.push({ n: card.n, id: card.id, label: card.label, url: `${urlBase}/${rel}`, file: `${opts.key}-${String(card.n).padStart(2, '0')}-${card.id}.png`, w: STORY.w, h: STORY.h });
    } catch (e) {
      logger.warn(`year deck card ${rel} failed: ${errMsg(e)}`);
    }
  }

  /** @type {YearDeck['video']} */
  let video = null;
  if (opts.video !== false && cards.length === deck.cards.length && cards.length >= 2) {
    const bandPath = path.join(cacheDir, relDir, 'band.png');
    const bandSvg = footerBandSVG(deck);
    await fs.mkdir(path.dirname(bandPath), { recursive: true });
    await sharp(Buffer.from(bandSvg)).png().toFile(bandPath);
    const rel = path.posix.join(relDir, 'story.mp4');
    const r = await encodeStoryVideo({
      cards: paths, band: bandPath, out: path.join(outDir, rel), cachePath: path.join(cacheDir, rel),
      key: [...hashes, sha(bandSvg)].join(','), ffmpeg: opts.ffmpeg, logger, timing: opts.timing,
    });
    if (r) video = { url: `${urlBase}/${rel}`, file: `${opts.key}-in-review.mp4`, seconds: Math.round(r.seconds), poster: cards[0].url };
  }
  return { key: opts.key, year: deck.year, link: deck.link, href: deck.href, title: `${deck.year} in review`, cards, count: cards.length, video, rendered, cached };
}
