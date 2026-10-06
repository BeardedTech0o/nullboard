// Authentication: register, login, TOTP MFA, recovery codes, password reset.
//
// Sessions are HS256 JWTs held in an HttpOnly, SameSite=Strict cookie, so page
// scripts never see them. Each token carries the user's session_version; a
// password reset or "sign out everywhere" bumps it and kills every old token.

import {
  hashPassword, verifyPassword, dummyVerify, signJWT, verifyJWT, generateTotpSecret,
  verifyTotp, encryptSecret, decryptSecret, generateRecoveryCode, normaliseRecoveryCode,
  hmacHex, sha256Hex, randomToken,
} from './crypto.js';
import { ok, fail, readJson, clientIp, sessionCookie, readCookie, cookieName } from './http.js';
import { sendResetEmail } from './email.js';

const SESSION_TTL = 14 * 86400;
const MFA_PENDING_TTL = 5 * 60;
const MFA_SETUP_TTL = 15 * 60;
const RESET_TTL_MS = 60 * 60 * 1000;
const WINDOW_MS = 15 * 60 * 1000;
const FAIL_LIMIT = 5;            // failed attempts per window before lock-out
const RECOVERY_CODE_COUNT = 10;
const MIN_PASSWORD = 10;
const MAX_PASSWORD = 128;

const nowSecs = () => Math.floor(Date.now() / 1000);

// ── Rate limiting and lock-out ──────────────────────────────────────────────
// Both use the same table. A bucket is a string such as "login:ip:1.2.3.4".

// Records a hit and reports whether the bucket is now over its cap.
async function hit(env, bucket, max, windowMs = WINDOW_MS) {
  const t = Date.now();
  await env.DB.prepare('DELETE FROM nb_auth_attempts WHERE bucket = ? AND created_at <= ?')
    .bind(bucket, t - windowMs).run();
  await env.DB.prepare('INSERT INTO nb_auth_attempts (bucket, created_at) VALUES (?, ?)')
    .bind(bucket, t).run();
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM nb_auth_attempts WHERE bucket = ?')
    .bind(bucket).first();
  return (row?.n || 0) > max;
}

async function count(env, bucket, windowMs = WINDOW_MS) {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM nb_auth_attempts WHERE bucket = ? AND created_at > ?')
    .bind(bucket, Date.now() - windowMs).first();
  return row?.n || 0;
}

const clearBucket = (env, bucket) =>
  env.DB.prepare('DELETE FROM nb_auth_attempts WHERE bucket = ?').bind(bucket).run();

const tooMany = () => fail('Too many attempts. Wait 15 minutes and try again.', 429);

// Failure buckets are keyed by an HMAC of the email so the lock-out behaves
// identically for addresses that do not exist (no account enumeration).
const emailBucket = async (env, prefix, email) => `${prefix}:email:${(await hmacHex(env.DATA_KEY, email)).slice(0, 32)}`;

// ── Tokens and sessions ─────────────────────────────────────────────────────

const issue = (env, claims, ttl) => signJWT({ ...claims, iat: nowSecs(), exp: nowSecs() + ttl }, env.JWT_SECRET);

async function startSession(req, env, user) {
  const token = await issue(env, { typ: 'session', sub: user.id, sv: user.session_version }, SESSION_TTL);
  return sessionCookie(req, token, SESSION_TTL);
}

export async function getSessionUser(req, env) {
  const token = readCookie(req, cookieName(req));
  if (!token) return null;
  const claims = await verifyJWT(token, env.JWT_SECRET);
  if (!claims || claims.typ !== 'session' || !claims.sub) return null;
  // Checked against the database on every call: a deleted user or a bumped
  // session_version invalidates the cookie immediately.
  const user = await env.DB.prepare('SELECT id, email, session_version, mfa_enabled FROM nb_users WHERE id = ?')
    .bind(claims.sub).first();
  if (!user || !user.mfa_enabled || user.session_version !== claims.sv) return null;
  return user;
}

function otpauthUri(email, secret) {
  return `otpauth://totp/nullboard:${encodeURIComponent(email)}?secret=${secret}&issuer=nullboard&algorithm=SHA1&digits=6&period=30`;
}

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
const normEmail = (e) => String(e || '').toLowerCase().trim();

function allowedToRegister(env, email) {
  const list = String(env.ALLOWED_EMAILS || '').split(',').map(normEmail).filter(Boolean);
  return list.includes(email);
}

