// @ts-check
/**
 * The /life page's clock (S6). Everything on the page that depends on *today*:
 * "in 3 days", "tomorrow 18:00", "happening now", which week the calendar strip
 * shows, which of its days is today / past / still to come, and THIS WEEK vs
 * LATEST WEEK on the roundup block. All of it is computed from absolute dates.
 *
 * One source, two runtimes:
 *   - the build (tasks/fitness-life.mjs) imports these functions and bakes the
 *     "on the calendar" section with the build's `now`: what a reader with JS
 *     off sees;
 *   - the page inlines this file as a classic script (clientScript(): `export`
 *     dropped, wrapped in an IIFE that calls bootLife), which renders the same
 *     section again with the reader's `now`, then again once events.json has
 *     been fetched fresh from the bucket. So a page built yesterday says the
 *     right thing today, and a calendar change needs no rebuild.
 *
 * Hence the rules for this file: no imports, browser-safe syntax only, and no
 * closing script tag anywhere in it (life-clock.test.mjs checks).
 */

export const TZ = 'Europe/London';
export const WEEK_DAYS = 7;
export const NEXT_UP_COUNT = 5;
export const DAY_MS = 86_400_000;
export const META = {
  calendar: 'races & one-offs, the regular sessions, and what actually got done',
  handwritten: 'races & events, hand-written for now',
};

// ---------------------------------------------------------------------------
// Dates in the site timezone

/** @param {string|undefined|null} iso @returns {Date|null} */
export function parse(iso) {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? null : new Date(t);
}

/** @param {Date} d @param {Intl.DateTimeFormatOptions} opts */
export function fmt(d, opts) {
  // en-GB abbreviates September as "Sept"; the zine wants three letters everywhere.
  return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, ...opts }).format(d).replace(/\bSept\b/, 'Sep');
}

/** `YYYY-MM-DD` in the site timezone. @param {Date} d */
export function ymd(d) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d); // en-CA gives ISO order
}

/** `12:10` in the site timezone (h23 so midnight is 00:00, never 24:00). @param {Date} d */
export function hm(d) {
  return fmt(d, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}

/** Whole days since the epoch of the site-local date of `d`. @param {Date} d */
export function dayIndex(d) {
  const [y, m, day] = ymd(d).split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, day) / DAY_MS);
}

/** The site-local noon of the day `offset` days after `now`'s day. @param {Date} now @param {number} offset */
export function localDay(now, offset) {
  const [y, m, d] = ymd(now).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + offset, 12));
}

/** Monday (site-local noon) of the week containing `now`. @param {Date} now */
export function weekMonday(now) {
  const dow = (dayIndex(now) + 3) % 7; // 1970-01-01 was a Thursday → Monday = 0
  return localDay(now, -dow);
}

