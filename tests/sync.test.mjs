import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startStack, client, signUp, totpNow } from './helpers.mjs';

let stack, a, b, who;
before(async () => {
  stack = await startStack();
  who = await signUp('10.9.0.1');
  a = who.client;
  // second device: log in separately
  b = client('10.9.0.2');
  await stack.sql('UPDATE nb_users SET totp_last_step = 0');
  const l = await b.post('/api/auth/login', { email: who.email, password: who.password });
  const v = await b.post('/api/auth/mfa/verify', { pending_token: l.json.pending_token, code: await totpNow(who.secret, 1) });
  assert.equal(v.status, 200, JSON.stringify(v.json));
});
after(async () => { await stack?.stop(); });

const tile = (id, title, extra = {}) => ({ kind: 'tile', id, data: { id, title, lane: 'inbox', ...extra }, updated_at: Date.now() });

test('a change made on one device appears on the other', async () => {
  const w = await a.post('/api/sync', { since: 0, changes: [tile('t1', 'Write blog post')] });
  assert.equal(w.status, 200);
  assert.ok(w.json.cursor >= 1);
  const r = await b.post('/api/sync', { since: 0, changes: [] });
  const got = r.json.records.find((x) => x.id === 't1');
  assert.equal(got.data.title, 'Write blog post');
});

test('incremental pulls only return what changed since the cursor', async () => {
  const first = await b.post('/api/sync', { since: 0, changes: [] });
  const none = await b.post('/api/sync', { since: first.json.cursor, changes: [] });
  assert.equal(none.json.records.length, 0);
  await a.post('/api/sync', { since: 0, changes: [tile('t2', 'Second')] });
  const next = await b.post('/api/sync', { since: first.json.cursor, changes: [] });
  assert.deepEqual(next.json.records.map((x) => x.id), ['t2']);
});

test('last write wins: a stale edit is rejected and the winner is returned', async () => {
  const now = Date.now();
  await a.post('/api/sync', { since: 0, changes: [{ ...tile('t3', 'Newer title'), updated_at: now }] });
  const stale = await b.post('/api/sync', { since: 0, changes: [{ ...tile('t3', 'Older title'), updated_at: now - 60000 }] });
  assert.equal(stale.json.conflicts.length, 1);
  assert.equal(stale.json.conflicts[0].data.title, 'Newer title');
  const all = await a.post('/api/sync', { since: 0, changes: [] });
  assert.equal(all.json.records.find((x) => x.id === 't3').data.title, 'Newer title');
});

test('re-sending the same change is idempotent', async () => {
  const ch = tile('t4', 'Once', {});
  await a.post('/api/sync', { since: 0, changes: [ch] });
  const again = await a.post('/api/sync', { since: 0, changes: [ch] });
  assert.equal(again.status, 200);
  const all = await a.post('/api/sync', { since: 0, changes: [] });
  assert.equal(all.json.records.filter((x) => x.id === 't4').length, 1);
});

test('deletes sync as tombstones and stay deleted', async () => {
  await a.post('/api/sync', { since: 0, changes: [tile('t5', 'Doomed')] });
  const mid = await b.post('/api/sync', { since: 0, changes: [] });
  await a.post('/api/sync', { since: 0, changes: [{ kind: 'tile', id: 't5', deleted: true, updated_at: Date.now() + 1000 }] });
  const r = await b.post('/api/sync', { since: mid.json.cursor, changes: [] });
  const gone = r.json.records.find((x) => x.id === 't5');
  assert.equal(gone.deleted, true);
  // stale resurrect attempt loses
  const res = await b.post('/api/sync', { since: 0, changes: [{ ...tile('t5', 'Doomed'), updated_at: Date.now() - 5000 }] });
  assert.equal(res.json.conflicts.length, 1);
});

test('validation: unknown kind, bad lane, bad id, oversize record, too many changes', async () => {
  assert.equal((await a.post('/api/sync', { since: 0, changes: [{ kind: 'weird', id: 'x', data: {}, updated_at: 1 }] })).status, 400);
  assert.equal((await a.post('/api/sync', { since: 0, changes: [tile('bad', 'x', { lane: 'nowhere' })] })).status, 400);
  assert.equal((await a.post('/api/sync', { since: 0, changes: [tile('bad id with spaces', 'x')] })).status, 400);
  assert.equal((await a.post('/api/sync', { since: 0, changes: [tile('big', 'x', { notes: [{ id: 'n', text: 'y'.repeat(70000) }] })] })).status, 413);
  const many = Array.from({ length: 301 }, (_, i) => tile('m' + i, 'x'));
  assert.equal((await a.post('/api/sync', { since: 0, changes: many })).status, 413);
});

test('client timestamps cannot be set far into the future to win forever', async () => {
  await a.post('/api/sync', { since: 0, changes: [{ ...tile('t6', 'Future'), updated_at: Date.now() + 10 * 86400000 }] });
  const r = await a.post('/api/sync', { since: 0, changes: [] });
  assert.ok(r.json.records.find((x) => x.id === 't6').updated_at < Date.now() + 6 * 60000);
});

test('records are scoped to their owner', async () => {
  const other = await signUp('10.9.1.1', 'other@example.com');
  const r = await other.client.post('/api/sync', { since: 0, changes: [] });
  assert.equal(r.status, 200);
  assert.equal(r.json.records.length, 0, 'second account sees nothing of the first');
  // same record ids on both accounts do not collide or leak
  await other.client.post('/api/sync', { since: 0, changes: [tile('t1', 'Other account title')] });
  const mine = await a.post('/api/sync', { since: 0, changes: [] });
  assert.equal(mine.json.records.find((x) => x.id === 't1').data.title, 'Write blog post');
  const exp = await other.client.get('/api/export');
  assert.equal(exp.json.records.length, 1);
});

test('SQL metacharacters in data are stored as plain text', async () => {
  const nasty = "Robert'); DROP TABLE nb_records;--";
  await a.post('/api/sync', { since: 0, changes: [tile('t7', nasty)] });
  const r = await a.post('/api/sync', { since: 0, changes: [] });
  assert.equal(r.json.records.find((x) => x.id === 't7').data.title, nasty);
});

test('export returns every live record', async () => {
  const r = await a.get('/api/export');
  assert.equal(r.status, 200);
  assert.ok(r.json.records.length >= 5);
  assert.ok(!r.json.records.some((x) => x.id === 't5'));
});
