import { chromium } from 'playwright-core';
import { BASE, totpNow } from './helpers.mjs';

export const PASSWORD = 'correct horse battery';

export async function launch() {
  return chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
}

export async function newPage(browser, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 }, ...opts });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) page.errors.push('console: ' + m.text()); });
  return { ctx, page };
}

export const grouped = (s) => s.replace(/\s+/g, '');

// A TOTP code the server will accept right now, even if an earlier test spent
// the current time step.
export async function freshCode(stack, secret) {
  await stack.sql('UPDATE nb_users SET totp_last_step = 0');
  return totpNow(secret);
}

export async function signUpViaUi(page, stack, email, password = PASSWORD) {
  await page.goto(BASE + '/');
  await page.waitForSelector('body.ready');
  await page.getByRole('button', { name: 'Create account' }).first().click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).last().click();
  await page.waitForSelector('.qr svg path');
  const secret = grouped(await page.locator('.auth-secret').innerText());
  const qrPaths = await page.locator('.qr svg path').count();
  await page.getByLabel('Code from the app').fill(await freshCode(stack, secret));
  await page.getByRole('button', { name: 'Verify and continue' }).click();
  await page.waitForSelector('.recovery-grid');
  const codes = await page.locator('.recovery-grid span').allInnerTexts();
  await page.getByLabel('I have saved these codes').check();
  await page.getByRole('button', { name: 'Continue to nullboard' }).click();
  await page.waitForSelector('.topbar');
  return { secret, codes, qrPaths };
}

export async function signInViaUi(page, stack, email, secret, password = PASSWORD) {
  await page.goto(BASE + '/');
  await page.waitForSelector('body.ready');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByLabel('Code').fill(await freshCode(stack, secret));
  await page.getByRole('button', { name: 'Verify' }).click();
  await page.waitForSelector('.topbar');
}

export async function closePanelIfOpen(page) {
  const close = page.getByRole('button', { name: 'Close checklist' });
  if (await close.count()) { await close.click(); await page.waitForTimeout(350); }
}
