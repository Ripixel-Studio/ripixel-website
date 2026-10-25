// @ts-check
/**
 * OG (Open Graph) card images, 1200×630, in the site's zine treatment.
 *
 * Two kinds of card come out of here:
 *
 *   1. Section cards (`card_home.png`, `card_life.png`, …) — one per site
 *      section, committed under personal/assets/images/. Re-render them with
 *        node scripts/generate-og-images.mjs
 *
 *   2. Fitness cards — one per activity and roundup page, rendered at build
 *      time by tasks/fitness-og-images.mjs into public/personal/life/og/ and
 *      cached in .cache/og/. The drawing lives here so both kinds share one
 *      frame; the Skier task only decides what goes on each card. Preview the
 *      fitness set without a full build with
 *        node scripts/generate-og-images.mjs --fitness [outDir]
 *      (data comes from the same live → cache → fixtures chain as the build).
 *
 * Rasterising: `sharp` (devDependency). Its bundled fontconfig cannot read the
 * WOFF files that @fontsource ships, so `ensureFonts()` unpacks Anton and
 * JetBrains Mono to TTF under .cache/fonts/ and points fontconfig at them
 * before sharp is loaded. Nothing needs installing in ~/.fonts.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, '..');
export const SECTION_OUT_DIR = path.join(REPO_ROOT, 'personal/assets/images');
export const DEFAULT_FONT_CACHE_DIR = path.join(REPO_ROOT, '.cache/fonts');

export const CARD_W = 1200;
export const CARD_H = 630;
const PAPER = '#F5EFDF';
const INK = '#171311';
const MONO = "'JetBrains Mono', 'Liberation Mono', monospace";
const DISPLAY = "Anton, 'Impact', 'Liberation Sans Narrow', sans-serif";

/** The life/fitness section ink — every fitness card uses it. */
export const FITNESS_INK = '#7C3AED';

/** @type {{ id: string, label: string, glyph: string, ink: string, desc: string }[]} */
export const PAGES = [
  { id: 'home',      label: 'HELLO!',      glyph: '☼', ink: '#F25B1C', desc: 'software engineer · web app creator · nottinghamshire, uk' },
  { id: 'projects',  label: 'PROJECTS.',   glyph: '◆', ink: '#D32E84', desc: 'things built, shipped, and occasionally abandoned.' },
  { id: 'thoughts',  label: 'THOUGHTS.',   glyph: '◇', ink: '#0F8A56', desc: 'ramblings, how-to guides & the occasional hot take.' },
  { id: 'profile',   label: 'PROFILE.',    glyph: '◉', ink: '#2148C0', desc: 'career history, tech stack, and a very long meeting history.' },
  { id: 'life',      label: 'FITNESS.',    glyph: '△', ink: FITNESS_INK, desc: 'running, riding & generally trying to stay alive.' },
  { id: 'changelog', label: 'CHANGELOG.',  glyph: '◎', ink: '#F25B1C', desc: "what's changed on this site." },
  { id: '404',       label: '404.',        glyph: '×', ink: '#B7261F', desc: '(oh bollocks.)' },
];

/** @param {unknown} s */
export function xmlEsc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Frame

/**
 * The paper, washes, borders, registration marks, byline and URL footer that
 * every card shares. `pill` is the section tag top-left; `inner` is the
 * card-specific markup drawn inside the frame.
 * @param {{ ink: string, pill: { glyph?: string, triangle?: boolean, label: string, width?: number }, bigGlyph?: string, inner: string }} opts
 */
