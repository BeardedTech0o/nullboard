// Thin fetch wrapper for the JSON API. The session lives in an HttpOnly
// cookie, so there is no token handling here.

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;   // 0 means the network failed
    this.body = body || {};
  }
}

export async function api(method, path, body) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      cache: 'no-store',
    });
  } catch {
    throw new ApiError('You appear to be offline.', 0);
  }
  let json = null;
  try { json = await res.json(); } catch { /* empty body */ }
  if (!res.ok) throw new ApiError((json && json.error) || `Request failed (${res.status})`, res.status, json);
  return json;
}
