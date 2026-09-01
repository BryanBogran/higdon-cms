/**
 * Higdon CMS — inbound email poller
 *
 * Paste this into script.google.com as the mailbox that receives case mail —
 * `files@higdonlawyers.com` is fine and needs no new licence — set the
 * Script Properties below, then run installTrigger once.
 *
 * WHAT IT DOES
 * Reads unread mail in this mailbox, POSTs each message to the case system in
 * its original form, and labels it. The system reads `Delivered-To` to work
 * out which matter the message belongs to, which is how a BCC'd case address
 * still files correctly.
 *
 * WHY A SCRIPT RATHER THAN AN MX RECORD
 * The firm's DNS is on Wix and its live mail is on Google Workspace. An MX
 * record put on the wrong host stops every client and carrier email until
 * somebody notices. This route touches no DNS.
 *
 * ⚠️ IT LEAVES EVERYTHING ELSE ALONE
 * If this mailbox also receives ordinary mail — which `files@` does — the
 * script must not touch it. Only messages actually addressed to a case are
 * read, POSTed or labelled; anything else is left exactly as it was found,
 * unread and unlabelled. Getting this wrong would silently mark a colleague's
 * mail as read, which is worse than not filing anything.
 *
 * ── Script Properties (Project Settings → Script Properties) ─────────────
 *   CMS_WEBHOOK   https://<your-app>.vercel.app/api/inbound-email
 *   CMS_SECRET    the same value as INBOUND_EMAIL_SECRET in Vercel
 *   CMS_PREFIX    the tagged address prefix, e.g. `files+`  — MUST match
 *                 NEXT_PUBLIC_INTAKE_MAIL_USER in Vercel, plus a "+"
 *   CMS_POLL_MINUTES  optional. 1, 5, 10, 15 or 30. Defaults to 1.
 */

var LABEL_FILED = 'CMS/Filed';
var LABEL_FAILED = 'CMS/Failed';

// Gmail allows ~25 MB of attachments; the app refuses more than it can store.
// Skipped rather than truncated: half a message is not evidence.
var MAX_BYTES = 25 * 1024 * 1024;

// Well under the 6-minute execution limit even on slow messages. Whatever is
// left stays unread and goes on the next run.
var MAX_PER_RUN = 40;

function pollInbox() {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('CMS_WEBHOOK');
  var secret = props.getProperty('CMS_SECRET');
  var prefix = (props.getProperty('CMS_PREFIX') || '').toLowerCase();
  if (!url || !secret || !prefix) {
    throw new Error('Set CMS_WEBHOOK, CMS_SECRET and CMS_PREFIX in Project Settings → Script Properties.');
  }

  var filed = getOrCreateLabel(LABEL_FILED);
  var failed = getOrCreateLabel(LABEL_FAILED);

  // -label: so a message that already failed is not retried forever on every
  // run. It stays unread and visible, and a person decides.
  var threads = GmailApp.search('is:unread -label:' + LABEL_FAILED, 0, MAX_PER_RUN);
  var sent = 0;
  var skipped = 0;
  var ignored = 0;

  for (var t = 0; t < threads.length; t++) {
    var messages = threads[t].getMessages();
    for (var m = 0; m < messages.length; m++) {
      var msg = messages[m];
      if (!msg.isUnread()) continue;

      var raw;
      try {
        raw = msg.getRawContent();
      } catch (e) {
        threads[t].addLabel(failed);
        skipped++;
        continue;
      }

      /*
       * NOT ADDRESSED TO A CASE -> LEAVE IT COMPLETELY ALONE.
       *
       * The check that makes it safe to run this on a mailbox that also gets
       * ordinary mail. Not marked read, not labelled, not POSTed. The server
       * would answer `filed: 0` and the script would then mark it read, which
       * would quietly hide a colleague's mail from them.
       *
       * Checked against the RAW message rather than the To header, so a BCC'd
       * case address counts: Gmail writes it into Delivered-To, which is in
       * the raw text even though it is in no visible recipient field.
       */
      if (raw.toLowerCase().indexOf(prefix) === -1) {
        ignored++;
        continue;
      }

      if (raw.length > MAX_BYTES) {
        threads[t].addLabel(failed);
        skipped++;
        continue;
      }

      var res;
      try {
        res = UrlFetchApp.fetch(url, {
          method: 'post',
          contentType: 'message/rfc822',
          payload: raw,
          headers: { 'x-inbound-secret': secret },
          muteHttpExceptions: true,
        });
      } catch (e) {
        // Network failure. Leave it UNREAD and unlabelled so the next run
        // picks it up — a transient error must not lose a client's email.
        continue;
      }

      var code = res.getResponseCode();
      if (code >= 200 && code < 300) {
        /*
         * Marked read only on a 2xx. The app returns 200 with `filed: 0` for a
         * message addressed to no case, which is correct: it arrived, it was
         * considered, it belongs nowhere. Marking it read stops it being
         * reconsidered every five minutes forever.
         */
        msg.markRead();
        threads[t].addLabel(filed);
        sent++;
      } else if (code >= 400 && code < 500) {
        // A 4xx will not fix itself — bad secret, message too large. Flag it
        // for a person rather than hammering the endpoint.
        threads[t].addLabel(failed);
        skipped++;
      }
      // 5xx: leave untouched. The next run retries.
    }
  }

  console.log('filed ' + sent + ', flagged ' + skipped + ', not case mail ' + ignored);
}

