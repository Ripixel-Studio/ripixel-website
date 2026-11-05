// @ts-check
// The clickable-card convention (tasks/card-link.mjs): one signal for "this goes somewhere".
// Unit checks of the auditor, then the source CSS: no :hover rule outside the convention may
// tilt, lift or put a pointer on something (the built pages are scanned in life-links.test.mjs,
// which owns the full build).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { auditHtml, auditCss, parseHtml } from './card-link.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARROW = '<span class="card-link__arrow" aria-hidden="true"></span>';

test('parseHtml: nesting, void elements, raw text', () => {
  const root = parseHtml('<div class="a"><img src="x"><script>if (a<b) "<a href=x>"</script><p>hi<br>there</p></div>');
  assert.equal(root.children.length, 1);
  assert.deepEqual(root.children[0].children.map((c) => c.tag), ['img', 'script', 'p']);
  assert.equal(root.children[0].children[1].children.length, 0, 'script content is not parsed');
});

test('auditHtml: a card that is the link, with one arrow, passes', () => {
  assert.deepEqual(auditHtml(`<a class="fit-card card-link" href="/x"><h3>t</h3>${ARROW}</a>`), []);
});

test('auditHtml: a stretched-link card with one target and asides passes', () => {
  const html = `<li class="hub-card card-link"><h2><a class="card-link__target" href="/a">A</a></h2>
    <p><a class="card-link__aside" href="/b">b</a></p>${ARROW}</li>`;
  assert.deepEqual(auditHtml(html), []);
});

test('auditHtml: missing arrow, two arrows, no target, stray second link', () => {
  assert.match(auditHtml('<a class="card-link" href="/x">x</a>').join('\n'), /0 arrows/);
  assert.match(auditHtml(`<a class="card-link" href="/x">${ARROW}${ARROW}</a>`).join('\n'), /2 arrows/);
  assert.match(auditHtml(`<div class="card-link"><a href="/x">x</a>${ARROW}</div>`).join('\n'), /0 card-link__target/);
  assert.match(auditHtml(`<div class="card-link"><a class="card-link__target" href="/x">x</a><a href="/y">y</a>${ARROW}</div>`).join('\n'), /neither target nor aside/);
});

test('auditHtml: no link nested in a card <a>, no arrow outside a card, arrow is aria-hidden', () => {
  assert.match(auditHtml(`<a class="card-link" href="/x"><a href="/y">y</a>${ARROW}</a>`).join('\n'), /nested/);
  assert.match(auditHtml(`<div>${ARROW}</div>`).join('\n'), /outside a card-link/);
  assert.match(auditHtml('<a class="card-link" href="/x"><span class="card-link__arrow"></span></a>').join('\n'), /aria-hidden/);
});

test('auditHtml: a decorative card-tilt never holds a link or the arrow', () => {
  assert.deepEqual(auditHtml('<article class="role-card card-tilt"><p>x</p></article>'), []);
  assert.match(auditHtml('<article class="role-card card-tilt"><a href="/x">x</a></article>').join('\n'), /should be a card-link/);
  assert.match(auditHtml(`<article class="card-tilt">${ARROW}</article>`).join('\n'), /outside a card-link/);
  assert.match(auditHtml('<li class="watch-tile"><a href="/x">x</a></li>').join('\n'), /should be a card-link/);
});

test('auditCss: hover motion outside the convention is flagged, the convention and allowed ones are not', () => {
  assert.deepEqual(auditCss('.card-link:hover { rotate: 1deg; translate: -2px -2px; box-shadow: 0 0 0 red; }'), []);
  assert.deepEqual(auditCss('.card-tilt:hover { rotate: 1deg }'), []);
  assert.deepEqual(auditCss('.games-tile:hover { transform: rotate(0) scale(1.03) } .games-tile--w1:hover { transform: none }'), []);
  assert.deepEqual(auditCss('.x:hover { background: red } .y:hover .z { opacity: 1 }'), []);
  assert.deepEqual(auditCss('.proj-card:hover { transform: rotate(1deg) } .role-card:hover { cursor: pointer }'), ['.proj-card:hover', '.role-card:hover']);
  assert.deepEqual(auditCss('@media (x) { .hub-card:hover { box-shadow: 1px 1px 0 red } }'), ['.hub-card:hover']);
});

test('source CSS: every hover tilt, lift or pointer goes through card-link / card-tilt (or is a listed exception)', () => {
  const dir = path.join(REPO, 'personal', 'assets', 'styles', 'main');
  const hits = [];
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.css'))) {
    for (const sel of auditCss(fs.readFileSync(path.join(dir, f), 'utf8'))) hits.push(`${f}: ${sel}`);
  }
  assert.deepEqual(hits, []);
});

test('source CSS: the convention exists, honours reduced motion, and the hover-rotate script is gone', () => {
  const css = fs.readFileSync(path.join(REPO, 'personal', 'assets', 'styles', 'main', 'styles.css'), 'utf8');
  assert.match(css, /\.card-link\s*\{/);
  assert.match(css, /\.card-link__arrow\s*\{/);
  assert.match(css, /\.card-link:focus-visible|\.card-link__target:focus-visible/);
  const reduced = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/g)].map((m) => m[1]).join('\n');
  assert.match(reduced, /\.card-link/, 'reduced motion turns the tilt and lift off');
  const footer = fs.readFileSync(path.join(REPO, 'personal', 'partials', 'footer.html'), 'utf8');
  assert.doesNotMatch(footer, /hover-rotate/);
  assert.ok(fs.existsSync(path.join(REPO, 'personal', 'partials', 'card-arrow.html')), 'the shared arrow partial');
});
