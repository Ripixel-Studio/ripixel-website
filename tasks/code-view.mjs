// @ts-check
/**
 * /life/code, the two drawn parts (data only; the templates loop and test):
 *
 *   commitGrid(commitsByDay, endDay)   53 Monday-first weeks of commits, GitHub-contribution style:
 *                                      cells with SVG coordinates, month and day labels, a legend
 *                                      and four stats. Null without daily counts.
 *   projectCards(projects, series, endDay)
 *                                      one card per project: a language strip (share of its code),
 *                                      a commits bar relative to the busiest project, and its active
 *                                      span on a timeline every card shares.
 *   languageSlots(projects, series)    language -> colour slot: the languages chart's series first
 *                                      (so a language is the same colour in both), then up to three
 *                                      more inks for the next most-used, the rest grey.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEKS = 53;
const CELL = 11;
const STEP = 14;
const LEFT = 30;
const TOP = 18;
const EXTRA_SLOTS = [7, 8, 9];
const OTHER_SLOT = 6;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const r1 = (/** @type {number} */ n) => Math.round(n * 10) / 10;
const group = (/** @type {number} */ n) => Math.round(n).toLocaleString('en-GB');
const num = (/** @type {unknown} */ n) => (typeof n === 'number' && Number.isFinite(n) ? n : null);

