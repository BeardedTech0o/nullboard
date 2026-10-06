// Boot sequence: resolve auth first, then show either the app or a sign-in
// screen. The page stays invisible (body opacity 0) until that is settled.

import { $, h, nextFrames, clear } from './dom.js';
import { api, ApiError } from './api.js';
import * as store from './store.js';
import * as session from './session.js';
import * as shell from './shell.js';
import { applyPrefs } from './appearance.js';
import { showLogin, showReset } from './auth-ui.js';
import { openPanel } from './panel.js';
import { toast, closeSheet, closeMenu, ui } from './ui.js';
import { closeCapture } from './capture.js';

const ready = () => document.body.classList.add('ready');

// ── iOS: the GPU can leave a stale or blank frame after the app is
//    backgrounded. A translateZ(0) toggle across two frames forces a repaint.
function repaint() {
  const el = document.getElementById('app');
  if (!el) return;
  el.style.setProperty('transform', 'translateZ(0)');
  nextFrames(() => el.style.removeProperty('transform'));
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) repaint(); });
window.addEventListener('pageshow', (e) => { if (e.persisted) repaint(); });
window.addEventListener('focus', repaint);

// ── Service worker ──────────────────────────────────────────────────────────
function registerWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/sw.js').then((reg) => {
    reg.addEventListener('updatefound', () => {
      const incoming = reg.installing;
      if (!incoming) return;
      incoming.addEventListener('statechange', () => {
        if (incoming.state === 'installed' && navigator.serviceWorker.controller) {
          toast('A new version is ready.', { label: 'Reload', fn: () => location.reload() }, 15000);
        }
      });
    });
  }).catch(() => { /* private mode or unsupported: the app still works */ });
}

// ── Signed in ───────────────────────────────────────────────────────────────
let prefsWired = false;

async function enter(user, recoveryLeft, { login }) {
  session.setUser(user, recoveryLeft);
  try { localStorage.setItem('nb:last-email', user.email); } catch { /* ignore */ }
  store.init(user.id);
  store.onAuthLost(() => session.end('Your session ended. Sign in again.'));
  if (!prefsWired) {
    prefsWired = true;
    store.subscribe((source) => { if (source !== 'status' && session.current()) applyPrefs(store.prefs()); });
  }

  if (store.hasPrefs()) {
    applyPrefs(store.prefs());
    store.sync();                    // refresh in the background
  } else {
    clear($('#app'));
    $('#app').appendChild(h('p', { class: 'empty view' }, 'Loading your board…'));
    ready();
    await store.sync();
    if (!store.hasPrefs()) store.setPrefs({});   // first ever run: store the defaults
    applyPrefs(store.prefs());
  }
  store.startAutoSync();
  store.touchToday();
  shell.start();
  ready();

  const prefs = store.prefs();
  if (login || prefs.lastPanelDay !== store.today()) {
    store.setPrefs({ lastPanelDay: store.today() });
    openPanel();
  }
}

function onSignedIn(user, info = {}) {
  location.hash = '';
  enter(user, info.recoveryRemaining ?? 10, { login: true }).then(() => {
    if (info.recoveryUsed) toast(`Recovery code used. ${info.recoveryRemaining} left. Make new ones in Settings.`, null, 8000);
  });
}

session.onSignedOut((message) => {
  shell.stop();
  closeSheet(); closeMenu(); closeCapture();
  ui.panelOpen = false;
  clear($('#overlay'));
  history.replaceState(null, '', location.pathname);
  showLogin(onSignedIn, message);
  ready();
});

async function boot() {
  registerWorker();

  // Reset links look like /?reset=TOKEN. Take the token out of the address bar
  // straight away so it cannot leak through history or screenshots.
  const resetToken = new URLSearchParams(location.search).get('reset');
  if (resetToken) {
    history.replaceState(null, '', location.pathname);
    showReset(resetToken, onSignedIn);
    ready();
    return;
  }

  try {
    const me = await api('GET', '/api/auth/me');
    await enter(me.user, me.recovery_remaining, { login: false });
  } catch (err) {
    if (err instanceof ApiError && err.status === 0) {
      // Offline: fall back to this device's cache if there is one.
      const id = store.lastUser();
      let email = '';
      try { email = localStorage.getItem('nb:last-email') || ''; } catch { /* ignore */ }
      if (id && store.hasCache(id)) {
        await enter({ id, email }, 0, { login: false });
        toast('Offline. Showing what is saved on this device.');
        return;
      }
      showLogin(onSignedIn, 'You are offline. Connect to sign in.');
    } else {
      // The session is gone, or the user no longer exists: wipe this device.
      store.wipeLocal();
      history.replaceState(null, '', location.pathname);
      showLogin(onSignedIn, err instanceof ApiError && err.status === 401 ? null : 'Could not reach the server. Try again shortly.');
    }
    ready();
  }
}

boot();
