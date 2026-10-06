// The signed-in app frame: top bar, navigation, the current view, capture
// button. Re-renders on every store change, keeping scroll positions and
// never rebuilding the page underneath someone who is typing.

import { h, clear, $ } from './dom.js';
import { icon } from './icons.js';
import * as store from './store.js';
import * as session from './session.js';
import { currentRoute, navigate, ui, openMenu, closeMenu, sheetOpen } from './ui.js';
import { fab, openCapture } from './capture.js';
import { isDragging, afterDrag } from './dnd.js';
import { openPanel, refreshPanel } from './panel.js';
import { renderFocus } from './views/focus.js';
import { renderBoard } from './views/board.js';
import { renderInbox, renderSomeday, renderArchive } from './views/lists.js';
import { renderStreak } from './views/streak.js';
import { renderReview } from './views/review.js';
import { renderSettings } from './views/settings.js';
import { renderImport } from './views/import.js';
import { reviewDue } from './model.js';

const VIEWS = {
  focus: renderFocus, board: renderBoard, inbox: renderInbox, someday: renderSomeday,
  archive: renderArchive, streak: renderStreak, review: renderReview, settings: renderSettings, import: renderImport,
};
const BOARD_LIKE = new Set(['board']);

let active = false;
let dirty = false;
let raf = 0;
let timerTick = 0;

export function start() {
  if (active) { render(); return; }
  active = true;
  store.subscribe((source) => {
    if (!active) return;
    if (source === 'status') { paintStatus(); return; }
    schedule(source);
  });
  document.addEventListener('nb:render', () => { if (active) schedule('local'); });
  window.addEventListener('hashchange', () => { closeMenu(); ui.sidebarOpen = false; if (active) schedule('local'); });
  document.addEventListener('focusout', () => { if (dirty) setTimeout(() => { if (dirty && !typing()) { dirty = false; schedule('local'); } }, 50); });
  document.addEventListener('keydown', onKey);
  timerTick = setInterval(() => {
    if (active && !typing() && !sheetOpen() && store.tiles().some((t) => t.timerStart)) render();
  }, 20000);
  render();
}

export function stop() {
  active = false;
  clearInterval(timerTick);
}

function typing() {
  const a = document.activeElement;
  return !!a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && !!a.closest('#app') && a.type !== 'radio' && a.type !== 'checkbox';
}

function schedule(source) {
  // A change that arrived from another device must not wipe what is being typed.
  if (source === 'remote' && typing()) { dirty = true; return; }
  if (isDragging()) { afterDrag(() => schedule(source)); return; }
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(() => { render(); refreshPanel(); });
}

function onKey(e) {
  if (!active || e.metaKey || e.ctrlKey || e.altKey) return;
  const a = document.activeElement;
  if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;
  if (sheetOpen()) return;
  if (e.key === 'c') { e.preventDefault(); openCapture(); }
}

function paintStatus() {
  const dot = $('.sync-dot');
  if (!dot) return;
  const s = store.status.state;
  dot.dataset.status = s === 'idle' ? 'ok' : s === 'syncing' ? 'warn' : 'err';
  dot.title = s === 'idle' ? 'Synced' : s === 'syncing' ? 'Syncing' : s === 'offline' ? 'Offline: changes are saved on this device' : 'Sync problem';
}

function saveScroll(app) {
  const map = {};
  for (const el of app.querySelectorAll('[data-scroll-key]')) map[el.dataset.scrollKey] = el.scrollTop + ':' + el.scrollLeft;
  const view = $('.view', app);
  if (view) map.__view = view.scrollTop + ':0';
  return map;
}

function restoreScroll(app, map) {
  for (const el of app.querySelectorAll('[data-scroll-key]')) {
    const v = map[el.dataset.scrollKey];
    if (v) { const [t, l] = v.split(':').map(Number); el.scrollTop = t; el.scrollLeft = l; }
  }
  const view = $('.view', app);
  if (view && map.__view) view.scrollTop = Number(map.__view.split(':')[0]);
}

