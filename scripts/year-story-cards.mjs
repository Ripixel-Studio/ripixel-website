// @ts-check
/**
 * The year in review as Instagram story cards (1080×1920): the drawing. One SVG per card
 * from the deck model (tasks/fitness-year-share.mjs `yearDeckModel`), rasterised there
 * with sharp.
 *
 * Each card is a page of the zine: paper (#F5EFDF) or ink (#171311) ground, the double
 * rule, a halftone blot in the card's riso ink, Anton display type and JetBrains Mono
 * labels, a misregistered second ink behind the big numbers. Every card has the same head
 * (the issue stamp and "3 / 8") and the same foot: a yellow band with the page's link,
 * which the video holds still over the motion (footerBandSVG).
 *
 * Instagram draws its own UI over the top ~220 px and bottom ~250 px of a story, so all
 * type sits between SAFE.top and SAFE.bottom; the band ends above SAFE.bottom.
 *
 * Photos are placeholders (`__PHOTO_<i>__`) in the SVG; the task swaps in data URIs, so
 * the cache hash sees the photo URLs, not their bytes.
 */
import { xmlEsc } from './generate-og-images.mjs';
import { antonW, monoW, clipMono, fitAnton, PAPER, INK } from './share-cards.mjs';

export const STORY = { w: 1080, h: 1920 };
/** Instagram's UI bands: nothing that matters above top or below bottom. */
export const SAFE = { top: 220, bottom: 1670 };
/** The link band: y, height, and the transparent margin of the video overlay. */
export const BAND = { y: 1546, h: 104, pad: 6 };

export const RISO = { yellow: '#F2C13C', magenta: '#D32E84', blue: '#2148C0', purple: '#7C3AED' };
const PAPER_4 = '#FFFCEF';
const MONO = "'JetBrains Mono', 'Liberation Mono', monospace";
const DISPLAY = "Anton, 'Impact', 'Liberation Sans Narrow', sans-serif";
const X0 = 80;
const X1 = 1000;
const CW = X1 - X0;

const r1 = (/** @type {number} */ n) => Math.round(n * 10) / 10;

/**
 * @param {number} x @param {number} y @param {unknown} s
 * @param {{ size: number, fill: string, disp?: boolean, bold?: boolean, anchor?: 'start'|'middle'|'end', ls?: number, op?: number }} o
 */
function T(x, y, s, o) {
  const str = String(s ?? '');
  if (!str) return '';
  return `<text x="${r1(x)}" y="${r1(y)}"${o.anchor && o.anchor !== 'start' ? ` text-anchor="${o.anchor}"` : ''} font-family="${o.disp ? DISPLAY : MONO}" font-size="${r1(o.size)}"${o.bold ? ' font-weight="700"' : ''} fill="${o.fill}"${o.op != null && o.op < 1 ? ` fill-opacity="${o.op}"` : ''}${o.ls ? ` letter-spacing="${o.ls}"` : ''}>${xmlEsc(str)}</text>`;
}

/** Display text with a misregistered second ink behind it. */
function riso(/** @type {number} */ x, /** @type {number} */ y, /** @type {string} */ s, /** @type {{ size: number, fill: string, shadow: string, anchor?: 'start'|'middle'|'end', dx?: number, dy?: number }} */ o) {
  const dx = o.dx ?? Math.max(4, Math.round(o.size * 0.03));
  const dy = o.dy ?? Math.max(3, Math.round(o.size * 0.022));
  return T(x + dx, y + dy, s, { size: o.size, fill: o.shadow, disp: true, anchor: o.anchor, ls: -1 }) + T(x, y, s, { size: o.size, fill: o.fill, disp: true, anchor: o.anchor, ls: -1 });
}

/** The largest mono size ≤ max that fits. */
function fitMono(/** @type {string} */ s, /** @type {number} */ maxW, /** @type {number} */ max, /** @type {number} */ min, ls = 0) {
  let size = max;
  while (size > min && monoW(s, size, ls) > maxW) size -= 1;
  return size;
}

