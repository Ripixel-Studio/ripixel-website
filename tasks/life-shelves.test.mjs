import test from 'node:test';
import assert from 'node:assert/strict';
import { readingView, listeningView, shelfArt, fitSpine } from './life-shelves.mjs';

const COVER = 'https://m.media-amazon.com/images/I/51HIZdnqASL._SL500_.jpg';

test('shelfArt: only the known image hosts, as plain URLs', () => {
  assert.equal(shelfArt(COVER), COVER);
  assert.equal(shelfArt('https://i.ytimg.com/vi/QOZpqXnM-Os/hqdefault.jpg'), 'https://i.ytimg.com/vi/QOZpqXnM-Os/hqdefault.jpg');
  assert.equal(shelfArt('https://evil.example/x.jpg'), '');
  assert.equal(shelfArt("https://m.media-amazon.com/images/I/x.jpg');background:url(x"), '');
  assert.equal(shelfArt(null), '');
});

test('readingView: one bookcase, a bookend before each year, spines sized by length', () => {
  const v = readingView({
    bookStats: { finished: 3, hours: 40, authors: 2, owned: 5, unstarted: 2, pileHours: 30, since: '2024' },
    shelf: [
      { key: 'a', title: 'Long (Dramatized Adaptation)', by: 'X', cover: COVER, hours: 40, finished: '2026-03' },
      { key: 'b', title: 'Short', by: 'Y', cover: 'https://evil.example/c.jpg', hours: 3, finished: '2026-01' },
      { key: 'c', title: 'Old', by: 'Y', hours: 9, finished: '2024-05' },
    ],
    byYear: [{ year: '2024', books: 1, hours: 9 }, { year: '2026', books: 2, hours: 43 }],
    longest: { title: 'Long', by: 'X', value: 40 },
    slowBurn: { title: 'Old', value: 800 },
  });
  assert.deepEqual(v.shelf.map((s) => (s.bookend ? `[${s.year}]` : s.key)), ['[2026]', 'a', 'b', '[2024]', 'c']);
  const [, long, short] = v.shelf;
  assert.ok(long.width > short.width);
  assert.equal(long.spineTitle, 'Long');
  assert.equal(short.cover, '');                     // a foreign host never reaches a style attribute
  assert.equal(v.facts.find((f) => f.kicker === 'the slow burn').big, '2 yrs');
  assert.equal(v.numbers[0].value, '3');
});

test('listeningView: lately until a song comes back on a second day, then on repeat', () => {
  const base = { music: { loves: 10, plays: 4 }, onRepeat: [{ title: 'T', by: 'A', days: 1 }] };
  assert.equal(listeningView(base).repeatTitle, 'lately');
  assert.equal(listeningView({ ...base, repeatDays: 3, onRepeat: [{ title: 'T', by: 'A', days: 3 }] }).repeatTitle, 'on repeat');
  const v = listeningView({ ...base, lovedArtists: [{ name: 'Big', loves: 30 }, { name: 'Small', loves: 3 }],
    topArtists: [{ name: 'A', plays: 8 }, { name: 'B', plays: 2 }] });
  assert.equal(v.poster.find((p) => p.name === 'Big').size, 5);
  assert.equal(v.poster.find((p) => p.name === 'Small').size, 1);
  assert.deepEqual(v.chart.map((c) => c.pct), [100, 25]);
});

test('hub notes: the last book finished, the most loved artist', async () => {
  const { buildSection, hubNote } = await import('./life-hub.mjs');
  const r = buildSection('reading', { updated: '2026-11-07', staleDays: 0, headline: { value: 1, unit: '', label: 'x' }, notable: [],
    totals: { year: { books: 1 } }, shelf: [{ title: 'Newest', by: 'Ann', finished: '2026-11', hours: 9 }] });
  assert.deepEqual(hubNote('reading', r), { label: 'Last finished', value: 'Newest, Ann', href: '' });
  const l = buildSection('listening', { updated: '2026-11-07', staleDays: 0, headline: { value: 1, unit: '', label: 'x' }, notable: [],
    totals: { year: { tracks: 1 } }, lovedArtists: [{ name: 'Small', loves: 3 }, { name: 'Big', loves: 30 }] });
  assert.deepEqual(hubNote('listening', l), { label: 'Most loved', value: 'Big, 30 songs liked', href: '' });
});

