// @ts-check
/**
 * The awards' pictures (the year in review, chapter 08): one line drawing per award, in
 * the zine's hand: thick ink strokes on a 64-unit square, the award's colour as a flat
 * fill (class `f`, coloured by the page's --c), a few halftone-ish dots. Pure markup the
 * page inlines; every shape is ours, nothing user-supplied goes in.
 */

/** @type {Record<string, string>} */
const ICONS = {
  // a stopwatch with the hand right round
  'MARATHON EFFORT': '<rect x="27" y="4" width="10" height="6" rx="1"/><path d="M32 10v5"/><path d="M47 15l4-4"/><circle class="f" cx="32" cy="38" r="22"/><circle cx="32" cy="38" r="22"/><path d="M32 38V24"/><path d="M32 38l9 6"/><circle cx="32" cy="38" r="2.5" class="k"/>',
  // a loaded barbell
  'HEAVY LIFTING': '<path d="M6 32h52"/><rect class="f" x="12" y="18" width="7" height="28" rx="1.5"/><rect x="12" y="18" width="7" height="28" rx="1.5"/><rect class="f" x="45" y="18" width="7" height="28" rx="1.5"/><rect x="45" y="18" width="7" height="28" rx="1.5"/><rect x="20" y="23" width="4" height="18" rx="1"/><rect x="40" y="23" width="4" height="18" rx="1"/><path d="M26 54h12M29 50h6"/>',
  // a heart with a trace through it
  'RED LINE': '<path class="f" d="M32 54C14 41 7 32 7 22a11 11 0 0 1 25-7 11 11 0 0 1 25 7c0 10-7 19-25 32z"/><path d="M32 54C14 41 7 32 7 22a11 11 0 0 1 25-7 11 11 0 0 1 25 7c0 10-7 19-25 32z"/><path d="M4 33h14l4-8 6 16 5-12 3 4h24"/>',
  // a bell alarm clock
  'ALARM CLOCK': '<circle class="f" cx="32" cy="35" r="19"/><circle cx="32" cy="35" r="19"/><path d="M10 14a9 9 0 0 1 12-4"/><path d="M54 14a9 9 0 0 0-12-4"/><path d="M32 35V24M32 35l-7 5"/><path d="M19 52l-4 6M45 52l4 6"/><path d="M4 26l4 2M60 26l-4 2"/>',
  // a crescent moon and stars
  'NIGHT SHIFT': '<path class="f" d="M40 8a24 24 0 1 0 16 38A20 20 0 0 1 40 8z"/><path d="M40 8a24 24 0 1 0 16 38A20 20 0 0 1 40 8z"/><path d="M50 14l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" class="k"/><circle cx="56" cy="34" r="1.8" class="k"/>',
  // two lightning bolts
  'DOUBLE DAY': '<path class="f" d="M24 4L10 34h11l-5 26 19-34H24l6-22z"/><path d="M24 4L10 34h11l-5 26 19-34H24l6-22z"/><path d="M46 12l-8 18h7l-3 16 11-20h-7l4-14z"/>',
  // a calendar page with one day ringed
  'FAVOURITE DAY': '<rect class="f" x="8" y="12" width="48" height="44" rx="2"/><rect x="8" y="12" width="48" height="44" rx="2"/><path d="M8 24h48"/><path d="M20 6v10M44 6v10"/><circle cx="20" cy="33" r="1.8" class="k"/><circle cx="32" cy="33" r="1.8" class="k"/><circle cx="20" cy="45" r="1.8" class="k"/><circle cx="32" cy="45" r="1.8" class="k"/><circle cx="44" cy="45" r="1.8" class="k"/><ellipse cx="44" cy="33" rx="7" ry="6" transform="rotate(-12 44 33)"/>',
  // round-and-round arrows
  REGULAR: '<path class="f" d="M32 10a22 22 0 1 1-21 16"/><path d="M32 10a22 22 0 1 1-21 16"/><path d="M4 22l7 5 5-8"/><circle cx="32" cy="32" r="6"/><path d="M32 32h0"/>',
  // a house with a flag
  'SECOND HOME': '<path class="f" d="M10 30L32 12l22 18v26H10z"/><path d="M10 30L32 12l22 18v26H10z"/><path d="M4 34L32 10l28 24"/><rect x="26" y="40" width="12" height="16"/><path d="M46 20V4h10l-3 4 3 4H46"/>',
  // a road to a vanishing point and a flag
  FURTHEST: '<path class="f" d="M4 58L28 18h8l24 40z"/><path d="M4 58L28 18h8l24 40z"/><path d="M32 24v5M32 35v7M32 49v8"/><path d="M42 18V4h12l-3 4 3 4H42"/>',
};
/** Anything new gets a star. */
const STAR = '<path class="f" d="M32 4l8 18 19 2-14 13 4 19-17-10-17 10 4-19L5 24l19-2z"/><path d="M32 4l8 18 19 2-14 13 4 19-17-10-17 10 4-19L5 24l19-2z"/>';

/** The drawing for an award, as inline SVG. @param {string} stamp */
export function awardIcon(stamp) {
  return `<svg class="yr-award__icon" viewBox="0 0 64 64" aria-hidden="true">${ICONS[stamp] || STAR}</svg>`;
}

/** The awards that have their own drawing. */
export const AWARD_ICON_STAMPS = Object.keys(ICONS);
