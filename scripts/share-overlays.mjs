// @ts-check
/**
 * Share overlays: transparent PNGs of an activity's numbers and charts, to lay over his
 * own photos in Instagram (a Story's photo sticker, or the Insta Post Maker canvas) —
 * the way Strava's and ROXFIT's overlays work. Same models as the share cards
 * (tasks/fitness-share-models.mjs), same drawing blocks (scripts/share-cards.mjs BLOCKS),
 * but no ground, no scrim and no zine frame: just the type and the marks, with a soft
 * shadow (light tone) or a halo (dark tone) so they read on any photo.
 *
 * Two kinds of overlay per page:
 *   pieces   one element each — the title, the big numbers, the PB stamp, the route,
 *            the km splits, the Hyrox splits, the top sets, the HR trace, the sport
 *            donut, the calendar — drawn on a 1080-wide canvas and trimmed to the ink by
 *            tasks/fitness-og-images.mjs (so they arrive as stickers, not frames);
 *   layouts  the whole card's content at Story (1080×1920) or Square (1080×1080) size,
 *            untrimmed, so it drops onto a full-bleed photo already placed; the Story
 *            layout keeps Instagram's top and bottom bands clear like the cards do.
 *
 * Two tones: `light` (white, ink shadow) and `dark` (ink, white halo).
 */
import { BLOCKS, DRAW, SHAPES, cardTheme } from './share-cards.mjs';

const {
  gap, stack, kicker, line, title, statGrid, hyroxRows, hyroxCols, splitCols, routeSvg, sparkBlock,
  donutBlock, heatmap, prWall, listRows, sectionHead, badgeBlock, deltaRow, headline, raceLines, parkrunStats,
} = BLOCKS;

/** @typedef {'light'|'dark'} Tone */
/** @typedef {{ id: string, label: string, svg: string, w: number, h: number, trim: boolean }} OverlaySvg */

export const TONES = /** @type {Tone[]} */ (['light', 'dark']);
export const TONE_LABELS = { light: 'Light', dark: 'Dark' };

/** The canvas a piece is drawn on before trimming; PAD leaves room for the shadow. */
const W = 1080;
const PAD = 40;
const X = PAD;
const CW = W - PAD * 2;

/** @param {Tone} tone */
const modeOf = (tone) => (tone === 'dark' ? 'overlay-dark' : 'overlay-light');

/**
 * The shadow filter. Light: a soft ink drop shadow plus a tight one for edges. Dark: a
 * white halo all round.
 * @param {import('./share-cards.mjs').Theme} th
 */
function haloDefs(th) {
  const light = th.mode === 'overlay-light';
  return `<defs><filter id="halo" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB">`
    + (light
      ? `<feDropShadow dx="0" dy="3" stdDeviation="7" flood-color="${th.shade}" flood-opacity="0.45"/><feDropShadow dx="0" dy="1" stdDeviation="1.5" flood-color="${th.shade}" flood-opacity="0.55"/>`
      : `<feDropShadow dx="0" dy="0" stdDeviation="6" flood-color="${th.shade}" flood-opacity="0.75"/><feDropShadow dx="0" dy="0" stdDeviation="1.5" flood-color="${th.shade}" flood-opacity="0.9"/>`)
    + `</filter></defs>`;
}

/** @param {number} w @param {number} h @param {string} body @param {import('./share-cards.mjs').Theme} th */
function doc(w, h, body, th) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">\n${haloDefs(th)}\n<g filter="url(#halo)">\n${body}\n</g>\n</svg>`;
}

/**
 * A stack of blocks as one piece: drawn top-down from PAD on a canvas just tall enough.
 * @param {string} id @param {string} label @param {any[]} blocks @param {import('./share-cards.mjs').Theme} th
 * @returns {OverlaySvg | null}
 */
function piece(id, label, blocks, th) {
  const list = blocks.filter((b) => b && b.h > 0);
  if (!list.length) return null;
  const h = Math.ceil(list.reduce((s, b) => s + b.h, 0)) + PAD * 2;
  const { svg } = stack(list, h - PAD);
  if (!svg.trim()) return null;
  return { id, label, svg: doc(W, h, svg, th), w: W, h, trim: true };
}

