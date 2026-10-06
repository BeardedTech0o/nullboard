// Self-hosted entry point: runs the same Worker code on plain Node 22.
// No dependencies. Put a TLS-terminating proxy (Caddy in docker-compose.yml)
// in front of it; browsers need HTTPS to install the PWA and keep the cookie.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from '../worker/index.js';
import { openDatabase, d1, migrate } from './d1-shim.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(root, 'public');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};

const env = {
  JWT_SECRET: process.env.JWT_SECRET,
  DATA_KEY: process.env.DATA_KEY,
  ALLOWED_EMAILS: process.env.ALLOWED_EMAILS,
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  RESEND_API_URL: process.env.RESEND_API_URL,
  EMAIL_FROM: process.env.EMAIL_FROM,
  SITE_URL: process.env.SITE_URL,
  LOG_RESET_LINKS: process.env.LOG_RESET_LINKS,
};
for (const k of ['JWT_SECRET', 'DATA_KEY']) {
  if (!env[k] || env[k].length < 32) { console.error(`${k} must be set to at least 32 random characters.`); process.exit(1); }
}

const db = openDatabase(process.env.DB_PATH || path.join(root, 'data', 'nullboard.db'));
const applied = migrate(db, path.join(root, 'migrations'));
if (applied.length) console.log('Applied migrations:', applied.join(', '));
env.DB = d1(db);

// Static files, shaped like the Workers ASSETS binding.
env.ASSETS = {
  async fetch(req) {
    let p = decodeURIComponent(new URL(req.url).pathname);
    if (p.endsWith('/')) p += 'index.html';
    let file = path.normalize(path.join(PUBLIC, p));
    if (!file.startsWith(PUBLIC + path.sep)) return new Response('Not found', { status: 404 });
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      if (path.extname(p)) return new Response('Not found', { status: 404 });
      file = path.join(PUBLIC, 'index.html');        // single-page app fallback
    }
    return new Response(fs.readFileSync(file), { headers: { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' } });
  },
};

// Opportunistic housekeeping: expired reset tokens and old rate-limit rows.
setInterval(() => {
  try {
    db.prepare('DELETE FROM nb_reset_tokens WHERE expires_at < ?').run(Date.now() - 86400000);
    db.prepare('DELETE FROM nb_auth_attempts WHERE created_at < ?').run(Date.now() - 86400000);
  } catch (e) { console.error('cleanup failed', e.message); }
}, 3600000).unref();

const server = http.createServer(async (nreq, nres) => {
  try {
    // The proxy tells us the public scheme and host. Without it we assume
    // plain http, which keeps local runs working.
    const proto = (nreq.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
    const host = nreq.headers['x-forwarded-host'] || nreq.headers.host || 'localhost';
    const url = `${proto}://${host}${nreq.url}`;
    const chunks = [];
    let size = 0;
    for await (const c of nreq) { size += c.length; if (size > 2 * 1024 * 1024) { nres.writeHead(413).end(); return; } chunks.push(c); }
    const headers = new Headers();
    for (const [k, v] of Object.entries(nreq.headers)) if (v != null) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
    // Only trust the proxy's address; clients cannot choose their own.
    if (process.env.TRUST_PROXY !== '0') {
      const fwd = (nreq.headers['x-forwarded-for'] || '').split(',').pop().trim();
      headers.set('CF-Connecting-IP', fwd || nreq.socket.remoteAddress || 'local');
    } else headers.set('CF-Connecting-IP', nreq.socket.remoteAddress || 'local');
    const init = { method: nreq.method, headers };
    if (!['GET', 'HEAD'].includes(nreq.method) && chunks.length) init.body = Buffer.concat(chunks);
    const pending = [];
    const ctx = { waitUntil: (p) => pending.push(p.catch((e) => console.error('background task failed', e))) };
    const res = await worker.fetch(new Request(url, init), env, ctx);
    const out = {};
    res.headers.forEach((v, k) => { out[k] = v; });
    const cookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    if (cookies.length) out['set-cookie'] = cookies;
    nres.writeHead(res.status, out);
    nres.end(Buffer.from(await res.arrayBuffer()));
    await Promise.all(pending);
  } catch (err) {
    console.error('request failed', err);
    if (!nres.headersSent) nres.writeHead(500);
    nres.end();
  }
});

const port = Number(process.env.PORT || 8787);
server.listen(port, process.env.HOST || '0.0.0.0', () => console.log(`nullboard listening on ${port}`));
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { server.close(() => { db.close(); process.exit(0); }); });
