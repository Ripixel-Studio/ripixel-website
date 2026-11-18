import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { kindOf, sectionsOf, titleFromItemName, readThoughts, thoughtPageVars, enrichList } from './thoughts-index.mjs';

function tmpThoughts(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thoughts-'));
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body);
  fs.writeFileSync(path.join(dir, 'template.html'), '<html></html>'); // not a post
  return dir;
}

test('a post with a code block is a how-to, anything else a hot take', () => {
  assert.equal(kindOf('words\n\n```js\nx\n```\n'), 'how-to');
  assert.equal(kindOf('just opinions, `inline code` included'), 'hot take');
});

test('sections are the ## headings, skipping fenced code and stripping markdown', () => {
  const md = '# Not this\n\n## "Why **not**?"\n\n```bash\n## a comment, not a heading\n```\n\n### nor this\n\n## [Linked](http://x) bit\n';
  assert.deepEqual(sectionsOf(md), ['"Why not?"', 'Linked bit']);
});

test('titles follow Skier\'s rule', () => {
  assert.equal(titleFromItemName('2023-01-04_Enabling-dark-mode'), 'Enabling Dark Mode');
});

test('posts are numbered oldest first; prev is older, next is newer', () => {
  const dir = tmpThoughts({
    '2019-09-09_First.md': 'one\n',
    '2023-01-04_Middle.md': 'two\n\n```\ncode\n```\n',
    '2026-11-18_Latest.md': 'three\n\n## A\n\n## B\n',
  });
  const all = readThoughts(dir);
  assert.deepEqual(all.map((t) => t.issue), ['01', '02', '03']);
  assert.equal(all[1].kind, 'how-to');

  const mid = thoughtPageVars(all, '2023-01-04_Middle');
  assert.equal(mid.prevThought.title, 'First');
  assert.equal(mid.nextThought.title, 'Latest');
  assert.equal(mid.nextThought.relativePath, 'thoughts/2026-11-18_Latest.html');

  const first = thoughtPageVars(all, '2019-09-09_First');
  assert.equal(first.prevThought, undefined);

  const latest = thoughtPageVars(all, '2026-11-18_Latest', [
    { level: 2, text: 'A', slug: 'a' }, { level: 3, text: 'x', slug: 'x' }, { level: 2, text: 'B', slug: 'b' },
  ]);
  assert.deepEqual(latest.toc.map((h) => [h.num, h.slug]), [['01', 'a'], ['02', 'b']]);
  assert.equal(latest.nextThought, undefined);
});

test('the listing gets a cover, year breaks, and a note for the missing years', () => {
  const dir = tmpThoughts({
    '2020-07-04_A.md': 'a\n', '2020-08-16_B.md': 'b\n', '2023-01-04_C.md': 'c\n', '2026-11-18_D.md': 'd\n',
  });
  const all = readThoughts(dir);
  const list = [...all].reverse().map((t) => ({ itemName: t.itemName, date: `${t.itemName.slice(0, 10)}T00:00:00Z`, body: 'x' }));
  const out = enrichList(list, all);
  assert.deepEqual(out.map((t) => t.cover), [true, false, false, false]);
  assert.deepEqual(out.map((t) => t.yearStart), [false, true, true, false]);
  assert.match(out[1].gapNote, /^two years of radio silence/);
  assert.match(out[2].gapNote, /^two years/);
  assert.equal(out[3].gapNote, undefined);
  assert.equal(out[0].readTime, '1');
});

test('one skipped year is normal: no note', () => {
  const dir = tmpThoughts({ '2021-03-21_A.md': 'a\n', '2023-01-02_B.md': 'b\n', '2023-01-04_C.md': 'c\n' });
  const all = readThoughts(dir);
  const list = [...all].reverse().map((t) => ({ itemName: t.itemName, date: `${t.itemName.slice(0, 10)}T00:00:00Z` }));
  const out = enrichList(list, all);
  assert.equal(out[2].gapNote, undefined);
  assert.equal(out[2].yearStart, true);
});
