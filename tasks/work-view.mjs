// @ts-check
/**
 * The /work page (LH3.7): data only. `buildWorkView` shapes the export's `work`
 * section (stats, roles newest first, the tech roster, career highlights, and an optional
 * salary table) into what the template loops over, plus two charts on one year axis: the
 * career timeline (a band per company) and the tech chart (when each technology was used,
 * from the roles' tech lists). No HTML strings here.
 *
 * Global set by `workViewTask()`: `workView`, or `null` without a work section.
 */

const INKS = ['blue', 'green', 'magenta', 'orange', 'yellow', 'purple', 'red'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const int = (/** @type {unknown} */ n) => (typeof n === 'number' && Number.isFinite(n) ? n : null);
const str = (/** @type {unknown} */ s) => (typeof s === 'string' ? s.trim() : '');

/** @param {number} n */
const pad3 = (n) => String(n).padStart(3, '0');
/** @param {number} n */
const gbp = (n) => '£' + Math.round(Math.abs(n)).toLocaleString('en-GB');

/** 'Jun 2019' from YYYY-MM; '' when unusable. @param {unknown} ym */
function ymLabel(ym) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym || ''));
  return m && +m[2] >= 1 && +m[2] <= 12 ? `${MONTHS[+m[2] - 1]} ${m[1]}` : '';
}

/** @param {any} stats */
function buildStats(stats) {
  const s = stats && typeof stats === 'object' ? stats : {};
  /** @type {{num: string, label: string}[]} */
  const out = [];
  const y = int(s.yearsShipping);
  const e = int(s.employers);
  const c = int(s.contracting);
  const t = int(s.technologies);
  if (y != null) out.push({ num: String(y), label: 'years shipping' });
  if (e != null) out.push({ num: String(e), label: e === 1 ? 'employer' : 'employers' });
  if (c != null) out.push({ num: String(c), label: c === 1 ? 'contracting stint' : 'contracting stints' });
  if (t != null) out.push({ num: String(t), label: 'technologies' });
  return out;
}

/**
 * Salary rows ({id, startGbp, endGbp|null, delta, deltaPct}, newest first), matched to
 * roles by id. `delta` is this role's start minus the previous role's end: the move into
 * the job. Null when there are none: the table is not drawn.
 * @param {any} salary @param {any[]} roles
 */
function buildSalary(salary, roles) {
  if (!Array.isArray(salary) || !salary.length) return null;
  const byId = new Map(roles.map((r) => [r.id, r]));
  const sign = (/** @type {number} */ n) => (n > 0 ? '+' : n < 0 ? '−' : '');
  const rows = salary
    .filter((s) => s && typeof s === 'object' && int(s.startGbp) != null)
    .map((s) => {
      const r = byId.get(s.id);
      const start = /** @type {number} */ (int(s.startGbp));
      const end = int(s.endGbp);
      const d = int(s.delta);
      const p = int(s.deltaPct);
      const dir = d == null || d === 0 ? 'flat' : d > 0 ? 'up' : 'down';
      const pct = p == null ? '' : ` (${sign(p)}${Math.abs(Math.round(p * 10) / 10)}%)`;
      return {
        id: String(s.id || ''),
        role: r ? `${r.company}, ${r.title}` : '',
        company: r ? r.company : '',
        title: r ? r.title : '',
        start: gbp(start),
        end: end == null ? '' : gbp(end),
        salary: end == null || end === start ? gbp(start) : `${gbp(start)} → ${gbp(end)}`,
        move: d == null ? '' : `${sign(d)}${gbp(d)}${pct}`,
        delta: d == null ? '' : sign(d) + gbp(d),
        deltaPct: p == null ? '' : sign(p) + Math.abs(Math.round(p * 10) / 10) + '%',
        dir,
      };
    })
    .filter((r) => r.role);
  return rows.length ? rows : null;
}

/**
 * Career highlights ({label, detail|null, year|null, url|null}). Null when missing or
 * empty: the callout is not drawn. Only a label is required; a link must be https.
 * @param {any} highlights
 */
