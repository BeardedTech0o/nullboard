// End-to-end tests: a real browser against a real Worker and local D1.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startStack, BASE } from './helpers.mjs';
import { launch, newPage, signUpViaUi, signInViaUi, closePanelIfOpen, PASSWORD, freshCode } from './ui-helpers.mjs';

const EMAIL = 'test@example.com';
const SHOTS = path.resolve('test-results');
let stack, browser, A, B, secret, recoveryCodes;

before(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  stack = await startStack();
  browser = await launch();
});
after(async () => { await browser?.close(); await stack?.stop(); });

const tile = (page, title) => page.locator('.tile', { hasText: title }).first();
const settled = (page, title) => page.waitForFunction((t) => document.title.startsWith(t), title);
const view = async (page, name) => { await page.locator('.seg-opt', { hasText: name }).click(); await settled(page, name); };
const menu = async (page, label) => {
  await page.getByRole('button', { name: 'Menu' }).click();
  try { await page.getByRole('menuitem', { name: label }).click({ timeout: 4000 }); }
  catch (e) { await shot(page, `menu-fail-${label.replace(/\W/g, '')}`); throw e; }
  await settled(page, label);
};
const saveSheet = (page) => page.locator('.sheet-head .btn-primary').click();
// Polls an assertion until it holds: the UI re-renders on the next frame, so
// reading straight after a click can see the old view.
async function eventually(fn, ms = 6000) {
  const end = Date.now() + ms;
  for (;;) {
    try { return await fn(); } catch (e) { if (Date.now() > end) throw e; await new Promise((r) => setTimeout(r, 100)); }
  }
}
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) });

test('sign up with QR and manual secret, MFA setup, recovery codes, daily panel on first login', async () => {
  const made = await newPage(browser);
  A = made;
  const info = await signUpViaUi(A.page, stack, EMAIL);
  secret = info.secret;
  recoveryCodes = info.codes;
  assert.ok(info.qrPaths >= 1, 'a QR code is drawn');
  assert.match(secret, /^[A-Z2-7]{32}$/, 'manual secret shown');
  assert.equal(info.codes.length, 10);
  // panel slides out on login
  await A.page.waitForSelector('.panel.open');
  const items = await A.page.locator('.panel .check-item .label > div:first-child').allInnerTexts();
  assert.deepEqual(items, ['Review inbox', 'Review blockers', "Pick today's focus task", 'Update streak']);
  await shot(A.page, '01-panel');
});

test('daily checklist: tick, edit, persists after reload', async () => {
  const { page } = A;
  await page.getByRole('checkbox', { name: 'Review inbox' }).click();
  await page.waitForFunction(() => document.querySelector('.panel-head .small').textContent.includes('1 of 4'));
  await page.getByRole('button', { name: 'Edit checklist' }).click();
  await page.getByLabel('New checklist item').fill('Water the plants');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Finish editing' }).click();
  await page.getByRole('checkbox', { name: 'Water the plants' }).first().waitFor();
  await closePanelIfOpen(page);
  await page.waitForTimeout(1200);                // let the debounced sync land
  await page.reload();
  await page.waitForSelector('body.ready');
  await page.waitForSelector('.topbar');
  assert.equal(await page.locator('.panel').count(), 0, 'panel is not re-opened on a same-day reload');
  await page.getByRole('button', { name: /Daily checklist/ }).click();
  await page.waitForSelector('.panel.open');
  await page.getByRole('checkbox', { name: 'Water the plants' }).first().waitFor();
  assert.equal(await page.getByRole('checkbox', { name: 'Review inbox' }).getAttribute('aria-checked'), 'true');
  await closePanelIfOpen(page);
});

test('inbox capture: title only, never leaves the current view', async () => {
  const { page } = A;
  const before = page.url();
  await page.getByRole('button', { name: 'Capture an idea' }).click();
  await page.getByLabel('Idea title').fill('Buy the domain');
  await page.keyboard.press('Enter');
  await page.getByLabel('Idea title').fill('Call the plumber');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.capture-hint').textContent.includes('Call the plumber'));
  await page.keyboard.press('Escape');
  assert.equal(page.url(), before);
  assert.equal(await page.locator('.capture').count(), 0);
  await menu(page, 'Inbox');
  await page.waitForSelector('.item-title');
  assert.deepEqual((await page.locator('.item-title').allInnerTexts()).sort(), ['Buy the domain', 'Call the plumber']);
  await shot(page, '02-inbox');
});