/** `SAT 17 OCT` @param {Date} d */
export function dayStamp(d) {
  return fmt(d, { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '').toUpperCase();
}

/** `12 – 18 OCT 2026` for [start, endExclusive). @param {Date} start @param {Date} endExcl */
export function rangeLabel(start, endExcl) {
  const last = new Date(endExcl.getTime() - DAY_MS);
  const sameMonth = fmt(start, { month: 'short' }) === fmt(last, { month: 'short' });
  const left = sameMonth ? fmt(start, { day: 'numeric' }) : fmt(start, { day: 'numeric', month: 'short' });
  return `${left} – ${fmt(last, { day: 'numeric', month: 'short', year: 'numeric' })}`.toUpperCase();
}

// ---------------------------------------------------------------------------
// Relative wording

/**
 * `today 12:10`, `tomorrow`, `in 3 days`, `happening now`.
 * @param {Date} start @param {Date} end @param {boolean} allDay @param {Date} now
 */
export function countdown(start, end, allDay, now) {
  if (start <= now && end > now) return allDay ? 'today' : 'happening now';
  const diff = dayIndex(start) - dayIndex(now);
  const at = allDay ? '' : ` ${hm(start)}`;
  if (diff <= 0) return `today${at}`;
  if (diff === 1) return `tomorrow${at}`;
  return `in ${diff} days`;
}

/** The roundup block's kicker: THIS WEEK while `now` is inside the period. @param {Date} start @param {Date} end @param {Date} now */
export function weekKicker(start, end, now) {
  return now >= start && now < end ? 'THIS WEEK' : 'LATEST WEEK';
}

// ---------------------------------------------------------------------------
// The calendar section's model

/** A calendar title → the type family its colour comes from. @param {unknown} title */
export function typeKeyOfTitle(title) {
  const t = String(title || '').toLowerCase();
  if (/hyrox|crossfit|hybrid/.test(t)) return 'crossfit';
  if (/pilates|yoga|flexibility|stretch/.test(t)) return 'yoga';
  if (/strength|\bpt\b|weights|gym|lift/.test(t)) return 'strength';
  if (/\brun|parkrun|10k|5k|marathon/.test(t)) return 'run';
  if (/ride|cycl|spin|sportive|bike/.test(t)) return 'ride';
  if (/swim/.test(t)) return 'swim';
  if (/hiit|erg|circuit/.test(t)) return 'hiit';
  if (/walk|hike/.test(t)) return 'hike';
  return 'other';
}

/** Names that never appear in a public calendar title, after "&" or "and". */
const PRIVATE_NAMES = ['Sarah', 'Sara'];

/**
 * A calendar title with partner or people phrases removed: "with <Name>" and
 * "w/ <Name>" (any capitalised name), and "& <Name>" / "and <Name>" for the
 * listed private names. Backstop for the exporter, which also screens them.
 * @param {unknown} title
 */
export function cleanTitle(title) {
  const names = PRIVATE_NAMES.join('|');
  const out = String(title ?? '')
    .replace(/\s*[-\u2013\u2014,(]?\s*\b(?:with|w\/)\s+[A-Z][\p{L}'\u2019-]*(?:\s+[A-Z][\p{L}'\u2019-]*)*\)?/gu, '')
    .replace(new RegExp(`\\s*(?:&|\\band\\b)\\s+(?:${names})\\b`, 'gu'), '')
    .replace(new RegExp(`\\b(?:${names})\\b\\s*(?:&|\\band\\b)\\s*`, 'gu'), '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return out;
}

/** A location is public only for races and parkruns. @param {any} e */
export function publicLocation(e) {
  if (!e || typeof e.location !== 'string') return '';
  return e.kind === 'race' || /\bparkrun\b/i.test(String(e.title || '')) ? e.location : '';
}

/**
 * An export entry as the page may hold and show it: no description or notes,
 * a location only for races and parkruns, a title without people phrases.
 * @param {any} e
 */
export function publicEvent(e) {
  if (!e || typeof e !== 'object') return e;
  const { description, notes, ...rest } = e;
  void description; void notes;
  const title = typeof e.title === 'string' ? cleanTitle(e.title) || 'Session' : e.title;
  return { ...rest, title, location: publicLocation(e) };
}

/** A calendar export entry → parsed dates, or null when the start is unusable. @param {any} e */
export function parseEntry(e) {
  if (!e || typeof e.title !== 'string') return null;
  const start = parse(e.start);
  if (!start) return null;
  const end = parse(e.end) || start;
  return { start, end: end > start ? end : start, allDay: Boolean(e.allDay) };
}

/** @param {any} e export entry @param {{start: Date, end: Date, allDay: boolean}} t @param {Date} now */
export function nextUpEntry(e, t, now) {
  const race = e.kind === 'race';
  return {
    id: typeof e.id === 'string' ? e.id : '',
    title: cleanTitle(e.title),
    kind: race ? 'race' : 'event',
    stamp: race ? 'RACE' : 'EVENT',
    stampClass: race ? 'fit-event__stamp--race' : 'fit-event__stamp--event',
    emoji: race ? '🏁' : '📍',
    day: fmt(t.start, { day: 'numeric' }),
    month: fmt(t.start, { month: 'short', year: 'numeric' }),
    date: dayStamp(t.start),
    time: t.allDay ? '' : hm(t.start),
    when: countdown(t.start, t.end, t.allDay, now),
    location: publicLocation(e),
    dateTime: t.start.toISOString(),
    allDay: t.allDay,
  };
}

/**
 * This week, Monday to Sunday, from both calendars and the record: a day is
 * **active** when a session was actually logged on it (`done`), whatever was
 * planned; still-to-come calendar entries show as **planned**; a past day (or
 * today) with neither is a rest day, a future one is open. Races from the
 * Events calendar are marked.
 * @param {{ e: any, t: {start: Date, end: Date, allDay: boolean} }[]} upcoming  calendar entries not yet ended
 * @param {any[]} done  `{start, title, href, typeClass, typeKey}` sessions on the record (doneEntry in fitness-life.mjs)
 * @param {Date} now
 */
export function weekStrip(upcoming, done, now) {
  const monday = weekMonday(now);
  const todayKey = ymd(now);
  const logged = (Array.isArray(done) ? done : [])
    .map((x) => ({ x, t: parse(x && x.start) }))
    .filter((r) => r.t && typeof r.x.title === 'string')
    .sort((a, b) => /** @type {Date} */ (a.t).getTime() - /** @type {Date} */ (b.t).getTime());
  const days = [];
  for (let i = 0; i < WEEK_DAYS; i++) {
    const d = new Date(monday.getTime() + i * DAY_MS);
    const key = ymd(d);
    const doneToday = logged
      .filter((r) => ymd(/** @type {Date} */ (r.t)) === key)
      .map(({ x, t }) => ({
        title: x.title,
        time: hm(/** @type {Date} */ (t)),
        href: typeof x.href === 'string' ? x.href : '',
        typeClass: typeof x.typeClass === 'string' ? x.typeClass : '',
        typeKey: typeof x.typeKey === 'string' ? x.typeKey : '',
      }));
    const planned = upcoming
      .filter(({ t }) => ymd(t.start) === key)
      .sort((a, b) => a.t.start.getTime() - b.t.start.getTime())
      .map(({ e, t }) => {
        const race = e.calendar === 'events';
        return {
          title: cleanTitle(e.title),
          time: t.allDay ? '' : hm(t.start),
          kind: race ? (e.kind === 'race' ? 'race' : 'event') : (e.kind === 'class' ? 'class' : 'session'),
          isEvent: race,
          typeClass: `fit-type--${typeKeyOfTitle(e.title)}`,
          location: publicLocation(e),
        };
      });
    const isToday = key === todayKey;
    const isPast = key < todayKey;
    const state = doneToday.length ? 'active' : planned.length ? 'planned' : isPast || isToday ? 'rest' : 'open';
    days.push({
      key,
      dow: fmt(d, { weekday: 'short' }).toUpperCase(),
      num: fmt(d, { day: 'numeric' }),
      label: fmt(d, { weekday: 'long', day: 'numeric', month: 'short' }).replace(',', ''),
      isToday,
      isPast,
      done: doneToday,
      hasDone: doneToday.length > 0,
      planned,
      hasPlanned: planned.length > 0,
      state,
      stateClass: `fit-week-strip__day--${state}`,
      isRest: state === 'rest',
      isOpen: state === 'open',
      count: doneToday.length + planned.length,
    });
  }
  return days;
}

/**
 * The "on the calendar" section at `now`. `data.source` says where `events`
 * came from: 'calendar' (events.json, the Fitness Events / Fitness Regular
 * calendars) or 'handwritten' (fitness.json, already in the export's shape;
 * it feeds Next up only, never the week). Next up is the Events calendar only:
 * the big things. Past entries are never shown; with nothing upcoming and
 * nothing logged this week the section is empty.
 * @param {{ events?: any[], done?: any[], source?: string }} data
 * @param {Date} now
 */
export function calendarModel(data, now) {
  const isCal = data.source === 'calendar';
  const upcoming = (Array.isArray(data.events) ? data.events : [])
    .map((e) => ({ e, t: parseEntry(e) }))
    .filter((x) => x.t && x.t.end > now)
    .map((x) => ({ e: x.e, t: /** @type {{start: Date, end: Date, allDay: boolean}} */ (x.t) }))
    .sort((a, b) => a.t.start.getTime() - b.t.start.getTime());
  const week = weekStrip(isCal ? upcoming : [], data.done || [], now);
  const hasWeek = week.some((d) => d.count > 0);
  const nextUp = upcoming
    .filter(({ e }) => e.calendar === 'events')
    .slice(0, NEXT_UP_COUNT)
    .map(({ e, t }) => nextUpEntry(e, t, now));
  const source = isCal ? 'calendar' : nextUp.length ? 'handwritten' : 'none';
  const monday = weekMonday(now);
  return {
    source,
    meta: isCal ? META.calendar : nextUp.length ? META.handwritten : '',
    nextUp,
    hasNextUp: nextUp.length > 0,
    week: hasWeek ? week : [],
    hasWeek,
    weekRange: hasWeek ? rangeLabel(monday, new Date(monday.getTime() + WEEK_DAYS * DAY_MS)) : '',
    activeDays: week.filter((d) => d.hasDone).length,
    hasAny: nextUp.length > 0 || hasWeek,
  };
}

// ---------------------------------------------------------------------------
// Rendering (the build and the browser produce the same markup)

/** @param {unknown} s */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c));
}

