import test from 'node:test';
import assert from 'node:assert/strict';

/*
 * intakeDomain() and intakeUser() read process.env at call time, so the mode
 * is set per test rather than at import. That is deliberate in the module: the
 * shape is a deployment fact, and a build-time constant could not be switched
 * without a redeploy.
 */
const load = async (env = {}) => {
  const prev = {
    NEXT_PUBLIC_INTAKE_MAIL_DOMAIN: process.env.NEXT_PUBLIC_INTAKE_MAIL_DOMAIN,
    NEXT_PUBLIC_INTAKE_MAIL_USER: process.env.NEXT_PUBLIC_INTAKE_MAIL_USER,
  };
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  const mod = await import('@/lib/domain/mailbox');
  return { mod, restore: () => Object.assign(process.env, prev) };
};

const PLUS = {
  NEXT_PUBLIC_INTAKE_MAIL_DOMAIN: 'higdonlawyers.com',
  NEXT_PUBLIC_INTAKE_MAIL_USER: 'cases',
};
const SUB = {
  NEXT_PUBLIC_INTAKE_MAIL_DOMAIN: 'case.higdonlawyers.com',
  NEXT_PUBLIC_INTAKE_MAIL_USER: undefined,
};

const SLUG = 'riveramarcus7f3a9c2e1b04';

/* ------------------------------------------------------------------ *
 * Plus-addressing — the shape this firm uses
 * ------------------------------------------------------------------ */

test('plus mode builds cases+slug@domain', async () => {
  const { mod, restore } = await load(PLUS);
  assert.equal(mod.intakeAddress({ intakeSlug: SLUG }), `cases+${SLUG}@higdonlawyers.com`);
  restore();
});

test('plus mode reads the slug back out', async () => {
  const { mod, restore } = await load(PLUS);
  assert.equal(mod.slugFromAddress(`cases+${SLUG}@higdonlawyers.com`), SLUG);
  assert.equal(mod.slugFromAddress(`CASES+${SLUG.toUpperCase()}@Higdonlawyers.COM`), SLUG);
  restore();
});

test('THE BARE MAILBOX BELONGS TO NO CASE', async () => {
  // Mail sent straight to cases@ is not addressed to a matter. Treating it as
  // one would file every stray message onto whichever case sorted first.
  const { mod, restore } = await load(PLUS);
  assert.equal(mod.slugFromAddress('cases@higdonlawyers.com'), '');
  assert.equal(mod.isIntakeAddress('cases@higdonlawyers.com'), false);
  restore();
});

test('a different mailbox on the same domain is not an intake address', async () => {
  const { mod, restore } = await load(PLUS);
  assert.equal(mod.slugFromAddress(`paul+${SLUG}@higdonlawyers.com`), '');
  assert.equal(mod.slugFromAddress(`info+${SLUG}@higdonlawyers.com`), '');
  restore();
});

test('Gmail ignores dots in the mailbox name, and so does this', async () => {
  // c.a.s.e.s@ is the same mailbox to Gmail. Rejecting it would file nothing
  // and give nobody a reason why.
  const { mod, restore } = await load(PLUS);
  assert.equal(mod.slugFromAddress(`c.a.s.e.s+${SLUG}@higdonlawyers.com`), SLUG);
  restore();
});

test('only the FIRST plus splits, so a mangled tag is refused not truncated', async () => {
  const { mod, restore } = await load(PLUS);
  assert.equal(mod.slugFromAddress(`cases+${SLUG}+extra@higdonlawyers.com`), `${SLUG}+extra`);
  restore();
});

test('the wrong domain never matches, however right the rest looks', async () => {
  const { mod, restore } = await load(PLUS);
  assert.equal(mod.slugFromAddress(`cases+${SLUG}@evil.example.com`), '');
  restore();
});

/* ------------------------------------------------------------------ *
 * Subdomain mode still works
 * ------------------------------------------------------------------ */

test('subdomain mode is unchanged', async () => {
  const { mod, restore } = await load(SUB);
  assert.equal(mod.intakeAddress({ intakeSlug: SLUG }), `${SLUG}@case.higdonlawyers.com`);
  assert.equal(mod.slugFromAddress(`${SLUG}@case.higdonlawyers.com`), SLUG);
  assert.equal(mod.slugFromAddress(`${SLUG}@higdonlawyers.com`), '', 'the bare domain is not ours');
  restore();
});

test('a matter with no slug has no address, in either mode', async () => {
  for (const env of [PLUS, SUB]) {
    const { mod, restore } = await load(env);
    assert.equal(mod.intakeAddress({}), '');
    assert.equal(mod.intakeAddress(null), '');
    restore();
  }
});

/* ------------------------------------------------------------------ *
 * Delivered-To — how a BCC survives
 * ------------------------------------------------------------------ */

test('DELIVERED-TO RECOVERS A BCC', async () => {
  /*
   * The reason this header is read at all. A raw RFC822 message carries no
   * envelope, and a BCC'd address is in no header by definition — but Gmail
   * writes Delivered-To with the address it actually delivered to, plus tag
   * and all. Without this, BCC fails silently on the polled route.
   */
  const { mod, restore } = await load(PLUS);
  const headers = { 'delivered-to': [`cases+${SLUG}@higdonlawyers.com`] };
  const envelopeTo = mod.deliveredToAddresses(headers);
  assert.deepEqual(mod.matchIntakeSlugs({ envelopeTo, to: [{ email: 'client@example.com' }] }), [SLUG]);
  restore();
});

test('Delivered-To is read in its other common spellings', async () => {
  const { mod, restore } = await load(PLUS);
  assert.deepEqual(
    mod.deliveredToAddresses({ 'x-original-to': 'cases+a@x.com', 'envelope-to': ['cases+b@x.com'] }),
    ['cases+a@x.com', 'cases+b@x.com'],
  );
  restore();
});

test('a Delivered-To with a display name is unwrapped', async () => {
  const { mod, restore } = await load(PLUS);
  assert.deepEqual(
    mod.deliveredToAddresses({ 'delivered-to': 'Cases Mailbox <cases+z@x.com>' }),
    ['cases+z@x.com'],
  );
  restore();
});

test('junk in Delivered-To yields nothing rather than a bad address', async () => {
  const { mod, restore } = await load(PLUS);
  assert.deepEqual(mod.deliveredToAddresses({}), []);
  assert.deepEqual(mod.deliveredToAddresses({ 'delivered-to': 'not an address' }), []);
  restore();
});

/* ------------------------------------------------------------------ *
 * Matching
 * ------------------------------------------------------------------ */

test('one message can file onto two matters', async () => {
  const { mod, restore } = await load(PLUS);
  const slugs = mod.matchIntakeSlugs({
    to: [{ email: `cases+${SLUG}@higdonlawyers.com` }],
    cc: [{ email: 'cases+other000000000000@higdonlawyers.com' }],
  });
  assert.deepEqual(slugs.sort(), [SLUG, 'other000000000000'].sort());
  restore();
});

test('the same address twice files once', async () => {
  const { mod, restore } = await load(PLUS);
  const a = `cases+${SLUG}@higdonlawyers.com`;
  assert.deepEqual(mod.matchIntakeSlugs({ envelopeTo: [a], to: [{ email: a }], cc: [a] }), [SLUG]);
  restore();
});

test('a message addressed to nobody we know yields no slugs', async () => {
  const { mod, restore } = await load(PLUS);
  assert.deepEqual(mod.matchIntakeSlugs({ to: [{ email: 'someone@example.com' }] }), []);
  assert.deepEqual(mod.matchIntakeSlugs({}), []);
  restore();
});
