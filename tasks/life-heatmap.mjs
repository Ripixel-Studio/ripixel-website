// @ts-check
/**
 * LH3.5 — the heatmap view model for /life. Data only: it projects the (already
 * zone-trimmed) segments to SVG path strings, as `routePath()` does for one route;
 * Skier builtins render them.
 *
 * Sets `lifeHeatmapView`: `{viewBox, paths, count}`, or `null` without a heatmap doc.
 */

const r2 = (/** @type {number} */ n) => Math.round(n * 100) / 100;

/**
 * Accept `[minLat, minLng, maxLat, maxLng]` or `[[minLat, minLng], [maxLat, maxLng]]`;
 * anything else (or an inverted/non-finite box) falls back to the segments' own extent.
 * @param {any} bounds @param {number[][][]} segments
 * @returns {[number, number, number, number]}
 */
function resolveBounds(bounds, segments) {
  const flat = Array.isArray(bounds) ? bounds.flat() : [];
  if (flat.length === 4 && flat.every((n) => typeof n === 'number' && Number.isFinite(n)) && flat[2] >= flat[0] && flat[3] >= flat[1]) {
    return /** @type {[number, number, number, number]} */ (flat);
  }
  let minLat = Infinity, minLng = Infinity, maxLat = -Infinity, maxLng = -Infinity;
  for (const seg of segments) {
    for (const [lat, lng] of seg) {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
    }
  }
  return Number.isFinite(minLat) ? [minLat, minLng, maxLat, maxLng] : [0, 0, 0, 0];
}

/**
 * Equirectangular projection: x = lng scaled by cos(midLat), y flipped (north up),
 * fitted to `width` units wide; two decimals.
 * @param {number[][][]} segments @param {any} bounds @param {number} [width]
 * @returns {{ viewBox: string, paths: string[] }}
 */
export function projectSegments(segments, bounds, width = 1000) {
  const segs = Array.isArray(segments) ? segments : [];
  const [minLat, minLng, maxLat, maxLng] = resolveBounds(bounds, segs);
  const c = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180) || 1;
  const spanX = (maxLng - minLng) * c;
  const spanY = maxLat - minLat;
  // A single point (or a straight N-S / E-W line) has a zero span: fall back so nothing divides by zero.
  const s = spanX > 0 ? width / spanX : spanY > 0 ? width / spanY : 1;
  const w = spanX > 0 ? width : r2(spanX * s);
  const h = r2(spanY * s);
  const paths = segs.map((seg) =>
    seg
      .map(([lat, lng], i) => {
        const x = Math.min(Math.max(r2((lng - minLng) * c * s), 0), w);
        const y = Math.min(Math.max(r2((maxLat - lat) * s), 0), h);
        return `${i === 0 ? 'M' : 'L'}${x} ${y}`;
      })
      .join(' '),
  );
  return { viewBox: `0 0 ${w} ${h}`, paths };
}

export function lifeHeatmapTask(config = {}) {
  return {
    name: 'life-heatmap',
    title: 'Build the /life heatmap view model',
    config,
    run: async (/** @type {any} */ _cfg, /** @type {any} */ ctx) => {
      const doc = ctx.globals?.lifeHeatmap;
      if (!doc || !Array.isArray(doc.segments)) return { lifeHeatmapView: null };
      const { viewBox, paths } = projectSegments(doc.segments, doc.bounds);
      const count = Number.isFinite(doc.activities) ? doc.activities : paths.length;
      ctx.logger.info(`Life heatmap: ${paths.length} segments from ${count} activities`);
      return { lifeHeatmapView: { viewBox, paths, count } };
    },
  };
}
