// @ts-check
// James's own pictures (the box's Needs-you "Pictures for the site", jarvis lifehub/art.py): every
// image field the export can override takes the showcase bucket's art/ copy, named by its hash,
// and nothing that only looks like it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSection, safeArt, safeMedia } from './life-hub.mjs';
import { shelfArt, OWN_ART } from './life-shelves.mjs';

const OWN = 'https://storage.googleapis.com/fitglue-server-prod-showcase-assets/site/james/life/art/0123456789abcdef.jpg';
const NOT = [
  'https://storage.googleapis.com/fitglue-server-prod-showcase-assets/site/james/life/art/0123456789abcdeg.jpg',
  'https://storage.googleapis.com/fitglue-server-prod-showcase-assets/site/james/life/art/0123456789abcdef.png',
  'https://storage.googleapis.com/fitglue-server-prod-showcase-assets/site/james/life/art/0123456789abcdef.jpg?x=1',
  'https://storage.googleapis.com/other-bucket/site/james/life/art/0123456789abcdef.jpg',
  'https://storage.googleapis.com/fitglue-server-prod-showcase-assets/site/james/life/art/../x/0123456789abcdef.jpg',
  'http://storage.googleapis.com/fitglue-server-prod-showcase-assets/site/james/life/art/0123456789abcdef.jpg',
];
const now = new Date('2026-11-09T10:00:00Z');

test('own art: exactly the bucket copy', () => {
  assert.ok(OWN_ART.test(OWN));
  for (const fn of [safeArt, safeMedia, shelfArt]) {
    assert.equal(fn(OWN), OWN, fn.name);
    for (const bad of NOT) assert.equal(fn(bad), '', `${fn.name} ${bad}`);
  }
});

test('own art on the games wall, the watching wall and the live stubs (the shelves: shelfArt above)', () => {
  const g = /** @type {any} */ (buildSection('games', {
    headline: { value: 1, unit: '', label: 'x' },
    wall: [{ key: '10000', name: 'Old Fixture Game', art: OWN, weight: 1, source: 'steam', quip: null }],
    recent: [{ name: 'Old Fixture Game', hours: 1, art: OWN }],
  }, now));
  assert.equal(g.wall.find((/** @type {any} */ t) => t.name === 'Old Fixture Game').art, OWN);
  assert.equal(g.recent[0].art, OWN);

  const w = /** @type {any} */ (buildSection('watching', {
    headline: { value: 1, unit: '', label: 'x' },
    wall: [{ key: 'w1', kind: 'film', title: 'Fixture Film', month: '2023-02', poster: OWN, weight: 1 }],
  }, now));
  assert.equal(w.wall.find((/** @type {any} */ t) => t.title === 'Fixture Film').poster, OWN);

  const live = /** @type {any} */ (buildSection('live', { headline: { value: 1, unit: '', label: 'x' } }, now,
    [{ key: 'a', kind: 'gig', title: 'Invented Musical', month: '2025-10', form: 'musical', poster: OWN, posterCredit: null, posterSource: 'upload' }]));
  const stub = live.yearRows.flatMap((/** @type {any} */ y) => y.stubs)[0];
  assert.equal(stub.poster, OWN);
  assert.equal(stub.credit, '', 'his own picture carries no credit line');
});
