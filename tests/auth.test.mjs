import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startStack, client, totpNow, BASE } from './helpers.mjs';

const EMAIL = 'test@example.com';
const PASSWORD = 'correct horse battery';
let stack;
let secret;            // TOTP secret from registration
let recovery = [];     // recovery codes from MFA setup

before(async () => { stack = await startStack(); });
after(async () => { if (process.env.NB_DEBUG) console.log(stack.log().slice(-3000)); await stack?.stop(); });
const freeTotpStep = () => stack.sql('UPDATE nb_users SET totp_last_step = 0');

test('registration is closed for addresses that are not allow-listed', async () => {
  const c = client('10.1.0.1');
  const r = await c.post('/api/auth/register', { email: 'stranger@example.com', password: PASSWORD });
  assert.equal(r.status, 403);
});

test('registration rejects short passwords and bad emails', async () => {
  const c = client('10.1.0.2');
  assert.equal((await c.post('/api/auth/register', { email: EMAIL, password: 'short' })).status, 400);
  assert.equal((await c.post('/api/auth/register', { email: 'nope', password: PASSWORD })).status, 400);
});

test('register returns QR URI and manual secret; session is not issued yet', async () => {
  const c = client('10.1.0.3');
  const r = await c.post('/api/auth/register', { email: EMAIL, password: PASSWORD });
  assert.equal(r.status, 201);
  assert.match(r.json.totp_uri, /^otpauth:\/\/totp\/nullboard:/);
  assert.match(r.json.totp_secret, /^[A-Z2-7]{32}$/);
  assert.equal(c.cookie, '');
  secret = r.json.totp_secret;
  assert.ok(r.json.totp_uri.includes(`secret=${secret}`));
  c.setup = r.json.setup_token;
  globalThis.__setup = r.json.setup_token;
});

test('duplicate registration is refused', async () => {
  const r = await client('10.1.0.4').post('/api/auth/register', { email: EMAIL, password: PASSWORD });
  assert.equal(r.status, 409);
});

