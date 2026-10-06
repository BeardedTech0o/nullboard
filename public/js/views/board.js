// The full board: project sidebar on the left, columns on the right.

import { h } from '../dom.js';
import { icon } from '../icons.js';
import * as store from '../store.js';
import * as actions from '../actions.js';
import { enableDnd } from '../dnd.js';
import { openTileSheet } from '../tile-sheet.js';
import { openSheet, confirmSheet, openMenu, ui, field, toast } from '../ui.js';
import { COLUMNS, isBlocked, subtaskProgress, fmtDuration, elapsedSec, overBy, newProject, newTile } from '../model.js';

export function renderBoard() {
  const projects = store.projects().filter((p) => !p.archived).sort((a, b) => a.order - b.order);
  const hidden = new Set(store.projects().filter((p) => p.archived).map((p) => p.id));
  const byId = store.tileById();
  const focusId = store.prefs().focus?.tileId;
  const filter = ui.projectFilter && projects.some((p) => p.id === ui.projectFilter) ? ui.projectFilter : null;

  const active = store.tiles().filter((t) => t.lane === 'active' && !(t.projectId && hidden.has(t.projectId)));
  const visible = filter ? active.filter((t) => t.projectId === filter) : active;

  const sidebar = h('aside', { class: `sidebar${ui.sidebarOpen ? ' open' : ''}`, 'aria-label': 'Projects', dataset: { scrollKey: 'sidebar' } },
    h('div', { class: 'row' },
      h('h2', { class: 'caps grow' }, 'Projects'),
      h('button', { type: 'button', class: 'btn btn-sm', on: { click: openNewProject } }, icon('plus', 14), 'New'),
      h('button', { type: 'button', class: 'icon-btn only-mobile', 'aria-label': 'Close projects', on: { click: () => { ui.sidebarOpen = false; document.dispatchEvent(new Event('nb:render')); } } }, icon('x'))),
    projects.length ? null : h('p', { class: 'muted small' }, 'No projects yet. Create one, or leave tiles without a project.'),
    projects.map((p) => projectBlock(p, active, filter, focusId, byId)),
    looseBlock(active, focusId, byId),
    archivedProjects());

  const columns = h('div', { class: 'columns', dataset: { scrollKey: 'columns' } }, COLUMNS.map((col) => {
    const items = visible.filter((t) => t.status === col.key).sort((a, b) => a.order - b.order);
    return h('section', { class: 'column', 'aria-label': col.label },
      h('div', { class: 'column-head' }, h('h2', { class: 'caps' }, col.label), h('span', { class: 'count' }, items.length)),
      h('div', { class: 'column-body', dataset: { zone: 'status', status: col.key, ordered: 'true', scrollKey: `col-${col.key}` } },
        items.length ? items.map((t) => tileCard(t, { focusId, byId, showProject: !filter })) : h('p', { class: 'muted small' }, 'Nothing here.')));
  }));

  const root = h('div', { class: 'board' }, sidebar, columns);
  if (ui.sidebarOpen) root.appendChild(h('div', { class: 'scrim only-mobile', on: { click: () => { ui.sidebarOpen = false; document.dispatchEvent(new Event('nb:render')); } } }));

  enableDnd({
    root, itemSel: '[data-tile]', zoneSel: '[data-zone]', itemId: (el) => el.dataset.tile,
    onDrop: ({ id, zone, beforeId }) => {
      const kind = zone.dataset.zone;
      if (kind === 'status') actions.placeTile(id, { status: zone.dataset.status, beforeId });
      else if (kind === 'project') { actions.placeTile(id, { status: null, projectId: zone.dataset.project || null }); ui.expandedProjects[zone.dataset.project] = true; }
    },
  });
  return root;
}