/** @param {any} e a nextUpEntry */
function renderEvent(e) {
  return `<li class="fit-event fit-event--${esc(e.kind)}">
<div class="fit-event__date">
<span class="fit-event__day">${esc(e.day)}</span>
<span class="fit-event__month">${esc(e.month)}</span>
</div>
<div class="fit-event__body">
<h3 class="fit-event__title"><span aria-hidden="true">${esc(e.emoji)}</span> ${esc(e.title)}</h3>
<div class="fit-event__meta">
<span class="stamp fit-event__stamp ${esc(e.stampClass)}">${esc(e.stamp)}</span>
<time class="fit-event__when" datetime="${esc(e.dateTime)}">${esc(e.when)}</time>
${e.location ? `<span class="fit-event__where">· ${esc(e.location)}</span>` : ''}
</div>
</div>
</li>`;
}

/** @param {any} d a weekStrip day */
function renderDay(d) {
  const done = d.done.map((/** @type {any} */ s) => `<li class="fit-week-strip__session fit-week-strip__session--done ${esc(s.typeClass)}"><a href="${esc(s.href)}"><span class="fit-week-strip__time">${esc(s.time)}</span> ${esc(s.title)}</a></li>`);
  const planned = d.planned.map((/** @type {any} */ s) => `<li class="fit-week-strip__session fit-week-strip__session--planned fit-week-strip__session--${esc(s.kind)} ${esc(s.typeClass)}">${s.time ? `<span class="fit-week-strip__time">${esc(s.time)}</span> ` : ''}${esc(s.title)}</li>`);
  return `<li class="fit-week-strip__day ${esc(d.stateClass)}${d.isToday ? ' fit-week-strip__day--today' : ''}" title="${esc(d.label)}">
<div class="fit-week-strip__head">
<span class="fit-week-strip__dow">${esc(d.dow)}</span>
<span class="fit-week-strip__num">${esc(d.num)}</span>
${d.isToday ? '<span class="fit-week-strip__today">today</span>' : ''}
</div>
<ul class="fit-week-strip__list">${done.concat(planned).join('\n')}</ul>
${d.isRest ? '<span class="fit-week-strip__rest">rest</span>' : ''}${d.isOpen ? '<span class="fit-week-strip__rest">—</span>' : ''}
</li>`;
}

