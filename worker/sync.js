// Sync: last-write-wins per record, with a per-user sequence number so a
// device can ask for everything that changed since it last looked.
//
// POST /api/sync { since, changes: [{ kind, id, data, updated_at, deleted }] }
//   -> { cursor, now, records: [...], conflicts: [...] }
//
// Every write in one request shares a single seq value, allocated inside the
// same D1 batch (a transaction) as the writes, so a reader can never observe
// seq N without all of its rows.

import { ok, fail, readJson } from './http.js';

const KINDS = new Set(['project', 'tile', 'template', 'day', 'prefs']);
const MAX_CHANGES = 300;
const MAX_RECORD_BYTES = 64 * 1024;
const MAX_FUTURE_MS = 5 * 60 * 1000;
const ID_RE = /^[A-Za-z0-9._:-]{1,80}$/;

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const str = (v, max) => typeof v === 'string' && v.length <= max;

// Light shape checks. Unknown keys pass through so newer clients keep working,
// but anything the server or UI relies on must have the right type.
function validate(kind, data) {
  if (!isObj(data)) return false;
  switch (kind) {
    case 'project': return str(data.name, 200);
    case 'tile':
      return str(data.title, 500)
        && (data.projectId == null || str(data.projectId, 80))
        && ['inbox', 'someday', 'active', 'archive'].includes(data.lane)
        && (data.subtasks == null || (Array.isArray(data.subtasks) && data.subtasks.length <= 200))
        && (data.notes == null || (Array.isArray(data.notes) && data.notes.length <= 200));
    case 'template': return str(data.name, 200) && Array.isArray(data.tiles) && data.tiles.length <= 200;
    case 'day': return Array.isArray(data.ticked ?? []);
    case 'prefs': return true;
    default: return false;
  }
}

export async function sync(req, env, user) {
  const body = await readJson(req, 1024 * 1024);
  if (!body) return fail('Invalid request');
  const since = Number.isInteger(body.since) && body.since >= 0 ? body.since : 0;
  const changes = Array.isArray(body.changes) ? body.changes : [];
  if (changes.length > MAX_CHANGES) return fail(`Send at most ${MAX_CHANGES} changes per request.`, 413);

  const now = Date.now();
  const conflicts = [];
  const clean = [];
  for (const c of changes) {
    if (!isObj(c) || !KINDS.has(c.kind) || !ID_RE.test(String(c.id))) return fail('Invalid change');
    const deleted = c.deleted ? 1 : 0;
    if (!deleted && !validate(c.kind, c.data)) return fail(`Invalid ${c.kind} record`);
    const json = deleted ? '{}' : JSON.stringify(c.data);
    if (json.length > MAX_RECORD_BYTES) return fail('Record too large', 413);
    const updatedAt = Number.isFinite(c.updated_at) ? Math.min(Math.floor(c.updated_at), now + MAX_FUTURE_MS) : now;
    clean.push({ kind: c.kind, id: String(c.id), json, deleted, updatedAt });
  }

  let cursor = since;
  if (clean.length) {
    // Latest incoming change per record wins within the batch.
    const byKey = new Map();
    for (const c of clean) {
      const k = `${c.kind}\u0000${c.id}`;
      const prev = byKey.get(k);
      if (!prev || c.updatedAt >= prev.updatedAt) byKey.set(k, c);
    }
    const stmts = [env.DB.prepare('UPDATE nb_users SET seq = seq + 1 WHERE id = ?').bind(user.id)];
    for (const c of byKey.values()) {
      // Writes only when the incoming edit is strictly newer than what the
      // server holds. Ties go to the server so retries are idempotent.
      stmts.push(env.DB.prepare(
        `INSERT INTO nb_records (user_id, kind, id, data, updated_at, deleted, seq)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, (SELECT seq FROM nb_users WHERE id = ?1))
         ON CONFLICT (user_id, kind, id) DO UPDATE SET
           data = excluded.data, updated_at = excluded.updated_at,
           deleted = excluded.deleted, seq = excluded.seq
         WHERE excluded.updated_at > nb_records.updated_at`)
        .bind(user.id, c.kind, c.id, c.json, c.updatedAt, c.deleted));
    }
    const results = await env.DB.batch(stmts);
    results.slice(1).forEach((r, i) => {
      if ((r.meta?.changes || 0) === 0) conflicts.push([...byKey.values()][i]);
    });
  }

  const seqRow = await env.DB.prepare('SELECT seq FROM nb_users WHERE id = ?').bind(user.id).first();
  cursor = seqRow?.seq || 0;

  const rows = await env.DB.prepare(
    'SELECT kind, id, data, updated_at, deleted, seq FROM nb_records WHERE user_id = ? AND seq > ? ORDER BY seq ASC LIMIT 2000')
    .bind(user.id, since).all();
  const records = (rows.results || []).map(shape);
  // A capped page must not advance the cursor past rows the client has not got.
  const more = records.length >= 2000;
  if (more) cursor = records[records.length - 1].seq;

  // For writes that lost, send the winning server copy so the client converges.
  const conflictRecords = [];
  for (const c of conflicts) {
    const row = await env.DB.prepare(
      'SELECT kind, id, data, updated_at, deleted, seq FROM nb_records WHERE user_id = ? AND kind = ? AND id = ?')
      .bind(user.id, c.kind, c.id).first();
    if (row) conflictRecords.push(shape(row));
  }
  return ok({ cursor, more, now, records, conflicts: conflictRecords });
}

function shape(r) {
  return { kind: r.kind, id: r.id, data: r.deleted ? null : JSON.parse(r.data), updated_at: r.updated_at, deleted: !!r.deleted, seq: r.seq };
}

// Full JSON backup of everything the account holds.
export async function exportAll(req, env, user) {
  const rows = await env.DB.prepare(
    'SELECT kind, id, data, updated_at, deleted, seq FROM nb_records WHERE user_id = ? AND deleted = 0 ORDER BY kind, id')
    .bind(user.id).all();
  return ok({ exported_at: new Date().toISOString(), email: user.email, records: (rows.results || []).map(shape) }, 200,
    { 'Content-Disposition': 'attachment; filename="nullboard-export.json"' });
}