export function cardShell({ ink, pill, bigGlyph = '', inner }) {
  const pillW = pill.width ?? 220;
  const pillText = pill.triangle
    ? `<polygon points="60,85 70,101 50,101" fill="${PAPER}"/>
  <text x="80" y="99" font-family="${MONO}" font-size="14" font-weight="700" fill="${PAPER}" letter-spacing="2">${xmlEsc(pill.label)}</text>`
    : `<text x="52" y="99" font-family="${MONO}" font-size="14" font-weight="700" fill="${PAPER}" letter-spacing="2">${xmlEsc(pill.glyph ?? '')}  ${xmlEsc(pill.label)}</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CARD_W} ${CARD_H}" width="${CARD_W}" height="${CARD_H}">
  <defs>
    <!-- Halftone dot tile -->
    <pattern id="dots" x="0" y="0" width="8" height="8" patternUnits="userSpaceOnUse">
      <circle cx="4" cy="4" r="1.2" fill="${ink}" opacity="0.18"/>
    </pattern>
    <!-- Top-right ink wash -->
    <radialGradient id="wash1" cx="1100" cy="0" r="700" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="${ink}" stop-opacity="0.30"/>
      <stop offset="100%" stop-color="${ink}" stop-opacity="0"/>
    </radialGradient>
    <!-- Bottom-left ink wash -->
    <radialGradient id="wash2" cx="80" cy="630" r="550" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="${ink}" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="${ink}" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <!-- Cream paper -->
  <rect width="1200" height="630" fill="${PAPER}"/>

  <!-- Halftone wash -->
  <rect width="1200" height="630" fill="url(#dots)"/>

  <!-- Ink gradient washes -->
  <rect width="1200" height="630" fill="url(#wash1)"/>
  <rect width="1200" height="630" fill="url(#wash2)"/>

  <!-- Outer border (thick) -->
  <rect x="14" y="14" width="1172" height="602" fill="none" stroke="${INK}" stroke-width="3"/>
  <!-- Inner border (thin double-rule) -->
  <rect x="20" y="20" width="1160" height="590" fill="none" stroke="${INK}" stroke-width="1"/>

  <!-- Registration mark — top left -->
  <circle cx="50" cy="50" r="13" fill="none" stroke="${ink}" stroke-width="2"/>
  <line x1="36" y1="50" x2="64" y2="50" stroke="${ink}" stroke-width="2"/>
  <line x1="50" y1="36" x2="50" y2="64" stroke="${ink}" stroke-width="2"/>

  <!-- Section tag pill -->
  <rect x="44" y="78" width="${pillW}" height="30" fill="${ink}"/>
  ${pillText}

  ${bigGlyph ? `<!-- Decorative large glyph (background) -->
  <text x="1090" y="540" text-anchor="middle"
    font-family="${MONO}"
    font-size="280" fill="${ink}" opacity="0.09">${xmlEsc(bigGlyph)}</text>` : ''}

  ${inner}

  <!-- "JAMES KING" byline (top right) -->
  <text x="1148" y="58" text-anchor="end"
    font-family="${DISPLAY}"
    font-size="26" font-weight="400" fill="${INK}" opacity="0.55" letter-spacing="1">JAMES KING</text>

  <!-- URL footer -->
  <text x="56" y="594"
    font-family="${MONO}"
    font-size="17" fill="${INK}" opacity="0.45">james.ripixel.co.uk — a zine, by james king · est. 2015</text>

  <!-- Ink dot cluster (top right, registration marks) -->
  <circle cx="1148" cy="50" r="7"   fill="${ink}"/>
  <circle cx="1128" cy="50" r="7"   fill="${ink}" opacity="0.45"/>
  <circle cx="1108" cy="50" r="7"   fill="${ink}" opacity="0.2"/>
</svg>`;
}

// ---------------------------------------------------------------------------
// Section cards (unchanged treatment)

/**
 * Build an SVG card string for one site section.
 * @param {{ label: string, glyph: string, ink: string, desc: string }} page
 */
export function buildSectionSVG({ label, glyph, ink, desc }) {
  // Approximate font-size for display label so it doesn't overflow
  // Anton is very condensed — ~0.52× em per char
  const labelSize = Math.min(Math.floor(960 / (label.length * 0.52)), 180);
  const labelY = 380;
  const inner = `<!-- Main display label -->
  <text x="56" y="${labelY}"
    font-family="${DISPLAY}"
    font-size="${labelSize}" font-weight="400" fill="${INK}" letter-spacing="-2">${xmlEsc(label)}</text>

  <!-- Thin rule under label -->
  <line x1="56" y1="${labelY + 18}" x2="700" y2="${labelY + 18}" stroke="${ink}" stroke-width="2"/>

  <!-- Description line -->
  <text x="56" y="${labelY + 52}"
    font-family="${MONO}"
    font-size="20" fill="${INK}" opacity="0.65">${xmlEsc(desc)}</text>`;
  return cardShell({ ink, pill: { glyph, label: label.toUpperCase() }, bigGlyph: glyph, inner });
}