/** Words into lines of at most `chars`; a word longer than a line is cut. */
function wrap(/** @type {string} */ text, /** @type {number} */ chars, /** @type {number} */ maxLines) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  /** @type {string[]} */
  const lines = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length <= chars || !cur) cur = next;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${kept[maxLines - 1].slice(0, Math.max(1, chars - 1)).trimEnd()}…`;
    return kept;
  }
  return lines.map((l) => (l.length > chars ? `${l.slice(0, chars - 1)}…` : l));
}

/** Ink or paper, whichever reads on `hex`. @param {string} hex */
export function onInk(hex) {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.5 ? INK : PAPER;
}

/**
 * Scale an absolute SVG path (M L C H V Z with x,y pairs) into a box.
 * @param {string} d @param {number} sx @param {number} sy @param {number} ox @param {number} oy
 */
export function scalePath(d, sx, sy, ox, oy) {
  const out = [];
  const re = /([MLCHVZ])([^MLCHVZ]*)/gi;
  let m;
  while ((m = re.exec(String(d || '')))) {
    const cmd = m[1].toUpperCase();
    const nums = (m[2].match(/-?\d*\.?\d+(?:e-?\d+)?/gi) || []).map(Number);
    if (cmd === 'Z') out.push('Z');
    else if (cmd === 'H') out.push(`H${nums.map((n) => r1(ox + n * sx)).join(' ')}`);
    else if (cmd === 'V') out.push(`V${nums.map((n) => r1(oy + n * sy)).join(' ')}`);
    else {
      const pts = [];
      for (let i = 0; i + 1 < nums.length; i += 2) pts.push(`${r1(ox + nums[i] * sx)},${r1(oy + nums[i + 1] * sy)}`);
      out.push(`${cmd}${pts.join(' ')}`);
    }
  }
  return out.join(' ');
}

// ---------------------------------------------------------------------------
// The page: ground, frame, head, the link band

/**
 * @typedef {{ dark: boolean, bg: string, fg: string, accent: string, shadow: string, soft: number }} Look
 */

/** @param {'paper'|'ink'} ground @param {string} accent @param {string} [shadow] @returns {Look} */
function look(ground, accent, shadow) {
  const dark = ground === 'ink';
  return { dark, bg: dark ? INK : PAPER, fg: dark ? PAPER : INK, accent, shadow: shadow || accent, soft: dark ? 0.78 : 0.72 };
}

/** The ground, the halftone blot, the double rule and the registration mark. @param {Look} L @param {{ blot?: [number, number, number] }} [o] */
function ground(L, o = {}) {
  const [bx, by, br] = o.blot || [960, 330, 300];
  return `<defs>
  <pattern id="grain" width="9" height="9" patternUnits="userSpaceOnUse"><circle cx="4.5" cy="4.5" r="1.1" fill="${L.fg}" fill-opacity="${L.dark ? 0.07 : 0.06}"/></pattern>
  <pattern id="ht" width="16" height="16" patternUnits="userSpaceOnUse" patternTransform="rotate(18)"><circle cx="8" cy="8" r="4.2" fill="${L.accent}"/></pattern>
  <radialGradient id="fade" cx="${bx}" cy="${by}" r="${br}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity="1"/><stop offset="0.7" stop-color="#fff" stop-opacity="0.55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
  <mask id="blot"><rect width="${STORY.w}" height="${STORY.h}" fill="url(#fade)"/></mask>
</defs>
<rect width="${STORY.w}" height="${STORY.h}" fill="${L.bg}"/>
<rect width="${STORY.w}" height="${STORY.h}" fill="url(#ht)" mask="url(#blot)" opacity="${L.dark ? 0.5 : 0.32}"/>
<rect width="${STORY.w}" height="${STORY.h}" fill="url(#grain)"/>
<rect x="24" y="24" width="${STORY.w - 48}" height="${STORY.h - 48}" fill="none" stroke="${L.fg}" stroke-width="3"/>
<rect x="34" y="34" width="${STORY.w - 68}" height="${STORY.h - 68}" fill="none" stroke="${L.fg}" stroke-width="1.2"/>
<g stroke="${L.accent}" stroke-width="2.5" fill="none"><circle cx="76" cy="76" r="18"/><line x1="52" y1="76" x2="100" y2="76"/><line x1="76" y1="52" x2="76" y2="100"/></g>`;
}

/** The head: the issue stamp, the byline, the card's number. @param {any} deck @param {any} card @param {Look} L */
function head(deck, card, L) {
  const label = `YEAR IN REVIEW · ${deck.year}`;
  const size = 24;
  const ls = 3;
  const w = Math.round(monoW(label, size, ls) + size * 1.4);
  const stampFill = L.dark ? RISO.yellow : INK;
  const count = `${String(card.n).padStart(2, '0')} / ${String(card.outOf).padStart(2, '0')}`;
  return `<rect x="${X0}" y="244" width="${w}" height="46" fill="${stampFill}"/>
${T(X0 + w / 2, 276, label, { size, fill: L.dark ? INK : PAPER, bold: true, ls, anchor: 'middle' })}
${T(X1, 286, count, { size: 46, fill: L.fg, disp: true, anchor: 'end', ls: 1 })}
${T(X0, 330, 'JAMES KING · THE FITNESS ZINE · THE ANNUAL ISSUE', { size: 18, fill: L.fg, op: L.soft, bold: true, ls: 2 })}
<line x1="${X0}" y1="346" x2="${X1}" y2="346" stroke="${L.fg}" stroke-width="2"/>`;
}

/**
 * The link band, drawn at y = `top`: yellow, ink rules, "read the whole issue", the link,
 * an arrow. The same on every card, so the video can hold it still.
 * @param {any} deck @param {number} top
 */
function band(deck, top) {
  const link = String(deck.link || '');
  const arrowX = X1 - 30;
  const maxW = arrowX - 46 - X0;
  const size = fitMono(link, maxW, 34, 18);
  const cy = top + BAND.h / 2;
  return `<rect x="0" y="${top}" width="${STORY.w}" height="${BAND.h}" fill="${RISO.yellow}"/>
<rect x="0" y="${top}" width="${STORY.w}" height="4" fill="${INK}"/>
<rect x="0" y="${top + BAND.h - 4}" width="${STORY.w}" height="4" fill="${INK}"/>
${T(X0, top + 38, 'READ THE WHOLE ISSUE', { size: 19, fill: INK, bold: true, ls: 3 })}
${T(X0, top + 80, link, { size, fill: INK, bold: true })}
<circle cx="${arrowX}" cy="${cy}" r="30" fill="${INK}"/>
<path d="M${arrowX - 13},${cy} H${arrowX + 11} M${arrowX + 1},${cy - 10} L${arrowX + 12},${cy} L${arrowX + 1},${cy + 10}" fill="none" stroke="${RISO.yellow}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`;
}