function buildHighlights(highlights) {
  if (!Array.isArray(highlights)) return null;
  const rows = highlights
    .filter((h) => h && typeof h === 'object' && str(h.label))
    .map((h, i) => {
      const url = str(h.url);
      const year = str(h.year);
      return {
        n: pad3(i + 1),
        label: str(h.label),
        detail: str(h.detail),
        year: /^\d{4}$/.test(year) ? year : '',
        url: /^https:\/\//.test(url) ? url : '',
      };
    });
  return rows.length ? rows : null;
}

// ─── the career timeline and the tech chart: one shared year axis ───

/** Tech groups for the chart, by normalised name; anything unlisted goes in "the rest". */
const TECH_GROUPS = [
  ['languages', ['go', 'typescript', 'javascript', 'scala', 'php', 'c#', 'visual-basic', 'python', 'ruby', 'java',
    'kotlin', 'swift', 'rust', 'sql', 'html', 'css', 'sass', 'elixir', 'c++', 'bash']],
  ['front end', ['react', 'redux', 'flux', 'angular', 'angularjs', 'next.js', 'gatsby', 'vue', 'svelte', 'jamstack',
    'jquery', 'webpack', 'react-native', 'storybook']],
  ['back end & data', ['node', 'symfony', 'asp.net', 'graphql', 'kafka', 'nsq', 'keyspaces', 'prismic', 'twilio-flex',
    'google-dialogflow', 'postgres', 'postgresql', 'mysql', 'redis', 'dynamodb', 'cassandra', 'elasticsearch', 'rest',
    'grpc', 'express', 'laravel']],
  ['cloud & delivery', ['aws', 'gcp', 'azure', 'kubernetes', 'docker', 'chef', 'jenkins', 'circleci', 'gitlab-ci',
    'github-actions', 'datadog', 'sentry', 'infosec', 'terraform', 'ansible', 'firebase']],
];
const REST = 'the rest';
/** @param {unknown} s */
const norm = (s) => String(s || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
/** @type {Map<string, string>} */
const GROUP_OF = new Map(TECH_GROUPS.flatMap(([label, names]) => /** @type {string[]} */ (names).map((n) => [n, /** @type {string} */ (label)])));

const r1 = (/** @type {number} */ n) => Math.round(n * 10) / 10;
const YM = /^(\d{4})-(\d{2})$/;

/**
 * The shared axis: Jan of the first role's year to Dec of the export's year; `pos(ym)` is the
 * percentage for the start of a month, `endPos(ym|null)` for the end of one (null: today).
 * @param {any[]} rows roles with a valid `from` @param {string} today YYYY-MM-DD
 */
function makeAxis(rows, today) {
  const from = Math.min(...rows.map((r) => +String(r.from).slice(0, 4)));
  const to = Math.max(+today.slice(0, 4), from);
  const months = (to - from + 1) * 12;
  const idx = (/** @type {string} */ ym) => (+ym.slice(0, 4) - from) * 12 + (+ym.slice(5, 7) - 1);
  const daysIn = new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7), 0)).getUTCDate();
  const nowIdx = idx(today.slice(0, 7)) + Math.min(1, +today.slice(8, 10) / daysIn);
  const pct = (/** @type {number} */ m) => r1(Math.max(0, Math.min(100, (100 * m) / months)));
  const ticks = [];
  for (let y = from; y <= to; y++) ticks.push({ label: String(y), short: `’${String(y).slice(2)}`, left: pct((y - from) * 12), odd: (y - from) % 2 === 1 });
  return {
    axis: { from, to, ticks },
    nowPct: pct(nowIdx),
    /** @param {string} ym */ startIdx: (ym) => idx(ym),
    /** @param {string|null} ym */ endIdx: (ym) => (ym && YM.test(ym) ? Math.min(idx(ym) + 1, nowIdx) : nowIdx),
    pct,
  };
}

/** '4 yrs' from a number of months. @param {number} m */
function yearsLabel(m) {
  const y = Math.round(m / 12);
  return m < 9 ? 'under a year' : y <= 1 ? '1 yr' : `${y} yrs`;
}

