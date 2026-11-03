// @ts-check
/**
 * The /work page (LH3.7): data only. `buildWorkView` shapes the export's `work`
 * section (stats, roles newest first, the tech roster, education, and an optional
 * salary table) into what the template loops over. No HTML strings here.
 *
 * Global set by `workViewTask()`: `workView`, or `null` without a work section.
 */

const INKS = ['blue', 'green', 'magenta', 'orange', 'yellow'];
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
 * Salary rows ({id, gbp, delta, deltaPct}, newest first), matched to roles by id.
 * Null when there are none: the table is not drawn.
 * @param {any} salary @param {any[]} roles
 */
function buildSalary(salary, roles) {
  if (!Array.isArray(salary) || !salary.length) return null;
  const byId = new Map(roles.map((r) => [r.id, r]));
  const rows = salary
    .filter((s) => s && typeof s === 'object' && int(s.gbp) != null)
    .map((s) => {
      const r = byId.get(s.id);
      const d = int(s.delta);
      const p = int(s.deltaPct);
      const dir = d == null || d === 0 ? 'flat' : d > 0 ? 'up' : 'down';
      return {
        id: String(s.id || ''),
        role: r ? `${r.company}, ${r.title}` : '',
        company: r ? r.company : '',
        title: r ? r.title : '',
        salary: gbp(s.gbp),
        delta: d == null ? '' : (d > 0 ? '+' : d < 0 ? '−' : '') + gbp(d),
        deltaPct: p == null ? '' : (p > 0 ? '+' : p < 0 ? '−' : '') + Math.abs(Math.round(p * 10) / 10) + '%',
        dir,
      };
    })
    .filter((r) => r.role);
  return rows.length ? rows : null;
}

/**
 * @param {any} work the export's `sections.work`
 * @returns {{stats: {num:string,label:string}[], roles: any[], roster: any[], education: any, salary: any[]|null, updated: string, staleLabel: string} | null}
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
  const e = work.education && typeof work.education === 'object' ? work.education : null;
  const education = e && str(e.institution)
    ? {
        institution: str(e.institution),
        subject: str(e.subject),
        completed: e.completed === true,
        status: e.completed === true ? 'completed' : 'studied, not completed',
        years: [e.from ?? e.start, e.to ?? e.end].filter((y) => y != null && y !== '').join(' — '),
      }
    : null;
  const stale = int(work.staleDays);
  return {
    stats: buildStats(work.stats),
    roles,
    roster,
    education,
    salary: buildSalary(work.salary, rows),
    updated: str(work.updated),
    staleLabel: stale != null && stale >= 2 ? `last updated ${Math.floor(stale)} days ago` : '',
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
      return { workView: view };
    },
  };
}
