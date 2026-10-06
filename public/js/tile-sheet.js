// The tile editor sheet. Edits a draft copy and writes it only on Save.

import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { openSheet, closeSheet, field, confirmSheet, toast } from './ui.js';
import * as store from './store.js';
import * as actions from './actions.js';
import { uid, parseDuration, fmtDuration, STATUS_LABEL } from './model.js';

const CHIPS = [['15m', 15], ['30m', 30], ['1h', 60], ['2h', 120], ['4h', 240]];

export function openTileSheet(tileId) {
  const original = store.get('tile', tileId);
  if (!original) return;
  const draft = structuredClone(original);
  const others = store.tiles().filter((t) => t.id !== tileId && t.lane !== 'archive');

  const titleInput = h('input', { class: 'input', type: 'text', value: draft.title, maxLength: 500, autocomplete: 'off' });
  const laneSelect = h('select', { class: 'input', on: { change: () => { draft.lane = laneSelect.value; syncVisibility(); } } },
    [['inbox', 'Inbox'], ['someday', 'Someday/Maybe'], ['active', 'Board'], ...(draft.lane === 'archive' ? [['archive', 'Archive']] : [])].map(([v, l]) => h('option', { value: v, selected: draft.lane === v }, l)));
  const projectSelect = h('select', { class: 'input' },
    h('option', { value: '' }, 'No project'),
    store.projects().filter((p) => !p.archived).sort((a, b) => a.order - b.order).map((p) => h('option', { value: p.id, selected: draft.projectId === p.id }, p.name)));
  const statusSelect = h('select', { class: 'input' },
    h('option', { value: '' }, 'Unplaced'),
    ['todo', 'inprogress', 'signoff'].map((s) => h('option', { value: s, selected: draft.status === s }, STATUS_LABEL[s])));
  const statusField = field('Column', statusSelect);
  const projectField = field('Project', projectSelect);

  const estimateInput = h('input', { class: 'input', type: 'text', inputMode: 'text', placeholder: 'e.g. 1h 30m', value: draft.estimateMin ? fmtDuration(draft.estimateMin * 60) : '' });
  const spentInput = h('input', { class: 'input', type: 'text', placeholder: '0m', value: draft.spentSec ? fmtDuration(draft.spentSec) : '' });
  const chips = h('div', { class: 'row' }, CHIPS.map(([label, mins]) =>
    h('button', { type: 'button', class: 'btn btn-sm', on: { click: () => { estimateInput.value = label; } } }, label)));

  const blockedBox = h('input', { type: 'checkbox', id: 'blocked-box', checked: draft.blocked, on: { change: () => syncVisibility() } });
  const blockerSelect = h('select', { class: 'input' },
    h('option', { value: '' }, 'Something outside the board'),
    others.map((t) => h('option', { value: t.id, selected: draft.blockedBy === t.id }, t.title.slice(0, 80))));
  const noteInput = h('input', { class: 'input', type: 'text', placeholder: 'What is it waiting for?', value: draft.blockedNote || '', maxLength: 300 });
  const blockedFields = h('div', { class: 'stack' }, field('Waiting on', blockerSelect), field('Note', noteInput));

  const subsHost = h('div');
  const renderSubs = () => {
    clear(subsHost);
    draft.subtasks.forEach((s, i) => {
      const text = h('input', { class: 'input', type: 'text', value: s.text, maxLength: 500, on: { input: () => { s.text = text.value; } } });
      subsHost.appendChild(h('div', { class: 'sub-row' },
        h('button', { type: 'button', class: 'tick tick-sm', role: 'checkbox', 'aria-checked': String(!!s.done), 'aria-label': 'Done', on: { click: () => { s.done = !s.done; renderSubs(); } } }, icon('check')),
        text,
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Remove step', on: { click: () => { draft.subtasks.splice(i, 1); renderSubs(); } } }, icon('x'))));
    });
  };
  const newSub = h('input', { class: 'input', type: 'text', placeholder: 'Add a step', maxLength: 500, enterKeyHint: 'done' });
  const addSub = () => {
    const v = newSub.value.trim();
    if (!v) return;
    draft.subtasks.push({ id: uid('sub'), text: v, done: false });
    newSub.value = '';
    renderSubs();
    newSub.focus();
  };
  newSub.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addSub(); } });

  const notesHost = h('div');
  const renderNotes = () => {
    clear(notesHost);
    draft.notes.forEach((n, i) => {
      notesHost.appendChild(h('div', { class: 'sub-row' },
        h('div', { class: 'note grow' }, n.text),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Remove note', on: { click: () => { draft.notes.splice(i, 1); renderNotes(); } } }, icon('x'))));
    });
  };
  const newNote = h('textarea', { class: 'input', rows: 2, placeholder: 'Add a note', maxLength: 5000 });
  const addNoteBtn = h('button', { type: 'button', class: 'btn btn-sm', on: { click: () => {
    const v = newNote.value.trim();
    if (!v) return;
    draft.notes.push({ id: uid('note'), text: v, at: store.now() });
    newNote.value = '';
    renderNotes();
  } } }, 'Add note');

  function syncVisibility() {
    statusField.hidden = draft.lane !== 'active';
    projectField.hidden = draft.lane === 'someday';
    blockedFields.hidden = !blockedBox.checked;
  }


  openSheet({
    title: 'Edit tile',
    onSave: () => {
      const title = titleInput.value.trim();
      if (!title) { titleInput.focus(); return false; }
      const est = parseDuration(estimateInput.value);
      const spent = spentInput.value.trim() === '' ? 0 : parseDuration(spentInput.value);
      store.patchTile(tileId, (t) => {
        t.title = title.slice(0, 500);
        t.lane = draft.lane;
        t.projectId = draft.lane === 'active' || draft.lane === 'inbox' ? (projectSelect.value || null) : t.projectId;
        t.status = draft.lane === 'active' ? (statusSelect.value || null) : (draft.lane === 'archive' ? t.status : null);
        t.estimateMin = est;
        if (spent != null && spent * 60 !== Math.round(t.spentSec / 60) * 60) t.spentSec = spent * 60;
        t.subtasks = draft.subtasks.filter((s) => s.text.trim());
        t.notes = draft.notes.filter((n) => n.text.trim());
        t.blocked = blockedBox.checked;
        t.blockedBy = blockedBox.checked ? (blockerSelect.value || null) : null;
        t.blockedNote = blockedBox.checked ? noteInput.value.trim().slice(0, 300) : '';
        if (t.lane !== 'active' && store.prefs().focus?.tileId === t.id) store.setPrefs({ focus: null });
      });
      store.touchToday();
    },
    build: (body) => {
      body.append(
      field('Title', titleInput),
      h('div', { class: 'field-row' }, field('Where it lives', laneSelect), projectField),
      statusField,
      h('div', { class: 'field-row' }, field('Estimate', estimateInput), field('Time spent', spentInput)),
      chips,
      h('div', { class: 'check-row' }, blockedBox, h('label', { htmlFor: 'blocked-box' }, 'Blocked: this cannot move until something else happens')),
      blockedFields,
      h('div', { class: 'field' }, h('label', null, 'Steps'), subsHost, h('div', { class: 'add-row' }, newSub, h('button', { type: 'button', class: 'btn', on: { click: addSub } }, 'Add'))),
      h('div', { class: 'field' }, h('label', null, 'Notes'), notesHost, newNote, h('div', { class: 'spacer' }), addNoteBtn),
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn btn-sm', on: { click: () => { closeSheet(); actions.setFocus(tileId); toast('Set as today\'s focus.'); } } }, 'Make today\'s focus'),
        h('button', { type: 'button', class: 'btn btn-sm', on: { click: () => { closeSheet(); actions.completeTile(tileId); } } }, 'Complete and archive'),
        h('button', { type: 'button', class: 'btn btn-sm btn-ghost', on: { click: () => { closeSheet(); actions.dropTile(tileId); } } }, 'Drop'),
        h('button', { type: 'button', class: 'btn btn-sm btn-ghost btn-danger', on: { click: () => confirmSheet({
          title: 'Delete tile', message: 'Delete this tile for good? Dropping it keeps a copy in the archive instead.',
          confirmLabel: 'Delete', onConfirm: () => actions.deleteTile(tileId) }) } }, 'Delete')));

      renderSubs();
      renderNotes();
      syncVisibility();
    },
  });
}
