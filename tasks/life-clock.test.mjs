// @ts-check
// Run with `npm test` (node:test). The /life clock (S6): pure functions with a
// fixed date, then the inlined page script itself, run in a vm context whose
// Date is faked, against a minimal fake DOM.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

import {
  countdown, weekKicker, typeKeyOfTitle, calendarModel, renderCalendar, weekMonday, ymd, clientScript, esc,
} from './life-clock.mjs';

const SOURCE = await fs.readFile(new URL('./life-clock.mjs', import.meta.url), 'utf8');

// Sunday 25 Oct 2026 10:00Z — the clocks went back that morning (BST → GMT).
const SUN = new Date('2026-10-25T10:00:00Z');
const MON = new Date('2026-10-26T10:00:00Z');
const day = (n) => new Date(SUN.getTime() + n * 86_400_000);

const EVENTS = [
  { id: 'r', calendar: 'events', title: 'Rutland Night 10k', start: '2026-11-01T17:30:00Z', end: '2026-11-01T18:30:00Z', allDay: false, kind: 'race', location: 'Rutland Water' },
  { id: 'h', calendar: 'events', title: 'Hyrox London', start: '2027-01-30T00:00:00Z', end: '2027-01-31T00:00:00Z', allDay: true, kind: 'race' },
  { id: 's', calendar: 'regular', title: 'Spin class', start: '2026-10-27T18:00:00Z', end: '2026-10-27T19:00:00Z', allDay: false, kind: 'class' },
];
const DONE = [
  { start: '2026-10-24T09:00:00Z', title: 'Colwick parkrun', href: '/life/activity/colwick', typeClass: 'fit-type--run', typeKey: 'run' },
];
const data = (builtAt, extra = {}) => ({ builtAt: builtAt.toISOString(), source: 'calendar', events: EVENTS, done: DONE, eventsUrl: '', ...extra });

