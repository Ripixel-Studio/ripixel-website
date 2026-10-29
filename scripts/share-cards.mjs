// @ts-check
/**
 * Share cards (F5.4): the drawing. Every /life activity, race weekend and roundup gets
 * cards in three shapes — Story 1080×1920, Square 1080×1080, Landscape 1200×630 (the
 * landscape card is also the page's og:image) — drawn here as SVG and rasterised by
 * tasks/fitness-og-images.mjs, which decides what goes on each card
 * (tasks/fitness-share-models.mjs) and which backgrounds each card gets.
 *
 * Two looks, one layout:
 *   photo  his photo full bleed (composited underneath by the task), an ink scrim that
 *          deepens behind the numbers, paper-coloured type, the family ink as the accent;
 *   ink    the activity family's riso ink as the ground (fitness-theme.mjs TYPE_INKS),
 *          a halftone and a wash over it, type in the family's --type-on colour.
 * Both keep the zine frame: the double rule, the registration mark, the dot cluster,
 * Anton numbers and JetBrains Mono labels (the fonts generate-og-images.mjs unpacks).
 *
 * Layout: each template stacks blocks from the bottom of the card upward, so the photo
 * shows above the numbers; Story keeps its type out of Instagram's top and bottom
 * bands. Text widths are estimated from the fonts' advances (Anton ≈ 0.47 em per
 * character, JetBrains Mono 0.6 em) and fitted, never left to overflow.
 */
import { xmlEsc } from './generate-og-images.mjs';

export const PAPER = '#F5EFDF';
export const INK = '#171311';
const MONO = "'JetBrains Mono', 'Liberation Mono', monospace";
const DISPLAY = "Anton, 'Impact', 'Liberation Sans Narrow', sans-serif";
const ANTON_EM = 0.47;
const MONO_EM = 0.6;

/**
 * @typedef {'story'|'square'|'landscape'} Shape
 * @typedef {'photo'|'ink'} Mode
 */

/** Card sizes, margins and the band the content stacks into. */
export const SHAPES = /** @type {Record<Shape, { w: number, h: number, m: number, headY: number, top: number, bottom: number, footY: number, label: string }>} */ ({
  // Instagram covers ~220 px top and ~250 px bottom of a story with its own UI.
  story: { w: 1080, h: 1920, m: 80, headY: 236, top: 330, bottom: 1664, footY: 1730, label: 'Story' },
  square: { w: 1080, h: 1080, m: 64, headY: 104, top: 170, bottom: 972, footY: 1022, label: 'Square' },
  landscape: { w: 1200, h: 630, m: 56, headY: 84, top: 128, bottom: 548, footY: 590, label: 'Landscape' },
});
export const SHAPE_ORDER = /** @type {Shape[]} */ (['story', 'square', 'landscape']);

// ---------------------------------------------------------------------------
// Colour

/** @param {string} hex */
function rgb(hex) {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}
/** Mix `hex` toward white by `t` (0..1). @param {string} hex @param {number} t */
export function lighten(hex, t) {
  return '#' + rgb(hex).map((c) => Math.round(c + (255 - c) * t).toString(16).padStart(2, '0')).join('').toUpperCase();
}

/**
 * @typedef {{ type: string, on: string, text: string, accent?: string }} Ink
 * @typedef {{ mode: Mode, bg: string, fg: string, soft: number, accent: string, fill: string, onFill: string,
 *   run: string, station: string, track: string, trackOp: number, gain: string, loss: string, dot: string, dotOp: number }} Theme
 */

/**
 * Colours for one card. Photo: paper type on the scrim, the family ink lightened for
 * text. Ink: the family ink as the ground and its --type-on colour (paper for white) for
 * everything; emphasis comes from solid boxes, not a second hue.
 * @param {Mode} mode
 * @param {Ink} ink
 * @returns {Theme}
 */
export function cardTheme(mode, ink) {
  if (mode === 'photo') {
    return {
      mode, bg: INK, fg: PAPER, soft: 0.74, accent: lighten(ink.type, 0.3), fill: ink.type, onFill: ink.on === '#FFFFFF' ? PAPER : ink.on,
      run: ink.type, station: PAPER, track: PAPER, trackOp: 0.16, gain: '#7BE3AE', loss: '#FF9A8F', dot: PAPER, dotOp: 0.09,
    };
  }
  const fg = ink.on === '#FFFFFF' ? PAPER : INK;
  return {
    mode, bg: ink.type, fg, soft: 0.76, accent: ink.accent || fg, fill: fg, onFill: ink.type,
    run: fg, station: fg, track: fg, trackOp: 0.16, gain: fg, loss: fg, dot: INK, dotOp: 0.13,
  };
}

// ---------------------------------------------------------------------------
// Text

const r1 = (/** @type {number} */ n) => Math.round(n * 10) / 10;

/** @param {unknown} s @param {number} size @param {number} [ls] */
export function monoW(s, size, ls = 0) {
  const n = [...String(s)].length;
  return n * size * MONO_EM + Math.max(0, n - 1) * ls;
}
/** @param {unknown} s @param {number} size @param {number} [ls] */
export function antonW(s, size, ls = 0) {
  const n = [...String(s)].length;
  return n * size * ANTON_EM + Math.max(0, n - 1) * ls;
}

/**
 * @param {number} x @param {number} y @param {unknown} s
 * @param {{ size: number, fill: string, disp?: boolean, bold?: boolean, anchor?: 'start'|'middle'|'end', ls?: number, op?: number }} o
 */
function T(x, y, s, o) {
  const str = String(s ?? '');
  if (!str) return '';
  return `<text x="${r1(x)}" y="${r1(y)}"${o.anchor && o.anchor !== 'start' ? ` text-anchor="${o.anchor}"` : ''} font-family="${o.disp ? DISPLAY : MONO}" font-size="${r1(o.size)}"${o.bold ? ' font-weight="700"' : ''} fill="${o.fill}"${o.op != null && o.op < 1 ? ` fill-opacity="${o.op}"` : ''}${o.ls ? ` letter-spacing="${o.ls}"` : ''}>${xmlEsc(str)}</text>`;
}

/** Cut `s` with an ellipsis until it fits `maxW` in mono at `size`. */
export function clipMono(s, maxW, size, ls = 0) {
  let str = String(s ?? '');
  if (monoW(str, size, ls) <= maxW) return str;
  while (str.length > 1 && monoW(str + '…', size, ls) > maxW) str = str.slice(0, -1);
  return str.trimEnd() + '…';
}

/** The largest Anton size ≤ max that fits `maxW` on one line (never below min). */
export function fitAnton(s, maxW, max, min) {
  let size = max;
  while (size > min && antonW(s, size) > maxW) size -= 2;
  return size;
}

/** The largest mono size ≤ max that fits `maxW` on one line (never below min). */
function fitMono(s, maxW, max, min, ls = 0) {
  let size = max;
  while (size > min && monoW(s, size, ls) > maxW) size -= 1;
  return size;
}

/** @param {string[]} words @param {number} maxChars */
function wrapWords(words, maxChars) {
  /** @type {string[]} */
  const lines = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length <= maxChars || !cur) cur = next;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}

/**
 * Fit a display title into `maxW`: the biggest size that fits on one line, else two
 * lines at up to `max2`, else cut with an ellipsis at `min`.
 * @param {string} text @param {number} maxW @param {{ max: number, min: number, max2?: number, lines?: number }} o
 * @returns {{ size: number, lines: string[] }}
 */
export function fitDisplay(text, maxW, o) {
  const words = String(text || '').toUpperCase().trim().split(/\s+/).filter(Boolean);
  if (!words.length) return { size: o.max, lines: ['ACTIVITY'] };
  const maxLines = o.lines ?? 2;
  const one = words.join(' ');
  for (let size = o.max; size >= o.min; size -= 4) {
    if (antonW(one, size) <= maxW) return { size, lines: [one] };
    if (maxLines >= 2 && size <= (o.max2 ?? o.max)) {
      const lines = wrapWords(words, Math.floor(maxW / (ANTON_EM * size)));
      if (lines.length <= maxLines && lines.every((l) => antonW(l, size) <= maxW)) return { size, lines };
    }
  }
  const size = o.min;
  const maxChars = Math.floor(maxW / (ANTON_EM * size));
  const lines = wrapWords(words, maxChars).slice(0, maxLines);
  const last = lines.length - 1;
  if (lines[last].length > maxChars - 1 || wrapWords(words, maxChars).length > maxLines) lines[last] = lines[last].slice(0, maxChars - 1).trimEnd() + '…';
  return { size, lines };
}

// ---------------------------------------------------------------------------
// Blocks: { h, draw(y) } stacked bottom-up by `stack`

