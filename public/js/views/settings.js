// Settings: appearance, templates, sync, account, data.

import { h } from '../dom.js';
import * as store from '../store.js';
import * as session from '../session.js';
import { api, ApiError } from '../api.js';
import { applyPrefs } from '../appearance.js';
import { recoveryBlock } from '../auth-ui.js';
import { openSheet, confirmSheet, field, navigate, toast } from '../ui.js';
import { FONT_SIZES, DEFAULT_CHECKLIST, uid } from '../model.js';

const rerender = () => document.dispatchEvent(new Event('nb:render'));

function seg(name, label, options, current, onChange) {
  return h('div', { class: 'seg', role: 'radiogroup', 'aria-label': label }, options.map(([value, text]) =>
    h('label', { class: 'seg-opt' }, h('input', { type: 'radio', name, value, checked: current === value, on: { change: () => onChange(value) } }), text)));
}

const section = (title, ...kids) => h('section', null, h('div', { class: 'section-head' }, h('h2', { class: 'caps' }, title)), h('div', { class: 'stack' }, kids));

export function renderSettings() {
  const prefs = store.prefs();
  const me = session.current();
  return h('div', { class: 'view-narrow' },
    h('div', { class: 'page-head' }, h('h1', null, 'Settings')),
    section('Appearance',
      field('Theme', seg('theme', 'Theme', [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']], prefs.theme, (v) => { store.setPrefs({ theme: v }); applyPrefs(store.prefs()); })),
      field('Text size', seg('fontsize', 'Text size', FONT_SIZES.map((f) => [f.key, f.label]), prefs.fontSize, (v) => { store.setPrefs({ fontSize: v }); applyPrefs(store.prefs()); }))),
    section('Daily checklist',
      h('p', { class: 'muted small' }, 'Edit the list from the checklist panel (the list icon in the top bar). Ticks reset every day.'),
      h('div', null, h('button', { type: 'button', class: 'btn btn-sm', on: { click: () => confirmSheet({
        title: 'Reset checklist', message: 'Replace your checklist with the four defaults?', confirmLabel: 'Reset',
        onConfirm: () => store.setPrefs({ checklist: DEFAULT_CHECKLIST.map((c) => ({ ...c })) }) }) } }, 'Reset to defaults'))),
    section('Templates', templatesList()),
    section('Sync',
      h('p', { class: 'muted small' }, syncText()),
      h('div', null, h('button', { type: 'button', class: 'btn btn-sm', on: { click: async () => { await store.sync(); rerender(); } } }, 'Sync now'))),
    section('Account',
      h('p', null, me ? me.email : ''),
      h('p', { class: 'muted small' }, `${session.recoveryRemaining()} recovery code${session.recoveryRemaining() === 1 ? '' : 's'} left.`),
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn btn-sm', on: { click: openRegenerate } }, 'New recovery codes'),
        h('button', { type: 'button', class: 'btn btn-sm', on: { click: () => session.signOut() } }, 'Sign out'),
        h('button', { type: 'button', class: 'btn btn-sm', on: { click: () => confirmSheet({
          title: 'Sign out everywhere', message: 'This ends every session on every device, including this one.', confirmLabel: 'Sign out everywhere',
          onConfirm: () => session.signOutEverywhere() }) } }, 'Sign out everywhere'))),
    section('Data',
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn btn-sm', on: { click: exportData } }, 'Export JSON'),
        h('button', { type: 'button', class: 'btn btn-sm', on: { click: () => navigate('import') } }, 'Import from old nullboard'))));
}

function syncText() {
  const pending = store.pendingCount();
  const s = store.status;
  const state = s.state === 'offline' ? 'Offline. Changes are saved on this device and will sync when you are back online.'
    : s.state === 'error' ? `Last sync failed: ${s.message}`
    : s.lastSyncAt ? `Last synced ${new Date(s.lastSyncAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}.` : 'Not synced yet.';
  return `${state} ${pending ? `${pending} change${pending === 1 ? '' : 's'} waiting to upload.` : 'Nothing waiting.'}`;
}

function templatesList() {
  const tpls = store.templates();
  return h('div', { class: 'stack' },
    tpls.length ? tpls.map((t) => h('div', { class: 'row' },
      h('span', { class: 'grow' }, `${t.name} (${t.tiles.length} tile${t.tiles.length === 1 ? '' : 's'})`),
      h('button', { type: 'button', class: 'btn btn-sm', on: { click: () => editTemplate(t) } }, 'Edit'),
      h('button', { type: 'button', class: 'btn btn-sm btn-ghost btn-danger', on: { click: () => store.remove('template', t.id) } }, 'Delete')))
      : h('p', { class: 'muted small' }, 'No templates. A template is a reusable list of tile titles for new projects.'),
    h('div', null, h('button', { type: 'button', class: 'btn btn-sm', on: { click: () => editTemplate(null) } }, 'Add template')));
}

function editTemplate(tpl) {
  const name = h('input', { class: 'input', type: 'text', value: tpl ? tpl.name : '', maxLength: 200 });
  const lines = h('textarea', { class: 'input', rows: 8, placeholder: 'One tile title per line' });
  lines.value = tpl ? tpl.tiles.map((t) => t.title).join('\n') : '';
  openSheet({
    title: tpl ? 'Edit template' : 'New template',
    onSave: () => {
      const label = name.value.trim();
      const tiles = lines.value.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 200).map((title) => ({ title: title.slice(0, 500) }));
      if (!label || !tiles.length) { (label ? lines : name).focus(); return false; }
      store.put('template', { id: tpl ? tpl.id : uid('tpl'), name: label, tiles });
    },
    build: (body) => body.append(field('Name', name), field('Tiles', lines)),
  });
}

function openRegenerate() {
  const password = h('input', { class: 'input', type: 'password', autocomplete: 'current-password' });
  const code = h('input', { class: 'input', type: 'text', inputMode: 'numeric', autocomplete: 'one-time-code', maxLength: 7 });
  const err = h('p', { class: 'auth-error', role: 'alert', hidden: true });
  openSheet({
    title: 'New recovery codes',
    saveLabel: 'Generate',
    onSave: async (sheet) => {
      err.hidden = true;
      try {
        const res = await api('POST', '/api/auth/recovery-codes', { password: password.value, code: code.value });
        session.setRecoveryRemaining(res.recovery_codes.length);
        sheet.body.replaceChildren(h('p', { class: 'muted' }, 'These replace your old codes. They are shown only now.'), recoveryBlock(res.recovery_codes));
        sheet.saveBtn.hidden = true;
        rerender();
      } catch (e) {
        err.textContent = e instanceof ApiError ? e.message : 'Something went wrong.';
        err.hidden = false;
      }
      return false;
    },
    build: (body) => body.append(h('p', { class: 'muted small' }, 'Confirm with your password and a current authenticator code. Old codes stop working.'), err, field('Password', password), field('Code from the app', code)),
  });
}

async function exportData() {
  try {
    const res = await fetch('/api/export', { credentials: 'same-origin' });
    if (!res.ok) throw new Error('export failed');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: `nullboard-export-${store.today()}.json` });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch {
    toast('Export needs a connection. Try again when you are online.');
  }
}
