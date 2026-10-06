// Import from the old standalone nullboard (its localStorage JSON) or from a
// nullboard export. Ids are kept, so running it twice updates, never duplicates.

import { h } from '../dom.js';
import * as store from '../store.js';
import { parseImport } from '../model.js';
import { navigate, toast } from '../ui.js';
import { applyPrefs } from '../appearance.js';

const SNIPPET = "copy(localStorage.getItem('ashcombe-kanban-v1'))";
const CHUNK = 200;

export function renderImport() {
  const text = h('textarea', { class: 'input', rows: 8, placeholder: 'Paste the JSON here', spellcheck: false, 'aria-label': 'Exported JSON' });
  const file = h('input', { type: 'file', accept: '.json,application/json,text/plain', 'aria-label': 'Choose a JSON file' });
  const result = h('div', { class: 'stack' });
  const run = h('button', { type: 'button', class: 'btn btn-primary', disabled: true }, 'Import');
  let parsed = null;

  const check = () => {
    result.replaceChildren();
    parsed = null;
    run.disabled = true;
    if (!text.value.trim()) return;
    try {
      parsed = parseImport(text.value, store.now());
      const c = parsed.counts;
      result.appendChild(h('p', null, `Found ${c.project} project${c.project === 1 ? '' : 's'}, ${c.tile} tile${c.tile === 1 ? '' : 's'} and ${c.template} template${c.template === 1 ? '' : 's'}.`));
      run.disabled = !parsed.records.length;
    } catch (e) {
      result.appendChild(h('p', { class: 'auth-error', role: 'alert' }, e.message));
    }
  };
  text.addEventListener('input', check);
  file.addEventListener('change', async () => {
    const f = file.files[0];
    if (!f) return;
    if (f.size > 20 * 1024 * 1024) { result.replaceChildren(h('p', { class: 'auth-error' }, 'That file is too large.')); return; }
    text.value = await f.text();
    check();
  });

  run.addEventListener('click', async () => {
    if (!parsed) return;
    run.disabled = true;
    run.textContent = 'Importing…';
    const records = parsed.records;
    for (let i = 0; i < records.length; i += CHUNK) {
      store.putMany(records.slice(i, i + CHUNK));
      await store.sync();
    }
    if (parsed.fontSize) { store.setPrefs({ fontSize: parsed.fontSize }); applyPrefs(store.prefs()); }
    toast(`Imported ${records.length} items.`);
    navigate('board');
  });

  return h('div', { class: 'view-narrow' },
    h('div', { class: 'page-head' }, h('h1', null, 'Import')),
    h('p', null, 'Bring your boards over from the standalone nullboard. Nothing is deleted, and importing twice does not duplicate anything.'),
    h('ol', { class: 'stack' },
      h('li', null, 'Open your old nullboard in its browser tab, then open the developer console.'),
      h('li', null, ['Run ', h('code', null, SNIPPET), ' to copy your data.']),
      h('li', null, 'Paste it below, or save it as a .json file and choose that file.')),
    h('div', { class: 'spacer' }),
    text,
    h('div', { class: 'row spacer' }, file),
    result,
    h('div', { class: 'row spacer' }, run, h('button', { type: 'button', class: 'btn btn-ghost', on: { click: () => navigate('settings') } }, 'Cancel')));
}
