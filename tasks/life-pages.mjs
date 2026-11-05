// @ts-check
/**
 * The /life pages and feed, rendered by Skier builtins from the globals the
 * fitness data tasks set (fitness-activity-views, fitness-event-views,
 * fitness-roundup-views, fitness-sessions, fitness-feed-items). Configuration
 * only — no rendering code lives here.
 *
 *   fitnessActivityPages  → life/activity/<slug>/index.html  (generateDataPagesTask)
 *   fitnessRoundupPages   → life/roundup/<key>.html          (generateDataPagesTask)
 *   fitnessRoundupsIndex  → life/roundups.html               (generatePagesTask, personal/pages/life/)
 *   fitnessSessionsPage   → life/sessions.html               (generatePagesTask, personal/pages/life/)
 *   fitnessLife, lifeHeatmapView → life/fitness.html         (generatePagesTask, personal/pages/life/)
 *   lifeSections[name]    → life/<name>.html                 (generatePagesTask, one page per section)
 *   fitnessFeedItems      → life/feed.xml                    (generateFeedTask, Atom only)
 *   fitnessEventPages     → life/event/<slug>/index.html     (generateDataPagesTask)
 *
 * Kept apart from skier.personal.tasks.mjs so the tests can run exactly these
 * tasks against the fixtures.
 */
import { generateDataPagesTask, generateFeedTask, generatePagesTask } from 'skier';

import { activityOutPath } from './fitness-activity-views.mjs';
import { keyToPath as roundupOutPath } from './fitness-roundup-views.mjs';
import { FEED_PATH, FEED_TITLE, FEED_SUBTITLE } from './fitness-feed-items.mjs';
import { eventOutPath } from './fitness-event-views.mjs';

/**
 * Handlebars helpers the activity and event partials use (`{{#unless (eq sets 1)}}` in
 * activity-kind-strength and -class, `{{#unless (eq total 1)}}` in activity-gallery).
 */
export const templateHelpers = {
  eq: (/** @type {unknown} */ a, /** @type {unknown} */ b) => a === b,
  /** `{{> did-you-know items=(first lifeInsights)}}`: the first item as a one-item list. */
  first: (/** @type {unknown} */ a) => (Array.isArray(a) ? a.slice(0, 1) : []),
};

/**
 * @param {{ outDir: string, siteUrl: string, templatesDir?: string, partialsDir?: string, pagesDir?: string }} opts
 */
export function lifePageTasks({
  outDir,
  siteUrl,
  templatesDir = './personal/templates',
  partialsDir = './personal/partials',
  pagesDir = './personal/pages/life',
}) {
  const site = siteUrl.replace(/\/+$/, '');
  return [
    // /life/activity/<slug> (directory form; Firebase serves <slug>/index.html slash-less)
    generateDataPagesTask({
      // @ts-ignore — Skier resolves this `${var}` reference to the global array at runtime
      items: '${fitnessActivityPages}',
      template: `${templatesDir}/activity.html`,
      partialsDir,
      outDir,
      outPath: (/** @type {any} */ page) => activityOutPath(page.act.slug),
      helpers: templateHelpers,
    }),

    // /life/roundup/<key>
    generateDataPagesTask({
      // @ts-ignore — Skier resolves this `${var}` reference to the global array at runtime
      items: '${fitnessRoundupPages}',
      template: `${templatesDir}/roundup.html`,
      partialsDir,
      outDir,
      outPath: (/** @type {any} */ page) => roundupOutPath(page.roundup.key),
    }),

    // /life/roundups, /life/sessions, /life/fitness and the eight section pages — the pages in
    // personal/pages/life/, each with its own view model
    generatePagesTask({
      pagesDir,
      partialsDir,
      outDir: `${outDir}/life`,
      helpers: templateHelpers,
      additionalVarsFn: ({ currentPage, fitnessRoundupsIndex, fitnessSessionsPage, lifeSections }) => {
        if (currentPage === 'fitness') {
          return {
            page: 'life',
            subpage: '| fitness',
            description: 'Running, riding and lifting: every session, the roundups, the records and the routes.',
            canonical: `${site}/life/fitness`,
            atomFeed: FEED_PATH,
          };
        }
        const section = /** @type {Record<string, any>} */ (lifeSections || {})[currentPage];
        if (section) {
          const title = String(section.title || currentPage).toLowerCase();
          return {
            page: 'life',
            subpage: `| ${title}`,
            description: `James King, by the numbers: ${title}.`,
            canonical: `${site}/life/${currentPage}`,
            section,
          };
        }
        /** @type {Record<string, unknown>} */
        const views = { roundups: fitnessRoundupsIndex, sessions: fitnessSessionsPage };
        return /** @type {Record<string, unknown>} */ (views[currentPage] ?? {});
      },
    }),

    // /life/feed.xml
    generateFeedTask({
      // @ts-ignore — Skier resolves this `${var}` reference to the global array at runtime
      articles: '${fitnessFeedItems}',
      outDir,
      outputs: { atom: FEED_PATH.replace(/^\//, '') },
      site: {
        title: FEED_TITLE,
        description: FEED_SUBTITLE,
        id: `${site}/life`,
        link: `${site}/life`,
        feedLinks: { atom: `${site}${FEED_PATH}` },
        author: { name: 'James King', link: `${site}/` },
        // @ts-ignore — resolved to the Date fitness-feed-items sets (the latest entry's <updated>)
        updated: '${fitnessFeedUpdated}',
        generator: 'ripixel-website',
      },
    }),

    // /life/event/<slug> (directory form, like the activity pages)
    generateDataPagesTask({
      // @ts-ignore — Skier resolves this `${var}` reference to the global array at runtime
      items: '${fitnessEventPages}',
      template: `${templatesDir}/event.html`,
      partialsDir,
      outDir,
      outPath: (/** @type {any} */ page) => eventOutPath(page.ev.slug),
      helpers: templateHelpers,
    }),
  ];
}
