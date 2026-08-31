/**
 * Resolve hooks for the test runner. See test-alias.mjs for why.
 *
 * Two rules, both matching what Next does:
 *
 *   `@/x`  ->  <repo root>/x
 *   `./x`  ->  ./x.js, ./x.jsx, or ./x/index.js, whichever exists
 *
 * Only `@/` is rewritten by hand. Everything else is handed to Node's own
 * resolver first and only retried with an extension if Node says it cannot
 * find it -- so bare package specifiers, including scoped ones like
 * `@supabase/ssr`, resolve normally and are never touched.
 */

import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');
const NOT_FOUND = new Set(['ERR_MODULE_NOT_FOUND', 'ERR_UNSUPPORTED_DIR_IMPORT']);
const EXTENSIONS = ['.js', '.jsx', '/index.js'];

export async function resolve(specifier, context, next) {
  const spec = specifier.startsWith('@/')
    ? pathToFileURL(path.join(ROOT, specifier.slice(2))).href
    : specifier;

  try {
    return await next(spec, context);
  } catch (err) {
    if (!NOT_FOUND.has(err?.code)) throw err;
    for (const ext of EXTENSIONS) {
      try {
        return await next(spec + ext, context);
      } catch {
        /* try the next extension */
      }
    }
    throw err;
  }
}
