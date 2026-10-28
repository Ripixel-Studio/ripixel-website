// @ts-check
// Run with `npm test` (node:test, no extra dependencies).
//
// Every internal link on the built personal site is slash-less. firebase.json
// has `trailingSlash: false`, so `/life/roundups/` is a 301 to `/life/roundups`
// (and before that setting landed it was a 404): a trailing slash in an
// internal href, canonical, og:url, Atom link/id or sitemap <loc> costs a
// redirect on every click. This builds the site from the committed fixtures
// and scans the output, so a link builder or template that grows a slash
// again fails here rather than in production.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(REPO, 'public', 'personal');
const ORIGIN = 'https://james.ripixel.co.uk';

/** Internal URLs: site-relative, or absolute on the site's origin. */
const INTERNAL_URL = `(?:${ORIGIN.replace(/[.]/g, '\\.')})?/[^"<]*`;
/** `href="…/"` and `content="…/"` (og:url) with a trailing slash, bare "/" excluded. */
const HTML_SLASH = new RegExp(`(?:href|content)="(${INTERNAL_URL}?/)"`, 'g');
/** `<loc>…/</loc>`, `<id>…/</id>` with a trailing slash. */
const XML_SLASH = new RegExp(`<(?:loc|id)>(${INTERNAL_URL}?/)</(?:loc|id)>`, 'g');

/** @param {string} dir @returns {Promise<string[]>} every file under dir */
async function walk(dir) {
  const out = [];
  for (const ent of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

/**
 * The trailing-slash internal URLs in one file, as "<rel file>: <url>" lines.
 * The site root (`/` and `https://james.ripixel.co.uk/`) is the one legitimate slash.
 * @param {string} file @param {RegExp} re
 */
async function offenders(file, re) {
  const text = await fs.readFile(file, 'utf8');
  const hits = [];
  for (const m of text.matchAll(re)) {
    const url = m[1];
    if (url === '/' || url === `${ORIGIN}/`) continue;
    hits.push(`${path.relative(REPO, file)}: ${url}`);
  }
  return hits;
}

describe('built personal site has no trailing-slash internal links', () => {
  before(async () => {
    await promisify(execFile)('npx', ['skier'], {
      cwd: REPO,
      env: { ...process.env, SKIER_SITE: 'personal', FITNESS_DATA_SOURCE: 'fixtures' },
      maxBuffer: 64 * 1024 * 1024,
    });
    await fs.access(path.join(OUT, 'life.html'));
    await fs.access(path.join(OUT, 'life', 'roundups.html'));
  }, { timeout: 120_000 });

  test('fixture build has the /life pages this scan is for', async () => {
    const files = await walk(OUT);
    assert.ok(files.some((f) => /life\/activity\/[^/]+\/index\.html$/.test(f)), 'an activity page');
    assert.ok(files.some((f) => /life\/roundup\/[^/]+\.html$/.test(f)), 'a roundup page');
  });

  test('no href="…/" or og:url content="…/" in any HTML page', async () => {
    const html = (await walk(OUT)).filter((f) => f.endsWith('.html'));
    const hits = (await Promise.all(html.map((f) => offenders(f, HTML_SLASH)))).flat();
    assert.deepEqual(hits, []);
  });

  test('every /life href that the fixture pages do link is slash-less', async () => {
    const text = await fs.readFile(path.join(OUT, 'life.html'), 'utf8');
    const hrefs = [...text.matchAll(/href="(\/life[^"]*)"/g)].map((m) => m[1]);
    assert.ok(hrefs.some((h) => /^\/life\/activity\/[^/]+$/.test(h)), `activity card link in ${hrefs.join(' ')}`);
    assert.ok(hrefs.some((h) => /^\/life\/roundup\/[^/]+$/.test(h)), 'roundup teaser link');
    assert.ok(hrefs.includes('/life/roundups'), 'roundups index link');
    assert.ok(hrefs.includes('/life'), 'masthead/tab-bar /life link');
  });

  test('Atom feed ids and links are slash-less', async () => {
    const feed = path.join(OUT, 'life', 'feed.xml');
    assert.deepEqual(await offenders(feed, HTML_SLASH), []);
    assert.deepEqual(await offenders(feed, XML_SLASH), []);
  });

  test('sitemap <loc>s are slash-less, including the activity directory pages', async () => {
    const sitemap = path.join(OUT, 'sitemap.xml');
    assert.deepEqual(await offenders(sitemap, XML_SLASH), []);
    const text = await fs.readFile(sitemap, 'utf8');
    assert.match(text, new RegExp(`<loc>${ORIGIN}/life/activity/[^/<]+</loc>`));
    assert.match(text, new RegExp(`<loc>${ORIGIN}/</loc>`), 'the root keeps its slash');
  });
});