/** The route alone, fitted into a square. @param {any[]} route @param {import('./share-cards.mjs').Theme} th */
function routePiece(route, th) {
  if (!Array.isArray(route) || route.length < 10) return null;
  const side = 900;
  const svg = routeSvg(th, route, PAD, PAD, side, side, 12);
  if (!svg) return null;
  return { id: 'route', label: 'Route', svg: doc(side + PAD * 2, side + PAD * 2, svg, th), w: side + PAD * 2, h: side + PAD * 2, trim: true };
}

/** @param {any} model */
function titleBlocks(model, th) {
  return [
    kicker(th, model.kicker, X, CW, 26),
    title(th, model.title, X, CW, { max: 130, min: 70, max2: 100 }),
    line(th, model.dateLine, X, CW, 24),
  ];
}

/**
 * The badge as its own sticker (PB, the gap to the PB, a first race). On a photo an
 * outline is too thin to read, so every badge is solid: the family ink for a PB, green or
 * coral for the gap.
 * @param {any} badge @param {import('./share-cards.mjs').Theme} th
 */
function badgePiece(badge, th) {
  if (!badge?.text) return null;
  const tone = badge.kind === 'gap' ? badge.tone : '';
  const solidTh = tone ? { ...th, fill: tone === 'gain' ? th.gain : th.loss, onFill: th.mode === 'overlay-dark' ? '#FFFFFF' : '#171311' } : th;
  return piece('badge', badge.kind === 'gap' ? 'vs PB' : 'PB stamp', [badgeBlock(solidTh, { ...badge, kind: badge.kind === 'gap' ? 'pb' : badge.kind }, X, 40, CW)], th);
}

/**
 * The pieces for one model in one tone, in the order the picker lists them.
 * @param {any} model  tasks/fitness-share-models.mjs output
 * @param {Tone} tone
 * @returns {OverlaySvg[]}
 */