/** @param {string} s YYYY-MM-DD, read as a UTC date */
const utc = (s) => new Date(`${s}T00:00:00Z`);
/** @param {Date} d */
const iso = (d) => d.toISOString().slice(0, 10);
/** @param {Date} d @param {number} n */
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);
/** Monday = 0 ... Sunday = 6 @param {Date} d */
const weekday = (d) => (d.getUTCDay() + 6) % 7;
/** 'Tue 3 Nov 2026' @param {Date} d */
const longDay = (d) => `${DAYS[weekday(d)]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;

/**
 * @param {any} commitsByDay [{day, n}]
 * @param {string} endDay YYYY-MM-DD: the last day drawn (the export's `updated`)
 */
export function commitGrid(commitsByDay, endDay) {
  if (!Array.isArray(commitsByDay) || !commitsByDay.length || !DAY.test(String(endDay))) return null;
  const end = utc(endDay);
  const first = addDays(end, -weekday(end) - (WEEKS - 1) * 7);
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const r of commitsByDay) {
    const n = num(r?.n);
    const d = String(r?.day ?? '');
    if (!DAY.test(d) || n == null || n <= 0 || d < iso(first) || d > endDay) continue;
    counts.set(d, (counts.get(d) ?? 0) + Math.round(n));
  }
  if (!counts.size) return null;

  // four levels: quartiles of the days that had any commits
  const busy = [...counts.values()].sort((a, b) => a - b);
  const q = (/** @type {number} */ f) => busy[Math.min(busy.length - 1, Math.ceil(f * busy.length) - 1)];
  const cuts = [q(0.25), q(0.5), q(0.75)];
  const level = (/** @type {number} */ n) => (n <= 0 ? 0 : n <= cuts[0] ? 1 : n <= cuts[1] ? 2 : n <= cuts[2] ? 3 : 4);

  const cells = [];
  /** @type {{label: string, col: number, x: number}[]} */
  const months = [];
  let run = 0, best = 0, total = 0, active = 0;
  /** @type {{n: number, d: Date} | null} */
  let top = null;
  for (let d = first, i = 0; d <= end; d = addDays(d, 1), i++) {
    const key = iso(d);
    const n = counts.get(key) ?? 0;
    const col = Math.floor(i / 7);
    const row = weekday(d);
    if (row === 0) {
      // a month's label sits over the first week that starts in it; never closer than 3 weeks,
      // and never in the last two columns, where it would run off the edge
      const m = d.getUTCMonth();
      const prev = months.at(-1);
      if ((col === 0 || addDays(d, -7).getUTCMonth() !== m) && (!prev || col - prev.col >= 3) && col <= WEEKS - 3) {
        months.push({ label: MONTHS[m], col, x: LEFT + col * STEP });
      }
    }
    run = n ? run + 1 : 0;
    best = Math.max(best, run);
    total += n;
    if (n) active++;
    if (n && (!top || n > top.n)) top = { n, d };
    cells.push({
      day: key, n, col, row, level: level(n),
      x: LEFT + col * STEP, y: TOP + row * STEP,
      title: `${n ? `${group(n)} ${n === 1 ? 'commit' : 'commits'}` : 'No commits'}, ${longDay(d)}`,
    });
  }
  const t = /** @type {{n: number, d: Date}} */ (top);
  return {
    weeks: WEEKS,
    cell: CELL,
    width: LEFT + WEEKS * STEP,
    height: TOP + 7 * STEP,
    cells,
    months: months.map((m) => ({ ...m, y: TOP - 6 })),
    dayLabels: [0, 2, 4].map((r) => ({ label: DAYS[r], x: LEFT - 6, y: TOP + r * STEP + CELL - 2 })),
    legend: [0, 1, 2, 3, 4].map((l) => ({ level: l })),
    total,
    stats: [
      { label: 'Commits', value: group(total), unit: '', sub: 'in the last 12 months' },
      { label: 'Days with a commit', value: group(active), unit: '', sub: `of ${group(cells.length)}` },
      { label: 'Longest run', value: group(best), unit: best === 1 ? 'day' : 'days', sub: 'in a row' },
      { label: 'Busiest day', value: group(t.n), unit: t.n === 1 ? 'commit' : 'commits', sub: longDay(t.d) },
    ],
  };
}

/**
 * @param {any[]} projects export rows ({languages, languageShare})
 * @param {string[]} series the languages chart's series keys, in slot order (Other excluded)
 * @returns {Map<string, number>}
 */
export function languageSlots(projects, series) {
  /** @type {Map<string, number>} */
  const slots = new Map();
  (series || []).filter((k) => k && k !== 'Other').slice(0, 5).forEach((k, i) => slots.set(k, i + 1));
  /** @type {Map<string, number>} */
  const weight = new Map();
  for (const p of projects || []) {
    const langs = Array.isArray(p?.languages) ? p.languages : [];
    const shares = Array.isArray(p?.languageShare) ? p.languageShare : [];
    langs.forEach((/** @type {unknown} */ l, /** @type {number} */ i) => {
      if (typeof l !== 'string' || !l || slots.has(l)) return;
      weight.set(l, (weight.get(l) ?? 0) + (num(shares[i]) ?? 1));
    });
  }
  [...weight.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, EXTRA_SLOTS.length).forEach(([l], i) => slots.set(l, EXTRA_SLOTS[i]));
  return slots;
}

/** Months since Jan of `year` to the start of YYYY-MM(-DD)'s month. @param {string} ym @param {number} year */
const monthIdx = (ym, year) => (+ym.slice(0, 4) - year) * 12 + (+ym.slice(5, 7) - 1);
/** 'Aug 2025' @param {string} ym */
const ymLabel = (ym) => `${MONTHS[+ym.slice(5, 7) - 1]} ${ym.slice(0, 4)}`;

/**
 * @param {any[]} projects export rows (active ones), in the export's order
 * @param {string[]} series the languages chart's series keys
 * @param {string} endDay YYYY-MM-DD
 */
export function projectCards(projects, series, endDay) {
  const rows = (projects || []).filter((p) => p && typeof p === 'object' && p.name);
  const slots = languageSlots(rows, series);
  const end = DAY.test(String(endDay)) ? String(endDay) : new Date().toISOString().slice(0, 10);
  const startOf = (/** @type {any} */ p) => {
    const s = String(p.started || '');
    if (/^\d{4}-\d{2}/.test(s)) return s.slice(0, 7);
    return Number.isInteger(p.fromYear) ? `${p.fromYear}-01` : '';
  };
  const years = rows.map(startOf).filter(Boolean).map((s) => +s.slice(0, 4));
  const to = +end.slice(0, 4);
  const from = Math.min(to, ...years);
  const span = (to - from + 1) * 12;
  const pct = (/** @type {number} */ months) => r1(Math.max(0, Math.min(100, (100 * months) / span)));
  const endIdx = monthIdx(end, from);
  const daysIn = new Date(Date.UTC(+end.slice(0, 4), +end.slice(5, 7), 0)).getUTCDate();
  const nowPct = pct(endIdx + +end.slice(8, 10) / daysIn);
  const max = Math.max(0, ...rows.map((p) => num(p.commits) ?? 0));

  const cards = rows.map((p) => {
    const langs = (Array.isArray(p.languages) ? p.languages : []).filter((/** @type {unknown} */ l) => typeof l === 'string' && l);
    const shares = Array.isArray(p.languageShare) && p.languageShare.length === langs.length
      && p.languageShare.every((/** @type {unknown} */ x) => num(x) != null && /** @type {number} */ (x) >= 0)
      ? p.languageShare : null;
    /** @type {{name: string, pct: number, slot: number, left: number, label: string}[]} */
    const strip = [];
    let left = 0;
    langs.forEach((/** @type {string} */ name, /** @type {number} */ i) => {
      const w = shares ? shares[i] : r1(100 / langs.length);
      if (w <= 0) return;
      strip.push({ name, pct: w, slot: slots.get(name) ?? OTHER_SLOT, left: r1(left), label: shares ? `${name} ${w}%` : name });
      left += w;
    });
    if (shares && strip.length && left < 100) strip.push({ name: 'other', pct: r1(100 - left), slot: OTHER_SLOT, left: r1(left), label: `other ${r1(100 - left)}%` });

    const start = startOf(p);
    const last = /^\d{4}-\d{2}$/.test(String(p.lastCommit || '')) ? String(p.lastCommit) : '';
    const live = !!last && endIdx - monthIdx(last, from) <= 1;
    const a = start ? monthIdx(start, from) : 0;
    const b = last ? monthIdx(last, from) + 1 : a + 1;
    const commits = num(p.commits);
    return {
      name: String(p.name),
      strip,
      bar: commits != null && max > 0 ? Math.max(1.5, r1((100 * commits) / max)) : 0,
      commits: commits != null ? group(commits) : '',
      commitsUnit: commits === 1 ? 'commit' : 'commits',
      span: { left: pct(a), width: Math.max(1, r1(pct(b) - pct(a))) },
      live,
      when: !start ? '' : last ? `${ymLabel(start)} – ${live ? 'now' : ymLabel(last)}` : `since ${ymLabel(start)}`,
    };
  });
  const ticks = [];
  for (let y = from; y <= to; y++) ticks.push({ label: String(y), short: `’${String(y).slice(2)}`, left: pct((y - from) * 12) });
  return { cards, axis: { from, to, ticks }, nowPct };
}
