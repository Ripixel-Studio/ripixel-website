// @ts-check
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PAGES } from '../scripts/generate-og-images.mjs';
import { SECTION_CARD_IDS, sectionCard, FITNESS_CARD } from './og-cards.mjs';
import { SECTION_ORDER } from './life-hub.mjs';

describe('section OG cards', () => {
  test('every /life section has a drawn, committed card', () => {
    const drawn = new Set(PAGES.map((p) => p.id));
    for (const id of SECTION_ORDER) {
      assert.ok(SECTION_CARD_IDS.has(id), `${id} has no card id`);
      assert.ok(drawn.has(id), `${id} is not in PAGES`);
      assert.ok(fs.existsSync(`personal/assets/images/card_${id}.png`), `card_${id}.png not committed`);
    }
  });
  test('the hub card is LIFE., not FITNESS.', () => {
    assert.equal(PAGES.find((p) => p.id === 'life')?.label, 'LIFE.');
    assert.equal(PAGES.find((p) => p.id === 'fitness')?.label, 'FITNESS.');
  });
  test('URLs; an unknown section falls back to the hub card', () => {
    assert.equal(FITNESS_CARD, 'https://james.ripixel.co.uk/card_fitness.png');
    assert.equal(sectionCard('games'), 'https://james.ripixel.co.uk/card_games.png');
    assert.equal(sectionCard('sleep'), 'https://james.ripixel.co.uk/card_life.png');
  });
});