test('hub covers hero: shelf art is accepted and drawn square, foreign art is not', async () => {
  const { heroView } = await import('./life-hub.mjs');
  const U = 'https://m.media-amazon.com/images/I/a.jpg';
  const v = heroView({ type: 'covers', caption: 'x', items: [{ src: U, alt: 'A' }, { src: U, alt: 'B' }, { src: U, alt: 'C' }] });
  assert.equal(v.square, true);
  assert.equal(heroView({ type: 'covers', caption: 'x', items: [{ src: 'https://evil.example/a.jpg', alt: 'A' }, { src: U, alt: 'B' }, { src: U, alt: 'C' }] }), null);
});

test('fitSpine: the whole title at the biggest size that fits, a wider spine when nothing does', () => {
  const short = fitSpine('Dune', 30, 90);
  assert.equal(short.font, 17);
  assert.equal(short.width, 30);
  const long = fitSpine('Isaac Steele and the Best Idea in the Universe', 28, 85);
  assert.ok(long.font < 17 && long.width === 28);
  const huge = fitSpine('Galaxy Outlaws: The Complete Black Ocean Mobius Missions, 1-16.5 and a great deal more besides', 22, 80);
  assert.ok(huge.width > 22);
});

test('readingView: parts kept apart on a spine, format and re-listens carried, bookmarks and heard again', () => {
  const v = readingView({
    shelf: [{ key: 'a', title: 'Fourth Wing (Part 2 of 2) (Dramatized Adaptation)', hours: 9, finished: '2026-04', again: true }],
    onTheGo: [{ title: 'Carl', progress: 0.85, again: true, heard: '2026-11' }],
    bookmarks: [{ title: 'Flybot', progress: 0.05, heard: '2025-06' }],
    heardAgain: [{ title: 'Carl', progress: 0.85, state: 'now' }, { title: 'Games', progress: 1, state: 'twice', heard: '2025-09' },
      { title: 'Bad', state: 'nonsense' }],
    bookStats: { finished: 1, again: 2, againHours: 30 },
  });
  const spine = v.shelf[1];
  assert.equal(spine.spineTitle, 'Fourth Wing pt 2');
  assert.equal(spine.format, 'audio');
  assert.equal(spine.again, true);
  assert.equal(v.onTheGo[0].again, true);
  assert.equal(v.onTheGo[0].percent, 85);
  assert.equal(v.bookmarks[0].heard, 'Jun 2025');
  assert.deepEqual(v.heardAgain.map((b) => b.label), ['on it again now, 85% in', 'heard twice, again in Sep 2025']);
  assert.ok(v.numbers.some((n) => n.label === 'gone back to' && n.value === '2'));
});

