// Quick capture: a title-only box that never takes you out of the current view.
// Enter saves and keeps the box open for the next idea; Escape closes it.

import { h, $ } from './dom.js';
import { icon } from './icons.js';
import * as actions from './actions.js';
import { ui } from './ui.js';

export function fab() {
  return h('button', { type: 'button', class: 'fab', 'aria-label': 'Capture an idea', on: { click: openCapture } }, icon('plus'), 'Capture');
}

export function closeCapture() {
  ui.capture = false;
  for (const el of document.querySelectorAll('#overlay .capture, #overlay .capture-scrim')) el.remove();
}

export function openCapture() {
  if (ui.capture) { const i = $('#overlay .capture input'); if (i) i.focus(); return; }
  ui.capture = true;
  const host = $('#overlay');
  const hint = h('p', { class: 'capture-hint' }, 'Enter saves it to your inbox. Escape closes. Back to what you were doing.');
  const input = h('input', { class: 'input', type: 'text', placeholder: 'What just popped into your head?', maxLength: 500, enterKeyHint: 'done', autocomplete: 'off', 'aria-label': 'Idea title' });
  const save = () => {
    const tile = actions.capture(input.value);
    if (!tile) return;
    input.value = '';
    hint.replaceChildren('Captured ', h('b', null, tile.title.length > 60 ? `${tile.title.slice(0, 57)}...` : tile.title), '. Type another, or press Escape.');
    input.focus();
  };
  const bar = h('div', { class: 'capture', role: 'dialog', 'aria-label': 'Capture an idea' },
    h('form', { on: { submit: (e) => { e.preventDefault(); save(); } } },
      input,
      h('button', { type: 'submit', class: 'btn btn-primary' }, 'Save'),
      h('button', { type: 'button', class: 'btn', on: { click: closeCapture } }, 'Done')),
    hint);
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); closeCapture(); } });
  const scrim = h('div', { class: 'scrim capture-scrim', on: { click: closeCapture } });
  host.append(scrim, bar);
  input.focus();
}
