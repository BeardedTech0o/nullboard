// Local cache plus sync engine.
//
// D1 is the source of truth. This module keeps a per-device copy in
// localStorage so the app opens instantly and keeps working offline, queues
// every edit in an outbox, and reconciles with the server using
// last-write-wins per record (see worker/sync.js).

import { api, ApiError } from './api.js';
import { defaultPrefs, dayKey, dayCounts, uid } from './model.js';

const KEYS = 'nb:v1:';
const KINDS = ['project', 'tile', 'template', 'day', 'prefs'];
const BATCH = 250;

let userId = null;
let data = blank();
const listeners = new Set();
let version = 0;
let memo = { version: -1 };
let syncing = false;
let syncQueued = false;
let debounce = null;
let notifyScheduled = false;
let lastSource = 'local';
let authLostHandler = () => {};

export const status = { state: 'idle', lastSyncAt: 0, message: '' };

function blank() {
  const records = {};
  for (const k of KINDS) records[k] = {};
  return { records, cursor: 0, outbox: {}, offset: 0, rev: 0 };
}

// ── Persistence ─────────────────────────────────────────────────────────────

function save() {
  if (!userId) return;
  try { localStorage.setItem(KEYS + userId, JSON.stringify(data)); } catch { /* quota or private mode */ }
}

export function lastUser() {
  try { return localStorage.getItem('nb:last-user'); } catch { return null; }
}

export function hasCache(id) {
  try { return !!localStorage.getItem(KEYS + id); } catch { return false; }
}

export function init(id) {
  userId = id;
  data = blank();
  try {
    const raw = localStorage.getItem(KEYS + id);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.records) {
        data = { ...blank(), ...parsed, records: { ...blank().records, ...parsed.records } };
      }
    }
    localStorage.setItem('nb:last-user', id);
  } catch { /* start empty */ }
  version++;
}

// Wipes every trace of the account from this device. Theme stays: it is a
// device preference, not account data.
export function wipeLocal() {
  userId = null;
  data = blank();
  version++;
  try {
    const theme = localStorage.getItem('nb-theme');
    const size = localStorage.getItem('nb-fontsize');
    for (const k of Object.keys(localStorage)) if (k.startsWith('nb:')) localStorage.removeItem(k);
    if (theme) localStorage.setItem('nb-theme', theme);
    if (size) localStorage.setItem('nb-fontsize', size);
  } catch { /* ignore */ }
}

export const onAuthLost = (fn) => { authLostHandler = fn; };

// ── Subscriptions ───────────────────────────────────────────────────────────

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify(source) {
  version++;
  lastSource = source;
  if (notifyScheduled) return;
  notifyScheduled = true;
  queueMicrotask(() => {
    notifyScheduled = false;
    for (const fn of listeners) fn(lastSource);
  });
}

// ── Clock ───────────────────────────────────────────────────────────────────

// Edit times come from the device clock corrected by the offset the server
// reported, so a phone with a wrong clock still orders its edits sensibly.
export const now = () => Date.now() + (data.offset || 0);

// ── Reading ─────────────────────────────────────────────────────────────────

function derived() {
  if (memo.version === version) return memo;
  const out = { version };
  for (const k of KINDS) out[k] = Object.values(data.records[k]);
  out.tileById = new Map(out.tile.map((t) => [t.id, t]));
  out.projectById = new Map(out.project.map((p) => [p.id, p]));
  out.dayById = data.records.day;
  memo = out;
  return memo;
}

export const tiles = () => derived().tile;
export const projects = () => derived().project;
export const templates = () => derived().template;
export const tileById = () => derived().tileById;
export const projectById = () => derived().projectById;
export const days = () => derived().dayById;
export const get = (kind, id) => data.records[kind][id] || null;
export const pendingCount = () => Object.keys(data.outbox).length;
export const hasPrefs = () => !!data.records.prefs.prefs;

export function prefs() {
  return { ...defaultPrefs(0), ...(data.records.prefs.prefs || {}) };
}

// ── Writing ─────────────────────────────────────────────────────────────────

export function put(kind, record) {
  const key = `${kind}/${record.id}`;
  data.records[kind][record.id] = record;
  data.outbox[key] = { kind, id: record.id, data: record, deleted: false, updated_at: now(), rev: ++data.rev };
  save();
  notify('local');
  scheduleSync();
  return record;
}

export function remove(kind, id) {
  const key = `${kind}/${id}`;
  delete data.records[kind][id];
  data.outbox[key] = { kind, id, data: null, deleted: true, updated_at: now(), rev: ++data.rev };
  save();
  notify('local');
  scheduleSync();
}

export function putMany(entries) {
  for (const e of entries) {
    const key = `${e.kind}/${e.id}`;
    data.records[e.kind][e.id] = e.data;
    data.outbox[key] = { kind: e.kind, id: e.id, data: e.data, deleted: false, updated_at: now(), rev: ++data.rev };
  }
  save();
  notify('local');
  scheduleSync();
}