function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length < MIN_PASSWORD) return `Password must be at least ${MIN_PASSWORD} characters.`;
  if (pw.length > MAX_PASSWORD) return `Password must be at most ${MAX_PASSWORD} characters.`;
  return null;
}

// ── Register ────────────────────────────────────────────────────────────────

export async function register(req, env) {
  if (await hit(env, `register:ip:${clientIp(req)}`, 5, 60 * 60 * 1000)) return tooMany();
  const body = await readJson(req);
  if (!body) return fail('Invalid request');
  const email = normEmail(body.email);
  if (!EMAIL_RE.test(email)) return fail('Enter a valid email address.');
  const problem = passwordProblem(body.password);
  if (problem) return fail(problem);
  // Closed by default: only listed addresses may create an account.
  if (!allowedToRegister(env, email)) return fail('Registration is not open for this address.', 403);

  const existing = await env.DB.prepare('SELECT id FROM nb_users WHERE email = ?').bind(email).first();
  if (existing) return fail('Could not create the account. Try signing in instead.', 409);

  const id = crypto.randomUUID();
  const secret = generateTotpSecret();
  await env.DB.prepare(
    'INSERT INTO nb_users (id, email, password_hash, totp_secret_enc, mfa_enabled, created_at) VALUES (?, ?, ?, ?, 0, ?)')
    .bind(id, email, await hashPassword(body.password), await encryptSecret(secret, env.DATA_KEY), Date.now()).run();

  const setupToken = await issue(env, { typ: 'mfa_setup', sub: id }, MFA_SETUP_TTL);
  return ok({ setup_token: setupToken, totp_uri: otpauthUri(email, secret), totp_secret: secret }, 201);
}

// ── MFA setup ───────────────────────────────────────────────────────────────

async function makeRecoveryCodes(env, userId) {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, generateRecoveryCode);
  const stmts = [env.DB.prepare('DELETE FROM nb_recovery_codes WHERE user_id = ?').bind(userId)];
  for (const code of codes) {
    const hash = await hmacHex(env.DATA_KEY, `recovery:${normaliseRecoveryCode(code)}`);
    stmts.push(env.DB.prepare(
      'INSERT INTO nb_recovery_codes (id, user_id, code_hash, created_at) VALUES (?, ?, ?, ?)')
      .bind(crypto.randomUUID(), userId, hash, Date.now()));
  }
  await env.DB.batch(stmts);
  return codes;
}

export async function mfaSetup(req, env) {
  if (await hit(env, `mfa:ip:${clientIp(req)}`, 20)) return tooMany();
  const body = await readJson(req);
  if (!body || !body.setup_token || !body.code) return fail('Invalid request');
  const claims = await verifyJWT(body.setup_token, env.JWT_SECRET);
  if (!claims || claims.typ !== 'mfa_setup') return fail('This setup link has expired. Sign in again to continue.', 401);

  const failBucket = `mfa:user:${claims.sub}`;
  if ((await count(env, failBucket)) >= FAIL_LIMIT) return tooMany();

  const user = await env.DB.prepare('SELECT id, email, totp_secret_enc, mfa_enabled, totp_last_step, session_version FROM nb_users WHERE id = ?')
    .bind(claims.sub).first();
  if (!user || user.mfa_enabled) return fail('This setup link is no longer valid.', 401);

  const secret = await decryptSecret(user.totp_secret_enc, env.DATA_KEY);
  const step = await verifyTotp(secret, body.code, user.totp_last_step);
  if (!step) {
    await hit(env, failBucket, FAIL_LIMIT);
    return fail('That code did not match. Check your device clock and try again.', 401);
  }
  await env.DB.prepare('UPDATE nb_users SET mfa_enabled = 1, totp_last_step = ? WHERE id = ?').bind(step, user.id).run();
  await clearBucket(env, failBucket);
  const codes = await makeRecoveryCodes(env, user.id);
  return ok({ user: { id: user.id, email: user.email }, recovery_codes: codes }, 200,
    { 'Set-Cookie': await startSession(req, env, user) });
}

// ── Login ───────────────────────────────────────────────────────────────────

