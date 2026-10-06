// Inbox, Someday/Maybe and Archive: the quiet lists.

import { h } from '../dom.js';
import { icon } from '../icons.js';
import * as store from '../store.js';
import * as actions from '../actions.js';
import { openTileSheet } from '../tile-sheet.js';
import { openSheet, confirmSheet, field, ui, toast, navigate } from '../ui.js';
import { STATUS_LABEL, prettyDate, fmtDuration, reviewDue } from '../model.js';

// Sends a captured idea to the board, choosing project and column.
export function openTriage(tileId, after) {
  const tile = store.get('tile', tileId);
  if (!tile) return;
  const project = h('select', { class: 'input' }, h('option', { value: '' }, 'No project'),
    store.projects().filter((p) => !p.archived).sort((a, b) => a.order - b.order).map((p) => h('option', { value: p.id, selected: p.id === tile.projectId }, p.name)));
  const column = h('select', { class: 'input' },
    h('option', { value: 'todo' }, 'To Do'), h('option', { value: '' }, 'Unplaced (decide later)'));
  openSheet({
    title: 'Move to board',
    saveLabel: 'Move',
    onSave: () => {
      actions.moveToLane(tileId, 'active', project.value || null);
      actions.placeTile(tileId, { status: column.value || null, projectId: project.value || null });
      toast('Moved to the board.');
      if (after) after();
    },
    build: (body) => {
      body.append(h('p', { class: 'tile-title' }, tile.title), field('Project', project), field('Column', column));
    },
  });
}

function listRow(t, buttons) {
  const project = store.projectById().get(t.projectId);
  return h('div', { class: 'item' },
    h('button', { type: 'button', class: 'item-title', on: { click: () => openTileSheet(t.id) } }, t.title),
    project ? h('div', { class: 'small muted' }, project.name) : null,
    h('div', { class: 'item-actions' }, buttons));
}

export function renderInbox() {
  const items = store.tiles().filter((t) => t.lane === 'inbox').sort((a, b) => b.order - a.order);
  return h('div', { class: 'view-narrow' },
    h('div', { class: 'page-head' }, h('h1', null, 'Inbox'), h('span', { class: 'muted small' }, `${items.length} captured`)),
    reviewDue(store.prefs(), store.now()) ? h('div', { class: 'banner' }, h('span', null, 'Weekly review is due.'),
      h('button', { type: 'button', class: 'btn btn-sm', on: { click: () => navigate('review') } }, 'Start review')) : null,
    h('p', { class: 'muted small' }, 'Everything you capture lands here. Sort it later, not now.'),
    items.length ? items.map((t) => listRow(t, [
      h('button', { type: 'button', class: 'btn btn-sm', on: { click: () => openTriage(t.id) } }, 'To board'),
      h('button', { type: 'button', class: 'btn btn-sm', on: { click: () => { actions.moveToLane(t.id, 'someday'); toast('Moved to Someday/Maybe.'); } } }, 'Someday'),
      h('button', { type: 'button', class: 'btn btn-sm btn-ghost', on: { click: () => actions.dropTile(t.id) } }, 'Drop'),
    ])) : h('p', { class: 'empty' }, 'Inbox is empty. When an idea turns up mid-task, tap Capture and get back to work.'));
}

export function renderSomeday() {
  const items = store.tiles().filter((t) => t.lane === 'someday').sort((a, b) => b.order - a.order);
  return h('div', { class: 'view-narrow' },
    h('div', { class: 'page-head' }, h('h1', null, 'Someday/Maybe'), h('span', { class: 'muted small' }, `${items.length} parked`)),
    h('p', { class: 'muted small' }, 'Low priority ideas. They stay out of the way until you choose to pull one in.'),
    items.length ? items.map((t) => listRow(t, [
      h('button', { type: 'button', class: 'btn btn-sm', on: { click: () => openTriage(t.id) } }, 'To board'),
      h('button', { type: 'button', class: 'btn btn-sm', on: { click: () => { actions.moveToLane(t.id, 'inbox'); toast('Moved to the inbox.'); } } }, 'Back to inbox'),
      h('button', { type: 'button', class: 'btn btn-sm btn-ghost', on: { click: () => actions.dropTile(t.id) } }, 'Drop'),
    ])) : h('p', { class: 'empty' }, 'Nothing parked. Use Someday on an inbox item you do not want to lose but are not ready for.'));
}