/**
 * @param {any[]} roles buildWorkView roles (newest first, with ink) @param {any[]} raw the export rows
 * @param {any[]} roster buildWorkView roster @param {string} today
 */
function buildCharts(roles, raw, roster, today) {
  const dated = raw.map((r, i) => ({ r, v: roles[i] })).filter(({ r }) => YM.test(String(r.from)) && (r.to == null || YM.test(String(r.to))));
  if (!dated.length) return { timeline: null, techChart: null };
  const ax = makeAxis(dated.map(({ r }) => r), today);
  const seg = (/** @type {any} */ r, /** @type {any} */ v) => {
    const a = ax.startIdx(r.from);
    const b = ax.endIdx(r.to);
    const left = ax.pct(a);
    return {
      company: v.company, title: v.title, ink: v.ink, contract: v.contract, current: v.current,
      left, width: Math.max(0.6, r1(ax.pct(b) - left)), a, b,
      label: `${v.title}, ${ymLabel(r.from)} to ${r.to ? ymLabel(r.to) : 'now'}`,
    };
  };
  const oldestFirst = [...dated].sort((x, y) => String(x.r.from).localeCompare(String(y.r.from)));

  /** @type {Map<string, any>} */
  const byCompany = new Map();
  for (const { r, v } of oldestFirst) {
    if (!byCompany.has(v.company)) byCompany.set(v.company, { company: v.company, ink: v.ink, roles: [], current: false, contract: true });
    const row = byCompany.get(v.company);
    row.roles.push(seg(r, v));
    row.current = row.current || v.current;
    row.contract = row.contract && v.contract;
  }
  const rows = [...byCompany.values()].map((row) => {
    const first = String(oldestFirst.find(({ v }) => v.company === row.company)?.r.from).slice(0, 4);
    const ends = dated.filter(({ v }) => v.company === row.company).map(({ r }) => r.to);
    const last = ends.includes(null) ? 'now' : String(ends.sort().at(-1)).slice(0, 4);
    const titles = [...new Set(row.roles.map((/** @type {any} */ s) => s.title))];
    return {
      ...row,
      roles: row.roles.map(({ a: _a, b: _b, ...s }) => s),
      when: first === last ? first : `${first} – ${last}`,
      titles: titles.join(' → '),
    };
  });

  /** @type {Map<string, {spans: any[], months: Set<number>, first: string}>} */
  const used = new Map();
  for (const { r, v } of oldestFirst) {
    for (const t of Array.isArray(r.tech) ? r.tech : []) {
      const k = norm(t);
      if (!k) continue;
      if (!used.has(k)) used.set(k, { spans: [], months: new Set(), first: String(r.from) });
      const u = /** @type {any} */ (used.get(k));
      const s = seg(r, v);
      u.spans.push({ company: s.company, ink: s.ink, left: s.left, width: s.width, contract: s.contract, current: s.current, label: `${s.company}: ${s.label}` });
      for (let m = Math.floor(s.a); m < Math.ceil(s.b); m++) u.months.add(m);
    }
  }
  /** @type {Map<string, any[]>} */
  const grouped = new Map();
  for (const t of roster) {
    const k = norm(t.name);
    const u = used.get(k);
    const g = GROUP_OF.get(k) || REST;
    if (!grouped.has(g)) grouped.set(g, []);
    /** @type {any[]} */ (grouped.get(g)).push({
      name: t.name, current: t.current, spans: u ? u.spans : [], first: u ? u.first : '9999-99',
      years: u ? yearsLabel(u.months.size) : '',
    });
  }
  const order = [...TECH_GROUPS.map(([l]) => /** @type {string} */ (l)), REST];
  const groups = order.filter((g) => grouped.has(g)).map((label) => ({
    label,
    rows: /** @type {any[]} */ (grouped.get(label))
      .sort((a, b) => a.first.localeCompare(b.first) || a.name.localeCompare(b.name))
      .map(({ first: _f, ...row }) => row),
  }));
  return {
    timeline: { axis: ax.axis, nowPct: ax.nowPct, rows },
    techChart: { axis: ax.axis, nowPct: ax.nowPct, groups, legend: rows.map((r) => ({ company: r.company, ink: r.ink, contract: r.contract })) },
  };
}

