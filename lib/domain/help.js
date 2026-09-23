/**
 * Help requests as tickets — statuses, the badge rule, and the emails.
 *
 * A report used to end the moment it was emailed. Now it has a status, a
 * thread, and a badge that lights when something you care about changes.
 *
 * Pure, so the rule that decides whose badge lights up can be tested without
 * a database: it is the part most likely to be quietly wrong, and a badge
 * that lights for the wrong people teaches everyone to ignore it.
 */

import { LIMITS } from './report.js';

/**
 * The statuses, in the order a ticket moves through them.
 *
 * One list that the migration's check constraint, the route, the panel and
 * the tests all agree on -- so a status cannot exist in one place and not
 * another. `tone` is a key the UI maps to colours; resolved is green because
 * that is what "done" looks like to everyone who has ever used a tracker.
 */
export const TICKET_STATUSES = [
  { key: 'open', label: 'Open', tone: 'slate', blurb: 'Received, not started yet.' },
  { key: 'in_progress', label: 'In progress', tone: 'amber', blurb: 'Being worked on.' },
  { key: 'waiting', label: 'Waiting on you', tone: 'violet', blurb: 'A question was asked — reply to move it on.' },
  { key: 'resolved', label: 'Resolved', tone: 'green', blurb: 'Fixed. Reply if it is still happening and it will reopen.' },
];

export const STATUS_BY_KEY = Object.fromEntries(TICKET_STATUSES.map((s) => [s.key, s]));

export function isStatus(key) {
  return Boolean(STATUS_BY_KEY[key]);
}

export function statusLabel(key) {
  return STATUS_BY_KEY[key]?.label || 'Open';
}

/* ------------------------------------------------------------------ *
 * Replies
 * ------------------------------------------------------------------ */

/** @returns {{ok: true, body: string} | {ok: false, error: string}} */
export function validateReply(input) {
  const body = String(input ?? '').trim().slice(0, LIMITS.detail);
  if (!body) return { ok: false, error: 'Write something to send.' };
  return { ok: true, body };
}

/* ------------------------------------------------------------------ *
 * The badge
 * ------------------------------------------------------------------ */

/**
 * Should this ticket light the badge for this person?
 *
 * Three rules, each there because the opposite is a real failure:
 *
 *   - ONLY ACTIVITY BY SOMEBODY ELSE. Your own reply must never light your
 *     own badge, or the badge is always on and means nothing.
 *   - ONLY AFTER YOU LAST LOOKED. Obviously; `seenAt` is your stamp.
 *   - ONLY TICKETS THAT ARE YOURS -- unless you are the admin. Everyone can
 *     see every ticket, but a paralegal's badge lighting up for somebody
 *     else's printer problem is noise, and noise is what gets ignored.
 *
 * ⚠️ For the admin, a RESOLVED ticket never lights the badge. The only way
 * new activity reaches a resolved ticket from the reporter is a reply, and
 * the database reopens the ticket when that happens (see 022's trigger) --
 * so anything genuinely needing attention is already back in the open pile.
 * Counting resolved ones would light the badge for every old ticket the day
 * this ships.
 *
 * @param {object} ticket  { reportedBy, status, lastActivityAt, lastActivityBy }
 * @param {object} viewer  { userId, isAdmin, seenAt }
 */
export function isUnseen(ticket, { userId, isAdmin = false, seenAt = null } = {}) {
  if (!ticket || !userId) return false;
  if (!ticket.lastActivityAt) return false;
  /*
   * No recorded actor means nobody has touched it since it was filed, so the
   * reporter was the last one there. Reading null as "somebody else" would
   * light a person's badge for the request they filed a second ago.
   */
  const by = ticket.lastActivityBy || ticket.reportedBy;
  if (by === userId) return false;

  const mine = ticket.reportedBy === userId;
  if (!mine && !isAdmin) return false;
  if (isAdmin && !mine && ticket.status === 'resolved') return false;

  if (!seenAt) return true;
  return new Date(ticket.lastActivityAt).getTime() > new Date(seenAt).getTime();
}

/* ------------------------------------------------------------------ *
 * Links and emails
 * ------------------------------------------------------------------ */

/** The link every email carries. Opens the help panel on that ticket. */
export function ticketLink(origin, id) {
  const base = String(origin || '').replace(/\/+$/, '');
  return `${base}/?help=${encodeURIComponent(id)}`;
}

/*
 * ⚠️ EVERY EMAIL SAYS "REPLY IN THE APP", AND MEANS IT.
 *
 * A reply sent by email lands in somebody's inbox and never appears on the
 * ticket -- so the thread is missing half the conversation, and the reporter
 * sees a status change with no explanation. The link is the way back in.
 */
const FOOTER = (link) => [
  '',
  '───────────────',
  `Open the request: ${link}`,
  'Please reply in the app, so the answer stays with the request.',
];

const clipSubject = (s) => s.slice(0, 200);

/** To the other side, when somebody replies. */
export function replySubject(ticket) {
  return clipSubject(`Reply on your help request: ${ticket.summary || 'help request'}`);
}

export function replyEmailBody(ticket, reply, { link }) {
  return [
    `${reply.authorLabel || 'Someone'} replied:`,
    '',
    reply.body,
    '',
    `Request: ${ticket.summary}`,
    `Status:  ${statusLabel(ticket.status)}`,
    ...FOOTER(link),
  ].join('\n');
}

/** To the reporter, when their request is marked resolved. */
export function resolvedSubject(ticket) {
  return clipSubject(`Resolved: ${ticket.summary || 'your help request'}`);
}

export function resolvedEmailBody(ticket, { link, by = '' } = {}) {
  return [
    `Your help request has been marked resolved${by ? ` by ${by}` : ''}:`,
    '',
    `  ${ticket.summary}`,
    '',
    'If it is still happening, reply on the request and it will reopen.',
    ...FOOTER(link),
  ].join('\n');
}

/* ------------------------------------------------------------------ *
 * Who is emailed
 * ------------------------------------------------------------------ */

/**
 * Who hears about a reply.
 *
 * Nobody is emailed about their own action. A reply by anybody but the admin
 * goes to the admin; a reply by the admin goes to the reporter. Status
 * changes other than Resolved email nobody -- they show in the app, and a
 * reporter emailed for "in progress" and "waiting" and "resolved" stops
 * reading any of them.
 *
 * @returns {'admin' | 'reporter' | null}
 */
export function replyRecipient({ authorIsAdmin, authorId, reporterId }) {
  if (authorIsAdmin) return authorId === reporterId ? null : 'reporter';
  return 'admin';
}
