// @ts-check
/**
 * Post-pass over Skier's generated sitemap.xml: strip the trailing slash from
 * every <loc> except the site root.
 *
 * Skier's generateSitemapTask maps `foo/index.html` to `/foo/`. The site
 * serves every URL slash-less (firebase.json `trailingSlash: false`, so
 * `/foo/` is a 301 to `/foo`), and the activity pages are written as
 * `life/activity/<slug>/index.html`, so without this pass the sitemap would
 * list 700-odd URLs that each redirect.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * @param {string} xml  sitemap.xml text
 * @returns {string}    the same text with `/`-terminated <loc>s made slash-less
 */
export function stripTrailingSlashes(xml) {
  return xml.replace(/<loc>([^<]*?)\/+<\/loc>/g, (whole, url) => {
    // Keep the bare origin (`https://host/`) and a bare `/`.
    if (url === '' || /^[a-z][a-z0-9+.-]*:\/\/[^/]*$/i.test(url)) return whole;
    return `<loc>${url}</loc>`;
  });
}

/**
 * @param {{ outDir: string }} config  the directory holding sitemap.xml
 */
export function sitemapSlashlessTask(config) {
  return {
    name: 'sitemap-slashless',
    title: `Strip trailing slashes from ${config.outDir}/sitemap.xml`,
    config,
    /** @param {{ outDir: string }} cfg */
    run: async (cfg) => {
      const file = path.join(cfg.outDir, 'sitemap.xml');
      const xml = await fs.readFile(file, 'utf8');
      await fs.writeFile(file, stripTrailingSlashes(xml));
      return {};
    },
  };
}
