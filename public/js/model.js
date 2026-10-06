// Data model and pure helpers. Nothing in here touches the DOM or the network,
// so it runs unchanged under node for tests.
//
// Records (all synced through nb_records):
//   project   { id, name, color, archived, order }
//   tile      { id, title, projectId|null, lane, status, order, subtasks[], notes[],
//               estimateMin|null, spentSec, timerStart|null, blocked, blockedBy|null,
//               blockedNote, createdAt, touchedAt, completedAt|null, archivedAt|null,
//               archiveReason }
//     lane:   inbox | someday | active | archive
//     status: null (unplaced) | todo | inprogress | signoff | done (archived only)
//   template  { id, name, tiles: [{ title }] }
//   day       { id: 'YYYY-MM-DD', touched, ticks, ticked: [checklist item ids] }
//   prefs     { theme, view, fontSize, checklist[], focus, lastPanelDay,
//               lastReviewAt, reviewAnchor }

export const COLUMNS = [
  { key: 'todo', label: 'To Do' },
  { key: 'inprogress', label: 'In Progress' },
  { key: 'signoff', label: 'Awaiting Sign-Off' },
];

export const STATUS_LABEL = { todo: 'To Do', inprogress: 'In Progress', signoff: 'Awaiting Sign-Off', done: 'Completed' };

export const DEFAULT_CHECKLIST = [
  { id: 'review-inbox', label: 'Review inbox' },
  { id: 'review-blockers', label: 'Review blockers' },
  { id: 'pick-focus', label: "Pick today's focus task" },
  { id: 'update-streak', label: 'Update streak' },
];

export const FONT_SIZES = [
  { key: 'xsmall', label: 'X-Small' },
  { key: 'small', label: 'Small' },
  { key: 'medium', label: 'Medium' },
  { key: 'large', label: 'Large' },
  { key: 'xlarge', label: 'X-Large' },
];

export const DAY_MS = 86400000;
export const STALE_DAYS = 14;
export const REVIEW_EVERY_DAYS = 7;

export function uid(prefix) {
  const rand = crypto.getRandomValues(new Uint8Array(6));
  return `${prefix}-${Date.now().toString(36)}${[...rand].map((b) => b.toString(36).padStart(2, '0')).join('')}`;
}

export function defaultPrefs(now = Date.now()) {
  return {
    theme: 'system',
    view: 'focus',
    fontSize: 'medium',
    checklist: DEFAULT_CHECKLIST.map((c) => ({ ...c })),
    focus: null,
    lastPanelDay: null,
    lastReviewAt: null,
    reviewAnchor: now,
  };
}

export function newTile(fields, now = Date.now()) {
  return {
    id: uid('tile'), title: '', projectId: null, lane: 'inbox', status: null, order: now,
    subtasks: [], notes: [], estimateMin: null, spentSec: 0, timerStart: null,
    blocked: false, blockedBy: null, blockedNote: '',
    createdAt: now, touchedAt: now, completedAt: null, archivedAt: null, archiveReason: null,
    ...fields,
  };
}

export function newProject(name, now = Date.now()) {
  return { id: uid('proj'), name, color: null, archived: false, order: now };
}

// ── Dates ───────────────────────────────────────────────────────────────────

const pad = (n) => String(n).padStart(2, '0');

// The calendar day on the device, so "today" resets at local midnight.
export function dayKey(ts = Date.now()) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function addDays(key, delta) {
  const [y, m, d] = key.split('-').map(Number);
  return dayKey(new Date(y, m - 1, d + delta, 12).getTime());
}

