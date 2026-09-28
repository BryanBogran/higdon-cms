import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * ⚠️ NO RAW DATE BOX MAY SAVE AS IT CHANGES.
 *
 * A browser date input reports each keystroke of a year as a finished date
 * (0002, 0020, 0202, 2026). Wired straight to a save, the half-typed years
 * reached the database: rejected where a range check existed, stored where
 * one did not. components/sections/DateInput.jsx holds the value until the
 * year is complete.
 *
 * Raw `type="date"` is allowed only where nothing saves until a button is
 * pressed. Adding a new one anywhere else fails here, which is the point:
 * the original bug was five separate boxes each making the same mistake.
 */
const ALLOWED = new Map([
  ['components/sections/DateInput.jsx', 'is the guarded box itself'],
  ['components/tasks/AddTaskDialog.jsx', 'saves only on Create'],
  ['components/contacts/ContactEditor.jsx', 'saves only on Save'],
]);

// fileURLToPath, not .pathname: this folder's name has a space in it, and
// .pathname leaves it as %20 (the same trap next.config.mjs records).
const root = fileURLToPath(new URL('../../', import.meta.url));

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(jsx?|tsx?)$/.test(name)) yield p;
  }
}

test('every date box that saves as it changes is the guarded one', () => {
  const offenders = [];
  for (const dir of ['components', 'app']) {
    for (const file of walk(join(root, dir))) {
      const rel = file.slice(root.length);
      if (ALLOWED.has(rel)) continue;
      const src = readFileSync(file, 'utf8').replace(/\{\/\*[\s\S]*?\*\/\}|\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      if (/type=["']date["']/.test(src)) offenders.push(rel);
    }
  }
  assert.deepEqual(offenders, [], 'use components/sections/DateInput.jsx instead of a raw date input');
});
