/**
 * The help desk: list tickets, read one, reply, change status, mark seen.
 *
 * Filing a NEW request stays at /api/report, which already stores first and
 * emails second. This is everything that happens afterwards.
 *
 * ── Who may do what is enforced by the database, not here ────────────────
 *
 * Every query runs as the signed-in user, so the policies in
 * supabase/022_help_tickets.sql are the enforcement: anyone may read and
 * reply, only the admin may change a status. The route checks
 * `is_help_admin()` first only so a refusal arrives as a sentence rather
 * than a Postgres error -- if this check were deleted, the database would
 * still say no.
 *
 * ── Store first, email second ─────────────────────────────────────────────
 *
 * Exactly as /api/report does it. The reply is saved before any email is
 * attempted, and the response says whether the email also went out, so a
 * failed notification is visible rather than a reply nobody hears about.
 */

import { NextResponse } from 'next/server';
import {
  getSupabaseServerClient, getCurrentUser, isServerSupabaseConfigured,
} from '@/lib/supabase/server';
import { sendMail, isGmailConfigured } from '@/lib/google/gmail';
import {
  isStatus, isUnseen, validateReply, ticketLink, replyRecipient,
  replySubject, replyEmailBody, resolvedSubject, resolvedEmailBody,
} from '@/lib/domain/help';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TICKET_COLUMNS =
  'id, summary, detail, severity, page, user_agent, viewport, console_errors, status, '
  + 'reported_by, reporter_label, created_at, resolved_at, emailed_at, last_activity_at, last_activity_by';

function toTicket(row) {
  return {
    id: row.id,
    summary: row.summary,
    detail: row.detail || '',
    severity: row.severity,
    page: row.page || '',
    userAgent: row.user_agent || '',
    viewport: row.viewport || '',
    consoleErrors: row.console_errors || [],
    status: row.status || 'open',
    reportedBy: row.reported_by,
    reporterLabel: row.reporter_label || 'unknown',
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    emailedAt: row.emailed_at,
    lastActivityAt: row.last_activity_at,
    lastActivityBy: row.last_activity_by,
  };
}

function toReply(row) {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    body: row.body || '',
    authorId: row.author_id,
    authorLabel: row.author_label || 'unknown',
    createdAt: row.created_at,
  };
}

/** The 42P01 case: a migration nobody ran, said as such. */
function dbError(error) {
  const missing = error?.code === '42P01' || error?.code === '42703' || /schema cache/i.test(error?.message || '');
  return NextResponse.json(
    { error: missing ? 'Help tickets are not set up yet — run supabase/022_help_tickets.sql.' : error.message },
    { status: 500 },
  );
}

async function context() {
  if (!isServerSupabaseConfigured()) {
    return { fail: NextResponse.json({ error: 'The database is not configured.' }, { status: 503 }) };
  }
  const user = await getCurrentUser();
  if (!user) return { fail: NextResponse.json({ error: 'Sign in required.' }, { status: 401 }) };

  const db = await getSupabaseServerClient();
  const [{ data: isAdmin }, { data: profile }] = await Promise.all([
    db.rpc('is_help_admin'),
    db.from('profile').select('display_name, email').eq('id', user.id).maybeSingle(),
  ]);

  return {
    db,
    user,
    isAdmin: Boolean(isAdmin),
    label: profile?.display_name || user.email?.split('@')[0] || 'unknown',
  };
}

/* ------------------------------------------------------------------ *
 * GET — the list, or one ticket with its thread
 * ------------------------------------------------------------------ */

export async function GET(request) {
  const ctx = await context();
  if (ctx.fail) return ctx.fail;
  const { db, user, isAdmin } = ctx;

  const id = request.nextUrl.searchParams.get('id');

  if (id) {
    const [{ data: row, error }, { data: replies, error: replyError }] = await Promise.all([
      db.from('bug_report').select(TICKET_COLUMNS).eq('id', id).maybeSingle(),
      db.from('bug_report_reply').select('*').eq('report_id', id).order('created_at'),
    ]);
    if (error) return dbError(error);
    if (replyError) return dbError(replyError);
    if (!row) return NextResponse.json({ error: 'That request does not exist.' }, { status: 404 });

    return NextResponse.json({
      ok: true, isAdmin, userId: user.id,
      ticket: toTicket(row), replies: (replies || []).map(toReply),
    });
  }

  // A few hundred is years of requests at this firm's size. Newest activity
  // first, so what just changed is at the top.
  const [{ data: rows, error }, { data: seen, error: seenError }] = await Promise.all([
    db.from('bug_report').select(TICKET_COLUMNS).order('last_activity_at', { ascending: false }).limit(300),
    db.from('bug_report_seen').select('report_id, seen_at').eq('user_id', user.id),
  ]);
  if (error) return dbError(error);
  if (seenError) return dbError(seenError);

  const seenAt = Object.fromEntries((seen || []).map((s) => [s.report_id, s.seen_at]));
  const tickets = (rows || []).map((r) => {
    const t = toTicket(r);
    return { ...t, unseen: isUnseen(t, { userId: user.id, isAdmin, seenAt: seenAt[t.id] }) };
  });

  return NextResponse.json({
    ok: true, isAdmin, userId: user.id,
    tickets,
    unseen: tickets.filter((t) => t.unseen).length,
  });
}

/* ------------------------------------------------------------------ *
 * POST — reply, status, seen
 * ------------------------------------------------------------------ */