/** @typedef {{ h: number, draw: (y: number) => string }} Block */

/** @param {number} h @returns {Block} */
const gap = (h) => ({ h, draw: () => '' });

/**
 * Stack blocks so the last one ends at `bottom`; returns the markup and the top edge.
 * @param {Block[]} blocks @param {number} bottom
 */
function stack(blocks, bottom) {
  const list = blocks.filter(Boolean);
  const total = list.reduce((s, b) => s + b.h, 0);
  let y = bottom - total;
  const top = y;
  const out = [];
  for (const b of list) { out.push(b.draw(y)); y += b.h; }
  return { svg: out.join('\n'), top };
}

/** Mono caps line in the accent. @param {Theme} th @param {string} text @param {number} x @param {number} maxW @param {number} size */
function kicker(th, text, x, maxW, size) {
  const ls = Math.round(size * 0.12);
  const s = clipMono(String(text || '').toUpperCase(), maxW, size, ls);
  return { h: Math.round(size * 1.7), draw: (/** @type {number} */ y) => T(x, y + size, s, { size, fill: th.accent, bold: true, ls }) };
}

/** Mono line in the soft foreground. @param {Theme} th @param {string} text @param {number} x @param {number} maxW @param {number} size */
function line(th, text, x, maxW, size, opts = {}) {
  const ls = opts.ls ?? Math.round(size * 0.08);
  const s = clipMono(String(text || '').toUpperCase(), maxW, size, ls);
  return { h: Math.round(size * 1.6), draw: (/** @type {number} */ y) => T(opts.anchor === 'end' ? x + maxW : x, y + size, s, { size, fill: th.fg, op: th.soft, bold: !!opts.bold, ls, anchor: opts.anchor }) };
}

/** The display title. @param {Theme} th @param {string} text @param {number} x @param {number} maxW @param {{ max: number, min: number, max2?: number, lines?: number }} fit */
function title(th, text, x, maxW, fit) {
  const { size, lines } = fitDisplay(text, maxW, fit);
  const lh = Math.round(size * 1.0);
  return {
    h: lh * lines.length + Math.round(size * 0.1),
    draw: (/** @type {number} */ y) => lines.map((l, i) => T(x, y + lh * (i + 1) - Math.round(size * 0.08), l, { size, fill: th.fg, disp: true, ls: -1 })).join(''),
  };
}

/** @param {Theme} th @param {number} x @param {number} w @param {number} [h] */
function rule(th, x, w, h = 28) {
  return { h, draw: (/** @type {number} */ y) => `<line x1="${x}" y1="${y + h / 2}" x2="${x + w}" y2="${y + h / 2}" stroke="${th.accent}" stroke-width="3"/>` };
}

/**
 * A row of stat cells: Anton number + mono unit, mono caps label under it.
 * @param {Theme} th @param {{ value: string, unit?: string, label: string }[]} stats
 * @param {number} x @param {number} w @param {{ cols?: number, size: number, label: number, rows?: number }} o
 */
function statGrid(th, stats, x, w, o) {
  const list = stats.filter((s) => s && s.value && s.value !== '—');
  if (!list.length) return gap(0);
  const cols = Math.min(o.cols ?? list.length, list.length);
  const rows = Math.min(o.rows ?? Math.ceil(list.length / cols), Math.ceil(list.length / cols));
  const cellW = w / cols;
  const rowH = Math.round(o.size * 1.02 + o.label * 2.1);
  const shown = list.slice(0, cols * rows);
  return {
    h: rowH * rows,
    draw: (y) => shown.map((s, i) => {
      const cx = x + (i % cols) * cellW;
      const cy = y + Math.floor(i / cols) * rowH;
      const unitSize = Math.round(o.size * 0.3);
      const unitW = s.unit ? monoW(s.unit, unitSize) + 8 : 0;
      const size = fitAnton(s.value, cellW - 16 - unitW, o.size, Math.round(o.size * 0.5));
      const vw = antonW(s.value, size);
      const unit = s.unit ? T(cx + vw + 8, cy + size * 0.98, s.unit, { size: unitSize, fill: th.accent, bold: true }) : '';
      const lab = clipMono(String(s.label || '').toUpperCase(), cellW - 12, o.label, 2);
      return T(cx, cy + size * 0.98, s.value, { size, fill: th.fg, disp: true, ls: -1 }) + unit
        + T(cx, cy + size * 0.98 + o.label * 1.6, lab, { size: o.label, fill: th.fg, op: th.soft, bold: true, ls: 2 });
    }).join(''),
  };
}

/**
 * A stamp: an outlined (or solid) mono-caps box. Returns markup and width.
 * @param {Theme} th @param {string} text @param {number} x @param {number} y top edge @param {number} size
 * @param {{ solid?: boolean, tone?: 'gain'|'loss'|'', anchor?: 'start'|'end', maxW?: number }} [o]
 */
function stamp(th, text, x, y, size, o = {}) {
  const ls = Math.round(size * 0.12);
  const s = clipMono(String(text || '').toUpperCase(), (o.maxW ?? 2000) - size * 1.4, size, ls);
  const w = Math.round(monoW(s, size, ls) + size * 1.4);
  const h = Math.round(size * 1.9);
  const left = o.anchor === 'end' ? x - w : x;
  const col = o.tone === 'gain' ? th.gain : o.tone === 'loss' ? th.loss : th.accent;
  const box = o.solid
    ? `<rect x="${left}" y="${y}" width="${w}" height="${h}" fill="${th.mode === 'photo' ? th.fill : th.fg}"/>`
    : `<rect x="${left + 1.5}" y="${y + 1.5}" width="${w - 3}" height="${h - 3}" fill="none" stroke="${col}" stroke-width="3"/>`;
  const fill = o.solid ? (th.mode === 'photo' ? th.onFill : th.bg) : col;
  return { svg: box + T(left + w / 2, y + h / 2 + size * 0.36, s, { size, fill, bold: true, ls, anchor: 'middle' }), w, h };
}

// ---------------------------------------------------------------------------
// Charts

/** Hyrox station names that fit a row label. */
const ROW_LABEL = /** @type {Record<string, string>} */ ({
  skierg: 'SKIERG', sled_push: 'SLED PUSH', sled_pull: 'SLED PULL', burpee_broad_jump: 'BURPEES', rowing: 'ROW',
  farmers_carry: 'FARMERS', sandbag_lunges: 'LUNGES', wall_balls: 'WALL BALLS',
});

/** Short Hyrox segment names for the column chart. */
const SHORT = /** @type {Record<string, string>} */ ({
  skierg: 'SKI', sled_push: 'PUSH', sled_pull: 'PULL', burpee_broad_jump: 'BBJ', rowing: 'ROW',
  farmers_carry: 'FARM', sandbag_lunges: 'LUNGE', wall_balls: 'WALL',
});
/** @param {{ key: string, label: string }} r */
export function shortSegment(r) {
  const run = /^run_(\d+)$/.exec(r.key);
  if (run) return `R${run[1]}`;
  return SHORT[r.key] || String(r.label || r.key).slice(0, 5).toUpperCase();
}

/**
 * Hyrox splits as rows (Story): label, bar, time, avg HR, delta vs PB.
 * @param {Theme} th @param {any[]} rows  model.rows @param {number} x @param {number} w @param {number} rowH
 */
