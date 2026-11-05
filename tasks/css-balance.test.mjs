// Every stylesheet closes what it opens. A dropped "}" after an @media block is valid-looking
// CSS: the minifier closes it at end of file, so every rule after it (the :root tokens included)
// silently applies only inside that query. On 2026-11-05 a merge dropped the brace after a
// max-width: 640px block and the whole site lost its styles on desktop.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function* walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') yield* walk(p); }
    else if (p.endsWith('.css') && !p.endsWith('.min.css')) yield p;
  }
}

// Strip comments and strings so braces inside them do not count.
function depthReport(css) {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '""');
  let depth = 0, line = 1, firstNegative = null;
  for (const c of src) {
    if (c === '\n') line++;
    else if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth < 0 && firstNegative === null) firstNegative = line; }
  }
  return { depth, firstNegative };
}

test('every source stylesheet has balanced braces', () => {
  const bad = [];
  for (const root of ['personal', 'shared']) {
    for (const f of walk(root)) {
      const { depth, firstNegative } = depthReport(fs.readFileSync(f, 'utf8'));
      if (depth !== 0 || firstNegative !== null) bad.push(`${f}: depth ${depth}${firstNegative ? `, extra } at line ${firstNegative}` : ''}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('the check catches an unclosed @media block', () => {
  assert.equal(depthReport('@media (max-width: 640px) {\n  .a { color: red; }\n.b { color: blue; }').depth, 1);
  assert.equal(depthReport('/* { */ .a { content: "}"; }').depth, 0);
});