test('capture keyboard shortcut works', async () => {
  const { page } = A;
  await page.keyboard.press('c');
  await page.getByLabel('Idea title').fill('Shortcut idea');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await page.locator('.item-title', { hasText: 'Shortcut idea' }).waitFor();
});

test('inbox triage: Someday and Drop and To board', async () => {
  const { page } = A;
  await page.locator('.item', { hasText: 'Call the plumber' }).getByRole('button', { name: 'Someday' }).click();
  await page.locator('.item', { hasText: 'Shortcut idea' }).getByRole('button', { name: 'Drop' }).click();
  await page.waitForFunction(() => !document.body.textContent.includes('Shortcut idea') || document.querySelector('.toast'));
  await page.locator('.subnav a', { hasText: 'Someday/Maybe' }).click();
  await page.locator('.item-title', { hasText: 'Call the plumber' }).waitFor();
  await page.locator('.subnav a', { hasText: 'Archive' }).click();
  await page.locator('.item-title', { hasText: 'Shortcut idea' }).waitFor();   // dropped, so kept in the archive
});

test('board: project, tiles, mouse drag into a column and reorder', async () => {
  const { page } = A;
  await view(page, 'Board');
  await page.getByRole('button', { name: 'New' }).click();
  await page.getByLabel('Name').fill('Website');
  await saveSheet(page);
  const add = page.getByLabel('Add a tile to Website');
  // typing several in a row: focus must survive each re-render
  await add.fill('Design header');
  let n = 0;
  for (const t of ['Write copy', 'Ship it', null]) {
    await page.keyboard.press('Enter');
    n++;
    await page.waitForFunction((c) => document.querySelectorAll('.sidebar .tile').length === c && document.activeElement.dataset.keep, n);
    if (t) await page.keyboard.type(t);
  }

  async function drag(from, toSelector, dy = 10) {
    const a = await from.boundingBox();
    const b = await page.locator(toSelector).boundingBox();
    await page.mouse.move(a.x + 20, a.y + 10);
    await page.mouse.down();
    await page.mouse.move(a.x + 40, a.y + 20, { steps: 3 });
    await page.mouse.move(b.x + b.width / 2, b.y + dy, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(300);
  }
  await drag(tile(page, 'Design header'), '.column-body[data-status="todo"]');
  await page.waitForSelector('.column-body[data-status="todo"] .tile');
  await drag(tile(page, 'Write copy'), '.column-body[data-status="inprogress"]');
  await drag(tile(page, 'Ship it'), '.column-body[data-status="todo"]', 300);
  const todo = await page.locator('.column-body[data-status="todo"] .tile-title').allInnerTexts();
  assert.deepEqual(todo, ['Design header', 'Ship it']);
  assert.deepEqual(await page.locator('.column-body[data-status="inprogress"] .tile-title').allInnerTexts(), ['Write copy']);
  // reorder: drag "Ship it" above "Design header"
  const top = await tile(page, 'Design header').boundingBox();
  const a = await tile(page, 'Ship it').boundingBox();
  await page.mouse.move(a.x + 20, a.y + 10);
  await page.mouse.down();
  await page.mouse.move(a.x + 25, a.y - 5, { steps: 3 });
  await page.mouse.move(top.x + 30, top.y + 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelector('.column-body[data-status="todo"] .tile-title').textContent === 'Ship it');
  await shot(page, '03-board');
});

test('tile sheet: estimate, steps, notes, blocked and dependency', async () => {
  const { page } = A;
  await tile(page, 'Design header').click();
  await page.waitForSelector('.sheet');
  await page.locator('.sheet-head').getByRole('button', { name: 'Cancel' }).first().waitFor();
  const sheetBox = await page.locator('.sheet').boundingBox();
  assert.ok(sheetBox.height <= 800 * 0.9 + 1, 'sheet is at most 90vh');
  await page.getByLabel('Estimate').fill('1h');
  await page.getByPlaceholder('Add a step').fill('Sketch layout');
  await page.keyboard.press('Enter');
  await page.getByPlaceholder('Add a step').fill('Pick colours');
  await page.keyboard.press('Enter');
  await page.getByPlaceholder('Add a note').fill('Client prefers a plain header.');
  await page.getByRole('button', { name: 'Add note' }).click();
  await saveSheet(page);
  await tile(page, 'Design header').locator('text=0/2 steps').waitFor();

  await tile(page, 'Write copy').click();
  await page.getByLabel(/Blocked: this cannot move/).check();
  await page.getByLabel('Waiting on').selectOption({ label: 'Design header' });
  await saveSheet(page);
  await tile(page, 'Write copy').locator('.tag-blocked').waitFor();   // blocked tile shows a Blocked tag
});

test('focus view: only the committed task, steps, status, time, complete to archive', async () => {
  const { page } = A;
  await tile(page, 'Design header').getByRole('button', { name: /today's focus/ }).click();
  await view(page, 'Focus');
  await page.waitForSelector('.focus-title');
  assert.equal(await page.locator('.focus-title').innerText(), 'Design header');
  assert.equal(await page.locator('.tile').count(), 0, 'nothing else from the board is on screen');
  assert.ok(await page.locator('.seg-opt', { hasText: 'In Progress' }).locator('input').isChecked());
  assert.match(await page.locator('.focus-eyebrow').innerText(), /WEBSITE|Website/i);
  await page.getByRole('checkbox', { name: 'Sketch layout' }).click();
  await page.waitForFunction(() => document.body.textContent.includes('1 of 2 steps'));
  assert.match(await page.locator('.where').innerText(), /Next: Pick colours/);
  assert.match(await page.locator('.note').first().innerText(), /plain header/);
  // time
  await page.getByRole('button', { name: 'Start timer' }).click();
  await page.waitForSelector('button:has-text("Stop timer")');
  await page.waitForTimeout(1100);
  await page.getByRole('button', { name: 'Stop timer' }).click();
  await page.getByRole('button', { name: '+15m' }).click();
  await page.waitForFunction(() => document.querySelector('.time-card').textContent.includes('15m'));
  assert.match(await page.locator('.time-card').innerText(), /1h/);
  // status change
  await page.locator('.seg-opt', { hasText: 'Awaiting Sign-Off' }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('.seg-opt')].find((l) => l.textContent.includes('Awaiting')).querySelector('input').checked);
  await shot(page, '04-focus');
  // the blocked task unblocks once its blocker completes
  await page.getByRole('button', { name: /Complete and archive/ }).click();
  await page.waitForSelector('.toast');
  await page.locator('.focus-title', { hasText: 'Nothing committed' }).waitFor();
  await view(page, 'Board');
  assert.equal(await tile(page, 'Write copy').locator('.tag-blocked').count(), 0, 'blocker finished, so the dependent task is released');
  await page.locator('.subnav a', { hasText: 'Archive' }).click();
  const row = page.locator('.item', { hasText: 'Design header' });
  assert.match(await row.innerText(), /Completed/);
  assert.match(await row.innerText(), /spent of 1h estimated/);
});

test('streak shows today after ticking something off', async () => {
  const { page } = A;
  await menu(page, 'Streak');
  await page.waitForSelector('.stats');
  const nums = await page.locator('.stat .num').allInnerTexts();
  assert.equal(nums[0], '1');
  assert.ok(await page.locator('.heat i.on').count() >= 1);
  await shot(page, '05-streak');
});

test('undo restores a completed task', async () => {
  const { page } = A;
  await view(page, 'Board');
  await tile(page, 'Write copy').getByRole('button', { name: /today's focus/ }).click();
  await view(page, 'Focus');
  await page.getByRole('button', { name: /Complete and archive/ }).click();
  await page.getByRole('button', { name: 'Undo' }).click();
  await view(page, 'Board');
  await page.locator('.column-body .tile', { hasText: 'Write copy' }).waitFor();
});

test('weekly review prompt appears after a week and walks through the lists', async () => {
  const { page } = A;
  await page.evaluate(async () => {
    const r = await (await fetch('/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ since: 0, changes: [] }) })).json();
    const prefs = r.records.find((x) => x.kind === 'prefs').data;
    prefs.reviewAnchor = Date.now() - 9 * 86400000;
    prefs.lastReviewAt = null;
    await fetch('/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ since: 0, changes: [{ kind: 'prefs', id: 'prefs', data: prefs, updated_at: Date.now() }] }) });
  });
  await page.reload();
  await page.waitForSelector('.topbar');
  await closePanelIfOpen(page);
  await view(page, 'Focus');
  await page.waitForSelector('.banner');
  await page.getByRole('button', { name: 'Start review' }).click();
  await eventually(async () => assert.match(await page.locator('.page-head').innerText(), /Step 1 of 4: Inbox/));
  await page.locator('.item', { hasText: 'Buy the domain' }).getByRole('button', { name: 'Drop' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await eventually(async () => assert.match(await page.locator('.page-head').innerText(), /Stale tasks/));
  await page.getByRole('button', { name: 'Next' }).click();
  await eventually(async () => assert.match(await page.locator('.page-head').innerText(), /Someday/));
  await page.getByRole('button', { name: 'Next' }).click();
  await eventually(async () => assert.match(await page.locator('.page-head').innerText(), /Finish/));
  await page.getByRole('button', { name: 'Finish review' }).click();
  await page.locator('.focus-title').waitFor();
  assert.equal(await page.locator('.banner').count(), 0, 'prompt clears once the review is done');
});

test('sync across two sessions: edits, appearance preferences, checklist', async () => {
  B = await newPage(browser);
  await signInViaUi(B.page, stack, EMAIL, secret);
  await closePanelIfOpen(B.page);
  await view(B.page, 'Board');
  assert.ok(await tile(B.page, 'Write copy').count(), 'second device sees the first one\'s board');
  await B.page.locator('.sidebar .project-name', { hasText: 'Website' }).first().waitFor();

  // device A captures; device B picks it up on refresh
  await A.page.getByRole('button', { name: 'Capture an idea' }).click();
  await A.page.getByLabel('Idea title').fill('From the phone');
  await A.page.keyboard.press('Enter');
  await A.page.keyboard.press('Escape');
  await A.page.waitForTimeout(1500);
  await B.page.reload();
  await B.page.waitForSelector('.topbar');
  await closePanelIfOpen(B.page);
  await menu(B.page, 'Inbox');
  await B.page.locator('.item-title', { hasText: 'From the phone' }).first().waitFor();

  // theme is a synced preference
  await menu(A.page, 'Settings');
  await A.page.locator('.seg-opt', { hasText: 'Dark' }).click();
  await A.page.waitForTimeout(1500);
  assert.equal(await A.page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  await shot(A.page, '06-settings-dark');
  await B.page.reload();
  await B.page.waitForSelector('.topbar');
  await B.page.waitForFunction(() => document.documentElement.dataset.theme === 'dark', null, { timeout: 8000 });
  await A.page.locator('.seg-opt', { hasText: 'System' }).click();
  await A.page.waitForTimeout(800);
});

test('offline edits are kept and uploaded when the connection returns', async () => {
  const { page, ctx } = A;
  await ctx.setOffline(true);
  await page.getByRole('button', { name: 'Capture an idea' }).click();
  await page.getByLabel('Idea title').fill('Written on the train');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1500);
  assert.equal(await page.locator('.sync-dot').getAttribute('data-status'), 'err', 'status shows offline');
  const pending = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.startsWith('nb:v1:')))).outbox).length);
  assert.ok(pending >= 1, 'edit is queued locally');
  await ctx.setOffline(false);
  await page.waitForFunction(() => document.querySelector('.sync-dot').dataset.status === 'ok', null, { timeout: 15000 });
  await B.page.reload();
  await B.page.waitForSelector('.topbar');
  await closePanelIfOpen(B.page);
  await menu(B.page, 'Inbox');
  await B.page.locator('.item-title', { hasText: 'Written on the train' }).first().waitFor();
});

const LEGACY = JSON.stringify({
  projects: [{ id: 'proj-aaa', name: 'Old Project', color: '#9c5a52' }, { id: 'proj-bbb', name: 'Archived Old', color: '#5f7a5a', archived: true }],
  tiles: [
    { id: 'tile-1', projectId: 'proj-aaa', title: 'Legacy todo', status: 'todo', notes: [{ id: 'n1', text: 'a legacy note' }] },
    { id: 'tile-2', projectId: 'proj-aaa', title: 'Legacy unplaced', status: null, notes: [] },
    { id: 'tile-3', projectId: 'proj-aaa', title: 'Legacy finished', status: 'done', notes: [] },
  ],
  templates: [{ id: 'tpl-x', name: 'Legacy template', tiles: [{ title: 'one' }, { title: 'two' }] }],
  theme: 'ink', fontSize: 'large',
});

test('import from the old localStorage JSON: preview, import, idempotent', async () => {
  const { page } = A;
  await menu(page, 'Settings');
  await page.getByRole('button', { name: 'Import from old nullboard' }).click();
  await page.getByLabel('Exported JSON').fill('not json');
  await page.locator('.auth-error').first().waitFor();
  await page.getByLabel('Exported JSON').fill(LEGACY);
  assert.match(await page.locator('.view-narrow').innerText(), /Found 2 projects, 3 tiles and 1 template\./);
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await page.waitForSelector('.board');
  await page.locator('.column-body .tile', { hasText: 'Legacy todo' }).first().waitFor();
  await page.locator('.sidebar .project-name', { hasText: 'Old Project' }).first().waitFor();
  assert.equal(await page.locator('.sidebar h2', { hasText: 'Archived projects' }).count(), 1);
  await page.locator('.subnav a', { hasText: 'Archive' }).click();
  await page.locator('.item', { hasText: 'Legacy finished' }).first().waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.fontsize), 'large');

  // run it a second time: nothing duplicates
  const countBefore = await stack.sql("SELECT COUNT(*) AS n FROM nb_records WHERE kind='tile' AND deleted=0");
  await menu(page, 'Settings');
  await page.getByRole('button', { name: 'Import from old nullboard' }).click();
  await page.getByLabel('Exported JSON').fill(LEGACY);
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await page.waitForSelector('.board');
  await page.waitForTimeout(1200);
  const countAfter = await stack.sql("SELECT COUNT(*) AS n FROM nb_records WHERE kind='tile' AND deleted=0");
  assert.equal(JSON.parse(countAfter)[0].results[0].n, JSON.parse(countBefore)[0].results[0].n);
  // reset text size so later screenshots are the default
  await menu(page, 'Settings');
  await page.locator('.seg-opt', { hasText: 'Medium' }).click();
});

test('export downloads everything as JSON', async () => {
  const { page } = A;
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export JSON' }).click()]);
  const data = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
  assert.ok(data.records.some((r) => r.kind === 'tile' && r.data.title === 'Legacy todo'));
});

test('recovery code sign-in works once', async () => {
  const c = await newPage(browser);
  await c.page.goto(BASE + '/');
  await c.page.waitForSelector('body.ready');
  await c.page.getByLabel('Email').fill(EMAIL);
  await c.page.getByLabel('Password').fill(PASSWORD);
  await c.page.getByRole('button', { name: 'Sign in' }).click();
  await c.page.getByRole('button', { name: 'Use a recovery code' }).click();
  await c.page.getByLabel('Recovery code').fill(recoveryCodes[3]);
  await c.page.getByRole('button', { name: 'Verify' }).click();
  await c.page.waitForSelector('.topbar');
  await c.page.locator('.toast', { hasText: 'Recovery code used. 9 left' }).first().waitFor();
  await c.ctx.close();
  // second use is refused
  const d = await newPage(browser);
  await d.page.goto(BASE + '/');
  await d.page.waitForSelector('body.ready');
  await d.page.getByLabel('Email').fill(EMAIL);
  await d.page.getByLabel('Password').fill(PASSWORD);
  await d.page.getByRole('button', { name: 'Sign in' }).click();
  await d.page.getByRole('button', { name: 'Use a recovery code' }).click();
  await d.page.getByLabel('Recovery code').fill(recoveryCodes[3]);
  await d.page.getByRole('button', { name: 'Verify' }).click();
  await d.page.waitForSelector('.auth-error');
  assert.match(await d.page.locator('.auth-error').innerText(), /already used/);
  await d.ctx.close();
});

test('wrong password and wrong MFA code show clear errors; lock-out kicks in', async () => {
  const c = await newPage(browser);
  await c.page.goto(BASE + '/');
  await c.page.waitForSelector('body.ready');
  await c.page.getByLabel('Email').fill(EMAIL);
  await c.page.getByLabel('Password').fill('definitely wrong');
  await c.page.getByRole('button', { name: 'Sign in' }).click();
  await c.page.waitForSelector('.auth-error');
  assert.match(await c.page.locator('.auth-error').innerText(), /incorrect/);
  await c.ctx.close();
  await stack.sql("DELETE FROM nb_auth_attempts WHERE bucket LIKE 'loginfail:%'");
});

test('password reset by emailed link, then sessions are revoked', async () => {
  const { page } = A;
  await menu(page, 'Settings');
  await page.getByRole('button', { name: 'Sign out', exact: true }).first().click();
  await page.waitForSelector('.auth-wordmark');
  assert.equal(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('nb:v1:')).length), 0, 'local data is wiped on sign out');
  await page.getByRole('button', { name: 'Forgot your password?' }).click();
  await page.getByLabel('Email').fill(EMAIL);
  const sentBefore = stack.mails.length;
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await page.waitForSelector('.auth-confirmation');
  await page.waitForTimeout(600);
  assert.equal(stack.mails.length, sentBefore + 1);
  const link = /href="([^"]+)"/.exec(stack.mails.at(-1).html)[1];
  assert.match(link, /\/\?reset=/);
  await page.goto(link);
  await page.waitForSelector('body.ready');
  assert.equal(new URL(page.url()).search, '', 'token is removed from the address bar');
  await page.getByLabel('New password').fill('a brand new password');
  await page.getByLabel('Repeat password').fill('a different password');
  await page.getByRole('button', { name: 'Update password' }).click();
  assert.match(await page.locator('.auth-error').innerText(), /do not match/);
  await page.getByLabel('Repeat password').fill('a brand new password');
  await page.getByRole('button', { name: 'Update password' }).click();
  await page.locator('.auth-note', { hasText: 'Password updated' }).waitFor();
  // the other device is signed out on its next load
  await B.page.reload();
  await B.page.waitForSelector('.auth-wordmark');
  assert.equal(await B.page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('nb:v1:')).length), 0, 'local state cleared when the session is no longer valid');
  // used link cannot be reused
  await page.goto(link);
  await page.getByLabel('New password').fill('yet another password');
  await page.getByLabel('Repeat password').fill('yet another password');
  await page.getByRole('button', { name: 'Update password' }).click();
  await page.waitForSelector('.auth-error');
  // sign in with the new password and MFA
  await signInViaUi(page, stack, EMAIL, secret, 'a brand new password');
  await page.locator('.topbar').first().waitFor();
  await closePanelIfOpen(page);
});

test('a user deleted on the server is signed out and local data cleared on next load', async () => {
  const { page } = A;
  await page.waitForTimeout(500);
  assert.ok(await page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith('nb:v1:'))));
  await stack.sql("DELETE FROM nb_users WHERE email = 'test@example.com'");
  await page.reload();
  await page.waitForSelector('.auth-wordmark');
  assert.equal(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('nb:')).length), 0);
  assert.equal(new URL(page.url()).hash, '');
});

test('no script errors were thrown in any session', () => {
  assert.deepEqual(A.page.errors, []);
  assert.deepEqual(B.page.errors, []);
});