export function render() {
  if (!active) return;
  const app = $('#app');
  const prefs = store.prefs();
  const route = currentRoute(prefs.view === 'board' ? 'board' : 'focus');
  const scroll = saveScroll(app);
  // Inputs marked data-keep get focus (and caret) back after the rebuild, so
  // adding several tiles or steps in a row never needs a second tap.
  const focused = document.activeElement;
  const keep = focused && focused.dataset && focused.dataset.keep ? focused.dataset.keep : null;
  const caret = keep && typeof focused.selectionStart === 'number' ? [focused.selectionStart, focused.selectionEnd] : null;

  clear(app);
  app.appendChild(topbar(route, prefs));
  if (route !== 'focus') app.appendChild(subnav(route));
  const body = VIEWS[route]();
  app.appendChild(BOARD_LIKE.has(route) ? body : h('main', { class: 'view', id: 'main' }, body));
  app.appendChild(fab());
  paintStatus();
  restoreScroll(app, scroll);
  if (keep) {
    const el = $(`[data-keep="${keep}"]`, app);
    if (el) { el.focus(); if (caret) { try { el.setSelectionRange(caret[0], caret[1]); } catch { /* not a text input */ } } }
  }
  const title = { focus: 'Focus', board: 'Board', inbox: 'Inbox', someday: 'Someday/Maybe', archive: 'Archive', streak: 'Streak', review: 'Weekly review', settings: 'Settings', import: 'Import' }[route];
  document.title = `${title} · nullboard`;
}

function topbar(route, prefs) {
  const ticked = new Set(store.todayRecord().ticked);
  const left = prefs.checklist.filter((i) => !ticked.has(i.id)).length;
  const inFocusPair = route === 'focus' || route === 'board';
  const setView = (v) => { store.setPrefs({ view: v }); navigate(v); };
  return h('header', { class: 'topbar' },
    route === 'board' ? h('button', { type: 'button', class: 'icon-btn only-mobile', 'aria-label': 'Show projects', on: { click: () => { ui.sidebarOpen = true; render(); } } }, icon('folder')) : null,
    h('button', { type: 'button', class: 'brand brand-btn', on: { click: () => navigate(prefs.view === 'board' ? 'board' : 'focus') } }, 'nullboard'),
    h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'View' }, [['focus', 'Focus'], ['board', 'Board']].map(([key, label]) =>
      h('label', { class: 'seg-opt' }, h('input', { type: 'radio', name: 'view', value: key, checked: inFocusPair && route === key, on: { change: () => setView(key) } }), label))),
    h('div', { class: 'topbar-actions' },
      h('span', { class: 'status-dot sync-dot', 'aria-hidden': 'true' }),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Daily checklist, ${left} left`, on: { click: openPanel } }, icon('list'), left ? h('span', { class: 'badge' }, left) : null),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Menu', on: { click: () => openMainMenu() } }, icon('more'))));
}

function subnav(route) {
  const tiles = store.tiles();
  const inbox = tiles.filter((t) => t.lane === 'inbox').length;
  const link = (key, label, count) => h('a', { href: `#/${key}`, 'aria-current': route === key ? 'page' : null }, label, count ? h('span', { class: 'count' }, count) : null);
  return h('nav', { class: 'subnav', 'aria-label': 'Sections' },
    link('inbox', 'Inbox', inbox),
    link('someday', 'Someday/Maybe'),
    link('archive', 'Archive'),
    link('streak', 'Streak'),
    link('review', 'Review', reviewDue(store.prefs(), store.now()) ? '!' : null));
}

function openMainMenu() {
  const me = session.current();
  openMenu([
    { label: 'Inbox', icon: icon('inbox'), onClick: () => navigate('inbox') },
    { label: 'Someday/Maybe', icon: icon('moon'), onClick: () => navigate('someday') },
    { label: 'Archive', icon: icon('archive'), onClick: () => navigate('archive') },
    { label: 'Streak', icon: icon('flame'), onClick: () => navigate('streak') },
    { label: 'Weekly review', icon: icon('repeat'), onClick: () => navigate('review') },
    '-',
    { label: 'Settings', icon: icon('gear'), onClick: () => navigate('settings') },
    { label: me ? `Sign out (${me.email})` : 'Sign out', icon: icon('logout'), onClick: () => session.signOut() },
  ]);
}
