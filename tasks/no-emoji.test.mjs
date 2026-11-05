// No emoji in anything the site itself emits (James, 2026-11-04: "they cheapen the look").
// The corporate label site is out of scope (it is not the zine). Scans templates, partials, pages, styles (incl. CSS content:), build tasks and scripts.
// James's own text (activity descriptions, titles, quips) arrives as data at build time and
// is never in these files. Machine text arrives as data too (FitGlue's "≈ 1.6 slice of pizza
// 🍕", its PR messages), which a source scan cannot see, so the built activity pages are
// scanned as well, with only his own words left out. Plain typographic marks (star, arrows, hearts-as-letters) are
// text, not emoji: a character is banned when it defaults to emoji presentation, is
// followed by a variation selector 16, is a ZWJ, or is both Emoji and Extended_Pictographic.
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOTS = ['personal', 'shared', 'tasks', 'scripts'];
const EXT = new Set(['.html', '.css', '.mjs', '.js', '.json', '.hbs']);

function* walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
            if (e.name === 'node_modules') continue;
      yield* walk(p);
    } else if (dir.startsWith(path.join('personal', 'items'))) {
      if (e.name === 'template.html') yield p; // only the chrome, never his posts
    } else if (EXT.has(path.extname(e.name)) && !e.name.endsWith('.test.mjs')) yield p;
  }
}

const isEmoji = (ch) =>
  /\p{Emoji_Presentation}/u.test(ch) || ch === '️' || ch === '‍'
  || (/\p{Extended_Pictographic}/u.test(ch) && /\p{Emoji}/u.test(ch));

test('no emoji codepoint in templates, partials, styles, tasks or scripts', () => {
  const hits = [];
  for (const root of ROOTS) {
    for (const file of walk(root)) {
      fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        for (const ch of line) if (isEmoji(ch)) hits.push(`${file}:${i + 1} U+${ch.codePointAt(0).toString(16).toUpperCase()}`);
      });
    }
  }
  assert.deepEqual(hits, []);
});

test('the detector itself flags emoji and passes typographic marks', () => {
  for (const e of ['\u{1F3CB}', '\u{1F30D}', '✨', '⚠', '⚙️', '\u2197', '❤']) assert.ok(isEmoji(e), e);
  for (const t of ['★', '→', '←', '✓', '☼', '✦', '◆', 'a', '·']) assert.ok(!isEmoji(t), t);
});

const ACTIVITY_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'personal', 'life', 'activity');

/** The page's own activity title, as rendered in its hero. @param {string} html */
const heroTitle = (html) => /<h1 class="act-hero__title">([\s\S]*?)<span class="act-hero__dot">/.exec(html)?.[1] ?? '';

/** A built activity page without his own words: the head, his description, the titles of his
 * activities (this one's, and others' it links to, like the PB a race chased), and the
 * tooltips and alt texts that repeat them. @param {string} html @param {string[]} [titles] */
function machineText(html, titles = [heroTitle(html)]) {
  let out = html
    .replace(/<head>[\s\S]*?<\/head>/, '')
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<blockquote class="act-words__body">[\s\S]*?<\/blockquote>/g, '')
    .replace(/\s(title|alt|aria-label|data-title)="[^"]*"/g, '');
  for (const t of [...titles].sort((a, b) => b.length - a.length)) if (t) out = out.split(t).join('');
  return out;
}

test('no emoji in the built activity pages outside his own words', () => {
  let slugs;
  try { slugs = fs.readdirSync(ACTIVITY_DIR); } catch { assert.fail(`no build at ${ACTIVITY_DIR}; run FITNESS_DATA_SOURCE=fixtures npm run build:personal`); }
  assert.ok(slugs.length > 0);
  const pages = slugs.map((slug) => [slug, path.join(ACTIVITY_DIR, slug, 'index.html')]).filter(([, f]) => fs.existsSync(f)).map(([slug, f]) => [slug, fs.readFileSync(f, 'utf8')]);
  const titles = pages.map(([, html]) => heroTitle(html));
  const hits = [];
  for (const [slug, html] of pages) {
    machineText(html, titles).split('\n').forEach((line, i) => {
      for (const ch of line) if (isEmoji(ch)) hits.push(`${slug}:${i + 1} U+${ch.codePointAt(0).toString(16).toUpperCase()} ${line.trim().slice(0, 80)}`);
    });
  }
  assert.deepEqual(hits, []);
});

test('the page scan leaves his words out and still sees machine text', () => {
  const page = '<head><title>Run \u{1F3C3}</title></head><h1 class="act-hero__title">Run \u{1F3C3}<span class="act-hero__dot">.</span></h1>'
    + '<blockquote class="act-words__body">Lovely \u{1F60A}</blockquote><img alt="Photo from Run \u{1F3C3}"><div class="act-note">\u2248 1 slice of pizza \u{1F355}</div>';
  const left = machineText(page);
  assert.ok(![...left.replace('\u{1F355}', '')].some(isEmoji), left);
  assert.ok([...left].some(isEmoji), 'the pizza is still seen');
});
