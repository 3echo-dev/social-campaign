/**
 * The environment every Python child of this plugin runs with.
 *
 * On Windows a Python whose stdout is a pipe writes in the console code page (cp1252), so one emoji in a
 * caption raises UnicodeEncodeError and the reader that printed it reports "something other than JSON"
 * (found live on 2026-10-13 with the Scrapling reader and a Duolingo caption). PYTHONUTF8=1 makes Python use
 * UTF-8 for its streams and files, and PYTHONIOENCODING=utf-8 covers an interpreter that ignores the first.
 * The Python workers under python/ also reconfigure their own stdout, so a worker started some other way
 * (by hand, or by a host that rewrites the environment) still prints valid JSON.
 */

/** The two variables, as a plain object. */
export const PYTHON_UTF8_ENV = Object.freeze({ PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' });

/**
 * A child environment that makes Python speak UTF-8, on top of `base` (this process's environment by default).
 * Safe for any program, not only Python: the variables are ignored elsewhere.
 * @param {NodeJS.ProcessEnv|undefined|null} [base]
 * @returns {NodeJS.ProcessEnv}
 */
export function pythonChildEnv(base) {
  return { ...(base ?? process.env), ...PYTHON_UTF8_ENV };
}
