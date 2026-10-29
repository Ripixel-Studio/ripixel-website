// @ts-check
/**
 * Race-weekend event views (F5.2) — data only: /life/event/<slug>.
 *
 * When several of his races fall at the same event within EVENT_WINDOW_DAYS (doubles on
 * the Tuesday, solo on the Wednesday), they get one combined page linking every race:
 * each race's division, time, PB standing and his words, the splits side by side, a
 * shared gallery and a PB chase per division raced. The header is a collage of each
 * race's highlight photo (F5.5). Grouping lives in tasks/fitness-hyrox.mjs
 * (buildHyroxHistory → events) and works for any number of races and divisions.
 *
 * This module builds `fitnessEventPages`, one view model per weekend; Skier's
 * generateDataPagesTask renders each with personal/templates/event.html (tasks/life-pages.mjs):
 *
 *   fitnessEventPages[i]  →  public/personal/life/event/<slug>/index.html
 */
import path from 'node:path';

import { buildActivityView, fmtDateShort, isSafeSlug } from './fitness-activity-views.mjs';
import { buildHyroxHistory, pbChase, eventUrl, clock } from './fitness-hyrox.mjs';
import { activityTheme } from './fitness-theme.mjs';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "27–28 Oct 2026", "30 Sep – 2 Oct 2026", "27 Oct 2026". @param {string} a @param {string} b */
export function dateRange(a, b) {
  const x = new Date(Date.parse(a));
  const y = new Date(Date.parse(b));
  if (Number.isNaN(x.getTime())) return '';
  if (Number.isNaN(y.getTime()) || x.toISOString().slice(0, 10) === y.toISOString().slice(0, 10)) return fmtDateShort(a);
  if (x.getUTCMonth() === y.getUTCMonth() && x.getUTCFullYear() === y.getUTCFullYear()) {
    return `${x.getUTCDate()}–${y.getUTCDate()} ${MONTHS[x.getUTCMonth()]} ${x.getUTCFullYear()}`;
  }
  return `${x.getUTCDate()} ${MONTHS[x.getUTCMonth()]} – ${fmtDateShort(b)}`;
}

/**
 * Where an event's page is written, relative to the output directory. Same safety rules
 * as activity slugs: throws on anything that is not a plain id.
 * @param {string} slug
 */
export function eventOutPath(slug) {
  if (!isSafeSlug(slug)) throw new Error(`unusable event slug ${JSON.stringify(slug)}`);
  return path.posix.join('life', 'event', slug, 'index.html');
}

/**
 * Template context for one event.
 * @param {import('./fitness-hyrox.mjs').EventGroup} event
 * @param {import('./fitness-hyrox.mjs').HyroxHistory} history
 * @param {any} index  fitnessIndex
 * @param {{ siteUrl?: string, ogCard?: string, share?: any, photoDims?: Record<string, { w: number, h: number }> }} [opts]
 *   `ogCard` is the weekend's own landscape share card (tasks/fitness-og-images.mjs), `share` its Share-button entry.
 */