export function patchTile(id, fn) {
  const cur = data.records.tile[id];
  if (!cur) return null;
  const next = structuredClone(cur);
  fn(next);
  next.touchedAt = now();
  return put('tile', next);
}

export function setPrefs(patch) {
  return put('prefs', { ...prefs(), ...patch, id: 'prefs' });
}

// ── Days (streak and checklist ticks) ───────────────────────────────────────

const emptyDay = (id) => ({ id, touched: true, ticks: 0, ticked: [] });

function editToday(fn) {
  const id = dayKey(now());
  const next = structuredClone(data.records.day[id] || emptyDay(id));
  fn(next);
  return put('day', next);
}

export const today = () => dayKey(now());
export const todayRecord = () => data.records.day[today()] || emptyDay(today());

// Opening the board counts as touching it. Only writes the first time each day.
export function touchToday() {
  if (!userId) return;
  const cur = data.records.day[today()];
  if (cur && cur.touched) return;
  editToday((d) => { d.touched = true; });
}

export function recordTick(delta) {
  editToday((d) => { d.touched = true; d.ticks = Math.max(0, (d.ticks || 0) + delta); });
}

export function toggleChecklistItem(itemId) {
  editToday((d) => {
    d.touched = true;
    const i = d.ticked.indexOf(itemId);
    if (i >= 0) d.ticked.splice(i, 1); else d.ticked.push(itemId);
  });
}

export const dayDone = (d) => dayCounts(d);

// ── Sync ────────────────────────────────────────────────────────────────────

export function scheduleSync(delay = 700) {
  clearTimeout(debounce);
  debounce = setTimeout(sync, delay);
}

function setStatus(state, message = '') {
  status.state = state;
  status.message = message;
  if (state === 'idle') status.lastSyncAt = Date.now();
  for (const fn of listeners) fn('status');
}

// Union merge for day records: two devices ticking different things on the
// same day must not lose either.
function mergeDay(local, remote) {
  return {
    id: local.id,
    touched: !!(local.touched || remote.touched),
    ticks: Math.max(local.ticks || 0, remote.ticks || 0),
    ticked: [...new Set([...(remote.ticked || []), ...(local.ticked || [])])],
  };
}

function applyRemote(rec) {
  const key = `${rec.kind}/${rec.id}`;
  const pending = data.outbox[key];
  if (pending && pending.updated_at > rec.updated_at) return false;  // local edit is newer and will win on the next push
  if (pending && rec.kind === 'day' && !rec.deleted && pending.data) {
    const merged = mergeDay(pending.data, rec.data);
    data.records.day[rec.id] = merged;
    data.outbox[key] = { ...pending, data: merged, updated_at: Math.max(pending.updated_at, rec.updated_at) + 1, rev: ++data.rev };
    return true;
  }
  delete data.outbox[key];
  const had = data.records[rec.kind] && data.records[rec.kind][rec.id];
  if (rec.deleted) { delete data.records[rec.kind][rec.id]; return !!had; }
  if (!KINDS.includes(rec.kind)) return false;
  // The server echoes our own writes back. Identical data is not a change, so
  // it must not trigger a re-render.
  if (had && JSON.stringify(had) === JSON.stringify(rec.data)) return false;
  data.records[rec.kind][rec.id] = rec.data;
  return true;
}

export async function sync() {
  if (!userId) return;
  if (syncing) { syncQueued = true; return; }
  syncing = true;
  clearTimeout(debounce);
  setStatus('syncing');
  let changed = false;
  try {
    for (let guard = 0; guard < 30; guard++) {
      const batch = Object.values(data.outbox).slice(0, BATCH);
      const sentAt = Date.now();
      const res = await api('POST', '/api/sync', {
        since: data.cursor,
        changes: batch.map((b) => ({ kind: b.kind, id: b.id, data: b.data, deleted: b.deleted, updated_at: b.updated_at })),
      });
      data.offset = res.now - sentAt - Math.round((Date.now() - sentAt) / 2);
      for (const b of batch) {
        const key = `${b.kind}/${b.id}`;
        if (data.outbox[key] && data.outbox[key].rev === b.rev) delete data.outbox[key];
      }
      for (const rec of [...res.records, ...res.conflicts]) if (applyRemote(rec)) changed = true;
      data.cursor = res.cursor;
      save();
      if (!res.more && !Object.keys(data.outbox).length) break;
    }
    setStatus('idle');
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) { syncing = false; authLostHandler(); return; }
    setStatus(err instanceof ApiError && err.status === 0 ? 'offline' : 'error', err.message);
  }
  syncing = false;
  if (changed) notify('remote');
  if (syncQueued) { syncQueued = false; scheduleSync(50); }
}

let autoStarted = false;
export function startAutoSync() {
  if (autoStarted) return;
  autoStarted = true;
  const kick = () => { if (userId && !document.hidden) sync(); };
  document.addEventListener('visibilitychange', kick);
  window.addEventListener('online', kick);
  window.addEventListener('focus', kick);
  setInterval(kick, 45000);
}

export const newId = uid;
