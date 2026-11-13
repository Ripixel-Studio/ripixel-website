// @ts-check
/**
 * The roundup pages' story — data only. A week, a month and a year are different pages,
 * not one page at three sizes:
 *
 *   week   punchy: the lead highlight as the cover, the other moments as tickets, and the
 *          seven days as a strip of sessions (rest days included)
 *   month  a feature: a cover photo under the month's name, cover lines (the top
 *          moments), the write-up as the story, the moments with photos, a wall calendar
 *          with every session as a dot in its type's ink and each moment stamped on its
 *          day, the weeks as bars linking their own roundups, a photo mosaic
 *   year   the biggest: a cover collage, the top moments, the twelve months as stacked
 *          columns (each linking its roundup, with a cover photo), the year's races in
 *          order, a larger mosaic
 *
 * Highlights come from tasks/fitness-highlights.mjs (activity-level moments), plus the
 * period's own facts here: a run of active days, the busiest week/month on record.
 */
import { buildMoments, dayStreak, momentsIn, pickHighlights } from './fitness-highlights.mjs';
import { TAGS, tagOf, themeOf, tagTheme } from './fitness-theme.mjs';
import { cardPicture } from './fitness-life.mjs';

const DAY = 864e5;
const DOW = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const MOSAIC = { week: 8, month: 12, year: 18 };
const ROUTES = { week: 4, month: 8, year: 12 };
const STREAK_MIN = 4;

const num = (/** @type {unknown} */ v) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);
const https = (/** @type {unknown} */ u) => (typeof u === 'string' && /^https:\/\//i.test(u) ? u : '');
const isoDay = (/** @type {number} */ t) => new Date(t).toISOString().slice(0, 10);
const roundupHref = (/** @type {string} */ key) => `/life/roundup/${key}`;

/** ISO week key `week-44-2026` for a UTC day. @param {number} t */
function weekKeyOf(t) {
  const d = new Date(t);
  const day = (d.getUTCDay() + 6) % 7;
  const thu = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day + 3));
  const jan1 = Date.UTC(thu.getUTCFullYear(), 0, 1);
  const week = 1 + Math.floor((thu.getTime() - jan1) / DAY / 7);
  return `week-${String(week).padStart(2, '0')}-${thu.getUTCFullYear()}`;
}

/** Monday 00:00 UTC of the week containing t. @param {number} t */
function mondayOf(t) {
  const d = new Date(t);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
}

