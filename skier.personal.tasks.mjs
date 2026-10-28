// @ts-check
import fs from 'fs';
import path from 'path';

const cacheHash = Date.now().toString(36);
import {
    prepareOutputTask,
    bundleCssTask,
    copyStaticTask,
    setGlobalFromMarkdownTask,
    setGlobalsTask,
    generateItemsTask,
    generateFeedTask,
    generatePagesTask,
    generatePaginatedItemsTask,
    generateSitemapTask
} from 'skier';
import { fetchFitnessTask } from './tasks/fitness-fetch.mjs';
import { fitnessLifeTask } from './tasks/fitness-life.mjs';
import { fitnessActivityViewsTask } from './tasks/fitness-activity-views.mjs';
import { fitnessRoundupViewsTask } from './tasks/fitness-roundup-views.mjs';
import { fitnessOgImagesTask } from './tasks/fitness-og-images.mjs';
import { fitnessSessionsViewTask } from './tasks/fitness-sessions.mjs';
import { fitnessEventViewsTask } from './tasks/fitness-event-views.mjs';
import { fitnessPhotoDimsTask } from './tasks/fitness-photo-dims.mjs';
import { fitnessFeedItemsTask, FEED_PATH as FITNESS_FEED_PATH } from './tasks/fitness-feed-items.mjs';
import { lifePageTasks } from './tasks/life-pages.mjs';

const SITE_URL = 'https://james.ripixel.co.uk';

/** Estimate read time in minutes from raw text (200 wpm)
 * @param {string} text */
function estimateReadTime(text) {
    if (!text) return 1;
    const words = text.trim().split(/\s+/).length;
    return Math.max(1, Math.ceil(words / 200));
}

/** Custom task to write a global variable to a JSON file
 * @param {{ globalVar: string, outFile: string }} config */
function writeGlobalToJsonTask(config) {
    return {
        name: 'write-global-to-json',
        title: `Write ${config.globalVar} to ${config.outFile}`,
        config,
        run: async (/** @type {any} */ cfg, /** @type {any} */ ctx) => {
            const data = ctx.globals[cfg.globalVar];
            if (!data) {
                ctx.logger.warn(`Global variable '${cfg.globalVar}' not found`);
                return {};
            }
            const dir = path.dirname(cfg.outFile);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(cfg.outFile, JSON.stringify(data, null, 2));
            ctx.logger.debug(`Wrote ${cfg.globalVar} to ${cfg.outFile}`);
            return {};
        }
    };
}


/** Task to compute thoughts statistics and expose them as globals */
function computeThoughtsStatsTask() {
    return {
        name: 'compute-thoughts-stats',
        title: 'Compute thoughts statistics',
        run: async (/** @type {any} */ _cfg, /** @type {any} */ ctx) => {
            const thoughtsList = ctx.globals.thoughtsList;
            if (!Array.isArray(thoughtsList) || thoughtsList.length === 0) {
                ctx.globals.totalThoughts    = 0;
                ctx.globals.firstThoughtYear = new Date().getFullYear();
                ctx.globals.avgReadTime      = 1;
                ctx.globals.thoughtsPace     = '–';
                ctx.globals.latestThought         = '';
                ctx.globals.latestThoughtDate     = '';
                ctx.globals.latestThoughtDateLong = '';
                ctx.globals.latestThoughtExcerpt  = '';
                ctx.globals.latestThoughtSlug     = '';
                ctx.globals.latestThoughtReadTime = '1';
                return {};
            }

            // Total posts
            const total = thoughtsList.length;

            // Earliest year
            const dates = thoughtsList
                .map(t => t.date ? new Date(t.date) : null)
                .filter(d => d !== null);
            const firstYear = dates.length
                ? Math.min(...dates.map(d => d.getFullYear()))
                : new Date().getFullYear();

            // Average read time
            const avgRead = Math.round(
                thoughtsList.reduce((sum, t) => {
                    const wc = (t.body || t.excerpt || '').split(/\s+/).length;
                    return sum + Math.max(1, Math.ceil(wc / 200));
                }, 0) / total
            );

            // Approximate pace (posts per year since first post)
            const yearsActive = new Date().getFullYear() - firstYear + 1;
            const perYear = Math.round(total / yearsActive);
            const pace = perYear >= 12
                ? `${Math.round(perYear / 12)}/mo`
                : perYear >= 1
                ? `${perYear}/yr`
                : '< 1/yr';

            // Set stats as direct globals so Skier auto-spreads them into all templates
            ctx.globals.totalThoughts    = total;
            ctx.globals.firstThoughtYear = firstYear;
            ctx.globals.avgReadTime      = avgRead;
            ctx.globals.thoughtsPace     = pace;

            // Latest thought — also set as direct globals
            const latest = thoughtsList[0];
            if (latest) {
                ctx.globals.latestThought         = latest.title || '';
                ctx.globals.latestThoughtDate     = latest.dateDisplay || '';
                ctx.globals.latestThoughtDateLong = latest.dateDisplay || '';
                ctx.globals.latestThoughtExcerpt  = latest.excerpt || '';
                ctx.globals.latestThoughtSlug     = latest.relativePath || '';
                ctx.globals.latestThoughtReadTime = String(estimateReadTime(latest.body || latest.excerpt || ''));
            }

            ctx.logger.debug('Thoughts stats computed');
            return {};
        }
    };
}