/** The link band alone, for the video's overlay (transparent above and below). @param {any} deck */
export function footerBandSVG(deck) {
  const h = BAND.h + BAND.pad * 2;
  // The rules run 4 px into the margin, over the zoomed card's own band edges.
  const edge = `<rect x="0" y="${BAND.pad - 4}" width="${STORY.w}" height="6" fill="${INK}"/><rect x="0" y="${BAND.pad + BAND.h - 2}" width="${STORY.w}" height="6" fill="${INK}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${STORY.w} ${h}" width="${STORY.w}" height="${h}">\n${band(deck, BAND.pad)}\n${edge}\n</svg>`;
}

/** A heading in Anton, cut to fit. */
function heading(/** @type {string} */ text, /** @type {number} */ y, /** @type {Look} */ L, /** @type {{ size?: number, shadow?: string }} */ o = {}) {
  const s = String(text).toUpperCase();
  const size = fitAnton(s, CW, o.size ?? 150, 70);
  return o.shadow ? riso(X0, y, s, { size, fill: L.fg, shadow: o.shadow }) : T(X0, y, s, { size, fill: L.fg, disp: true, ls: -1 });
}

/** A soft mono line, cut to fit. */
function sub(/** @type {string} */ text, /** @type {number} */ y, /** @type {Look} */ L, size = 25, o = /** @type {{ x?: number, w?: number, bold?: boolean, fill?: string, anchor?: 'start'|'end'|'middle', caps?: boolean, ls?: number }} */ ({})) {
  const ls = o.ls ?? 1;
  const s = clipMono(o.caps ? String(text).toUpperCase() : String(text), o.w ?? CW, size, ls);
  return T(o.x ?? X0, y, s, { size, fill: o.fill || L.fg, op: o.fill ? 1 : L.soft, bold: o.bold ?? true, anchor: o.anchor, ls });
}

// ---------------------------------------------------------------------------
// The cards

/** Polaroid spots on the cover: centre x, centre y, tilt. */
const POLAROIDS = [
  [240, 630, -7], [545, 605, 4], [840, 660, -3], [370, 830, 6], [700, 845, -5],
];

/** @param {any} deck @param {any} card @param {string[]} photos */
function cover(deck, card, photos) {
  const L = look('ink', RISO.yellow);
  let body = T(X0, 400, 'THE YEAR IN SPORT, EVERY SESSION OF IT', { size: 24, fill: RISO.yellow, bold: true, ls: 3 });
  const list = card.photos || [];
  const spots = list.length >= 4 ? POLAROIDS : list.length === 3 ? [[250, 680, -6], [545, 640, 4], [840, 720, -3]] : list.length === 2 ? [[330, 680, -5], [730, 700, 4]] : [[540, 700, -3]];
  const pw = 276, ph = 326, inset = 15, pic = pw - inset * 2;
  body += '<defs>' + list.map((_, i) => `<clipPath id="pc${i}"><rect x="${-pw / 2 + inset}" y="${-ph / 2 + inset}" width="${pic}" height="${pic}"/></clipPath>`).join('') + '</defs>';
  list.slice(0, spots.length).forEach((p, i) => {
    const [cx, cy, rot] = spots[i];
    photos.push(p.url);
    const cap = clipMono(String(p.title || '').toUpperCase(), pic, 16, 1);
    body += `<g transform="translate(${cx} ${cy}) rotate(${rot})">
  <rect x="${-pw / 2 + 8}" y="${-ph / 2 + 10}" width="${pw}" height="${ph}" fill="${INK}" fill-opacity="0.55"/>
  <rect x="${-pw / 2}" y="${-ph / 2}" width="${pw}" height="${ph}" fill="${PAPER_4}"/>
  <rect x="${-pw / 2 + inset}" y="${-ph / 2 + inset}" width="${pic}" height="${pic}" fill="${p.ink}"/>
  ${T(0, -ph / 2 + inset + pic / 2 + 14, String(p.title || '').split(/\s+/)[0]?.toUpperCase() || '', { size: 40, fill: onInk(p.ink), disp: true, anchor: 'middle', op: 0.5 })}
  <image href="__PHOTO_${photos.length - 1}__" x="${-pw / 2 + inset}" y="${-ph / 2 + inset}" width="${pic}" height="${pic}" preserveAspectRatio="xMidYMid slice" clip-path="url(#pc${i})"/>
  ${T(-pic / 2, ph / 2 - 16, cap, { size: 16, fill: INK, bold: true, ls: 1 })}
</g>`;
  });
  if (!list.length) {
    // No photos: the cover lines as stamps instead.
    (card.lines || []).forEach((/** @type {any} */ l, i) => {
      // Clear of the sticker (top right): the stamps keep to the left.
      const y = 560 + i * 140;
      const sw = CW - 190, sx = X0 + 10, mid = sx + sw / 2;
      const t = String(l.title).toUpperCase();
      body += `<g transform="rotate(${[-3, 2, -1.5][i % 3]} ${mid} ${y})"><rect x="${sx}" y="${y - 58}" width="${sw}" height="116" fill="${l.ink}"/>${T(mid, y - 14, l.stamp, { size: 22, fill: onInk(l.ink), bold: true, ls: 3, anchor: 'middle' })}${T(mid, y + 36, t, { size: fitAnton(t, sw - 40, 46, 28), fill: onInk(l.ink), disp: true, anchor: 'middle' })}</g>`;
    });
  }
  if (card.sticker) {
    body += `<g transform="translate(905 470) rotate(12)">
  <circle r="112" fill="${RISO.magenta}"/><circle r="112" fill="none" stroke="${INK}" stroke-width="4"/>
  <circle r="98" fill="none" stroke="${PAPER}" stroke-width="2" stroke-dasharray="6 6"/>
  ${T(0, 22, card.sticker.value, { size: fitAnton(card.sticker.value, 170, 92, 40), fill: PAPER, disp: true, anchor: 'middle' })}
  ${T(0, 60, String(card.sticker.label).toUpperCase(), { size: 20, fill: PAPER, bold: true, ls: 3, anchor: 'middle' })}
</g>`;
  }
  const year = String(deck.year);
  const ysize = fitAnton(year, CW, 430, 200);
  body += riso(540, 1336, year, { size: ysize, fill: PAPER, shadow: RISO.magenta, anchor: 'middle', dx: 14, dy: 10 });
  body += T(540, 1446, 'IN REVIEW', { size: 112, fill: RISO.yellow, disp: true, anchor: 'middle', ls: 2 });
  const strap = (card.strap || []).join('  ·  ');
  if (strap) body += T(540, 1508, clipMono(strap.toUpperCase(), CW, fitMono(strap, CW, 24, 16, 2), 2), { size: fitMono(strap, CW, 24, 16, 2), fill: PAPER, op: 0.85, bold: true, ls: 2, anchor: 'middle' });
  return { L, body };
}