// ---------------------------------------------------------------------------
// Fitness cards

/** Usable title width and Anton's rough advance per uppercase character. */
const TITLE_MAX_W = 1088;
const ANTON_EM_PER_CHAR = 0.5;
/** Sizes to try: one line first (a one-liner reads better than two bigger lines), then two lines. */
const TITLE_LADDER = [[150, 1], [136, 1], [124, 1], [112, 1], [100, 1], [112, 2], [100, 2], [88, 2], [76, 2], [64, 2], [56, 2]];
const TITLE_BASELINE = 410;

/**
 * Fit a display title: the largest size on one line (150 → 100px), else the
 * largest on two lines (112px down — two lines cap at 112 so the block clears
 * the kicker). Anything still too long at 56px is cut with an ellipsis.
 * @param {string} title
 * @returns {{ size: number, lines: string[] }}
 */
export function fitTitle(title) {
  const words = String(title).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return { size: 150, lines: ['ACTIVITY'] };
  const wrap = (/** @type {number} */ maxChars) => {
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
  };
  for (const [size, maxLines] of TITLE_LADDER) {
    const maxChars = Math.floor(TITLE_MAX_W / (ANTON_EM_PER_CHAR * size));
    const lines = wrap(maxChars);
    if (lines.length <= maxLines && lines.every((l) => l.length <= maxChars)) return { size, lines };
  }
  const size = TITLE_LADDER[TITLE_LADDER.length - 1][0];
  const maxChars = Math.floor(TITLE_MAX_W / (ANTON_EM_PER_CHAR * size));
  const lines = wrap(maxChars).slice(0, 2);
  if (lines[1] && lines[1].length > maxChars - 1) lines[1] = lines[1].slice(0, maxChars - 1).trimEnd();
  lines[1] = (lines[1] ?? lines[0]) + '…';
  if (lines.length === 1) lines[0] = lines[0].slice(0, maxChars - 1).trimEnd() + '…';
  return { size, lines };
}

/**
 * @typedef {{ value: string, unit?: string, label: string }} CardStat
 * @typedef {{ kicker: string, title: string, stats: CardStat[], pill?: string, ink?: string, footnote?: string }} FitnessCard
 */

/**
 * One activity or roundup card: kicker line, big wrapped title bottom-anchored
 * on a rule, then up to four stat cells (Anton numbers, mono labels) — the
 * site's stat-strip in card form.
 * @param {FitnessCard} card
 */
