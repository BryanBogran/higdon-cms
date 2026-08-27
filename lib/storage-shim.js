/*
 * THROWAWAY. DELETE IN PHASE 7.
 *
 * The prototype was a Claude.ai artifact and persists via `window.storage`, a
 * Claude-only key/value API that does not exist in a browser. This maps it onto
 * localStorage so the UI can run unchanged while the build is proven.
 *
 * Do NOT improve this. Do NOT add error handling. Do NOT let it become an
 * abstraction -- see docs/DECISIONS.md, "Do NOT build a storage-shaped adapter
 * and swap its implementation." Keeping the whole-collection interface would
 * make the full-blob write structural, and then every keystroke POSTs every
 * matter. Phase 4 replaces the CALL SITES with per-record intents; this file
 * dies with lib/data/local.ts in Phase 7.
 *
 * The second argument in the artifact API is a global/shared scope flag,
 * always false here. It is accepted and ignored.
 */
export function installStorageShim() {
  if (typeof window === "undefined" || window.storage) return;

  window.storage = {
    get: async (key) => ({ value: window.localStorage.getItem(key) }),
    set: async (key, value) => {
      window.localStorage.setItem(key, value);
    },
  };
}