export function buildEventView(event, history, index, opts = {}) {
  const siteUrl = (opts.siteUrl || '').replace(/\/+$/, '');
  const races = event.slugs.map((slug) => history.races.get(slug)).filter(Boolean);
  const cards = races.map((info) => {
    const view = buildActivityView(info.file, index, { hyrox: history, photoDims: opts.photoDims });
    const race = view.act.race;
    return {
      url: info.url,
      title: info.title,
      date: fmtDateShort(info.date),
      division: info.divisionLabel,
      total: info.total,
      isPB: !!race?.isTotalPB,
      totalDelta: race?.totalDelta || '',
      totalTone: race?.totalTone || '',
      totalPbTime: race?.totalPbTime || '',
      isFirst: !!race?.isFirst,
      firstLabel: race?.firstLabel || '',
      ranks: race?.ranks || [],
      partner: race?.partner || '',
      words: view.act.description,
      avgHr: view.act.anchors.find((a) => a.label === 'avg hr')?.value || '',
      photo: view.act.bgPhotoUrl || view.act.bannerUrl || '',
      race,
      photos: view.act.photos,
      location: view.act.locationName,
    };
  });

  // Splits side by side: one row per segment key in race order, one cell per race.
  const keys = [];
  for (const c of cards) for (const r of c.race?.rows || []) if (!keys.some((k) => k.key === r.key)) keys.push({ key: r.key, label: r.label, icon: r.icon, isRun: r.isRun });
  const longest = Math.max(1, ...cards.flatMap((c) => (c.race?.rows || []).map((r) => r.pct)));
  const compare = keys.map((k) => ({
    ...k,
    cells: cards.map((c) => {
      const r = (c.race?.rows || []).find((x) => x.key === k.key);
      return r ? { duration: r.duration, pct: Math.round((r.pct / longest) * 1000) / 10, hr: r.avgHr || '', delta: r.delta, deltaTone: r.deltaTone, isPB: r.isPB } : { duration: '—', pct: 0 };
    }),
  }));

  const totalSeconds = races.reduce((s, r) => s + r.totalSeconds, 0);
  const pbCount = cards.filter((c) => c.isPB).length;
  const photos = cards.flatMap((c) => c.photos);
  const gallery = photos.map((src, i) => ({ src, id: `photo-${i + 1}`, n: i + 1, prev: `#photo-${i === 0 ? photos.length : i}`, next: `#photo-${i + 2 > photos.length ? 1 : i + 2}`, total: photos.length }));
  const divisions = [...new Set(races.map((r) => r.divisionKey).filter(Boolean))];
  const heroPhoto = cards.map((c) => c.photo).find(Boolean) || '';
  // Header collage: each race's highlight photo (its hero), labelled with the race.
  const collage = cards.filter((c) => c.photo).map((c) => ({ src: c.photo, url: c.url, division: c.division, total: c.total, date: c.date, isPB: c.isPB || c.isFirst }));
  const name = `Hyrox ${event.name}`;
  const range = dateRange(event.start, event.end);
  const canonical = siteUrl ? `${siteUrl}${eventUrl(event.slug)}` : '';
  const description = `${races.length} races in ${range}: ${cards.map((c) => `${c.division} ${c.total}${c.isPB ? ' (PB)' : ''}`).join(', ')}.`;
  const ogImage = (opts.ogCard && /^https?:\/\//.test(opts.ogCard) ? opts.ogCard : '') || heroPhoto;

  return {
    page: 'life',
    subpage: `| ${name}`,
    description,
    currentPage: `life/event/${event.slug}`,
    headTitle: `${name} — James King`,
    ogType: 'article',
    ogImage,
    canonical,
    publishedTime: event.start,
    ev: {
      ...activityTheme(races[0]?.file?.activity?.activityType),
      slug: event.slug,
      name,
      range,
      venue: cards.map((c) => c.location).find(Boolean) || event.name.toUpperCase(),
      heroPhoto,
      collage,
      collageCols: collage.length,
      cards,
      compare,
      raceCount: races.length,
      raceWord: races.length === 1 ? 'race' : 'races',
      totalTime: clock(totalSeconds),
      pbCount,
      divisionCount: divisions.length,
      gallery,
      // One PB chase per division raced here: the event's races against the PBs they
      // chased, history up to the event's last race in that division.
      chases: divisions.map((key) => pbChase(history, key, races.filter((r) => r.divisionKey === key).map((r) => r.slug))).filter(Boolean),
      owner: String(index?.profile?.displayName ?? 'James').toUpperCase(),
      share: opts.share || null,
    },
  };
}

/**
 * The data task: `fitnessEventPages`, one view model per race weekend. Runs after
 * fetch-fitness (and after the OG task, whose card URLs it reuses for og:image).
 * A weekend whose slug is unusable as a file name is skipped with a warning.
 */
export function fitnessEventViewsTask() {
  return {
    name: 'fitness-event-views',
    title: 'Build the /life/event/<slug> race-weekend view models',
    config: {},
    run: async (/** @type {any} */ _cfg, /** @type {any} */ ctx) => {
      const g = ctx.globals;
      const activities = Array.isArray(g.fitnessActivities) ? g.fitnessActivities : [];
      const history = buildHyroxHistory(activities);
      const pages = [];
      for (const event of history.events) {
        if (!isSafeSlug(event.slug)) {
          ctx.logger.warn(`unusable event slug ${JSON.stringify(event.slug)}`);
          continue;
        }
        pages.push(buildEventView(event, history, g.fitnessIndex, { siteUrl: g.siteUrl, ogCard: g.fitnessOgImages?.event?.[event.slug], share: g.fitnessShareCards?.event?.[event.slug], photoDims: g.fitnessPhotoDims }));
      }
      ctx.logger.info(pages.length ? `Event views: ${pages.length} race weekends` : 'Event views: no race weekends');
      return { fitnessEventPages: pages };
    },
  };
}