/** @param {any} deck @param {any} card */
function numbers(deck, card) {
  const L = look('paper', RISO.magenta);
  let body = heading('The numbers', 520, L, { shadow: RISO.magenta });
  body += sub('every one of them counted from the sessions', 568, L, 25);
  const list = card.numbers || [];
  const rows = Math.ceil(list.length / 2);
  const top = 610, rowH = Math.min(225, Math.floor((1512 - top) / Math.max(1, rows)));
  const cellW = (CW - 40) / 2;
  list.forEach((/** @type {any} */ n, i) => {
    const x = X0 + (i % 2) * (cellW + 40);
    const y = top + Math.floor(i / 2) * rowH;
    if (i % 2 === 0) body += `<line x1="${X0}" y1="${y}" x2="${X1}" y2="${y}" stroke="${INK}" stroke-opacity="0.3" stroke-width="2" stroke-dasharray="2 8" stroke-linecap="round"/>`;
    const unitSize = 30;
    const unitW = n.unit ? monoW(n.unit, unitSize) + 12 : 0;
    const size = fitAnton(n.display, cellW - unitW - 10, Math.round(rowH * 0.62), 60);
    const base = y + 22 + size * 0.86;
    body += riso(x, base, n.display, { size, fill: INK, shadow: i === 0 ? RISO.yellow : RISO.magenta });
    if (n.unit) body += T(x + antonW(n.display, size) + 14, base, n.unit, { size: unitSize, fill: RISO.magenta, bold: true });
    body += T(x, base + 38, clipMono(n.label.toUpperCase(), cellW, 24, 2), { size: 24, fill: INK, bold: true, ls: 2 });
    if (n.quip) body += T(x, base + 72, clipMono(n.quip, cellW, fitMono(n.quip, cellW, 23, 19), 0), { size: fitMono(n.quip, cellW, 23, 19), fill: INK, op: L.soft, bold: true });
  });
  return { L, body };
}

/** @param {any} deck @param {any} card */
function arc(deck, card) {
  const L = look('paper', RISO.blue);
  let body = riso(X0, 488, 'THE SHAPE', { size: 140, fill: INK, shadow: RISO.blue }) + riso(X0, 622, 'OF THE YEAR', { size: 140, fill: INK, shadow: RISO.blue });
  body += sub(`hours a week, every week${card.peak ? ` · the biggest: ${card.peak}` : ''}`, 676, L, 25);
  const cx = X0, cy = 730, cw = CW, ch = 400;
  const sx = cw / card.w, sy = ch / card.h;
  body += `<defs><pattern id="archt" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(30)"><circle cx="6" cy="6" r="3.2" fill="${RISO.blue}"/></pattern></defs>`;
  if (card.area) body += `<path d="${scalePath(card.area, sx, sy, cx, cy)}" fill="url(#archt)" fill-opacity="0.55"/><path d="${scalePath(card.area, sx, sy, cx, cy)}" fill="${RISO.blue}" fill-opacity="0.12"/>`;
  body += `<line x1="${cx}" y1="${cy + ch}" x2="${cx + cw}" y2="${cy + ch}" stroke="${INK}" stroke-width="3"/>`;
  body += `<path d="${scalePath(card.line, sx, sy, cx, cy)}" fill="none" stroke="${INK}" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/>`;
  for (const m of card.months || []) {
    const mx = cx + (m.x / 100) * cw;
    body += `<line x1="${r1(mx)}" y1="${cy + ch}" x2="${r1(mx)}" y2="${cy + ch + 10}" stroke="${INK}" stroke-width="2"/>`;
    body += T(mx + 4, cy + ch + 32, String(m.label).slice(0, 1).toUpperCase(), { size: 18, fill: INK, op: 0.7, bold: true });
  }
  const marks = [];
  (card.highs || []).forEach((/** @type {any} */ h, i) => marks.push({ ...h, mark: String(i + 1), high: true }));
  (card.lows || []).forEach((/** @type {any} */ l, i) => marks.push({ ...l, mark: String.fromCharCode(65 + i), high: false }));
  for (const m of marks) {
    const mx = cx + m.x * sx, my = cy + m.y * sy;
    body += m.high
      ? `<circle cx="${r1(mx)}" cy="${r1(my)}" r="22" fill="${RISO.magenta}" stroke="${INK}" stroke-width="3"/>${T(mx, my + 10, m.mark, { size: 28, fill: PAPER, disp: true, anchor: 'middle' })}`
      : `<circle cx="${r1(mx)}" cy="${r1(my)}" r="20" fill="${PAPER_4}" stroke="${RISO.blue}" stroke-width="4"/>${T(mx, my + 8, m.mark, { size: 22, fill: RISO.blue, bold: true, anchor: 'middle' })}`;
  }
  // The key: highs, then lows.
  let y = 1212;
  const rowH = Math.min(62, Math.floor((1522 - y) / Math.max(1, marks.length)));
  for (const m of marks) {
    const by = y + rowH / 2;
    body += m.high
      ? `<circle cx="${X0 + 20}" cy="${by - 8}" r="20" fill="${RISO.magenta}"/>${T(X0 + 20, by + 2, m.mark, { size: 26, fill: PAPER, disp: true, anchor: 'middle' })}`
      : `<circle cx="${X0 + 20}" cy="${by - 8}" r="18" fill="none" stroke="${RISO.blue}" stroke-width="4"/>${T(X0 + 20, by, m.mark, { size: 20, fill: RISO.blue, bold: true, anchor: 'middle' })}`;
    const dateW = monoW(m.date, 23) + 12;
    const stamp = m.high ? String(m.stamp || 'HIGH').toUpperCase() : 'QUIET WEEK';
    const stampW = monoW(stamp, 20, 2) + 18;
    body += T(X0 + 56, by, stamp, { size: 20, fill: m.high ? RISO.magenta : RISO.blue, bold: true, ls: 2 });
    body += T(X0 + 56 + stampW, by, clipMono(m.title, X1 - (X0 + 56 + stampW) - dateW - 10, 27), { size: 27, fill: INK, bold: true });
    body += T(X1, by, m.date, { size: 23, fill: INK, op: L.soft, bold: true, anchor: 'end' });
    y += rowH;
  }
  return { L, body };
}

