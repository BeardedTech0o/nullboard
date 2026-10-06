// Response, header and cookie helpers.

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
};

export function ok(data, status = 200, extraHeaders) {
  return new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...extraHeaders } });
}

export function fail(message, status = 400, extra = {}) {
  return new Response(JSON.stringify({ error: message, ...extra }), { status, headers: JSON_HEADERS });
}

export function clientIp(req) {
  return req.headers.get('CF-Connecting-IP') || req.headers.get('x-forwarded-for') || 'local';
}

// Reads a JSON body with a hard size cap. Returns null when invalid.
export async function readJson(req, maxBytes = 64 * 1024) {
  const type = req.headers.get('Content-Type') || '';
  if (!type.toLowerCase().startsWith('application/json')) return null;
  const declared = parseInt(req.headers.get('Content-Length') || '0', 10);
  if (declared > maxBytes) return null;
  try {
    const text = await req.text();
    if (text.length > maxBytes) return null;
    const body = JSON.parse(text);
    return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}

// ── Security headers ────────────────────────────────────────────────────────

const BASE_HEADERS = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
};

// Google Fonts is the one external origin: the stylesheet and the font files.
export function buildCsp(scriptHashes = []) {
  const scripts = ["'self'", ...scriptHashes.map((h) => `'sha256-${h}'`)].join(' ');
  return [
    "default-src 'self'",
    `script-src ${scripts}`,
    "style-src 'self' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

export function withSecurityHeaders(res, scriptHashes) {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(BASE_HEADERS)) out.headers.set(k, v);
  out.headers.set('Content-Security-Policy',
    (res.headers.get('Content-Type') || '').includes('text/html')
      ? buildCsp(scriptHashes)
      : "default-src 'none'; frame-ancestors 'none'");
  return out;
}

// ── Cookies ─────────────────────────────────────────────────────────────────

export function isHttps(req) {
  return new URL(req.url).protocol === 'https:';
}

export function cookieName(req) {
  // The __Host- prefix pins the cookie to this exact host over HTTPS.
  return isHttps(req) ? '__Host-nb_session' : 'nb_session';
}

export function sessionCookie(req, value, maxAgeSecs) {
  const parts = [
    `${cookieName(req)}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${maxAgeSecs}`,
  ];
  if (isHttps(req)) parts.push('Secure');
  return parts.join('; ');
}

export function readCookie(req, name) {
  const header = req.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

// Standard base64 SHA-256, the format CSP hash sources use.
export async function sha256Base64(text) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  let s = '';
  for (let i = 0; i < digest.length; i++) s += String.fromCharCode(digest[i]);
  return btoa(s);
}
