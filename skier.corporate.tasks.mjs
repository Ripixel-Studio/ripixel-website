// @ts-check
import fs from 'fs';
import {
    prepareOutputTask,
    bundleCssTask,
    copyStaticTask,
    setGlobalsTask,
    generatePagesTask,
    generateSitemapTask,
} from 'skier';

const cacheHash = Date.now().toString(36);

// Per-page <title>, description and canonical path for the pages that are not the home page.
// Every app's homepage lives under /apps/ so OAuth consent screens (Google's "app homepage")
// never depend on an app's own marketing site staying up.
const PAGE_META = {
    privacy: {
        pageTitle: 'Privacy',
        pageDescription: 'How Ripixel apps collect, use and protect your data, including Google user data.',
        pagePath: '/privacy',
    },
};

// /apps/<name>: one page per app, from corporate/pages/apps/<name>.html.
const APP_META = {
    fitglue: {
        pageTitle: 'FitGlue',
        pageDescription: 'FitGlue: fitness automation that joins up workouts, heart rate and health data.',
        pagePath: '/apps/fitglue',
    },
};

export const tasks = [
    // Clean & Create output directory
    prepareOutputTask({
        outDir: './public/corporate',
    }),
    // Process corporate CSS
    bundleCssTask({
        from: './corporate/assets/styles',
        to: './public/corporate',
        output: `styles.min.${cacheHash}.css`,
        minify: true,
    }),

    // Expose cacheHash to templates
    setGlobalsTask({
        values: { cacheHash },
    }),
    // Copy images/assets
    copyStaticTask({
        from: './corporate/assets/images',
        to: './public/corporate',
    }),
    // Generate HTML pages
    generatePagesTask({
        pagesDir: './corporate/pages',
        partialsDir: './corporate/partials',
        outDir: './public/corporate',
        additionalVarsFn: ({ currentPage }) => ({
            page: currentPage === 'index' ? 'home' : currentPage,
            ...(PAGE_META[currentPage] || {}),
            description: 'Ripixel — Software consultancy & product studio based in the UK.',
            year: (new Date()).getFullYear(),
        }),
    }),
    // App homepages: /apps/<name>
    generatePagesTask({
        pagesDir: './corporate/pages/apps',
        partialsDir: './corporate/partials',
        outDir: './public/corporate/apps',
        additionalVarsFn: ({ currentPage }) => ({
            page: 'app',
            ...(APP_META[currentPage] || {}),
            year: (new Date()).getFullYear(),
        }),
    }),
    // Generate sitemap.xml
    generateSitemapTask({
        outDir: './public/corporate',
        scanDir: './public/corporate',
        siteUrl: 'https://www.ripixel.co.uk',
    }),
    {
        name: 'Copy robots.txt',
        run: async () => {
            const robotsContent = `User-agent: *\nAllow: /\nSitemap: https://www.ripixel.co.uk/sitemap.xml`;
            fs.writeFileSync('./public/corporate/robots.txt', robotsContent);
        }
    }
];