export async function login(req, env) {
  if (await hit(env, `login:ip:${clientIp(req)}`, 30)) return tooMany();
  const body = await readJson(req);
  if (!body || typeof body.email !== 'string' || typeof body.password !== 'string') return fail('Enter your email and password.');
  const email = normEmail(body.email);

  const failBucket = await emailBucket(env, 'loginfail', email);
  if ((await count(env, failBucket)) >= FAIL_LIMIT) return tooMany();

  const user = await env.DB.prepare(
    'SELECT id, email, password_hash, totp_secret_enc, mfa_enabled, session_version FROM nb_users WHERE email = ?')
    .bind(email).first();
  const good = user ? await verifyPassword(body.password, user.password_hash) : await dummyVerify(body.password);
  if (!user || !good) {
    await hit(env, failBucket, FAIL_LIMIT);
    return fail('Email or password is incorrect.', 401);
  }
  await clearBucket(env, failBucket);

  if (!user.mfa_enabled) {
    // Account created but MFA never confirmed: resume setup.
    const secret = await decryptSecret(user.totp_secret_enc, env.DATA_KEY);
    const setupToken = await issue(env, { typ: 'mfa_setup', sub: user.id }, MFA_SETUP_TTL);
    return ok({ needs_mfa_setup: true, setup_token: setupToken, totp_uri: otpauthUri(user.email, secret), totp_secret: secret });
  }
  const pending = await issue(env, { typ: 'mfa_pending', sub: user.id }, MFA_PENDING_TTL);
  return ok({ needs_mfa: true, pending_token: pending });
}

export async function loginMfa(req, env) {
  if (await hit(env, `mfa:ip:${clientIp(req)}`, 20)) return tooMany();
  const body = await readJson(req);
  if (!body || !body.pending_token || (!body.code && !body.recovery_code)) return fail('Enter your code.');
  const claims = await verifyJWT(body.pending_token, env.JWT_SECRET);
  if (!claims || claims.typ !== 'mfa_pending') return fail('Your sign-in expired. Start again.', 401);

  const failBucket = `mfa:user:${claims.sub}`;
  if ((await count(env, failBucket)) >= FAIL_LIMIT) return tooMany();

  const user = await env.DB.prepare(
    'SELECT id, email, totp_secret_enc, mfa_enabled, totp_last_step, session_version FROM nb_users WHERE id = ?')
    .bind(claims.sub).first();
  if (!user || !user.mfa_enabled) return fail('Your sign-in expired. Start again.', 401);

  let passed = false;
  let usedRecovery = false;
  if (body.recovery_code) {
    const hash = await hmacHex(env.DATA_KEY, `recovery:${normaliseRecoveryCode(body.recovery_code)}`);
    // Single statement, so two simultaneous requests cannot both spend a code.
    const res = await env.DB.prepare(
      'UPDATE nb_recovery_codes SET used_at = ? WHERE user_id = ? AND code_hash = ? AND used_at IS NULL')
      .bind(Date.now(), user.id, hash).run();
    passed = (res.meta?.changes || 0) === 1;
    usedRecovery = passed;
  } else {
    const secret = await decryptSecret(user.totp_secret_enc, env.DATA_KEY);
    const step = await verifyTotp(secret, body.code, user.totp_last_step);
    if (step) {
      // Only advances the step if nobody else did first, which blocks replay.
      const res = await env.DB.prepare('UPDATE nb_users SET totp_last_step = ? WHERE id = ? AND totp_last_step < ?')
        .bind(step, user.id, step).run();
      passed = (res.meta?.changes || 0) === 1;
    }
  }
  if (!passed) {
    await hit(env, failBucket, FAIL_LIMIT);
    return fail(body.recovery_code ? 'That recovery code is not valid or was already used.' : 'That code did not match.', 401);
  }
  await clearBucket(env, failBucket);
  const left = await env.DB.prepare('SELECT COUNT(*) AS n FROM nb_recovery_codes WHERE user_id = ? AND used_at IS NULL')
    .bind(user.id).first();
  return ok({ user: { id: user.id, email: user.email }, used_recovery_code: usedRecovery, recovery_remaining: left?.n || 0 }, 200,
    { 'Set-Cookie': await startSession(req, env, user) });
}

// ── Session endpoints ───────────────────────────────────────────────────────

export async function me(req, env, user) {
  const left = await env.DB.prepare('SELECT COUNT(*) AS n FROM nb_recovery_codes WHERE user_id = ? AND used_at IS NULL')
    .bind(user.id).first();
  return ok({ user: { id: user.id, email: user.email }, recovery_remaining: left?.n || 0, now: Date.now() });
}

export function logout(req) {
  return ok({ ok: true }, 200, { 'Set-Cookie': sessionCookie(req, '', 0) });
}