/** @param {any} deck @param {any} card */
function days(deck, card) {
  const L = look('paper', RISO.purple);
  let body = heading('Every single day', 500, L, { shadow: RISO.purple, size: 128 });
  const big = String(card.active);
  body += riso(X0, 600, big, { size: 84, fill: INK, shadow: RISO.yellow });
  body += T(X0 + antonW(big, 84) + 18, 596, `DAYS MOVING, ${card.outOfDays}`.toUpperCase(), { size: 26, fill: INK, bold: true, ls: 2 });
  const gapX = 26, gapY = 22;
  const bw = (CW - gapX * 3) / 4;
  const cell = bw / 7;
  const bh = 34 + cell * 6;
  const top = 640;
  (card.months || []).forEach((/** @type {any} */ m, mi) => {
    const bx = X0 + (mi % 4) * (bw + gapX);
    const by = top + Math.floor(mi / 4) * (bh + gapY);
    body += T(bx, by + 22, String(m.name).toUpperCase(), { size: 22, fill: INK, bold: true, ls: 3 });
    m.days.forEach((/** @type {any} */ d, di) => {
      const k = m.lead + di;
      const x = bx + (k % 7) * cell, y = by + 34 + Math.floor(k / 7) * cell;
      const s = cell - 4;
      if (d.ink) {
        body += `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(s)}" height="${r1(s)}" fill="${d.ink}"/>`;
        if (d.race) body += `<circle cx="${r1(x + s / 2)}" cy="${r1(y + s / 2)}" r="${r1(s * 0.24)}" fill="${PAPER}" stroke="${INK}" stroke-width="2"/>`;
      } else if (d.future) {
        body += `<rect x="${r1(x + 1.5)}" y="${r1(y + 1.5)}" width="${r1(s - 3)}" height="${r1(s - 3)}" fill="none" stroke="${INK}" stroke-opacity="0.18" stroke-width="1.5" stroke-dasharray="3 3"/>`;
      } else {
        body += `<rect x="${r1(x + 1.5)}" y="${r1(y + 1.5)}" width="${r1(s - 3)}" height="${r1(s - 3)}" fill="none" stroke="${INK}" stroke-opacity="0.4" stroke-width="2"/>`;
      }
    });
  });
  // The key: the tags in their inks, then what the marks mean.
  const legend = card.legend || [];
  let y = top + 3 * bh + 2 * gapY + 40;
  const colW = CW / 3;
  legend.slice(0, 6).forEach((/** @type {any} */ l, i) => {
    const x = X0 + (i % 3) * colW;
    const ly = y + Math.floor(i / 3) * 46;
    body += `<rect x="${x}" y="${ly - 22}" width="26" height="26" fill="${l.ink}"/>`;
    body += T(x + 38, ly, clipMono(`${String(l.label).toUpperCase()} ${l.n || ''}`.trim(), colW - 46, 22, 1), { size: 22, fill: INK, bold: true, ls: 1 });
  });
  y += Math.ceil(Math.min(6, legend.length) / 3) * 46 + 4;
  const s = 24;
  body += `<rect x="${X0}" y="${y - 20}" width="${s}" height="${s}" fill="${INK}" fill-opacity="0.85"/><circle cx="${X0 + s / 2}" cy="${y - 20 + s / 2}" r="${s * 0.24}" fill="${PAPER}" stroke="${INK}" stroke-width="2"/>`;
  body += T(X0 + 36, y, 'RACE DAY', { size: 19, fill: INK, op: L.soft, bold: true, ls: 2 });
  body += `<rect x="${X0 + 240}" y="${y - 19}" width="${s - 3}" height="${s - 3}" fill="none" stroke="${INK}" stroke-opacity="0.4" stroke-width="2"/>`;
  body += T(X0 + 276, y, 'REST', { size: 19, fill: INK, op: L.soft, bold: true, ls: 2 });
  body += `<rect x="${X0 + 420}" y="${y - 19}" width="${s - 3}" height="${s - 3}" fill="none" stroke="${INK}" stroke-opacity="0.25" stroke-width="1.5" stroke-dasharray="3 3"/>`;
  body += T(X0 + 456, y, 'STILL TO COME', { size: 19, fill: INK, op: L.soft, bold: true, ls: 2 });
  return { L, body };
}

