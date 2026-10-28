// @ts-check
/**
 * The athlete's own words out of an activity description (contract §3.1).
 *
 * A description is assembled from blocks separated by blank lines: what the source app
 * wrote (ROXFIT's "Completed via ROXFIT" header, its division/rank lines and split
 * table), what he typed (FitGlue's user_input), and FitGlue's enricher sections
 * ("✨ AI Summary:", "❤️ Heart Rate:", "🏁 Hyrox - Men's Open:" …). Only his paragraphs
 * are kept. The old rule — keep everything before the first emoji-led "x: y" line — cut
 * at ROXFIT's "🏆 Division:" and left "Completed via ROXFIT" as the quote.
 */

/**
 * A value that reads like machine output: starts with a number ("05:48/km", "#270",
 * "1min 33s", "18 reps", "20kg × 10") and carries no real words, or is N/A.
 * @param {string} v
 */
function isMachineValue(v) {
  const t = v.trim();
  if (/^(n\/a|-|—)$/i.test(t)) return true;
  return /^[#+−-]?\d/.test(t) && t.length <= 32 && !/[a-z]{6,}/i.test(t.replace(/\(.*\)/g, ''));
}

/** @param {string} line */
function startsWithSymbol(line) {
  const cp = line.codePointAt(0);
  return cp !== undefined && cp > 0xff;
}

/**
 * Is this line machine-written? Emoji-led section headers or "label: value" lines, a
 * plain "Label: 05:48/km" stat line, a bullet, "Completed via …", "Posted via FitGlue".
 * @param {string} raw
 */
export function isMachineLine(raw) {
  const line = raw.trim();
  if (!line) return false;
  if (/^(completed|posted|uploaded|synced|recorded|logged|tracked) (via|with|by|on) \S+/i.test(line)) return true;
  // FitGlue's bullets are "•"; his own lists use "*" or "-" and stay.
  if (/^[•·]\s/.test(line)) return true;
  if (startsWithSymbol(line) && (line.endsWith(':') || line.includes(' • ') || /^\S+\s+[^:]{1,40}:\s*\S/.test(line))) return true;
  // A plain section header: "Workout Summary:", "Official Results:" (Title Case, ≤ 3 words).
  if (/^(?:[A-Z][\w'&()-]*\s?){1,3}:$/.test(line)) return true;
  const kv = line.match(/^([A-Za-z][A-Za-z0-9 ()'/&-]{0,40}):\s*(.+)$/);
  if (kv && isMachineValue(kv[2])) return true;
  return false;
}

/**
 * His paragraphs, in order, joined by blank lines. A paragraph is his when its first line
 * is not machine-written and most of its lines are not. Scanning stops at the first
 * machine paragraph after his words have started (the enricher sections follow them).
 * @param {string|undefined|null} text
 */
export function athleteWords(text) {
  if (!text) return '';
  const cleaned = String(text).replace(/\r\n?/g, '\n').replace(/\n?\n?Posted via FitGlue\s*💪/g, '').trim();
  if (!cleaned) return '';
  const paragraphs = cleaned.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const kept = [];
  for (const para of paragraphs) {
    const lines = para.split('\n').filter((l) => l.trim());
    const machine = lines.filter(isMachineLine).length;
    const isHis = !isMachineLine(lines[0]) && machine * 2 < lines.length;
    if (isHis) {
      kept.push(lines.filter((l) => !isMachineLine(l)).join('\n'));
    } else if (kept.length) {
      break;
    }
  }
  return kept.join('\n\n').trim();
}