function hyroxRows(th, rows, x, w, rowH) {
  const max = Math.max(1, ...rows.map((r) => r.seconds));
  const size = Math.round(rowH * 0.5);
  const labelW = monoW('WALL BALLS', size) + 18;
  const hasHr = rows.some((r) => r.avgHr);
  const hasDelta = rows.some((r) => r.delta);
  const timeW = monoW('10:00', size) + 16;
  const hrW = hasHr ? monoW('188♥', size * 0.86) + 18 : 0;
  const deltaW = hasDelta ? monoW('+0:00', size * 0.86) + 8 : 0;
  const barX = x + labelW;
  const barW = w - labelW - timeW - hrW - deltaW;
  return {
    h: rowH * rows.length,
    draw: (y) => rows.map((r, i) => {
      const cy = y + i * rowH;
      const bw = Math.max(6, (r.seconds / max) * barW);
      const bh = Math.round(rowH * 0.62);
      const by = cy + (rowH - bh) / 2;
      const col = r.isRun ? th.run : th.station;
      const op = r.isRun ? 1 : th.mode === 'photo' ? 0.88 : 0.5;
      const label = r.isRun ? r.label.toUpperCase() : clipMono(ROW_LABEL[r.key] || String(r.label).toUpperCase(), labelW - 14, size);
      let out = T(x, cy + rowH / 2 + size * 0.36, label, { size, fill: th.fg, op: r.isRun ? th.soft : 1, bold: !r.isRun });
      out += `<rect x="${r1(barX)}" y="${r1(by)}" width="${r1(barW)}" height="${bh}" fill="${th.track}" fill-opacity="${th.trackOp}"/>`;
      out += `<rect x="${r1(barX)}" y="${r1(by)}" width="${r1(bw)}" height="${bh}" fill="${col}" fill-opacity="${op}"/>`;
      if (r.isPB) out += T(barX + bw - 10, by + bh / 2 + size * 0.3, 'PB', { size: size * 0.8, fill: th.mode === 'photo' ? (r.isRun ? th.onFill : INK) : th.bg, bold: true, anchor: 'end' });
      const tx = barX + barW + timeW;
      out += T(tx, cy + rowH / 2 + size * 0.36, r.duration, { size, fill: th.fg, bold: true, anchor: 'end' });
      if (hasHr && r.avgHr) out += T(tx + hrW, cy + rowH / 2 + size * 0.32, `${r.avgHr}♥`, { size: size * 0.86, fill: th.fg, op: th.soft, anchor: 'end' });
      if (hasDelta && r.delta) {
        const tone = r.deltaTone === 'gain' ? th.gain : r.deltaTone === 'loss' ? th.loss : th.fg;
        out += T(x + w, cy + rowH / 2 + size * 0.32, r.delta, { size: size * 0.86, fill: tone, bold: true, anchor: 'end' });
      }
      return out;
    }).join(''),
  };
}

/**
 * Hyrox splits as interleaved columns (Square, Landscape): runs in the family ink,
 * stations in the foreground, avg HR as a line of dots over them with its range.
 * @param {Theme} th @param {any[]} rows @param {number} x @param {number} w @param {number} h
 */
function hyroxCols(th, rows, x, w, h) {
  const max = Math.max(1, ...rows.map((r) => r.seconds));
  const n = rows.length;
  const slot = w / n;
  const bw = slot * 0.7;
  const labelSize = Math.max(11, Math.min(18, Math.floor((slot - 2) / (MONO_EM * 5))));
  const labelH = labelSize * 2;
  const chartH = h - labelH - 8;
  const hrs = rows.map((r) => r.avgHr).filter(Boolean);
  const hrMin = hrs.length ? Math.min(...hrs) - 6 : 0;
  const hrMax = hrs.length ? Math.max(...hrs) + 2 : 1;
  return {
    h,
    draw: (y) => {
      let out = '';
      /** @type {string[]} */
      const pts = [];
      rows.forEach((r, i) => {
        const cx = x + i * slot + (slot - bw) / 2;
        const bh = Math.max(4, (r.seconds / max) * (chartH * 0.72));
        const by = y + chartH - bh;
        const col = r.isRun ? th.run : th.station;
        const op = r.isRun ? 1 : th.mode === 'photo' ? 0.88 : 0.5;
        out += `<rect x="${r1(cx)}" y="${r1(by)}" width="${r1(bw)}" height="${r1(bh)}" fill="${col}" fill-opacity="${op}"/>`;
        if (r.isPB) out += T(cx + bw / 2, by - 8, 'PB', { size: labelSize, fill: th.accent, bold: true, anchor: 'middle' });
        out += T(cx + bw / 2, y + chartH + labelSize + 6, shortSegment(r), { size: labelSize, fill: th.fg, op: r.isRun ? th.soft : 1, bold: !r.isRun, anchor: 'middle' });
        out += T(cx + bw / 2, y + chartH + labelSize * 2 + 8, r.duration, { size: labelSize * 0.82, fill: th.fg, op: th.soft, anchor: 'middle' });
        if (r.avgHr) {
          const hy = y + (1 - (r.avgHr - hrMin) / (hrMax - hrMin || 1)) * (chartH * 0.2) + 6;
          pts.push(`${r1(cx + bw / 2)},${r1(hy)}`);
        }
      });
      if (pts.length > 1) {
        out += `<polyline points="${pts.join(' ')}" fill="none" stroke="${th.fg}" stroke-width="3" stroke-linejoin="round"/>`;
        out += pts.map((p) => { const [px, py] = p.split(','); return `<circle cx="${px}" cy="${py}" r="5" fill="${th.mode === 'photo' ? th.accent : th.bg}" stroke="${th.fg}" stroke-width="2"/>`; }).join('');
        out += T(x + w, y - 6, `AVG HR ${Math.min(...hrs)}–${Math.max(...hrs)} BPM`, { size: labelSize, fill: th.fg, op: th.soft, bold: true, anchor: 'end', ls: 1 });
      }
      return out;
    },
  };
}

/**
 * Km splits as columns: taller is faster, the fastest km in the accent, pace under each
 * (every Nth label when there are many).
 * @param {Theme} th @param {{ km: number, seconds: number, pace: string, partial?: boolean }[]} splits
 * @param {number} x @param {number} w @param {number} h
 */
function splitCols(th, splits, x, w, h) {
  const n = splits.length;
  const slot = w / n;
  const bw = Math.max(3, slot * 0.72);
  const fastest = Math.min(...splits.map((s) => s.seconds));
  const slowest = Math.max(...splits.map((s) => s.seconds));
  const labelSize = Math.max(12, Math.min(20, Math.floor((slot - 4) / (MONO_EM * 4.4))));
  const every = Math.max(1, Math.ceil((MONO_EM * labelSize * 5) / slot));
  const chartH = h - labelSize * 2.6;
  return {
    h,
    draw: (y) => splits.map((s, i) => {
      const t = slowest > fastest ? (slowest - s.seconds) / (slowest - fastest) : 1;
      const bh = chartH * (0.35 + 0.65 * t);
      const cx = x + i * slot + (slot - bw) / 2;
      const best = s.seconds === fastest;
      let out = `<rect x="${r1(cx)}" y="${r1(y + chartH - bh)}" width="${r1(bw)}" height="${r1(bh)}" fill="${best ? th.run : th.station}" fill-opacity="${best ? 1 : th.mode === 'photo' ? 0.8 : 0.5}"/>`;
      if (i % every === 0 || best) {
        out += T(cx + bw / 2, y + chartH + labelSize + 4, s.pace, { size: labelSize, fill: th.fg, bold: best, op: best ? 1 : th.soft, anchor: 'middle' });
        out += T(cx + bw / 2, y + chartH + labelSize * 2.2 + 4, `KM ${s.km}`, { size: labelSize * 0.75, fill: th.fg, op: th.soft, anchor: 'middle' });
      }
      return out;
    }).join(''),
  };
}

/**
 * A route fitted into a box. `points` are [lat, lng].
 * @param {Theme} th @param {Array<[number, number]>} points @param {number} x @param {number} y @param {number} w @param {number} h
 * @param {number} [stroke]
 */
export function routeSvg(th, points, x, y, w, h, stroke = 8) {
  const pts = (points || []).filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]) && (p[0] !== 0 || p[1] !== 0));
  if (pts.length < 2) return '';
  const lats = pts.map((p) => p[0]);
  const lngs = pts.map((p) => p[1]);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats), minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const k = Math.cos(((minLat + maxLat) / 2) * (Math.PI / 180)) || 1;
  const spanX = (maxLng - minLng) * k || 1e-9;
  const spanY = maxLat - minLat || 1e-9;
  const scale = Math.min(w / spanX, h / spanY);
  const ox = x + (w - spanX * scale) / 2;
  const oy = y + (h - spanY * scale) / 2;
  const xy = pts.map((p) => [r1(ox + (p[1] - minLng) * k * scale), r1(oy + (maxLat - p[0]) * scale)]);
  const d = xy.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join(' ');
  const [sx, sy] = xy[0];
  const [ex, ey] = xy[xy.length - 1];
  const shadow = th.mode === 'photo' ? INK : th.bg;
  return `<path d="${d}" fill="none" stroke="${shadow}" stroke-opacity="0.5" stroke-width="${stroke + 8}" stroke-linejoin="round" stroke-linecap="round"/>`
    + `<path d="${d}" fill="none" stroke="${th.mode === 'photo' ? th.accent : th.fg}" stroke-width="${stroke}" stroke-linejoin="round" stroke-linecap="round"/>`
    + `<circle cx="${sx}" cy="${sy}" r="${stroke * 1.4}" fill="${th.fg}" stroke="${shadow}" stroke-width="3"/>`
    + `<rect x="${ex - stroke * 1.3}" y="${ey - stroke * 1.3}" width="${stroke * 2.6}" height="${stroke * 2.6}" fill="${shadow}" stroke="${th.fg}" stroke-width="3"/>`;
}