/**
 * @param {any} work the export's `sections.work`
 * @returns {{stats: {num:string,label:string}[], roles: any[], roster: any[], timeline: any, techChart: any, highlights: any[]|null, salary: any[]|null, updated: string, staleLabel: string} | null}
 */
export function buildWorkView(work) {
  if (!work || typeof work !== 'object' || !Array.isArray(work.roles)) return null;
  const rows = work.roles.filter((r) => r && typeof r === 'object' && str(r.company) && str(r.title));
  if (!rows.length) return null;
  /** @type {Map<string, string>} */
  const inkOf = new Map();
  const total = rows.length;
  const roles = rows.map((r, i) => {
    const company = str(r.company);
    if (!inkOf.has(company)) inkOf.set(company, INKS[inkOf.size % INKS.length]);
    const current = r.to == null;
    const body = str(r.body);
    return {
      id: String(r.id || ''),
      badge: pad3(i + 1), // 001 = newest
      current,
      company,
      companyUpper: company.toUpperCase(),
      title: str(r.title),
      team: str(r.team),
      note: str(r.note),
      period: str(r.period) || [ymLabel(r.from), r.to ? ymLabel(r.to) : 'present'].filter(Boolean).join(' — '),
      kind: str(r.kind),
      contract: r.kind === 'contract',
      paragraphs: body ? body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean) : [],
      tech: (Array.isArray(r.tech) ? r.tech : []).map(str).filter(Boolean),
      ink: inkOf.get(company),
      last: i === total - 1,
    };
  });
  const roster = (Array.isArray(work.roster) ? work.roster : [])
    .filter((t) => t && str(t.name))
    .map((t) => ({ name: str(t.name), current: !!t.current, mark: t.current ? '★' : '☆' }));
  const highlights = buildHighlights(work.highlights);
  const stale = int(work.staleDays);
  const today = /^\d{4}-\d{2}-\d{2}$/.test(str(work.updated)) ? str(work.updated) : new Date().toISOString().slice(0, 10);
  return {
    stats: buildStats(work.stats),
    roles,
    roster,
    ...buildCharts(roles, rows, roster, today),
    highlights,
    salary: buildSalary(work.salary, rows),
    updated: str(work.updated),
    staleLabel: stale != null && stale >= 2 ? `last updated ${Math.floor(stale)} days ago` : '',
  };
}

/** Neutral copy for the homepage when there is no export: no specific claims. */
export const HOME_FALLBACK = {
  latestRole: 'work',
  latestRoleDate: '',
  latestRoleTitle: '',
  latestRoleBlurb: 'Where I have worked and what I build with.',
  workBlurb: 'Where I have worked, and the technologies I use.',
};

/**
 * The homepage's current-role globals and the /work card blurb, from the view.
 * @param {ReturnType<typeof buildWorkView>} view
 */
export function homeRoleGlobals(view) {
  if (!view) return { ...HOME_FALLBACK };
  const r = view.roles[0];
  const companies = [...new Set(view.roles.map((x) => x.company))];
  const list = companies.length > 1 ? `${companies.slice(0, -1).join(', ')} and ${companies[companies.length - 1]}` : companies[0];
  return {
    latestRole: r.company,
    latestRoleDate: r.period.replace(' — ', ' → ').replace(/present$/, 'now'),
    latestRoleTitle: r.title + (r.team ? ` · ${r.team}` : ''),
    latestRoleBlurb: r.paragraphs[0] || r.note || '',
    workBlurb: `Career history (${list}) and a long list of technologies.`,
  };
}

export function workViewTask(config = {}) {
  return {
    name: 'work-view',
    title: 'Build the /work view model',
    config,
    run: async (/** @type {any} */ _cfg, /** @type {any} */ ctx) => {
      const view = buildWorkView(ctx.globals?.lifeIndex?.sections?.work);
      ctx.logger.info(view ? `Work: ${view.roles.length} roles` : 'Work: no section in the export');
      return { workView: view, ...homeRoleGlobals(view) };
    },
  };
}
