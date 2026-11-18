// The thoughts archive as data: one entry per post, oldest first, with what the listing and the
// post pages show around the words — the issue number, how-to vs hot take, read time, the
// sections (for "inside this issue" and the post's contents card) and its neighbours.
//
// Skier's generateItemsTask renders each post without knowing about the others, and its list
// entries carry only the basics, so both the post pages (thoughtPageVars) and the listing
// (enrichThoughtsListTask) read from here.
import fs from 'fs';
import path from 'path';

const WORDS_PER_MIN = 200;

export function estimateReadTime(text) {
  if (!text) return 1;
  return Math.max(1, Math.ceil(text.trim().split(/\s+/).length / WORDS_PER_MIN));
}

// Same rule as Skier's titleFromFilename, so a title here matches the post's own.
export function titleFromItemName(itemName) {
  const m = itemName.match(/^\d{4}-\d{2}-\d{2}[-_]?(.+)$/);
  return (m?.[1] ?? itemName).replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim();
}

const DATE_FMT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/** A guide shows its working (code blocks); anything else is an opinion. */
export function kindOf(markdown) {
  return /^```/m.test(markdown) ? 'how-to' : 'hot take';
}

/** The post's `## ` sections, in order. Ids come from Skier's renderer on the page itself. */
export function sectionsOf(markdown) {
  const out = [];
  let inFence = false;
  for (const line of markdown.split('\n')) {
    if (/^```/.test(line)) inFence = !inFence;
    if (inFence) continue;
    const m = line.match(/^##\s+(.+?)\s*#*\s*$/);
    if (m) out.push(m[1].replace(/[*_`]/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'));
  }
  return out;
}

/** Every post in `dir` (YYYY-MM-DD_Title.md), oldest first, numbered from 1. */
export function readThoughts(dir) {
  const files = fs.readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}_.+\.md$/.test(f)).sort();
  return files.map((file, i) => {
    const itemName = file.replace(/\.md$/, '');
    const markdown = fs.readFileSync(path.join(dir, file), 'utf8');
    const date = new Date(`${itemName.slice(0, 10)}T00:00:00Z`);
    return {
      itemName,
      issue: String(i + 1).padStart(2, '0'),
      title: titleFromItemName(itemName),
      relativePath: `thoughts/${itemName}.html`,
      year: date.getUTCFullYear(),
      dateDisplay: DATE_FMT.format(date),
      readTime: String(estimateReadTime(markdown)),
      words: markdown.trim().split(/\s+/).length,
      kind: kindOf(markdown),
      sections: sectionsOf(markdown),
    };
  });
}

const neighbour = (t) => t && { title: t.title, relativePath: t.relativePath, dateDisplay: t.dateDisplay, issue: t.issue };

/**
 * The extra variables a post page renders with. `headings` are Skier's, so the contents card's
 * links use the exact ids on the page. prev = the older post, next = the newer one.
 */
export function thoughtPageVars(all, itemName, headings = []) {
  const i = all.findIndex((t) => t.itemName === itemName);
  if (i < 0) return {};
  const t = all[i];
  return {
    issue: t.issue,
    kind: t.kind,
    isHowTo: t.kind === 'how-to',
    readTime: t.readTime,
    words: t.words.toLocaleString('en-GB'),
    toc: headings.filter((h) => h.level === 2).map((h, n) => ({ ...h, num: String(n + 1).padStart(2, '0') })),
    prevThought: neighbour(all[i - 1]),
    nextThought: neighbour(all[i + 1]),
  };
}

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

/**
 * The listing's entries (newest first, as Skier sorts them) with the archive's extras merged in,
 * plus where a new year starts and, when years were skipped, the note that owns up to it.
 */
export function enrichList(list, all) {
  const byName = new Map(all.map((t) => [t.itemName, t]));
  let prevYear = null;
  return list.map((item, i) => {
    const t = byName.get(item.itemName) ?? {};
    const year = t.year ?? new Date(item.date).getUTCFullYear();
    const out = {
      ...item,
      issue: t.issue,
      kind: t.kind,
      isHowTo: t.kind === 'how-to',
      readTime: t.readTime ?? String(estimateReadTime(item.body)),
      sections: t.sections ?? [],
      year,
      yearStart: i === 1 || (i > 0 && year !== prevYear), // the grid always opens on a year
      cover: i === 0, // the newest post leads page 1 as the cover story
    };
    if (prevYear !== null && year !== prevYear) {
      const gap = prevYear - year - 1;
      if (gap >= 2) out.gapNote = `${NUMBER_WORDS[gap] ?? gap} year${gap === 1 ? '' : 's'} of radio silence. i was busy. (honest.)`;
    }
    prevYear = year;
    return out;
  });
}

/**
 * Skier task: rewrite the listing's JSON with the extras (the paginated listing reads that file)
 * and expose the archive's counts as globals.
 */
export function enrichThoughtsListTask({ itemsDir, jsonFile }) {
  return {
    name: 'enrich-thoughts-list',
    title: 'Add issue numbers, kinds and year breaks to the thoughts list',
    run: async (_cfg, ctx) => {
      const all = readThoughts(itemsDir);
      const list = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
      const enriched = enrichList(list, all);
      fs.writeFileSync(jsonFile, JSON.stringify(enriched, null, 2));
      ctx.globals.thoughtsHowTos = all.filter((t) => t.kind === 'how-to').length;
      ctx.globals.thoughtsHotTakes = all.length - ctx.globals.thoughtsHowTos;
      ctx.globals.thoughtsWords = all.reduce((n, t) => n + t.words, 0).toLocaleString('en-GB');
      return {};
    },
  };
}