describe('pure clock', () => {
  test('countdown wording, by site-local day', () => {
    assert.equal(countdown(new Date('2026-11-01T17:30:00Z'), new Date('2026-11-01T18:30:00Z'), false, SUN), 'in 7 days');
    assert.equal(countdown(new Date('2026-10-26T07:00:00Z'), new Date('2026-10-26T08:00:00Z'), false, SUN), 'tomorrow 07:00');
    assert.equal(countdown(new Date('2026-10-25T18:00:00Z'), new Date('2026-10-25T19:00:00Z'), false, SUN), 'today 18:00');
    assert.equal(countdown(new Date('2026-10-25T09:00:00Z'), new Date('2026-10-25T11:00:00Z'), false, SUN), 'happening now');
    assert.equal(countdown(new Date('2026-10-25T00:00:00Z'), new Date('2026-10-26T00:00:00Z'), true, SUN), 'today');
    // 23:30 BST on Sat 24 Oct is still Saturday in London, though it is 22:30Z
    assert.equal(countdown(new Date('2026-10-25T08:00:00Z'), new Date('2026-10-25T09:00:00Z'), false, new Date('2026-10-24T22:30:00Z')), 'tomorrow 08:00');
  });

  test('weekKicker and the Monday of the week', () => {
    const s = new Date('2026-10-19T00:00:00Z');
    const e = new Date('2026-10-26T00:00:00Z');
    assert.equal(weekKicker(s, e, SUN), 'THIS WEEK');
    assert.equal(weekKicker(s, e, MON), 'LATEST WEEK');
    assert.equal(ymd(weekMonday(SUN)), '2026-10-19');
    assert.equal(ymd(weekMonday(MON)), '2026-10-26');
  });

  test('typeKeyOfTitle', () => {
    assert.equal(typeKeyOfTitle('Hyrox Class'), 'crossfit');
    assert.equal(typeKeyOfTitle('Spin'), 'ride');
    assert.equal(typeKeyOfTitle('Book club'), 'other');
  });

  test('esc', () => {
    assert.equal(esc(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });
});

describe('a page built yesterday reads right today (only the clock changes)', () => {
  test('the countdown moves on a day', () => {
    const built = calendarModel(data(day(-1)), day(-1));
    const today = calendarModel(data(day(-1)), SUN);
    assert.equal(built.nextUp[0].when, 'in 8 days');
    assert.equal(today.nextUp[0].when, 'in 7 days');
    assert.equal(calendarModel(data(SUN), day(7)).nextUp[0].when, 'today 17:30');
    assert.equal(calendarModel(data(SUN), new Date('2026-11-01T18:00:00Z')).nextUp[0].when, 'happening now');
    // after it ends it is gone from Next up, and the next one leads
    assert.equal(calendarModel(data(SUN), day(8)).nextUp[0].title, 'Hyrox London');
  });

  test('today moves along the strip; Monday starts a new week', () => {
    const sat = calendarModel(data(day(-1)), day(-1));
    const sun = calendarModel(data(day(-1)), SUN);
    assert.equal(sat.week.findIndex((d) => d.isToday), 5);
    assert.equal(sun.week.findIndex((d) => d.isToday), 6);
    assert.equal(sat.weekRange, '19 – 25 OCT 2026');
    // Saturday's parkrun is done either way; Sunday is "rest" until something happens
    assert.equal(sun.week[5].state, 'active');
    assert.equal(sun.week[6].state, 'rest');
    assert.equal(sat.week[6].state, 'open');

    const mon = calendarModel(data(day(-1)), MON);
    assert.equal(mon.weekRange, '26 OCT – 1 NOV 2026');
    assert.deepEqual(mon.week.map((d) => d.state), ['rest', 'planned', 'open', 'open', 'open', 'open', 'planned']);
    assert.equal(mon.activeDays, 0, 'last week\'s parkrun is not this week\'s');
  });

  test('handwritten events feed Next up, never the week', () => {
    const m = calendarModel({ source: 'handwritten', events: EVENTS, done: [] }, SUN);
    assert.equal(m.source, 'handwritten');
    assert.equal(m.meta, 'races & events, hand-written for now');
    assert.equal(m.hasWeek, false);
    assert.equal(m.nextUp.length, 2);
  });

  test('nothing upcoming, nothing logged: no section at all', () => {
    assert.equal(renderCalendar(calendarModel({ source: 'calendar', events: [], done: [] }, SUN)), '');
  });
});

// ---------------------------------------------------------------------------
// The inlined script in a fake browser

function fakeElement(attrs = {}) {
  return {
    textContent: '',
    innerHTML: '',
    writes: 0,
    getAttribute: (k) => (k in attrs ? attrs[k] : null),
  };
}

/**
 * Run clientScript(SOURCE) with Date pinned to `at` and a fake document holding
 * the baked section for `pageData`. `fetchResult`: an events.json object, or an
 * Error to reject with.
 */
async function runPage(at, pageData, fetchResult = null) {
  const builtHtml = renderCalendar(calendarModel(pageData, new Date(pageData.builtAt)));
  const root = fakeElement();
  let html = builtHtml;
  Object.defineProperty(root, 'innerHTML', {
    get: () => html,
    set: (v) => { html = v; root.writes += 1; },
  });
  const dataEl = fakeElement();
  dataEl.textContent = JSON.stringify(pageData);
  const kicker = fakeElement({ 'data-week-start': '2026-10-19T00:00:00.000Z', 'data-week-end': '2026-10-26T00:00:00.000Z' });
  kicker.textContent = 'THIS WEEK';
  const fetches = [];
  const intervals = [];
  const document = {
    querySelector: (sel) => (sel === '[data-life-calendar]' ? root : null),
    getElementById: (id) => (id === 'life-calendar-data' ? dataEl : null),
    querySelectorAll: (sel) => (sel === '[data-week-start]' ? [kicker] : []),
    addEventListener() {},
    visibilityState: 'visible',
  };
  let settle;
  const fetched = new Promise((r) => { settle = r; });
  const window = {
    fetch: (url, opts) => {
      fetches.push({ url, opts });
      const p = fetchResult instanceof Error ? Promise.reject(fetchResult)
        : Promise.resolve({ ok: Boolean(fetchResult), json: async () => fetchResult });
      const done = () => setTimeout(settle, 0);
      p.then(done, done);
      return p;
    },
    setInterval: (fn, ms) => intervals.push(ms),
  };
  const fixed = at.getTime();
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(fixed); }
    static now() { return fixed; }
  }
  const ctx = vm.createContext({ Date: FakeDate, Intl, document, window, JSON, Promise, setTimeout });
  vm.runInContext(clientScript(SOURCE), ctx);
  const writesBeforeFetch = root.writes;
  if (pageData.eventsUrl) await fetched;
  return { root, html: () => html, builtHtml, kicker, fetches, intervals, writesBeforeFetch };
}

