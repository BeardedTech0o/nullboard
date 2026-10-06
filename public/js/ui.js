// Shared UI plumbing: routing, toasts, sheets (modal dialogs), menus.

import { h, clear, $ } from './dom.js';

// ── Routing (hash based, so back and forward work and the server needs no
//    knowledge of app routes) ───────────────────────────────────────────────

export const ROUTES = ['focus', 'board', 'inbox', 'someday', 'archive', 'streak', 'review', 'settings', 'import'];

export function currentRoute(fallback = 'focus') {
  const name = location.hash.replace(/^#\/?/, '').split('?')[0];
  return ROUTES.includes(name) ? name : fallback;
}

export function navigate(name) {
  if (location.hash === `#/${name}`) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = `#/${name}`;
}

// ── Transient UI state shared between views ─────────────────────────────────

export const ui = {
  sidebarOpen: false,
  projectFilter: null,
  expandedProjects: {},
  archiveFilter: 'all',
  archiveQuery: '',
  reviewStep: 0,
  menuOpen: false,
  panelOpen: false,
  capture: false,
};

// ── Toast ───────────────────────────────────────────────────────────────────

let toastTimer = null;

export function toast(message, action, ms = 4000) {
  const host = $('#overlay');
  const old = $('.toast', host);
  if (old) old.remove();
  clearTimeout(toastTimer);
  const el = h('div', { class: 'toast', role: 'status' }, h('span', null, message));
  if (action) {
    el.appendChild(h('button', { type: 'button', on: { click: () => { el.remove(); action.fn(); } } }, action.label));
  }
  host.appendChild(el);
  toastTimer = setTimeout(() => el.remove(), ms);
}

// ── Sheets ──────────────────────────────────────────────────────────────────

let activeSheet = null;

export function sheetOpen() { return !!activeSheet; }

// openSheet({ title, saveLabel, onSave, build })
//   build(body, sheet) fills the body. onSave() may return false to keep the
//   sheet open. Cancel and Save sit at the top so the keyboard never hides them.
export function openSheet({ title, saveLabel = 'Save', onSave, build, cancelLabel = 'Cancel', wide }) {
  closeSheet();
  const host = $('#overlay');
  const scrim = h('div', { class: 'scrim', on: { click: () => closeSheet() } });
  const body = h('div', { class: 'sheet-body' });
  const saveBtn = onSave ? h('button', { class: 'btn btn-primary btn-sm', type: 'button' }, saveLabel) : null;
  const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'sheet-head' },
      h('button', { class: 'btn btn-sm', type: 'button', on: { click: () => closeSheet() } }, cancelLabel),
      h('h2', null, title),
      saveBtn || h('span')),
    body);
  if (wide) sheet.style.setProperty('width', 'min(720px, 100%)');
  const api = { body, close: closeSheet, saveBtn };
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      const keepOpen = (await onSave(api)) === false;
      if (!keepOpen) closeSheet();
    });
  }
  const onKey = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); closeSheet(); }
  };
  document.addEventListener('keydown', onKey, true);
  host.append(scrim, sheet);
  activeSheet = { scrim, sheet, onKey, returnFocus: document.activeElement };
  build(body, api);
  const first = body.querySelector('input:not([type=checkbox]), textarea, select');
  if (first && !matchMedia('(pointer: coarse)').matches) first.focus();
  return api;
}

export function closeSheet() {
  if (!activeSheet) return;
  const { scrim, sheet, onKey, returnFocus } = activeSheet;
  document.removeEventListener('keydown', onKey, true);
  scrim.remove();
  sheet.remove();
  activeSheet = null;
  if (returnFocus && returnFocus.focus && document.contains(returnFocus)) returnFocus.focus();
}

export function confirmSheet({ title, message, confirmLabel = 'Confirm', danger, onConfirm }) {
  return openSheet({
    title, saveLabel: confirmLabel,
    onSave: () => onConfirm(),
    build: (body) => { body.appendChild(h('p', null, message)); },
  });
}

// ── Popup menu ──────────────────────────────────────────────────────────────

export function openMenu(items) {
  closeMenu();
  const host = $('#overlay');
  const scrim = h('div', { class: 'scrim menu-scrim', on: { click: closeMenu } });
  scrim.style.setProperty('background', 'transparent');
  const menu = h('div', { class: 'menu', role: 'menu' }, items.map((it) => {
    if (it === '-') return h('hr');
    return h('button', { type: 'button', role: 'menuitem', on: { click: () => { closeMenu(); it.onClick(); } } }, it.icon || null, it.label);
  }));
  host.append(scrim, menu);
}

export function closeMenu() {
  for (const el of document.querySelectorAll('#overlay .menu, #overlay .menu-scrim')) el.remove();
}

let fieldSeq = 0;
export function field(labelText, control, hint) {
  if (!control.id) control.id = `f-${++fieldSeq}`;
  return h('div', { class: 'field' },
    h('label', { htmlFor: control.id }, labelText), control,
    hint ? h('p', { class: 'auth-note' }, hint) : null);
}

export function replaceChildren(node, ...kids) {
  clear(node);
  for (const k of kids.flat()) if (k) node.appendChild(k);
}