function projectBlock(p, active, filter, focusId, byId) {
  const mine = active.filter((t) => t.projectId === p.id);
  const unplaced = mine.filter((t) => !t.status).sort((a, b) => a.order - b.order);
  const open = !!ui.expandedProjects[p.id];
  const addInput = h('input', { class: 'input', type: 'text', placeholder: 'Add a tile', maxLength: 500, 'aria-label': `Add a tile to ${p.name}`, enterKeyHint: 'done', dataset: { keep: `add-${p.id}` } });
  const add = () => {
    const title = addInput.value.trim();
    if (!title) return;
    const t = store.now();
    store.put('tile', newTile({ title, projectId: p.id, lane: 'active', status: null, order: t }, t));
    store.touchToday();
  };
  addInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });

  return h('div', { class: `project${filter === p.id ? ' is-filter' : ''}`, dataset: { zone: 'project', project: p.id } },
    h('div', { class: 'project-head' },
      h('span', { class: 'avatar', 'aria-hidden': 'true' }, (p.name || '?').charAt(0).toUpperCase()),
      h('button', { type: 'button', class: 'project-name', title: 'Show only this project', 'aria-pressed': String(filter === p.id), on: { click: () => { ui.projectFilter = filter === p.id ? null : p.id; document.dispatchEvent(new Event('nb:render')); } } }, p.name),
      h('span', { class: 'count' }, mine.length),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Project options for ${p.name}`, on: { click: () => projectMenu(p, mine.length) } }, icon('more')),
      h('button', { type: 'button', class: 'icon-btn', 'aria-expanded': String(open), 'aria-label': open ? 'Collapse' : 'Expand', on: { click: () => { ui.expandedProjects[p.id] = !open; document.dispatchEvent(new Event('nb:render')); } } }, icon('chevron'))),
    open ? h('div', { class: 'project-body' },
      h('div', { class: 'stack', dataset: { zone: 'project', project: p.id } },
        unplaced.length ? unplaced.map((t) => tileCard(t, { compact: true, focusId, byId })) : h('p', { class: 'muted small' }, 'No unplaced tiles. Drag one here to unplace it.')),
      h('div', { class: 'add-row' }, addInput, h('button', { type: 'button', class: 'btn btn-sm', on: { click: add } }, 'Add'))) : null);
}

// Active tiles that have no project, so nothing is ever unreachable.
function looseBlock(active, focusId, byId) {
  const loose = active.filter((t) => !t.projectId && !t.status).sort((a, b) => a.order - b.order);
  if (!loose.length) return null;
  return h('div', { class: 'project', dataset: { zone: 'project', project: '' } },
    h('div', { class: 'project-head' }, h('span', { class: 'project-name' }, 'No project'), h('span', { class: 'count' }, loose.length)),
    h('div', { class: 'project-body stack' }, loose.map((t) => tileCard(t, { compact: true, focusId, byId }))));
}

function archivedProjects() {
  const archived = store.projects().filter((p) => p.archived);
  if (!archived.length) return null;
  return h('div', null,
    h('h2', { class: 'caps group-title' }, 'Archived projects'),
    archived.map((p) => h('div', { class: 'row' },
      h('span', { class: 'grow' }, p.name),
      h('button', { type: 'button', class: 'btn btn-sm', on: { click: () => store.put('project', { ...p, archived: false }) } }, 'Restore'))));
}

export function tileCard(t, { compact, focusId, byId, showProject }) {
  const prog = subtaskProgress(t);
  const blocked = isBlocked(t, byId);
  const now = store.now();
  const over = overBy(t, now);
  const project = showProject ? store.projectById().get(t.projectId) : null;
  const spent = elapsedSec(t, now);
  const meta = [];
  if (project) meta.push(h('span', { class: 'tag' }, project.name));
  if (blocked) meta.push(h('span', { class: 'tag tag-blocked' }, 'Blocked'));
  if (t.subtasks.length) meta.push(h('span', null, `${prog.done}/${prog.total} steps`));
  if (t.estimateMin || spent) meta.push(h('span', { class: over != null && over > 0 ? 'over' : null }, t.estimateMin ? `${fmtDuration(spent)} of ${fmtDuration(t.estimateMin * 60)}` : fmtDuration(spent)));
  if (t.timerStart) meta.push(h('span', { class: 'tag tag-ok' }, 'Timing'));
  return h('div', {
    class: `tile${compact ? ' tile-compact' : ''}${focusId === t.id ? ' is-focus' : ''}${blocked ? ' is-blocked' : ''}`,
    dataset: { tile: t.id }, role: 'button', tabIndex: 0, 'aria-label': t.title,
    on: {
      click: () => openTileSheet(t.id),
      keydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openTileSheet(t.id); } },
    },
  },
    h('div', { class: 'row' },
      h('div', { class: 'tile-title grow' }, t.title),
      focusId === t.id ? h('span', { class: 'tag tag-accent' }, 'Focus')
        : h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Make this today\'s focus', title: 'Make today\'s focus', on: { click: (e) => { e.stopPropagation(); actions.setFocus(t.id); toast('Set as today\'s focus.'); } } }, icon('target'))),
    meta.length ? h('div', { class: 'tile-meta' }, meta) : null);
}

function openNewProject() {
  const templates = store.templates();
  const name = h('input', { class: 'input', type: 'text', maxLength: 200, placeholder: 'Project name', autocomplete: 'off' });
  const tpl = h('select', { class: 'input' }, h('option', { value: '' }, 'Blank project'),
    templates.map((t) => h('option', { value: t.id }, `${t.name} (${t.tiles.length} tiles)`)));
  openSheet({
    title: 'New project',
    onSave: () => {
      const label = name.value.trim();
      if (!label) { name.focus(); return false; }
      const project = newProject(label, store.now());
      const entries = [{ kind: 'project', id: project.id, data: project }];
      const template = templates.find((t) => t.id === tpl.value);
      if (template) {
        const t0 = store.now();
        template.tiles.forEach((row, i) => {
          const tile = newTile({ title: row.title, projectId: project.id, lane: 'active', status: null, order: t0 + i }, t0);
          entries.push({ kind: 'tile', id: tile.id, data: tile });
        });
      }
      store.putMany(entries);
      ui.expandedProjects[project.id] = true;
    },
    build: (body) => { body.append(field('Name', name), field('Start from', tpl, templates.length ? null : 'No templates yet. Add some in Settings.')); },
  });
}

function projectMenu(p, tileCount) {
  openMenu([
    { label: 'Rename', icon: icon('edit'), onClick: () => renameProject(p) },
    { label: 'Archive project', icon: icon('archive'), onClick: () => { store.put('project', { ...p, archived: true }); toast('Project archived.'); } },
    '-',
    { label: 'Delete project', icon: icon('trash'), onClick: () => confirmSheet({
      title: 'Delete project', confirmLabel: 'Delete',
      message: `Delete "${p.name}" and its ${tileCount} open tile${tileCount === 1 ? '' : 's'}? Archived tiles stay in the archive.`,
      onConfirm: () => {
        for (const t of store.tiles()) if (t.projectId === p.id && t.lane !== 'archive') actions.deleteTile(t.id);
        store.remove('project', p.id);
      } }) },
  ]);
}

function renameProject(p) {
  const name = h('input', { class: 'input', type: 'text', value: p.name, maxLength: 200 });
  openSheet({
    title: 'Rename project',
    onSave: () => { const v = name.value.trim(); if (!v) return false; store.put('project', { ...p, name: v }); },
    build: (body) => body.append(field('Name', name)),
  });
}