describe('the page script (clientScript in a vm, Date faked)', () => {
  test('is a classic script: no exports, no closing script tag, boots at the end', () => {
    const js = clientScript(SOURCE);
    assert.doesNotMatch(js, /^export /m);
    assert.doesNotMatch(js, /^import /m);
    assert.equal(js.toLowerCase().includes('</script'), false);
    assert.doesNotThrow(() => new vm.Script(js));
  });

  test('read at the build instant: the DOM is not touched (no layout shift)', async () => {
    const page = await runPage(SUN, data(SUN));
    assert.equal(page.root.writes, 0);
    assert.equal(page.kicker.textContent, 'THIS WEEK');
    assert.deepEqual(page.intervals, [60_000]);
  });

  test('built yesterday, read today: the countdown and today are redone', async () => {
    const page = await runPage(SUN, data(day(-1)));
    assert.match(page.builtHtml, />in 8 days</);
    assert.equal(page.root.writes, 1);
    assert.match(page.html(), />in 7 days</);
    assert.match(page.html(), /fit-week-strip__day--rest fit-week-strip__day--today" title="Sunday 25 Oct"/);
  });

  test('built Sunday, read Monday: a new week, and the roundup is no longer THIS WEEK', async () => {
    const page = await runPage(MON, data(SUN));
    assert.match(page.html(), /this week <span>· 26 OCT – 1 NOV 2026 · 0 active/);
    assert.equal(page.kicker.textContent, 'LATEST WEEK');
  });

  test('a fresh events.json is fetched and rendered without a rebuild', async () => {
    const fresh = { generatedAt: '2026-10-25T09:00:00Z', events: [
      ...EVENTS,
      { id: 'n', calendar: 'events', title: 'New race', start: '2026-10-28T09:00:00Z', end: '2026-10-28T10:00:00Z', allDay: false, kind: 'race' },
    ] };
    const page = await runPage(SUN, data(SUN, { eventsUrl: 'https://bucket.test/events.json' }), fresh);
    assert.deepEqual(page.fetches.map((f) => [f.url, f.opts.cache]), [['https://bucket.test/events.json', 'no-cache']]);
    assert.equal(page.writesBeforeFetch, 0);
    assert.equal(page.root.writes, 1);
    assert.match(page.html(), /New race<\/h3>/);
    assert.match(page.html(), />in 3 days</);
  });

  test('the fetch fails or returns junk: the baked events stay', async () => {
    const failed = await runPage(SUN, data(SUN, { eventsUrl: 'https://bucket.test/events.json' }), new Error('offline'));
    assert.equal(failed.root.writes, 0);
    const junk = await runPage(SUN, data(SUN, { eventsUrl: 'https://bucket.test/events.json' }), { nope: true });
    assert.equal(junk.root.writes, 0);
    assert.equal(junk.html(), junk.builtHtml);
  });

  test('a hand-written page switches to the calendar once events.json loads', async () => {
    const page = await runPage(SUN, data(SUN, { source: 'handwritten', events: [], eventsUrl: 'https://bucket.test/events.json' }), { events: EVENTS });
    assert.equal(page.builtHtml, renderCalendar(calendarModel({ source: 'handwritten', events: [], done: DONE }, SUN)));
    assert.match(page.html(), /races &amp; one-offs, the regular sessions/);
  });
});

describe('privacy backstops (invented names)', () => {
  const NOON = new Date('2026-10-26T10:00:00Z');
  const mk = (over) => ({ id: 'x', calendar: 'events', title: 'Thing', start: '2026-10-28T10:00:00Z', end: '2026-10-28T11:00:00Z', allDay: false, kind: 'race', ...over });

  test('descriptions and notes are never rendered, in Next up or in the data', async () => {
    const { publicEvent } = await import('./life-clock.mjs');
    const ev = mk({ description: 'Secret note about Zelda', notes: 'private note', location: 'Some Venue' });
    const m = calendarModel({ source: 'calendar', events: [ev], done: [] }, NOON);
    assert.ok(!('description' in m.nextUp[0]));
    const html = renderCalendar(m);
    assert.ok(!html.includes('Secret note') && !html.includes('fit-event__desc'));
    const clean = publicEvent(ev);
    assert.ok(!('description' in clean) && !('notes' in clean));
  });

  test('a location shows only for races and parkruns', () => {
    const evs = [
      mk({ id: 'a', title: 'Valley 10k', kind: 'race', location: 'Valley Park' }),
      mk({ id: 'b', title: 'Testville parkrun', kind: 'other', location: 'Testville Rec' }),
      mk({ id: 'c', title: 'Spin', calendar: 'events', kind: 'other', location: '1 Example Rd, Testville AB1 2CD' }),
      mk({ id: 'd', title: 'Pilates', calendar: 'regular', kind: 'class', location: '2 Example Rd, Testville AB1 2CD' }),
    ];
    const m = calendarModel({ source: 'calendar', events: evs, done: [] }, NOON);
    const html = renderCalendar(m);
    assert.ok(html.includes('Valley Park') && html.includes('Testville Rec'));
    assert.ok(!html.includes('Example Rd') && !html.includes('AB1 2CD'));
    for (const d of m.week) for (const p of d.planned) if (p.title === 'Pilates' || p.title === 'Spin') assert.equal(p.location, '');
  });

  test('people phrases leave titles', async () => {
    const { cleanTitle } = await import('./life-clock.mjs');
    assert.equal(cleanTitle('Flexibility Pilates with Zelda'), 'Flexibility Pilates');
    assert.equal(cleanTitle('Pilates & Zelda'), 'Pilates');
    assert.equal(cleanTitle('Hyrox Doubles & Zelda'), 'Hyrox Doubles & Zelda'); // not a single activity word
    assert.equal(cleanTitle('Run with Zelda Quill'), 'Run');
    assert.equal(cleanTitle('Long run & coffee'), 'Long run & coffee');
    const m = calendarModel({ source: 'calendar', events: [mk({ title: 'Valley 10k with Zelda' })], done: [] }, NOON);
    assert.ok(!renderCalendar(m).includes('Zelda'));
  });

  test('the page script applies the same rules to a refetched events.json', () => {
    assert.ok(/publicLocation\(e\)/.test(SOURCE) && !/e\.description/.test(SOURCE));
  });
});