/** Metres → "42.5" km. @param {number} m */
const km = (m) => (m / 1000).toFixed(1);
/** Seconds → "1h 05m" / "45m". @param {number} s */
const dur = (s) => { const h = Math.floor(s / 3600); const m = Math.round((s % 3600) / 60); return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`; };

/** The one number a session shows in a small card. @param {any} e */
function stat(e) {
  const fam = tagOf(e).tag;
  const d = num(e.distanceMeters);
  if (d > 500 && ['run', 'ride', 'walk'].includes(fam)) return { value: km(d), unit: 'km' };
  const kg = num(e.totalWeightKg);
  if (kg > 0) return kg >= 1000 ? { value: (kg / 1000).toFixed(1), unit: 't' } : { value: String(Math.round(kg)), unit: 'kg' };
  return { value: dur(num(e.durationSeconds)), unit: '' };
}

export { weekKeyOf };

/**
 * Everything the stories share, built once per build.
 * @param {{ files: any[], entries: any[], past?: any[], roundupFiles?: any[], showPhotos?: boolean }} data
 *   showPhotos: the profile's showPhotoGallery; off, the stories carry no photos (routes still draw)
 */
export function storyContext({ files, entries, past = [], roundupFiles = [], showPhotos = true }) {
  const list = (Array.isArray(entries) ? entries : [])
    .filter((e) => e && typeof e.slug === 'string' && Number.isFinite(Date.parse(e.startTime || '')))
    .map((e) => ({ e, t: Date.parse(e.startTime) }))
    .sort((a, b) => a.t - b.t);
  const roundups = (Array.isArray(roundupFiles) ? roundupFiles : []).filter((f) => f && typeof f.key === 'string');
  return {
    moments: buildMoments({ files, entries: list.map((x) => x.e), past }),
    list,
    files: new Map((Array.isArray(files) ? files : []).filter((f) => f?.slug).map((f) => [f.slug, f])),
    keys: new Set(roundups.map((f) => f.key)),
    showPhotos,
    roundups,
  };
}

/** @param {ReturnType<typeof storyContext>} ctx @param {number} start @param {number} end */
function entriesIn(ctx, start, end) {
  return ctx.list.filter((x) => x.t >= start && x.t < end);
}

/** A highlight as the templates want it: ink, tags as text. @param {import('./fitness-highlights.mjs').Moment & { lead?: boolean }} m */
function ticket(m) {
  return {
    kind: m.kind, stamp: m.stamp, title: m.title, value: m.value, unit: m.unit, sub: m.sub, date: m.date,
    href: m.href, photo: m.photo, typeClass: m.typeClass, typeKey: m.typeKey,
    tags: m.tags, hasTags: m.tags.length > 0, lead: Boolean(m.lead), isRace: ['weekend', 'race'].includes(m.kind),
  };
}

/**
 * Facts about the period itself: the longest run of active days, and the busiest
 * week/month (on record, or of its year). Shaped as moments so they rank with the rest.
 * @param {any} file @param {'week'|'month'|'year'} type @param {{ e: any, t: number }[]} inPeriod @param {ReturnType<typeof storyContext>} ctx
 */
function periodFacts(file, type, inPeriod, ctx) {
  const start = Date.parse(file.roundup?.periodStart || '');
  const out = [];
  const streak = dayStreak(inPeriod.map((x) => isoDay(x.t)));
  if (streak.days >= STREAK_MIN && type !== 'year') {
    out.push(fact('streak', 'STREAK', `${streak.days} days in a row`, String(streak.days), 'days', `${shortDay(streak.from)} to ${shortDay(streak.to)}`, start, 28 + streak.days * 2));
  }
  if (type !== 'year') {
    const prefix = `${type}-`;
    const same = ctx.roundups.filter((f) => f.key.startsWith(prefix));
    const mine = num(file.roundup?.totalActivities);
    const year = new Date(start).getUTCFullYear();
    const sameYear = same.filter((f) => new Date(Date.parse(f.roundup?.periodStart || '')).getUTCFullYear() === year);
    const top = (/** @type {any[]} */ l) => mine > 0 && l.every((f) => f.key === file.key || num(f.roundup?.totalActivities) < mine);
    if (same.length >= 10 && top(same)) {
      out.push(fact('busiest', 'RECORD', `Most sessions in any ${type} on record`, String(mine), 'sessions', '', start, type === 'month' ? 58 : 46));
    } else if (sameYear.length >= 2 && top(sameYear)) {
      out.push(fact('busiest', 'BIGGEST', `Biggest ${type} of ${year}`, String(mine), 'sessions', '', start, 36));
    }
  }
  return out;
}

/** @returns {import('./fitness-highlights.mjs').Moment} */
function fact(kind, stamp, title, value, unit, sub, t, score) {
  return { id: `${kind}:${t}`, kind, stamp, title, value, unit, sub, t, date: '', href: null, photo: '', typeKey: 'other', typeClass: 'fit-type--other', score, slug: '', slugs: [], tags: [] };
}

/** "2026-10-19" → "19 Oct". @param {string} iso */
function shortDay(iso) {
  const [, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1][0]}${MONTHS[m - 1].slice(1).toLowerCase()}`;
}

/**
 * The page's photos: the highlights' first, then one per session that has one, newest
 * first, capped by period type.
 * @param {{ e: any, t: number }[]} inPeriod @param {any[]} highlights @param {'week'|'month'|'year'} type
 */
function mosaic(inPeriod, highlights, type) {
  const seen = new Set();
  const out = [];
  for (const h of highlights) {
    if (h.photo && !seen.has(h.photo)) {
      seen.add(h.photo);
      out.push({ url: h.photo, title: h.title, date: h.date, href: h.href, typeClass: h.typeClass, stamp: h.stamp });
    }
  }
  for (const { e } of [...inPeriod].reverse()) {
    const url = https(e.photoUrls?.[0]);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({ url, title: e.title || '', date: '', href: `/life/activity/${e.slug}`, typeClass: themeOf(e).typeClass, stamp: '' });
  }
  return out.slice(0, MOSAIC[type]);
}