export function buildFitnessCardSVG(card) {
  const ink = card.ink || FITNESS_INK;
  const { size, lines } = fitTitle(String(card.title || '').toUpperCase());
  const lineH = Math.round(size * 1.05);
  const titleLines = lines
    .map((line, i) => {
      const y = TITLE_BASELINE - (lines.length - 1 - i) * lineH;
      return `<text x="56" y="${y}" font-family="${DISPLAY}" font-size="${size}" font-weight="400" fill="${INK}" letter-spacing="-2">${xmlEsc(line)}</text>`;
    })
    .join('\n  ');
  const stats = (card.stats || []).filter((s) => s && s.value && s.value !== '—').slice(0, 4);
  const cellW = 272;
  const cells = stats
    .map((s, i) => {
      const x = 56 + i * cellW;
      const value = xmlEsc(s.value);
      const unit = s.unit ? `<tspan font-family="${MONO}" font-size="20" font-weight="700" fill="${ink}" dx="6">${xmlEsc(s.unit)}</tspan>` : '';
      return `<text x="${x}" y="518" font-family="${DISPLAY}" font-size="64" fill="${INK}" letter-spacing="-1">${value}${unit}</text>
  <text x="${x}" y="548" font-family="${MONO}" font-size="14" font-weight="700" fill="${INK}" opacity="0.6" letter-spacing="2">${xmlEsc(String(s.label || '').toUpperCase())}</text>`;
    })
    .join('\n  ');
  // Footnote as an outlined stamp on the pill row (right), clear of the title and stat labels.
  const stampW = card.footnote ? Math.round(28 + String(card.footnote).length * 10.4) : 0;
  const footnote = card.footnote
    ? `<rect x="${1144 - stampW}" y="78" width="${stampW}" height="30" fill="none" stroke="${ink}" stroke-width="2"/>
  <text x="${1144 - stampW / 2}" y="99" text-anchor="middle" font-family="${MONO}" font-size="14" font-weight="700" fill="${ink}" letter-spacing="2">${xmlEsc(String(card.footnote).toUpperCase())}</text>`
    : '';
  const inner = `<!-- Kicker -->
  <text x="56" y="176" font-family="${MONO}" font-size="18" font-weight="700" fill="${ink}" letter-spacing="2">${xmlEsc(String(card.kicker || '').toUpperCase())}</text>

  <!-- Title -->
  ${titleLines}

  <!-- Rule -->
  <line x1="56" y1="${TITLE_BASELINE + 26}" x2="1144" y2="${TITLE_BASELINE + 26}" stroke="${ink}" stroke-width="2"/>

  <!-- Stat cells -->
  ${cells}
  ${footnote}`;
  const label = card.pill || 'FITNESS';
  return cardShell({ ink, pill: { triangle: true, label, width: 60 + label.length * 10.5 }, inner });
}

// ---------------------------------------------------------------------------
// Fonts: @fontsource WOFF → TTF so sharp's bundled fontconfig can use them

/**
 * Unpack a WOFF 1.0 file into its sfnt (TTF/OTF). WOFF1 is the sfnt table
 * directory plus zlib-compressed tables, so this is a header rewrite and an
 * inflate per table — no font library needed.
 * @param {Buffer} buf
 */
export function woffToSfnt(buf) {
  if (buf.length < 44 || buf.toString('latin1', 0, 4) !== 'wOFF') throw new Error('not a WOFF 1.0 file');
  const flavor = buf.readUInt32BE(4);
  const numTables = buf.readUInt16BE(12);
  let entrySelector = 0;
  while ((2 << entrySelector) <= numTables) entrySelector++;
  const searchRange = (1 << entrySelector) * 16;
  const header = Buffer.alloc(12 + numTables * 16);
  header.writeUInt32BE(flavor, 0);
  header.writeUInt16BE(numTables, 4);
  header.writeUInt16BE(searchRange, 6);
  header.writeUInt16BE(entrySelector, 8);
  header.writeUInt16BE(numTables * 16 - searchRange, 10);
  const parts = [header];
  let offset = header.length;
  for (let i = 0; i < numTables; i++) {
    const d = 44 + i * 20;
    const tag = buf.subarray(d, d + 4);
    const tOffset = buf.readUInt32BE(d + 4);
    const compLength = buf.readUInt32BE(d + 8);
    const origLength = buf.readUInt32BE(d + 12);
    const checksum = buf.readUInt32BE(d + 16);
    const raw = buf.subarray(tOffset, tOffset + compLength);
    const data = compLength === origLength ? raw : zlib.inflateSync(raw);
    if (data.length !== origLength) throw new Error(`WOFF table ${tag.toString('latin1')} length mismatch`);
    const rec = 12 + i * 16;
    tag.copy(header, rec);
    header.writeUInt32BE(checksum, rec + 4);
    header.writeUInt32BE(offset, rec + 8);
    header.writeUInt32BE(origLength, rec + 12);
    const padded = Buffer.alloc((data.length + 3) & ~3);
    data.copy(padded);
    parts.push(padded);
    offset += padded.length;
  }
  return Buffer.concat(parts);
}

const FONT_FILES = [
  ['@fontsource/anton', 'files/anton-latin-400-normal.woff'],
  ['@fontsource/jetbrains-mono', 'files/jetbrains-mono-latin-400-normal.woff'],
  ['@fontsource/jetbrains-mono', 'files/jetbrains-mono-latin-700-normal.woff'],
];

