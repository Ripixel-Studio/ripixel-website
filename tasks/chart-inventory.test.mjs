// @ts-check
// Every chart on /life carries labelled axes (R2c.3). Reads the built fixtures
// site (`FITNESS_DATA_SOURCE=fixtures npm run build:personal`) and checks that
// each <svg role="img"> sits inside a known chart wrapper with a sibling that
// holds tick labels.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIFE = path.join(REPO, 'public', 'personal', 'life');

const WRAPPERS = ['chart', 'chart--stack', 'act-zones-wrap', 'fit-strip', 'roundup-effort-wrap'];
const EXEMPT = /act-map__svg|heatmap|route|reg-?mark/;
const AXIS = /class="(?:chart__y|[\w-]*__yaxis)[\s"]/;

async function htmlFiles(dir) {
  const out = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await htmlFiles(p)));
    else if (e.name.endsWith('.html')) out.push(p);
  }
  return out;
}

/** Index of the wrapper element that encloses `pos`, with its inner HTML. */
function enclosing(html, pos) {
  const re = /<(figure|div|section)\b[^>]*class="([^"]*)"[^>]*>/g;
  let best = null;
  for (let m; (m = re.exec(html)); ) {
    if (m.index >= pos) break;
    const classes = m[2].split(/\s+/);
    if (!WRAPPERS.some((w) => classes.includes(w))) continue;
    const tag = m[1];
    // find this element's close by depth counting
    const tagRe = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'g');
    tagRe.lastIndex = m.index + m[0].length;
    let depth = 1;
    let end = -1;
    for (let t; (t = tagRe.exec(html)); ) {
      depth += t[1] ? -1 : 1;
      if (!depth) { end = t.index; break; }
    }
    if (end > pos) best = { start: m.index, end, inner: html.slice(m.index, end) };
  }
  return best;
}

test('every chart svg has a wrapper and axis tick labels', async () => {
  let files;
  try { files = await htmlFiles(LIFE); } catch { assert.fail(`no build at ${LIFE}; run FITNESS_DATA_SOURCE=fixtures npm run build:personal`); }
  assert.ok(files.length > 0);
  const failures = [];
  let charts = 0;
  for (const f of files) {
    const html = await fs.readFile(f, 'utf8');
    for (const m of html.matchAll(/<svg\b[^>]*>/g)) {
      const tag = m[0];
      if (!/role="img"/.test(tag) || /aria-hidden="true"/.test(tag) || EXEMPT.test(tag)) continue;
      charts++;
      const cls = /class="([^"]*)"/.exec(tag)?.[1] ?? '(no class)';
      const wrap = enclosing(html, m.index);
      const rel = path.relative(REPO, f);
      if (!wrap) failures.push(`${rel}: svg.${cls} is not inside ${WRAPPERS.map((w) => '.' + w).join(', ')}`);
      else if (!AXIS.test(wrap.inner)) failures.push(`${rel}: svg.${cls} has no y-axis tick labels beside it`);
    }
  }
  assert.ok(charts > 0, 'the fixtures build should contain charts');
  assert.deepEqual(failures, []);
});
