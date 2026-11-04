// @ts-check
/**
 * Tiled route maps (activity pages and the /life/fitness heatmap).
 *
 * Data only, as everywhere else in tasks/: these helpers decide which route card an
 * activity gets and serialise the *published* routePoints / heatmap segments into the
 * JSON the static client script (personal/assets/scripts/route-map.js) reads from a
 * `<script type="application/json">` tag. Nothing here adds points, centres or bounds
 * beyond what the export published; the client draws exactly these lines over
 * OpenStreetMap tiles with Leaflet (vendored from npm by `routeMapAssetsTask`).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

/** Coordinates are published to 5 dp (about a metre); never add precision. */
const r5 = (/** @type {number} */ n) => Math.round(n * 1e5) / 1e5;

/** @param {any} p */
const validPoint = (p) =>
  Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) &&
  Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180 && (p[0] !== 0 || p[1] !== 0);

/**
 * The published points, cleaned: `[lat, lng]` pairs, finite, no 0,0 fixes, 5 dp.
 * @param {any} points
 * @returns {Array<[number, number]>}
 */
export function cleanPoints(points) {
  if (!Array.isArray(points)) return [];
  return points.filter(validPoint).map((p) => /** @type {[number, number]} */ ([r5(p[0]), r5(p[1])]));
}

/**
 * Which route card an activity shows.
 *  - `hidden`: FitGlue's `routeHidden: true` (the whole route sat inside a home zone) → "route hidden near home".
 *    Wins over any points, so a hidden route is never drawn.
 *  - `map`: two or more published points → the tiled map (SVG fallback underneath).
 *  - `indoor`: a distance activity with no GPS → "indoor — no route".
 *  - `null`: no card (strength, classes, …: a route card would be noise).
 * @param {{ routePoints?: any, routeHidden?: any, category?: string }} a
 * @returns {'hidden' | 'map' | 'indoor' | null}
 */
export function routeMapState({ routePoints, routeHidden, category }) {
  if (routeHidden === true) return 'hidden';
  if (category !== 'cardio-distance') return null;
  return cleanPoints(routePoints).length >= 2 ? 'map' : 'indoor';
}

export const ROUTE_EMPTY_LABELS = /** @type {const} */ ({
  hidden: 'route hidden near home',
  indoor: 'indoor — no route',
});

/**
 * JSON safe to drop into `<script type="application/json">` with a triple-stash:
 * `<`, `>`, `&` and the JS line separators are escaped, so no string can close the tag.
 * @param {unknown} value
 */
export function scriptJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * `[[south, west], [north, east]]` of a list of points, or null.
 * @param {Array<[number, number]>} pts
 * @returns {[[number, number], [number, number]] | null}
 */
export function boundsOf(pts) {
  if (!pts.length) return null;
  let s = Infinity, w = Infinity, n = -Infinity, e = -Infinity;
  for (const [lat, lng] of pts) {
    if (lat < s) s = lat;
    if (lat > n) n = lat;
    if (lng < w) w = lng;
    if (lng > e) e = lng;
  }
  return [[s, w], [n, e]];
}

/**
 * The activity map's data: `{ kind: 'route', line, fit }`, `line` the published points.
 * @param {any} routePoints
 */
export function activityMapData(routePoints) {
  const line = cleanPoints(routePoints);
  return { kind: 'route', line, fit: boundsOf(line) };
}

/**
 * The heatmap's data: every published segment (far trips too), `fit` = home turf (the
 * bounds the static sheet already uses), `all` = every segment's extent for "fit all".
 * @param {any} segments  the export's segments
 * @param {any} coreBounds  `coreOfSegments(...).bounds` (`[minLat, minLng, maxLat, maxLng]` or nested)
 */
export function heatmapMapData(segments, coreBounds) {
  const segs = (Array.isArray(segments) ? segments : []).map(cleanPoints).filter((s) => s.length >= 2);
  const all = boundsOf(segs.flat());
  const flat = Array.isArray(coreBounds) ? coreBounds.flat() : [];
  const fit = flat.length === 4 && flat.every((x) => Number.isFinite(x)) && flat[2] > flat[0] && flat[3] > flat[1]
    ? /** @type {[[number, number], [number, number]]} */ ([[r5(flat[0]), r5(flat[1])], [r5(flat[2]), r5(flat[3])]])
    : all;
  return { kind: 'heatmap', segments: segs, fit, all };
}

/**
 * Vendor Leaflet (JS, CSS, its control sprites) from node_modules into
 * `<outDir>/vendor/leaflet-<version>/`, and the map script into
 * `<outDir>/scripts/route-map.<cacheHash>.js` (JS is served immutable, so both paths
 * change with their contents). Sets `leafletVersion` for the partial's URLs.
 * @param {{ outDir: string, script: string, cacheHash: string }} config
 */
export function routeMapAssetsTask(config) {
  return {
    name: 'route-map-assets',
    title: 'Vendor Leaflet and the route-map script',
    config,
    run: async (/** @type {any} */ cfg, /** @type {any} */ ctx) => {
      const require = createRequire(import.meta.url);
      const pkgPath = require.resolve('leaflet/package.json');
      const { version } = JSON.parse(await fs.readFile(pkgPath, 'utf8'));
      const dist = path.join(path.dirname(pkgPath), 'dist');
      const vendor = path.join(cfg.outDir, 'vendor', `leaflet-${version}`);
      await fs.mkdir(path.join(vendor, 'images'), { recursive: true });
      for (const f of ['leaflet.js', 'leaflet.css']) await fs.copyFile(path.join(dist, f), path.join(vendor, f));
      for (const f of await fs.readdir(path.join(dist, 'images'))) {
        await fs.copyFile(path.join(dist, 'images', f), path.join(vendor, 'images', f));
      }
      await fs.mkdir(path.join(cfg.outDir, 'scripts'), { recursive: true });
      await fs.copyFile(cfg.script, path.join(cfg.outDir, 'scripts', `route-map.${cfg.cacheHash}.js`));
      ctx.logger.info(`Route maps: Leaflet ${version} vendored`);
      return { leafletVersion: version };
    },
  };
}
