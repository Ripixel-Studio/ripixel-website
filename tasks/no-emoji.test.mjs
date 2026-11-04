// No emoji in anything the site itself emits (James, 2026-11-04: "they cheapen the look").
// The corporate label site is out of scope (it is not the zine). Scans templates, partials, pages, styles (incl. CSS content:), build tasks and scripts.
// James's own text (activity descriptions, titles, quips) arrives as data at build time and
// is never in these files. Plain typographic marks (star, arrows, hearts-as-letters) are
// text, not emoji: a character is banned when it defaults to emoji presentation, is
// followed by a variation selector 16, is a ZWJ, or is both Emoji and Extended_Pictographic.
import { test } from 'node:test';
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
