import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  THEME_KEY, PREFERENCES, isValidPreference, normalizePreference,
  resolveTheme, themeAttr, readCookie, readPreference, systemPrefersDark,
} from '@/lib/theme';

/* ------------------------------------------------------------------ *
 * Preference validation
 * ------------------------------------------------------------------ */

test('the three preferences are the only valid ones', () => {
  assert.deepEqual(PREFERENCES, ['light', 'dark', 'system']);
  for (const p of PREFERENCES) assert.equal(isValidPreference(p), true);
});

test('anything unrecognised normalises to system rather than throwing', () => {
  // These all really occur: null from an absent cookie, undefined from a
  // missing argument, '' from a cleared value, stale strings from an older
  // build, and anything at all from a hand-edited request header.
  for (const junk of [null, undefined, '', 'Dark', 'DARK', 'auto', 'os', 0, {}, []]) {
    assert.equal(normalizePreference(junk), 'system', `${JSON.stringify(junk)}`);
    assert.equal(isValidPreference(junk), false);
  }
});

/* ------------------------------------------------------------------ *
 * Resolution
 * ------------------------------------------------------------------ */

test('an explicit choice ignores the operating system entirely', () => {
  assert.equal(resolveTheme('light', true), 'light');
  assert.equal(resolveTheme('light', false), 'light');
  assert.equal(resolveTheme('dark', false), 'dark');
  assert.equal(resolveTheme('dark', true), 'dark');
});

test('system resolves both ways', () => {
  assert.equal(resolveTheme('system', true), 'dark');
  assert.equal(resolveTheme('system', false), 'light');
});

test('a corrupt stored preference follows the OS instead of forcing light', () => {
  // The failure mode this guards: someone on a dark Mac gets a hardcoded
  // white app because their cookie held garbage.
  assert.equal(resolveTheme('nonsense', true), 'dark');
  assert.equal(resolveTheme(null, true), 'dark');
  assert.equal(resolveTheme(undefined, false), 'light');
});

/* ------------------------------------------------------------------ *
 * The server-rendered attribute -- the heart of the design
 * ------------------------------------------------------------------ */

test('system renders NO data-theme attribute', () => {
  /*
   * The single most important assertion in this file. The server cannot know
   * the viewer's OS setting. If it guessed -- rendering data-theme="light" --
   * every "System" user would be pinned to light, which is the default, so the
   * feature would appear broken for everyone who never touched the toggle.
   * Omitting the attribute is what hands the decision to prefers-color-scheme.
   */
  assert.equal(themeAttr('system'), undefined);
  assert.equal(themeAttr(null), undefined);
  assert.equal(themeAttr('junk'), undefined);
});

test('an explicit choice renders that exact attribute value', () => {
  assert.equal(themeAttr('dark'), 'dark');
  assert.equal(themeAttr('light'), 'light');
});

/* ------------------------------------------------------------------ *
 * Cookie parsing
 * ------------------------------------------------------------------ */

test('the theme cookie is found among others, in any position', () => {
  assert.equal(readCookie(`${THEME_KEY}=dark`), 'dark');
  assert.equal(readCookie(`a=1; ${THEME_KEY}=light; b=2`), 'light');
  assert.equal(readCookie(`sb-access-token=xyz; ${THEME_KEY}=dark`), 'dark');
  assert.equal(readCookie('a=1; b=2'), null);
  assert.equal(readCookie(''), null);
  assert.equal(readCookie(null), null);
});

test('a cookie whose name merely contains the key is not mistaken for it', () => {
  // `not-hl-theme` and `hl-theme-old` must not match, or a stale cookie from
  // some future rename would quietly drive the theme.
  assert.equal(readCookie(`not-${THEME_KEY}=dark`), null);
  assert.equal(readCookie(`${THEME_KEY}-old=dark`), null);
  assert.equal(readCookie(`${THEME_KEY}-old=dark; ${THEME_KEY}=light`), 'light');
});

/* ------------------------------------------------------------------ *
 * The CSS contract
 * ------------------------------------------------------------------ */

test('both dark branches in globals.css remap exactly the same tokens', () => {
  /*
   * The dark palette is written once as --dk-* variables, but TWO selectors
   * remap --color-* onto it: [data-theme="dark"] for an explicit choice, and
   * the prefers-color-scheme block for "System". Nothing in CSS keeps those
   * two lists in step, and a token missing from one of them would render
   * correctly for people who pressed the button and wrongly for everyone on
   * the default -- the harder of the two to notice.
   */
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');

  const attrBlock = css.match(/:root\[data-theme="dark"\] \{([\s\S]*?)\n\}/);
  const mediaBlock = css.match(/@media \(prefers-color-scheme: dark\) \{[\s\S]*?\{([\s\S]*?)\n  \}/);
  assert.ok(attrBlock, 'explicit [data-theme="dark"] block should exist');
  assert.ok(mediaBlock, 'prefers-color-scheme block should exist');

  const remapped = (s) => (s.match(/--color-([a-z0-9-]+):\s*var\(--dk-\1\)/g) || []).sort();
  const a = remapped(attrBlock[1]);
  const m = remapped(mediaBlock[1]);

  assert.ok(a.length > 40, `expected the full palette, got ${a.length}`);
  assert.deepEqual(a, m, 'the two dark branches have drifted apart');
});

test('every --dk- value is actually used by both branches', () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  const defined = [...css.matchAll(/--dk-([a-z0-9-]+):\s*#/g)].map((m) => m[1]);
  const used = new Set([...css.matchAll(/var\(--dk-([a-z0-9-]+)\)/g)].map((m) => m[1]));
  assert.ok(defined.length > 40);
  const orphans = defined.filter((n) => !used.has(n));
  assert.deepEqual(orphans, [], 'dark values defined but never remapped');
});

test('no stale .dark class selector survives anywhere in the CSS', () => {
  // The class-based approach was abandoned because React owns <html>.className
  // and strips it. A leftover `.dark` rule would look like it works and would
  // never fire.
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /^\s*\.dark[\s,{]/m);
});

/* ------------------------------------------------------------------ *
 * Server safety -- these run with no document at all
 * ------------------------------------------------------------------ */

test('the browser helpers are inert on the server', () => {
  assert.equal(typeof document, 'undefined', 'precondition: node has no document');
  assert.equal(readPreference(), 'system');
  assert.equal(systemPrefersDark(), false);
});