test('MFA setup rejects a wrong code and accepts the right one, issuing recovery codes', async () => {
  const c = client('10.1.0.5');
  const bad = await c.post('/api/auth/mfa/setup', { setup_token: globalThis.__setup, code: '000000' });
  assert.equal(bad.status, 401);
  const good = await c.post('/api/auth/mfa/setup', { setup_token: globalThis.__setup, code: await totpNow(secret) });
  assert.equal(good.status, 200);
  assert.equal(good.json.recovery_codes.length, 10);
  assert.match(good.json.recovery_codes[0], /^[A-Z2-7]{5}-[A-Z2-7]{5}$/);
  recovery = good.json.recovery_codes;
  assert.match(good.headers.get('set-cookie'), /HttpOnly/);
  assert.match(good.headers.get('set-cookie'), /SameSite=Strict/);
  const me = await c.get('/api/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.json.user.email, EMAIL);
  assert.equal(me.json.recovery_remaining, 10);
  // setup token is single use
  const again = await client('10.1.0.5').post('/api/auth/mfa/setup', { setup_token: globalThis.__setup, code: await totpNow(secret, 1) });
  assert.equal(again.status, 401);
});

test('API needs a session', async () => {
  assert.equal((await client('10.1.0.6').get('/api/auth/me')).status, 401);
  assert.equal((await client('10.1.0.6').post('/api/sync', { since: 0, changes: [] })).status, 401);
});

test('login: wrong password and unknown email look the same', async () => {
  const a = await client('10.2.0.1').post('/api/auth/login', { email: EMAIL, password: 'wrong password!!' });
  const b = await client('10.2.0.2').post('/api/auth/login', { email: 'ghost@example.com', password: 'wrong password!!' });
  assert.equal(a.status, 401);
  assert.equal(b.status, 401);
  assert.deepEqual(a.json, b.json);
});

test('login then TOTP MFA gives a session; replaying the same code is refused', async () => {
  await freeTotpStep();
  const c = client('10.2.0.3');
  const l = await c.post('/api/auth/login', { email: EMAIL, password: PASSWORD });
  assert.equal(l.status, 200);
  assert.equal(l.json.needs_mfa, true);
  assert.equal(c.cookie, '');
  const code = await totpNow(secret);
  const v = await c.post('/api/auth/mfa/verify', { pending_token: l.json.pending_token, code });
  assert.equal(v.status, 200);
  assert.equal((await c.get('/api/auth/me')).status, 200);
  // a second device presenting the same (already spent) code must fail
  const c2 = client('10.2.0.4');
  const l2 = await c2.post('/api/auth/login', { email: EMAIL, password: PASSWORD });
  const replay = await c2.post('/api/auth/mfa/verify', { pending_token: l2.json.pending_token, code });
  assert.equal(replay.status, 401);
});

test('the MFA step cannot be skipped: a pending token is not a session', async () => {
  const c = client('10.2.0.5');
  const l = await c.post('/api/auth/login', { email: EMAIL, password: PASSWORD });
  c.cookie = `nb_session=${l.json.pending_token}`;
  assert.equal((await c.get('/api/auth/me')).status, 401);
});

test('recovery code signs in once, then is spent', async () => {
  const c = client('10.2.0.6');
  const l = await c.post('/api/auth/login', { email: EMAIL, password: PASSWORD });
  const v = await c.post('/api/auth/mfa/verify', { pending_token: l.json.pending_token, recovery_code: recovery[0].toLowerCase() });
  assert.equal(v.status, 200);
  assert.equal(v.json.used_recovery_code, true);
  assert.equal(v.json.recovery_remaining, 9);
  const c2 = client('10.2.0.7');
  const l2 = await c2.post('/api/auth/login', { email: EMAIL, password: PASSWORD });
  const reuse = await c2.post('/api/auth/mfa/verify', { pending_token: l2.json.pending_token, recovery_code: recovery[0] });
  assert.equal(reuse.status, 401);
});

test('lock-out: repeated bad passwords block even the right password, same for unknown emails', async () => {
  const c = client('10.3.0.1');
  for (let i = 0; i < 5; i++) assert.equal((await c.post('/api/auth/login', { email: 'lock@example.com', password: 'nope nope nope' })).status, 401);
  assert.equal((await c.post('/api/auth/login', { email: 'lock@example.com', password: 'nope nope nope' })).status, 429);

  const d = client('10.3.0.2');
  for (let i = 0; i < 5; i++) await d.post('/api/auth/login', { email: EMAIL, password: 'bad bad bad bad' });
  const blocked = await d.post('/api/auth/login', { email: EMAIL, password: PASSWORD });
  assert.equal(blocked.status, 429);
  // clean up so later tests can sign in
  await stack.sql("DELETE FROM nb_auth_attempts WHERE bucket LIKE 'loginfail:%'");
});

test('lock-out: repeated bad MFA codes lock the account at the MFA step', async () => {
  await stack.sql("DELETE FROM nb_auth_attempts WHERE bucket LIKE 'mfa:user:%'");
  const c = client('10.3.0.3');
  const l = await c.post('/api/auth/login', { email: EMAIL, password: PASSWORD });
  for (let i = 0; i < 5; i++) assert.equal((await c.post('/api/auth/mfa/verify', { pending_token: l.json.pending_token, code: '111111' })).status, 401);
  const blocked = await c.post('/api/auth/mfa/verify', { pending_token: l.json.pending_token, code: await totpNow(secret, 1) });
  assert.equal(blocked.status, 429);
  await stack.sql("DELETE FROM nb_auth_attempts WHERE bucket LIKE 'mfa:user:%'");
});

test('per-IP rate limit on login', async () => {
  const c = client('10.3.0.9');
  let last;
  for (let i = 0; i < 31; i++) last = await c.post('/api/auth/login', { email: `x${i}@example.com`, password: 'whatever whatever' });
  assert.equal(last.status, 429);
});

test('cross-site POST is refused', async () => {
  const r = await client('10.4.0.1').post('/api/auth/login', { email: EMAIL, password: PASSWORD }, { Origin: 'https://evil.example' });
  assert.equal(r.status, 403);
});

test('non-JSON bodies are refused', async () => {
  const res = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'text/plain', 'CF-Connecting-IP': '10.4.0.2' }, body: 'email=a' });
  assert.equal(res.status, 400);
});

async function signIn(ip) {
  await freeTotpStep();
  const c = client(ip);
  const l = await c.post('/api/auth/login', { email: EMAIL, password: PASSWORD });
  const v = await c.post('/api/auth/mfa/verify', { pending_token: l.json.pending_token, code: await totpNow(secret) });
  assert.equal(v.status, 200, JSON.stringify(v.json));
  return c;
}