export function renderArchive() {
  const all = store.tiles().filter((t) => t.lane === 'archive');
  const q = ui.archiveQuery.trim().toLowerCase();
  const filter = ui.archiveFilter;
  const items = all
    .filter((t) => filter === 'all' || t.archiveReason === filter)
    .filter((t) => !q || t.title.toLowerCase().includes(q))
    .sort((a, b) => (b.archivedAt || 0) - (a.archivedAt || 0));

  const search = h('input', { class: 'input', type: 'search', placeholder: 'Search archive', value: ui.archiveQuery, 'aria-label': 'Search archive', on: { input: () => {
    ui.archiveQuery = search.value;
    document.dispatchEvent(new Event('nb:render'));
  } } });
  search.dataset.keep = 'archive-search';

  const groups = [];
  let lastMonth = '';
  for (const t of items) {
    const month = new Date(t.archivedAt || 0).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    if (month !== lastMonth) { groups.push(h('h2', { class: 'caps group-title' }, month)); lastMonth = month; }
    groups.push(archiveRow(t));
  }
  return h('div', { class: 'view-narrow' },
    h('div', { class: 'page-head' }, h('h1', null, 'Archive'), h('span', { class: 'muted small' }, `${all.length} kept`)),
    h('div', { class: 'filter-row' },
      h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Filter archive' }, [['all', 'All'], ['completed', 'Completed'], ['dropped', 'Dropped']].map(([key, label]) =>
        h('label', { class: 'seg-opt' }, h('input', { type: 'radio', name: 'archive-filter', checked: filter === key, on: { change: () => { ui.archiveFilter = key; document.dispatchEvent(new Event('nb:render')); } } }), label))),
      h('div', { class: 'grow' }, search)),
    groups.length ? groups : h('p', { class: 'empty' }, all.length ? 'Nothing matches.' : 'Finished tasks land here instead of vanishing.'));
}

function archiveRow(t) {
  const project = store.projectById().get(t.projectId);
  const bits = [
    t.archiveReason === 'completed' ? `Completed ${prettyDate(t.completedAt || t.archivedAt)}` : `Dropped ${prettyDate(t.archivedAt)}`,
    project ? project.name : null,
    t.estimateMin || t.spentSec ? `${fmtDuration(t.spentSec)} spent${t.estimateMin ? ` of ${fmtDuration(t.estimateMin * 60)} estimated` : ''}` : null,
    t.subtasks.length ? `${t.subtasks.filter((s) => s.done).length}/${t.subtasks.length} steps` : null,
  ].filter(Boolean);
  return h('div', { class: 'item' },
    h('span', { class: 'row' }, h('span', { class: `status-dot` , dataset: { status: t.archiveReason === 'completed' ? 'ok' : null } }), h('button', { type: 'button', class: 'item-title', on: { click: () => openTileSheet(t.id) } }, t.title)),
    h('div', { class: 'small muted' }, bits.join('  ·  ')),
    h('div', { class: 'item-actions' },
      h('button', { type: 'button', class: 'btn btn-sm', on: { click: () => { actions.restoreTile(t.id); toast('Restored to the board.'); } } }, icon('undo', 14), 'Restore'),
      h('button', { type: 'button', class: 'btn btn-sm btn-ghost btn-danger', on: { click: () => confirmSheet({
        title: 'Delete for good', message: 'Remove this from the archive permanently?', confirmLabel: 'Delete', onConfirm: () => actions.deleteTile(t.id) }) } }, 'Delete')));
}