/**
 * A line chart of one series (HR) fitted into a band, with its min → max.
 * @param {Theme} th @param {number[]} values @param {number} x @param {number} w @param {number} h @param {string} label
 */
function sparkBlock(th, values, x, w, h, label) {
  const v = values.filter((n) => typeof n === 'number' && Number.isFinite(n) && n > 0);
  if (v.length < 4) return gap(0);
  const step = Math.max(1, Math.floor(v.length / 120));
  const pts = v.filter((_, i) => i % step === 0);
  const min = Math.min(...pts), max = Math.max(...pts);
  const labelSize = Math.max(14, Math.round(h * 0.13));
  const chartH = h - labelSize * 1.8;
  return {
    h,
    draw: (y) => {
      const xy = pts.map((n, i) => [r1(x + (i / (pts.length - 1)) * w), r1(y + labelSize * 1.8 + (1 - (n - min) / (max - min || 1)) * chartH)]);
      const d = xy.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join(' ');
      return T(x, y + labelSize, label, { size: labelSize, fill: th.fg, op: th.soft, bold: true, ls: 2 })
        + T(x + w, y + labelSize, `${Math.round(min)} → ${Math.round(max)}`, { size: labelSize, fill: th.accent, bold: true, anchor: 'end' })
        + `<path d="${d} L${x + w},${y + h} L${x},${y + h} Z" fill="${th.mode === 'photo' ? th.fill : th.fg}" fill-opacity="${th.mode === 'photo' ? 0.35 : 0.18}"/>`
        + `<path d="${d}" fill="none" stroke="${th.mode === 'photo' ? th.accent : th.fg}" stroke-width="4" stroke-linejoin="round"/>`;
    },
  };
}

/**
 * Sport donut: one arc per family in its ink, the session count in the middle.
 * @param {Theme} th @param {{ label: string, count: number, ink: string }[]} slices @param {number} cx @param {number} cy @param {number} r @param {number} total
 */
function donut(th, slices, cx, cy, r, total) {
  const sw = r * 0.34;
  const sum = slices.reduce((s, x) => s + x.count, 0) || 1;
  let a = -Math.PI / 2;
  let out = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${th.track}" stroke-opacity="${th.trackOp}" stroke-width="${sw}"/>`;
  for (const s of slices) {
    const da = (s.count / sum) * Math.PI * 2;
    if (da >= Math.PI * 2 - 1e-6) {
      out += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${s.ink}" stroke-width="${sw}"/>`;
    } else {
      const x1 = cx + r * Math.cos(a), y1 = cy + r * Math.sin(a);
      const x2 = cx + r * Math.cos(a + da), y2 = cy + r * Math.sin(a + da);
      out += `<path d="M${r1(x1)},${r1(y1)} A${r},${r} 0 ${da > Math.PI ? 1 : 0} 1 ${r1(x2)},${r1(y2)}" fill="none" stroke="${s.ink}" stroke-width="${sw}"/>`;
    }
    // A thin gap in the ground colour between slices.
    out += `<line x1="${r1(cx + (r - sw / 2) * Math.cos(a))}" y1="${r1(cy + (r - sw / 2) * Math.sin(a))}" x2="${r1(cx + (r + sw / 2) * Math.cos(a))}" y2="${r1(cy + (r + sw / 2) * Math.sin(a))}" stroke="${th.mode === 'photo' ? INK : th.bg}" stroke-width="4"/>`;
    a += da;
  }
  const n = String(total);
  out += T(cx, cy + r * 0.2, n, { size: fitAnton(n, r * 1.1, r * 0.62, 20), fill: th.fg, disp: true, anchor: 'middle' });
  out += T(cx, cy + r * 0.42, 'SESSIONS', { size: Math.max(12, r * 0.13), fill: th.fg, op: th.soft, bold: true, anchor: 'middle', ls: 2 });
  return out;
}

/**
 * Donut + legend side by side.
 * @param {Theme} th @param {any} model @param {number} x @param {number} w @param {number} h @param {number} maxRows
 */
function donutBlock(th, model, x, w, h, maxRows) {
  const slices = model.sports || [];
  if (!slices.length) return gap(0);
  const r = Math.min(h / 2 - 10, w * 0.2);
  const legendX = x + r * 2 + 60;
  const legendW = x + w - legendX;
  const rows = slices.slice(0, maxRows);
  const rowH = Math.min(56, (h - 10) / rows.length);
  const longest = rows.reduce((a, s) => (s.label.length > a.length ? s.label : a), '').toUpperCase();
  const size = Math.max(12, Math.min(Math.round(rowH * 0.48), fitMono(longest, legendW - rowH * 2.6, 40, 10, 1)));
  return {
    h,
    draw: (y) => {
      let out = donut(th, slices, x + r + 10, y + h / 2, r, model.sessions);
      const top = y + (h - rowH * rows.length) / 2;
      rows.forEach((s, i) => {
        const cy = top + i * rowH + rowH / 2;
        out += `<rect x="${legendX}" y="${r1(cy - size * 0.55)}" width="${size * 1.1}" height="${size * 1.1}" fill="${s.ink}" stroke="${th.fg}" stroke-width="2"/>`;
        out += T(legendX + size * 1.8, cy + size * 0.36, clipMono(s.label.toUpperCase(), legendW - size * 5, size, 1), { size, fill: th.fg, bold: true, ls: 1 });
        out += T(x + w, cy + size * 0.36, String(s.count), { size: size * 1.3, fill: th.fg, disp: true, anchor: 'end' });
      });
      return out;
    },
  };
}

/**
 * Calendar heatmap: a week as seven bars, a month or year as a Monday-first grid; effort
 * 0–4 as the ink's opacity.
 * @param {Theme} th @param {{ type: string, days: { level: number, dow: number, label?: string, month?: number }[] }} cal
 * @param {number} x @param {number} w @param {number} h
 */
function heatmap(th, cal, x, w, h) {
  const days = cal?.days || [];
  if (!days.length) return gap(0);
  const fill = th.mode === 'photo' ? th.fill : th.fg;
  const ops = [0, 0.35, 0.58, 0.8, 1];
  const cellRect = (/** @type {number} */ cx, /** @type {number} */ cy, /** @type {number} */ s, /** @type {number} */ sh, /** @type {number} */ lvl) => lvl > 0
    ? `<rect x="${r1(cx)}" y="${r1(cy)}" width="${r1(s)}" height="${r1(sh)}" fill="${fill}" fill-opacity="${ops[lvl]}"/>`
    : `<rect x="${r1(cx + 1)}" y="${r1(cy + 1)}" width="${r1(s - 2)}" height="${r1(sh - 2)}" fill="none" stroke="${th.track}" stroke-opacity="${th.trackOp * 2.2}" stroke-width="2"/>`;
  if (cal.type === 'week') {
    const slot = w / days.length;
    const bw = slot * 0.74;
    const labelSize = Math.max(12, Math.min(24, Math.round(slot * 0.16), Math.round(h * 0.2)));
    const chartH = h - labelSize * 1.8;
    return {
      h,
      draw: (y) => days.map((d, i) => {
        const bh = d.level ? chartH * (0.25 + 0.75 * (d.level / 4)) : chartH * 0.12;
        const cx = x + i * slot + (slot - bw) / 2;
        return cellRect(cx, y + chartH - bh, bw, bh, d.level) + T(cx + bw / 2, y + h - 4, d.label || '', { size: labelSize, fill: th.fg, op: d.level ? 1 : th.soft, bold: !!d.level, anchor: 'middle' });
      }).join(''),
    };
  }
  const cols = Math.max(1, ...days.map((d) => d.col ?? 0)) + 1;
  const labelH = cal.type === 'year' ? 22 : 0;
  const cell = Math.min((w - 4) / cols, (h - labelH) / 7);
  const g = cell * (cal.type === 'year' ? 0.18 : 0.14);
  const gridW = cols * cell;
  const ox = x + (w - gridW) / 2;
  return {
    h: Math.round(cell * 7 + labelH),
    draw: (y) => {
      let out = '';
      if (cal.type === 'year') {
        for (const m of cal.months || []) out += T(ox + m.col * cell, y + 14, m.label, { size: 14, fill: th.fg, op: th.soft, bold: true });
      }
      for (const d of days) out += cellRect(ox + (d.col ?? 0) * cell, y + labelH + d.dow * cell, cell - g, cell - g, d.level);
      return out;
    },
  };
}

/**
 * Personal records as a wall of boxes: name, metric, value, delta.
 * @param {Theme} th @param {{ name: string, metric: string, value: string, unit: string, delta: string }[]} prs
 * @param {number} x @param {number} w @param {{ cols: number, rows: number, size: number }} o
 */
