// Things you can do to a tile. Shared by every view so the rules (what
// completing means, what counts towards the streak) live in one place.

import * as store from './store.js';
import { newTile, uid, elapsedSec } from './model.js';
import { toast } from './ui.js';

export function capture(title) {
  const text = String(title || '').trim();
  if (!text) return null;
  const t = store.now();
  const tile = newTile({ title: text.slice(0, 500), lane: 'inbox', order: t }, t);
  store.put('tile', tile);
  store.touchToday();
  return tile;
}

// Stops the timer, folding the running time into spentSec.
function stopTimer(tile) {
  if (tile.timerStart) {
    tile.spentSec = elapsedSec(tile, store.now());
    tile.timerStart = null;
  }
}

export function completeTile(id) {
  const before = store.get('tile', id);
  if (!before) return;
  const snapshot = structuredClone(before);
  const wasFocus = store.prefs().focus?.tileId === id;
  const t = store.now();
  store.patchTile(id, (tile) => {
    stopTimer(tile);
    tile.lane = 'archive';
    tile.status = 'done';
    tile.completedAt = t;
    tile.archivedAt = t;
    tile.archiveReason = 'completed';
  });
  if (wasFocus) store.setPrefs({ focus: null });
  store.recordTick(1);
  toast('Done and archived.', { label: 'Undo', fn: () => undoComplete(snapshot, wasFocus) });
}

function undoComplete(snapshot, wasFocus) {
  store.put('tile', { ...snapshot, touchedAt: store.now() });
  if (wasFocus) store.setPrefs({ focus: { tileId: snapshot.id, since: store.now() } });
  store.recordTick(-1);
}

export function dropTile(id) {
  const t = store.now();
  store.patchTile(id, (tile) => {
    stopTimer(tile);
    tile.lane = 'archive';
    tile.archivedAt = t;
    tile.archiveReason = 'dropped';
  });
  if (store.prefs().focus?.tileId === id) store.setPrefs({ focus: null });
  toast('Dropped. It is in the archive if you change your mind.');
}

export function restoreTile(id) {
  store.patchTile(id, (tile) => {
    tile.lane = 'active';
    tile.status = null;
    tile.completedAt = null;
    tile.archivedAt = null;
    tile.archiveReason = null;
  });
}

export function deleteTile(id) {
  // Anything waiting on this tile stops waiting.
  for (const other of store.tiles()) {
    if (other.blockedBy === id) store.patchTile(other.id, (x) => { x.blockedBy = null; x.blocked = false; });
  }
  if (store.prefs().focus?.tileId === id) store.setPrefs({ focus: null });
  store.remove('tile', id);
}

export function moveToLane(id, lane, projectId) {
  store.patchTile(id, (tile) => {
    tile.lane = lane;
    if (lane === 'active') {
      tile.projectId = projectId ?? tile.projectId;
      tile.status = tile.status === 'done' ? null : tile.status;
    }
    if (lane === 'inbox' || lane === 'someday') { tile.status = null; stopTimer(tile); }
  });
  if (lane !== 'active' && store.prefs().focus?.tileId === id) store.setPrefs({ focus: null });
}

export function setStatus(id, status) {
  store.patchTile(id, (tile) => { tile.status = status; if (tile.lane !== 'active') tile.lane = 'active'; });
}

export function setFocus(id) {
  store.setPrefs({ focus: id ? { tileId: id, since: store.now() } : null });
  if (id) {
    const tile = store.get('tile', id);
    if (tile && tile.lane !== 'active') moveToLane(id, 'active', tile.projectId);
    const cur = store.get('tile', id);
    if (cur && (!cur.status || cur.status === 'todo')) setStatus(id, 'inprogress');
    const day = store.todayRecord();
    if (!day.ticked.includes('pick-focus')) store.toggleChecklistItem('pick-focus');
  }
  store.touchToday();
}

export function toggleSubtask(tileId, subId) {
  let nowDone = false;
  store.patchTile(tileId, (tile) => {
    const s = tile.subtasks.find((x) => x.id === subId);
    if (s) { s.done = !s.done; nowDone = s.done; }
  });
  store.recordTick(nowDone ? 1 : -1);
}

export function addSubtask(tileId, text) {
  const value = String(text || '').trim();
  if (!value) return;
  store.patchTile(tileId, (tile) => { tile.subtasks.push({ id: uid('sub'), text: value.slice(0, 500), done: false }); });
}

export function addNote(tileId, text) {
  const value = String(text || '').trim();
  if (!value) return;
  store.patchTile(tileId, (tile) => { tile.notes.push({ id: uid('note'), text: value.slice(0, 5000), at: store.now() }); });
}

export function toggleTimer(id) {
  store.patchTile(id, (tile) => {
    if (tile.timerStart) stopTimer(tile);
    else tile.timerStart = store.now();
  });
  store.touchToday();
}

export function addSeconds(id, seconds) {
  store.patchTile(id, (tile) => { tile.spentSec = Math.max(0, tile.spentSec + seconds); });
}

// Places a tile in a column (or the unplaced list when status is null),
// optionally before another tile, by choosing an order value between its new
// neighbours. Only the moved tile is rewritten, so drag and drop stays cheap
// to sync.
export function placeTile(id, { status, projectId, beforeId }) {
  const list = store.tiles()
    .filter((t) => t.id !== id && t.lane === 'active' && (t.status || null) === (status || null)
      && (projectId === undefined || status || (t.projectId || null) === (projectId || null)))
    .sort((a, b) => a.order - b.order);
  let order;
  const idx = beforeId ? list.findIndex((t) => t.id === beforeId) : -1;
  if (idx === -1) order = (list.length ? list[list.length - 1].order : store.now()) + 1000;
  else order = idx === 0 ? list[0].order - 1000 : (list[idx - 1].order + list[idx].order) / 2;
  store.patchTile(id, (tile) => {
    tile.lane = 'active';
    tile.status = status || null;
    if (projectId !== undefined) tile.projectId = projectId;
    tile.order = order;
  });
  store.touchToday();
}
