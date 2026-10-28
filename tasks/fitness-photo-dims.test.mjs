// @ts-check
// Run with `npm test` (node:test, no extra dependencies).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

import { orientationOf, dimsFromBytes, heroImageUrls, loadPhotoDims } from './fitness-photo-dims.mjs';
import { heroLayout } from './fitness-activity-pages.mjs';

/** A w×h JPEG, optionally with an EXIF orientation. */
async function jpeg(w, h, orientation) {
  const img = sharp({ create: { width: w, height: h, channels: 3, background: '#c42a72' } }).jpeg();
  return orientation ? img.withMetadata({ orientation }).toBuffer() : img.toBuffer();
}

describe('hero photo sizes (F5.5)', () => {
  test('shape thresholds: portrait, landscape, square, unknown', () => {
    assert.equal(orientationOf({ w: 1080, h: 1440 }), 'portrait');
    assert.equal(orientationOf({ w: 1600, h: 900 }), 'landscape');
    assert.equal(orientationOf({ w: 1000, h: 1050 }), 'square');
    assert.equal(orientationOf(undefined), '');
    assert.equal(orientationOf({ w: 0, h: 10 }), '');
  });
  test('size from the bytes, EXIF rotation applied', async () => {
    assert.deepEqual(await dimsFromBytes(await jpeg(40, 30)), { w: 40, h: 30 });
    assert.deepEqual(await dimsFromBytes(await jpeg(40, 30, 6)), { w: 30, h: 40 }, 'stored landscape, shown portrait');
    assert.equal(await dimsFromBytes(Buffer.from('not an image')), null);
  });
  test('hero pictures: the AI banner and the first photo, https only', () => {
    const urls = heroImageUrls([
      { activity: { enrichments: { aiBanner: { imageUrl: 'https://x.test/b.png' } }, photoUrls: ['https://x.test/1.jpg', 'https://x.test/2.jpg'] } },
      { activity: { photoUrls: ['http://x.test/insecure.jpg'] } },
      {},
    ]);
    assert.deepEqual(urls, ['https://x.test/b.png', 'https://x.test/1.jpg']);
  });
  test('probes with a Range request, caches by URL, offline reads the cache only', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dims-'));
    const cacheFile = path.join(dir, 'dims.json');
    const body = await jpeg(30, 40);
    const calls = [];
    const fetchImpl = /** @type {any} */ (async (url, init) => {
      calls.push([url, init?.headers?.Range]);
      return { ok: true, status: 206, arrayBuffer: async () => body };
    });
    const r = await loadPhotoDims(['https://x.test/p.jpg'], { cacheFile, fetchImpl });
    assert.deepEqual(r.dims['https://x.test/p.jpg'], { w: 30, h: 40 });
    assert.equal(calls[0][1], 'bytes=0-131071');
    const again = await loadPhotoDims(['https://x.test/p.jpg', 'https://x.test/new.jpg'], { cacheFile, fetchImpl, offline: true });
    assert.equal(again.cached, 1);
    assert.equal(again.missing, 1);
    assert.equal(calls.length, 1, 'cached and offline: no more fetches');
  });
  test('hero layout carries the shape and the picture ratio', () => {
    assert.deepEqual(heroLayout({ w: 1080, h: 1440 }), { heroShape: 'portrait', heroRatio: '1080 / 1440' });
    assert.deepEqual(heroLayout(undefined), { heroShape: '', heroRatio: '' });
  });
});