function prWall(th, prs, x, w, o) {
  const list = (prs || []).slice(0, o.cols * o.rows);
  if (!list.length) return gap(0);
  const rows = Math.ceil(list.length / o.cols);
  const g = 14;
  const cw = (w - g * (o.cols - 1)) / o.cols;
  const ch = Math.round(o.size * 4.3);
  return {
    h: rows * ch + (rows - 1) * g,
    draw: (y) => list.map((p, i) => {
      const cx = x + (i % o.cols) * (cw + g);
      const cy = y + Math.floor(i / o.cols) * (ch + g);
      const pad = o.size * 0.6;
      const vs = fitAnton(p.value, cw * 0.5, o.size * 1.6, o.size * 0.8);
      let out = `<rect x="${r1(cx + 1.5)}" y="${r1(cy + 1.5)}" width="${r1(cw - 3)}" height="${ch - 3}" fill="${th.mode === 'photo' ? INK : th.fg}" fill-opacity="${th.mode === 'photo' ? 0.35 : 0.08}" stroke="${th.accent}" stroke-width="3"/>`;
      out += T(cx + pad, cy + pad + o.size * 0.8, clipMono(p.name.toUpperCase(), cw - pad * 2, o.size * 0.8, 1), { size: o.size * 0.8, fill: th.fg, bold: true, ls: 1 });
      out += T(cx + pad, cy + pad + o.size * 1.75, clipMono(p.metric.toUpperCase(), cw - pad * 2, o.size * 0.62, 1), { size: o.size * 0.62, fill: th.fg, op: th.soft, bold: true, ls: 1 });
      const vx = cx + cw - pad - (p.unit ? monoW(p.unit, o.size * 0.6) + 6 : 0);
      out += T(vx, cy + ch - pad, p.value, { size: vs, fill: th.fg, disp: true, anchor: 'end' });
      if (p.unit) out += T(cx + cw - pad, cy + ch - pad, p.unit, { size: o.size * 0.6, fill: th.accent, bold: true, anchor: 'end' });
      if (p.delta) out += T(cx + pad, cy + ch - pad, p.delta, { size: o.size * 0.7, fill: th.gain, bold: true });
      return out;
    }).join(''),
  };
}

/**
 * Lines of "name ......... value" (top sets, the event's races).
 * @param {Theme} th @param {{ name: string, value: string, tag?: string }[]} items @param {number} x @param {number} w @param {number} rowH
 */
function listRows(th, items, x, w, rowH) {
  const size = Math.round(rowH * 0.48);
  return {
    h: rowH * items.length,
    draw: (y) => items.map((it, i) => {
      const cy = y + i * rowH + rowH / 2 + size * 0.36;
      const vw = monoW(it.value, size) + 12;
      const tag = it.tag ? stamp(th, it.tag, x + w - vw - 10, y + i * rowH + (rowH - size * 1.5) / 2, size * 0.78, { solid: true, anchor: 'end' }) : null;
      const nameW = w - vw - (tag ? tag.w + 24 : 12);
      let out = T(x, cy, clipMono(it.name.toUpperCase(), nameW, size, 1), { size, fill: th.fg, bold: true, ls: 1 });
      out += `<line x1="${x}" y1="${y + (i + 1) * rowH - 2}" x2="${x + w}" y2="${y + (i + 1) * rowH - 2}" stroke="${th.fg}" stroke-opacity="${th.trackOp * 1.6}" stroke-width="2" stroke-dasharray="2 6"/>`;
      if (tag) out += tag.svg;
      out += T(x + w, cy, it.value, { size, fill: th.accent, bold: true, anchor: 'end' });
      return out;
    }).join(''),
  };
}

/** Small mono header over a chart: "· KM SPLITS ·" left, an optional note right. */
function sectionHead(th, text, x, w, size, right = '') {
  return {
    h: Math.round(size * 2),
    draw: (/** @type {number} */ y) => T(x, y + size, `· ${String(text).toUpperCase()} ·`, { size, fill: th.accent, bold: true, ls: 2 })
      + (right ? T(x + w, y + size, clipMono(String(right).toUpperCase(), w * 0.6, size, 1), { size, fill: th.fg, op: th.soft, bold: true, anchor: 'end', ls: 1 }) : ''),
  };
}

/** The PB stamp or the gap to the PB, as a block. @param {Theme} th @param {any} badge @param {number} x @param {number} size @param {number} maxW */
function badgeBlock(th, badge, x, size, maxW) {
  if (!badge?.text) return gap(0);
  const s = stamp(th, badge.text, x, 0, size, { solid: badge.kind === 'pb' || badge.kind === 'first', tone: badge.kind === 'gap' ? badge.tone : '', maxW });
  return { h: s.h + 14, draw: (y) => stamp(th, badge.text, x, y, size, { solid: badge.kind === 'pb' || badge.kind === 'first', tone: badge.kind === 'gap' ? badge.tone : '', maxW }).svg };
}

/** Delta chips "SESSIONS +14%" in a row. @param {Theme} th @param {{ label: string, value: string, dir: string }[]} deltas @param {string} vs @param {number} x @param {number} w @param {number} size */
function deltaRow(th, deltas, vs, x, w, size) {
  if (!deltas?.length) return gap(0);
  return {
    h: Math.round(size * 4.4),
    draw: (y) => {
      let out = T(x, y + size, `VS ${String(vs).toUpperCase()}`, { size, fill: th.fg, op: th.soft, bold: true, ls: 2 });
      let cx = x;
      for (const d of deltas) {
        const text = `${d.label} ${d.value}`;
        const s = stamp(th, text, cx, y + size * 1.7, size, { tone: d.dir === 'up' ? 'gain' : d.dir === 'down' ? 'loss' : '' });
        if (cx + s.w > x + w) break;
        out += s.svg;
        cx += s.w + 12;
      }
      return out;
    },
  };
}

// ---------------------------------------------------------------------------
// Frame

/**
 * Ground, scrim and the zine frame for one card.
 * @param {Shape} shape @param {Theme} th @param {{ pill: string, right: string, scrimFrom: number }} o
 */