/** @param {any} deck @param {any} card */
function races(deck, card) {
  const L = look('paper', RISO.magenta);
  let body = `<rect x="${X0 - 10}" y="452" width="${antonW('RACE DAY', 150) + 30}" height="64" fill="${RISO.yellow}" transform="rotate(-1.2 ${X0} 480)"/>`;
  body += T(X0, 520, 'RACE DAY', { size: 150, fill: INK, disp: true, ls: -1 });
  body += sub(`${card.count} races${card.quip ? ` · ${card.quip}` : ''}`, 570, L, 26, { caps: true, ls: 2 });
  const tickets = card.tickets || [];
  const th = 132, gapY = 14;
  // A short list sits in the middle of the page rather than hanging from the top.
  const blockH = tickets.length * (th + gapY) + 12 + (card.more ? 44 : 0) + (card.parkrun?.count ? 110 : 0);
  const top = 608 + Math.max(0, Math.round((1514 - 608 - blockH) / 2));
  tickets.forEach((/** @type {any} */ t, i) => {
    const y = top + i * (th + gapY);
    const stubW = 168;
    const tilt = [-0.8, 0.6, -0.4, 0.9, -0.6, 0.5][i % 6];
    const [dow, ...rest] = String(t.date).split(/\s+/);
    const dayMonth = rest.length ? rest.join(' ') : dow;
    body += `<g transform="rotate(${tilt} 540 ${y + th / 2})">
  <rect x="${X0 + 6}" y="${y + 6}" width="${CW}" height="${th}" fill="${INK}"/>
  <rect x="${X0}" y="${y}" width="${CW}" height="${th}" fill="${PAPER_4}" stroke="${INK}" stroke-width="3"/>
  <rect x="${X0}" y="${y}" width="${stubW}" height="${th}" fill="${t.ink}" stroke="${INK}" stroke-width="3"/>
  ${rest.length ? T(X0 + stubW / 2, y + 42, dow.toUpperCase(), { size: 20, fill: onInk(t.ink), bold: true, ls: 3, anchor: 'middle' }) : ''}
  ${T(X0 + stubW / 2, y + 98, dayMonth.toUpperCase(), { size: fitAnton(dayMonth.toUpperCase(), stubW - 24, 46, 26), fill: onInk(t.ink), disp: true, anchor: 'middle' })}
  <line x1="${X0 + stubW + 14}" y1="${y + 12}" x2="${X0 + stubW + 14}" y2="${y + th - 12}" stroke="${INK}" stroke-width="2" stroke-dasharray="6 6"/>`;
    const mx = X0 + stubW + 34;
    const valueSize = fitAnton(t.value, 240, 64, 36);
    const vw = antonW(t.value, valueSize) + (t.unit ? monoW(t.unit, 20) + 10 : 0);
    const titleW = X1 - 24 - vw - 26 - mx;
    const kick = clipMono(String(t.stamp).toUpperCase(), titleW - (t.pb ? 70 : 0), 21, 2);
    body += T(mx, y + 40, kick, { size: 21, fill: RISO.magenta, bold: true, ls: 2 });
    if (t.pb) {
      const px = mx + monoW(kick, 21, 2) + 14;
      body += `<rect x="${r1(px)}" y="${y + 16}" width="54" height="32" fill="${RISO.magenta}"/>${T(px + 27, y + 40, 'PB', { size: 20, fill: PAPER, bold: true, ls: 2, anchor: 'middle' })}`;
    }
    const title = String(t.title).toUpperCase();
    const size1 = fitAnton(title, titleW, 46, 34);
    if (antonW(title, size1) <= titleW) {
      body += T(mx, y + 96, title, { size: size1, fill: INK, disp: true });
    } else {
      const lines = wrap(title, Math.floor(titleW / (0.47 * 32)), 2);
      lines.forEach((l, li) => { body += T(mx, y + 80 + li * 36, l, { size: 32, fill: INK, disp: true }); });
    }
    const vx = X1 - 24;
    if (t.unit) {
      body += T(vx, y + 96, t.unit.toUpperCase(), { size: 20, fill: INK, bold: true, anchor: 'end' });
      body += T(vx - monoW(t.unit, 20) - 10, y + 96, t.value, { size: valueSize, fill: INK, disp: true, anchor: 'end' });
    } else {
      body += T(vx, y + 96, t.value, { size: valueSize, fill: INK, disp: true, anchor: 'end' });
    }
    body += '</g>';
  });
  let y = top + tickets.length * (th + gapY) + 12;
  if (card.more) {
    body += sub(`+ ${card.more} more race${card.more === 1 ? '' : 's'} in the issue`, y + 24, L, 23, { caps: true, ls: 2 });
    y += 44;
  }
  if (card.parkrun && card.parkrun.count) {
    const ph = Math.min(110, 1514 - y);
    if (ph >= 80) {
      body += `<rect x="${X0}" y="${y}" width="${CW}" height="${ph}" fill="${INK}"/>`;
      const big = `${card.parkrun.count} PARKRUNS`;
      const bs = Math.min(64, ph - 30);
      body += T(X0 + 28, y + ph / 2 + bs * 0.36, big, { size: bs, fill: RISO.yellow, disp: true });
      const right = [card.parkrun.best ? `BEST ${card.parkrun.best}` : '', card.parkrun.courses ? `${card.parkrun.courses} COURSES` : ''].filter(Boolean);
      right.forEach((r, i) => { body += T(X1 - 28, y + ph / 2 - 6 + i * 34 - (right.length - 1) * 10, r, { size: 24, fill: PAPER, bold: true, ls: 2, anchor: 'end' }); });
    }
  }
  return { L, body };
}

