// @ts-check
/**
 * The /life pages and feed, rendered by Skier builtins from the globals the
 * fitness data tasks set (fitness-activity-views, fitness-roundup-views,
 * fitness-feed-items). Configuration only — no rendering code lives here.
 *
 *   fitnessActivityPages  → life/activity/<slug>/index.html  (generateDataPagesTask)
 *   fitnessRoundupPages   → life/roundup/<key>.html          (generateDataPagesTask)
 *   fitnessRoundupsIndex  → life/roundups.html               (generatePagesTask, personal/pages/life/)
 *   fitnessFeedItems      → life/feed.xml                    (generateFeedTask, Atom only)
 *
 * Kept apart from skier.personal.tasks.mjs so the tests can run exactly these
 * tasks against the fixtures.
 */
import { generateDataPagesTask, generateFeedTask, generatePagesTask } from 'skier';

import { activityOutPath } from './fitness-activity-views.mjs';
import { keyToPath as roundupOutPath } from './fitness-roundup-views.mjs';
import { FEED_PATH, FEED_TITLE, FEED_SUBTITLE } from './fitness-feed-items.mjs';

/** Handlebars helpers the activity partials use (`{{#if (eq type "strength")}}` in exercise-item). */
export const templateHelpers = {
  eq: (/** @type {unknown} */ a, /** @type {unknown} */ b) => a === b,
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

    // /life/roundups — the one page in personal/pages/life/
    generatePagesTask({
      pagesDir,
      partialsDir,
      outDir: `${outDir}/life`,
      additionalVarsFn: ({ fitnessRoundupsIndex }) => /** @type {Record<string, unknown>} */ (fitnessRoundupsIndex),
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
  ];
}