export async function logoutAll(req, env, user) {
  await env.DB.prepare('UPDATE nb_users SET session_version = session_version + 1 WHERE id = ?').bind(user.id).run();
  return ok({ ok: true }, 200, { 'Set-Cookie': sessionCookie(req, '', 0) });
}

// Regenerating recovery codes needs the password and a current TOTP code, so a
// stolen session cookie alone cannot mint new codes.
export async function regenerateRecoveryCodes(req, env, user) {
  if (await hit(env, `regen:user:${user.id}`, 5)) return tooMany();
  const body = await readJson(req);
  if (!body) return fail('Invalid request');
  const row = await env.DB.prepare('SELECT password_hash, totp_secret_enc, totp_last_step FROM nb_users WHERE id = ?')
    .bind(user.id).first();
  if (!row || !(await verifyPassword(String(body.password || ''), row.password_hash))) return fail('Password is incorrect.', 401);
  const secret = await decryptSecret(row.totp_secret_enc, env.DATA_KEY);
  const step = await verifyTotp(secret, body.code, row.totp_last_step);
  if (!step) return fail('That code did not match.', 401);
  await env.DB.prepare('UPDATE nb_users SET totp_last_step = ? WHERE id = ?').bind(step, user.id).run();
  return ok({ recovery_codes: await makeRecoveryCodes(env, user.id) });
}

// ── Password reset ──────────────────────────────────────────────────────────

export async function resetRequest(req, env, ctx) {
  if (await hit(env, `reset:ip:${clientIp(req)}`, 5, 60 * 60 * 1000)) return tooMany();
  const body = await readJson(req);
  if (!body || typeof body.email !== 'string') return fail('Enter your email address.');
  const email = normEmail(body.email);
  const generic = ok({ message: 'If that address has an account, a reset link is on its way.' });
  if (!EMAIL_RE.test(email)) return generic;
  if (await hit(env, await emailBucket(env, 'reset', email), 3, 60 * 60 * 1000)) return generic;

  const user = await env.DB.prepare('SELECT id, email FROM nb_users WHERE email = ?').bind(email).first();
  if (user) {
    const token = randomToken(32);
    await env.DB.prepare('INSERT INTO nb_reset_tokens (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
      .bind(await sha256Hex(token), user.id, Date.now() + RESET_TTL_MS, Date.now()).run();
    const link = `${env.SITE_URL || new URL(req.url).origin}/?reset=${token}`;
    const job = sendResetEmail(env, user.email, link);
    if (ctx?.waitUntil) ctx.waitUntil(job); else await job;
  }
  return generic;
}

export async function resetConfirm(req, env) {
  if (await hit(env, `resetconfirm:ip:${clientIp(req)}`, 10, 60 * 60 * 1000)) return tooMany();
  const body = await readJson(req);
  if (!body || typeof body.token !== 'string') return fail('Invalid request');
  const problem = passwordProblem(body.password);
  if (problem) return fail(problem);

  const hash = await sha256Hex(body.token);
  const rec = await env.DB.prepare('SELECT user_id, expires_at, used_at FROM nb_reset_tokens WHERE token_hash = ?').bind(hash).first();
  if (!rec || rec.used_at || rec.expires_at < Date.now()) return fail('This reset link is invalid or has expired.', 400);

  // Claim the token first. Only one request can flip used_at from NULL.
  const claim = await env.DB.prepare('UPDATE nb_reset_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL')
    .bind(Date.now(), hash).run();
  if ((claim.meta?.changes || 0) !== 1) return fail('This reset link is invalid or has expired.', 400);

  await env.DB.batch([
    env.DB.prepare('UPDATE nb_users SET password_hash = ?, session_version = session_version + 1 WHERE id = ?')
      .bind(await hashPassword(body.password), rec.user_id),
    env.DB.prepare('UPDATE nb_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL').bind(Date.now(), rec.user_id),
    env.DB.prepare('DELETE FROM nb_auth_attempts WHERE bucket = ?').bind(`mfa:user:${rec.user_id}`),
  ]);
  const owner = await env.DB.prepare('SELECT email FROM nb_users WHERE id = ?').bind(rec.user_id).first();
  if (owner) await clearBucket(env, await emailBucket(env, 'loginfail', owner.email));
  // No session is issued: the user must still pass MFA to sign in.
  return ok({ message: 'Password updated. Sign in with your new password.' });
}