/** The section's inner HTML; '' when there is nothing to show (not even the header). @param {ReturnType<typeof calendarModel>} m */
export function renderCalendar(m) {
  if (!m.hasAny) return '';
  const parts = [`<div class="fit-header-row">
<h2 class="fit-header">on the <span>calendar</span>.</h2>
<span class="fit-header-row__meta">${esc(m.meta)}</span>
</div>`];
  if (m.hasNextUp) {
    parts.push(`<h3 class="fit-cal__kicker">next up</h3>
<ul class="fit-events">
${m.nextUp.map(renderEvent).join('\n')}
</ul>`);
  }
  if (m.hasWeek) {
    parts.push(`<h3 class="fit-cal__kicker">this week <span>· ${esc(m.weekRange)} · ${esc(m.activeDays)} active</span></h3>
<ol class="fit-week-strip">
${m.week.map(renderDay).join('\n')}
</ol>
<p class="fit-week-strip__key"><span class="fit-week-strip__key-done">done</span> logged on the record · <span class="fit-week-strip__key-planned">planned</span> on the calendar · 🏁 race</p>`);
  }
  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// The browser side

/** events.json is usable when it is `{events: [...]}`. @param {any} doc */
export function validEvents(doc) {
  return Boolean(doc && typeof doc === 'object' && Array.isArray(doc.events));
}

/**
 * Re-render the time-relative parts of /life for the reader's clock. The page
 * carries `[data-life-calendar]` (the baked section) and
 * `<script type="application/json" id="life-calendar-data">` with
 * `{builtAt, source, events, done, eventsUrl}`; roundup kickers carry
 * `data-week-start` / `data-week-end`.
 *
 * The DOM is only touched when the markup actually changes: the baked HTML is
 * reproduced from `builtAt` first and compared, so an unchanged section is
 * never rewritten (no layout shift). events.json is then fetched with
 * revalidation; a failure keeps the baked events. Re-checked every minute and
 * whenever the tab comes back, so "happening now" and midnight roll over.
 * @param {any} doc  document
 * @param {any} win  window (fetch, setInterval)
 * @returns {{ paint: () => boolean, refresh: () => Promise<boolean>, now: () => Date } | null}
 */
export function bootLife(doc, win) {
  const root = doc.querySelector('[data-life-calendar]');
  const dataEl = doc.getElementById('life-calendar-data');
  if (!root || !dataEl) return null;
  let data;
  try {
    data = JSON.parse(dataEl.textContent || '');
  } catch (err) {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const now = () => new Date();
  const state = { events: data.events, source: data.source, done: data.done };
  const built = parse(data.builtAt);
  let current = built ? renderCalendar(calendarModel(state, built)) : null;

  const paint = () => {
    const at = now();
    const kickers = doc.querySelectorAll('[data-week-start]');
    for (let i = 0; i < kickers.length; i++) {
      const el = kickers[i];
      const s = parse(el.getAttribute('data-week-start'));
      const e = parse(el.getAttribute('data-week-end'));
      if (s && e) {
        const k = weekKicker(s, e, at);
        if (el.textContent !== k) el.textContent = k;
      }
    }
    const html = renderCalendar(calendarModel(state, at));
    if (html === current) return false;
    current = html;
    root.innerHTML = html;
    return true;
  };

  const refresh = () => {
    if (!data.eventsUrl || typeof win.fetch !== 'function') return Promise.resolve(false);
    return win.fetch(data.eventsUrl, { cache: 'no-cache', mode: 'cors' })
      .then((/** @type {any} */ r) => (r && r.ok ? r.json() : null))
      .then((/** @type {any} */ doc2) => {
        if (!validEvents(doc2)) return false;
        state.events = doc2.events;
        state.source = 'calendar';
        return paint();
      })
      .catch(() => false);
  };

  paint();
  refresh();
  if (typeof win.setInterval === 'function') win.setInterval(paint, 60_000);
  if (doc.addEventListener) {
    doc.addEventListener('visibilitychange', () => {
      if (doc.visibilityState === 'visible') { paint(); refresh(); }
    });
  }
  return { paint, refresh, now };
}

/**
 * This file as an inline classic script for the page: comments and `export`
 * keywords dropped, wrapped in an IIFE that boots on the live document. Only
 * JSDoc blocks and whole-line `//` comments are removed (this file keeps no
 * comment-like text inside strings).
 * @param {string} source the text of life-clock.mjs
 */
export function clientScript(source) {
  const body = source
    .replace(/\/\*\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*\n/gm, '')
    .replace(/^export (?=(?:async )?function |const |let |class )/gm, '')
    .replace(/\n{3,}/g, '\n\n');
  return `(function () {\n'use strict';\n${body}\nbootLife(document, window);\n})();`;
}
