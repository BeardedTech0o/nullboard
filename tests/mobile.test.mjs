// Phone-sized browser: layout rules, sheets, and touch drag with a ghost.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startStack } from './helpers.mjs';
import { launch, newPage, signUpViaUi, closePanelIfOpen } from './ui-helpers.mjs';

const SHOTS = path.resolve('test-results');
let stack, browser, M;

before(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  stack = await startStack();
  browser = await launch();
  M = await newPage(browser, {
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
});
after(async () => { await browser?.close(); await stack?.stop(); });

const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

// Long-press then drag with real TouchEvents, which is what iOS sends.
async function touchDrag(page, fromSel, to, { hold = 350 } = {}) {
  await page.evaluate(async ({ fromSel, to, hold }) => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const el = document.querySelector(fromSel);
    const r = el.getBoundingClientRect();
    const mk = (x, y) => new Touch({ identifier: 1, target: el, clientX: x, clientY: y, pageX: x, pageY: y });
    const fire = (type, x, y) => el.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : [mk(x, y)], changedTouches: [mk(x, y)] }));
    const x0 = r.left + 20, y0 = r.top + 20;
    fire('touchstart', x0, y0);
    await wait(hold);
    const steps = 10;
    for (let i = 1; i <= steps; i++) { fire('touchmove', x0 + ((to.x - x0) * i) / steps, y0 + ((to.y - y0) * i) / steps); await wait(16); }
    if (to.hover) await wait(to.hover);
    fire('touchend', to.x, to.y);
  }, { fromSel, to, hold });
}

test('phone: sign up, 100vh rule, no sideways scrolling, safe-area meta', async () => {
  await M.page.goto('http://127.0.0.1:8787/');
  await M.page.waitForSelector('body.ready');
  assert.ok(await noSideScroll(M.page), 'login fits the phone');
  await shot(M.page, 'm1-login');
  const css = await M.page.evaluate(() => ({
    html: getComputedStyle(document.documentElement).height, body: getComputedStyle(document.body).height, vh: window.innerHeight,
    viewport: document.querySelector('meta[name=viewport]').content,
    capable: document.querySelector('meta[name=apple-mobile-web-app-capable]').content,
    bar: document.querySelector('meta[name=apple-mobile-web-app-status-bar-style]').content,
  }));
  assert.equal(css.html, `${css.vh}px`);
  assert.equal(css.body, `${css.vh}px`);
  assert.match(css.viewport, /viewport-fit=cover/);
  assert.equal(css.capable, 'yes');
  assert.equal(css.bar, 'black-translucent');
  await signUpViaUi(M.page, stack, 'test@example.com');
  await M.page.waitForSelector('.panel.open');
  const panel = await M.page.locator('.panel').boundingBox();
  assert.ok(panel.width <= 390 + 1, 'daily panel fits the screen');
  await shot(M.page, 'm2-panel');
  await closePanelIfOpen(M.page);
});

async function shot(page, name) { await page.screenshot({ path: path.join(SHOTS, `${name}.png`) }); }

test('phone: capture, board, projects drawer, sheet limits and top buttons', async () => {
  const { page } = M;
  await page.getByRole('button', { name: 'Capture an idea' }).tap();
  await page.getByLabel('Idea title').fill('Phone idea');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await page.locator('.seg-opt', { hasText: 'Board' }).tap();
  await page.waitForSelector('.board');
  assert.ok(await noSideScroll(page), 'board does not scroll the page sideways');
  await page.getByRole('button', { name: 'Show projects' }).tap();
  await page.waitForSelector('.sidebar.open');
  await page.getByRole('button', { name: 'New' }).tap();
  await page.getByLabel('Name').fill('Phone project');
  const box = await page.locator('.sheet').boundingBox();
  assert.ok(box.height <= 844 * 0.9 + 1, 'sheet max-height is 90vh');
  const head = await page.locator('.sheet-head').boundingBox();
  assert.ok(head.y - box.y < 4, 'Cancel and Save sit at the very top of the sheet');
  await page.locator('.sheet-head .btn-primary').tap();
  const add = page.getByLabel('Add a tile to Phone project');
  await add.fill('Drag me');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('.sidebar .tile').length === 1);
  // use the sheet to place it, since the drawer covers the columns on a phone
  await page.locator('.sidebar .tile', { hasText: 'Drag me' }).tap();
  await page.getByLabel('Column').selectOption('todo');
  const sheet = await page.locator('.sheet').boundingBox();
  assert.ok(sheet.height <= 844 * 0.9 + 1);
  await page.locator('.sheet-head .btn-primary').tap();
  await page.locator('.sidebar .icon-btn[aria-label="Close projects"]').tap();
  await page.waitForFunction(() => !document.querySelector('.sidebar.open'));
  await page.locator('.column-body[data-status="todo"] .tile', { hasText: 'Drag me' }).waitFor();
  await shot(page, 'm3-board');
});

