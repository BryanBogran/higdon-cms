/**
 * What `unauthorized_client` actually means, given what the token endpoint
 * said to each question.
 *
 * Pure, so the advice can be tested. The branch that matters most -- key works,
 * delegation does not -- only happens with real credentials against a real
 * Workspace domain, so running the script cannot reach it. Wrong advice there
 * costs an hour in the Admin console, which is exactly the hour this tool
 * exists to save.
 *
 * The inputs come from asking Google for a token several times:
 *
 *   asSelfOk    a token with no `sub`. The service account as itself. Proves
 *               the key, the client email and the clock.
 *   asUserOk    a token with `sub`. The part the Admin console authorises.
 *   granted     of the candidate scopes, the ones accepted individually. An
 *               entry that grants SOME scopes but not the needed one is a
 *               different problem from an entry that grants none.
 */

export const NEEDED_SCOPE = 'https://www.googleapis.com/auth/drive';

export const CANDIDATE_SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
];

export function diagnoseDelegation({
  asSelfOk,
  impersonate = '',
  asUserOk = false,
  granted = [],
} = {}) {
  if (!asSelfOk) {
    return {
      verdict: 'key-broken',
      ok: false,
      // The most useful thing this tool says. Someone staring at
      // `unauthorized_client` will go to the Admin console by default, and in
      // this case no amount of editing it will change anything.
      headline: 'The key itself is not working, so this is not a delegation problem.',
      adminConsoleWillHelp: false,
    };
  }

  if (!impersonate) {
    return {
      verdict: 'not-tested',
      ok: true,
      headline: 'The key works. Pass a user address to test delegation.',
      adminConsoleWillHelp: false,
    };
  }

  if (asUserOk) {
    return {
      verdict: 'ok',
      ok: true,
      headline: 'Delegation is authorised.',
      adminConsoleWillHelp: false,
    };
  }

  if (granted.length === 0) {
    return {
      verdict: 'no-scopes',
      ok: false,
      // A wrong scope string would still leave the OTHER scopes working, so
      // nothing being granted means the entry is not reaching this account at
      // all -- wrong client id, wrong domain, or not propagated.
      headline: 'No scope was granted, so the entry is not reaching this service account.',
      adminConsoleWillHelp: true,
      scopeStringIsTheProblem: false,
    };
  }

  return {
    verdict: 'wrong-scopes',
    ok: false,
    headline: 'The entry exists and reaches the service account, but grants the wrong scopes.',
    adminConsoleWillHelp: true,
    scopeStringIsTheProblem: true,
    granted,
    needed: NEEDED_SCOPE,
  };
}
