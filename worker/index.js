// nullboard Worker: a plain fetch-handler router. No framework, no ORM.
//   /api/*   JSON API (auth, sync)
//   others   static PWA files from the ASSETS binding, with security headers

import * as auth from './auth.js';
import { sync, exportAll } from './sync.js';
import { fail, withSecurityHeaders, sha256Base64 } from './http.js';

// Browsers send Origin on every cross-site POST. A mismatch means the request
// came from another site, so refuse it. SameSite=Strict on the cookie is the
// first line of defence; this is the second.
function crossSite(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return false;
  const origin = req.headers.get('Origin');
  return !!origin && origin !== new URL(req.url).origin;
}

async function api(req, env, ctx, url) {
  const { pathname } = url;
  const method = req.method;
  if (crossSite(req)) return fail('Cross-site request refused', 403);
  if (!env.JWT_SECRET || !env.DATA_KEY) return fail('Server is not configured', 500);

  // Public auth endpoints
  if (method === 'POST') {
    switch (pathname) {
      case '/api/auth/register': return auth.register(req, env);
      case '/api/auth/login': return auth.login(req, env);
      case '/api/auth/mfa/setup': return auth.mfaSetup(req, env);
      case '/api/auth/mfa/verify': return auth.loginMfa(req, env);
      case '/api/auth/reset-request': return auth.resetRequest(req, env, ctx);
      case '/api/auth/reset-confirm': return auth.resetConfirm(req, env);
      case '/api/auth/logout': return auth.logout(req);
      default: break;
    }
  }

  // Everything below needs a live session.
  const user = await auth.getSessionUser(req, env);
  if (!user) return fail('Not signed in', 401);

  if (method === 'GET' && pathname === '/api/auth/me') return auth.me(req, env, user);
  if (method === 'POST' && pathname === '/api/auth/logout-all') return auth.logoutAll(req, env, user);
  if (method === 'POST' && pathname === '/api/auth/recovery-codes') return auth.regenerateRecoveryCodes(req, env, user);
  if (method === 'POST' && pathname === '/api/sync') return sync(req, env, user);
  if (method === 'GET' && pathname === '/api/export') return exportAll(req, env, user);

  return fail('Not found', 404);
}

// The inline theme script in index.html has to run before first paint, so the
// CSP allows it by hash instead of 'unsafe-inline'. Hashes are derived from
// the page itself, so editing the script never needs a manual CSP update.
const hashCache = new Map();
async function inlineScriptHashes(html) {
  const found = [];
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    const body = m[1];
    if (!body.trim()) continue;
    if (!hashCache.has(body)) hashCache.set(body, await sha256Base64(body));
    found.push(hashCache.get(body));
  }
  return found;
}

async function staticAsset(req, env) {
  // A 304 has no body to hash, and browsers would then keep a CSP without the
  // script hash. Pages are tiny, so always serve them in full.
  const path = new URL(req.url).pathname;
  const isPage = !/\.[a-z0-9]+$/i.test(path) || path.endsWith('.html');
  if (isPage && (req.headers.has('If-None-Match') || req.headers.has('If-Modified-Since'))) {
    const headers = new Headers(req.headers);
    headers.delete('If-None-Match');
    headers.delete('If-Modified-Since');
    req = new Request(req, { headers });
  }
  const res = await env.ASSETS.fetch(req);
  const type = res.headers.get('Content-Type') || '';
  if (type.includes('text/html')) {
    const html = await res.text();
    const out = withSecurityHeaders(new Response(html, res), await inlineScriptHashes(html));
    out.headers.set('Cache-Control', 'no-cache');
    return out;
  }
  const out = withSecurityHeaders(res);
  // The service worker must always be revalidated or updates never arrive.
  if (new URL(req.url).pathname === '/sw.js') out.headers.set('Cache-Control', 'no-cache');
  return out;
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    try {
      if (url.pathname.startsWith('/api/')) {
        return withSecurityHeaders(await api(req, env, ctx, url));
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return withSecurityHeaders(fail('Method not allowed', 405));
      }
      return await staticAsset(req, env);
    } catch (err) {
      console.error('Unhandled error', err && err.stack ? err.stack : err);
      return withSecurityHeaders(fail('Something went wrong on our side.', 500));
    }
  },
};
