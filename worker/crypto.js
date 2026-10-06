// Crypto helpers: PBKDF2 passwords, HS256 JWT, TOTP, AES-GCM at rest.
// Everything here uses WebCrypto only, so it runs unchanged on Workers,
// Node and any self-hosted runtime that implements it.

const enc = new TextEncoder();
const dec = new TextDecoder();

// Workers caps PBKDF2 at 100,000 iterations. The count is stored with each
// hash so it can be raised later without breaking existing passwords.
export const PBKDF2_ITERATIONS = 100000;

export function b64u(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

export function fromb64u(s) {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function hex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function timingSafeEqual(a, b) {
  const x = typeof a === 'string' ? enc.encode(a) : a;
  const y = typeof b === 'string' ? enc.encode(b) : b;
  let diff = x.length ^ y.length;
  const len = Math.max(x.length, y.length);
  for (let i = 0; i < len; i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

export async function sha256Hex(text) {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}

export async function hmacHex(secret, text) {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(text)));
}

export function randomToken(bytes = 32) {
  return b64u(crypto.getRandomValues(new Uint8Array(bytes)));
}

// ── Passwords ───────────────────────────────────────────────────────────────

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, 256));
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2-sha256$${PBKDF2_ITERATIONS}$${b64u(salt)}$${b64u(hash)}`;
}

export async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2-sha256') return false;
  const iterations = parseInt(parts[1], 10);
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 100000) return false;
  const hash = await pbkdf2(password, fromb64u(parts[2]), iterations);
  return timingSafeEqual(b64u(hash), parts[3]);
}

// A throwaway hash so unknown emails cost the same time as known ones.
let dummyHashPromise = null;
export function dummyVerify(password) {
  dummyHashPromise = dummyHashPromise || hashPassword('nullboard-dummy-password');
  return dummyHashPromise.then((h) => verifyPassword(password, h)).then(() => false);
}

// ── JWT (HS256) ─────────────────────────────────────────────────────────────

async function hmacKey(secret, usage) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
}

export async function signJWT(payload, secret) {
  const h = b64u(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const p = b64u(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret, 'sign'), enc.encode(`${h}.${p}`));
  return `${h}.${p}.${b64u(sig)}`;
}

export async function verifyJWT(token, secret) {
  try {
    if (typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [h, p, s] = parts;
    const header = JSON.parse(dec.decode(fromb64u(h)));
    if (header.alg !== 'HS256') return null; // never trust the header to pick the algorithm
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret, 'verify'), fromb64u(s), enc.encode(`${h}.${p}`));
    if (!ok) return null;
    const payload = JSON.parse(dec.decode(fromb64u(p)));
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

// ── Base32 and TOTP (RFC 4226 / RFC 6238) ───────────────────────────────────

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes) {
  let out = '', bits = 0, val = 0;
  for (const b of bytes) {
    val = (val << 8) | b;
    bits += 8;
    while (bits >= 5) { out += BASE32[(val >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits) out += BASE32[(val << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s) {
  const bytes = [];
  let bits = 0, val = 0;
  for (const c of s.toUpperCase().replace(/=+$/, '')) {
    const i = BASE32.indexOf(c);
    if (i < 0) continue;
    val = (val << 5) | i;
    bits += 5;
    if (bits >= 8) { bytes.push((val >>> (bits - 8)) & 255); bits -= 8; }
  }
  return new Uint8Array(bytes);
}

export function generateTotpSecret() {
  return base32Encode(crypto.getRandomValues(new Uint8Array(20)));
}

export async function hotp(keyBytes, counter) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const msg = new DataView(new ArrayBuffer(8));
  msg.setUint32(0, Math.floor(counter / 2 ** 32));
  msg.setUint32(4, counter >>> 0);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg.buffer));
  const o = sig[19] & 0xf;
  const code = ((sig[o] & 0x7f) << 24) | (sig[o + 1] << 16) | (sig[o + 2] << 8) | sig[o + 3];
  return String(code % 1000000).padStart(6, '0');
}

// Returns the matched time step, or 0 when the code is wrong or its step is
// not newer than lastStep (a code can only be used once).
export async function verifyTotp(secret, code, lastStep = 0, now = Date.now()) {
  const clean = String(code || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(clean)) return 0;
  const key = base32Decode(secret);
  const step = Math.floor(now / 30000);
  for (const d of [-1, 0, 1]) {
    if (timingSafeEqual(await hotp(key, step + d), clean) && step + d > lastStep) return step + d;
  }
  return 0;
}

// ── Recovery codes ──────────────────────────────────────────────────────────

export function generateRecoveryCode() {
  const raw = base32Encode(crypto.getRandomValues(new Uint8Array(7))).slice(0, 10);
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}

export function normaliseRecoveryCode(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
}

// ── AES-GCM for secrets at rest ─────────────────────────────────────────────

async function aesKey(dataKey) {
  const material = await crypto.subtle.digest('SHA-256', enc.encode(`nullboard:aes:${dataKey}`));
  return crypto.subtle.importKey('raw', material, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptSecret(plain, dataKey) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(dataKey), enc.encode(plain));
  return `v1.${b64u(iv)}.${b64u(ct)}`;
}

export async function decryptSecret(stored, dataKey) {
  const [v, iv, ct] = String(stored).split('.');
  if (v !== 'v1') throw new Error('Unknown secret format');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromb64u(iv) }, await aesKey(dataKey), fromb64u(ct));
  return dec.decode(plain);
}
