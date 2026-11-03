// @ts-check
/**
 * The /work page (LH3.7): data only. `buildWorkView` shapes the export's `work`
 * section (stats, roles newest first, the tech roster, career highlights, and an optional
 * salary table) into what the template loops over. No HTML strings here.
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

/**
 * @param {any} work the export's `sections.work`
 * @returns {{stats: {num:string,label:string}[], roles: any[], roster: any[], highlights: any[]|null, salary: any[]|null, updated: string, staleLabel: string} | null}
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
  return {
    stats: buildStats(work.stats),
    roles,
    roster,
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
