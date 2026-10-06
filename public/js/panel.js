// Daily checklist: a right-hand slide-out. Items are editable; ticks are kept
// per day, so the list starts clean every morning.

import { h, clear, $, nextFrames } from './dom.js';
import { icon } from './icons.js';
import * as store from './store.js';
import { ui } from './ui.js';
import { uid, computeStreak, isBlocked, DEFAULT_CHECKLIST } from './model.js';

let editing = false;

function hintFor(id) {
  const tiles = store.tiles();
  const byId = store.tileById();
  switch (id) {
    case 'review-inbox': { const n = tiles.filter((t) => t.lane === 'inbox').length; return n ? `${n} in the inbox` : 'Inbox is clear'; }
    case 'review-blockers': { const n = tiles.filter((t) => t.lane === 'active' && isBlocked(t, byId)).length; return n ? `${n} blocked` : 'Nothing blocked'; }
    case 'pick-focus': { const f = store.prefs().focus; const t = f && byId.get(f.tileId); return t ? `Focus: ${t.title}` : 'No focus chosen yet'; }
    case 'update-streak': { const s = computeStreak(store.days(), store.today()); return s.current ? `${s.current} day${s.current === 1 ? '' : 's'} in a row` : 'No run yet'; }
    default: return null;
  }
}

export function closePanel() {
  ui.panelOpen = false;
  editing = false;
  const panel = $('#overlay .panel');
  const scrim = $('#overlay .panel-scrim');
  if (panel) {
    panel.classList.remove('open');
    setTimeout(() => { panel.remove(); if (scrim) scrim.remove(); }, 260);
  }
  if (scrim) scrim.remove();
}

export function openPanel() {
  if (ui.panelOpen) return;
  ui.panelOpen = true;
  const host = $('#overlay');
  const scrim = h('div', { class: 'scrim panel-scrim', on: { click: closePanel } });
  const panel = h('aside', { class: 'panel', role: 'dialog', 'aria-label': 'Daily checklist' });
  host.append(scrim, panel);
  paintPanel();
  nextFrames(() => panel.classList.add('open'));
}

export function refreshPanel() {
  if (!ui.panelOpen) return;
  const active = document.activeElement;
  if (editing && active && active.closest && active.closest('.panel')) return;   // do not yank an input out from under the user
  paintPanel();
}

function paintPanel() {
  const panel = $('#overlay .panel');
  if (!panel) return;
  const prefs = store.prefs();
  const items = prefs.checklist;
  const ticked = new Set(store.todayRecord().ticked);
  const doneCount = items.filter((i) => ticked.has(i.id)).length;
  clear(panel);
  panel.append(
    h('div', { class: 'panel-head' },
      h('div', null,
        h('h2', { class: 'caps' }, 'Today'),
        h('p', { class: 'small muted' }, `${new Date(store.now()).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}  ·  ${doneCount} of ${items.length}`)),
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': editing ? 'Finish editing' : 'Edit checklist', on: { click: () => { editing = !editing; paintPanel(); } } }, icon(editing ? 'check' : 'edit')),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close checklist', on: { click: closePanel } }, icon('x')))),
    h('div', { class: 'panel-body' }, editing ? editList(items, prefs) : tickList(items, ticked)));
}

function tickList(items, ticked) {
  if (!items.length) return h('p', { class: 'empty' }, 'Your checklist is empty. Use the pencil to add items.');
  return h('div', null, items.map((it) => {
    const done = ticked.has(it.id);
    const hint = hintFor(it.id);
    return h('div', { class: `check-item${done ? ' is-done' : ''}` },
      h('button', { type: 'button', class: 'tick', role: 'checkbox', 'aria-checked': String(done), 'aria-label': it.label, on: { click: () => store.toggleChecklistItem(it.id) } }, icon('check')),
      h('div', { class: 'label' }, h('div', null, it.label), hint ? h('div', { class: 'check-hint' }, hint) : null));
  }));
}

function editList(items, prefs) {
  const save = (next) => store.setPrefs({ checklist: next });
  const add = h('input', { class: 'input', type: 'text', placeholder: 'Add an item', maxLength: 120, enterKeyHint: 'done', 'aria-label': 'New checklist item' });
  const addIt = () => {
    const label = add.value.trim();
    if (!label) return;
    add.value = '';
    save([...prefs.checklist, { id: uid('chk'), label }]);
  };
  add.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addIt(); } });
  return h('div', null,
    items.map((it, i) => {
      const input = h('input', { class: 'input', type: 'text', value: it.label, maxLength: 120, 'aria-label': 'Checklist item' });
      input.addEventListener('change', () => {
        const label = input.value.trim();
        if (!label) { input.value = it.label; return; }
        save(prefs.checklist.map((c) => (c.id === it.id ? { ...c, label } : c)));
      });
      return h('div', { class: 'sub-row' },
        input,
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Move up', disabled: i === 0, on: { click: () => { const n = [...prefs.checklist]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; save(n); } } }, icon('up')),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Remove item', on: { click: () => save(prefs.checklist.filter((c) => c.id !== it.id)) } }, icon('x')));
    }),
    h('div', { class: 'add-row' }, add, h('button', { type: 'button', class: 'btn', on: { click: addIt } }, 'Add')),
    h('button', { type: 'button', class: 'btn btn-sm btn-ghost', on: { click: () => save(DEFAULT_CHECKLIST.map((c) => ({ ...c }))) } }, 'Reset to defaults'));
}
