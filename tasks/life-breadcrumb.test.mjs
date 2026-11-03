// Run with `npm test`. Every /life sub-page crumb must link back to /life.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const P = (...a) => path.join(REPO, 'personal', ...a);
const CRUMB = /<nav class="thought-breadcrumb"[^>]*>([\s\S]*?)<\/nav>/;
const LINK = /<a\s+href="\/life">\s*life\s*<\/a>/;

const sources = [
  ...fs.readdirSync(P('pages', 'life')).filter((f) => f.endsWith('.html')).map((f) => P('pages', 'life', f)),
  P('partials', 'life-section-head.html'),
  P('templates', 'roundup.html'),
  P('templates', 'activity.html'),
  P('templates', 'event.html'),
];

test('every life sub-page source links its crumb to /life', () => {
  for (const f of sources) {
    const html = fs.readFileSync(f, 'utf8');
    if (html.includes('{{> life-section-head}}')) continue; // covered by the partial
    const crumb = html.match(CRUMB)?.[1] ?? html.match(/<nav class="act-crumb"[^>]*>([\s\S]*?)<\/nav>/)?.[1];
    assert.ok(crumb, `${path.basename(f)} has a breadcrumb`);
    assert.match(crumb, /<a [^>]*href="\/life"/, `${path.basename(f)} crumb links to /life`);
  }
});

test('crumb link is styled as a link with a focus state', () => {
  const css = fs.readFileSync(P('assets', 'styles', 'main', 'styles.css'), 'utf8');
  assert.match(css, /\.thought-breadcrumb a:focus-visible/);
  assert.match(css, /\.thought-breadcrumb a\s*\{[^}]*border-bottom/);
});

test('built life sub-pages link their crumb to /life (when built)', (t) => {
  const dir = path.join(REPO, 'public', 'personal', 'life');
  if (!fs.existsSync(dir)) return t.skip('site not built');
  const pages = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isFile() && e.name.endsWith('.html') && e.name !== 'index.html') pages.push(path.join(dir, e.name));
    if (e.isDirectory()) {
      const idx = path.join(dir, e.name, 'index.html');
      if (fs.existsSync(idx)) pages.push(idx);
    }
  }
  assert.ok(pages.length >= 8, `found ${pages.length} built sub-pages`);
  for (const f of pages) {
    const crumb = fs.readFileSync(f, 'utf8').match(CRUMB)?.[1];
    if (!crumb) continue;
    assert.match(crumb, LINK, `${path.relative(dir, f)} crumb links to /life`);
  }
});
