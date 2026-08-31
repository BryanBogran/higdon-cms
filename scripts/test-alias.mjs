/**
 * Let `node --test` resolve the imports the app actually writes.
 *
 * Next resolves two things Node does not: the `@/` alias from jsconfig.json,
 * and extensionless specifiers like `./url`. Every module under lib/data uses
 * both, which is the whole reason that layer had no tests -- supabase-store.js
 * is 635 lines and the test runner could not even import it.
 *
 * Registered from the `test` script with --import.
 */

import { register } from 'node:module';

register('./test-alias-hooks.mjs', import.meta.url);