export function prettyDate(ts) {
  return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ── Time ────────────────────────────────────────────────────────────────────

export function fmtDuration(totalSec) {
  const mins = Math.round(Math.max(0, totalSec) / 60);
  if (mins < 1) return totalSec > 0 ? '<1m' : '0m';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

// "90", "1h30", "1h 30m", "1.5h", "45m" -> minutes. Returns null when unparseable.
export function parseDuration(text) {
  const s = String(text || '').trim().toLowerCase();
  if (!s) return null;
  let m = /^(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?\s*(?:(\d+)\s*m?(?:in(?:ute)?s?)?)?$/.exec(s);
  if (m) return Math.round(parseFloat(m[1]) * 60 + (m[2] ? parseInt(m[2], 10) : 0));
  m = /^(\d+)\s*m(?:in(?:ute)?s?)?$/.exec(s);
  if (m) return parseInt(m[1], 10);
  m = /^\d+$/.exec(s);
  if (m) return parseInt(s, 10);
  return null;
}

export function elapsedSec(tile, now) {
  return tile.spentSec + (tile.timerStart ? Math.max(0, Math.round((now - tile.timerStart) / 1000)) : 0);
}

// Difference between time spent and the estimate, in seconds. Null when there
// is no estimate to compare with.
export function overBy(tile, now) {
  if (!tile.estimateMin) return null;
  return elapsedSec(tile, now) - tile.estimateMin * 60;
}

// ── Tiles ───────────────────────────────────────────────────────────────────

export function subtaskProgress(tile) {
  const total = tile.subtasks.length;
  const done = tile.subtasks.filter((s) => s.done).length;
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}

// A tile is blocked when flagged, and, if it names a blocker, only while that
// blocker is still open. Finishing the blocker releases it without any edit.
export function blockerOf(tile, byId) {
  if (!tile.blocked || !tile.blockedBy) return null;
  const other = byId.get(tile.blockedBy);
  return other && other.lane !== 'archive' ? other : null;
}

export function isBlocked(tile, byId) {
  if (!tile.blocked) return false;
  if (!tile.blockedBy) return true;
  const other = byId.get(tile.blockedBy);
  return !!other && other.lane !== 'archive';
}

export function staleTiles(tiles, now = Date.now(), days = STALE_DAYS) {
  return tiles.filter((t) => t.lane === 'active' && now - (t.touchedAt || t.createdAt) > days * DAY_MS);
}

// ── Streak ──────────────────────────────────────────────────────────────────

export function dayCounts(day) {
  return !!day && ((day.ticks || 0) > 0 || (day.ticked || []).length > 0);
}

// A day counts when something was ticked off. Today not being done yet does
// not break a streak: the run is measured back from yesterday in that case.
export function computeStreak(daysById, today) {
  const counted = new Set();
  for (const [id, d] of Object.entries(daysById)) if (dayCounts(d)) counted.add(id);
  let current = 0;
  let cursor = counted.has(today) ? today : addDays(today, -1);
  while (counted.has(cursor)) { current++; cursor = addDays(cursor, -1); }
  const sorted = [...counted].sort();
  let longest = 0, run = 0, prev = null;
  for (const k of sorted) {
    run = prev && addDays(prev, 1) === k ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = k;
  }
  return { current, longest, total: counted.size, doneToday: counted.has(today) };
}

// ── Weekly review ───────────────────────────────────────────────────────────

export function reviewDue(prefs, now = Date.now()) {
  const since = prefs.lastReviewAt || prefs.reviewAnchor || now;
  return now - since >= REVIEW_EVERY_DAYS * DAY_MS;
}

// ── Import from the old localStorage export ─────────────────────────────────

// Accepts the raw value of the old app's `ashcombe-kanban-v1` key, an object
// holding that key, or a nullboard export file. Returns the records to sync.
// Old ids are kept, so importing twice updates rather than duplicates.
export function parseImport(text, now = Date.now()) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('That is not valid JSON.'); }
  if (data && typeof data === 'object' && typeof data['ashcombe-kanban-v1'] === 'string') {
    try { data = JSON.parse(data['ashcombe-kanban-v1']); } catch { throw new Error('The ashcombe-kanban-v1 value is not valid JSON.'); }
  } else if (data && typeof data === 'object' && data['ashcombe-kanban-v1'] && typeof data['ashcombe-kanban-v1'] === 'object') {
    data = data['ashcombe-kanban-v1'];
  }
  if (!data || typeof data !== 'object') throw new Error('Nothing to import.');

  // nullboard's own export: records go straight back in.
  if (Array.isArray(data.records)) {
    const records = data.records.filter((r) => r && r.kind && r.id && r.data && !r.deleted)
      .map((r) => ({ kind: r.kind, id: r.id, data: r.data }));
    return { records, counts: countKinds(records), source: 'nullboard' };
  }

  if (!Array.isArray(data.projects) && !Array.isArray(data.tiles)) throw new Error('No projects or tiles found in that data.');
  const records = [];
  const projects = Array.isArray(data.projects) ? data.projects : [];
  const tiles = Array.isArray(data.tiles) ? data.tiles : [];
  const templates = Array.isArray(data.templates) ? data.templates : [];

  projects.forEach((p, i) => {
    if (!p || !p.id) return;
    records.push({ kind: 'project', id: String(p.id), data: {
      id: String(p.id), name: String(p.name || 'Untitled project').slice(0, 200),
      color: typeof p.color === 'string' ? p.color : null, archived: !!p.archived, order: now + i } });
  });

  const tileIndex = {};
  tiles.forEach((t, i) => {
    if (!t || !t.id) return;
    const done = t.status === 'done';
    const status = ['todo', 'inprogress', 'signoff'].includes(t.status) ? t.status : null;
    const notes = Array.isArray(t.notes)
      ? t.notes.filter((n) => n && typeof n.text === 'string').map((n, j) => ({ id: String(n.id || `${t.id}-n${j}`), text: n.text.slice(0, 5000) }))
      : [];
    const subtasks = Array.isArray(t.subtasks)
      ? t.subtasks.filter((s) => s && (s.text || s.title)).map((s, j) => ({ id: String(s.id || `${t.id}-s${j}`), text: String(s.text || s.title).slice(0, 500), done: !!s.done }))
      : [];
    const projectOk = t.projectId && projects.some((p) => p && p.id === t.projectId);
    const rec = newTile({
      id: String(t.id), title: String(t.title || 'Untitled').slice(0, 500),
      projectId: projectOk ? String(t.projectId) : null,
      lane: done ? 'archive' : 'active', status: done ? 'done' : status,
      order: now + i, notes, subtasks,
      completedAt: done ? now : null, archivedAt: done ? now : null, archiveReason: done ? 'completed' : null,
    }, now);
    tileIndex[rec.id] = true;
    records.push({ kind: 'tile', id: rec.id, data: rec });
  });

  templates.forEach((tp) => {
    if (!tp || !tp.id) return;
    records.push({ kind: 'template', id: String(tp.id), data: {
      id: String(tp.id), name: String(tp.name || 'Template').slice(0, 200),
      tiles: (Array.isArray(tp.tiles) ? tp.tiles : []).filter((x) => x && x.title).map((x) => ({ title: String(x.title).slice(0, 500) })).slice(0, 200) } });
  });

  return { records, counts: countKinds(records), source: 'legacy', fontSize: FONT_SIZES.some((f) => f.key === data.fontSize) ? data.fontSize : null };
}

function countKinds(records) {
  const counts = { project: 0, tile: 0, template: 0 };
  for (const r of records) if (r.kind in counts) counts[r.kind]++;
  return counts;
}