/** @param {any} deck @param {any} card */
function pbs(deck, card) {
  const L = look('paper', RISO.magenta);
  const total = String(card.total);
  const size = fitAnton(total, 480, 280, 150);
  let body = riso(X0, 400 + size * 0.86, total, { size, fill: INK, shadow: RISO.magenta, dx: 12, dy: 9 });
  const rx = X0 + antonW(total, size) * 1.1 + 48;
  const rw = X1 - rx;
  body += T(rx, 520, 'PERSONAL', { size: fitAnton('PERSONAL', rw, 96, 50), fill: INK, disp: true });
  body += T(rx, 620, 'BESTS', { size: fitAnton('PERSONAL', rw, 96, 50), fill: RISO.magenta, disp: true });
  const lines = [card.quip, card.bestMonth ? `${card.bestMonth} was the PB factory` : ''].filter(Boolean).join(' · ');
  body += sub(lines, 714, L, 24, { caps: true, ls: 1 });
  let y = 746;
  if (card.biggest) {
    const b = card.biggest;
    body += `<rect x="${X0}" y="${y}" width="${CW}" height="112" fill="${RISO.yellow}" transform="rotate(-0.6 540 ${y + 56})"/>`;
    body += T(X0 + 24, y + 38, `BIGGEST JUMP · ${String(b.metric).toUpperCase()}`, { size: 19, fill: INK, bold: true, ls: 3 });
    const pct = b.pct ? `+${String(b.pct).replace(/^\+/, '')}` : '';
    const pw = pct ? antonW(pct, 52) + 24 : 0;
    const what = `${b.name} ${b.from} → ${b.to}`.toUpperCase();
    body += T(X0 + 24, y + 92, clipMono(what, CW - 48 - pw, fitMono(what, CW - 48 - pw, 34, 20), 0), { size: fitMono(what, CW - 48 - pw, 34, 20), fill: INK, bold: true });
    if (pct) body += T(X1 - 24, y + 94, pct, { size: 52, fill: RISO.magenta, disp: true, anchor: 'end' });
    y += 140;
  }
  const list = card.lines || [];
  const ph = Math.min(220, Math.floor((1516 - y) / Math.max(1, list.length)));
  list.forEach((/** @type {any} */ p, i) => {
    const py = y + i * ph;
    body += `<line x1="${X0}" y1="${py}" x2="${X1}" y2="${py}" stroke="${INK}" stroke-width="2"/>`;
    const change = String(p.change);
    const cw = antonW(change, 46);
    body += T(X0, py + 52, clipMono(String(p.name).toUpperCase(), CW - cw - 30, 46), { size: fitAnton(String(p.name).toUpperCase(), CW - cw - 30, 46, 30), fill: INK, disp: true });
    body += T(X1, py + 52, change, { size: 46, fill: RISO.magenta, disp: true, anchor: 'end' });
    body += T(X0, py + 88, `${String(p.metric).toUpperCase()} · ${p.from} → ${p.to}`, { size: 24, fill: INK, op: L.soft, bold: true, ls: 1 });
    const gy = py + 106, gh = ph - 120;
    if (gh > 30 && p.w && p.h) {
      const sx = CW / p.w, sy = gh / p.h;
      body += `<line x1="${X0}" y1="${r1(gy + gh)}" x2="${X1}" y2="${r1(gy + gh)}" stroke="${INK}" stroke-opacity="0.3" stroke-width="2" stroke-dasharray="2 8" stroke-linecap="round"/>`;
      body += `<path d="${scalePath(p.d, sx, sy, X0, gy)}" fill="none" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>`;
      for (const d of p.dots || []) body += `<circle cx="${r1(X0 + d.x * sx)}" cy="${r1(gy + d.y * sy)}" r="8" fill="${RISO.magenta}" stroke="${INK}" stroke-width="2.5"/>`;
    }
  });
  return { L, body };
}