export async function POST(request) {
  const ctx = await context();
  if (ctx.fail) return ctx.fail;
  const { db, user, isAdmin, label } = ctx;

  const body = await request.json().catch(() => null);
  if (!body?.id || !body?.action) {
    return NextResponse.json({ error: 'action and id are required.' }, { status: 400 });
  }

  const { data: row, error } = await db.from('bug_report').select(TICKET_COLUMNS).eq('id', body.id).maybeSingle();
  if (error) return dbError(error);
  if (!row) return NextResponse.json({ error: 'That request does not exist.' }, { status: 404 });
  const ticket = toTicket(row);
  const link = ticketLink(new URL(request.url).origin, ticket.id);

  if (body.action === 'seen') return markSeen(db, user.id, ticket.id);
  if (body.action === 'reply') return reply({ db, user, isAdmin, label, ticket, link, text: body.body });
  if (body.action === 'status') return setStatus({ db, user, isAdmin, label, ticket, link, status: body.status });

  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
}

async function markSeen(db, userId, reportId) {
  const { error } = await db
    .from('bug_report_seen')
    .upsert({ report_id: reportId, user_id: userId, seen_at: new Date().toISOString() },
      { onConflict: 'report_id,user_id' });
  if (error) return dbError(error);
  return NextResponse.json({ ok: true });
}

async function reply({ db, user, isAdmin, label, ticket, link, text }) {
  const checked = validateReply(text);
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });

  /* -------- 1. store -------- */
  const { data: saved, error } = await db
    .from('bug_report_reply')
    .insert({ report_id: ticket.id, author_id: user.id, author_label: label, kind: 'reply', body: checked.body })
    .select('*')
    .single();
  if (error) return dbError(error);

  // Writing it means having read it.
  await db.from('bug_report_seen').upsert(
    { report_id: ticket.id, user_id: user.id, seen_at: new Date().toISOString() },
    { onConflict: 'report_id,user_id' },
  );

  /* -------- 2. tell the other side -------- */
  const to = replyRecipient({ authorIsAdmin: isAdmin, authorId: user.id, reporterId: ticket.reportedBy });
  const mail = await notify(db, {
    to,
    reporterId: ticket.reportedBy,
    subject: replySubject(ticket),
    text: replyEmailBody(ticket, toReply(saved), { link }),
  });

  return NextResponse.json({ ok: true, reply: toReply(saved), ...mail });
}

async function setStatus({ db, user, isAdmin, label, ticket, link, status }) {
  // The database refuses this for non-admins regardless. Checked here so the
  // refusal is a sentence.
  if (!isAdmin) {
    return NextResponse.json({ error: 'Only the administrator can change a request’s status.' }, { status: 403 });
  }
  if (!isStatus(status)) return NextResponse.json({ error: 'Unknown status.' }, { status: 400 });
  if (status === ticket.status) return NextResponse.json({ ok: true, unchanged: true });

  const now = new Date().toISOString();
  const { error } = await db
    .from('bug_report')
    .update({
      status,
      resolved_at: status === 'resolved' ? now : null,
      last_activity_at: now,
      last_activity_by: user.id,
    })
    .eq('id', ticket.id);
  if (error) return dbError(error);

  // Into the thread, so the ticket reads as a timeline.
  const { error: rowError } = await db.from('bug_report_reply').insert({
    report_id: ticket.id, author_id: user.id, author_label: label, kind: 'status', status,
  });
  if (rowError) return dbError(rowError);

  /*
   * Only Resolved is emailed. In progress and Waiting show in the app; a
   * reporter emailed at every step stops reading any of them. Waiting is
   * nearly always paired with a reply, and the reply sends its own email.
   */
  let mail = { emailed: false, emailError: '' };
  if (status === 'resolved' && ticket.reportedBy !== user.id) {
    mail = await notify(db, {
      to: 'reporter',
      reporterId: ticket.reportedBy,
      subject: resolvedSubject(ticket),
      text: resolvedEmailBody(ticket, { link, by: label }),
    });
  }

  return NextResponse.json({ ok: true, status, ...mail });
}

/**
 * Send one notification, best effort. Never throws; says what happened.
 *
 * `to` is 'admin' (BUG_REPORT_TO) or 'reporter' (their profile email).
 */
async function notify(db, { to, reporterId, subject, text }) {
  if (!to) return { emailed: false, emailError: '' };
  if (!isGmailConfigured()) return { emailed: false, emailError: 'Google sending is not configured.' };

  let address = '';
  let replyTo;
  if (to === 'admin') {
    address = process.env.BUG_REPORT_TO || '';
    if (!address) return { emailed: false, emailError: 'BUG_REPORT_TO is not set.' };
  } else {
    const { data: prof } = await db.from('profile').select('email').eq('id', reporterId).maybeSingle();
    address = prof?.email || '';
    if (!address) return { emailed: false, emailError: 'The reporter has no email address on their profile.' };
    /*
     * ⚠️ A reply-to, so an email reply reaches the admin rather than files@.
     * Without it, a reporter answering by email would land in the mailbox
     * docs/scripts/gmail-intake.gs polls, and be filed as case mail.
     */
    replyTo = process.env.BUG_REPORT_TO || undefined;
  }

  const sent = await sendMail({ to: address, subject, text, replyTo });
  return { emailed: sent.ok, emailError: sent.ok ? '' : sent.error };
}