test('listeningView: tapes, years from the plays, stayers, the deck', () => {
  const art = 'https://yt3.ggpht.com/abc=w226-h226-l90-rj';
  const v = listeningView({
    music: { loves: 3, since: '2018-11' }, playlistCount: 1,
    playlists: [{ title: 'Running', tracks: 50, hours: 3.2, artists: ['A', 'B', 'C', 'D'], arts: [art, art, art, art], loved: 5, heard: 8 }],
    musicYears: [{ year: 2024, plays: 300, hours: 20.5, artists: 40, songs: [{ rank: 2, title: 'Two', by: 'X', art, plays: 9 }], topArtist: { name: 'X', plays: 40 } },
      { year: 2018, plays: 26, hours: 2.9, artists: 5, songs: [{ rank: 1, title: 'One', by: 'X', art, plays: 3 }], topArtist: null }],
    deck: [{ kind: 'song', title: 'A', by: 'X', art, plays: 6 }, { kind: 'podcast', title: 'P', art: 'https://storage.googleapis.com/fitglue-server-prod-showcase-assets/site/james/life/podcasts/0123456789abcdef.jpg', plays: 3 },
      { kind: 'song', title: 'B', plays: 2 }, { kind: 'song', title: 'C', plays: 1 }],
    stayers: [{ title: 'S', by: 'Y', years: [2023, 2024] }],
  });
  assert.equal(v.tapes[0].artists, 'A, B, C');
  assert.equal(v.tapes[0].arts.length, 4);
  assert.equal(v.tapes[0].heard, '16% of it played');
  assert.equal(v.years[0].lead.rank, 2);
  assert.equal(v.years[0].topArtist, 'X, 40 plays');
  assert.equal(v.years[0].leadPlays, '9 plays');
  assert.equal(v.years[0].part, '');
  assert.equal(v.years[1].part, 'from Nov');
  assert.equal(v.sinceLabel, 'Nov 2018');
  assert.equal(v.deck?.n, 4);
  assert.equal(v.deck?.items[1].podcast, true);
  assert.equal(v.deck?.items[1].plays, '3 episodes');
  assert.ok(v.deck?.items[1].art.endsWith('/podcasts/0123456789abcdef.jpg'));
  assert.equal(shelfArt('https://i.ytimg.com/pl_c/PLab-1/studio_square_thumbnail.jpg?sqp=x-Y&rs=1'), '', 'signed YouTube covers expire: never linked');
  assert.equal(v.stayers[0].years, '2023 · 2024');
  assert.ok(v.numbers.some((n) => n.label === 'playlists made'));
});

test('listening: podcasts feed and stacked ear months', () => {
  const v = listeningView({
    podcasts: [{ name: 'The Show', episodes: 40, hours: 30.5, since: '2024-01', last: '2026-10', apps: 2 },
      { name: 'Small', episodes: 1, hours: 0.8, since: '2026-09', last: '2026-09', apps: 1 }],
    earMonths: [{ month: '2026-01', musicHours: 30, podcastHours: 10 }, { month: '2026-02', musicHours: 20, podcastHours: 0 }],
  });
  assert.equal(v.podcasts[0].pct, 100);
  assert.equal(v.podcasts[0].both, true);
  assert.equal(v.podcasts[0].span, 'Jan 2024 to Oct 2026');
  assert.equal(v.podcasts[1].one, true);
  assert.equal(v.podcasts[1].span, 'Sep 2026');
  assert.deepEqual(v.earBars.map((b) => [b.music, b.podcast]), [[75, 25], [50, 0]]);
  assert.equal(v.earBars[0].newYear, true);
  assert.equal(v.earPodcasts, true);
});

