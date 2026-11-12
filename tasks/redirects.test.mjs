// @ts-check
// /profile became /work (LH3.7): a permanent redirect, and the old page is gone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const firebase = JSON.parse(await fs.readFile(path.join(REPO, 'firebase.json'), 'utf8'));

test('personal target redirects /profile to /work with a 301', () => {
  const personal = firebase.hosting.find((/** @type {any} */ h) => h.target === 'personal');
  assert.deepEqual(personal.redirects[0], { source: '/profile', destination: '/work', type: 301 });
});

test('the old /life/sessions family filters land on their tag (one tag system)', () => {
  const personal = firebase.hosting.find((/** @type {any} */ h) => h.target === 'personal');
  const to = (/** @type {string} */ src) => personal.redirects.find((/** @type {any} */ r) => r.source === src)?.destination;
  assert.equal(to('/life/sessions/crossfit'), '/life/sessions/hyrox');
  assert.equal(to('/life/sessions/hiit/:page'), '/life/sessions/class');
  assert.equal(to('/life/sessions/hike'), '/life/sessions/walk');
});

test('corporate target has no /profile redirect', () => {
  const corporate = firebase.hosting.find((/** @type {any} */ h) => h.target === 'corporate');
  assert.ok(!(corporate.redirects || []).some((/** @type {any} */ r) => r.source === '/profile'));
});

test('no profile.html page remains', async () => {
  await assert.rejects(fs.access(path.join(REPO, 'personal/pages/profile.html')));
});
