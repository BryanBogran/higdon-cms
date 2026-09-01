'use client';

/**
 * A small ring of the JavaScript errors the browser has already thrown.
 *
 * ── Why bother ────────────────────────────────────────────────────────────
 *
 * People write "it doesn't work", and that is not their failing — describing a
 * fault precisely is a skill, and they were trying to do their job. The single
 * most useful line in any bug report is the exception the browser threw thirty
 * seconds earlier, and nobody is going to open the console to find it.
 *
 * So it is captured passively and attached to whatever they do write.
 *
 * Bounded and in memory only. Nothing is sent anywhere until somebody
 * deliberately files a report — this is not telemetry, and a legal file is the
 * wrong place to start collecting it quietly.
 */

const MAX = 20;
const buffer = [];
let installed = false;

function push(text) {
  const line = String(text || '').slice(0, 500);
  if (!line) return;
  // Repeats are common -- a render loop throws the same error every frame --
  // and twenty copies of one message crowds out the nineteen others.
  if (buffer[buffer.length - 1] === line) return;
  buffer.push(line);
  if (buffer.length > MAX) buffer.shift();
}

export function installErrorCapture() {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  window.addEventListener('error', (e) => {
    const where = e?.filename ? ` (${String(e.filename).split('/').pop()}:${e.lineno})` : '';
    push(`${e?.message || 'Error'}${where}`);
  });

  // A rejected promise never reaches window.onerror, and most of this app's
  // failures are awaited fetches -- so without this the interesting half is
  // invisible.
  window.addEventListener('unhandledrejection', (e) => {
    const r = e?.reason;
    push(`Unhandled promise rejection: ${r?.message || String(r || '').slice(0, 200)}`);
  });
}

export function recentErrors() {
  return [...buffer];
}