export function overlayPieces(model, tone) {
  const th = cardTheme(modeOf(tone), model.ink);
  /** @type {(OverlaySvg|null)[]} */
  const out = [];
  const t = model.template;
  if (t === 'race') {
    const rows = model.rows || [];
    const sumStats = [
      { value: model.runs, label: 'running' },
      { value: model.stations, label: 'stations' },
      { value: model.roxzone, label: 'roxzone' },
      model.avgHr ? { value: String(model.avgHr), unit: 'bpm', label: 'avg hr' } : null,
    ].filter((s) => s && s.value);
    out.push(piece('title', 'Title', titleBlocks(model, th), th));
    out.push(piece('total', 'Finish time', [headline(th, X, CW, { value: model.total, size: 190, badge: model.badge, badgeSize: 28, lines: raceLines(model), side: true, valueW: CW * 0.58 })], th));
    out.push(piece('stats', 'Run / stations', [statGrid(th, sumStats, X, CW, { cols: 2, size: 96, label: 20 })], th));
    if (rows.length) out.push(piece('splits', 'Splits list', [hyroxRows(th, rows, X, CW, rows.length > 16 ? 46 : 54)], th));
    if (rows.length) out.push(piece('chart', 'Splits chart', [gap(36), hyroxCols(th, rows, X, CW, 380)], th));
    out.push(badgePiece(model.badge, th));
  } else if (t === 'event') {
    out.push(piece('title', 'Title', [kicker(th, model.kicker, X, CW, 26), title(th, model.title, X, CW, { max: 130, min: 70, max2: 100 })], th));
    const races = (model.races || []).slice(0, 4);
    const blocks = [];
    races.forEach((/** @type {any} */ r, /** @type {number} */ i) => {
      const lines = [r.ranks?.length ? r.ranks.map((/** @type {any} */ k) => `${k.value} ${k.label}`).join(' · ') : '', r.partner ? `with ${r.partner}` : '', r.avgHr ? `avg hr ${r.avgHr} bpm` : ''].filter(Boolean);
      if (i) blocks.push(gap(30));
      blocks.push(kicker(th, `${r.date} · ${r.division}`, X, CW, 24));
      blocks.push(headline(th, X, CW, { value: r.total, size: races.length > 2 ? 120 : 160, badge: r.badge, badgeSize: 24, lines, side: true, valueW: CW * 0.6 }));
    });
    out.push(piece('races', 'Races', blocks, th));
  } else if (t === 'roundup') {
    const cal = model.calendar;
    out.push(piece('title', 'Title', [kicker(th, model.kicker, X, CW, 26), title(th, model.title, X, CW, { max: 150, min: 70, max2: 110 })], th));
    out.push(piece('stats', 'Totals', [statGrid(th, model.totals || [], X, CW, { cols: 2, size: 110, label: 20 })], th));
    if (model.sports?.length) out.push(piece('sports', 'By sport', [donutBlock(th, model, X, CW, 320, 5)], th));
    if (cal?.days?.length) {
      const h = cal.type === 'week' ? 200 : cal.type === 'month' ? 340 : 240;
      out.push(piece('calendar', 'Calendar', [sectionHead(th, cal.type === 'week' ? 'the week' : cal.type === 'month' ? 'the month' : 'the year', X, CW, 22, `${model.activeDays} active days`), heatmap(th, cal, X, CW, h)], th));
    }
    const prs = model.prs || [];
    if (prs.length) out.push(piece('prs', 'Records', [sectionHead(th, 'personal records', X, CW, 22, model.prCount > 4 ? `${model.prCount} in all` : ''), prWall(th, prs.slice(0, 4), X, CW, { cols: 2, rows: 2, size: 30 })], th));
    if (model.vs?.deltas?.length) out.push(piece('vs', 'vs last', [deltaRow(th, model.vs.deltas, model.vs.label, X, CW, 22)], th));
  } else {
    out.push(piece('title', 'Title', titleBlocks(model, th), th));
    out.push(piece('stats', 'Numbers', [statGrid(th, model.stats || [], X, CW, { cols: 2, size: 130, label: 22 })], th));
    out.push(badgePiece(model.badge, th));
    if (model.parkrun) out.push(piece('parkrun', 'parkrun', [statGrid(th, parkrunStats(model.parkrun), X, CW, { cols: 3, size: 80, label: 20 })], th));
    if (model.splits?.length > 1) out.push(piece('splits', 'Km splits', [sectionHead(th, 'km splits', X, CW, 22, model.splitNote), splitCols(th, model.splits, X, CW, 280)], th));
    if (t === 'strength') {
      const sets = (model.topSets || []).slice(0, 8);
      if (sets.length) out.push(piece('sets', 'Top sets', [sectionHead(th, 'top sets', X, CW, 22, `${model.exerciseCount} exercises`), listRows(th, sets, X, CW, 66)], th));
      const prs = (model.prs || []).slice(0, 4);
      if (prs.length) out.push(piece('prs', 'PBs', [sectionHead(th, prs.length === 1 ? 'personal best' : 'personal bests', X, CW, 22), prWall(th, prs, X, CW, { cols: 2, rows: 2, size: 32 })], th));
    }
    if (model.hr?.length >= 4) out.push(piece('hr', 'Heart rate', [sparkBlock(th, model.hr, X, CW, 260, 'heart rate · bpm')], th));
    out.push(routePiece(model.route, th));
  }
  return /** @type {OverlaySvg[]} */ (out.filter(Boolean));
}

/** The full-card layouts: the card's content, no ground, at the shape's own size. */
export const LAYOUT_SHAPES = /** @type {('story'|'square')[]} */ (['story', 'square']);

/**
 * One layout (the card's content with no ground or frame) as an untrimmed SVG.
 * @param {any} model @param {'story'|'square'} shape @param {Tone} tone
 * @returns {OverlaySvg}
 */
export function overlayLayout(model, shape, tone) {
  const th = cardTheme(modeOf(tone), model.ink);
  const draw = DRAW[model.template] || DRAW.other;
  const body = draw(model, shape, th);
  const { w, h, label } = SHAPES[shape];
  return { id: `layout-${shape}`, label: `${label} layout`, svg: doc(w, h, body.svg, th), w, h, trim: false };
}

/**
 * Every overlay for a model in one tone: the layouts first (the quick option), then the
 * pieces.
 * @param {any} model @param {Tone} tone
 * @returns {OverlaySvg[]}
 */
export function buildOverlaySVGs(model, tone) {
  return [...LAYOUT_SHAPES.map((s) => overlayLayout(model, s, tone)), ...overlayPieces(model, tone)];
}