/**
 * Unpack the card fonts into `cacheDir` and point fontconfig at them. Must
 * run before sharp is first imported in this process (fontconfig reads
 * FONTCONFIG_FILE once). A FONTCONFIG_FILE already in the environment wins.
 * @param {string} [cacheDir]
 * @returns {string} the fonts.conf path in use
 */
export function ensureFonts(cacheDir = DEFAULT_FONT_CACHE_DIR) {
  if (process.env.FONTCONFIG_FILE) return process.env.FONTCONFIG_FILE;
  const require = createRequire(import.meta.url);
  fs.mkdirSync(cacheDir, { recursive: true });
  for (const [pkg, file] of FONT_FILES) {
    const src = path.join(path.dirname(require.resolve(`${pkg}/package.json`)), file);
    const dest = path.join(cacheDir, path.basename(file).replace(/\.woff$/, '.ttf'));
    if (fs.existsSync(dest) && fs.statSync(dest).mtimeMs >= fs.statSync(src).mtimeMs) continue;
    fs.writeFileSync(dest, woffToSfnt(fs.readFileSync(src)));
  }
  const conf = path.join(cacheDir, 'fonts.conf');
  fs.writeFileSync(conf, `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>${xmlEsc(cacheDir)}</dir>
  <include ignore_missing="yes">/etc/fonts/fonts.conf</include>
  <cachedir>${xmlEsc(path.join(cacheDir, 'fc-cache'))}</cachedir>
</fontconfig>
`);
  process.env.FONTCONFIG_FILE = conf;
  return conf;
}

/** @type {Promise<any> | null} */
let sharpPromise = null;
/**
 * sharp, loaded lazily after the fonts are in place.
 * @param {string} [fontCacheDir]
 */
export function getSharp(fontCacheDir) {
  if (!sharpPromise) {
    ensureFonts(fontCacheDir);
    sharpPromise = import('sharp').then((m) => m.default);
  }
  return sharpPromise;
}

/**
 * Rasterise an SVG card to a 1200×630 palette PNG.
 * @param {string} svg
 * @param {string} pngPath
 * @param {{ fontCacheDir?: string }} [opts]
 */
export async function rasterise(svg, pngPath, opts = {}) {
  const sharp = await getSharp(opts.fontCacheDir);
  fs.mkdirSync(path.dirname(pngPath), { recursive: true });
  // Palette PNG: ~75 KB vs ~270 KB for truecolour, with the halftone and washes intact;
  // a site build ships one of these per activity, so the size matters.
  await sharp(Buffer.from(svg)).resize(CARD_W, CARD_H).png({ compressionLevel: 9, palette: true, quality: 90 }).toFile(pngPath);
}

// ---------------------------------------------------------------------------
// CLI

async function renderSections() {
  fs.mkdirSync(SECTION_OUT_DIR, { recursive: true });
  for (const page of PAGES) {
    await rasterise(buildSectionSVG(page), path.join(SECTION_OUT_DIR, `card_${page.id}.png`));
    console.log(`✓ card_${page.id}.png`);
  }
  console.log(`\nDone — ${PAGES.length} OG images written to ${SECTION_OUT_DIR}`);
}

/** @param {string} outDir */
async function renderFitness(outDir) {
  const { loadFitnessData } = await import('../tasks/fitness-fetch.mjs');
  const { renderFitnessCards } = await import('../tasks/fitness-og-images.mjs');
  const data = await loadFitnessData({ logger: console });
  console.log(`fitness data: ${data.source} (${data.activities.length} activities, ${data.roundups.length} roundups)`);
  const result = await renderFitnessCards({
    activities: data.activities,
    roundups: data.roundups,
    index: data.index,
    outDir,
    siteUrl: 'https://james.ripixel.co.uk',
    logger: console,
  });
  console.log(`\nDone — ${result.rendered} rendered, ${result.cached} from cache, ${result.failed} failed → ${outDir}`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--fitness') await renderFitness(path.resolve(args[1] || 'public/personal/life/og'));
  else await renderSections();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