test('password reset: generic reply, emailed one-time link, sessions revoked, no auto sign-in', async () => {
  const before = await signIn('10.5.0.1');
  const unknown = await client('10.5.0.2').post('/api/auth/reset-request', { email: 'ghost@example.com' });
  const known = await client('10.5.0.3').post('/api/auth/reset-request', { email: EMAIL });
  assert.equal(unknown.status, 200);
  assert.deepEqual(unknown.json, known.json);
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(stack.mails.length, 1);
  const mail = stack.mails[0];
  assert.deepEqual(mail.to, [EMAIL]);
  const token = /\/\?reset=([\w-]+)/.exec(mail.html)[1];

  const weak = await client('10.5.0.4').post('/api/auth/reset-confirm', { token, password: 'short' });
  assert.equal(weak.status, 400);
  const bad = await client('10.5.0.4').post('/api/auth/reset-confirm', { token: 'not-a-token', password: 'a brand new password' });
  assert.equal(bad.status, 400);

  const c = client('10.5.0.5');
  const done = await c.post('/api/auth/reset-confirm', { token, password: 'a brand new password' });
  assert.equal(done.status, 200);
  assert.equal(c.cookie, '', 'reset must not sign anyone in (MFA still applies)');
  const reuse = await client('10.5.0.6').post('/api/auth/reset-confirm', { token, password: 'another new password' });
  assert.equal(reuse.status, 400);

  assert.equal((await before.get('/api/auth/me')).status, 401, 'old sessions die on reset');
  const oldPw = await client('10.5.0.7').post('/api/auth/login', { email: EMAIL, password: PASSWORD });
  assert.equal(oldPw.status, 401);
  await freeTotpStep();
  const c3 = client('10.5.0.8');
  const l = await c3.post('/api/auth/login', { email: EMAIL, password: 'a brand new password' });
  assert.equal(l.status, 200);
  const v = await c3.post('/api/auth/mfa/verify', { pending_token: l.json.pending_token, code: await totpNow(secret) });
  assert.equal(v.status, 200);
});

test('expired reset tokens are refused', async () => {
  await client('10.5.1.1').post('/api/auth/reset-request', { email: EMAIL });
  await new Promise((r) => setTimeout(r, 500));
  const mail = stack.mails[stack.mails.length - 1];
  const token = /\/\?reset=([\w-]+)/.exec(mail.html)[1];
  await stack.sql('UPDATE nb_reset_tokens SET expires_at = 1');
  const r = await client('10.5.1.2').post('/api/auth/reset-confirm', { token, password: 'yet another password' });
  assert.equal(r.status, 400);
});

test('reset requests are rate limited per address', async () => {
  const outcomes = [];
  for (let i = 0; i < 4; i++) outcomes.push((await client(`10.5.2.${i}`).post('/api/auth/reset-request', { email: EMAIL })).status);
  assert.ok(outcomes.every((s) => s === 200), 'per-address limit answers generically, never reveals itself');
  const n = stack.mails.length;
  await new Promise((r) => setTimeout(r, 500));
  assert.ok(stack.mails.length - n <= 3);
});

test('a deleted user is signed out on the next call', async () => {
  await stack.sql("DELETE FROM nb_auth_attempts");
  await freeTotpStep();
  const c = client('10.6.0.1');
  const l = await c.post('/api/auth/login', { email: EMAIL, password: 'a brand new password' });
  const v = await c.post('/api/auth/mfa/verify', { pending_token: l.json.pending_token, code: await totpNow(secret) });
  assert.equal(v.status, 200, JSON.stringify(v.json));
  assert.equal((await c.get('/api/auth/me')).status, 200);
  await stack.sql("DELETE FROM nb_users WHERE email = 'test@example.com'");
  assert.equal((await c.get('/api/auth/me')).status, 401);
  assert.equal((await c.post('/api/sync', { since: 0, changes: [] })).status, 401);
});

test('revalidated pages keep the script hash in the CSP (no 304 without it)', async () => {
  const first = await fetch(BASE + '/');
  const again = await fetch(BASE + '/', { headers: { 'If-None-Match': first.headers.get('etag') || '' } });
  assert.equal(again.status, 200);
  assert.match(again.headers.get('content-security-policy'), /sha256-/);
});

test('security headers on pages and API', async () => {
  const page = await fetch(BASE + '/');
  const csp = page.headers.get('content-security-policy');
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /default-src 'self'/);
  assert.doesNotMatch(csp, /unsafe-inline/);
  assert.match(page.headers.get('strict-transport-security'), /max-age=\d+/);
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  const api = await fetch(BASE + '/api/auth/me');
  assert.equal(api.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(api.headers.get('cache-control'), 'no-store');
});