function frame(shape, th, o) {
  const S = SHAPES[shape];
  const { w, h, m } = S;
  const k = w / 1200;
  const pillSize = Math.round(shape === 'landscape' ? 15 : 24);
  const ground = th.mode === 'photo'
    ? `<defs>
    <linearGradient id="scrim" x1="0" y1="0" x2="0" y2="${h}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${INK}" stop-opacity="0.62"/>
      <stop offset="${r1((S.headY + 60) / h * 100) / 100}" stop-color="${INK}" stop-opacity="${o.scrimFrom < h * 0.4 ? 0.5 : 0.14}"/>
      <stop offset="${Math.max(r1((S.headY + 61) / h * 100) / 100, r1((o.scrimFrom - h * 0.1) / h * 100) / 100)}" stop-color="${INK}" stop-opacity="${o.scrimFrom < h * 0.4 ? 0.62 : 0.14}"/>
      <stop offset="${Math.max(r1((S.headY + 62) / h * 100) / 100, r1((o.scrimFrom + h * 0.02) / h * 100) / 100)}" stop-color="${INK}" stop-opacity="0.82"/>
      <stop offset="1" stop-color="${INK}" stop-opacity="0.92"/>
    </linearGradient>
    ${shape === 'landscape' ? `<linearGradient id="side" x1="0" y1="0" x2="${w}" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${INK}" stop-opacity="0.7"/><stop offset="0.6" stop-color="${INK}" stop-opacity="0.35"/><stop offset="1" stop-color="${INK}" stop-opacity="0"/></linearGradient>` : ''}
    <pattern id="dots" width="${Math.round(9 * k * 1.2)}" height="${Math.round(9 * k * 1.2)}" patternUnits="userSpaceOnUse"><circle cx="4" cy="4" r="1.4" fill="${th.dot}" fill-opacity="${th.dotOp}"/></pattern>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#scrim)"/>
  ${shape === 'landscape' ? `<rect width="${w}" height="${h}" fill="url(#side)"/>` : ''}
  <rect width="${w}" height="${h}" fill="url(#dots)"/>`
    : `<defs>
    <pattern id="dots" width="10" height="10" patternUnits="userSpaceOnUse"><circle cx="5" cy="5" r="1.6" fill="${th.dot}" fill-opacity="${th.dotOp}"/></pattern>
    <radialGradient id="wash1" cx="${w}" cy="0" r="${w * 0.8}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#FFFFFF" stop-opacity="0.32"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/></radialGradient>
    <radialGradient id="wash2" cx="0" cy="${h}" r="${w * 0.7}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${INK}" stop-opacity="0.2"/><stop offset="1" stop-color="${INK}" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="${th.bg}"/>
  <rect width="${w}" height="${h}" fill="url(#dots)"/>
  <rect width="${w}" height="${h}" fill="url(#wash1)"/>
  <rect width="${w}" height="${h}" fill="url(#wash2)"/>`;
  const b1 = Math.round(14 * k * (shape === 'landscape' ? 1 : 1.6));
  const b2 = b1 + Math.round(6 * (shape === 'landscape' ? 1 : 1.4));
  const reg = Math.round((shape === 'landscape' ? 13 : 20));
  const regX = b2 + reg + 14;
  const pill = stamp(th, o.pill, m, S.headY - pillSize * 1.45, pillSize, { solid: true });
  const byline = shape === 'landscape' ? 26 : 40;
  const right = o.right ? T(w - m, S.headY + (shape === 'landscape' ? 34 : 52), clipMono(o.right.toUpperCase(), w - m * 2, pillSize * 0.85, 2), { size: pillSize * 0.85, fill: th.fg, op: th.soft, bold: true, anchor: 'end', ls: 2 }) : '';
  const foot = shape === 'landscape' ? 16 : 24;
  return {
    under: `${ground}
  <rect x="${b1}" y="${b1}" width="${w - b1 * 2}" height="${h - b1 * 2}" fill="none" stroke="${th.fg}" stroke-width="3"/>
  <rect x="${b2}" y="${b2}" width="${w - b2 * 2}" height="${h - b2 * 2}" fill="none" stroke="${th.fg}" stroke-width="1.2"/>
  <circle cx="${regX}" cy="${regX}" r="${reg}" fill="none" stroke="${th.accent}" stroke-width="2.5"/>
  <line x1="${regX - reg - 6}" y1="${regX}" x2="${regX + reg + 6}" y2="${regX}" stroke="${th.accent}" stroke-width="2.5"/>
  <line x1="${regX}" y1="${regX - reg - 6}" x2="${regX}" y2="${regX + reg + 6}" stroke="${th.accent}" stroke-width="2.5"/>`,
    over: `${pill.svg}
  ${T(w - m - 70 * (byline / 26), S.headY - 4, 'JAMES KING', { size: byline, fill: th.fg, disp: true, anchor: 'end', ls: 1, op: 0.9 })}
  <circle cx="${w - m - 8}" cy="${S.headY - byline * 0.38}" r="${byline * 0.27}" fill="${th.accent}"/>
  <circle cx="${w - m - 8 - byline * 0.75}" cy="${S.headY - byline * 0.38}" r="${byline * 0.27}" fill="${th.accent}" fill-opacity="0.5"/>
  <circle cx="${w - m - 8 - byline * 1.5}" cy="${S.headY - byline * 0.38}" r="${byline * 0.27}" fill="${th.accent}" fill-opacity="0.25"/>
  ${right}
  ${T(m, S.footY, 'james.ripixel.co.uk/life', { size: foot, fill: th.fg, op: 0.8, bold: true })}
  ${T(w - m, S.footY, '— a zine, by james king', { size: foot * 0.85, fill: th.fg, op: 0.6, anchor: 'end' })}`,
  };
}

/** @param {Shape} shape @param {string} body */
function svgDoc(shape, body) {
  const { w, h } = SHAPES[shape];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">\n${body}\n</svg>`;
}

// ---------------------------------------------------------------------------
// Templates

/**
 * @typedef {{ value: string, unit?: string, label: string }} Stat
 * @typedef {{ kind: 'pb'|'first'|'gap'|'sim'|'', text: string, tone?: 'gain'|'loss'|'' }} Badge
 */

/** The big number with its badge and lines beside it (race total, event row) — or under it when the side is too narrow. */
function headline(th, x, w, o) {
  const size = fitAnton(o.value, o.valueW ?? w * 0.6, o.size, o.size * 0.5);
  const vw = antonW(o.value, size);
  const bs = o.badgeSize;
  const sideX = x + vw + o.size * 0.16;
  const sideW = x + w - sideX;
  const badgeW = o.badge?.text ? monoW(String(o.badge.text).toUpperCase(), bs, Math.round(bs * 0.12)) + bs * 1.4 : 0;
  const linesW = Math.max(0, ...o.lines.map((/** @type {string} */ l) => monoW(String(l).toUpperCase(), bs * 0.92, 2)));
  const side = !!o.side && sideW >= Math.max(badgeW, linesW, 200);
  const sideH = (o.badge?.text ? bs * 2.3 : 0) + o.lines.length * bs * 1.5;
  const h = side ? Math.max(size * 1.02, sideH + 8) : size * 1.02 + 10 + sideH;
  return {
    h: Math.round(h),
    draw: (/** @type {number} */ y) => {
      let out = T(x, y + size * 0.98, o.value, { size, fill: th.fg, disp: true, ls: -2 });
      let ly = side ? y + size * 0.98 - sideH + bs * 0.3 : y + size * 1.02 + 10;
      const lx = side ? sideX : x;
      const lw = side ? sideW : w;
      if (o.badge?.text) {
        out += stamp(th, o.badge.text, lx, ly, bs, { solid: o.badge.kind === 'pb' || o.badge.kind === 'first', tone: o.badge.kind === 'gap' ? o.badge.tone : '', maxW: lw }).svg;
        ly += bs * 2.3;
      }
      for (const l of o.lines) {
        out += T(lx, ly + bs * 1.05, clipMono(String(l).toUpperCase(), lw, bs * 0.92, 2), { size: bs * 0.92, fill: th.fg, op: th.soft, bold: true, ls: 2 });
        ly += bs * 1.5;
      }
      return out;
    },
  };
}

/**
 * The ink look's poster type: the card's word, huge and faint, filling the space the
 * photo would have had.
 * @param {Theme} th @param {string} word @param {number} x @param {number} top @param {number} w @param {number} h
 */
export function watermark(th, word, x, top, w, h) {
  const text = String(word || '').toUpperCase().trim();
  if (!text || h < 120) return '';
  const words = text.split(/\s+/);
  let best = { size: 0, lines: /** @type {string[]} */ ([]) };
  for (let n = 1; n <= Math.min(3, words.length); n++) {
    const per = Math.ceil(words.length / n);
    const lines = Array.from({ length: n }, (_, i) => words.slice(i * per, (i + 1) * per).join(' ')).filter(Boolean);
    const size = Math.min(h / (lines.length * 0.98), ...lines.map((l) => w / (l.length * ANTON_EM)));
    if (size > best.size) best = { size, lines };
  }
  const size = Math.min(best.size, 520);
  const lh = size * 0.98;
  const y0 = top + (h - lh * best.lines.length) / 2;
  return best.lines.map((l, i) => T(x, y0 + lh * (i + 1) - size * 0.06, l, { size, fill: th.fg, disp: true, op: 0.13, ls: -2 })).join('');
}

/** @param {any} model */
function raceLines(model) {
  const lines = [];
  if (model.ranks?.length) lines.push(model.ranks.map((/** @type {any} */ r) => `${r.value} ${r.label}`).join(' · '));
  if (model.partner) lines.push(`with ${model.partner}`);
  return lines;
}

/** Hyrox / hybrid race. @param {any} model @param {Shape} shape @param {Theme} th */
function drawRace(model, shape, th) {
  const S = SHAPES[shape];
  const x = S.m, w = S.w - S.m * 2;
  const rows = model.rows || [];
  const sumStats = [
    { value: model.runs, label: 'running' },
    { value: model.stations, label: 'stations' },
    { value: model.roxzone, label: 'roxzone' },
    model.avgHr ? { value: String(model.avgHr), unit: 'bpm', label: 'avg hr' } : null,
  ].filter((s) => s && s.value);
  if (shape === 'story') {
    const st = stack([
      kicker(th, model.kicker, x, w, 26),
      title(th, model.title, x, w, { max: 140, min: 76, max2: 104 }),
      line(th, model.dateLine, x, w, 24),
      gap(16),
      headline(th, x, w, { value: model.total, size: 160, badge: model.badge, badgeSize: 24, lines: raceLines(model), side: true, valueW: w * 0.56 }),
      rule(th, x, w, 22),
      rows.length ? hyroxRows(th, rows, x, w, rows.length > 16 ? 38 : 45) : gap(0),
      gap(20),
      statGrid(th, sumStats, x, w, { size: 58, label: 17 }),
    ], S.bottom);
    return st;
  }
  if (shape === 'square') {
    return stack([
      kicker(th, model.kicker, x, w, 21),
      title(th, model.title, x, w, { max: 108, min: 60, lines: 1 }),
      line(th, model.dateLine, x, w, 19),
      gap(6),
      headline(th, x, w, { value: model.total, size: 150, badge: model.badge, badgeSize: 19, lines: raceLines(model), side: true, valueW: w * 0.55 }),
      gap(30),
      rows.length ? hyroxCols(th, rows, x, w, 270) : gap(0),
      gap(14),
      statGrid(th, sumStats, x, w, { size: 42, label: 14 }),
    ], S.bottom);
  }
  // Landscape: numbers left, the columns right.
  const lw = 470;
  const left = stack([
    kicker(th, model.kicker, x, lw, 15),
    title(th, model.title, x, lw, { max: 80, min: 44, max2: 64 }),
    line(th, model.dateLine, x, lw, 14),
    gap(4),
    headline(th, x, lw, { value: model.total, size: 112, badge: model.badge, badgeSize: 14, lines: raceLines(model), side: false, valueW: lw }),
  ], S.bottom);
  const cx = x + lw + 40;
  const right = rows.length ? hyroxCols(th, rows, cx, S.w - S.m - cx, 300).draw(S.bottom - 300) : '';
  return { svg: left.svg + right, top: Math.min(left.top, S.bottom - 300) };
}