/** @param {any} deck @param {any} card */
function awards(deck, card) {
  const L = look('paper', RISO.blue);
  let body = heading('The awards', 520, L, { shadow: RISO.blue });
  body += sub('the superlatives, every one from the sessions', 568, L, 25);
  const list = card.awards || [];
  const cw = (CW - 40) / 2, ch = 430, gapY = 34;
  list.forEach((/** @type {any} */ a, i) => {
    const x = X0 + (i % 2) * (cw + 40);
    const y = 620 + Math.floor(i / 2) * (ch + gapY);
    const tilt = [-1.6, 1.2, 1.4, -1.1][i % 4];
    const inner = cw - 52;
    body += `<g transform="rotate(${tilt} ${x + cw / 2} ${y + ch / 2})">
  <rect x="${x + 10}" y="${y + 10}" width="${cw}" height="${ch}" fill="${RISO.blue}"/>
  <rect x="${x}" y="${y}" width="${cw}" height="${ch}" fill="${PAPER_4}" stroke="${INK}" stroke-width="3"/>`;
    const st = String(a.stamp).toUpperCase();
    const sw = monoW(st, 19, 2) + 26;
    body += `<g transform="rotate(-4 ${x + 26} ${y + 50})"><rect x="${x + 26}" y="${y + 30}" width="${Math.min(sw, inner)}" height="40" fill="none" stroke="${RISO.blue}" stroke-width="3"/>${T(x + 26 + Math.min(sw, inner) / 2, y + 57, clipMono(st, inner - 26, 19, 2), { size: 19, fill: RISO.blue, bold: true, ls: 2, anchor: 'middle' })}</g>`;
    const vs = fitAnton(String(a.value), inner, 108, 50);
    body += T(x + 26, y + 104 + vs * 0.86, a.value, { size: vs, fill: INK, disp: true });
    let ty = y + 104 + vs * 0.86 + 58;
    for (const l of wrap(String(a.title).toUpperCase(), Math.floor(inner / (0.47 * 40)), 2)) { body += T(x + 26, ty, l, { size: 40, fill: INK, disp: true }); ty += 44; }
    ty += 6;
    for (const l of wrap(a.sub, Math.floor(inner / (0.6 * 23)), Math.max(1, Math.floor((y + ch - 22 - ty) / 30) + 1))) { body += T(x + 26, ty, l, { size: 23, fill: INK, op: L.soft, bold: true }); ty += 30; }
    body += '</g>';
  });
  return { L, body };
}

/** @param {any} deck @param {any} card */
function next(deck, card) {
  const L = look('ink', RISO.yellow);
  let body = T(X0, 420, 'NEXT ISSUE', { size: 30, fill: RISO.yellow, bold: true, ls: 6 });
  const ny = String(card.nextYear);
  body += riso(X0 - 6, 720, ny, { size: 340, fill: PAPER, shadow: RISO.magenta, dx: 12, dy: 9 });
  const up = card.upcoming || [];
  let y = 800;
  if (up.length) {
    body += T(X0, y, 'ALREADY IN THE DIARY', { size: 24, fill: RISO.yellow, bold: true, ls: 3 });
    y += 26;
    up.forEach((/** @type {any} */ u) => {
      const ds = String(u.date).toUpperCase();
      body += `<rect x="${X0}" y="${y}" width="150" height="58" fill="${RISO.yellow}"/>`;
      body += T(X0 + 75, y + 39, ds, { size: fitMono(ds, 130, 26, 16, 1), fill: INK, bold: true, ls: 1, anchor: 'middle' });
      const t = String(u.title).toUpperCase();
      body += T(X0 + 176, y + 46, clipMono(t, CW - 176, 40), { size: fitAnton(t, CW - 176, 44, 30), fill: PAPER, disp: true });
      y += 76;
    });
  } else {
    body += T(X0, y, 'THE RACES ARE STILL BEING BOOKED', { size: 24, fill: RISO.yellow, bold: true, ls: 2 });
    y += 40;
  }
  // The link, big: the last thing on the last card.
  const top = Math.max(y + 40, 1230);
  body += `<line x1="${X0}" y1="${top}" x2="${X1}" y2="${top}" stroke="${PAPER}" stroke-width="2"/>`;
  body += T(X0, top + 52, 'READ THE WHOLE ISSUE AT', { size: 24, fill: RISO.yellow, bold: true, ls: 3 });
  const link = String(deck.link);
  const cut = link.indexOf('/');
  const parts = cut > 0 ? [link.slice(0, cut), link.slice(cut)] : [link];
  const ls = Math.min(...parts.map((p) => fitMono(p, CW, 52, 24)));
  parts.forEach((p, i) => { body += T(X0, top + 120 + i * (ls * 1.25), p, { size: ls, fill: PAPER, bold: true }); });
  body += T(X0, top + 120 + parts.length * ls * 1.25 + 14, 'every day, every race, every PB, the quiet weeks too', { size: 24, fill: PAPER, op: 0.75, bold: true });
  return { L, body };
}

const DRAW = /** @type {Record<string, (deck: any, card: any, photos: string[]) => { L: Look, body: string }>} */ ({
  cover, numbers, arc, days, races, pbs, awards, next,
});

/**
 * One story card as SVG, with its photo URLs (in `__PHOTO_<i>__` order).
 * @param {any} deck  yearDeckModel's output @param {any} card  one of deck.cards
 * @returns {{ svg: string, photos: string[] }}
 */
export function buildYearStorySVG(deck, card) {
  const draw = DRAW[card.id];
  if (!draw) throw new Error(`no drawing for card ${card.id}`);
  /** @type {string[]} */
  const photos = [];
  const { L, body } = draw(deck, card, photos);
  const blot = /** @type {Record<string, [number, number, number]>} */ ({ cover: [540, 1240, 560], next: [880, 560, 420], numbers: [980, 420, 320], pbs: [980, 900, 380], days: [980, 380, 300], races: [980, 360, 300], arc: [960, 820, 360], awards: [980, 360, 300] })[card.id];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${STORY.w} ${STORY.h}" width="${STORY.w}" height="${STORY.h}">
${ground(L, { blot })}
${body}
${head(deck, card, L)}
${band(deck, BAND.y)}
</svg>`;
  return { svg, photos };
}
