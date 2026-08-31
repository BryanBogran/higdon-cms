import test from 'node:test';
import assert from 'node:assert/strict';
import {
  diagnoseDelegation, NEEDED_SCOPE, CANDIDATE_SCOPES,
} from './delegation-diagnosis.js';

/*
 * The advice these verdicts produce is the whole point of the tool, and the
 * interesting branch cannot be reached by running the script -- it needs real
 * credentials against a real Workspace domain. So the decision is tested here
 * and the script only renders it.
 */

test('a key that cannot get a token for itself is not a delegation problem', () => {
  const d = diagnoseDelegation({ asSelfOk: false, impersonate: 'files@example.com' });
  assert.equal(d.verdict, 'key-broken');
  // The point of saying so: unauthorized_client sends people to the Admin
  // console, and here nothing they do there can help.
  assert.equal(d.adminConsoleWillHelp, false);
});

test('the key being broken outranks everything else that was measured', () => {
  const d = diagnoseDelegation({
    asSelfOk: false, impersonate: 'files@example.com', asUserOk: true, granted: CANDIDATE_SCOPES,
  });
  assert.equal(d.verdict, 'key-broken');
});

test('with no user to impersonate, delegation is simply untested', () => {
  const d = diagnoseDelegation({ asSelfOk: true });
  assert.equal(d.verdict, 'not-tested');
  assert.equal(d.ok, true);
});

test('a token as the user is the pass', () => {
  const d = diagnoseDelegation({ asSelfOk: true, impersonate: 'files@example.com', asUserOk: true });
  assert.equal(d.verdict, 'ok');
  assert.equal(d.ok, true);
});

test('no scope granted means the entry is not reaching the account at all', () => {
  const d = diagnoseDelegation({
    asSelfOk: true, impersonate: 'files@example.com', asUserOk: false, granted: [],
  });
  assert.equal(d.verdict, 'no-scopes');
  // The distinction that saves the time: a wrong scope string would still
  // leave the other scopes working, so this is not a scope problem.
  assert.equal(d.scopeStringIsTheProblem, false);
  assert.equal(d.adminConsoleWillHelp, true);
});

test('some scopes granted but not the needed one is a stale entry', () => {
  const d = diagnoseDelegation({
    asSelfOk: true,
    impersonate: 'files@example.com',
    asUserOk: false,
    granted: ['https://www.googleapis.com/auth/drive.file'],
  });
  assert.equal(d.verdict, 'wrong-scopes');
  assert.equal(d.scopeStringIsTheProblem, true);
  assert.equal(d.needed, NEEDED_SCOPE);
  assert.deepEqual(d.granted, ['https://www.googleapis.com/auth/drive.file']);
});

test('the needed scope is the full drive scope, not a narrower one', () => {
  // drive.file only ever covers files the app itself created, so it cannot see
  // folders the firm's staff made. Pinned because getting this wrong is silent
  // -- reads appear to work and the case folders are simply invisible.
  assert.equal(NEEDED_SCOPE, 'https://www.googleapis.com/auth/drive');
  assert.ok(CANDIDATE_SCOPES.includes(NEEDED_SCOPE));
  assert.ok(CANDIDATE_SCOPES.includes('https://www.googleapis.com/auth/drive.file'));
});

test('every verdict says whether the Admin console is where the fix is', () => {
  const cases = [
    { asSelfOk: false },
    { asSelfOk: true },
    { asSelfOk: true, impersonate: 'a@b.com', asUserOk: true },
    { asSelfOk: true, impersonate: 'a@b.com', granted: [] },
    { asSelfOk: true, impersonate: 'a@b.com', granted: [NEEDED_SCOPE + '.file'] },
  ];
  for (const c of cases) {
    const d = diagnoseDelegation(c);
    assert.equal(typeof d.adminConsoleWillHelp, 'boolean', JSON.stringify(c));
    assert.ok(d.headline.length > 0);
  }
});
