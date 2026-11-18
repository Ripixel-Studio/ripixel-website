// @ts-check
/**
 * Section OG cards: the static `card_<id>.png` images drawn by
 * scripts/generate-og-images.mjs (PAGES) and committed under personal/assets/images/.
 *
 * head.html falls back to `card_{{page}}.png`, and every /life page has `page: 'life'`
 * (the nav), so without an explicit ogImage they all share the hub's LIFE. card. The
 * fitness pages and each life section pass their own card from here instead.
 */
const SITE = 'https://james.ripixel.co.uk';

/** The /life sections that have a card of their own (scripts/generate-og-images.mjs PAGES). */
export const SECTION_CARD_IDS = new Set(['fitness', 'body', 'games', 'code', 'watching', 'listening', 'reading', 'live']);

/** @param {string} id */
export const sectionCard = (id) => `${SITE}/card_${SECTION_CARD_IDS.has(id) ? id : 'life'}.png`;

/** /life/fitness, the sessions and roundup lists, and the fallback for activity, race-weekend and roundup pages without a share card. */
export const FITNESS_CARD = sectionCard('fitness');