/** Load the right-now JSON file if it exists */
function loadRightNowTask() {
    return {
        name: 'load-right-now',
        title: 'Load right-now panel data',
        run: async (/** @type {any} */ _cfg, /** @type {any} */ ctx) => {
            const filePath = './personal/items/right-now.json';
            if (!fs.existsSync(filePath)) {
                ctx.logger.debug('No right-now.json found — panel will be hidden');
                ctx.globals.rightNow = null;
                return {};
            }
            try {
                ctx.globals.rightNow = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                ctx.logger.debug('Loaded right-now.json');
            } catch (e) {
                ctx.logger.warn('Could not parse right-now.json');
                ctx.globals.rightNow = null;
            }
            return {};
        }
    };
}

export const tasks = [
    // Clean & create output directory
    prepareOutputTask({ outDir: './public/personal' }),

    // Process main CSS (includes shared tokens)
    bundleCssTask({
        from: './personal/assets/styles/main',
        to: './public/personal',
        output: `styles.min.${cacheHash}.css`,
        minify: true,
    }),

    // Process Jamie CSS
    bundleCssTask({
        from: './personal/assets/styles/jamie',
        to: './public/personal',
        output: `styles.jamie.min.${cacheHash}.css`,
        minify: true,
    }),

    // Copy images/assets
    copyStaticTask({
        from: './personal/assets/images',
        to: './public/personal',
    }),

    // Read and convert CHANGELOG.md to HTML for downstream use
    setGlobalFromMarkdownTask({
        mdPath: './CHANGELOG.md',
        outputVar: 'changelogHtml',
    }),

    // Set core globals
    setGlobalsTask({
        values: {
            year: (new Date()).getFullYear(),
            siteUrl: 'https://james.ripixel.co.uk',
            cacheHash,
            // Homepage static data
            latestProject:     'FitGlue',
            latestProjectDate: '2024 → present',
            latestRole:        'Monzo',
            latestRoleDate:    'may 2023 → now',
            latestRoleTitle:   'senior staff engineer (director)',
            latestRoleBlurb:   'In the Borrowing collective, looking after the Flex team. Fast growth, brilliant people, ambitious targets.',
        },
        valuesFn: (/** @type {any} */ globals) => {
            const match = globals.changelogHtml && /** @type {string} */ (globals.changelogHtml).match(/v(\d+\.\d+\.\d+)/i);
            const latestVersion = match ? match[0] : undefined;
            return { latestVersion };
        }
    }),

    // Load right-now panel data (optional — create right-now.json to enable)
    loadRightNowTask(),

    // ---- /life: data tasks (custom) shape globals; Skier builtins render them ----
    // Fetch the FitGlue showcase export (live → .cache/fitness → fixtures/fitness → empty).
    // Sets fitnessIndex, fitnessActivities, fitnessRoundups, fitnessUnavailable, fitnessSource.
    // Env: FITNESS_DATA_BASE (URL), FITNESS_DATA_SOURCE=live|cache|fixtures. See README "Fitness data".
    fetchFitnessTask(),
    fitnessPhotoDimsTask(), // F5.5 `fitnessPhotoDims`: hero photo sizes (portrait beside the title, else full width); before the view tasks
    fitnessLifeTask(), // S2.2 `fitnessLife` for /life (rendered by generate-pages below)
    // S2.5 OG cards — /life/og/{activity,roundup}/<id>.png via sharp, cached in .cache/og. Runs BEFORE the
    // view tasks because they read `fitnessOgImages` to point og:image at the rendered card.
    fitnessOgImagesTask(),
    fitnessActivityViewsTask(), // S2.3 `fitnessActivityPages`: one view model per activity
    fitnessEventViewsTask(), // F5.2 `fitnessEventPages`: one view model per race weekend
    fitnessSessionsViewTask(), // F5.3 `fitnessSessionsPage`: every session, by month, with type filters
    fitnessRoundupViewsTask(), // S2.4 `fitnessRoundupPages` + `fitnessRoundupsIndex`
    fitnessFeedItemsTask(), // S2.5 `fitnessFeedItems` + `fitnessFeedUpdated`: 50 entries, newest first

    // /life/activity/<slug>, /life/event/<slug>, /life/roundup/<key>, /life/roundups, /life/sessions,
    // /life/feed.xml — Skier builtins
    ...lifePageTasks({ outDir: './public/personal', siteUrl: SITE_URL }),

    // Generate individual thought article pages (adds readTime to each item)
    generateItemsTask({
        itemsDir: './personal/items',
        partialsDir: './personal/partials',
        outDir: './public/personal',
        outputVar: 'thoughtsList',
        excerptFn: (rawMarkdown) => {
            const firstPara = rawMarkdown.split(/\n\s*\n/)[0] ?? '';
            const stripped = firstPara.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
            return stripped.trim();
        },
        additionalVarsFn: ({ section, title, excerpt, body }) => ({
            page: section,
            subpage: '| ' + title,
            description: excerpt,
            readTime: String(estimateReadTime(body || excerpt || '')),
        }),
    }),

    // Write thoughtsList to JSON for pagination
    writeGlobalToJsonTask({
        globalVar: 'thoughtsList',
        outFile: './personal/items/thoughts.json',
    }),

    // Compute thoughts stats (must run after thoughtsList is populated)
    computeThoughtsStatsTask(),

    // Generate RSS/Atom/JSON feeds for thoughts
    generateFeedTask({
        // @ts-ignore — Skier resolves this glob-style string reference at runtime
        articles: '${thoughtsList}',
        outDir: './public/personal',
        site: {
            title: 'James King',
            description: 'Feed for thoughts articles',
            id: 'https://james.ripixel.co.uk/',
            link: 'https://james.ripixel.co.uk/',
            language: 'en',
            favicon: 'https://james.ripixel.co.uk/favicon.ico',
            copyright: `All rights reserved ${(new Date()).getFullYear()}, James King`,
            feedLinks: {
                json: 'https://james.ripixel.co.uk/json.json',
                atom: 'https://james.ripixel.co.uk/atom.xml',
            },
            author: {
                name: 'James King',
                email: 'ripixel+feed@gmail.com',
                link: 'https://james.ripixel.co.uk/',
            },
        },
    }),

    // Generate paginated thoughts listing
    generatePaginatedItemsTask({
        dataFile: './personal/items/thoughts.json',
        itemsPerPage: 10,
        template: './personal/templates/thoughts.html',
        partialsDir: './personal/partials',
        outDir: './public/personal',
        basePath: '/thoughts',
        outputVar: 'thoughts',
        paginationVar: 'pagination',
        additionalVarsFn: () => ({
            page: 'thoughts',
            description: 'A peak inside my brain you ask? Reader, beware...',
        }),
    }),

    // Generate HTML pages
    generatePagesTask({
        pagesDir: './personal/pages',
        partialsDir: './personal/partials',
        outDir: './public/personal',
        additionalVarsFn: ({ currentPage, rightNow, ...vars }) => {
            /** @type {Record<string, string>} */
            const pageMapping = {
                'index': 'home',
                'coding': 'projects',
            };
            const page = pageMapping[currentPage] || currentPage;

            return {
                page,
                description: (() => {
                    switch (page) {
                        case 'thoughts':  return 'A peak inside my brain you ask? Reader, beware...';
                        case 'profile':   return `So who am I? I'm James King, a Software Engineer from Nottinghamshire.`;
                        case 'projects':  return "Shall we take a look at some projects I've done?";
                        case 'changelog': return 'What changes have happened to this site?';
                        case 'home':      return "I'm James King, and I make things for the web";
                        case 'life':      return "What's going on in my life? Fitness, media, and upcoming events.";
                        default:          return vars.description || '';
                    }
                })(),
                rightNow: rightNow || null,
                atomFeed: page === 'life' ? FITNESS_FEED_PATH : undefined,
            };
        },
    }),

    // Generate sitemap.xml
    generateSitemapTask({
        outDir: './public/personal',
        scanDir: './public/personal',
        siteUrl: SITE_URL,
        // The site is slash-less (firebase.json trailingSlash: false): `foo/index.html` → `/foo`
        trailingSlash: false,
    }),

    {
        name: 'Copy robots.txt',
        run: async () => {
            const robotsPath = './personal/assets/robots.txt';
            const copyToPath = './public/personal/robots.txt';
            fs.copyFileSync(robotsPath, copyToPath);
        }
    },
];
