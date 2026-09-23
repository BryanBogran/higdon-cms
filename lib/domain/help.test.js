import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  TICKET_STATUSES, STATUS_BY_KEY, isStatus, statusLabel, validateReply, isUnseen,
  ticketLink, replySubject, replyEmailBody, resolvedSubject, resolvedEmailBody, replyRecipient,
} from './help.js';

const ME = 'u-me';
const ADMIN = 'u-admin';
const OTHER = 'u-other';

const ticket = (over = {}) => ({
  id: 't1', summary: 'SOL not saving', reportedBy: ME, status: 'open',
  lastActivityAt: '2026-09-23T15:00:00Z', lastActivityBy: ADMIN, ...over,
});

/* ------------------------------------------------------------------ *
 * Statuses
 * ------------------------------------------------------------------ */

test('the four statuses, in the order a ticket moves through them', () => {
  assert.deepEqual(TICKET_STATUSES.map((s) => s.key), ['open', 'in_progress', 'waiting', 'resolved']);
});

test('resolved is green', () => {
  // The whole point of the request: done should look done at a glance.
  assert.equal(STATUS_BY_KEY.resolved.tone, 'green');
});

test('⚠️ the statuses match the database check constraint exactly', () => {
  /*
   * Two lists of the same four words drift, and the drift shows up as a
   * status the UI offers and the database refuses -- a save that fails with
   * a constraint error in front of the person trying to close a ticket.
   */
  const sql = readFileSync(new URL('../../supabase/022_help_tickets.sql', import.meta.url), 'utf8');
  const m = /add constraint bug_report_status\s+check \(status in \(([^)]+)\)\)/.exec(sql);
  assert.ok(m, 'the constraint should be findable');
  const inSql = m[1].split(',').map((s) => s.trim().replace(/'/g, ''));
  assert.deepEqual(inSql, TICKET_STATUSES.map((s) => s.key));
});

test('isStatus and statusLabel', () => {
  assert.equal(isStatus('waiting'), true);
  assert.equal(isStatus('closed'), false);
  assert.equal(statusLabel('in_progress'), 'In progress');
  assert.equal(statusLabel('nonsense'), 'Open');
});

/* ------------------------------------------------------------------ *
 * Replies
 * ------------------------------------------------------------------ */

test('a reply is trimmed, capped, and must say something', () => {
  assert.equal(validateReply('  thanks  ').body, 'thanks');
  assert.equal(validateReply('').ok, false);
  assert.equal(validateReply('   ').ok, false);
  assert.equal(validateReply(null).ok, false);
  assert.equal(validateReply('x'.repeat(9000)).body.length, 5000);
});

/* ------------------------------------------------------------------ *
 * ⚠️ The badge
 * ------------------------------------------------------------------ */

test('a reply to my ticket lights my badge', () => {
  assert.equal(isUnseen(ticket(), { userId: ME, seenAt: '2026-09-23T14:00:00Z' }), true);
});

test('⚠️ my own activity never lights my own badge', () => {
  // Otherwise the badge is always on and means nothing.
  assert.equal(isUnseen(ticket({ lastActivityBy: ME }), { userId: ME }), false);
});

test('once I have looked, it goes out', () => {
  assert.equal(isUnseen(ticket(), { userId: ME, seenAt: '2026-09-23T16:00:00Z' }), false);
});

test('never having looked counts as unseen', () => {
  assert.equal(isUnseen(ticket(), { userId: ME, seenAt: null }), true);
});

test('⚠️ somebody else\'s ticket does not light a staff badge', () => {
  // Everyone can SEE every ticket. A badge for other people's problems is
  // noise, and noise is what gets ignored.
  assert.equal(isUnseen(ticket({ reportedBy: OTHER, lastActivityBy: ADMIN }), { userId: ME }), false);
});

test('the admin\'s badge lights for any open ticket with news', () => {
  const t = ticket({ reportedBy: OTHER, lastActivityBy: OTHER });
  assert.equal(isUnseen(t, { userId: ADMIN, isAdmin: true }), true);
});

test('⚠️ a resolved ticket does not light the admin\'s badge', () => {
  // A reporter replying to it reopens it in the database, so anything that
  // needs attention is already open. Counting resolved ones would light the
  // badge for every old ticket on the day this ships.
  const t = ticket({ reportedBy: OTHER, lastActivityBy: OTHER, status: 'resolved' });
  assert.equal(isUnseen(t, { userId: ADMIN, isAdmin: true }), false);
});

test('a reporter DOES see their ticket being resolved', () => {
  // The whole request: "instead of waking up and the issue is resolved".
  const t = ticket({ status: 'resolved', lastActivityBy: ADMIN });
  assert.equal(isUnseen(t, { userId: ME }), true);
});

test('the admin\'s own ticket behaves like anybody else\'s', () => {
  const t = ticket({ reportedBy: ADMIN, lastActivityBy: OTHER, status: 'resolved' });
  assert.equal(isUnseen(t, { userId: ADMIN, isAdmin: true }), true);
});

test('nothing to go on means no badge, not a crash', () => {
  assert.equal(isUnseen(null, { userId: ME }), false);
  assert.equal(isUnseen(ticket(), {}), false);
  assert.equal(isUnseen(ticket({ lastActivityAt: null }), { userId: ME }), false);
});

/* ------------------------------------------------------------------ *
 * Who is emailed
 * ------------------------------------------------------------------ */

test('a reporter replying emails the admin', () => {
  assert.equal(replyRecipient({ authorIsAdmin: false, authorId: ME, reporterId: ME }), 'admin');
});

test('the admin replying emails the reporter', () => {
  assert.equal(replyRecipient({ authorIsAdmin: true, authorId: ADMIN, reporterId: ME }), 'reporter');
});

test('⚠️ nobody is emailed about their own action', () => {
  // The admin replying on their own ticket.
  assert.equal(replyRecipient({ authorIsAdmin: true, authorId: ADMIN, reporterId: ADMIN }), null);
});

test('a colleague chiming in emails the admin', () => {
  assert.equal(replyRecipient({ authorIsAdmin: false, authorId: OTHER, reporterId: ME }), 'admin');
});

/* ------------------------------------------------------------------ *
 * Emails
 * ------------------------------------------------------------------ */

test('the link opens the help panel on that ticket', () => {
  assert.equal(ticketLink('https://higdon-cms.vercel.app/', 't1'), 'https://higdon-cms.vercel.app/?help=t1');
});

test('⚠️ every email links back and asks for the reply in the app', () => {
  // An emailed reply never reaches the ticket, so the thread loses half the
  // conversation.
  const link = 'https://x.test/?help=t1';
  const bodies = [
    replyEmailBody(ticket(), { authorLabel: 'Bryan', body: 'Which case?' }, { link }),
    resolvedEmailBody(ticket(), { link, by: 'Bryan' }),
  ];
  for (const b of bodies) {
    assert.match(b, /Open the request: https:\/\/x\.test\/\?help=t1/);
    assert.match(b, /reply in the app/i);
  }
});

test('the reply email carries the reply and the status', () => {
  const b = replyEmailBody(ticket({ status: 'waiting' }), { authorLabel: 'Bryan', body: 'Which case?' }, { link: 'l' });
  assert.match(b, /Bryan replied/);
  assert.match(b, /Which case\?/);
  assert.match(b, /Waiting on you/);
});

test('the resolved email says how to reopen it', () => {
  assert.match(resolvedEmailBody(ticket(), { link: 'l' }), /reply on the request and it will reopen/i);
});

test('subjects name the request and stay under the cap', () => {
  assert.equal(replySubject(ticket()), 'Reply on your help request: SOL not saving');
  assert.equal(resolvedSubject(ticket()), 'Resolved: SOL not saving');
  assert.ok(replySubject(ticket({ summary: 'x'.repeat(400) })).length <= 200);
});

test('⚠️ a brand-new ticket does not light its own reporter\'s badge', () => {
  // Filed a second ago, no activity recorded yet: the reporter was last there.
  const t = ticket({ lastActivityBy: null });
  assert.equal(isUnseen(t, { userId: ME }), false);
  assert.equal(isUnseen({ ...t, reportedBy: OTHER }, { userId: ADMIN, isAdmin: true }), true,
    'but the admin should see it');
});
