// @ts-check
/**
 * `/life/sessions` — every session on the record, newest first (F5.3).
 *
 * One static page: a card per activity (picture, title, date, type, one key
 * stat) under month headers, with type-filter chips. Without JS everything is
 * listed; with JS the chips filter by family and the list reveals PAGE_SIZE
 * cards at a time ("show more"), and photos are `loading="lazy"`, so ~700
 * cards cost a few hundred KB of HTML and only the photos near the viewport.
 *
 * The view model is built here; the page is personal/templates/sessions.html
 * rendered with the site partials, written to public/personal/life/sessions.html.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import Handlebars from 'handlebars';

import { buildCard, filesBySlug, SESSIONS_HREF, TZ } from './fitness-life.mjs';
import { FAMILIES } from './fitness-theme.mjs';

export const DEFAULT_TEMPLATE = 'personal/templates/sessions.html';
export const DEFAULT_PARTIALS_DIR = 'personal/partials';
export const DEFAULT_OUT_DIR = 'public/personal';
export const PAGE_SIZE = 48;

/** @param {Date} d */
function monthKey(d) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit' }).format(d);
}

/** @param {Date} d */
function monthTitle(d) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, month: 'long', year: 'numeric' }).format(d).toUpperCase();
}

/**
 * @param {any} index  index.json
 * @param {any[]} [activities] full activity files (routes for cards without a photo)
 */
export function buildSessions(index, activities = []) {
  const files = filesBySlug(activities);
  const entries = (Array.isArray(index?.activities) ? index.activities : [])
    .filter((e) => e && typeof e.slug === 'string')
    .map((e) => ({ e, t: Date.parse(e.startTime || '') }))
    .sort((a, b) => (Number.isNaN(b.t) ? 0 : b.t) - (Number.isNaN(a.t) ? 0 : a.t));

  /** @type {Map<string, number>} */
  const counts = new Map();
  /** @type {{ key: string, title: string, count: number, countLabel: string, items: any[] }[]} */
  const months = [];
  for (const { e, t } of entries) {
    const card = buildCard(e, files.get(e.slug));
    counts.set(card.typeKey, (counts.get(card.typeKey) || 0) + 1);
    const d = Number.isNaN(t) ? null : new Date(t);
    const key = d ? monthKey(d) : 'undated';
    let m = months[months.length - 1];
    if (!m || m.key !== key) {
      m = { key, title: d ? monthTitle(d) : 'UNDATED', count: 0, countLabel: '', items: [] };
      months.push(m);
    }
    m.items.push(card);
    m.count++;
  }
  for (const m of months) m.countLabel = m.count === 1 ? '1 session' : `${m.count} sessions`;

  const filters = /** @type {(keyof typeof FAMILIES)[]} */ (Object.keys(FAMILIES))
    .filter((k) => counts.has(k))
    .map((k) => ({ key: k, label: FAMILIES[k].label, glyph: FAMILIES[k].glyph, count: counts.get(k), typeClass: `fit-type--${k}` }));

  return {
    total: entries.length,
    totalLabel: `${entries.length.toLocaleString('en-GB')} session${entries.length === 1 ? '' : 's'}`,
    months,
    filters,
    hasFilters: filters.length > 1,
    pageSize: PAGE_SIZE,
    href: SESSIONS_HREF,
  };
}

async function registerPartials(/** @type {typeof Handlebars} */ hb, /** @type {string} */ dir) {
  for (const f of await fs.readdir(dir)) {
    const ext = path.extname(f);
    if (ext !== '.html' && ext !== '.hbs') continue;
    hb.registerPartial(path.basename(f, ext), await fs.readFile(path.join(dir, f), 'utf8'));
  }
}

/**
 * The Skier task. After fetch-fitness; before the sitemap scan.
 * @param {{ template?: string, partialsDir?: string, outDir?: string }} [config]
 */
export function fitnessSessionsPageTask(config = {}) {
  return {
    name: 'fitness-sessions-page',
    title: 'Generate /life/sessions (every session, filterable by type)',
    config,
    run: async (/** @type {any} */ cfg, /** @type {any} */ ctx) => {
      const g = ctx.globals || {};
      const hb = Handlebars.create();
      await registerPartials(hb, cfg.partialsDir || DEFAULT_PARTIALS_DIR);
      const render = hb.compile(await fs.readFile(cfg.template || DEFAULT_TEMPLATE, 'utf8'));
      const sessions = buildSessions(g.fitnessIndex, Array.isArray(g.fitnessActivities) ? g.fitnessActivities : []);
      const siteUrl = String(g.siteUrl || '').replace(/\/+$/, '');
      const html = render({
        ...g,
        page: 'life',
        subpage: '| sessions',
        description: `Every training session on the record — ${sessions.totalLabel}, newest first.`,
        canonical: siteUrl ? `${siteUrl}${SESSIONS_HREF}` : '',
        fitnessSessions: sessions,
        fitnessUnavailable: Boolean(g.fitnessUnavailable),
      });
      const out = path.join(cfg.outDir || DEFAULT_OUT_DIR, 'life', 'sessions.html');
      await fs.mkdir(path.dirname(out), { recursive: true });
      await fs.writeFile(out, html);
      ctx.logger.info(`Sessions page: ${sessions.total} sessions in ${sessions.months.length} months, ${sessions.filters.length} types`);
      return {};
    },
  };
}