/**
 * Route drawings for the period's longest outdoor sessions (the same shapes the session
 * cards draw from the export's already-trimmed points): the picture when there are no photos.
 * @param {{ e: any, t: number }[]} inPeriod @param {ReturnType<typeof storyContext>} ctx @param {'week'|'month'|'year'} type
 */
function routeShapes(inPeriod, ctx, type) {
  const out = [];
  for (const { e } of [...inPeriod].sort((a, b) => num(b.e.distanceMeters) - num(a.e.distanceMeters))) {
    const file = ctx.files.get(e.slug);
    if (!file || !Array.isArray(file.routePoints) || file.routePoints.length < 10) continue;
    const pic = cardPicture({ ...e, photoUrls: [], routeThumbnailUrl: '' }, file);
    if (!pic.route) continue;
    out.push({ ...pic.route, href: `/life/activity/${e.slug}`, title: e.title || '', km: num(e.distanceMeters) > 500 ? `${km(num(e.distanceMeters))} km` : '', typeClass: themeOf(e).typeClass });
    if (out.length >= ROUTES[type]) break;
  }
  return out;
}

/** The first route drawing among a moment's sessions, or null. @param {string[]} slugs @param {ReturnType<typeof storyContext>} ctx */
function routeOf(slugs, ctx) {
  for (const s of slugs) {
    const file = ctx.files.get(s);
    if (!file || !Array.isArray(file.routePoints) || file.routePoints.length < 10) continue;
    const pic = cardPicture({ ...(file.entry || {}), photoUrls: [], routeThumbnailUrl: '' }, file);
    if (pic.route) return pic.route;
  }
  return null;
}

/**
 * What a calendar day with sessions but no photo draws: its tags' inks stacked by time
 * (bottom up, in TAGS order, like the consistency strip), with the longest session's
 * route on top, or its tag's glyph when it has no route, and that session's headline
 * figure. Null for a rest day.
 * @param {{ e: any, t: number }[]} here @param {ReturnType<typeof storyContext>} ctx
 */