/** Race weekend. @param {any} model @param {Shape} shape @param {Theme} th */
function drawEvent(model, shape, th) {
  const S = SHAPES[shape];
  const x = S.m, w = S.w - S.m * 2;
  const races = model.races || [];
  /** @param {any} r @param {number} rx @param {number} rw @param {number} size @param {number} bs */
  const raceBlock = (r, rx, rw, size, bs) => {
    const lines = [r.ranks?.length ? r.ranks.map((/** @type {any} */ k) => `${k.value} ${k.label}`).join(' · ') : '', r.partner ? `with ${r.partner}` : '', r.avgHr ? `avg hr ${r.avgHr} bpm` : ''].filter(Boolean);
    return [
      kicker(th, `${r.date} · ${r.division}`, rx, rw, bs),
      headline(th, rx, rw, { value: r.total, size, badge: r.badge, badgeSize: bs, lines, side: rw > 700, valueW: rw * 0.6 }),
    ];
  };
  const summary = [`${model.raceCount} ${model.raceCount === 1 ? 'race' : 'races'}`, `${model.totalTime} racing`, model.pbCount ? `${model.pbCount} PB` : `${model.divisionCount} division${model.divisionCount === 1 ? '' : 's'}`].join(' · ');
  if (shape === 'story') {
    const blocks = [
      kicker(th, model.kicker, x, w, 26),
      title(th, model.title, x, w, { max: 150, min: 80, max2: 112 }),
      line(th, summary, x, w, 25, { bold: true }),
      rule(th, x, w, 34),
    ];
    const size = races.length > 3 ? 110 : races.length > 2 ? 140 : 170;
    races.slice(0, 4).forEach((r, i) => {
      if (i) blocks.push(rule(th, x, w, 30));
      blocks.push(...raceBlock(r, x, w, size, 24));
    });
    return stack(blocks, S.bottom);
  }
  const n = Math.min(races.length, shape === 'square' ? 3 : 4) || 1;
  const colGap = 36;
  const cw = (w - colGap * (n - 1)) / n;
  const size = shape === 'square' ? (n > 2 ? 84 : 116) : (n > 2 ? 64 : 84);
  const bs = shape === 'square' ? (n > 2 ? 15 : 18) : 13;
  const cols = races.slice(0, n).map((r, i) => {
    const bx = x + i * (cw + colGap);
    return raceBlock(r, bx, cw, size, bs);
  });
  const colH = Math.max(...cols.map((c) => c.reduce((s, b) => s + b.h, 0)));
  const colsBlock = {
    h: colH,
    draw: (/** @type {number} */ y) => cols.map((c, i) => {
      let out = '';
      let yy = y;
      for (const b of c) { out += b.draw(yy); yy += b.h; }
      if (i) out += `<line x1="${x + i * (cw + colGap) - colGap / 2}" y1="${y}" x2="${x + i * (cw + colGap) - colGap / 2}" y2="${y + colH}" stroke="${th.fg}" stroke-opacity="0.4" stroke-width="2"/>`;
      return out;
    }).join(''),
  };
  return stack([
    kicker(th, model.kicker, x, w, shape === 'square' ? 21 : 15),
    title(th, model.title, x, w, shape === 'square' ? { max: 120, min: 64, max2: 96 } : { max: 96, min: 50, lines: 1 }),
    line(th, summary, x, w, shape === 'square' ? 19 : 14, { bold: true }),
    rule(th, x, w, shape === 'square' ? 34 : 22),
    colsBlock,
  ], S.bottom);
}

/** The parkrun line under a run's numbers. @param {any} pk */
function parkrunStats(pk) {
  return [
    pk.position ? { value: pk.position, label: 'position' } : null,
    pk.number ? { value: pk.number, label: 'parkruns' } : null,
    pk.ageGrade ? { value: pk.ageGrade, label: 'age grade' } : null,
  ].filter(Boolean);
}

/** Run / parkrun. @param {any} model @param {Shape} shape @param {Theme} th */
function drawRun(model, shape, th) {
  const S = SHAPES[shape];
  const x = S.m, w = S.w - S.m * 2;
  const splits = model.splits || [];
  const pk = model.parkrun;
  const routeArea = th.mode === 'ink' && model.route?.length >= 10;
  if (shape === 'landscape') {
    const lw = routeArea || splits.length > 1 ? 560 : w;
    const left = stack([
      kicker(th, model.kicker, x, lw, 15),
      title(th, model.title, x, lw, { max: 84, min: 44, max2: 64 }),
      line(th, model.dateLine, x, lw, 14),
      badgeBlock(th, model.badge, x, 14, lw),
      gap(6),
      statGrid(th, model.stats, x, lw, { cols: 2, size: 62, label: 13 }),
    ], S.bottom);
    const rx = x + lw + 50, rw = S.w - S.m - rx;
    let right = '';
    if (routeArea) right = routeSvg(th, model.route, rx, S.top + 10, rw, S.bottom - S.top - 10, 7);
    else if (splits.length > 1) right = sectionHead(th, 'km splits', rx, rw, 13).draw(S.bottom - 236) + splitCols(th, splits, rx, rw, 206).draw(S.bottom - 206);
    return { svg: left.svg + right, top: left.top };
  }
  const story = shape === 'story';
  const st = stack([
    kicker(th, model.kicker, x, w, story ? 26 : 21),
    title(th, model.title, x, w, story ? { max: 140, min: 76, max2: 104 } : { max: 104, min: 56, lines: 1 }),
    line(th, model.dateLine, x, w, story ? 24 : 19),
    badgeBlock(th, model.badge, x, story ? 24 : 19, w),
    gap(story ? 10 : 4),
    statGrid(th, model.stats, x, w, story ? { cols: 2, size: 120, label: 20 } : { cols: 4, size: 72, label: 15 }),
    pk ? gap(story ? 12 : 8) : null,
    pk ? statGrid(th, parkrunStats(pk), x, w, story ? { cols: 3, size: 64, label: 17 } : { cols: 3, size: 46, label: 14 }) : null,
    splits.length > 1 ? gap(story ? 18 : 12) : null,
    splits.length > 1 ? sectionHead(th, 'km splits', x, w, story ? 20 : 16, model.splitNote) : null,
    splits.length > 1 ? splitCols(th, splits, x, w, story ? 230 : 160) : null,
  ].filter(Boolean), S.bottom);
  let route = '';
  if (routeArea) {
    const top = S.top + (story ? 0 : 0);
    const h = st.top - top - 40;
    if (h > 140) route = routeSvg(th, model.route, x + w * 0.1, top, w * 0.8, h, story ? 10 : 8);
  }
  return { svg: route + st.svg, top: st.top, filled: !!route };
}

