// Weekly review: walks through the inbox, stale tasks and Someday/Maybe.

import { h } from '../dom.js';
import * as store from '../store.js';
import * as actions from '../actions.js';
import { openTileSheet } from '../tile-sheet.js';
import { openTriage } from './lists.js';
import { ui, navigate, toast } from '../ui.js';
import { staleTiles, STALE_DAYS, prettyDate } from '../model.js';

const STEPS = ['Inbox', 'Stale tasks', 'Someday/Maybe', 'Finish'];

const rerender = () => document.dispatchEvent(new Event('nb:render'));

export function renderReview() {
  const step = Math.min(ui.reviewStep, STEPS.length - 1);
  const nav = h('div', { class: 'row spacer' },
    step > 0 ? h('button', { type: 'button', class: 'btn', on: { click: () => { ui.reviewStep = step - 1; rerender(); } } }, 'Back') : null,
    step < STEPS.length - 1
      ? h('button', { type: 'button', class: 'btn btn-primary', on: { click: () => { ui.reviewStep = step + 1; rerender(); } } }, 'Next')
      : h('button', { type: 'button', class: 'btn btn-primary', on: { click: finish } }, 'Finish review'));

  return h('div', { class: 'view-narrow' },
    h('div', { class: 'page-head' }, h('h1', null, 'Weekly review'), h('span', { class: 'muted small' }, `Step ${step + 1} of ${STEPS.length}: ${STEPS[step]}`)),
    [stepInbox, stepStale, stepSomeday, stepFinish][step](),
    nav);
}

function finish() {
  store.setPrefs({ lastReviewAt: store.now() });
  ui.reviewStep = 0;
  toast('Review done. See you next week.');
  navigate('focus');
}

function row(t, note, buttons) {
  return h('div', { class: 'item' },
    h('button', { type: 'button', class: 'item-title', on: { click: () => openTileSheet(t.id) } }, t.title),
    note ? h('div', { class: 'small muted' }, note) : null,
    h('div', { class: 'item-actions' }, buttons));
}

function stepInbox() {
  const items = store.tiles().filter((t) => t.lane === 'inbox').sort((a, b) => a.order - b.order);
  return h('div', null,
    h('p', { class: 'muted' }, 'Give every captured idea a home: the board, Someday/Maybe, or the bin.'),
    items.length ? items.map((t) => row(t, null, [
      h('button', { type: 'button', class: 'btn btn-sm', on: { click: () => openTriage(t.id) } }, 'To board'),
      h('button', { type: 'button', class: 'btn btn-sm', on: { click: () => actions.moveToLane(t.id, 'someday') } }, 'Someday'),
      h('button', { type: 'button', class: 'btn btn-sm btn-ghost', on: { click: () => actions.dropTile(t.id) } }, 'Drop'),
    ])) : h('p', { class: 'empty' }, 'Inbox is clear.'));
}

function stepStale() {
  const now = store.now();
  const items = staleTiles(store.tiles(), now).sort((a, b) => a.touchedAt - b.touchedAt);
  return h('div', null,
    h('p', { class: 'muted' }, `Tasks on the board that have not been touched for more than ${STALE_DAYS} days. Keep it, park it, or let it go.`),
    items.length ? items.map((t) => row(t, `Last touched ${prettyDate(t.touchedAt)}`, [
      h('button', { type: 'button', class: 'btn btn-sm', on: { click: () => store.patchTile(t.id, () => {}) } }, 'Keep'),
      h('button', { type: 'button', class: 'btn btn-sm', on: { click: () => actions.moveToLane(t.id, 'someday') } }, 'Someday'),
      h('button', { type: 'button', class: 'btn btn-sm btn-ghost', on: { click: () => actions.dropTile(t.id) } }, 'Drop'),
    ])) : h('p', { class: 'empty' }, 'Nothing stale.'));
}

function stepSomeday() {
  const items = store.tiles().filter((t) => t.lane === 'someday').sort((a, b) => a.order - b.order);
  return h('div', null,
    h('p', { class: 'muted' }, 'Anything here that is no longer true, or no longer interesting, can go.'),
    items.length ? items.map((t) => row(t, null, [
      h('button', { type: 'button', class: 'btn btn-sm', on: { click: () => openTriage(t.id) } }, 'To board'),
      h('button', { type: 'button', class: 'btn btn-sm btn-ghost', on: { click: () => actions.dropTile(t.id) } }, 'Drop'),
    ])) : h('p', { class: 'empty' }, 'Nothing parked.'));
}

function stepFinish() {
  const tiles = store.tiles();
  const count = (lane) => tiles.filter((t) => t.lane === lane).length;
  return h('div', { class: 'stack' },
    h('p', { class: 'muted' }, 'That is the review. Here is where things stand.'),
    h('div', { class: 'stats' },
      h('div', { class: 'stat' }, h('div', { class: 'caps muted' }, 'Inbox'), h('div', { class: 'num' }, String(count('inbox')))),
      h('div', { class: 'stat' }, h('div', { class: 'caps muted' }, 'On the board'), h('div', { class: 'num' }, String(count('active')))),
      h('div', { class: 'stat' }, h('div', { class: 'caps muted' }, 'Someday'), h('div', { class: 'num' }, String(count('someday'))))));
}
