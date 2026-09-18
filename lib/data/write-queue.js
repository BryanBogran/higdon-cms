/**
 * Coalesce a burst of edits into one write.
 *
 * ── Why ──────────────────────────────────────────────────────────────────
 *
 * FieldInput calls onChange on every keystroke, so typing "Dr Ruiz" was seven
 * database writes. That is three separate problems:
 *
 *   SPEED      every character is a network round trip
 *   CORRECTNESS seven writes racing each other is seven chances to interleave
 *   COST       with live sync each write broadcasts to every connected
 *              screen, so one character typed is about ten realtime messages
 *
 * The edit still lands in local state on every keystroke -- the input must
 * never lag behind the person typing. Only the WRITE waits.
 *
 * ── Two properties worth stating ─────────────────────────────────────────
 *
 * COALESCED. Patches to the same record merge, so seven keystrokes become one
 * write carrying the final value.
 *
 * ORDERED. Commits for one key are chained, never run in parallel. Without
 * that, a slow earlier write can land after a faster later one and the record
 * ends up holding the older value -- a lost update reintroduced by the very
 * thing meant to reduce them.
 *
 * ── The trap this must not fall into ─────────────────────────────────────
 *
 * ⚠️ A debounce is a way to lose data if the page goes away before the timer
 * fires. Two things stop that here:
 *
 *   The queue lives in DataProvider, which is mounted in the layout and
 *   SURVIVES client-side navigation. Moving between cases does not cancel a
 *   pending write; the timer fires wherever you have navigated to.
 *
 *   `flush()` runs everything immediately, and DataProvider calls it when the
 *   page is hidden or unloaded -- the only moments the timer would not get to
 *   fire on its own.
 *
 * Timers are injectable so the tests can drive them, rather than sleeping and
 * hoping.
 */

/** Long enough to swallow a burst of typing, short enough to feel immediate. */
export const DEFAULT_WRITE_DELAY_MS = 400;

export function createWriteQueue({
  delay = DEFAULT_WRITE_DELAY_MS,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  /** key -> { patch, commit, timer } — edits waiting for the timer. */
  const pending = new Map();
  /** key -> Promise — the commit currently running, so the next one queues behind it. */
  const chains = new Map();

  function fire(key) {
    const entry = pending.get(key);
    if (!entry) return chains.get(key) || Promise.resolve();
    pending.delete(key);
    clearTimer(entry.timer);

    const previous = chains.get(key) || Promise.resolve();
    // .catch here is not swallowing the error -- `commit` is responsible for
    // reporting it (in the app that is `run`, which sets the save state). This
    // only stops one failed write from breaking the chain for the next.
    const next = previous.then(() => entry.commit(entry.patch)).catch(() => {});
    chains.set(key, next);
    next.then(() => {
      if (chains.get(key) === next) chains.delete(key);
    });
    return next;
  }

  return {
    /**
     * Record an edit. Merges with anything already waiting for this key and
     * restarts the timer, so a write happens `delay` after typing STOPS rather
     * than `delay` after it started.
     */
    enqueue(key, patch, commit) {
      const entry = pending.get(key);
      if (entry) {
        clearTimer(entry.timer);
        entry.patch = { ...entry.patch, ...patch };
        // The newest commit wins: it closes over the freshest ids and state.
        entry.commit = commit;
        entry.timer = setTimer(() => fire(key), delay);
        return;
      }
      pending.set(key, {
        patch: { ...patch },
        commit,
        timer: setTimer(() => fire(key), delay),
      });
    },

    /** Write now. One key, or everything waiting. */
    flush(key) {
      if (key !== undefined) return fire(key);
      return Promise.all([...pending.keys()].map((k) => fire(k)));
    },

    /** Resolves once every commit already started has finished. For tests. */
    settled() {
      return Promise.all([...chains.values()]);
    },

    /** How many records are waiting. For tests and diagnostics. */
    size() {
      return pending.size;
    },
  };
}
