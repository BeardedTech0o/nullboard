// Login, registration, MFA setup, MFA challenge, password reset.
// Layout and wording follow the nullobj AuthScreen components.

import { h, clear } from './dom.js';
import { api, ApiError } from './api.js';
import { field } from './ui.js';
import { qrSvg } from './qr.js';

const root = () => document.getElementById('app');

function screen(...kids) {
  const host = root();
  clear(host);
  host.appendChild(h('div', { class: 'auth-screen' },
    h('div', { class: 'auth-wrap' }, h('div', { class: 'card auth-col' }, h('div', { class: 'auth-wordmark' }, 'nullboard'), kids))));
  const first = host.querySelector('input:not([type=checkbox]):not([type=hidden])');
  if (first && !matchMedia('(pointer: coarse)').matches) first.focus();
}

const sub = (text) => h('p', { class: 'auth-sub' }, text);
const heading = (text) => h('h1', { class: 'auth-heading' }, text);

function errorBox() {
  const el = h('p', { class: 'auth-error', role: 'alert', hidden: true });
  el.show = (msg) => { el.textContent = msg; el.hidden = false; };
  el.hide = () => { el.hidden = true; };
  return el;
}

// Wraps a form submit: disables the button, shows the error text.
function form(submitLabel, busyLabel, fields, errorEl, run) {
  const btn = h('button', { type: 'submit', class: 'btn btn-primary btn-block' }, submitLabel);
  const el = h('form', { novalidate: true, on: { submit: async (e) => {
    e.preventDefault();
    errorEl.hide();
    btn.disabled = true;
    btn.textContent = busyLabel;
    try { await run(); }
    catch (err) {
      errorEl.show(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
      btn.disabled = false;
      btn.textContent = submitLabel;
    }
  } } }, fields, h('div', { class: 'spacer' }), btn);
  return el;
}

function link(label, fn) {
  return h('button', { type: 'button', class: 'link-btn', on: { click: fn } }, label);
}

export function showLogin(onSignedIn, notice) {
  const err = errorBox();
  const email = h('input', { class: 'input', type: 'email', autocomplete: 'username', required: true, autocapitalize: 'none', spellcheck: false });
  const password = h('input', { class: 'input', type: 'password', autocomplete: 'current-password', required: true });
  screen(
    sub('Sign in to your board.'),
    notice ? h('p', { class: 'auth-note' }, notice) : null,
    err,
    form('Sign in', 'Signing in…', [field('Email', email), field('Password', password)], err, async () => {
      const res = await api('POST', '/api/auth/login', { email: email.value, password: password.value });
      if (res.needs_mfa) return showMfa(res.pending_token, onSignedIn);
      if (res.needs_mfa_setup) return showSetup(res, onSignedIn);
    }),
    h('div', { class: 'auth-linkrow' },
      link('Forgot your password?', () => showForgot(onSignedIn)),
      link('Create account', () => showRegister(onSignedIn))));
}

function showMfa(pendingToken, onSignedIn, useRecovery = false) {
  const err = errorBox();
  const code = useRecovery
    ? h('input', { class: 'input', type: 'text', autocomplete: 'off', autocapitalize: 'characters', spellcheck: false, placeholder: 'XXXXX-XXXXX', required: true })
    : h('input', { class: 'input', type: 'text', inputMode: 'numeric', autocomplete: 'one-time-code', maxLength: 7, placeholder: '123456', required: true });
  screen(
    heading('Two-factor code'),
    sub(useRecovery ? 'Enter one of your recovery codes. Each works once.' : 'Enter the six digit code from your authenticator app.'),
    err,
    form('Verify', 'Verifying…', field(useRecovery ? 'Recovery code' : 'Code', code), err, async () => {
      const body = useRecovery ? { pending_token: pendingToken, recovery_code: code.value } : { pending_token: pendingToken, code: code.value };
      const res = await api('POST', '/api/auth/mfa/verify', body);
      onSignedIn(res.user, { recoveryUsed: res.used_recovery_code, recoveryRemaining: res.recovery_remaining });
    }),
    h('div', { class: 'auth-linkrow' },
      link(useRecovery ? 'Use an authenticator code' : 'Use a recovery code', () => showMfa(pendingToken, onSignedIn, !useRecovery)),
      link('Back to sign in', () => showLogin(onSignedIn))));
}

function groupKey(secret) {
  return secret.replace(/(.{4})/g, '$1 ').trim();
}

function showSetup(info, onSignedIn) {
  const err = errorBox();
  const code = h('input', { class: 'input', type: 'text', inputMode: 'numeric', autocomplete: 'one-time-code', maxLength: 7, placeholder: '123456', required: true });
  const copy = h('button', { type: 'button', class: 'btn btn-sm', on: { click: async () => {
    try { await navigator.clipboard.writeText(info.totp_secret); copy.textContent = 'Copied'; } catch { copy.textContent = 'Select and copy'; }
  } } }, 'Copy key');
  screen(
    h('p', { class: 'auth-step' }, 'Step 1 of 2'),
    heading('Set up two-factor sign-in'),
    sub('Scan this code with an authenticator app, or type the key in by hand.'),
    h('div', { class: 'qr' }, qrSvg(info.totp_uri)),
    h('p', { class: 'auth-note' }, 'Cannot scan? In your app choose "Enter a setup key", then use this key (time based, six digits):'),
    h('div', { class: 'auth-secret', 'aria-label': 'Setup key' }, groupKey(info.totp_secret)),
    copy,
    h('div', { class: 'spacer' }),
    err,
    form('Verify and continue', 'Verifying…', field('Code from the app', code), err, async () => {
      const res = await api('POST', '/api/auth/mfa/setup', { setup_token: info.setup_token, code: code.value });
      showRecoveryCodes(res.recovery_codes, () => onSignedIn(res.user, { fresh: true }));
    }),
    h('div', { class: 'auth-linkrow' }, link('Back to sign in', () => showLogin(onSignedIn))));
}

export function recoveryBlock(codes) {
  const text = codes.join('\n');
  const copy = h('button', { type: 'button', class: 'btn btn-sm', on: { click: async () => {
    try { await navigator.clipboard.writeText(text); copy.textContent = 'Copied'; } catch { copy.textContent = 'Select and copy'; }
  } } }, 'Copy all');
  const save = h('button', { type: 'button', class: 'btn btn-sm', on: { click: () => {
    const blob = new Blob([`nullboard recovery codes\nEach code works once.\n\n${text}\n`], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: 'nullboard-recovery-codes.txt' });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } } }, 'Download');
  return h('div', null,
    h('div', { class: 'recovery-grid' }, codes.map((c) => h('span', null, c))),
    h('div', { class: 'row' }, copy, save));
}

