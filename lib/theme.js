/**
 * Light / dark / system.
 *
 * ── Why a cookie, and why no pre-paint script ─────────────────────────────
 *
 * The usual approach is localStorage plus a tiny inline script that runs before
 * first paint. That does not work here. Three placements were tried -- a bare
 * <script> in a literal <head>, one as the first child of <body>, and
 * next/script with strategy="beforeInteractive" -- and every one produced
 * "Encountered a script tag while rendering React component" followed by a
 * hydration failure in React 19. React then threw away the server HTML and
 * re-rendered the whole tree, losing the theme: /documents rendered light while
 * the stored preference said dark, silently.
 *
 * A cookie is readable on the SERVER, so app/layout.jsx can put `data-theme`
 * straight into the HTML. React renders the attribute itself, so server and
 * client agree, there is no mismatch to hydrate around, and there is no frame
 * where the wrong theme is painted.
 *
 * The default -- "System" -- needs neither cookie nor JavaScript. It falls to
 * the `prefers-color-scheme` branch in app/globals.css. So the common case
 * costs nothing at all.
 *
 * ── On localStorage ───────────────────────────────────────────────────────
 *
 * docs/ROADMAP.md wants `grep localStorage` to hit one data file. This module
 * uses a cookie instead, so that count is untouched -- a happy side effect of
 * needing the value on the server.
 */

/** Cookie name. Also the value the layout looks up. */
export const THEME_KEY = 'hl-theme';

/** The three states the user can choose between. `system` is the default. */
export const PREFERENCES = ['light', 'dark', 'system'];

/** A year. The preference is a display setting, not a session. */
const MAX_AGE = 60 * 60 * 24 * 365;

export function isValidPreference(value) {
  return PREFERENCES.includes(value);
}

/**
 * Anything unrecognised becomes `system`.
 *
 * Not strictness for its own sake: the value arrives from a cookie header,
 * which an older build, an extension, or a hand-edited request can leave in any
 * state. A bad value must not mean "no theme".
 */
export function normalizePreference(value) {
  return isValidPreference(value) ? value : 'system';
}

/**
 * @param {string} preference   'light' | 'dark' | 'system' (or junk)
 * @param {boolean} systemPrefersDark  what the OS reports
 * @returns {'light' | 'dark'}  what should actually render
 */
export function resolveTheme(preference, systemPrefersDark) {
  const pref = normalizePreference(preference);
  if (pref === 'light') return 'light';
  if (pref === 'dark') return 'dark';
  return systemPrefersDark ? 'dark' : 'light';
}

/**
 * What to put in `<html data-theme=...>`, given a stored preference.
 *
 * Returns `undefined` for `system` ON PURPOSE. The server cannot know the
 * viewer's OS setting, so it must not guess: omitting the attribute is what
 * hands the decision to the `prefers-color-scheme` branch in globals.css.
 * Rendering `data-theme="light"` here instead would pin every "System" user to
 * light and break the feature for exactly the people who never touched it.
 */
export function themeAttr(preference) {
  const pref = normalizePreference(preference);
  return pref === 'system' ? undefined : pref;
}

/* ------------------------------------------------------------------ *
 * Browser side. Everything below is a no-op on the server.
 * ------------------------------------------------------------------ */

const DARK_QUERY = '(prefers-color-scheme: dark)';
const listeners = new Set();

export function systemPrefersDark() {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia(DARK_QUERY).matches;
}

/** Pull one cookie out of a `document.cookie`-style string. Pure, so the
 *  parsing is testable without a browser. */
export function readCookie(source, name = THEME_KEY) {
  for (const part of String(source || '').split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export function readPreference() {
  if (typeof document === 'undefined') return 'system';
  return normalizePreference(readCookie(document.cookie));
}

/** Set the data-theme attribute the CSS keys off, for instant feedback. The
 *  cookie is what makes it stick across loads. */
export function applyTheme(preference) {
  if (typeof document === 'undefined') return;
  const attr = themeAttr(preference);
  if (attr) document.documentElement.setAttribute('data-theme', attr);
  else document.documentElement.removeAttribute('data-theme');
}

export function setPreference(value) {
  const pref = normalizePreference(value);
  if (typeof document !== 'undefined') {
    // SameSite=Lax so it survives ordinary navigation. Not HttpOnly -- the
    // toggle has to read it back, and a display preference is not a secret.
    document.cookie = `${THEME_KEY}=${pref}; path=/; max-age=${MAX_AGE}; SameSite=Lax`;
  }
  applyTheme(pref);
  for (const fn of listeners) fn();
  return pref;
}

/**
 * For useSyncExternalStore.
 *
 * Two things can change the answer: this tab (the listener set) and the OS
 * flipping to dark at sunset while the app is open. The OS case needs no
 * repaint -- the CSS media query handles it on its own -- but the toggle still
 * has to re-render so the right segment looks selected.
 */
export function subscribeToTheme(onChange) {
  listeners.add(onChange);

  const media = typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia(DARK_QUERY)
    : null;

  media?.addEventListener('change', onChange);

  return () => {
    listeners.delete(onChange);
    media?.removeEventListener('change', onChange);
  };
}
