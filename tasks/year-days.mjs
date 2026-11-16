// @ts-check
// The "every single day" grid: one square per day of a year, in columns of Mondays-first weeks,
// the first week padded with blanks, each column carrying the month label where a month begins.
const DAY = 86400000;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * @param {number} year
 * @param {(day: string) => Record<string, any>} cellOf per-day fields merged into each cell
 * @param {string} lastDay YYYY-MM-DD; later days are marked `future`
 * @returns {{ cols: { month?: string, cells: any[] }[] }}
 */
export function dayGrid(year, cellOf, lastDay) {
  const end = Date.UTC(year + 1, 0, 1);
  /** @type {any[]} */
  const days = [];
  for (let t = Date.UTC(year, 0, 1); t < end; t += DAY) {
    const d = new Date(t);
    const day = d.toISOString().slice(0, 10);
    days.push({
      day, dow: (d.getUTCDay() + 6) % 7, ...cellOf(day),
      future: day > lastDay, first: d.getUTCDate() === 1 ? MON[d.getUTCMonth()] : '',
    });
  }
  const cells = [...Array.from({ length: days[0].dow }, () => ({ blank: true })), ...days.map((d, i) => ({ ...d, i }))];
  const cols = [];
  for (let i = 0; i < cells.length; i += 7) {
    const week = cells.slice(i, i + 7);
    cols.push({ cells: week, month: week.find((c) => c.first)?.first || '' });
  }
  return { cols };
}
