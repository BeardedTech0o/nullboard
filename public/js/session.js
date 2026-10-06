// Who is signed in, and how to stop being signed in.

import { api } from './api.js';
import * as store from './store.js';

let user = null;
let recovery = 0;
let signedOutHandler = () => {};

export const current = () => user;
export const recoveryRemaining = () => recovery;
export const setUser = (u, remaining) => { user = u; if (remaining != null) recovery = remaining; };
export const setRecoveryRemaining = (n) => { recovery = n; };
export const onSignedOut = (fn) => { signedOutHandler = fn; };

// Pushes pending edits first, so signing out never silently drops them.
export async function signOut() {
  try { await store.sync(); } catch { /* offline: fall through */ }
  if (store.pendingCount() > 0 && !window.confirm('Some changes have not synced yet and will be lost if you sign out. Sign out anyway?')) return;
  try { await api('POST', '/api/auth/logout', {}); } catch { /* cookie is cleared server side when online */ }
  end('You have been signed out.');
}

export async function signOutEverywhere() {
  try { await api('POST', '/api/auth/logout-all', {}); } catch { /* ignore */ }
  end('Signed out on every device.');
}

export function end(message) {
  store.wipeLocal();
  user = null;
  signedOutHandler(message);
}
