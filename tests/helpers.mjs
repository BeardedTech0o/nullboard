// Test harness: boots `wrangler dev` against a throwaway local D1 and a mock
// Resend server, and gives tests a tiny cookie-aware client.
import { spawn, execFileSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hotp, base32Decode } from '../worker/crypto.js';

export const PORT = 8787;
export const BASE = `http://127.0.0.1:${PORT}`;
const MAIL_PORT = 8799;

export async function totpNow(secret, stepOffset = 0) {
  return hotp(base32Decode(secret), Math.floor(Date.now() / 30000) + stepOffset);
}

export async function startStack() {
  const persist = fs.mkdtempSync(path.join(os.tmpdir(), 'nb-test-'));
  const mails = [];
  const mailServer = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try { mails.push({ auth: req.headers.authorization, ...JSON.parse(body) }); } catch {}
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"id":"test"}');
    });
  });
  await new Promise((r) => mailServer.listen(MAIL_PORT, '127.0.0.1', r));

  const env = { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' };
  execFileSync('npx', ['wrangler', 'd1', 'migrations', 'apply', 'nullobj-db', '--local', '--persist-to', persist],
    { stdio: 'pipe', env });
  const child = spawn('npx', ['wrangler', 'dev', '--local', '--port', String(PORT), '--persist-to', persist,
    '--var', 'SITE_URL:' + BASE, '--var', 'ALLOWED_EMAILS:test@example.com,other@example.com'], { env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 120; i++) {
    try { const r = await fetch(BASE + '/api/auth/me'); if (r.status) break; } catch {}
    await new Promise((r) => setTimeout(r, 500));
    if (i === 119) throw new Error('wrangler dev did not start:\n' + log);
  }
  const sql = (q) => execFileSync('npx', ['wrangler', 'd1', 'execute', 'nullobj-db', '--local', '--persist-to', persist,
    '--command', q, '--json'], { env, stdio: 'pipe' }).toString();
  return {
    mails, sql, log: () => log,
    async stop() { try { process.kill(-child.pid, 'SIGKILL'); } catch {} mailServer.close(); fs.rmSync(persist, { recursive: true, force: true }); },
  };
}

// Minimal client with its own cookie jar and a fake client IP.
export function client(ip = '10.0.0.1') {
  let cookie = '';
  const api = {
    get cookie() { return cookie; },
    set cookie(v) { cookie = v; },
    async req(method, url, body, extra = {}) {
      const init = {
        method,
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip, ...(cookie ? { Cookie: cookie } : {}), ...extra },
        body: body === undefined ? undefined : JSON.stringify(body),
      };
      // wrangler dev occasionally reloads right after a direct D1 write; retry network errors only.
      let res;
      for (let i = 0; ; i++) {
        try { res = await fetch(BASE + url, init); break; } catch (e) { if (i >= 6) throw e; await new Promise((r) => setTimeout(r, 700)); }
      }
      const set = res.headers.get('set-cookie');
      if (set) { const pair = set.split(';')[0]; cookie = pair.endsWith('=') ? '' : pair; }
      let json = null;
      try { json = await res.json(); } catch {}
      return { status: res.status, json, headers: res.headers };
    },
    post: (u, b, e) => api.req('POST', u, b, e),
    get: (u, e) => api.req('GET', u, undefined, e),
  };
  return api;
}

// Registers the allow-listed test account through the real endpoints and
// returns a signed-in client plus the TOTP secret.
export async function signUp(ip, email = 'test@example.com', password = 'correct horse battery') {
  const c = client(ip);
  const r = await c.post('/api/auth/register', { email, password });
  if (r.status !== 201) throw new Error('register failed ' + JSON.stringify(r.json));
  const done = await c.post('/api/auth/mfa/setup', { setup_token: r.json.setup_token, code: await totpNow(r.json.totp_secret) });
  if (done.status !== 200) throw new Error('mfa setup failed ' + JSON.stringify(done.json));
  return { client: c, secret: r.json.totp_secret, password, email };
}
