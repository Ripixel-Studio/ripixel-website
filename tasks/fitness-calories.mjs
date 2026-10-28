// @ts-check
/**
 * Calories for a /life activity (F5.5): the source platform's figure when the export
 * has one, FitGlue's estimate only when it does not — the same rule FitGlue applies
 * (pkg/calories). Strava's `total_calories` reaches the export as the sessions'
 * `totalCalories`; the calories booster used to store a MET estimate even then
 * (Birmingham's solo: 523 kcal against Strava's 1,346), so the page reads the
 * sessions first and stays right before the export is re-run.
 */

/** @param {unknown} v */
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** fitglue pkg/calories Foods, in the order they are tried. */
const FOODS = [
  ['slice of pizza', 285, '🍕'], ['donut', 250, '🍩'], ['banana', 105, '🍌'], ['beer', 150, '🍺'],
  ['chocolate bar', 230, '🍫'], ['cookie', 80, '🍪'], ['apple', 95, '🍎'], ['glass of wine', 125, '🍷'],
  ['burger', 540, '🍔'], ['ice cream scoop', 140, '🍨'],
];

/** "≈ 4.7 slice of pizza 🍕" (FitGlue's fun-mode text), "" for 50 kcal or less. @param {number} kcal */
export function foodComparison(kcal) {
  if (!(kcal > 50)) return '';
  const [name, per, emoji] = FOODS.find(([, c]) => kcal / Number(c) >= 0.5 && kcal / Number(c) <= 10) ?? FOODS[0];
  return `≈ ${(kcal / Number(per)).toFixed(1)} ${name} ${emoji}`;
}

/**
 * @param {any} activity  the export's `activity`
 * @param {any} [entry]   its index entry
 * @returns {{ kcal: number, source: 'platform'|'estimate'|'', note: string }}
 */
export function calorieFigure(activity, entry = {}) {
  const sessions = Array.isArray(activity?.activityData?.sessions) ? activity.activityData.sessions : [];
  const platform = sessions.reduce((s, x) => s + num(x?.totalCalories), 0);
  const stored = activity?.enrichments?.calories;
  if (platform > 0) {
    const kcal = Math.round(platform);
    // Keep the food comparison only where fun mode had one, recomputed for this figure.
    const note = stored?.comparisonText ? foodComparison(kcal) : '';
    return { kcal, source: 'platform', note };
  }
  const kcal = Math.round(num(stored?.kcal) || num(entry?.caloriesKcal));
  return { kcal, source: kcal > 0 ? 'estimate' : '', note: kcal > 0 ? String(stored?.comparisonText ?? '') : '' };
}
