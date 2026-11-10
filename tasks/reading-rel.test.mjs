// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readingRelView, readingRelFacts, bareTitle } from './reading-rel.mjs';
import { readingView } from './life-shelves.mjs';

const COVER = 'https://m.media-amazon.com/images/I/abc.jpg';

const SEC = {
  prizeShelf: [
    { key: 'k1', title: 'Brass Orbit (Part 1 of 2) (Dramatized Adaptation)', by: 'Mira Quell', cover: COVER, year: 1971, won: 1, noms: 3,
      seals: [{ prize: 'hugo', cat: 'Novel', won: true }, { prize: 'hugo', cat: 'Series', won: true, series: true },
        { prize: 'locus', cat: 'SF Novel', won: false }, { prize: 'clarke', cat: '', won: false }, { prize: 'nope', won: true }] },
    { key: 'k2', title: 'Lantern Engine', by: 'Ada Wren', cover: 'https://evil.example/x.jpg', seals: [] },
  ],
  prizeTally: { winners: 1, shortlisted: 4, wins: { hugo: 2, nebula: 1, nope: 9 } },
  relCoverage: { books: 40, matched: 30, voices: 12 },
  onScreen: [{ bookKey: 'k1', book: 'Brass Orbit', title: 'Brass Orbit', year: 2021, kind: 'film',
    watched: { key: 'w1', month: '2021-10', bigScreen: true } }],
  voices: [{ name: 'Tom Vane', books: 20, hours: 400, authors: ['Mira Quell'], covers: [COVER], own: false },
    { name: 'Bo Grin', books: 2, hours: 4, authors: [], covers: [], own: true }],
  catalogue: [{ heading: 'Space opera', mark: 'SF 1', books: 7, titles: ['Brass Orbit (Part 2 of 2) (Dramatized Adaptation)', 'Two'] }],
  printed: [{ decade: 1970, books: 7, titles: ['Brass Orbit'] }],
  printedEnds: { oldest: { title: 'Brass Orbit', by: 'Mira Quell', year: 1971 }, newest: { title: 'Two', year: 2024 } },
  crowd: { mean: 4.5, rated: 9, top: { title: 'Two', stars: 4.9 }, low: { title: 'Three', stars: 4.0 } },
};

test('bareTitle drops the parts and the dramatisation', () => {
  assert.equal(bareTitle('Iron Kite (Part 1 of 2) (Dramatized Adaptation)'), 'Iron Kite');
  assert.equal(bareTitle('Threshing Day [Dramatized Adaptation]'), 'Threshing Day');
});

test('prize shelf: three seals on the cover, the rest in words, unknown prizes dropped, a ribbon for the film', () => {
  const v = readingRelView(SEC);
  assert.equal(v.prizes.length, 1, 'a book with no seals is not on the prize shelf');
  const p = v.prizes[0];
  assert.equal(p.title, 'Brass Orbit');
  assert.deepEqual(p.seals.map((s) => [s.name, s.won, s.series]), [['Hugo', true, false], ['Hugo', true, true], ['Locus', false, false]]);
  assert.equal(p.more, 'shortlisted for the Clarke');
  assert.equal(p.screen?.watched, true);
  assert.equal(p.screen?.href, '/life/watching');
  assert.match(p.screen?.line || '', /Saw the film in Oct 2021, on the big screen/);
  assert.deepEqual(v.prizeTally, [{ n: '2', name: 'Hugos' }, { n: '1', name: 'Nebula' }]);
  assert.match(v.prizeNote, /^1 book on my shelf won a prize, and 4 more were shortlisted/);
  assert.match(v.prizeSource, /Wikidata knows 30 of my 40 books/);
});

test('voices: faders by hours on a square-root scale, own voice, cover through the host check', () => {
  const v = readingRelView(SEC);
  assert.equal(v.voices[0].pct, 100);
  assert.equal(v.voices[1].pct, 10);
  assert.equal(v.voices[0].cover, COVER);
  assert.equal(v.voices[1].own, true);
  assert.equal(v.voices[0].authors, 'Mira Quell');
});

test('catalogue and the date-due slip: tally marks in fives', () => {
  const v = readingRelView(SEC);
  assert.deepEqual(v.catalogue[0].titles, ['Brass Orbit', 'Two']);
  assert.equal(v.printed[0].decade, '1970s');
  assert.equal(v.printed[0].fives.length, 1);
  assert.equal(v.printed[0].ones.length, 2);
  assert.match(v.printedNote, /oldest is Brass Orbit by Mira Quell, first printed in 1971/);
});

test('facts: the crowd and read it, watched it; readingView carries them and drops the lone narrator card', () => {
  const f = readingRelFacts(SEC);
  assert.deepEqual(f.map((x) => x?.kicker), ['the crowd\'s favourite', 'the hard sell', 'read it, watched it']);
  const v = readingView({ ...SEC, narrator: { name: 'Tom Vane', books: 20 }, shelf: [] });
  assert.ok(!v.facts.some((x) => x?.kicker === 'the voice in my head'));
  assert.equal(v.prizes.length, 1);
});

test('empty export: nothing breaks', () => {
  const v = readingRelView({});
  assert.deepEqual([v.prizes, v.voices, v.catalogue, v.printed, v.prizeTally], [[], [], [], [], []]);
  assert.deepEqual(readingRelFacts({}), []);
});
