// @ts-check
// The one convention for "this card goes somewhere" (see the card-link section at the end of
// personal/assets/styles/main/styles.css). A clickable card carries `card-link` and exactly one
// `card-link__arrow` (the {{> card-arrow}} partial). Either the card is the <a> itself, or it holds
// exactly one `a.card-link__target` whose overlay stretches over the card; any other link inside
// is a `card-link__aside`, raised above that overlay. A card that only looks nice on hover carries
// `card-tilt` and never a link, the arrow or the lift. These checks run over built pages and the
// source CSS (tasks/card-link.test.mjs, tasks/life-links.test.mjs).

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const RAW = new Set(['script', 'style', 'template', 'textarea', 'title']);

/**
 * @typedef {{ tag: string, attrs: Record<string, string>, classes: Set<string>, children: El[], line: number }} El
 */

/** @param {string} s @returns {Record<string, string>} */
function parseAttrs(s) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const m of s.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
    out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
  }
  return out;
}

/**
 * A forgiving tree of the page's elements: enough to ask "what links are inside this card".
 * @param {string} html @returns {El}
 */
export function parseHtml(html) {
  /** @type {El} */
  const root = { tag: '#root', attrs: {}, classes: new Set(), children: [], line: 0 };
  /** @type {El[]} */
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let m;
  while ((m = re.exec(html))) {
    if (!m[2]) continue; // comment
    const tag = m[2].toLowerCase();
    if (m[1]) {
      const i = stack.map((e) => e.tag).lastIndexOf(tag);
      if (i > 0) stack.length = i;
      continue;
    }
    const attrs = parseAttrs(m[3]);
    const line = html.slice(0, m.index).split('\n').length;
    /** @type {El} */
    const el = { tag, attrs, classes: new Set((attrs.class || '').split(/\s+/).filter(Boolean)), children: [], line };
    stack[stack.length - 1].children.push(el);
    if (VOID.has(tag) || /\/\s*$/.test(m[3])) continue;
    if (RAW.has(tag)) {
      const close = html.toLowerCase().indexOf(`</${tag}`, re.lastIndex);
      re.lastIndex = close < 0 ? html.length : close;
      continue;
    }
    stack.push(el);
  }
  return root;
}

/** @param {El} el @returns {Generator<El>} */
function* descendants(el) {
  for (const c of el.children) {
    yield c;
    yield* descendants(c);
  }
}

/** @param {El} el */
const isInteractive = (el) => (el.tag === 'a' && 'href' in el.attrs) || el.tag === 'button';

/** @param {El} el */
const label = (el) => `<${el.tag} class="${[...el.classes].join(' ')}"> (line ${el.line})`;

/**
 * Problems with the clickable-card convention in one built page.
 * @param {string} html @returns {string[]}
 */