function dayFill(here, ctx) {
  if (!here.length) return null;
  /** @type {Map<string, number>} */
  const byTag = new Map();
  for (const { e } of here) byTag.set(tagOf(e).tag, (byTag.get(tagOf(e).tag) || 0) + Math.max(60, num(e.durationSeconds)));
  const total = [...byTag.values()].reduce((a, b) => a + b, 0);
  const order = Object.keys(TAGS);
  const main = [...here].sort((a, b) => num(b.e.durationSeconds) - num(a.e.durationSeconds))[0].e;
  const st = stat(main);
  return {
    bands: [...byTag.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
      .map(([t, secs]) => ({ typeClass: tagTheme(t).typeClass, share: `${((secs / total) * 100).toFixed(1)}%` })),
    route: routeOf([main.slug, ...here.map((x) => x.e.slug)], ctx),
    glyph: tagTheme(tagOf(main).tag).tagGlyph,
    stat: `${st.value}${st.unit ? ` ${st.unit}` : ''}`,
  };
}

/**
 * The lead ticket's own photo when the cover already shows its first: another photo from
 * the same sessions, else none (the cover says it).
 * @param {any} lead @param {any} cover @param {ReturnType<typeof storyContext>} ctx @param {string[]} slugs
 */
function leadPhoto(lead, cover, ctx, slugs) {
  if (!lead?.photo || !cover || cover.url !== lead.photo) return lead?.photo || '';
  for (const s of slugs) {
    const urls = (ctx.files.get(s)?.entry?.photoUrls || ctx.list.find((x) => x.e.slug === s)?.e.photoUrls || []).map(https).filter(Boolean);
    const other = urls.find((u) => u !== cover.url);
    if (other) return other;
  }
  return '';
}

/** @param {{ e: any, t: number }} x @param {Map<string, string>} marks @param {boolean} showPhotos */
function sessionCard({ e }, marks, showPhotos) {
  const theme = themeOf(e);
  const s = stat(e);
  return {
    title: e.title || 'Session', href: `/life/activity/${e.slug}`, ...theme,
    stat: s.value, statUnit: s.unit, photo: showPhotos ? https(e.photoUrls?.[0]) : '', mark: marks.get(e.slug) || '',
  };
}

/**
 * Everything the week, month and year layouts draw beyond the export's totals.
 * @param {{ key: string, roundup: any }} file
 * @param {'week'|'month'|'year'} type
 * @param {ReturnType<typeof storyContext>} ctx
 */
export function buildStory(file, type, ctx) {
  const start = Date.parse(file.roundup?.periodStart || '');
  const end = Date.parse(file.roundup?.periodEnd || '');
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const inPeriod = entriesIn(ctx, start, end);
  /** @type {Map<string, number>} */
  const famCount = new Map();
  for (const x of inPeriod) famCount.set(tagOf(x.e).tag, (famCount.get(tagOf(x.e).tag) || 0) + 1);
  const dominant = [...famCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 'other';
  const facts = periodFacts(file, type, inPeriod, ctx).map((f) => ({ ...f, typeKey: dominant, typeClass: `fit-type--${dominant}` }));
  const picked = pickHighlights([...momentsIn(ctx.moments, start, end), ...facts], type);
  const highlights = picked.map((m) => {
    const t = ticket(m);
    if (!ctx.showPhotos) t.photo = '';
    return { ...t, route: t.photo ? null : routeOf(m.slugs, ctx) };
  });
  const lead = highlights[0] || null;
  /** @type {Map<string, string>} the stamp each highlighted session wears */
  const marks = new Map();
  for (const m of picked) for (const s of m.slugs) if (!marks.has(s)) marks.set(s, m.stamp);
  const photos = ctx.showPhotos ? mosaic(inPeriod, highlights, type) : [];
  const cover = photos[0] || null;
  if (lead) lead.photo = leadPhoto(lead, cover, ctx, picked[0].slugs);
  const routes = routeShapes(inPeriod, ctx, type);
  const coverLines = highlights.filter((h) => h.kind !== 'busiest' && h.kind !== 'streak').slice(0, type === 'year' ? 5 : 4)
    .map((h) => ({ stamp: h.stamp, title: h.title, typeClass: h.typeClass }));

  /** @type {any} */
  const story = {
    highlights, lead, others: highlights.slice(1), hasOthers: highlights.length > 1,
    cover, photos, hasPhotos: photos.length > 0, collage: photos.slice(0, type === 'year' ? 6 : 4), coverLines,
    routes, hasRoutes: routes.length > 0, routeSheet: !photos.length && routes.length > 0,
    sessionCount: inPeriod.length, activeDays: new Set(inPeriod.map((x) => isoDay(x.t))).size,
  };

  if (type === 'week') {
    story.days = Array.from({ length: Math.round((end - start) / DAY) }, (_, i) => {
      const t0 = start + i * DAY;
      const sessions = inPeriod.filter((x) => x.t >= t0 && x.t < t0 + DAY).map((x) => sessionCard(x, marks, ctx.showPhotos));
      return { label: DOW[i % 7], num: String(new Date(t0).getUTCDate()), sessions, rest: sessions.length === 0, iso: isoDay(t0) };
    });
  }

  if (type === 'month') {
    const firstDow = (new Date(start).getUTCDay() + 6) % 7;
    const days = Math.round((end - start) / DAY);
    /** @type {Map<string, string>} the strongest stamp per day */
    const dayMark = new Map();
    for (const m of picked) if (m.slugs.length || m.href) {
      const d = isoDay(m.t);
      if (!dayMark.has(d)) dayMark.set(d, m.stamp);
    }
    const cells = [];
    for (let i = 0; i < firstDow; i++) cells.push({ blank: true });
    for (let i = 0; i < days; i++) {
      const t0 = start + i * DAY;
      const here = inPeriod.filter((x) => x.t >= t0 && x.t < t0 + DAY);
      const top = here.find((x) => marks.has(x.e.slug)) || here.find((x) => https(x.e.photoUrls?.[0])) || here[0];
      // Any session's photo fills the day: the marked one's first, else the day's first photo.
      const pic = [top, ...here].find((x) => x && https(x.e.photoUrls?.[0]));
      cells.push({
        blank: false, num: String(i + 1), iso: isoDay(t0),
        dots: here.map((x) => ({ typeClass: themeOf(x.e).typeClass, title: x.e.title || '' })),
        count: here.length, mark: dayMark.get(isoDay(t0)) || '',
        photo: ctx.showPhotos && pic ? https(pic.e.photoUrls?.[0]) : '',
        fill: ctx.showPhotos && pic ? null : dayFill(here, ctx),
        href: top ? `/life/activity/${top.e.slug}` : null,
      });
    }
    while (cells.length % 7) cells.push({ blank: true });
    const weeks = [];
    for (let i = 0; i < cells.length; i += 7) weeks.push({ cells: cells.slice(i, i + 7) });
    story.calendar = { weeks, dow: ['M', 'T', 'W', 'T', 'F', 'S', 'S'] };

    // The weeks that touch this month, each with its whole week's sessions.
    const bars = [];
    for (let w = mondayOf(start); w < end; w += 7 * DAY) {
      const key = weekKeyOf(w);
      const all = entriesIn(ctx, w, w + 7 * DAY);
      bars.push({ key, label: `W${key.slice(5, 7)}`, sessions: all.length, hours: dur(all.reduce((s, x) => s + num(x.e.durationSeconds), 0)), href: ctx.keys.has(key) ? roundupHref(key) : null });
    }
    const most = Math.max(1, ...bars.map((b) => b.sessions));
    story.weekBars = bars.map((b) => ({ ...b, pct: Math.round((b.sessions / most) * 100) }));
  }

  if (type === 'year') {
    const year = new Date(start).getUTCFullYear();
    const months = MONTHS.map((label, m) => {
      const a = Date.UTC(year, m, 1);
      const b = Date.UTC(year, m + 1, 1);
      const here = inPeriod.filter((x) => x.t >= a && x.t < b);
      /** @type {Map<string, number>} */
      const fam = new Map();
      for (const x of here) fam.set(tagOf(x.e).tag, (fam.get(tagOf(x.e).tag) || 0) + 1);
      const key = `month-${String(m + 1).padStart(2, '0')}-${year}`;
      const best = pickHighlights(momentsIn(ctx.moments, a, b), 'week')[0];
      const photo = !ctx.showPhotos ? '' : best?.photo || https([...here].reverse().find((x) => https(x.e.photoUrls?.[0]))?.e.photoUrls?.[0]);
      return {
        label, key, sessions: here.length, hours: dur(here.reduce((s, x) => s + num(x.e.durationSeconds), 0)),
        href: ctx.keys.has(key) ? roundupHref(key) : null, cover: photo || '', top: best ? best.title : '', topStamp: best ? best.stamp : '',
        _fam: fam,
      };
    });
    const most = Math.max(1, ...months.map((m) => m.sessions));
    const order = Object.keys(TAGS);
    story.months = months.map(({ _fam, ...m }) => ({
      ...m,
      height: Math.round((m.sessions / most) * 100),
      stack: [..._fam.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
        .map(([k, n]) => ({ typeClass: `fit-type--${k}`, pct: Math.round((n / Math.max(1, m.sessions)) * 1000) / 10, label: TAGS[/** @type {keyof typeof TAGS} */ (k)]?.label || k, n })),
    }));
    story.races = momentsIn(ctx.moments, start, end).filter((m) => ['weekend', 'race', 'event'].includes(m.kind)).map(ticket);
    story.hasRaces = story.races.length > 0;
    story.raceCount = story.races.filter((r) => r.isRace).length;
    /** @type {Map<string, number>} */
    const fams = new Map();
    for (const x of inPeriod) fams.set(tagOf(x.e).tag, (fams.get(tagOf(x.e).tag) || 0) + 1);
    story.familyMix = [...fams.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => ({
      typeClass: `fit-type--${k}`, label: TAGS[/** @type {keyof typeof TAGS} */ (k)]?.label || k, n, pct: Math.round((n / Math.max(1, inPeriod.length)) * 1000) / 10,
    }));
  }
  return story;
}