/** Strength (Hevy). @param {any} model @param {Shape} shape @param {Theme} th */
function drawStrength(model, shape, th) {
  const S = SHAPES[shape];
  const x = S.m, w = S.w - S.m * 2;
  const sets = model.topSets || [];
  const prs = model.prs || [];
  if (shape === 'landscape') {
    const lw = sets.length ? 520 : w;
    const left = stack([
      kicker(th, model.kicker, x, lw, 15),
      title(th, model.title, x, lw, { max: 84, min: 44, max2: 64 }),
      line(th, model.dateLine, x, lw, 14),
      badgeBlock(th, model.badge, x, 14, lw),
      gap(6),
      statGrid(th, model.stats, x, lw, { cols: 2, size: 58, label: 13 }),
    ], S.bottom);
    const rx = x + lw + 50, rw = S.w - S.m - rx;
    const n = Math.min(sets.length, 6);
    const right = n ? sectionHead(th, 'top sets', rx, rw, 13).draw(S.bottom - n * 46 - 28) + listRows(th, sets.slice(0, n), rx, rw, 46).draw(S.bottom - n * 46) : '';
    return { svg: left.svg + right, top: left.top };
  }
  const story = shape === 'story';
  const nSets = Math.min(sets.length, story ? (prs.length ? 6 : 8) : (prs.length ? 3 : 5));
  const nPrs = Math.min(prs.length, story ? 4 : 2);
  return stack([
    kicker(th, model.kicker, x, w, story ? 26 : 21),
    title(th, model.title, x, w, story ? { max: 140, min: 76, max2: 104 } : { max: 104, min: 56, lines: 1 }),
    line(th, model.dateLine, x, w, story ? 24 : 19),
    gap(story ? 10 : 4),
    statGrid(th, model.stats, x, w, story ? { cols: 2, size: 112, label: 19 } : { cols: 4, size: 64, label: 14 }),
    nSets ? gap(story ? 18 : 8) : null,
    nSets ? sectionHead(th, 'top sets', x, w, story ? 20 : 15, `${model.exerciseCount} exercises`) : null,
    nSets ? listRows(th, sets.slice(0, nSets), x, w, story ? 62 : 46) : null,
    nPrs ? gap(story ? 26 : 14) : null,
    nPrs ? sectionHead(th, nPrs === 1 ? 'personal best' : 'personal bests', x, w, story ? 20 : 15, prs.length > nPrs ? `+${prs.length - nPrs} more` : '') : null,
    nPrs ? prWall(th, prs.slice(0, nPrs), x, w, story ? { cols: 2, rows: 2, size: 30 } : { cols: 2, rows: 1, size: 24 }) : null,
  ].filter(Boolean), S.bottom);
}

/** Ride / walk / any other session. @param {any} model @param {Shape} shape @param {Theme} th */
function drawOther(model, shape, th) {
  const S = SHAPES[shape];
  const x = S.m, w = S.w - S.m * 2;
  const routeArea = th.mode === 'ink' && model.route?.length >= 10;
  const spark = model.hr?.length >= 4 ? model.hr : null;
  if (shape === 'landscape') {
    const lw = routeArea ? 560 : w;
    const left = stack([
      kicker(th, model.kicker, x, lw, 15),
      title(th, model.title, x, lw, { max: routeArea ? 84 : 110, min: 44, max2: routeArea ? 64 : 84 }),
      line(th, model.dateLine, x, lw, 14),
      badgeBlock(th, model.badge, x, 14, lw),
      gap(6),
      statGrid(th, model.stats, x, lw, { cols: routeArea ? 2 : 4, size: routeArea ? 58 : 70, label: 13 }),
    ], S.bottom);
    const rx = x + lw + 50;
    const right = routeArea ? routeSvg(th, model.route, rx, S.top + 10, S.w - S.m - rx, S.bottom - S.top - 10, 7) : '';
    return { svg: left.svg + right, top: left.top };
  }
  const story = shape === 'story';
  const st = stack([
    kicker(th, model.kicker, x, w, story ? 26 : 21),
    title(th, model.title, x, w, story ? { max: 150, min: 76, max2: 112 } : { max: 110, min: 56, max2: 84 }),
    line(th, model.dateLine, x, w, story ? 24 : 19),
    badgeBlock(th, model.badge, x, story ? 24 : 19, w),
    gap(story ? 10 : 4),
    statGrid(th, model.stats, x, w, story ? { cols: 2, size: 120, label: 20 } : { cols: 4, size: 72, label: 15 }),
    spark ? gap(story ? 24 : 14) : null,
    spark ? sparkBlock(th, spark, x, w, story ? 220 : 150, 'heart rate · bpm') : null,
  ].filter(Boolean), S.bottom);
  let route = '';
  if (routeArea) {
    const h = st.top - S.top - 40;
    if (h > 140) route = routeSvg(th, model.route, x + w * 0.1, S.top, w * 0.8, h, story ? 10 : 8);
  }
  return { svg: route + st.svg, top: st.top, filled: !!route };
}

/** Week / month / year roundup. @param {any} model @param {Shape} shape @param {Theme} th */
function drawRoundup(model, shape, th) {
  const S = SHAPES[shape];
  const x = S.m, w = S.w - S.m * 2;
  const vs = model.vs;
  if (shape === 'landscape') {
    const left = stack([
      kicker(th, model.kicker, x, w, 15),
      title(th, model.title, x, w * 0.62, { max: 110, min: 50, lines: 1 }),
      gap(4),
      statGrid(th, model.totals, x, w, { cols: 4, size: 66, label: 13 }),
      gap(10),
      model.calendar?.days?.length ? heatmap(th, model.calendar, x, w, model.calendar.type === 'week' ? 70 : 96) : null,
    ].filter(Boolean), S.bottom);
    return left;
  }
  const story = shape === 'story';
  const prs = model.prs || [];
  const nPrs = Math.min(prs.length, story ? 4 : 0);
  const cal = model.calendar;
  const calH = !cal?.days?.length ? 0 : cal.type === 'week' ? (story ? 170 : 120) : cal.type === 'month' ? (story ? 330 : 190) : (story ? 230 : 160);
  return stack([
    kicker(th, model.kicker, x, w, story ? 26 : 21),
    title(th, model.title, x, w, story ? { max: 170, min: 80, max2: 120 } : { max: 120, min: 60, lines: 1 }),
    model.byline ? line(th, model.byline, x, w, story ? 24 : 18) : null,
    gap(story ? 12 : 4),
    statGrid(th, model.totals, x, w, story ? { cols: 2, size: 104, label: 19 } : { cols: 4, size: 62, label: 14 }),
    model.sports?.length ? gap(story ? 22 : 12) : null,
    model.sports?.length ? (story ? sectionHead(th, 'by sport', x, w, 20) : null) : null,
    model.sports?.length && story ? donutBlock(th, model, x, w, 300, 5) : null,
    !story && model.sports?.length && calH ? beside(donutBlock(th, model, x, w * 0.56 - 20, 230, 4), heatmap(th, cal, x + w * 0.56 + 20, w * 0.44 - 20, cal.type === 'year' ? 150 : 210)) : null,
    !story && model.sports?.length && !calH ? donutBlock(th, model, x, w, 230, 4) : null,
    calH && story ? gap(22) : null,
    calH && story ? sectionHead(th, cal.type === 'week' ? 'the week' : cal.type === 'month' ? 'the month' : 'the year', x, w, 20, `${model.activeDays} active days`) : null,
    calH && (story || !model.sports?.length) ? heatmap(th, cal, x, w, calH) : null,
    nPrs ? gap(24) : null,
    nPrs ? sectionHead(th, 'personal records', x, w, 20, model.prCount > nPrs ? `${model.prCount} in all` : '') : null,
    nPrs ? prWall(th, prs.slice(0, nPrs), x, w, { cols: 2, rows: 2, size: 26 }) : null,
    vs ? gap(story ? 20 : 10) : null,
    vs ? deltaRow(th, vs.deltas, vs.label, x, w, story ? 19 : 15) : null,
  ].filter(Boolean), S.bottom);
}

/** Two blocks side by side, top-aligned. @param {Block} a @param {Block} b */
function beside(a, b) {
  return { h: Math.max(a.h, b.h), draw: (y) => a.draw(y) + b.draw(y) };
}

const DRAW = /** @type {Record<string, (model: any, shape: Shape, th: Theme) => { svg: string, top: number, filled?: boolean }>} */ ({
  race: drawRace, event: drawEvent, run: drawRun, parkrun: drawRun, strength: drawStrength, other: drawOther, roundup: drawRoundup,
});

/**
 * One card, as an SVG string. In photo mode the ground is transparent where the photo
 * shows (the task composites the photo underneath).
 * @param {any} model  tasks/fitness-share-models.mjs output
 * @param {Shape} shape
 * @param {Mode} mode
 * @returns {string}
 */
export function buildShareSVG(model, shape, mode) {
  const draw = DRAW[model.template] || drawOther;
  const th = cardTheme(mode, model.ink);
  const body = draw(model, shape, th);
  if (mode === 'ink' && !body.filled) {
    const S = SHAPES[shape];
    body.svg = watermark(th, model.watermark || model.pill, S.m - 6, S.top - 10, S.w - S.m * 2 + 12, body.top - S.top - 10) + body.svg;
  }
  const fr = frame(shape, th, { pill: model.pill || 'FITNESS', right: model.headRight || '', scrimFrom: body.top });
  return svgDoc(shape, `${fr.under}\n${body.svg}\n${fr.over}`);
}