test('relationsView: racks share one ink with their years, gold or silver discs, soundtrack tie-ins', () => {
  const v = listeningView({
    racks: [{ rack: 'Drum & bass', share: 40, plays: 400, artists: 3, top: ['A', 'B'] }, { rack: 'Pop', share: 10, plays: 100, artists: 1, top: ['C'] }],
    rackYears: [{ year: 2024, shares: { Pop: 30, 'Drum & bass': 60, Unknown: 10 }, lead: 'Drum & bass' }],
    relCoverage: { artists: 250, of: 4000, plays: 50, racked: 45, awarded: 2 },
    goldDiscs: [
      { name: 'Winner', won: 3, noms: 5, awards: [{ award: 'grammy', won: 2, noms: 3, best: 'Song of the Year' }, { award: 'brit', won: 1, noms: 2, best: '' }],
        mine: [{ title: 'Hit', plays: 12, award: 'grammy' }] },
      { name: 'Nearly', won: 0, noms: 1, awards: [{ award: 'mercury', won: 0, noms: 1, best: '' }], mine: [] },
      { name: 'Bad', won: 1, noms: 1, awards: [] },
    ],
    origins: [{ code: 'GB', name: 'UK', share: 60, artists: 10, top: ['A'] }],
    eras: [{ decade: 2010, share: 70, artists: 5, top: ['A'] }],
    screenMusic: [{ title: 'Film', kind: 'film', plays: 9, tracks: 2, songs: [{ title: 'Theme', by: 'Comp' }], page: 'watching', key: 'k' },
      { title: 'Game', kind: 'game', plays: 5, tracks: 1, songs: [{ title: 'Song', by: 'X' }], page: 'nowhere', art: 'https://evil.example/a.jpg' },
      { title: 'Empty', plays: 5, songs: [] }],
  });
  assert.deepEqual(v.racks.map((r) => [r.name, r.ink, r.height]), [['Drum & bass', 0, 100], ['Pop', 1, 34]]);
  assert.deepEqual(v.rackYears[0].parts.map((p) => [p.rack, p.ink]), [['Drum & bass', 0], ['Pop', 1]], 'unknown racks never drawn, rack order kept');
  assert.equal(v.rackYears[0].parts[0].pct, 66.7);
  assert.match(v.rackNote, /250 most played artists of 4,000, which is 45%/);
  assert.deepEqual(v.gold.map((g) => [g.name, g.tier]), [['Winner', 'gold'], ['Nearly', 'silver']]);
  assert.deepEqual(v.gold[0].lines, ['2 Grammys', '1 Brit']);
  assert.equal(v.gold[0].best, 'Grammy: Song of the Year');
  assert.equal(v.gold[0].mine, 'including Hit, 12 plays from me');
  assert.deepEqual(v.gold[1].lines, ['1 Mercury Prize nomination']);
  assert.equal(v.eras[0].decade, '10s');
  assert.deepEqual(listeningView({ relCoverage: { wins: { grammy: 4, oscar: 1, nope: 3 } } }).goldTally, [{ n: '4', prize: 'a Grammy' }, { n: '1', prize: 'an Oscar' }]);
  assert.deepEqual(v.screens.map((s) => [s.title, s.kind, s.href, s.art]), [['Film', 'film', '/life/watching', ''], ['Game', 'game', '', '']]);
  assert.equal(v.screens[0].across, 'across 2 songs');
});

test('reading: a book on paper from Hardcover (pages, a year-only finish, rereads)', () => {
  const cover = 'https://assets.hardcover.app/external_data/1278417/409d17977aff8908e0fa9541b4b9e547ac1f8f55.jpeg';
  assert.equal(shelfArt('https://assets.hardcover.app/editions/26853601/8a803516-635c-40a4-b430-a682a15f7a58-tforeverwar.jpg'), 'https://assets.hardcover.app/editions/26853601/8a803516-635c-40a4-b430-a682a15f7a58-tforeverwar.jpg');
  const v = readingView({
    shelf: [{ key: 'k1', title: 'Office Novel', by: 'A Writer', finished: '2018', format: 'print', pages: 466, reads: 3, again: true, cover }],
    byYear: [{ year: '2018', books: 1, hours: 0, pages: 466 }],
    bookStats: { finished: 1, hours: 0, print: 1, pages: 466, again: 1 },
    heardAgain: [{ title: 'Office Novel', format: 'print', state: 'twice', reads: 3, cover }],
  });
  const sp = v.shelf.find((s) => !s.bookend);
  assert.equal(sp.format, 'print');
  assert.equal(sp.monthLabel, '2018');
  assert.equal(sp.hours, '466 pages');
  assert.equal(sp.times, 3);
  assert.equal(sp.againLabel, 'finished 3 times');
  assert.equal(sp.cover, cover);
  assert.equal(v.shelf[0].hours, '466 pages');
  assert.ok(v.numbers.some((n) => n.label === 'pages turned' && n.value === '466'));
  assert.equal(v.heardAgain[0].label, 'finished 3 times, on paper');
  assert.equal(v.yearBars[0].hours, '466 pages');
});

test('reading: read it, heard it', () => {
  const v = readingView({ bothWays: [
    { title: 'Space Book', by: 'E Writer', cover: COVER, times: [
      { when: '2018', format: 'print' }, { when: '2021-06', format: 'audio', narrator: 'Voice One' }, { when: '2025-04', format: 'audio' }] },
    { title: 'Lonely', times: [{ when: '2020', format: 'print' }] },
  ] });
  assert.equal(v.bothWays.length, 1);
  assert.deepEqual(v.bothWays[0].times.map((t) => [t.when, t.how]),
    [['2018', 'on paper'], ['Jun 2021', 'read by Voice One'], ['Apr 2025', 'audiobook']]);
});