function getOrCreateLabel(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}

/**
 * Run ONCE by hand, from the editor, to install the timer.
 * Re-running is safe: the old trigger is removed first, so this is also how
 * you CHANGE the interval — set CMS_POLL_MINUTES and run it again.
 *
 * ── Why one minute is the default ─────────────────────────────────────
 *
 * Apps Script accepts only 1, 5, 10, 15 or 30 — not arbitrary values — and
 * one minute is both the fastest available and comfortably within quota.
 * A Workspace account allows 6 hours of trigger runtime a day; 1,440 runs
 * of a couple of seconds each is well under an hour, and a run with no case
 * mail in it does almost nothing.
 *
 * The validation matters more than it looks. Passing 2 or 60 throws
 * "Invalid argument", which does not say that the value must come from a
 * fixed set — so the failure reads like a bug in the script rather than a
 * typo in a setting.
 */
var ALLOWED_MINUTES = [1, 5, 10, 15, 30];

function installTrigger() {
  var raw = PropertiesService.getScriptProperties().getProperty('CMS_POLL_MINUTES');
  var minutes = raw ? Number(raw) : 1;
  if (ALLOWED_MINUTES.indexOf(minutes) === -1) {
    throw new Error(
      'CMS_POLL_MINUTES must be one of ' + ALLOWED_MINUTES.join(', ') +
      ' — Apps Script does not accept other intervals. Got: ' + raw);
  }

  var existing = ScriptApp.getProjectTriggers();
  for (var i = 0; i < existing.length; i++) {
    if (existing[i].getHandlerFunction() === 'pollInbox') ScriptApp.deleteTrigger(existing[i]);
  }
  ScriptApp.newTrigger('pollInbox').timeBased().everyMinutes(minutes).create();
  console.log('Trigger installed — pollInbox runs every ' + minutes + ' minute(s).');
}

/**
 * Run by hand to check the webhook and secret before installing the trigger.
 * Sends nothing; expects 401 on a bad secret and 200 on a good one.
 */
function testConnection() {
  var props = PropertiesService.getScriptProperties();
  var res = UrlFetchApp.fetch(props.getProperty('CMS_WEBHOOK'), {
    method: 'post',
    contentType: 'message/rfc822',
    payload: 'From: test@example.com\r\nTo: nobody@example.com\r\nSubject: connection test\r\n\r\nhello',
    headers: { 'x-inbound-secret': props.getProperty('CMS_SECRET') },
    muteHttpExceptions: true,
  });
  console.log(res.getResponseCode() + ' ' + res.getContentText());
  console.log('200 with "filed: 0" is CORRECT — the test message names no case.');
  console.log('A 401 means CMS_SECRET does not match INBOUND_EMAIL_SECRET in Vercel.');
}
