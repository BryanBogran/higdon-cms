import test from 'node:test';
import assert from 'node:assert/strict';
import { createWriteQueue, DEFAULT_WRITE_DELAY_MS } from '@/lib/data/write-queue';

/**
 * A controllable clock. Real timers would make these tests slow and flaky,
 * and the thing being tested is precisely WHEN work happens.
 */
function fakeClock() {
  let now = 0;
  let seq = 0;
  const timers = new Map();
  return {
    setTimer: (fn, ms) => {
      const id = ++seq;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimer: (id) => timers.delete(id),
    /** Advance time, running anything that comes due. */
    async tick(ms) {
      now += ms;
      const due = [...timers.entries()].filter(([, t]) => t.at <= now);
      for (const [id, t] of due) {
        timers.delete(id);
        t.fn();
      }
      await Promise.resolve();
      await Promise.resolve();
    },
    pending: () => timers.size,
  };
}

test('seven keystrokes become one write', async () => {
  // THE POINT. Typing "Dr Ruiz" used to be seven writes, seven races and --
  // with live sync -- about seventy realtime messages.
  const clock = fakeClock();
  const q = createWriteQueue({ delay: 400, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  const writes = [];
  const commit = (patch) => { writes.push(patch); return Promise.resolve(); };

  for (const value of ['D', 'Dr', 'Dr ', 'Dr R', 'Dr Ru', 'Dr Rui', 'Dr Ruiz']) {
    q.enqueue('row:1', { provider: value }, commit);
    await clock.tick(50); // typing faster than the delay
  }
  assert.equal(writes.length, 0, 'nothing should be written while still typing');

  await clock.tick(400);
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0], { provider: 'Dr Ruiz' }, 'the final value must win');
});

test('the timer restarts on each keystroke, so it fires after typing STOPS', async () => {
  const clock = fakeClock();
  const q = createWriteQueue({ delay: 400, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  let writes = 0;
  const commit = () => { writes += 1; return Promise.resolve(); };

  // Half a second of typing, but never a 400ms gap.
  for (let i = 0; i < 5; i++) {
    q.enqueue('row:1', { v: i }, commit);
    await clock.tick(300);
  }
  assert.equal(writes, 0, 'a write happened mid-sentence');

  await clock.tick(400);
  assert.equal(writes, 1);
});

test('edits to different fields of one row merge into a single write', async () => {
  const clock = fakeClock();
  const q = createWriteQueue({ delay: 400, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  const writes = [];
  const commit = (p) => { writes.push(p); return Promise.resolve(); };

  q.enqueue('row:1', { type: 'Parking' }, commit);
  q.enqueue('row:1', { amount: '40' }, commit);
  await clock.tick(400);

  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0], { type: 'Parking', amount: '40' });
});

test('different records do not merge with each other', async () => {
  const clock = fakeClock();
  const q = createWriteQueue({ delay: 400, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  const writes = [];
  const commit = (p) => { writes.push(p); return Promise.resolve(); };

  q.enqueue('row:1', { a: 1 }, commit);
  q.enqueue('row:2', { b: 2 }, commit);
  await clock.tick(400);

  assert.equal(writes.length, 2);
  assert.deepEqual(writes.map((w) => Object.keys(w)[0]).sort(), ['a', 'b']);
});

test('a slow write cannot land after a faster later one', async () => {
  /*
   * ⚠️ THE REGRESSION THIS PREVENTS. If commits for one record ran in
   * parallel, a slow earlier write could resolve after a quick later one and
   * the record would keep the OLDER value -- a lost update reintroduced by
   * the very thing meant to reduce them.
   */
  const clock = fakeClock();
  const q = createWriteQueue({ delay: 10, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  const finished = [];
  let first = true;
  const commit = (patch) => {
    const slow = first;
    first = false;
    return new Promise((resolve) => {
      // The first write takes several turns; the second is immediate.
      const delayTurns = slow ? 5 : 0;
      let n = 0;
      const step = () => (n++ < delayTurns ? Promise.resolve().then(step) : resolve());
      step();
    }).then(() => finished.push(patch.v));
  };

  q.enqueue('row:1', { v: 'first' }, commit);
  await clock.tick(10);
  q.enqueue('row:1', { v: 'second' }, commit);
  await clock.tick(10);
  await q.settled();

  assert.deepEqual(finished, ['first', 'second'], 'writes landed out of order');
});

test('flush writes everything immediately', async () => {
  // What DataProvider calls when the page is hidden or unloaded -- the only
  // moments the timer would not get to fire on its own.
  const clock = fakeClock();
  const q = createWriteQueue({ delay: 10_000, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  const writes = [];
  const commit = (p) => { writes.push(p); return Promise.resolve(); };

  q.enqueue('row:1', { a: 1 }, commit);
  q.enqueue('row:2', { b: 2 }, commit);
  assert.equal(q.size(), 2);

  await q.flush();
  assert.equal(writes.length, 2, 'a pending edit was lost on flush');
  assert.equal(q.size(), 0);
});

test('flush can target one record', async () => {
  const clock = fakeClock();
  const q = createWriteQueue({ delay: 10_000, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  const writes = [];
  const commit = (p) => { writes.push(p); return Promise.resolve(); };

  q.enqueue('row:1', { a: 1 }, commit);
  q.enqueue('row:2', { b: 2 }, commit);
  await q.flush('row:1');

  assert.deepEqual(writes, [{ a: 1 }]);
  assert.equal(q.size(), 1);
});

test('a failed write does not stop the next one', async () => {
  // `commit` reports its own errors (in the app, via `run`). The queue only
  // has to make sure one failure does not wedge the chain.
  const clock = fakeClock();
  const q = createWriteQueue({ delay: 10, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  const done = [];
  const failing = () => Promise.reject(new Error('network'));
  const working = (p) => { done.push(p.v); return Promise.resolve(); };

  q.enqueue('row:1', { v: 1 }, failing);
  await clock.tick(10);
  q.enqueue('row:1', { v: 2 }, working);
  await clock.tick(10);
  await q.settled();

  assert.deepEqual(done, [2]);
});

test('flushing when nothing is waiting is harmless', async () => {
  const q = createWriteQueue();
  await q.flush();
  await q.flush('nothing');
  assert.equal(q.size(), 0);
});

test('the default delay is short enough to feel immediate', () => {
  // If this ever grows, the risk of losing an edit to a closed tab grows with
  // it -- and the flush on unload is a backstop, not a guarantee.
  assert.ok(DEFAULT_WRITE_DELAY_MS <= 600, `${DEFAULT_WRITE_DELAY_MS}ms is too long to sit unsaved`);
});