function showRecoveryCodes(codes, done) {
  const ack = h('input', { type: 'checkbox', id: 'ack' });
  const next = h('button', { type: 'button', class: 'btn btn-primary btn-block', disabled: true, on: { click: done } }, 'Continue to nullboard');
  ack.addEventListener('change', () => { next.disabled = !ack.checked; });
  screen(
    h('p', { class: 'auth-step' }, 'Step 2 of 2'),
    heading('Save your recovery codes'),
    sub('If you lose your phone, each of these signs you in once. They are shown only now.'),
    recoveryBlock(codes),
    h('div', { class: 'check-row' }, ack, h('label', { htmlFor: 'ack' }, 'I have saved these codes somewhere safe.')),
    next);
}

function showRegister(onSignedIn) {
  const err = errorBox();
  const email = h('input', { class: 'input', type: 'email', autocomplete: 'username', required: true, autocapitalize: 'none', spellcheck: false });
  const password = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', required: true, minLength: 10 });
  screen(
    heading('Create account'),
    sub('You will set up two-factor sign-in next.'),
    err,
    form('Create account', 'Creating…', [field('Email', email), field('Password', password, 'At least 10 characters.')], err, async () => {
      const res = await api('POST', '/api/auth/register', { email: email.value, password: password.value });
      showSetup(res, onSignedIn);
    }),
    h('div', { class: 'auth-linkrow' }, link('Back to sign in', () => showLogin(onSignedIn))));
}

function showForgot(onSignedIn) {
  const err = errorBox();
  const email = h('input', { class: 'input', type: 'email', autocomplete: 'username', required: true, autocapitalize: 'none', spellcheck: false });
  screen(
    heading('Reset password'),
    sub('We will email a link that works once and expires in one hour.'),
    err,
    form('Send reset link', 'Sending…', field('Email', email), err, async () => {
      await api('POST', '/api/auth/reset-request', { email: email.value });
      screen(
        heading('Check your email'),
        h('p', { class: 'auth-confirmation' }, 'If an account exists for that address, a reset link is on its way.'),
        h('div', { class: 'auth-linkrow' }, link('Back to sign in', () => showLogin(onSignedIn))));
    }),
    h('div', { class: 'auth-linkrow' }, link('Back to sign in', () => showLogin(onSignedIn))));
}

export function showReset(token, onSignedIn) {
  const err = errorBox();
  const password = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', required: true, minLength: 10 });
  const again = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', required: true });
  screen(
    heading('Choose a new password'),
    sub('You will still need your two-factor code to sign in.'),
    err,
    form('Update password', 'Updating…', [field('New password', password, 'At least 10 characters.'), field('Repeat password', again)], err, async () => {
      if (password.value !== again.value) throw new ApiError('The two passwords do not match.', 400);
      await api('POST', '/api/auth/reset-confirm', { token, password: password.value });
      showLogin(onSignedIn, 'Password updated. Sign in with the new one.');
    }),
    h('div', { class: 'auth-linkrow' }, link('Back to sign in', () => showLogin(onSignedIn))));
}