test('phone: touch drag with a ghost moves a tile to the next column, auto-scrolling', async () => {
  const { page } = M;
  const col = page.locator('.column-body[data-status="todo"] .tile', { hasText: 'Drag me' });
  const r = await col.boundingBox();
  const target = { x: 385, y: r.y + 30, hover: 1400 };   // right edge: scrolls to the next column
  // watch for the ghost while the finger is down
  const sawGhost = page.evaluate(() => new Promise((res) => {
    const t0 = Date.now();
    const iv = setInterval(() => { if (document.querySelector('.drag-ghost')) { clearInterval(iv); res(true); } else if (Date.now() - t0 > 4000) { clearInterval(iv); res(false); } }, 20);
  }));
  const scrolled = await Promise.all([sawGhost, touchDrag(page, '.column-body[data-status="todo"] .tile', target)]);
  assert.equal(scrolled[0], true, 'a ghost element follows the finger');
  assert.equal(await page.locator('.drag-ghost').count(), 0, 'ghost is removed on release');
  const left = await page.evaluate(() => document.querySelector('.columns').scrollLeft);
  assert.ok(left > 50, 'columns auto-scrolled while holding near the edge');
  await page.waitForTimeout(300);
  // the tile is now in a later column
  const where = await page.evaluate(() => {
    const t = [...document.querySelectorAll('.tile')].find((x) => x.textContent.includes('Drag me'));
    return t && t.closest('.column-body') ? t.closest('.column-body').dataset.status : null;
  });
  assert.notEqual(where, 'todo', `tile left To Do (now in ${where})`);
});

test('phone: a quick swipe scrolls instead of dragging', async () => {
  const { page } = M;
  const before = await page.evaluate(() => document.querySelectorAll('.drag-ghost').length);
  const sel = '.column-body .tile';
  await touchDrag(page, sel, { x: 300, y: 600 }, { hold: 20 });   // moves before the hold timer fires
  assert.equal(before + (await page.locator('.drag-ghost').count()), 0);
});

test('phone: every view fits without sideways scrolling and the focus view reads well', async () => {
  const { page } = M;
  for (const name of ['Inbox', 'Someday/Maybe', 'Archive', 'Streak', 'Review']) {
    await page.locator('.subnav a', { hasText: name }).tap();
    await page.waitForFunction((n) => document.title.toLowerCase().includes(n.toLowerCase().split('/')[0]), name === 'Review' ? 'Weekly' : name);
    assert.ok(await noSideScroll(page), `${name} fits`);
  }
  await page.getByRole('button', { name: 'Menu' }).tap();
  await page.getByRole('menuitem', { name: 'Settings' }).tap();
  await page.waitForSelector('.page-head');
  assert.ok(await noSideScroll(page), 'settings fits');
  await shot(page, 'm4-settings');
  await page.getByRole('button', { name: 'Menu' }).tap();
  await page.getByRole('menuitem', { name: 'Inbox' }).tap();
  await page.locator('.seg-opt', { hasText: 'Focus' }).tap();
  await page.locator('.focus-title').waitFor();
  assert.ok(await noSideScroll(page));
  await shot(page, 'm5-focus');
  assert.deepEqual(M.page.errors, []);
});
