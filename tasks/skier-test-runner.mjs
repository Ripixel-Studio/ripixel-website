// @ts-check
/**
 * Test helper: run Skier tasks in order the way the skier CLI does — `${var}`
 * config references resolved against the globals (Skier's own resolver), each
 * task's result merged into the globals — but with a quiet, capturing logger.
 */
import { resolveConfigVars } from 'skier/dist/cli/resolveConfigVars.js';

/**
 * @param {any[]} tasks
 * @param {Record<string, unknown>} globals  mutated, as in a real build
 * @param {string[]} [logs]  warnings and errors land here
 */
export async function runSkierTasks(tasks, globals, logs = []) {
  const logger = {
    info() {},
    debug() {},
    warn: (/** @type {string} */ m) => logs.push(m),
    error: (/** @type {string} */ m) => logs.push(`ERROR ${m}`),
  };
  for (const task of tasks) {
    const config = resolveConfigVars(task.config, globals, /** @type {any} */ (logger));
    const result = await task.run(config, { logger, debug: false, globals });
    if (result && typeof result === 'object') Object.assign(globals, result);
  }
  return globals;
}