export function auditHtml(html) {
  const problems = [];
  const root = parseHtml(html);
  /** @param {El} el @param {El | null} card */
  const walk = (el, card) => {
    for (const c of el.children) {
      if (c.classes.has('card-link')) {
        if (card) problems.push(`card-link inside another card-link: ${label(c)}`);
        checkCard(c);
      }
      if (c.classes.has('card-link__arrow')) {
        if (!card && !c.classes.has('card-link')) problems.push(`arrow outside a card-link: ${label(c)}`);
        if (c.attrs['aria-hidden'] !== 'true') problems.push(`arrow is not aria-hidden: ${label(c)}`);
      }
      if (c.classes.has('card-link__target') && !card && !c.classes.has('card-link')) problems.push(`card-link__target outside a card-link: ${label(c)}`);
      if (c.classes.has('card-tilt') || DECORATIVE.some((d) => c.classes.has(d))) {
        if (c.classes.has('card-link')) problems.push(`decorative tilt and card-link on one element: ${label(c)}`);
        if (isInteractive(c) || [...descendants(c)].some(isInteractive)) problems.push(`a decorative tilt holds a link, so it should be a card-link: ${label(c)}`);
      }
      walk(c, c.classes.has('card-link') ? c : card);
    }
  };
  /** @param {El} card */
  const checkCard = (card) => {
    const inside = [...descendants(card)];
    const arrows = inside.filter((e) => e.classes.has('card-link__arrow'));
    if (arrows.length !== 1) problems.push(`card-link has ${arrows.length} arrows (want 1): ${label(card)}`);
    const links = inside.filter(isInteractive);
    if (card.tag === 'a') {
      if (!('href' in card.attrs)) problems.push(`card-link <a> without href: ${label(card)}`);
      for (const l of links) problems.push(`link nested inside a card-link <a>: ${label(l)} in ${label(card)}`);
      return;
    }
    if (isInteractive(card)) problems.push(`card-link on a ${card.tag}: ${label(card)}`);
    const targets = links.filter((l) => l.classes.has('card-link__target'));
    if (targets.length !== 1) problems.push(`card-link has ${targets.length} card-link__target links (want 1): ${label(card)}`);
    for (const t of targets) if (t.tag !== 'a') problems.push(`card-link__target is not an <a>: ${label(t)}`);
    for (const l of links) {
      if (!l.classes.has('card-link__target') && !l.classes.has('card-link__aside')) problems.push(`second link in a card-link is neither target nor aside: ${label(l)} in ${label(card)}`);
    }
  };
  walk(root, null);
  return problems;
}

/** Wall tiles with their own hover (straighten to be read): decorative, so never a link. */
export const DECORATIVE = ['gbox', 'vcase', 'stub', 'book-spine', 'cd', 'pl-tape'];

/** Hover rules that may move or lift something that is not a card-link, and why. */
export const HOVER_ALLOW = {
  // Buttons and button-like links: their own pressed/lifted look, never a card.
  'share__open': 'a button (opens the share picker)',
  'corp-cta__btn': 'a button in the footer bridge',
  'fit-more': 'a button-styled link under the latest sessions',
  'ss-filter': 'the sessions list filter chips (buttons)',
  // Decorative, non-clickable: straighten to be read, never a link (auditHtml checks there is no link inside).
  'gbox': 'a game box on the games shelf, lifted to show its back',
  'vcase': 'a DVD case or box set on the rental wall, lifted to show its back',
  'stub': 'decorative ticket stub, straightens to be read',
  'book-spine': 'a spine on the reading shelf, pulled out to show its cover card',
  'cd': 'a CD case in the listening crate, straightens to be read',
  'pl-tape': 'a playlist cassette on the listening page, straightens to be read',
  'ev-collage__tile': 'photo zoom inside its own frame (the image scales, the frame does not move)',
};

/**
 * Selectors in source CSS that move, tilt or lift an element on :hover outside the convention.
 * @param {string} css @returns {string[]}
 */
export function auditCss(css) {
  const problems = [];
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of clean.matchAll(/([^{}@;]+)\{([^{}]*)\}/g)) {
    const selectors = m[1].split(',').map((s) => s.trim()).filter((s) => s.includes(':hover'));
    if (!selectors.length) continue;
    const decl = m[2];
    if (!/(^|[;\s])(transform|rotate|translate|box-shadow|cursor)\s*:/.test(decl)) continue;
    if (/(^|[;\s])transform\s*:\s*none/.test(decl) && !/box-shadow|rotate\s*:|translate\s*:/.test(decl)) continue;
    for (const sel of selectors) {
      if (/\.card-link\b|\.card-tilt\b/.test(sel)) continue;
      const hovered = sel.split(':hover')[0];
      const cls = (hovered.match(/\.([\w-]+)(?![\w-])[^.\s>+~]*$/) || [])[1];
      if (cls && Object.keys(HOVER_ALLOW).some((k) => cls === k || cls.startsWith(`${k}--`))) continue;
      problems.push(sel);
    }
  }
  return problems;
}
